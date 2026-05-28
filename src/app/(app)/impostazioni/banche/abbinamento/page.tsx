/**
 * Pagina di abbinamento PSD2.
 *
 * URL: /impostazioni/banche/abbinamento?sessionId=...&suggestedBankAccountId=...
 *
 * Arrivo qui dal callback /api/psd2/callback dopo che l'utente ha completato
 * il consenso sulla banca. Enable Banking ha già autorizzato la session e
 * restituito 1..N account; questa pagina mostra ogni account ritornato e
 * chiede all'utente di scegliere, per ognuno, una di queste azioni:
 *   - Collega a un conto esistente in anagrafica (con suggerimento automatico
 *     se IBAN/last4 corrispondono)
 *   - Codifica un nuovo conto in anagrafica con i dati pre-compilati
 *   - Scarta (non collegare nulla per questo account)
 *
 * Al submit si chiama POST /api/psd2/match che crea BankConnection +
 * SyncJob, lancia il sync in background con `after()` e redirige a
 * /impostazioni/banche?status=connected&jobs=... dove un piccolo poller
 * mostra l'avanzamento del sync iniziale.
 */

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import type { Session as EbSession } from "@/lib/psd2/enable-banking";
import {
  matchProviderAccount,
  extractIdentifiers,
  suggestAccountName,
  suggestAccountType,
  type BankAccountCandidate,
} from "@/lib/psd2/match";
import { AbbinamentoClient, type AccountRow } from "@/components/banche/AbbinamentoClient";
import Link from "next/link";

