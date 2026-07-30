"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateForecastSettings, deleteForecast } from "@/app/(app)/forecast/actions";

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

export function ForecastSettingsButton({
  id,
  initialName,
  initialYear,
  initialActualMonths,
  initialNotes,
}: {
  id: string;
  initialName: string;
  initialYear: number;
  initialActualMonths: number[];
  initialNotes: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initialName);
  const [year, setYear] = useState(initialYear);
  const [notes, setNotes] = useState(initialNotes);
  const [actualMonths, setActualMonths] = useState<Set<number>>(
    new Set(initialActualMonths),
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setYear(initialYear);
      setNotes(initialNotes);
      setActualMonths(new Set(initialActualMonths));
      setError(null);
    }
  }, [open, initialName, initialYear, initialNotes, initialActualMonths]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateForecastSettings({
        id,
        name,
        year,
        actualMonths: Array.from(actualMonths),
        notes,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        router.refresh();
        setOpen(false);
      }
    });
  };

  const handleDelete = () => {
    if (!confirm(`Eliminare lo scenario "${initialName}"? Irreversibile.`)) return;
    startTransition(async () => {
      await deleteForecast(id);
      router.push("/forecast");
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost">
        ⚙ Impostazioni
      </button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false);
        }}
        className="rounded-lg border border-line shadow-2xl p-0 backdrop:bg-black/40 backdrop:backdrop-blur-sm"
        style={{ maxWidth: 520, width: "calc(100vw - 32px)" }}
      >
        <form onSubmit={handleSubmit} className="bg-white">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between">
            <div>
              <div className="font-semibold text-base">Impostazioni scenario</div>
              <div className="text-xs text-sub">Modifica nome, anno e split mesi</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sub hover:text-ink text-lg leading-none w-7 h-7 grid place-items-center"
              aria-label="Chiudi"
            >
              ×
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-1">
                Nome
              </div>
              <input
                type="text"
                required
                maxLength={80}
                className="input w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-1">
                Anno
              </div>
              <input
                type="number"
                className="input w-32 num-mono"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || initialYear)}
                min={1900}
                max={3000}
              />
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-2">
                Mesi consuntivo
              </div>
              <div className="flex gap-1.5 mb-2">
                <button
                  type="button"
                  onClick={() => setAll(true)}
                  className="btn-ghost !h-7 !text-[11px]"
                >
                  Tutti
                </button>
                <button
                  type="button"
                  onClick={() => setAll(false)}
                  className="btn-ghost !h-7 !text-[11px]"
                >
                  Nessuno
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {MONTHS_LABEL.map((label, i) => {
                  const m = i + 1;
                  const checked = actualMonths.has(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMonth(m)}
                      className={`h-10 rounded-md border text-xs font-medium transition flex flex-col items-center justify-center ${
                        checked
                          ? "bg-brand-50 border-brand-500 text-brand-600"
                          : "bg-white border-line text-sub hover:bg-bg"
                      }`}
                    >
                      <span>{label}</span>
                      <span className="text-[9px] mt-0.5">
                        {checked ? "consunt." : "budget"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-1">
                Note
              </div>
              <textarea
                maxLength={500}
                className="input w-full !h-auto"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {error && (
              <div className="text-xs px-3 py-2 rounded-md bg-err-50 text-err-600 border border-err-100">
                {error}
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-line bg-bg flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="btn-ghost !text-err-600 hover:!bg-err-50"
            >
              Elimina scenario
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="btn-ghost"
              >
                Annulla
              </button>
              <button type="submit" disabled={pending} className="btn">
                {pending ? "Salvo…" : "Salva"}
              </button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}
