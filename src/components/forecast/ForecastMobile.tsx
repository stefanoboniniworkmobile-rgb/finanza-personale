"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight } from "lucide-react";
import { fmtN } from "@/lib/format";
import { NumberInput } from "@/components/ui/NumberInput";
import {
  setForecastBudget,
  clearForecastBudget,
  applyForecastBudgetToMonths,
} from "@/app/(app)/forecast/actions";
import type {
  ForecastGridRow,
  ForecastGridTotals,
} from "./ForecastGridClient";

/**
 * Vista Forecast per mobile: lista di categorie col TOTALE ANNO; toccando una
 * categoria si apre l'editor mese per mese. I mesi "consuntivo" sono in sola
 * lettura, quelli "budget" sono modificabili (come nella griglia desktop).
 */
export function ForecastMobile({
  forecastId,
  year,
  monthLabels,
  rows,
  totals,
}: {
  forecastId: string;
  year: number;
  monthLabels: string[];
  rows: ForecastGridRow[];
  totals: ForecastGridTotals;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? rows.find((r) => r.id === selectedId) : null;

  const actualTot = totals.perMonth
    .filter((m) => m.isActual)
    .reduce((s, m) => s + m.value, 0);
  const budgetTot = totals.perMonth
    .filter((m) => !m.isActual)
    .reduce((s, m) => s + m.value, 0);
  const actualCount = totals.perMonth.filter((m) => m.isActual).length;

  return (
    <div className="md:hidden">
      {/* Totale anno */}
      <div className="panel p-4 mb-3">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="ph">Proiezione {year}</div>
            <div className="text-[26px] font-semibold num tracking-tight leading-none mt-1 truncate">
              {fmtN(totals.yearTotal)} €
            </div>
          </div>
          <div className="text-right shrink-0 text-[11px] text-sub">
            {actualCount}/12 a consuntivo
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-line2" />
            <span className="text-sub">Consuntivo</span>
            <span className="num-mono text-ink2">{fmtN(actualTot)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-white border border-line" />
            <span className="text-sub">Budget</span>
            <span className="num-mono text-ink2">{fmtN(budgetTot)}</span>
          </span>
        </div>
      </div>

      {/* Lista categorie */}
      <div className="panel overflow-hidden divide-y divide-line2">
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-sub">
            Nessuna categoria per questo filtro.
          </div>
        )}
        {rows.map((r) => {
          const actual = r.months
            .filter((m) => m.isActual)
            .reduce((s, m) => s + m.value, 0);
          const budget = r.months
            .filter((m) => !m.isActual)
            .reduce((s, m) => s + m.value, 0);
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
                    {fmtN(r.yearTotal)} €
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] num-mono text-sub">
                  <span>cons. {fmtN(actual)}</span>
                  <span>budg. {fmtN(budget)}</span>
                  {r.overrideCount > 0 && (
                    <span className="text-brand-600">
                      {r.overrideCount} mod.
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={18} className="text-sub shrink-0" />
            </button>
          );
        })}
      </div>

      {selected && (
        <MonthEditor
          forecastId={forecastId}
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
  forecastId,
  row,
  year,
  monthLabels,
  onClose,
}: {
  forecastId: string;
  row: ForecastGridRow;
  year: number;
  monthLabels: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [allValue, setAllValue] = useState<number | null>(null);

  const editableMonths = row.months
    .filter((m) => !m.isActual)
    .map((m) => m.month);

  const saveMonth = (month: number, amount: number | null) => {
    startTransition(async () => {
      if (amount == null) {
        await clearForecastBudget({ forecastId, categoryId: row.id, month });
      } else {
        await setForecastBudget({ forecastId, categoryId: row.id, month, amount });
      }
      router.refresh();
    });
  };

  const applyToAll = () => {
    if (allValue == null || allValue < 0 || editableMonths.length === 0) return;
    startTransition(async () => {
      await applyForecastBudgetToMonths({
        forecastId,
        categoryId: row.id,
        months: editableMonths,
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
              Proiezione {year}: {fmtN(row.yearTotal)} €
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

        {/* Applica a tutti i mesi budget */}
        {editableMonths.length > 0 && (
          <div className="px-4 py-2.5 border-b border-line bg-bg/50 flex items-end gap-2 shrink-0">
            <label className="block flex-1">
              <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1">
                Stesso importo a tutti i mesi budget
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
        )}

        {/* Mesi */}
        <div className="overflow-y-auto flex-1 divide-y divide-line2">
          {row.months.map((m) => (
            <div
              key={m.month}
              className={`px-4 py-2.5 flex items-center gap-3 ${
                m.isActual ? "bg-bg/40" : ""
              }`}
            >
              <div className="w-10 text-sm font-medium text-ink2 shrink-0">
                {monthLabels[m.month - 1]}
              </div>
              {m.isActual ? (
                <>
                  <div className="flex-1 text-right num-mono text-[13px] text-ink2">
                    {fmtN(m.actual)}
                  </div>
                  <div className="w-20 text-right shrink-0">
                    <span className="text-[10px] uppercase tracking-wide text-sub">
                      consuntivo
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <NumberInput
                      value={m.budget}
                      onValueChange={(v) => saveMonth(m.month, v)}
                      min={0}
                      className="input w-full text-right num-mono !h-9"
                      placeholder="0,00"
                    />
                  </div>
                  <div className="w-20 text-right shrink-0">
                    {m.override != null ? (
                      <button
                        type="button"
                        onClick={() => saveMonth(m.month, null)}
                        className="text-[11px] text-brand-600"
                      >
                        ↺ auto
                      </button>
                    ) : (
                      <span className="text-[10px] text-sub">budget</span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
