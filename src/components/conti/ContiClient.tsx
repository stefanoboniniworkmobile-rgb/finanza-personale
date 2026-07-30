"use client";

import { useState } from "react";
import { ContoDialog, type ContoDialogValue } from "./ContoDialog";
import { fmtN } from "@/lib/format";

export type ContoRow = {
  id: string;
  name: string;
  type: string;
  notes: string | null;
  initialBalance: number;
  iban: string | null;
  cardMaskedPan: string | null;
  saldo: number; // calcolato
  txCount: number;
};

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  liquidity: { label: "C/C", cls: "bg-ok-50 text-ok-600" },
  credit_card: { label: "Carta", cls: "bg-err-50 text-err-600" },
  savings: { label: "Risparmio", cls: "bg-warn-50 text-warn-600" },
  cash: { label: "Contanti", cls: "bg-line2 text-sub" },
};

export function ContiClient({ rows }: { rows: ContoRow[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContoDialogValue | undefined>();

  const openNew = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (r: ContoRow) => {
    setEditing({
      id: r.id,
      name: r.name,
      type: r.type as any,
      initialBalance: r.initialBalance,
      notes: r.notes ?? null,
      iban: r.iban ?? null,
      cardMaskedPan: r.cardMaskedPan ?? null,
    });
    setDialogOpen(true);
  };

  const totIni = rows.reduce((s, r) => s + r.initialBalance, 0);
  const totSaldo = rows.reduce((s, r) => s + r.saldo, 0);
  const totMovs = rows.reduce((s, r) => s + r.txCount, 0);

  return (
    <>
      <div className="flex items-center justify-end mb-3">
        <button onClick={openNew} className="btn">
          + Nuovo conto
        </button>
      </div>

      <div className="panel overflow-x-auto">
        <table className="dense">
          <thead>
            <tr>
              <th>Conto</th>
              <th style={{ width: 110 }}>Tipo</th>
              <th className="text-right" style={{ width: 130 }}>
                Saldo iniziale
              </th>
              <th className="text-right" style={{ width: 130 }}>
                Saldo attuale
              </th>
              <th className="text-right" style={{ width: 80 }}>
                N. mov.
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center text-sub">
                  Nessun conto. Aggiungine uno col bottone qui sopra.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="row cursor-pointer"
                onClick={() => openEdit(r)}
              >
                <td>
                  <div className="font-medium">{r.name}</div>
                  {r.notes && (
                    <div
                      className="text-xs text-sub truncate max-w-[260px]"
                      title={r.notes}
                    >
                      {r.notes}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`pill ${TYPE_LABEL[r.type]?.cls ?? "bg-line2 text-sub"}`}>
                    {TYPE_LABEL[r.type]?.label ?? r.type}
                  </span>
                </td>
                <td className="text-right num-mono text-sub">{fmtN(r.initialBalance)}</td>
                <td
                  className={`text-right num-mono font-semibold ${r.saldo < 0 ? "text-err-600" : ""}`}
                >
                  {fmtN(r.saldo)}
                </td>
                <td className="text-right num-mono text-sub">{r.txCount}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2} className="font-semibold text-xs">
                  TOTALE
                </td>
                <td className="text-right num-mono text-sub">{fmtN(totIni)}</td>
                <td className="text-right num-mono font-semibold">{fmtN(totSaldo)}</td>
                <td className="text-right num-mono text-sub">{totMovs}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <ContoDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
      />
    </>
  );
}