export default async function AbbinamentoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authSession = await auth();
  if (!authSession?.user?.id) redirect("/login");
  const userId = authSession.user.id;
  const holder = await getActiveHolder(userId);

  const params = await searchParams;
  const pendingId = typeof params.pending === "string" ? params.pending : null;

  if (!pendingId) {
    return (
      <div className="panel p-6">
        <h1 className="text-lg font-semibold mb-2">Sessione non specificata</h1>
        <p className="text-sm text-sub mb-4">
          La pagina di abbinamento richiede un identificatore di sessione
          pendente. Probabilmente sei arrivato qui per errore.
        </p>
        <Link href="/impostazioni/banche" className="btn">
          Torna alle banche
        </Link>
      </div>
    );
  }

  // Recupera la PendingPsd2Session che il callback ha congelato dopo
  // authorizeSession. Non rileggiamo MAI da EB: GET /sessions/{id} non
  // ritorna gli account con uid, solo il POST iniziale li dà.
  const pending = await prisma.pendingPsd2Session.findFirst({
    where: { id: pendingId, userId },
  });

  if (!pending) {
    return (
      <div className="panel p-6">
        <h1 className="text-lg font-semibold mb-2">Sessione non trovata</h1>
        <p className="text-sm text-sub mb-4">
          La sessione di abbinamento non esiste o non appartiene a questo
          utente. Rifai il consenso dalla pagina banche.
        </p>
        <Link href="/impostazioni/banche" className="btn">
          Torna alle banche
        </Link>
      </div>
    );
  }
  if (pending.expiresAt < new Date()) {
    return (
      <div className="panel p-6">
        <h1 className="text-lg font-semibold mb-2">Sessione scaduta</h1>
        <p className="text-sm text-sub mb-4">
          La sessione di abbinamento è scaduta (durata massima 1 ora dal
          consenso). Rifai il consenso dalla pagina banche.
        </p>
        <Link href="/impostazioni/banche" className="btn">
          Torna alle banche
        </Link>
      </div>
    );
  }

  let session: EbSession;
  try {
    session = JSON.parse(pending.payload) as EbSession;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      <div className="panel p-6">
        <h1 className="text-lg font-semibold mb-2">
          Payload sessione corrotto
        </h1>
        <pre className="text-xs bg-bg p-3 rounded border border-line overflow-auto mb-4">
          {msg}
        </pre>
        <Link href="/impostazioni/banche" className="btn">
          Torna alle banche
        </Link>
      </div>
    );
  }
  const suggestedBankAccountId = pending.suggestedBankAccountId;

  const ebAccounts = session.accounts ?? [];
  if (ebAccounts.length === 0) {
    return (
      <div className="panel p-6">
        <h1 className="text-lg font-semibold mb-2">
          Nessun account ritornato dalla banca
        </h1>
        <p className="text-sm text-sub mb-4">
          La sessione è autorizzata ma non contiene conti accessibili. In
          modalità production restricted ricordati di whitelistare l&apos;IBAN
          sul control panel di Enable Banking.
        </p>
        <Link href="/impostazioni/banche" className="btn">
          Torna alle banche
        </Link>
      </div>
    );
  }

  // Carica i BankAccount dell'Holder attivo come candidati per il matching
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { holderId: holder.id },
    select: {
      id: true,
      name: true,
      type: true,
      iban: true,
      cardMaskedPan: true,
    },
    orderBy: { name: "asc" },
  });
  const candidates: BankAccountCandidate[] = bankAccounts.map((b) => ({
    id: b.id,
    name: b.name,
    type: b.type,
    iban: b.iban,
    cardMaskedPan: b.cardMaskedPan,
  }));

  // BankConnection esistenti: evidenziamo se l'account EB era già collegato
  // a una connection viva, così la UI può mostrare "questo conto è già
  // collegato a X — riconnessione".
  const existingConns = await prisma.bankConnection.findMany({
    where: {
      provider: "enable_banking",
      providerAccountId: { in: ebAccounts.map((a) => a.uid) },
    },
    select: {
      providerAccountId: true,
      bankAccountId: true,
      bankAccount: { select: { name: true } },
    },
  });
  const existingByUid = new Map(
    existingConns.map((c) => [
      c.providerAccountId,
      { bankAccountId: c.bankAccountId, bankAccountName: c.bankAccount.name },
    ]),
  );

  // Per ogni account EB calcola il match + estrae identificativi + suggerisce
  // un default per il form "codifica nuovo conto".
  const rows: AccountRow[] = ebAccounts.map((acc) => {
    const ids = extractIdentifiers(acc as never);
    const match = matchProviderAccount(acc as never, candidates);
    const existing = existingByUid.get(acc.uid);

    // Default action:
    //  - se c'era già una connection esistente per questo providerUid → link
    //    al suo BankAccount (riconnessione dopo expire)
    //  - se match perfect via IBAN o last4 PAN → link al matched
    //  - se l'utente aveva avviato il flow da un BankAccount specifico e
    //    è l'unico account ritornato → link al suggerito
    //  - se non c'è alcun match automatico MA ci sono candidati in anagrafica
    //    → default "link" con bankAccountId vuoto. Forza l'utente a scegliere
    //    esplicitamente tra "collega a uno di questi" o "codifica nuovo".
    //    Il submit valida che bankAccountId sia valorizzato, quindi non si
    //    può procedere senza una scelta consapevole.
    //  - se non ci sono candidati in anagrafica (Holder appena creato) →
    //    "create" come unica scelta sensata, ma l'utente può sempre passare
    //    a "skip" se preferisce.
    let defaultAction: "link" | "create" | "skip";
    let defaultBankAccountId: string | null = null;
    let defaultReason = match.reason;

    if (existing) {
      defaultAction = "link";
      defaultBankAccountId = existing.bankAccountId;
      defaultReason = `Riconnessione: già collegato a "${existing.bankAccountName}"`;
    } else if (match.confidence === "perfect" && match.matchedBankAccountId) {
      defaultAction = "link";
      defaultBankAccountId = match.matchedBankAccountId;
    } else if (
      ebAccounts.length === 1 &&
      suggestedBankAccountId &&
      candidates.some((c) => c.id === suggestedBankAccountId)
    ) {
      defaultAction = "link";
      defaultBankAccountId = suggestedBankAccountId;
      defaultReason = "Conto scelto all'avvio del collegamento";
    } else if (candidates.length > 0) {
      // Nessun match automatico ma ci sono conti in anagrafica:
      // proponi "link" con dropdown aperta. L'utente sceglie esplicitamente
      // se collegare a un conto esistente o passare a "codifica nuovo".
      defaultAction = "link";
      defaultBankAccountId = null;
      defaultReason =
        match.reason +
        " — scegli un conto in anagrafica oppure passa a \"codifica nuovo conto\".";
    } else {
      // Anagrafica vuota: l'unica strada è creare un nuovo BankAccount.
      defaultAction = "create";
      defaultReason =
        "Nessun conto in anagrafica. Codifica un nuovo conto con i dati ritornati dalla banca.";
    }

    return {
      providerUid: acc.uid,
      product: acc.product ?? null,
      details: acc.details ?? null,
      cashAccountType: acc.cash_account_type ?? null,
      currency: acc.currency,
      creditLimit:
        // SessionAccount type non include credit_limit ma il payload reale sì
        // (lo cattura Partial<SessionAccount> + as any). Lo leggiamo difensivamente.
        (acc as unknown as { credit_limit?: { amount: string; currency: string } })
          .credit_limit?.amount ?? null,
      detectedIban: ids.iban,
      detectedPan: ids.pan,
      defaultAction,
      defaultBankAccountId,
      defaultReason,
      suggestedNewName: suggestAccountName(acc as never, session.aspsp?.name),
      suggestedNewType: suggestAccountType(acc as never),
      wasAlreadyLinkedTo: existing?.bankAccountName ?? null,
    };
  });

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs text-sub">
          <Link href="/impostazioni/banche" className="hover:underline">
            Impostazioni / Banche
          </Link>{" "}
          / Abbinamento
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          Abbina i conti ritornati da {session.aspsp?.name ?? "la banca"}
        </h1>
        <p className="text-sm text-sub mt-1">
          {ebAccounts.length === 1
            ? "Conferma il conto a cui associare i movimenti."
            : `La banca ha ritornato ${ebAccounts.length} conti. Scegli, per ognuno, cosa farne.`}
        </p>
      </div>

      <AbbinamentoClient
        pendingId={pending.id}
        aspspName={session.aspsp?.name ?? "—"}
        rows={rows}
        candidates={candidates}
      />
    </div>
  );
}
