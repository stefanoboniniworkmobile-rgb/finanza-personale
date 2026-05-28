"use client";

import { useEffect, useRef, useState } from "react";
import {
  computeBudgetPure,
  BUDGET_MODES,
  BUDGET_MODE_LABEL,
  type BudgetModeId,
} from "@/lib/budget-calc";
import { NumberInput } from "@/components/ui/NumberInput";

export type BulkRow = {
  id: string;
  name: string;
  type: "income" | "expense";
  budgetMode: string;
  manualBudget: number | null;
  monthlyTotals: Record<string, number>;
};

type BulkCell = { categoryId: string; month: number; amount: number };

export function BulkApplyDialog({
  open,
  onClose,
  selectedRows,
  year,
  monthLabels,
  // Mesi modificabili (per /budget = tutti; per /forecast = solo quelli budget)
  editableMonths,
  pending,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  selectedRows: BulkRow[];
  year: number;
  monthLabels: string[];
  editableMonths: number[];
  pending: boolean;
  onApply: (cells: BulkCell[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [criterion, setCriterion] = useState<BudgetModeId>("AVG_3M");
  const [num, setNum] = useState<number | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (open) {
      setCriterion("AVG_3M");
      setNum(null);
      setSelectedMonths(new Set());
    }
  }, [open]);

  const isManual = criterion === "MANUAL";
  const monthCount = selectedMonths.size;
  const catCount = selectedRows.length;

  const isMonthEditable = (m: number) => editableMonths.includes(m);

  const toggleMonth = (m: number) => {
    if (!isMonthEditable(m)) return;
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const setPreset = (months: number[]) => {
    setSelectedMonths(new Set(months.filter(isMonthEditable)));
  };

  // Costruisce le celle da applicare
  const buildCells = (): BulkCell[] | null => {
    if (selectedRows.length === 0 || selectedMonths.size === 0) return null;
    const months = Array.from(selectedMonths).sort((a, b) => a - b);

    if (isManual) {
      if (num === null || num < 0) return null;
      const cells: BulkCell[] = [];
      for (const r of selectedRows) {
        for (const m of months) {
          cells.push({ categoryId: r.id, month: m, amount: num });
        }
      }
      return cells;
    }

    // Criterio relativo: per ogni (categoria, mese) calcolo dal proprio storico
    const cells: BulkCell[] = [];
    for (const r of selectedRows) {
      for (const m of months) {
        const period = `${year}-${String(m).padStart(2, "0")}`;
        const v = computeBudgetPure(
          criterion,
          period,
          r.monthlyTotals,
          r.manualBudget,
        );
        cells.push({ categoryId: r.id, month: m, amount: v });
      }
    }
    return cells;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cells = buildCells();
    if (!cells) return;
    onApply(cells);
  };

  const cellsCount = catCount * monthCount;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="rounded-lg border border-line shadow-2xl p-0 backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      style={{ maxWidth: 560, width: "calc(100vw - 32px)" }}
    >
      <form onSubmit={handleSubmit} className="bg-white">
        <div className="px-5 py-4 border-b border-line">
          <div className="font-semibold text-base">
            Imposta budget in massa
          </div>
          <div className="text-xs text-sub mt-0.5">
            Applica un criterio o un importo a {catCount}{" "}
            {catCount === 1 ? "categoria" : "categorie"} selezionata{catCount === 1 ? "" : "e"}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Categorie selezionate (chip read-only) */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1.5">
              Categorie ({catCount})
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedRows.map((r) => (
                <span
                  key={r.id}
                  className={`pill ${
                    r.type === "income"
                      ? "bg-ok-50 text-ok-600"
                      : "bg-err-50 text-err-600"
                  }`}
                >
                  {r.name}
                </span>
              ))}
            </div>
          </div>

          {/* Criterio */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1.5">
              Criterio
            </div>
            <select
              value={criterion}
              onChange={(e) => setCriterion(e.target.value as BudgetModeId)}
              className="input w-full"
            >
              {BUDGET_MODES.map((m) => (
                <option key={m} value={m}>
                  {BUDGET_MODE_LABEL[m]}
                </option>
              ))}
            </select>
            {!isManual && (
              <div className="text-[11px] text-sub mt-1">
                Ogni cella verrà calcolata sul proprio storico (per categoria e mese).
              </div>
            )}
          </div>

          {/* Importo (solo MANUAL) */}
          {isManual && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1.5">
                Importo
              </div>
              <div className="flex gap-2 items-center">
                <NumberInput
                  value={num}
                  onValueChange={setNum}
                  className="input flex-1 num-mono text-right"
                  placeholder="0"
                />
                <span className="text-sub">€</span>
              </div>
              <div className="text-[11px] text-sub mt-1">
                Lo stesso importo sarà applicato a ogni (categoria × mese) selezionata.
              </div>
            </div>
          )}

          {/* Mesi */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wider text-sub font-semibold">
                Mesi
              </div>
              <span className="text-[11px] text-sub num-mono">
                {monthCount}/{editableMonths.length}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 mb-2">
              {monthLabels.map((label, i) => {
                const m = i + 1;
                const checked = selectedMonths.has(m);
                const editable = isMonthEditable(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMonth(m)}
                    disabled={!editable}
                    className={`h-8 rounded text-xs font-medium border transition ${
                      !editable
                        ? "bg-line2 border-line2 text-sub/60 cursor-not-allowed"
                        : checked
                          ? "bg-brand-50 border-brand-500 text-brand-600"
                          : "bg-white border-line text-sub hover:bg-bg"
                    }`}
                    title={!editable ? "Mese non modificabile" : undefined}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1">
              <PresetBtn onClick={() => setPreset(editableMonths)}>tutti</PresetBtn>
              <PresetBtn onClick={() => setPreset([1, 2, 3])}>Q1</PresetBtn>
              <PresetBtn onClick={() => setPreset([4, 5, 6])}>Q2</PresetBtn>
              <PresetBtn onClick={() => setPreset([7, 8, 9])}>Q3</PresetBtn>
              <PresetBtn onClick={() => setPreset([10, 11, 12])}>Q4</PresetBtn>
              <PresetBtn onClick={() => setPreset([])}>nessuno</PresetBtn>
            </div>
          </div>

          <div className="text-xs text-sub border-t border-line2 pt-3">
            Verranno aggiornate <strong>{cellsCount}</strong> celle ({catCount}{" "}
            {catCount === 1 ? "categoria" : "categorie"} × {monthCount} mesi).
          </div>
        </div>

        <div className="px-5 py-3 border-t border-line bg-bg flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="btn-ghost"
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={
              pending ||
              monthCount === 0 ||
              catCount === 0 ||
              (isManual && num === null)
            }
            className="btn"
          >
            {pending
              ? "Applico…"
              : `Applica a ${cellsCount} celle`}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function PresetBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-2 py-0.5 rounded border border-line text-sub hover:bg-line2 hover:text-ink transition"
    >
      {children}
    </button>
  );
}
