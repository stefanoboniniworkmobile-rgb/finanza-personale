"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight } from "lucide-react";
import { fmtN } from "@/lib/format";
import { NumberInput } from "@/components/ui/NumberInput";
import {
  setBudgetOverride,
  clearBudgetOverride,
  applyOverrideToMonths,
} from "@/app/(app)/budget/actions";
import type {
  BudgetGridRow,
  BudgetGridTotals,
} from "./BudgetGridClient";

/**
 * Vista Budget per mobile: lista di categorie col TOTALE ANNUO; toccando una
 * categoria si apre l'editor mese per mese (mensilizzazione). Le griglie larghe
 * non si portano su cellulare a forza — qui è un master→dettaglio.
 */
export function BudgetMobile({
  year,
  monthLabels,
  rows,
  totals,
}: {
  year: number;
  monthLabels: string[];
  rows: BudgetGridRow[];
  totals: BudgetGridTotals;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? rows.find((r) => r.id === selectedId) : null;

  return (
    <div className="md:hidden">
      {/* Totale anno */}
      <div className="panel p-4 mb-3 flex items-center justify-between">
        <div>
          <div className="ph">Totale budget {year}</div>
          <div className="text-2xl font-semibold num tracking-tight mt-0.5">
            {fmtN(totals.yearEffective)} €
          </div>
        </div>
        <div className="text-right">
          <div className="ph">Speso</div>
          <div className="text-base num mt-1">{fmtN(totals.yearSpent)} €</div>
        </div>
      </div>

      {/* Lista categorie */}
      <div className="panel overflow-hidden divide-y divide-line2">
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-sub">
            Nessuna categoria con budget per questo filtro.
          </div>
        )}
        {rows.map((r) => {
          const pct =
            r.yearEffective > 0
              ? Math.min(100, (r.yearSpent / r.yearEffective) * 100)
              : 0;
          const over = r.yearEffective > 0 && r.yearSpent > r.yearEffective;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-bg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[14px] truncate">
                    {r.name}
                  </span>
                  <span className="num font-semibold text-[14px] shrink-0">
                    {fmtN(r.yearEffective)} €
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 bar-track">
                    <div
                      className={`bar-fill ${over ? "bar-err" : "bar-ok"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-sub num shrink-0">
                    speso {fmtN(r.yearSpent)}
                  </span>
                </div>
                {r.overrideCount > 0 && (
                  <div className="text-[10px] text-brand-600 mt-1">
                    {r.overrideCount} mes{r.overrideCount === 1 ? "e" : "i"} personalizzat
                    {r.overrideCount === 1 ? "o" : "i"}
                  </div>
                )}
              </div>
              <ChevronRight size={18} className="text-sub shrink-0" />
            </button>
          );
        })}
      </div>

      {selected && (
        <MonthEditor
          row={selected}
          year={year}
          monthLabels={monthLabels}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function MonthEditor({
  row,
  year,
  monthLabels,
  onClose,
}: {
  row: BudgetGridRow;
  year: number;
  monthLabels: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [allValue, setAllValue] = useState<number | null>(null);

  const saveMonth = (month: number, amount: number | null) => {
    startTransition(async () => {
      if (amount == null) {
        await clearBudgetOverride({ categoryId: row.id, year, month });
      } else {
        await setBudgetOverride({ categoryId: row.id, year, month, amount });
      }
      router.refresh();
    });
  };

  const applyToAll = () => {
    if (allValue == null || allValue < 0) return;
    startTransition(async () => {
      await applyOverrideToMonths({
        categoryId: row.id,
        year,
        months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        amount: allValue,
      });
      setAllValue(null);
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        className="fp-drawer-backdrop relative mt-auto bg-white rounded-t-2xl max-h-[88vh] flex flex-col shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-4 py-3 border-b border-line flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="font-semibold text-[15px] truncate">{row.name}</div>
            <div className="text-xs text-sub num">
              Totale {year}: {fmtN(row.yearEffective)} € · speso{" "}
              {fmtN(row.yearSpent)} €
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="w-9 h-9 grid place-items-center rounded-lg text-sub hover:bg-line2 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Applica a tutti i mesi */}
        <div className="px-4 py-2.5 border-b border-line bg-bg/50 flex items-end gap-2 shrink-0">
          <label className="block flex-1">
            <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1">
              Stesso importo a tutti i mesi
            </div>
            <NumberInput
              value={allValue}
              onValueChange={setAllValue}
              min={0}
              className="input w-full text-right num-mono"
              placeholder="0,00"
            />
          </label>
          <button
            type="button"
            onClick={applyToAll}
            disabled={pending || allValue == null}
            className="btn !h-8 !text-xs whitespace-nowrap"
          >
            Applica
          </button>
        </div>

        {/* Mesi */}
        <div className="overflow-y-auto flex-1 divide-y divide-line2">
          {row.months.map((m) => (
            <div key={m.month} className="px-4 py-2.5 flex items-center gap-3">
              <div className="w-10 text-sm font-medium text-ink2 shrink-0">
                {monthLabels[m.month - 1]}
              </div>
              <div className="flex-1">
                <NumberInput
                  value={m.effective}
                  onValueChange={(v) => saveMonth(m.month, v)}
                  min={0}
                  className="input w-full text-right num-mono !h-9"
                  placeholder="0,00"
                />
              </div>
              <div className="w-24 text-right shrink-0">
                <div className="text-[11px] text-sub num">
                  speso {fmtN(m.spent)}
                </div>
                {m.override != null && (
                  <button
                    type="button"
                    onClick={() => saveMonth(m.month, null)}
                    className="text-[11px] text-brand-600"
                  >
                    ↺ auto
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
