"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtN0 } from "@/lib/format";
import { NumberInput } from "@/components/ui/NumberInput";
import {
  computeBudgetPure,
  BUDGET_MODES,
  BUDGET_MODE_LABEL,
  type BudgetModeId,
} from "@/lib/budget-calc";
import {
  setForecastBudget,
  clearForecastBudget,
  applyForecastBudgetToMonths,
  applyForecastBudgetToCells,
  applyForecastBudgetsBulk,
  resetForecastRow,
} from "@/app/(app)/forecast/actions";
import { BulkApplyDialog } from "@/components/budget/BulkApplyDialog";

export type ForecastGridMonth = {
  month: number;
  isActual: boolean;
  actual: number;
  auto: number;
  override: number | null;
  budget: number; // override ?? auto
  value: number; // se isActual: actual; altrimenti budget
};

export type ForecastGridRow = {
  id: string;
  name: string;
  type: "income" | "expense";
  hasBudget: boolean;
  budgetMode: string;
  budgetModeLabel: string;
  manualBudget: number | null;
  monthlyTotals: Record<string, number>;
  months: ForecastGridMonth[];
  yearTotal: number;
  overrideCount: number;
};

export type ForecastGridTotals = {
  perMonth: { isActual: boolean; value: number }[];
  yearTotal: number;
};

type CellEditing = {
  row: ForecastGridRow;
  month: number;
};

