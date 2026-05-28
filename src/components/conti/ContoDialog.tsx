"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  saveConto,
  deleteConto,
  type ContoInput,
} from "@/app/(app)/conti/actions";
import { useRouter } from "next/navigation";
import { NumberInput } from "@/components/ui/NumberInput";

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "liquidity", label: "Conto corrente / liquidità" },
  { value: "credit_card", label: "Carta di credito / e-wallet" },
  { value: "savings", label: "Risparmio / investimento" },
  { value: "cash", label: "Contanti / cassa" },
];

export type ContoDialogValue = Partial<ContoInput> & { id?: string };

export function ContoDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: ContoDialogValue;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<string>(initial?.type ?? "liquidity");
  const [initialBalanceNum, setInitialBalanceNum] = useState<number | null>(
    initial?.initialBalance != null ? initial.initialBalance : 0,
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [iban, setIban] = useState(initial?.iban ?? "");
  const [cardMaskedPan, setCardMaskedPan] = useState(initial?.cardMaskedPan ?? "");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(initial?.name ?? "");
    setType(initial?.type ?? "liquidity");
    setInitialBalanceNum(initial?.initialBalance != null ? initial.initialBalance : 0);
    setNotes(initial?.notes ?? "");
    setIban(initial?.iban ?? "");
    setCardMaskedPan(initial?.cardMaskedPan ?? "");
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
    const payload: ContoInput = {
      id: initial?.id,
      name,
      type: type as any,
      initialBalance: initialBalanceNum ?? 0,
      notes: notes || null,
      iban: iban.trim() || null,
      cardMaskedPan: cardMaskedPan.trim() || null,
    };
    startTransition(async () => {
      const res = await saveConto(payload);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  const handleDelete = () => {
    if (!initial?.id) return;
    if (!confirm("Eliminare questo conto?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteConto(initial.id!);
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
      style={{ maxWidth: 480, width: "calc(100vw - 32px)" }}
    >
      <form onSubmit={handleSubmit} className="bg-white">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-semibold text-base">
              {initial?.id ? "Modifica conto" : "Nuovo conto"}
            </div>
            <div className="text-xs text-sub">
              Imposta tipo, saldo iniziale e note
            </div>
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
              placeholder="Es. Intesa C/C, Carta Revolut, Cassa"
            />
          </Field>

          <Field label="Tipo">
            <select
              className="input w-full"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Saldo iniziale (€)">
            <NumberInput
              value={initialBalanceNum}
              onValueChange={setInitialBalanceNum}
              required
              keepZero
              className="input w-full text-right num-mono"
            />
            <div className="text-[11px] text-sub mt-1">
              Lo storico saldo del conto al momento dell'attivazione del
              tracciamento. I movimenti registrati lo modificheranno nel tempo.
            </div>
          </Field>

          <Field label="IBAN (opzionale)">
            <input
              type="text"
              maxLength={40}
              className="input w-full font-mono uppercase"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder="IT60X0542811101000000123456"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="text-[11px] text-sub mt-1">
              Necessario per l'aggancio automatico via PSD2 ai conti correnti.
              Spazi e maiuscole sono normalizzati automaticamente.
            </div>
          </Field>

          <Field label="Numero carta mascherato (opzionale)">
            <input
              type="text"
              maxLength={25}
              className="input w-full font-mono"
              value={cardMaskedPan}
              onChange={(e) => setCardMaskedPan(e.target.value)}
              placeholder="5189********6765"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="text-[11px] text-sub mt-1">
              Per le carte di credito: PAN mascherato come appare sull'estratto
              o sull'app della banca. Serve all'aggancio PSD2.
            </div>
          </Field>

          <Field label="Note (opzionale)">
            <textarea
              maxLength={300}
              rows={2}
              className="input w-full !h-auto py-2"
              value={notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Intestatario, scopo del conto, ecc."
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
              {isPending ? "Salvataggio…" : initial?.id ? "Salva" : "Crea conto"}
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
