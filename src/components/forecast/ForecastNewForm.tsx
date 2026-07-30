"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createForecast } from "@/app/(app)/forecast/actions";

const MONTHS_LABEL = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];

export function ForecastNewForm({
  yearOptions,
  initialYear,
  initialActualMonths,
  monthsWithTx,
}: {
  yearOptions: number[];
  initialYear: number;
  initialActualMonths: number[];
  monthsWithTx: number[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(`Forecast ${initialYear}`);
  const [year, setYear] = useState(initialYear);
  const [notes, setNotes] = useState("");
  const [actualMonths, setActualMonths] = useState<Set<number>>(
    new Set(initialActualMonths),
  );

  const toggleMonth = (m: number) => {
    setActualMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const setAll = (consuntivo: boolean) => {
    if (consuntivo) setActualMonths(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    else setActualMonths(new Set());
  };

  const setUntilCurrentMonth = () => {
    const now = new Date();
    const cap = year === now.getFullYear() ? now.getMonth() + 1 : year < now.getFullYear() ? 12 : 0;
    const next = new Set<number>();
    for (let m = 1; m <= cap; m++) next.add(m);
    setActualMonths(next);
  };

  const setOnlyMonthsWithTx = () => {
    setActualMonths(new Set(monthsWithTx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createForecast({
        name,
        year,
        actualMonths: Array.from(actualMonths),
        notes: notes || undefined,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        router.push(`/forecast/${res.id}`);
      }
    });
  };

  const budgetCount = 12 - actualMonths.size;

  return (
    <form onSubmit={handleSubmit} className="panel p-5 space-y-4">
      <Field label="Nome scenario">
        <input
          type="text"
          required
          maxLength={80}
          className="input w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Es. Forecast 2026 base"
        />
      </Field>

      <Field label="Anno">
        <select
          className="input w-full"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-2">
          Mesi consuntivo
        </div>
        <div className="text-xs text-sub mb-2">
          Spunta i mesi che vuoi considerare come <strong>consuntivo</strong> (totale
          reale dei movimenti). I mesi non spuntati sono <strong>budget</strong>: in
          questi puoi modificare gli importi nello scenario.
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <button type="button" onClick={() => setAll(true)} className="btn-ghost !h-7 !text-[11px]">
            Tutti consuntivo
          </button>
          <button type="button" onClick={() => setAll(false)} className="btn-ghost !h-7 !text-[11px]">
            Nessuno
          </button>
          <button
            type="button"
            onClick={setUntilCurrentMonth}
            className="btn-ghost !h-7 !text-[11px]"
          >
            Fino a mese corrente
          </button>
          <button
            type="button"
            onClick={setOnlyMonthsWithTx}
            className="btn-ghost !h-7 !text-[11px]"
            disabled={monthsWithTx.length === 0}
            title={
              monthsWithTx.length === 0
                ? "Nessun movimento nell'anno scelto"
                : "Solo mesi con almeno un movimento"
            }
          >
            Solo con movimenti
          </button>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {MONTHS_LABEL.map((label, i) => {
            const m = i + 1;
            const checked = actualMonths.has(m);
            const hasTx = monthsWithTx.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleMonth(m)}
                className={`relative h-12 rounded-md border text-xs font-medium transition flex flex-col items-center justify-center ${
                  checked
                    ? "bg-brand-50 border-brand-500 text-brand-600"
                    : "bg-white border-line text-sub hover:bg-bg"
                }`}
              >
                <span>{label}</span>
                <span
                  className={`text-[10px] mt-0.5 ${
                    checked ? "text-brand-600" : "text-sub"
                  }`}
                >
                  {checked ? "Consuntivo" : "Budget"}
                </span>
                {!hasTx && (
                  <span
                    className="absolute top-1 right-1.5 text-[9px] text-sub"
                    title="Nessun movimento in questo mese"
                  >
                    ∅
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-sub mt-3">
          {actualMonths.size} mesi consuntivo · {budgetCount} mesi budget editabile
        </div>
      </div>

      <Field label="Note (opzionale)">
        <textarea
          maxLength={500}
          className="input w-full !h-auto"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Es. Scenario base con piano di risparmio standard"
        />
      </Field>

      {error && (
        <div className="text-xs px-3 py-2 rounded-md bg-err-50 text-err-600 border border-err-100">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <a href="/forecast" className="btn-ghost">
          Annulla
        </a>
        <button type="submit" disabled={pending} className="btn">
          {pending ? "Creazione…" : "Crea scenario"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}
