"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  saveCategoria,
  deleteCategoria,
  type CategoriaInput,
} from "@/app/(app)/categorie/actions";
import { useRouter } from "next/navigation";
import { NumberInput } from "@/components/ui/NumberInput";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "AVG_3M", label: "Media ultimi 3 mesi" },
  { value: "AVG_6M", label: "Media ultimi 6 mesi" },
  { value: "AVG_12M", label: "Media ultimi 12 mesi" },
  { value: "PREV_MONTH", label: "Mese precedente" },
  { value: "SAME_MONTH_LY", label: "Stesso mese anno precedente" },
  { value: "MAX_3M", label: "Massimo ultimi 3 mesi (conservativo)" },
  { value: "ACTUAL_MONTH", label: "Consuntivo del mese (chi ha già speso)" },
  { value: "MANUAL", label: "Manuale (importo fisso)" },
];

export type CategoriaDialogValue = Partial<CategoriaInput> & { id?: string };

// Mini-tipo per le altre categorie disponibili come contropartita.
// Solo income/expense — i campi servono al matching opposto-tipo nella UI.
export type CounterpartOption = {
  id: string;
  name: string;
  type: "income" | "expense";
};

export function CategoriaDialog({
  open,
  onClose,
  initial,
  counterpartOptions = [],
}: {
  open: boolean;
  onClose: () => void;
  initial?: CategoriaDialogValue;
  // Tutte le altre categorie dell'Holder, usate per popolare la select
  // "Causale di contropartita" quando isTransfer è attivo. Verrà filtrata
  // lato componente per escludere la categoria stessa.
  counterpartOptions?: CounterpartOption[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<"income" | "expense">(initial?.type ?? "expense");
  const [showInDashboard, setShowInDashboard] = useState(initial?.showInDashboard ?? true);
  const [hasBudget, setHasBudget] = useState(initial?.hasBudget ?? true);
  const [budgetMode, setBudgetMode] = useState<string>(initial?.budgetMode ?? "AVG_3M");
  const [manualBudgetNum, setManualBudgetNum] = useState<number | null>(
    initial?.manualBudget != null ? initial.manualBudget : null,
  );
  const [isTransfer, setIsTransfer] = useState<boolean>(initial?.isTransfer ?? false);
  const [counterpartCategoryId, setCounterpartCategoryId] = useState<string>(
    initial?.counterpartCategoryId ?? "",
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(initial?.name ?? "");
    setType(initial?.type ?? "expense");
    setShowInDashboard(initial?.showInDashboard ?? true);
    setHasBudget(initial?.hasBudget ?? true);
    setBudgetMode(initial?.budgetMode ?? "AVG_3M");
    setManualBudgetNum(initial?.manualBudget != null ? initial.manualBudget : null);
    setIsTransfer(initial?.isTransfer ?? false);
    setCounterpartCategoryId(initial?.counterpartCategoryId ?? "");
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
    const payload: CategoriaInput = {
      id: initial?.id,
      name,
      type,
      showInDashboard,
      hasBudget,
      budgetMode,
      manualBudget: budgetMode === "MANUAL" ? manualBudgetNum ?? 0 : null,
      isTransfer,
      // Contropartita ha senso solo se è trasferimento. Stringa vuota → null.
      counterpartCategoryId:
        isTransfer && counterpartCategoryId.length > 0
          ? counterpartCategoryId
          : null,
    };
    startTransition(async () => {
      const res = await saveCategoria(payload);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  const handleDelete = () => {
    if (!initial?.id) return;
    if (!confirm("Eliminare questa categoria?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCategoria(initial.id!);
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
      style={{ maxWidth: 520, width: "calc(100vw - 32px)" }}
    >
      <form onSubmit={handleSubmit} className="bg-white">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-semibold text-base">
              {initial?.id ? "Modifica categoria" : "Nuova categoria"}
            </div>
            <div className="text-xs text-sub">
              Configura tipo, dashboard e regole budget
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
          {/* Tipo */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("expense")}
              className={`flex-1 h-9 rounded-md text-sm font-medium border transition ${
                type === "expense"
                  ? "bg-err-50 border-err-500 text-err-600"
                  : "bg-white border-line text-sub hover:bg-bg"
              }`}
            >
              Uscita
            </button>
            <button
              type="button"
              onClick={() => setType("income")}
              className={`flex-1 h-9 rounded-md text-sm font-medium border transition ${
                type === "income"
                  ? "bg-ok-50 border-ok-500 text-ok-600"
                  : "bg-white border-line text-sub hover:bg-bg"
              }`}
            >
              Entrata
            </button>
          </div>

          {/* Nome */}
          <Field label="Nome">
            <input
              type="text"
              required
              maxLength={80}
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Es. Alimentari, Utenze, …"
            />
          </Field>

          {/* Show in dashboard + has budget */}
          <div className="grid grid-cols-2 gap-3">
            <ToggleRow
              checked={showInDashboard}
              onChange={setShowInDashboard}
              label="Mostra in dashboard"
              hint="Compare nei grafici/donut"
            />
            <ToggleRow
              checked={hasBudget}
              onChange={setHasBudget}
              label="Budget attivo"
              hint="Compare nel pannello Budget"
            />
          </div>

          {/* Budget mode + manual amount */}
          <div className={hasBudget ? "" : "opacity-50 pointer-events-none"}>
            <Field label="Modalità di calcolo budget">
              <select
                className="input w-full"
                value={budgetMode}
                onChange={(e) => setBudgetMode(e.target.value)}
                disabled={!hasBudget}
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            {budgetMode === "MANUAL" && (
              <div className="mt-3">
                <Field label="Importo manuale (€)">
                  <NumberInput
                    value={manualBudgetNum}
                    onValueChange={setManualBudgetNum}
                    min={0}
                    className="input w-full text-right num-mono"
                    placeholder="0"
                    disabled={!hasBudget}
                  />
                </Field>
              </div>
            )}
            {budgetMode !== "MANUAL" && (
              <div className="mt-1 text-[11px] text-sub">
                L'importo verrà calcolato in automatico dallo storico.
              </div>
            )}
          </div>

          {/* ─── Causale di trasferimento ─────────────────────────────── */}
          <div className="rounded-md border border-line bg-bg/40 p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isTransfer}
                onChange={(e) => setIsTransfer(e.target.checked)}
                className="mt-0.5"
              />
              <div className="min-w-0">
                <div className="text-[13px] font-medium">
                  Causale di trasferimento tra conti
                </div>
                <div className="text-[11px] text-sub">
                  Quando inserisci un movimento con questa causale, l'app ti
                  chiede il <em>conto di contropartita</em> e crea
                  automaticamente il movimento speculare sull'altro conto
                  (segno opposto).
                </div>
              </div>
            </label>

            {isTransfer && (
              <div className="pl-6 space-y-2">
                <Field label="Causale di contropartita (opzionale)">
                  <select
                    className="input w-full"
                    value={counterpartCategoryId}
                    onChange={(e) => setCounterpartCategoryId(e.target.value)}
                  >
                    <option value="">
                      — usa la stessa causale sull'altro conto —
                    </option>
                    {counterpartOptions
                      .filter((c) => c.id !== initial?.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.type === "income" ? "entrata" : "uscita"})
                        </option>
                      ))}
                  </select>
                </Field>
                <div className="text-[11px] text-sub">
                  Tipico: questa causale è {type === "expense" ? "un'uscita" : "un'entrata"} (es.{" "}
                  <em>{type === "expense" ? "Trasferimento-" : "Trasferimento+"}</em>) e ha
                  come contropartita una causale di tipo opposto (es.{" "}
                  <em>{type === "expense" ? "Trasferimento+" : "Trasferimento-"}</em>). Se
                  lasci vuoto, l'app userà la stessa causale anche sull'altro lato.
                </div>
              </div>
            )}
          </div>

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
              {isPending ? "Salvataggio…" : initial?.id ? "Salva" : "Crea categoria"}
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

function ToggleRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 px-3 py-2 border border-line rounded-md cursor-pointer hover:bg-bg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-[11px] text-sub">{hint}</div>}
      </div>
    </label>
  );
}
