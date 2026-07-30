"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveHolder,
  deleteHolder,
  switchHolder,
  type HolderInput,
} from "@/app/(app)/holder-actions";

export type IntestatarioRow = {
  id: string;
  name: string;
  notes: string | null;
  txCount: number;
  accountCount: number;
  categoryCount: number;
  isActive: boolean;
};

export function IntestatariClient({ rows }: { rows: IntestatarioRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<HolderInput>({ name: "", notes: "" });
  const [deletingRow, setDeletingRow] = useState<IntestatarioRow | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft({ name: "", notes: "" });
  };

  const startEdit = (row: IntestatarioRow) => {
    setEditingId(row.id);
    setCreating(false);
    setDraft({ id: row.id, name: row.name, notes: row.notes ?? "" });
  };

  const cancelEdit = () => {
    setCreating(false);
    setEditingId(null);
    setDraft({ name: "", notes: "" });
  };

  const submit = () => {
    startTransition(async () => {
      const res = await saveHolder(draft);
      if (res.ok) {
        cancelEdit();
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  };

  const isEmpty = (row: IntestatarioRow) =>
    row.txCount === 0 && row.accountCount === 0 && row.categoryCount === 0;

  const openDelete = (row: IntestatarioRow) => {
    setDeletingRow(row);
    setDeleteConfirmName("");
  };

  const closeDelete = () => {
    setDeletingRow(null);
    setDeleteConfirmName("");
  };

  const runDelete = (row: IntestatarioRow, force: boolean) => {
    startTransition(async () => {
      const res = await deleteHolder(row.id, { force });
      if (res.ok) {
        closeDelete();
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  };

  const handleActivate = (row: IntestatarioRow) => {
    if (row.isActive) return;
    startTransition(async () => {
      const res = await switchHolder(row.id);
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  };

  return (
    <div>
      <div className="mb-3">
        {!creating && !editingId && (
          <button onClick={startCreate} className="btn">
            + Nuovo intestatario
          </button>
        )}
      </div>

      {(creating || editingId) && (
        <div className="panel p-4 mb-4">
          <div className="text-sm font-semibold mb-3">
            {creating ? "Nuovo intestatario" : "Modifica intestatario"}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-sub mb-1 block">Nome *</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) =>
                  setDraft({ ...draft, name: e.target.value })
                }
                className="input w-full"
                placeholder="es. Stefano, Lorenzo, Casa al mare…"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-sub mb-1 block">Note</span>
              <input
                type="text"
                value={draft.notes ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, notes: e.target.value })
                }
                className="input w-full"
                placeholder="Descrizione opzionale"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={submit}
              disabled={pending || !draft.name.trim()}
              className="btn"
            >
              Salva
            </button>
            <button onClick={cancelEdit} className="btn-ghost">
              Annulla
            </button>
          </div>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-line">
            <tr className="text-left text-xs uppercase tracking-wider text-sub">
              <th className="px-4 py-2.5 font-semibold">Nome</th>
              <th className="px-4 py-2.5 font-semibold text-right">Conti</th>
              <th className="px-4 py-2.5 font-semibold text-right">
                Categorie
              </th>
              <th className="px-4 py-2.5 font-semibold text-right">Movimenti</th>
              <th className="px-4 py-2.5 font-semibold text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-line2 last:border-b-0 hover:bg-bg/50"
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {r.isActive && (
                      <span className="pill bg-brand-50 text-brand-600 text-[10px]">
                        attivo
                      </span>
                    )}
                  </div>
                  {r.notes && (
                    <div className="text-[11px] text-sub mt-0.5">
                      {r.notes}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right num-mono text-sub">
                  {r.accountCount}
                </td>
                <td className="px-4 py-2.5 text-right num-mono text-sub">
                  {r.categoryCount}
                </td>
                <td className="px-4 py-2.5 text-right num-mono text-sub">
                  {r.txCount}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-1">
                    {!r.isActive && (
                      <button
                        onClick={() => handleActivate(r)}
                        disabled={pending}
                        className="btn-ghost !h-7 !text-xs"
                        title="Imposta come attivo"
                      >
                        Attiva
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(r)}
                      disabled={pending || creating}
                      className="btn-ghost !h-7 !text-xs"
                    >
                      Rinomina
                    </button>
                    <button
                      onClick={() => openDelete(r)}
                      disabled={pending}
                      className="btn-ghost !h-7 !text-xs text-err-600 hover:bg-err-50"
                    >
                      Elimina
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deletingRow && (
        <DeleteHolderDialog
          row={deletingRow}
          isEmpty={isEmpty(deletingRow)}
          confirmName={deleteConfirmName}
          onConfirmNameChange={setDeleteConfirmName}
          pending={pending}
          onCancel={closeDelete}
          onSoftDelete={() => runDelete(deletingRow, false)}
          onHardDelete={() => runDelete(deletingRow, true)}
        />
      )}
    </div>
  );
}

function DeleteHolderDialog({
  row,
  isEmpty,
  confirmName,
  onConfirmNameChange,
  pending,
  onCancel,
  onSoftDelete,
  onHardDelete,
}: {
  row: IntestatarioRow;
  isEmpty: boolean;
  confirmName: string;
  onConfirmNameChange: (v: string) => void;
  pending: boolean;
  onCancel: () => void;
  onSoftDelete: () => void;
  onHardDelete: () => void;
}) {
  const nameMatches = confirmName.trim() === row.name;

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/40"
        onClick={onCancel}
        aria-hidden
      />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-[480px] max-w-[92vw] bg-white border border-line rounded-lg shadow-2xl">
        <div className="px-5 py-4 border-b border-line">
          <div className="text-sm font-semibold">
            Elimina intestatario "{row.name}"
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          {isEmpty ? (
            <p className="text-ink2">
              L'intestatario non ha movimenti, conti né categorie collegati.
              L'eliminazione è sicura.
            </p>
          ) : (
            <>
              <p className="text-ink2">
                L'intestatario contiene:
              </p>
              <ul className="text-[13px] bg-err-50 border border-err-200 rounded-md p-3 space-y-0.5">
                <li>
                  <span className="num-mono font-semibold">
                    {row.txCount.toLocaleString("it-IT")}
                  </span>{" "}
                  movimenti
                </li>
                <li>
                  <span className="num-mono font-semibold">
                    {row.accountCount}
                  </span>{" "}
                  conti
                </li>
                <li>
                  <span className="num-mono font-semibold">
                    {row.categoryCount}
                  </span>{" "}
                  categorie
                </li>
                <li className="text-sub text-[12px] pt-1">
                  + tutti i budget, override, forecast, template di import e
                  storico import collegati.
                </li>
              </ul>
              <p className="text-err-600 font-medium">
                Tutto questo verrà cancellato in modo definitivo e irreversibile.
              </p>
              <div>
                <label className="text-[11px] text-sub block mb-1">
                  Per confermare, digita esattamente{" "}
                  <span className="font-mono font-semibold text-ink">
                    {row.name}
                  </span>
                </label>
                <input
                  type="text"
                  value={confirmName}
                  onChange={(e) => onConfirmNameChange(e.target.value)}
                  className="input w-full"
                  placeholder={row.name}
                  autoFocus
                />
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line bg-bg flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="btn-ghost text-xs"
          >
            Annulla
          </button>
          {isEmpty ? (
            <button
              onClick={onSoftDelete}
              disabled={pending}
              className="btn text-xs bg-err-600 hover:bg-err-700 border-err-600"
            >
              Elimina
            </button>
          ) : (
            <button
              onClick={onHardDelete}
              disabled={pending || !nameMatches}
              className="btn text-xs bg-err-600 hover:bg-err-700 border-err-600 disabled:opacity-40"
            >
              Elimina con tutti i dati
            </button>
          )}
        </div>
      </div>
    </>
  );
}
