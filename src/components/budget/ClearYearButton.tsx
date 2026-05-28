"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearAllOverridesForYear,
  setAllToZeroForYear,
} from "@/app/(app)/budget/actions";

export function ClearYearButton({ year }: { year: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Cancella gli override → i valori tornano a essere auto-calcolati dalle modalità
  const handleResetAuto = () => {
    if (
      !confirm(
        `Cancellare TUTTI gli override del ${year}?\n\n` +
          `I valori delle celle torneranno a essere quelli calcolati in automatico ` +
          `dalla modalità di ogni categoria. L'azione è irreversibile.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await clearAllOverridesForYear(year);
      router.refresh();
      if (res.ok) {
        alert(
          res.deleted === 0
            ? "Nessun override da cancellare per questo anno."
            : `Cancellati ${res.deleted} override del ${year}. Valori tornati ad auto.`,
        );
      }
    });
  };

  // Imposta a 0 ogni cella del budget per l'anno (override = 0)
  const handleZeroAll = () => {
    if (
      !confirm(
        `Azzerare a 0 € TUTTE le celle del budget ${year}?\n\n` +
          `Ogni categoria con budget attivo avrà 0 € di tetto per ogni mese ` +
          `dell'anno. Sostituirà eventuali override esistenti. Irreversibile.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await setAllToZeroForYear(year);
      router.refresh();
      if (res.ok) {
        alert(
          res.cellsTouched === 0
            ? "Nessuna categoria con budget attivo: nulla da azzerare."
            : `Azzerate ${res.cellsTouched} celle del ${year}.`,
        );
      }
    });
  };

  return (
    <div className="inline-flex gap-1">
      <button
        type="button"
        onClick={handleResetAuto}
        disabled={pending}
        className="btn-ghost !h-8 !text-xs"
        title={`Cancella tutti gli override del ${year} — torna ai valori auto-calcolati dalle modalità`}
      >
        {pending ? "Lavoro…" : `Reset auto ${year}`}
      </button>
      <button
        type="button"
        onClick={handleZeroAll}
        disabled={pending}
        className="btn-ghost !h-8 !text-xs !text-err-600 hover:!bg-err-50"
        title={`Mette a 0 € ogni cella del budget per il ${year}`}
      >
        Azzera {year}
      </button>
    </div>
  );
}
