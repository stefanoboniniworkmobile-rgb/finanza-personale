"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import {
  startAuth,
  deleteSession,
  listAspsps,
  getAccountBalances,
  type Aspsp,
} from "@/lib/psd2/enable-banking";
import { syncBankConnection, type PreviewTx } from "@/lib/psd2/sync";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  return session.user.id;
}

/**
 * Determina la base URL pubblica (https) usata come redirect_url verso Enable Banking.
 *
 * In dev: https://localhost:3000 (cert self-signed via mkcert).
 * In prod: NEXT_PUBLIC_APP_URL (es. https://finanza.tuodominio.it).
 */
function getCallbackUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://localhost:3000";
  return `${base}/api/psd2/callback`;
}

/**
 * Codifica nello `state` PSD2 le info di context che ci servono al callback:
 *  - bankAccountId locale a cui associare la connection
 *  - userId (per safety, anche se la sessione cookie dovrebbe coprirci)
 *
 * Formato: base64url di JSON. Decodifica in /api/psd2/callback.
 */
function encodeState(payload: { bankAccountId: string; userId: string }): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf-8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// ============================================================
// SYNC: forza un sync della BankConnection (manuale, da UI)
// ============================================================
export async function syncBankConnectionAction(
  bankConnectionId: string,
  opts?: {
    full?: boolean;
    from?: string;
    to?: string;
    /**
     * Lista di providerEntryRef (= PreviewTx.id) selezionati dall'utente
     * nel preview. Se presente, solo queste tx verranno effettivamente
     * importate; le altre saltate. Se omesso, vengono importate tutte.
     */
    selectedIds?: string[];
    /**
     * ID di tx manuali (bankConnectionId=NULL) che l'utente ha scelto di
     * "sostituire" con la versione PSD2 importata. Dopo che il sync è
     * andato a buon fine, queste vengono cancellate. Safety:
     *  - solo tx dell'Holder attivo
     *  - solo tx con bankConnectionId NULL (mai cancello tx PSD2)
     */
    replaceManualTxIds?: string[];
  },
): Promise<ActionResult<{
  inserted: number;
  updated: number;
  skipped: number;
  healed: number;
  manualReplaced: number;
  range: { min: string; max: string } | null;
}>> {
  const userId = await requireUserId();
  const active = await getActiveHolder(userId);

  const conn = await prisma.bankConnection.findFirst({
    where: { id: bankConnectionId, holderId: active.id },
  });
  if (!conn) return { ok: false, error: "Connessione non trovata" };

  try {
    const stats = await syncBankConnection(prisma, conn.id, {
      full: opts?.full,
      from: opts?.from,
      to: opts?.to,
      selectedIds: opts?.selectedIds,
      psuHeaders: {
        "PSU-IP-Address": "127.0.0.1",
        "PSU-User-Agent": "Mozilla/5.0 (Finanza Personale UI sync)",
      },
    });

    // Replacements: cancella tx manuali selezionate per la sostituzione
    let manualReplaced = 0;
    if (opts?.replaceManualTxIds && opts.replaceManualTxIds.length > 0) {
      // Safety: filtro su holderId attivo + bankConnectionId NULL (no PSD2)
      const eligible = await prisma.transaction.findMany({
        where: {
          id: { in: opts.replaceManualTxIds },
          holderId: active.id,
          bankConnectionId: null,
        },
        select: { id: true },
      });
      if (eligible.length > 0) {
        const eligibleIds = eligible.map((e) => e.id);
        const result = await prisma.transaction.deleteMany({
          where: { id: { in: eligibleIds } },
        });
        manualReplaced = result.count;
      }
    }

    revalidatePath("/impostazioni/banche");
    revalidatePath("/movimenti");
    revalidatePath("/dashboard");
    return {
      ok: true,
      data: {
        inserted: stats.txInserted,
        updated: stats.txUpdated,
        skipped: stats.txSkipped,
        healed: stats.txHealed,
        manualReplaced,
        range: stats.dateRangeReceived,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ============================================================
// PREVIEW SYNC: fetch+mapping SENZA scrivere in DB, ritorna lista per UI conferma
// ============================================================
export async function previewSyncAction(
  bankConnectionId: string,
  opts?: { full?: boolean; from?: string; to?: string },
): Promise<ActionResult<{
  preview: PreviewTx[];
  wouldInsert: number;
  wouldUpdate: number;
  wouldSkip: number;
  range: { min: string; max: string } | null;
  pagesFetched: number;
  elapsedMs: number;
}>> {
  const userId = await requireUserId();
  const active = await getActiveHolder(userId);

  const conn = await prisma.bankConnection.findFirst({
    where: { id: bankConnectionId, holderId: active.id },
  });
  if (!conn) return { ok: false, error: "Connessione non trovata" };

  try {
    const stats = await syncBankConnection(prisma, conn.id, {
      full: opts?.full,
      from: opts?.from,
      to: opts?.to,
      dryRun: true,
      psuHeaders: {
        "PSU-IP-Address": "127.0.0.1",
        "PSU-User-Agent": "Mozilla/5.0 (Finanza Personale preview)",
      },
    });
    return {
      ok: true,
      data: {
        preview: stats.preview,
        wouldInsert: stats.txInserted,
        wouldUpdate: stats.txUpdated,
        wouldSkip: stats.txSkipped,
        range: stats.dateRangeReceived,
        pagesFetched: stats.pagesFetched,
        elapsedMs: stats.elapsedMs,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ============================================================
// INITIATE: avvia il consent flow PSD2 verso Enable Banking
// ============================================================
const initiateSchema = z.object({
  aspspName: z.string().min(1),
  aspspCountry: z.string().default("IT"),
  bankAccountId: z.string().min(1),
});

export async function initiateBankConnectionFlow(
  raw: z.input<typeof initiateSchema>,
): Promise<ActionResult<{ url: string }>> {
  const userId = await requireUserId();
  const parse = initiateSchema.safeParse(raw);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;

  const active = await getActiveHolder(userId);
  // Verifica che il BankAccount appartenga all'Holder attivo
  const ba = await prisma.bankAccount.findFirst({
    where: { id: v.bankAccountId, holderId: active.id },
  });
  if (!ba) return { ok: false, error: "Conto non trovato per l'intestatario attivo" };

  // Validità: 179 giorni (sotto i 180 max PSD2, margine DST — vedi commento in scripts/test-eb-start-prod.ts)
  const validUntil = new Date(Date.now() + 179 * 24 * 60 * 60 * 1000);

  try {
    const res = await startAuth({
      aspsp: { name: v.aspspName, country: v.aspspCountry },
      psu_type: "personal",
      redirect_url: getCallbackUrl(),
      state: encodeState({ bankAccountId: v.bankAccountId, userId }),
      valid_until: validUntil,
      access: { balances: true, transactions: true },
      language: "it",
    });
    return { ok: true, data: { url: res.url } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ============================================================
// DELETE: revoca consenso lato provider + cancella la connessione dal DB.
// Le transazioni già importate restano nei movimenti (Transaction.bankConnectionId
// ha onDelete:SetNull, quindi perdono solo il legame ma non i dati).
// ============================================================
export async function deleteBankConnectionAction(
  bankConnectionId: string,
): Promise<ActionResult<{ txKept: number }>> {
  const userId = await requireUserId();
  const active = await getActiveHolder(userId);

  const conn = await prisma.bankConnection.findFirst({
    where: { id: bankConnectionId, holderId: active.id },
    include: { _count: { select: { transactions: true } } },
  });
  if (!conn) return { ok: false, error: "Connessione non trovata" };

  // Best-effort: revoca consenso lato Enable Banking (può fallire se già expired/revoked).
  // Non blocchiamo la cancellazione locale se la chiamata fallisce.
  try {
    await deleteSession(conn.sessionId);
  } catch (e) {
    console.warn(
      "[delete] deleteSession EB fallita (continuo a cancellare in DB):",
      e instanceof Error ? e.message : e,
    );
  }

  // Cancellazione hard. Le tx associate sopravvivono con bankConnectionId=NULL
  // (vedi onDelete:SetNull nello schema Prisma).
  await prisma.bankConnection.delete({ where: { id: conn.id } });

  revalidatePath("/impostazioni/banche");
  revalidatePath("/movimenti");
  return { ok: true, data: { txKept: conn._count.transactions } };
}

// ============================================================
// VERIFY BALANCE: scarica saldo da EB e confronta con saldo calcolato
// dai movimenti del BankAccount (initialBalance + Σ tx).
// ============================================================
export type BalanceCheck = {
  bankBalance: number; // saldo riportato dalla banca via EB
  bankBalanceType: string; // CLBD / OPBD / AVLB / ...
  bankBalanceCurrency: string;
  bankReferenceDate: string | null; // YYYY-MM-DD
  appBalance: number; // initialBalance + Σ tx in DB
  appInitialBalance: number;
  appTxCount: number;
  delta: number; // bank - app
  bankAccountName: string;
};

export async function verifyBankBalanceAction(
  bankConnectionId: string,
): Promise<ActionResult<BalanceCheck>> {
  const userId = await requireUserId();
  const active = await getActiveHolder(userId);

  const conn = await prisma.bankConnection.findFirst({
    where: { id: bankConnectionId, holderId: active.id },
    include: { bankAccount: true },
  });
  if (!conn) return { ok: false, error: "Connessione non trovata" };
  if (conn.status === "expired" || conn.status === "revoked") {
    return {
      ok: false,
      error: `Connessione in stato ${conn.status} — ricollegati prima di verificare il saldo`,
    };
  }

  try {
    // 1) Fetch saldi da EB
    const res = await getAccountBalances(conn.providerAccountId, {
      "PSU-IP-Address": "127.0.0.1",
      "PSU-User-Agent": "Mozilla/5.0 (Finanza Personale balance check)",
    });
    if (!res.balances || res.balances.length === 0) {
      return { ok: false, error: "Banca non ha restituito alcun saldo" };
    }

    // Priorità: CLBD > OPBD > CLAV > primo disponibile.
    // CLBD/OPBD sono i saldi BOOK, quelli che combaciano con i nostri tx
    // (escludono PDNG/disponibile/fido).
    const byType = (t: string) =>
      res.balances.find((b) => b.balance_type === t);
    const chosen =
      byType("CLBD") ?? byType("OPBD") ?? byType("CLAV") ?? res.balances[0];

    const bankBalance = Number(chosen.balance_amount.amount);
    if (!Number.isFinite(bankBalance)) {
      return { ok: false, error: "Saldo banca non parsabile" };
    }

    // 2) Calcola saldo dai movimenti
    const txs = await prisma.transaction.findMany({
      where: { bankAccountId: conn.bankAccountId },
      select: { amount: true, type: true },
    });
    const txSum = txs.reduce(
      (acc, t) => acc + (t.type === "income" ? t.amount : -t.amount),
      0,
    );
    const appBalance = conn.bankAccount.initialBalance + txSum;
    const rounded = (n: number) => Math.round(n * 100) / 100;

    return {
      ok: true,
      data: {
        bankBalance: rounded(bankBalance),
        bankBalanceType: chosen.balance_type,
        bankBalanceCurrency: chosen.balance_amount.currency,
        bankReferenceDate: chosen.reference_date ?? null,
        appBalance: rounded(appBalance),
        appInitialBalance: rounded(conn.bankAccount.initialBalance),
        appTxCount: txs.length,
        delta: rounded(bankBalance - appBalance),
        bankAccountName: conn.bankAccount.name,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ============================================================
// LIST ASPSPs: ritorna la lista delle banche IT supportate (per dropdown)
// ============================================================
export type AspspOption = {
  name: string;
  country: string;
  beta: boolean;
  maxConsentDays: number;
};

export async function listAspspsAction(
  country: string = "IT",
): Promise<ActionResult<AspspOption[]>> {
  // Anche se non tocca dati dell'utente, resta una server action pubblica che
  // consuma quota Enable Banking: va protetta come le altre di questo file.
  await requireUserId();

  try {
    const aspsps = await listAspsps(country);
    const filtered: AspspOption[] = aspsps
      // Solo banche che supportano PSU personal
      .filter((a: Aspsp) => a.psu_types?.includes("personal"))
      .map((a) => ({
        name: a.name,
        country: a.country,
        beta: a.beta ?? false,
        maxConsentDays: Math.round(a.maximum_consent_validity / 86400),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, data: filtered };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
