/**
 * Poller dei SyncJob in corso.
 *
 * Quando l'utente arriva su /impostazioni/banche dopo aver appena confermato
 * un abbinamento PSD2, la URL contiene `?jobs=id1,id2,...`. Questo componente
 * legge quegli ID e fa polling su GET /api/psd2/sync-status ogni 3s, mostrando
 * un banner in cima con il progresso (X di Y conti sincronizzati, conteggi
 * importati/aggiornati). Quando tutti i job sono terminati (done/error) ferma
 * il polling e fa router.refresh() per riallineare la tabella delle banche.
 *
 * Il banner ha:
 *  - Spinner + stato globale (X/Y completati)
 *  - Una riga per BankAccount con stato per-job e conteggi
 *  - Auto-hide 8s dopo che tutti i job sono "done" senza errori e senza
 *    nuove transazioni; resta visibile finché ci sono errori o transazioni
 *    nuove da segnalare.
 */

"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

type JobStatus = {
  id: string;
  status: "pending" | "running" | "done" | "error";
  importedCount: number;
  updatedCount: number;
  healedCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attemptCount: number;
  bankAccountId: string;
  bankAccountName: string;
  aspspName: string;
};

const POLL_INTERVAL_MS = 3000;
const AUTO_HIDE_AFTER_DONE_MS = 8000;

export function SyncJobsPoller({ jobIds }: { jobIds: string[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const refreshedOnceRef = useRef(false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (jobIds.length === 0) return;

    let cancelled = false;
    const allDone = (xs: JobStatus[]) =>
      xs.length === jobIds.length &&
      xs.every((j) => j.status === "done" || j.status === "error");

    async function poll() {
      try {
        const res = await fetch(
          `/api/psd2/sync-status?jobs=${encodeURIComponent(jobIds.join(","))}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean; jobs: JobStatus[] };
        if (cancelled || !data.ok) return;
        setJobs(data.jobs);
        if (allDone(data.jobs)) {
          // Riallinea la tabella delle banche con i nuovi conteggi.
          if (!refreshedOnceRef.current) {
            refreshedOnceRef.current = true;
            router.refresh();
          }
          // Auto-hide se tutto bene; resta visibile se ci sono errori.
          const hasError = data.jobs.some((j) => j.status === "error");
          if (!hasError) {
            if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
            autoHideTimerRef.current = setTimeout(
              () => setDismissed(true),
              AUTO_HIDE_AFTER_DONE_MS,
            );
          }
        }
      } catch {
        // Ignora: ritenteremo al prossimo tick
      }
    }

    poll();
    const interval = setInterval(() => {
      // Smetti di pollare se tutti i job sono già done/error.
      setJobs((current) => {
        if (current.length === jobIds.length && current.every((j) => j.status === "done" || j.status === "error")) {
          return current;
        }
        poll();
        return current;
      });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, [jobIds, router]);

  if (jobIds.length === 0 || dismissed) return null;

  const allLoaded = jobs.length === jobIds.length;
  const doneCount = jobs.filter((j) => j.status === "done").length;
  const errorCount = jobs.filter((j) => j.status === "error").length;
  const runningCount = jobs.filter((j) => j.status === "running").length;
  const pendingCount = jobs.filter((j) => j.status === "pending").length;
  const totalImported = jobs.reduce((s, j) => s + j.importedCount, 0);
  const totalUpdated = jobs.reduce((s, j) => s + j.updatedCount, 0);
  const isComplete = allLoaded && runningCount === 0 && pendingCount === 0;

  return (
    <div
      className={`mb-4 panel p-3 text-sm border ${
        errorCount > 0
          ? "border-red-300 bg-red-50"
          : isComplete
            ? "border-green-300 bg-green-50"
            : "border-blue-300 bg-blue-50"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-medium">
          {!isComplete && <Spinner />}
          {isComplete && errorCount === 0 && <span className="text-green-700">✓</span>}
          {isComplete && errorCount > 0 && <span className="text-red-700">⚠</span>}
          <span>
            {!isComplete
              ? `Sincronizzazione in corso (${doneCount + errorCount}/${jobIds.length})`
              : errorCount === 0
                ? `Sincronizzazione completata — ${totalImported} movimenti importati${totalUpdated > 0 ? `, ${totalUpdated} aggiornati` : ""}`
                : `Sincronizzazione terminata con ${errorCount} ${errorCount === 1 ? "errore" : "errori"}`}
          </span>
        </div>
        <button
          type="button"
          className="text-xs text-sub hover:text-ink"
          onClick={() => setDismissed(true)}
          aria-label="Chiudi"
        >
          ✕
        </button>
      </div>

      {jobs.length > 0 && (
        <div className="mt-2 space-y-1 text-xs">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <b>{j.bankAccountName}</b>
                <span className="text-sub"> · {j.aspspName}</span>
              </span>
              <span className="text-sub whitespace-nowrap">
                {j.status === "pending" && "in coda…"}
                {j.status === "running" && (
                  <>
                    in corso
                    {j.attemptCount > 1 ? ` (tentativo ${j.attemptCount})` : ""}
                  </>
                )}
                {j.status === "done" && (
                  <>
                    {j.importedCount > 0 || j.updatedCount > 0
                      ? `${j.importedCount} importati${j.updatedCount > 0 ? `, ${j.updatedCount} aggiornati` : ""}`
                      : "nessuna nuova"}
                  </>
                )}
                {j.status === "error" && (
                  <span
                    className="text-red-700"
                    title={j.errorMessage ?? undefined}
                  >
                    ✗ errore
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"
      aria-hidden
    />
  );
}
