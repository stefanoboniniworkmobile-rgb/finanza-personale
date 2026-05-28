/**
 * Callback handler PSD2 — Enable Banking ci redirige qui dopo che l'utente
 * ha completato il consenso sul sito della banca.
 *
 * URL: GET /api/psd2/callback?code=<auth_code>&state=<state>
 *
 * Flow (nuovo, post refactor abbinamento):
 *  1) Decodifica `state` (base64url JSON) per recuperare bankAccountId + userId
 *  2) Verifica che la sessione utente sia ancora valida (anti-CSRF basico)
 *  3) Chiama authorizeSession(code) per ottenere session_id + accounts dalla banca
 *  4) Se 0 account → pagina rossa "nessun account ritornato"
 *  5) Altrimenti → redirect a /impostazioni/banche/abbinamento?sessionId=...
 *     dove l'utente sceglie esplicitamente a quale BankAccount associare ogni
 *     account ritornato (o se codificarne uno nuovo, o se scartarlo).
 *
 *     Il bankAccountId originario passato in state viene propagato come
 *     `suggestedBankAccountId` per fare da hint nel matching automatico:
 *     se la banca ritorna 1 account e l'utente aveva avviato il flow dal
 *     BankAccount X, è probabile che X sia il match giusto.
 *
 * Fallback (state non decodificabile, es. test manuali da CLI):
 *  → renderizza una pagina HTML di debug con i dati ricevuti, come prima.
 *  Non persistiamo nulla.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { authorizeSession } from "@/lib/psd2/enable-banking";

type StatePayload = { bankAccountId: string; userId: string };

function decodeState(state: string | null): StatePayload | null {
  if (!state) return null;
  try {
    const b64 = state.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as Partial<StatePayload>;
    if (
      typeof parsed.bankAccountId === "string" &&
      typeof parsed.userId === "string"
    ) {
      return { bankAccountId: parsed.bankAccountId, userId: parsed.userId };
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return htmlResponse(
      `<h1>❌ Errore dal provider</h1>
       <p><b>error:</b> ${escapeHtml(error)}</p>
       <p><b>state:</b> ${escapeHtml(state ?? "")}</p>
       <p><a href="/impostazioni/banche">← Torna alle banche</a></p>`,
      400,
    );
  }

  if (!code) {
    return htmlResponse(
      `<h1>❌ Manca il parametro <code>code</code></h1>
       <p>La richiesta non contiene il codice di autorizzazione.</p>
       <p><a href="/impostazioni/banche">← Torna alle banche</a></p>`,
      400,
    );
  }

  const decodedState = decodeState(state);

  try {
    const session = await authorizeSession(code);

    console.log(
      "[PSD2 callback] session received:",
      JSON.stringify(session, null, 2),
    );

    // ─────────────────────────────────────────────────────────
    // Flow UI: verifiche di scope e redirect a pagina abbinamento.
    //
    // NON scriviamo BankConnection qui. La scrittura avviene nell'endpoint
    // POST /api/psd2/match dopo che l'utente ha confermato le associazioni
    // nella pagina /impostazioni/banche/abbinamento.
    // ─────────────────────────────────────────────────────────
    if (decodedState) {
      // Anti-CSRF basico
      const authSession = await auth();
      const currentUserId = authSession?.user?.id;
      if (!currentUserId) {
        return htmlResponse(
          `<h1>❌ Sessione utente scaduta</h1>
           <p>Rifai login e riavvia la connessione.</p>
           <p><a href="/login">→ Vai al login</a></p>`,
          401,
        );
      }
      if (currentUserId !== decodedState.userId) {
        return htmlResponse(
          `<h1>❌ Mismatch utente</h1>
           <p>La sessione utente non corrisponde a quella che ha avviato il flow.</p>`,
          403,
        );
      }

      // Verifica che il BankAccount referenziato dallo state esista e
      // appartenga all'utente. Non lo associamo qui, ma lo usiamo come
      // "suggestedBankAccountId" nella pagina abbinamento.
      const bankAccount = await prisma.bankAccount.findFirst({
        where: { id: decodedState.bankAccountId },
        include: { holder: { select: { id: true, userId: true } } },
      });
      if (!bankAccount || bankAccount.holder.userId !== currentUserId) {
        return htmlResponse(
          `<h1>❌ Conto non trovato o non autorizzato</h1>
           <p>Il BankAccount referenziato dallo state non esiste o non appartiene a questo utente.</p>
           <p><a href="/impostazioni/banche">← Torna alle banche</a></p>`,
          404,
        );
      }

      const accounts = session.accounts ?? [];
      if (accounts.length === 0) {
        return htmlResponse(
          `<h1>⚠ Nessun account ritornato dalla banca</h1>
           <p>La sessione è stata autorizzata ma non sono stati trovati conti accessibili.
           Questo può capitare se in modalità production restricted il conto non
           è stato whitelistato sulla nuova app.</p>
           <p><a href="/impostazioni/banche">← Torna alle banche</a></p>`,
          200,
        );
      }

      // Persisti il payload session in PendingPsd2Session (TTL 1 ora).
      // Necessario perché GET /sessions/{id} di Enable Banking NON ritorna
      // gli account con uid: il payload buono è solo quello del POST iniziale
      // (authorizeSession), quindi lo dobbiamo congelare qui.
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      const pending = await prisma.pendingPsd2Session.upsert({
        where: { sessionId: session.session_id },
        update: {
          payload: JSON.stringify(session),
          userId: currentUserId,
          holderId: bankAccount.holder.id,
          suggestedBankAccountId: bankAccount.id,
          expiresAt,
        },
        create: {
          sessionId: session.session_id,
          payload: JSON.stringify(session),
          userId: currentUserId,
          holderId: bankAccount.holder.id,
          suggestedBankAccountId: bankAccount.id,
          expiresAt,
        },
        select: { id: true },
      });

      // Redirect a pagina di abbinamento, sempre (anche con 1 solo account).
      // Scelta UX: l'utente deve sempre vedere e confermare cosa sta collegando,
      // mai un collegamento silenzioso.
      // L'ID del PendingPsd2Session basta — la pagina lo usa per recuperare
      // tutto il payload (sessionId, accounts, aspsp, suggestedBankAccountId).
      const params = new URLSearchParams({ pending: pending.id });
      return NextResponse.redirect(
        new URL(
          `/impostazioni/banche/abbinamento?${params.toString()}`,
          req.url,
        ),
      );
    }

    // ─────────────────────────────────────────────────────────
    // Flow fallback (test manuali CLI senza state UI): debug HTML
    // ─────────────────────────────────────────────────────────
    const accounts = session.accounts ?? [];
    const accountsRows = accounts
      .map(
        (a, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><code>${escapeHtml(a?.uid)}</code></td>
          <td>${escapeHtml(a?.account_type)}</td>
          <td>${escapeHtml(a?.cash_account_type)}</td>
          <td>${escapeHtml(a?.currency)}</td>
          <td>${escapeHtml(
            (a?.identifications ?? [])
              .map((id) => `${id.scheme_name}: ${id.identification}`)
              .join("<br>"),
          )}</td>
          <td>${escapeHtml(a?.product)}</td>
        </tr>`,
      )
      .join("");

    return htmlResponse(`
      <h1>✓ Sessione autorizzata (debug, no state)</h1>
      <p>State non decodificabile → nessuna BankConnection creata.
         Probabilmente questo è un test CLI; usa scripts/eb-bootstrap.ts per persistere.</p>

      <h2>Sessione</h2>
      <ul>
        <li><b>session_id:</b> <code>${escapeHtml(session.session_id)}</code></li>
        <li><b>status:</b> ${escapeHtml(session.status)}</li>
        <li><b>aspsp:</b> ${escapeHtml(session.aspsp?.name)} (${escapeHtml(session.aspsp?.country)})</li>
        <li><b>psu_type:</b> ${escapeHtml(session.psu_type)}</li>
        <li><b>valid_until:</b> ${escapeHtml(session.access?.valid_until)}</li>
        <li><b>state passato:</b> ${escapeHtml(state ?? "(nessuno)")}</li>
      </ul>

      <h2>Account ricevuti (${accounts.length})</h2>
      <table border="1" cellpadding="6" style="border-collapse: collapse;">
        <thead>
          <tr>
            <th>#</th>
            <th>uid (account_id)</th>
            <th>account_type</th>
            <th>cash_account_type</th>
            <th>currency</th>
            <th>identifications</th>
            <th>product</th>
          </tr>
        </thead>
        <tbody>${accountsRows}</tbody>
      </table>

      <h2>Raw JSON</h2>
      <details>
        <summary>Mostra/nascondi</summary>
        <pre style="background:#f5f5f5;padding:12px;overflow:auto;">${escapeHtml(
          JSON.stringify(session, null, 2),
        )}</pre>
      </details>

      <hr>
      <p><a href="/impostazioni/banche">← Torna alle banche</a></p>
    `);
  } catch (err: unknown) {
    const errObj = err as { message?: string; status?: number; body?: unknown };
    return htmlResponse(
      `<h1>❌ Errore in authorizeSession</h1>
       <p><b>Messaggio:</b> ${escapeHtml(errObj.message ?? String(err))}</p>
       <p><b>HTTP status:</b> ${errObj.status ?? "?"}</p>
       <pre style="background:#f5f5f5;padding:12px;overflow:auto;">${escapeHtml(
         JSON.stringify(errObj.body ?? null, null, 2),
       )}</pre>
       <p><a href="/impostazioni/banche">← Torna alle banche</a></p>`,
      500,
    );
  }
}

function htmlResponse(body: string, status = 200) {
  const html = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>PSD2 callback</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 1100px; margin: 24px auto; padding: 0 16px; color: #1a1a1a; }
    h1 { font-size: 20px; }
    h2 { font-size: 16px; margin-top: 24px; }
    table { font-size: 13px; }
    th { background: #f5f5f5; text-align: left; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    pre { white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>${body}</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: unknown): string {
  if (s == null) return "";
  const str = typeof s === "string" ? s : String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
