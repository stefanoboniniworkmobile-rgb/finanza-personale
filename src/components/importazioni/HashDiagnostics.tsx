"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recomputeAllHashes } from "@/app/(app)/importazioni/actions";

export function HashDiagnostics({
  totalTransactions,
  withHash,
}: {
  totalTransactions: number;
  withHash: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const missing = totalTransactions - withHash;

  const onRecompute = () => {
    if (!confirm(`Ricalcolare l'hash di tutti i ${totalTransactions} movimenti? Operazione idempotente.`)) {
      return;
    }
    setResult(null);
    startTransition(async () => {
      const r = await recomputeAllHashes();
      if (!r.ok) {
        setResult("Errore: " + r.error);
        return;
      }
      setResult(`Ricalcolati ${r.updated} hash.`);
      router.refresh();
    });
  };

  return (
    <div className="panel p-4 mb-4 text-sm space-y-2">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="font-semibold">Controllo duplicati — stato archivio</div>
          <div className="text-[12px] text-sub mt-0.5">
            L&apos;hash è il marcatore usato per riconoscere i movimenti già presenti negli import
            futuri. Movimenti senza hash non vengono confrontati.
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={onRecompute}
          disabled={pending}
        >
          {pending ? "Ricalcolo…" : "Ricalcola tutti gli hash"}
        </button>
      </div>
      <div className="flex items-center gap-4 text-[12px] num-mono">
        <span>
          Movimenti totali: <strong className="num">{totalTransactions}</strong>
        </span>
        <span>
          Con hash: <strong className="num text-ok-600">{withHash}</strong>
        </span>
        <span>
          Senza hash:{" "}
          <strong className={`num ${missing > 0 ? "text-amber-600" : "text-sub"}`}>
            {missing}
          </strong>
        </span>
      </div>
      {result && (
        <div className="text-[12px] px-2 py-1 rounded bg-ok-50 text-ok-600 border border-ok-100">
          {result}
        </div>
      )}
    </div>
  );
}
