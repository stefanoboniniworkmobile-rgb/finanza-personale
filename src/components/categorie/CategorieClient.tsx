"use client";

import { useState, useTransition } from "react";
import {
  CategoriaDialog,
  type CategoriaDialogValue,
  type CounterpartOption,
} from "./CategoriaDialog";
import {
  updateBudgetMode,
  toggleHasBudget,
} from "@/app/(app)/categorie/actions";
import { useRouter } from "next/navigation";
import { fmtN0 } from "@/lib/format";

export type CategoriaRow = {
  id: string;
  name: string;
  type: "income" | "expense";
  showInDashboard: boolean;
  hasBudget: boolean;
  budgetMode: string;
  manualBudget: number | null;
  txCount: number;
  computedBudget: number;
  spentCurrentPeriod: number;
  isTransfer: boolean;
  counterpartCategoryId: string | null;
};

const MODE_LABEL: Record<string, string> = {
  AVG_3M: "Media 3M",
  AVG_6M: "Media 6M",
  AVG_12M: "Media 12M",
  PREV_MONTH: "Mese prec.",
  SAME_MONTH_LY: "Stesso mese a.p.",
  MAX_3M: "Max 3M",
  ACTUAL_MONTH: "Consuntivo",
  MANUAL: "Manuale",
};

const MODES = [
  "AVG_3M",
  "AVG_6M",
  "AVG_12M",
  "PREV_MONTH",
  "SAME_MONTH_LY",
  "MAX_3M",
  "ACTUAL_MONTH",
  "MANUAL",
];

export function CategorieClient({
  rows,
  counterpartOptions = [],
}: {
  rows: CategoriaRow[];
  counterpartOptions?: CounterpartOption[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CategoriaDialogValue | undefined>();
  const [, startTransition] = useTransition();
  const router = useRouter();

  const openNew = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (r: CategoriaRow) => {
    setEditing({
      id: r.id,
      name: r.name,
      type: r.type,
      showInDashboard: r.showInDashboard,
      hasBudget: r.hasBudget,
      budgetMode: r.budgetMode,
      manualBudget: r.manualBudget,
      isTransfer: r.isTransfer,
      counterpartCategoryId: r.counterpartCategoryId,
    });
    setDialogOpen(true);
  };

  const handleModeChange = (id: string, mode: string) => {
    startTransition(async () => {
      await updateBudgetMode(id, mode);
      router.refresh();
    });
  };
  const handleToggleBudget = (id: string) => {
    startTransition(async () => {
      await toggleHasBudget(id);
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex items-center justify-end mb-3">
        <button onClick={openNew} className="btn">
          + Nuova categoria
        </button>
      </div>

      <div className="panel overflow-x-auto">
        <table className="dense">
          <thead>
            <tr>
              <th>Nome</th>
              <th style={{ width: 80 }}>Tipo</th>
              <th style={{ width: 90 }} className="text-center">
                Dashboard
              </th>
              <th style={{ width: 90 }} className="text-center">
                Budget
              </th>
              <th style={{ width: 150 }}>Modalità</th>
              <th className="text-right" style={{ width: 110 }}>
                Tetto calc.
              </th>
              <th className="text-right" style={{ width: 110 }}>
                Speso (mese)
              </th>
              <th className="text-right" style={{ width: 70 }}>
                N. mov.
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-sub">
                  Nessuna categoria. Aggiungine una col bottone qui sopra.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="row cursor-pointer"
                onClick={() => openEdit(r)}
              >
                <td className="font-medium">{r.name}</td>
                <td>
                  <span
                    className={`pill ${
                      r.type === "income" ? "bg-ok-50 text-ok-600" : "bg-err-50 text-err-600"
                    }`}
                  >
                    {r.type === "income" ? "Entrata" : "Uscita"}
                  </span>
                </td>
                <td className="text-center">
                  <span className={r.showInDashboard ? "text-ok-600" : "text-sub"}>
                    {r.showInDashboard ? "✓" : "—"}
                  </span>
                </td>
                <td className="text-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleBudget(r.id);
                    }}
                    className={`pill ${
                      r.hasBudget ? "bg-brand-50 text-brand-600" : "bg-line2 text-sub"
                    }`}
                    title="Click per attivare/disattivare il budget"
                  >
                    {r.hasBudget ? "Attivo" : "Off"}
                  </button>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    value={r.budgetMode}
                    onChange={(e) => handleModeChange(r.id, e.target.value)}
                    disabled={!r.hasBudget}
                    className="input !h-7 !py-0 !text-[12px] w-full"
                  >
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-right num-mono text-ink2">
                  {r.hasBudget ? fmtN0(r.computedBudget) : "—"}
                </td>
                <td className="text-right num-mono text-sub">
                  {fmtN0(r.spentCurrentPeriod)}
                </td>
                <td className="text-right num-mono text-sub">{r.txCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CategoriaDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        counterpartOptions={counterpartOptions}
      />
    </>
  );
}
