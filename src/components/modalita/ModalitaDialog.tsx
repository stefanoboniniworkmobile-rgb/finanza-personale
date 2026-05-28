"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  saveModalita,
  deleteModalita,
  type ModalitaInput,
} from "@/app/(app)/modalita/actions";
import { useRouter } from "next/navigation";

export type ModalitaDialogValue = Partial<ModalitaInput> & { id?: string };

export function ModalitaDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: ModalitaDialogValue;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(initial?.name ?? "");
    setNotes(initial?.notes ?? "");
  }, [open, initial]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: ModalitaInput = {
      id: initial?.id,
      name,
      notes: notes || null,
    };
    startTransition(async () => {
      const res = await saveModalita(payload);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  const handleDelete = () => {
    if (!initial?.id) return;
    if (
      !confirm(
        "Eliminare questa modalità? I movimenti collegati resteranno (modalità verrà azzerata).",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteModalita(initial.id!);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="rounded-lg border border-line shadow-2xl p-0 backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      style={{ maxWidth: 440, width: "calc(100vw - 32px)" }}
    >
      <form onSubmit={handleSubmit} className="bg-white">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-semibold text-base">
              {initial?.id ? "Modifica modalità" : "Nuova modalità"}
            </div>
            <div className="text-xs text-sub">Strumento di pagamento</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sub hover:text-ink text-lg leading-none w-7 h-7 grid place-items-center"
            aria-label="Chiudi"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Nome">
            <input
              type="text"
              required
              maxLength={80}
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Es. Bancomat, Apple Pay, Bonifico"
            />
          </Field>

          <Field label="Note (opzionale)">
            <textarea
              maxLength={300}
              rows={2}
              className="input w-full !h-auto py-2"
              value={notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Es. solo per spese ricorrenti"
            />
          </Field>

          {error && (
            <div className="text-xs px-3 py-2 rounded-md bg-err-50 text-err-600 border border-err-100">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line bg-bg flex items-center justify-between gap-2">
          {initial?.id ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="btn-ghost !text-err-600 hover:!bg-err-50"
            >
              Elimina
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="btn-ghost"
            >
              Annulla
            </button>
            <button type="submit" disabled={isPending} className="btn">
              {isPending ? "Salvataggio…" : initial?.id ? "Salva" : "Crea modalità"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}