export function ForecastGridClient({
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
  const [editing, setEditing] = useState<CellEditing | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggleRow = (id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllRows = () => {
    if (selectedRowIds.size === rows.length) setSelectedRowIds(new Set());
    else setSelectedRowIds(new Set(rows.map((r) => r.id)));
  };

  // Mesi editabili nel forecast: quelli NON consuntivo
  const editableMonthsForecast = totals.perMonth
    .map((p, i) => (p.isActual ? null : i + 1))
    .filter((m): m is number => m !== null);

  const handleBulkApply = (
    cells: { categoryId: string; month: number; amount: number }[],
  ) => {
    startTransition(async () => {
      await applyForecastBudgetsBulk({ forecastId, cells });
      router.refresh();
      setBulkOpen(false);
      setSelectedRowIds(new Set());
    });
  };

  const openCell = (e: React.MouseEvent, row: ForecastGridRow, month: number) => {
    const cell = row.months[month - 1];
    if (cell.isActual) return; // celle consuntivo non editabili
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    setEditing({ row, month });
    setPopoverPos({
      left: rect.left + window.scrollX,
      top: rect.bottom + window.scrollY + 4,
    });
  };

  const closePopover = () => {
    setEditing(null);
    setPopoverPos(null);
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePopover();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const refresh = () => router.refresh();

  const handleApply = (
    amount: number,
    months: number[],
    cells?: { month: number; amount: number }[],
  ) => {
    if (!editing) return;
    if (months.length === 0) return;
    startTransition(async () => {
      if (cells && cells.length > 0) {
        await applyForecastBudgetToCells({
          forecastId,
          categoryId: editing.row.id,
          cells,
        });
      } else if (months.length === 1) {
        await setForecastBudget({
          forecastId,
          categoryId: editing.row.id,
          month: months[0],
          amount,
        });
      } else {
        await applyForecastBudgetToMonths({
          forecastId,
          categoryId: editing.row.id,
          months,
          amount,
        });
      }
      refresh();
      closePopover();
    });
  };

  const handleClear = () => {
    if (!editing) return;
    startTransition(async () => {
      await clearForecastBudget({
        forecastId,
        categoryId: editing.row.id,
        month: editing.month,
      });
      refresh();
      closePopover();
    });
  };

  const handleResetRow = (rowId: string) => {
    startTransition(async () => {
      await resetForecastRow({ forecastId, categoryId: rowId });
      refresh();
    });
  };

  if (rows.length === 0) {
    return (
      <div className="panel p-12 text-center text-sub">
        Nessuna categoria con i filtri attuali.
      </div>
    );
  }

  return (
    <>
      <div className="panel overflow-x-auto">
        <table className="budget-grid">
          <thead>
            <tr>
              <th className="bg-white sticky left-0 z-10 text-center" style={{ width: 32, minWidth: 32 }}>
                <input
                  type="checkbox"
                  checked={selectedRowIds.size === rows.length && rows.length > 0}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        selectedRowIds.size > 0 &&
                        selectedRowIds.size < rows.length;
                  }}
                  onChange={toggleAllRows}
                  className="accent-brand-500"
                  aria-label="Seleziona tutte le categorie"
                />
              </th>
              <th
                className="bg-white sticky z-10 text-left"
                style={{ minWidth: 168, left: 32 }}
              >
                Categoria
              </th>
              {monthLabels.map((m, i) => (
                <th
                  key={i}
                  className={`text-right ${
                    totals.perMonth[i].isActual ? "is-actual-header" : ""
                  }`}
                  style={{ minWidth: 64 }}
                >
                  {m}
                  <span className="block text-[9px] font-medium text-sub mt-0.5">
                    {totals.perMonth[i].isActual ? "consunt." : "budget"}
                  </span>
                </th>
              ))}
              <th className="text-right bg-line2/40" style={{ minWidth: 84 }}>
                Tot
              </th>
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`row ${selectedRowIds.has(r.id) ? "is-selected" : ""}`}>
                <td
                  className="bg-white sticky left-0 z-[5] text-center"
                  style={{ width: 32, minWidth: 32 }}
                >
                  <input
                    type="checkbox"
                    checked={selectedRowIds.has(r.id)}
                    onChange={() => toggleRow(r.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="accent-brand-500"
                    aria-label={`Seleziona ${r.name}`}
                  />
                </td>
                <td className="bg-white sticky z-[5] font-medium" style={{ left: 32 }}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`pill ${
                        r.type === "income"
                          ? "bg-ok-50 text-ok-600"
                          : "bg-err-50 text-err-600"
                      }`}
                      style={{ fontSize: 10 }}
                    >
                      {r.type === "income" ? "E" : "U"}
                    </span>
                    <a
                      href={`/categorie`}
                      className="hover:text-brand-500 transition"
                      title="Apri Categorie per modificare la modalità"
                    >
                      <span>{r.name}</span>
                      <span className="block text-[10px] text-sub font-normal leading-none mt-0.5">
                        {r.budgetModeLabel}
                      </span>
                    </a>
                  </div>
                </td>
                {r.months.map((cell) => {
                  const hasOverride = !cell.isActual && cell.override !== null;
                  return (
                    <td
                      key={cell.month}
                      onClick={(e) => openCell(e, r, cell.month)}
                      className={`forecast-cell ${
                        cell.isActual ? "is-actual" : "is-budget"
                      } ${
                        editing?.row.id === r.id && editing?.month === cell.month
                          ? "is-editing"
                          : ""
                      }`}
                    >
                      <div
                        className={`flex items-center justify-end gap-1 num-mono ${
                          hasOverride
                            ? "font-semibold text-ink"
                            : cell.isActual
                              ? "text-ink2"
                              : "text-ink2"
                        }`}
                      >
                        {hasOverride && (
                          <span
                            className="dot"
                            style={{ background: "var(--brand)" }}
                            aria-hidden
                          />
                        )}
                        <span>{cell.value > 0 ? fmtN0(cell.value) : "—"}</span>
                      </div>
                    </td>
                  );
                })}
                <td className="text-right num-mono bg-line2/40 font-semibold">
                  {fmtN0(r.yearTotal)}
                </td>
                <td className="text-center">
                  {r.overrideCount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleResetRow(r.id)}
                      className="text-sub hover:text-err-600 transition text-xs"
                      title={`Cancella tutti gli ${r.overrideCount} override budget di questa riga`}
                    >
                      ⟲
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="bg-white sticky left-0 z-[5]" style={{ width: 32 }} />
              <td
                className="bg-white sticky z-[5] font-semibold text-xs"
                style={{ left: 32 }}
              >
                TOTALE
              </td>
              {totals.perMonth.map((t, i) => (
                <td
                  key={i}
                  className={`text-right num-mono font-semibold ${
                    t.isActual ? "is-actual-cell" : ""
                  }`}
                >
                  {fmtN0(t.value)}
                </td>
              ))}
              <td className="text-right num-mono font-semibold bg-line2/40">
                {fmtN0(totals.yearTotal)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {editing && popoverPos && (
        <CellPopover
          editing={editing}
          year={year}
          monthLabels={monthLabels}
          pos={popoverPos}
          pending={pending}
          onClose={closePopover}
          onApply={handleApply}
          onClear={handleClear}
        />
      )}

      {selectedRowIds.size > 0 && (
        <div className="bulk-actionbar">
          <span className="text-xs">
            <strong className="num-mono">{selectedRowIds.size}</strong>{" "}
            {selectedRowIds.size === 1 ? "categoria selezionata" : "categorie selezionate"}
          </span>
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="btn !h-7 !text-xs"
          >
            Imposta in massa…
          </button>
          <button
            type="button"
            onClick={() => setSelectedRowIds(new Set())}
            className="btn-ghost !h-7 !text-xs"
          >
            Annulla selezione
          </button>
        </div>
      )}

      <BulkApplyDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        selectedRows={rows
          .filter((r) => selectedRowIds.has(r.id))
          .map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            budgetMode: r.budgetMode,
            manualBudget: r.manualBudget,
            monthlyTotals: r.monthlyTotals,
          }))}
        year={year}
        monthLabels={monthLabels}
        editableMonths={editableMonthsForecast}
        pending={pending}
        onApply={handleBulkApply}
      />
    </>
  );
}

