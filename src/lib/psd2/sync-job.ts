/**
 * Lifecycle wrapper attorno a syncBankConnection.
 *
 * Razionale: vedi il commento sul modello SyncJob in schema.prisma.
 * In sintesi: la funzione esegue UN tentativo di sync su una BankConnection
 * sotto la copertura di un record SyncJob, gestendo gli stati e i conteggi.
 *
 * Punti di chiamata:
 *  - /api/psd2/match (dopo aver creato BankConnection+SyncJob) via after()
 *  - /api/cron/sync-jobs (retry orfani da timeout o pending)
 *  - manualmente da scripts CLI per debug
 *
 * Garanzie:
 *  - Idempotente nel senso che se chiamata due volte sullo stesso jobId in
 *    parallelo, la seconda invocazione vede status=running e si tira fuori
 *    (lock ottimistico via updateMany con where status=pending|error).
 *  - Mai throw: cattura tutte le eccezioni e le persiste in errorMessage.
 *    Questo perché la chiameremo da `after()` dove un throw non avrebbe
 *    visibilità per l'utente.
 *  - Se attemptCount>=2 forza opts.full=true: un retry da cron può essere
 *    successivo a un primo tentativo interrotto a metà che ha aggiornato
 *    lastSyncedTxDate parzialmente; per garantire copertura storica completa
 *    rifacciamo strategy=longest.
 */

import { prisma } from "@/lib/db";
import { syncBankConnection } from "@/lib/psd2/sync";

export type RunSyncJobResult =
  | {
      ok: true;
      jobId: string;
      imported: number;
      updated: number;
      healed: number;
      elapsedMs: number;
    }
  | {
      ok: false;
      jobId: string;
      reason: "already_running" | "not_found" | "connection_invalid" | "sync_error";
      errorMessage?: string;
    };

/**
 * Esegue il sync di una BankConnection sotto un SyncJob.
 *
 * Step:
 *  1) Lock ottimistico: prova a passare da pending/error → running
 *     (se è già running, esce con "already_running")
 *  2) Esegue syncBankConnection
 *  3) Su successo: status=done con conteggi
 *     Su errore: status=error con errorMessage
 *
 * Non lancia mai: tutti gli errori sono catturati e persisti nel record.
 */
export async function runSyncJob(jobId: string): Promise<RunSyncJobResult> {
  // Step 1: carica il job (per leggere bankConnectionId + attemptCount)
  const job = await prisma.syncJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      bankConnectionId: true,
      status: true,
      attemptCount: true,
    },
  });
  if (!job) {
    return { ok: false, jobId, reason: "not_found" };
  }

  // Step 2: lock ottimistico — solo se status era pending o error, lo
  // facciamo passare a running. Se è già running o done, ci tiriamo fuori.
  const locked = await prisma.syncJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["pending", "error"] },
    },
    data: {
      status: "running",
      startedAt: new Date(),
      attemptCount: { increment: 1 },
      errorMessage: null,
    },
  });

  if (locked.count === 0) {
    // Qualcun altro l'ha già preso (race condition cron+after, o già done)
    return { ok: false, jobId, reason: "already_running" };
  }

  // Numero del tentativo CORRENTE (post increment)
  const currentAttempt = job.attemptCount + 1;

  // Step 3: verifica BankConnection
  const conn = await prisma.bankConnection.findUnique({
    where: { id: job.bankConnectionId },
    select: { id: true, status: true },
  });
  if (!conn) {
    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: "error",
        errorMessage: "BankConnection non trovata",
        finishedAt: new Date(),
      },
    });
    return { ok: false, jobId, reason: "connection_invalid" };
  }
  if (conn.status === "expired" || conn.status === "revoked") {
    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: "error",
        errorMessage: `BankConnection in stato ${conn.status} — serve rifare consenso`,
        finishedAt: new Date(),
      },
    });
    return { ok: false, jobId, reason: "connection_invalid" };
  }

  // Step 4: esegui il sync.
  // Se è un retry (attemptCount > 1), forza strategy=longest così non
  // perdiamo storico nel caso il precedente tentativo si fosse interrotto
  // dopo aver scritto solo alcune tx e aggiornato lastSyncedTxDate parzialmente.
  try {
    const stats = await syncBankConnection(prisma, job.bankConnectionId, {
      full: currentAttempt > 1,
    });

    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        finishedAt: new Date(),
        importedCount: stats.txInserted,
        updatedCount: stats.txUpdated,
        healedCount: stats.txHealed,
        errorMessage: null,
      },
    });

    return {
      ok: true,
      jobId,
      imported: stats.txInserted,
      updated: stats.txUpdated,
      healed: stats.txHealed,
      elapsedMs: stats.elapsedMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Backoff: prossimo retry da cron tra (2 ** attempt) minuti, max 30
    const backoffMin = Math.min(30, Math.pow(2, currentAttempt));
    const nextRunAt = new Date(Date.now() + backoffMin * 60 * 1000);

    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: "error",
        finishedAt: new Date(),
        errorMessage: msg.slice(0, 1000),
        nextRunAt,
      },
    });
    return { ok: false, jobId, reason: "sync_error", errorMessage: msg };
  }
}

/**
 * Crea un SyncJob in stato pending per una BankConnection.
 * Helper usato da /api/psd2/match dopo aver creato/aggiornato la BankConnection.
 */
export async function createPendingSyncJob(
  bankConnectionId: string,
): Promise<{ id: string }> {
  return prisma.syncJob.create({
    data: {
      bankConnectionId,
      status: "pending",
    },
    select: { id: true },
  });
}
