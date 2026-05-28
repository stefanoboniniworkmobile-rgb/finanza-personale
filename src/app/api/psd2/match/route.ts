/**
 * POST /api/psd2/match
 *
 * Riceve le scelte di abbinamento dalla pagina /impostazioni/banche/abbinamento.
 * Per ogni account ritornato da Enable Banking (identificato da providerUid),
 * l'utente ha scelto una delle tre azioni:
 *  - "link"   → collega l'account a un BankAccount esistente in anagrafica
 *  - "create" → crea un nuovo BankAccount con i dati forniti e collegacelo
 *  - "skip"   → ignora questo account (non viene creata BankConnection)
 *
 * Effetti:
 *  - Crea/aggiorna le BankConnection corrispondenti (una per ogni link/create).
 *    Tutte condivideranno lo stesso sessionId EB.
 *  - Crea un SyncJob pending per ogni BankConnection nuova/riattivata.
 *  - Dopo aver inviato la response, lancia runSyncJob in background per ogni
 *    SyncJob creato usando `after()` di Next 15. Il sync NON blocca la response.
 *
 * Risposta:
 *  { ok: true, jobIds: string[], connIds: string[] }
 *  oppure
 *  { ok: false, error: string }
 *
 * Sicurezza:
 *  - Auth check
 *  - Tutti i bankAccountId forniti devono appartenere all'Holder attivo
 *  - I newAccount sono creati nell'Holder attivo
 *  - La session EB viene riletta lato server (non ci fidiamo del payload client)
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import type { Session as EbSession } from "@/lib/psd2/enable-banking";
import { runSyncJob } from "@/lib/psd2/sync-job";
import { extractIdentifiers } from "@/lib/psd2/match";

const ACCOUNT_TYPES = ["liquidity", "credit_card", "savings", "cash"] as const;
const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

const newAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  initialBalance: z.coerce.number().min(-1_000_000).max(10_000_000),
  iban: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => v === "" || IBAN_RE.test(v))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  cardMaskedPan: z.string().trim().max(25).nullable().optional(),
});

const mappingSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("link"),
    providerUid: z.string().min(1),
    bankAccountId: z.string().min(1),
  }),
  z.object({
    action: z.literal("create"),
    providerUid: z.string().min(1),
    newAccount: newAccountSchema,
  }),
  z.object({
    action: z.literal("skip"),
    providerUid: z.string().min(1),
  }),
]);

const bodySchema = z.object({
  pendingId: z.string().min(1),
  mappings: z.array(mappingSchema).min(1).max(20),
});

export async function POST(req: NextRequest) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ ok: false, error: "Non autenticato" }, { status: 401 });
  }
  const userId = authSession.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON non valido" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Payload non valido" },
      { status: 400 },
    );
  }
  const { pendingId, mappings } = parsed.data;

  // Holder attivo dell'utente: tutti i bankAccount referenziati devono appartenervi
  // e i nuovi BankAccount vengono creati qui.
  const holder = await getActiveHolder(userId);
  const holderId = holder.id;

  // Carica la PendingPsd2Session (payload congelato dal callback).
  // NON rileggiamo da EB: getSession non ritorna gli account con uid.
  const pending = await prisma.pendingPsd2Session.findFirst({
    where: { id: pendingId, userId },
  });
  if (!pending) {
    return NextResponse.json(
      { ok: false, error: "Sessione di abbinamento non trovata o scaduta" },
      { status: 404 },
    );
  }
  if (pending.expiresAt < new Date()) {
    return NextResponse.json(
      { ok: false, error: "Sessione di abbinamento scaduta — rifai il consenso" },
      { status: 410 },
    );
  }

  let session: EbSession;
  try {
    session = JSON.parse(pending.payload) as EbSession;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Payload sessione corrotto: ${msg}` },
      { status: 500 },
    );
  }
  const ebAccounts = session.accounts ?? [];
  const ebByUid = new Map(ebAccounts.map((a) => [a.uid, a]));

  // Verifica che ogni providerUid nei mappings esista davvero nella sessione
  for (const m of mappings) {
    if (!ebByUid.has(m.providerUid)) {
      return NextResponse.json(
        { ok: false, error: `providerUid sconosciuto: ${m.providerUid}` },
        { status: 400 },
      );
    }
  }

  // Verifica ownership di tutti i bankAccountId in azione "link"
  const linkIds = mappings
    .filter((m): m is Extract<typeof m, { action: "link" }> => m.action === "link")
    .map((m) => m.bankAccountId);
  if (linkIds.length > 0) {
    const owned = await prisma.bankAccount.findMany({
      where: { id: { in: linkIds }, holderId },
      select: { id: true },
    });
    if (owned.length !== new Set(linkIds).size) {
      return NextResponse.json(
        { ok: false, error: "Uno o più conti non appartengono all'intestatario attivo" },
        { status: 403 },
      );
    }
  }

  // Esegui le scritture in transazione. Per ogni link/create, creiamo (o
  // aggiorniamo via upsert sulla unique [provider, providerAccountId]) la
  // BankConnection e un SyncJob pending.
  const validUntil = new Date(session.access?.valid_until ?? Date.now());
  const aspspName = session.aspsp?.name ?? "Unknown";
  const aspspCountry = session.aspsp?.country ?? "IT";

  type CreatedJob = { jobId: string; connId: string; bankAccountName: string };
  let created: CreatedJob[];
  try {
    created = await prisma.$transaction(async (tx) => {
      const out: CreatedJob[] = [];
      for (const m of mappings) {
        if (m.action === "skip") continue;
        const ebAcc = ebByUid.get(m.providerUid)!;

        // Determina bankAccountId di destinazione: link → esistente, create → nuovo
        let bankAccountId: string;
        let bankAccountName: string;

        if (m.action === "link") {
          bankAccountId = m.bankAccountId;
          const ba = await tx.bankAccount.findUnique({
            where: { id: bankAccountId },
            select: { name: true, iban: true, cardMaskedPan: true },
          });
          bankAccountName = ba?.name ?? "—";

          // Se il BankAccount in anagrafica non ha ancora IBAN o cardMaskedPan
          // ma EB ce li ha forniti, li salviamo per match futuri.
          const ids = extractIdentifiers(ebAcc as never);
          const dataToFill: { iban?: string; cardMaskedPan?: string } = {};
          if (!ba?.iban && ids.iban) dataToFill.iban = ids.iban;
          if (!ba?.cardMaskedPan && ids.pan) dataToFill.cardMaskedPan = ids.pan;
          if (Object.keys(dataToFill).length > 0) {
            await tx.bankAccount.update({
              where: { id: bankAccountId },
              data: dataToFill,
            });
          }
        } else {
          // create
          const created = await tx.bankAccount.create({
            data: {
              holderId,
              name: m.newAccount.name,
              type: m.newAccount.type,
              initialBalance: m.newAccount.initialBalance,
              iban: m.newAccount.iban ?? null,
              cardMaskedPan: m.newAccount.cardMaskedPan ?? null,
            },
            select: { id: true, name: true },
          });
          bankAccountId = created.id;
          bankAccountName = created.name;
        }

        // Upsert BankConnection. La unique constraint è su (provider, providerAccountId);
        // se esisteva già una connection (es. riconnessione dopo expire) la aggiorniamo.
        const existing = await tx.bankConnection.findUnique({
          where: {
            provider_providerAccountId: {
              provider: "enable_banking",
              providerAccountId: ebAcc.uid,
            },
          },
        });

        let connId: string;
        if (existing) {
          const updated = await tx.bankConnection.update({
            where: { id: existing.id },
            data: {
              holderId,
              bankAccountId,
              aspspName,
              aspspCountry,
              sessionId: session.session_id,
              validUntil,
              status: "active",
              errorMessage: null,
            },
            select: { id: true },
          });
          connId = updated.id;
        } else {
          const inserted = await tx.bankConnection.create({
            data: {
              holderId,
              bankAccountId,
              provider: "enable_banking",
              aspspName,
              aspspCountry,
              sessionId: session.session_id,
              providerAccountId: ebAcc.uid,
              validUntil,
              status: "active",
            },
            select: { id: true },
          });
          connId = inserted.id;
        }

        const job = await tx.syncJob.create({
          data: { bankConnectionId: connId, status: "pending" },
          select: { id: true },
        });

        out.push({ jobId: job.id, connId, bankAccountName });
      }
      // Cleanup: la pending session è stata "consumata", non serve più.
      // Se l'utente rifa il flow EB genera un nuovo session_id, quindi anche
      // se questa restasse non causerebbe collisioni — ma è bene tenere
      // pulita la tabella.
      await tx.pendingPsd2Session.deleteMany({ where: { id: pendingId } });
      return out;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Errore salvataggio: ${msg}` },
      { status: 500 },
    );
  }

  // Dopo la response, lancia in background tutti i sync. `after()` di Next 15
  // esegue la callback DOPO che la response è stata inviata al client. La
  // function serverless continua a girare nel budget residuo, e in dev
  // semplicemente esegue inline dopo response (nessun limite).
  after(async () => {
    for (const c of created) {
      try {
        const res = await runSyncJob(c.jobId);
        console.log("[after sync]", c.jobId, res);
      } catch (e) {
        console.error("[after sync] errore inatteso:", c.jobId, e);
      }
    }
  });

  return NextResponse.json({
    ok: true,
    jobIds: created.map((c) => c.jobId),
    connIds: created.map((c) => c.connId),
  });
}
