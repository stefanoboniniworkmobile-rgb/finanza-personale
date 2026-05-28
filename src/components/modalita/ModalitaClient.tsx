"use client";

import { useState } from "react";
import {
  ModalitaDialog,
  type ModalitaDialogValue,
} from "./ModalitaDialog";

export type ModalitaRow = {
  id: string;
  name: string;
  notes: string | null;
  txCount: number;
};

export function ModalitaClient({ rows }: { rows: ModalitaRow[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ModalitaDialogValue | undefined>();

  const openNew = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (r: ModalitaRow) => {
    setEditing({ id: r.id, name: r.name, notes: r.notes ?? null });
    setDialogOpen(true);
  };

  return (
    <>
      <div className="flex items-center justify-end mb-3">
        <button onClick={openNew} className="btn">
          + Nuova modalità
        </button>
      </div>

      <div className="panel overflow-hidden">
        <table className="dense">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Note</th>
              <th className="text-right" style={{ width: 90 }}>
                N. mov.
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-12 text-center text-sub">
                  Nessuna modalità. Aggiungine una col bottone qui sopra.
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
                <td className="text-sub">
                  {r.notes ? (
                    <span className="truncate block max-w-[420px]" title={r.notes}>
                      {r.notes}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="text-right num-mono text-sub">{r.txCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ModalitaDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
      />
    </>
  );
}
