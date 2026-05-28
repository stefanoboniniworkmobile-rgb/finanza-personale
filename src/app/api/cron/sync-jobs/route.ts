/**
 * GET /api/cron/sync-jobs
 *
 * Endpoint cron Vercel: recupera i SyncJob orfani o pending e li rilancia
 * tramite runSyncJob. È il "guardiano" del sistema async — garantisce che
 * nessun job rimanga incastrato per sempre dopo, ad esempio, un timeout
 * della serverless function che ha tagliato a metà il primo tentativo.
 *
 * Autenticazione:
 *  - Vercel Cron invia automaticamente `Authorization: Bearer <CRON_SECRET>`
 *    dove CRON_SECRET è la env var settata nel progetto Vercel.
 *  - In dev (locale) non c'è cron: nessuno chiama questo endpoint.
 *    Se vuoi testare manualmente: `curl -H "Authorization: Bearer dev"
 *    http://localhost:3000/api/cron/sync-jobs` con CRON_SECRET=dev in .env.local.
 *
 * Cosa fa (in ordine):
 *  1) Cerca SyncJob status="running" con `updatedAt` precedente a 2 minuti fa.
 *     Sono orfani: la function che li stava eseguendo è stata killata. Li
 *     riporta a "pending" così possono essere ripresi.
 *  2) Cerca SyncJob status="pending" con nextRunAt nullo o nel passato.
 *     Li lancia tutti (uno alla volta, sequenziale per evitare di esaurire
 *     il budget serverless contemporaneamente). Massimo MAX_PER_RUN job
 *     per evitare di stare troppo tempo dentro la stessa invocazione cron.
 *
 * NOTA: per attivare il cron in produzione, aggiungi a vercel.json:
 *
 *   {
 *     "crons": [
 *       { "path": "/api/cron/sync-jobs", "schedule": "* /1 * * * *" }
 *     ]
 *   }
 *
 * (rimuovi lo spazio in `* /1`). Lo schedule è "ogni minuto". Vercel ammette
 * fino a 1 cron al minuto sul piano Pro; sul Hobby il minimo è ogni 24h
 * quindi questo cron non funzionerà sul piano gratuito.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runSyncJob } from "@/lib/psd2/sync-job";

const ORPHAN_THRESHOLD_MS = 2 * 60 * 1000; // 2 minuti
const MAX_PER_RUN = 5;

export async function GET(req: NextRequest) {
  // Autenticazione: o Bearer CRON_SECRET, o (in test locale) header X-Cron-Test
  // con la stessa stringa di CRON_SECRET. Niente CRON_SECRET → endpoint
  // disabilitato (così il deploy senza segreto non espone niente).
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET non configurato — endpoint disabilitato" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth !== expected) {
    return NextResponse.json(
      { ok: false, error: "Non autorizzato" },
      { status: 401 },
    );
  }

  const startTime = Date.now();
  const result = {
    orphansReset: 0,
    jobsRun: 0,
    successes: 0,
    failures: 0,
    skipped: 0,
    details: [] as Array<{ jobId: string; outcome: string }>,
  };

  // Step 1: reset orfani (running troppo a lungo)
  const orphanCutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);
  const resetResult = await prisma.syncJob.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: orphanCutoff },
    },
    data: {
      status: "pending",
      // errorMessage popolato così la UI sa cosa è successo se l'utente lo
      // visualizza nell'intervallo prima del re-run
      errorMessage: "Tentativo precedente interrotto (timeout function). Verrà ripreso.",
    },
  });
  result.orphansReset = resetResult.count;

  // Step 2: prendi job pending con nextRunAt nullo o nel passato
  const now = new Date();
  const pending = await prisma.syncJob.findMany({
    where: {
      status: "pending",
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN,
    select: { id: true },
  });

  for (const job of pending) {
    result.jobsRun++;
    try {
      const r = await runSyncJob(job.id);
      if (r.ok) {
        result.successes++;
        result.details.push({ jobId: job.id, outcome: "done" });
      } else {
        if (r.reason === "already_running") {
          result.skipped++;
          result.details.push({ jobId: job.id, outcome: "skipped (already_running)" });
        } else {
          result.failures++;
          result.details.push({
            jobId: job.id,
            outcome: `error (${r.reason}): ${r.errorMessage ?? ""}`,
          });
        }
      }
    } catch (err) {
      // runSyncJob non dovrebbe mai throwarere (cattura internamente)
      // ma per sicurezza
      result.failures++;
      result.details.push({
        jobId: job.id,
        outcome: `uncaught: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const elapsedMs = Date.now() - startTime;
  return NextResponse.json({ ok: true, ...result, elapsedMs });
}