function CellPopover({
  editing,
  year,
  monthLabels,
  pos,
  pending,
  onClose,
  onApply,
  onClear,
}: {
  editing: CellEditing;
  year: number;
  monthLabels: string[];
  pos: { left: number; top: number };
  pending: boolean;
  onClose: () => void;
  onApply: (
    amount: number,
    months: number[],
    cells?: { month: number; amount: number }[],
  ) => void;
  onClear: () => void;
}) {
  const cell = editing.row.months[editing.month - 1];
  const period = `${year}-${String(editing.month).padStart(2, "0")}`;
  const initialValue = cell.override ?? cell.auto;
  const [num, setNum] = useState<number | null>(
    Number.isFinite(initialValue) ? initialValue : null,
  );
  const [criterion, setCriterion] = useState<BudgetModeId>(
    editing.row.budgetMode as BudgetModeId,
  );
  // Mesi budget (NON actual) della riga
  const budgetMonths = editing.row.months.filter((m) => !m.isActual).map((m) => m.month);
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(
    new Set([editing.month]),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const id = setTimeout(() => {
      window.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const applyCriterion = (mode: BudgetModeId) => {
    setCriterion(mode);
    if (mode === "MANUAL") return;
    const v = computeBudgetPure(
      mode,
      period,
      editing.row.monthlyTotals,
      editing.row.manualBudget,
    );
    setNum(v);
  };

  const isMonthBudget = (m: number) => budgetMonths.includes(m);

  const toggleMonth = (m: number) => {
    if (!isMonthBudget(m)) return; // mesi actual non selezionabili
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const setPreset = (months: number[]) => {
    // Filtra solo i mesi budget
    setSelectedMonths(new Set(months.filter(isMonthBudget)));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (selectedMonths.size === 0) return;
    const months = Array.from(selectedMonths).sort((a, b) => a - b);

    if (criterion === "MANUAL") {
      if (num === null || num < 0) return;
      onApply(num, months);
      return;
    }

    const cells = months.map((m) => {
      const period = `${year}-${String(m).padStart(2, "0")}`;
      const v = computeBudgetPure(
        criterion,
        period,
        editing.row.monthlyTotals,
        editing.row.manualBudget,
      );
      return { month: m, amount: v };
    });
    const editedAmt =
      cells.find((c) => c.month === editing.month)?.amount ?? cells[0].amount;
    onApply(editedAmt, months, cells);
  };

  const POP_W = 340;
  const left = Math.max(
    8,
    Math.min(pos.left, window.innerWidth - POP_W - 8 + window.scrollX),
  );

  const isCategoryDefault = criterion === editing.row.budgetMode;
  const isManual = criterion === "MANUAL";
  const monthCount = selectedMonths.size;
  const applyLabel =
    monthCount === 0
      ? "Seleziona almeno un mese"
      : monthCount === 1
        ? "Imposta su 1 mese"
        : `Imposta su ${monthCount} mesi`;

  return (
    <div
      ref={popRef}
      className="budget-popover panel"
      style={{
        position: "absolute",
        left,
        top: pos.top,
        width: POP_W,
        zIndex: 50,
      }}
    >
      <div className="text-[11px] uppercase tracking-wider text-sub font-semibold mb-1">
        {editing.row.name} · {monthLabels[editing.month - 1]} {year}
      </div>
      <div className="text-[11px] text-sub mb-3">
        Auto categoria ({editing.row.budgetModeLabel}):{" "}
        <span className="num-mono">{fmtN0(cell.auto)}</span> €
        {cell.override !== null && (
          <>
            {" · "}
            <span className="text-brand-600 font-medium">Override</span>
          </>
        )}
      </div>

      <label className="block mb-2">
        <span className="text-[10px] uppercase tracking-wider text-sub font-semibold">
          Calcola con
        </span>
        <select
          value={criterion}
          onChange={(e) => applyCriterion(e.target.value as BudgetModeId)}
          className="input !h-8 w-full mt-0.5 !text-xs"
        >
          {BUDGET_MODES.map((m) => (
            <option key={m} value={m}>
              {BUDGET_MODE_LABEL[m]}
              {m === editing.row.budgetMode ? " · default categoria" : ""}
            </option>
          ))}
        </select>
        {!isManual && monthCount > 1 && (
          <span className="text-[10px] text-warn-600 mt-0.5 block">
            Su più mesi: ogni mese viene calcolato sul proprio storico.
          </span>
        )}
        {!isCategoryDefault && (
          <span className="text-[10px] text-sub mt-0.5 block">
            Il criterio scelto vale solo per le celle selezionate, non cambia
            l'anagrafica.
          </span>
        )}
      </label>

      <form onSubmit={handleSubmit} className="flex gap-1.5 items-center mb-3">
        <NumberInput
          inputRef={inputRef}
          value={num}
          onValueChange={setNum}
          keepZero
          className="input !h-8 flex-1 num-mono text-right"
          disabled={pending || (!isManual && monthCount > 1)}
          placeholder="0"
          onEnter={() => handleSubmit()}
        />
        <span className="text-sub text-sm">€</span>
      </form>

      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-sub font-semibold">
            Applica ai mesi budget
          </span>
          <span className="text-[10px] text-sub num-mono">
            {monthCount}/{budgetMonths.length}
          </span>
        </div>
        <div className="grid grid-cols-6 gap-1 mb-1.5">
          {monthLabels.map((label, i) => {
            const m = i + 1;
            const checked = selectedMonths.has(m);
            const isBudget = isMonthBudget(m);
            const isCurrent = m === editing.month;
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleMonth(m)}
                disabled={!isBudget}
                className={`h-7 rounded text-[11px] font-medium border transition ${
                  !isBudget
                    ? "bg-line2 border-line2 text-sub/60 cursor-not-allowed"
                    : checked
                      ? "bg-brand-50 border-brand-500 text-brand-600"
                      : "bg-white border-line text-sub hover:bg-bg"
                } ${isCurrent && isBudget ? "ring-1 ring-brand-500/40" : ""}`}
                title={
                  !isBudget
                    ? "Mese consuntivo: non modificabile nel forecast"
                    : isCurrent
                      ? "Mese corrente"
                      : undefined
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1">
          <PresetBtn onClick={() => setPreset([editing.month])}>
            solo {monthLabels[editing.month - 1]}
          </PresetBtn>
          <PresetBtn onClick={() => setPreset(budgetMonths)}>tutti budget</PresetBtn>
          <PresetBtn
            onClick={() =>
              setPreset(
                Array.from(
                  { length: 12 - editing.month + 1 },
                  (_, i) => editing.month + i,
                ),
              )
            }
          >
            da qui in poi
          </PresetBtn>
          <PresetBtn onClick={() => setPreset([1, 2, 3])}>Q1</PresetBtn>
          <PresetBtn onClick={() => setPreset([4, 5, 6])}>Q2</PresetBtn>
          <PresetBtn onClick={() => setPreset([7, 8, 9])}>Q3</PresetBtn>
          <PresetBtn onClick={() => setPreset([10, 11, 12])}>Q4</PresetBtn>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={handleSubmit}
          className="btn !h-8 !text-xs justify-center"
          disabled={
            pending ||
            monthCount === 0 ||
            (isManual && num === null)
          }
        >
          {pending ? "Salvo…" : applyLabel}
        </button>
        {cell.override !== null && (
          <button
            type="button"
            onClick={onClear}
            className="btn-ghost !h-8 !text-xs justify-center text-err-600"
            disabled={pending}
          >
            Cancella override (questa cella)
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost !h-8 !text-xs justify-center text-sub"
          disabled={pending}
        >
          Annulla
        </button>
      </div>
    </div>
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
      className="text-[10px] px-1.5 py-0.5 rounded border border-line text-sub hover:bg-line2 hover:text-ink transition"
    >
      {children}
    </button>
  );
}
