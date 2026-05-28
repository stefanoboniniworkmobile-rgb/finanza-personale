"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtMonthLong, shiftYm } from "@/lib/format";

export function PeriodSelector({
  from,
  to,
  todayYm,
  options,
}: {
  from: string;
  to: string;
  todayYm: string;
  options: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  const goTo = (newFrom: string, newTo: string) => {
    startTransition(() => {
      const params = new URLSearchParams();
      if (newFrom === newTo) {
        params.set("period", newFrom);
      } else {
        params.set("from", newFrom);
        params.set("to", newTo);
      }
      router.push(`/dashboard?${params.toString()}`);
      setOpen(false);
    });
  };

  const applyDraft = () => {
    if (draftFrom > draftTo) goTo(draftTo, draftFrom);
    else goTo(draftFrom, draftTo);
  };

  // Preset
  const startOfYear = todayYm.split("-")[0] + "-01";
  const presets: { label: string; from: string; to: string; key: string }[] = [
    { label: "Mese corrente", from: todayYm, to: todayYm, key: "current" },
    { label: "Da inizio anno", from: startOfYear, to: todayYm, key: "ytd" },
    { label: "Ultimi 3 mesi", from: shiftYm(todayYm, 2), to: todayYm, key: "3m" },
    { label: "Ultimi 6 mesi", from: shiftYm(todayYm, 5), to: todayYm, key: "6m" },
    { label: "Ultimi 12 mesi", from: shiftYm(todayYm, 11), to: todayYm, key: "12m" },
  ];

  // Quale preset corrisponde all'attuale selezione?
  const activePreset = presets.find((p) => p.from === from && p.to === to);

  // Mostra "Maggio 2026" se singolo mese, "Gennaio – Maggio 2026" altrimenti
  const label =
    from === to ? fmtMonthLong(from) : `${monthShort(from)} → ${monthShort(to)}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setDraftFrom(from);
          setDraftTo(to);
          setOpen(!open);
        }}
        className="input !h-9 !py-0 pr-8 min-w-[260px] text-left relative cursor-pointer"
      >
        <span className="text-[10px] uppercase tracking-wider text-sub mr-2">
          Periodo
        </span>
        <span className="font-medium">{label}</span>
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sub text-xs">
          ▾
        </span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 mt-1 w-[420px] bg-white border border-line rounded-lg shadow-2xl z-20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1.5">
              Preset
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => goTo(p.from, p.to)}
                  disabled={pending}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition text-left ${
                    activePreset?.key === p.key
                      ? "bg-brand-50 border-brand-500 text-brand-600"
                      : "bg-white border-line text-ink hover:bg-bg"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1.5 pt-2 border-t border-line2">
              Range personalizzato
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <label className="block">
                <span className="text-[11px] text-sub mb-1 block">Dal mese</span>
                <select
                  className="input w-full !h-8 !py-0"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                >
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {fmtMonthLong(o)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] text-sub mb-1 block">Al mese</span>
                <select
                  className="input w-full !h-8 !py-0"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                >
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {fmtMonthLong(o)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Annulla
              </button>
              <button
                type="button"
                className="btn text-xs"
                onClick={applyDraft}
                disabled={pending}
              >
                Applica
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function monthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = [
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
  return `${names[m - 1]} ${y}`;
}
