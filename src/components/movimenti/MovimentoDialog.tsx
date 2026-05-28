"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  saveMovimento,
  deleteMovimento,
  type MovimentoInput,
  type ActionResult,
} from "@/app/(app)/movimenti/actions";
import { useRouter } from "next/navigation";
import { NumberInput } from "@/components/ui/NumberInput";

export type DialogOption = { id: string; name: string; type?: string };

// Le categorie nella dialog hanno bisogno di metadati in più per gestire
// i trasferimenti tra conti: il flag isTransfer abilita la richiesta del
// conto di contropartita al momento dell'inserimento.
export type CategoryDialogOption = DialogOption & {
  isTransfer?: boolean;
  counterpartCategoryId?: string | null;
};

export type MovimentoDialogValue = Partial<MovimentoInput> & {
  id?: string;
  // Se valorizzato, il movimento è parte di un giroconto esistente.
  // Usato per mostrare il badge nella dialog e per disabilitare la duplica
  // (la duplica di un giroconto è "duplica solo il lato corrente",
  // non l'intero gruppo — l'utente deve scegliere il nuovo conto contropartita).
  transferGroupId?: string | null;
  counterpartBankAccountName?: string | null;
};

export function MovimentoDialog({
  open,
  onClose,
  initial,
  categories,
  accounts,
  paymentMethods,
}: {
  open: boolean;
  onClose: () => void;
  initial?: MovimentoDialogValue;
  categories: CategoryDialogOption[];
  accounts: DialogOption[];
  paymentMethods: DialogOption[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Stato form locale
  const [type, setType] = useState<"income" | "expense">(initial?.type ?? "expense");
  const [date, setDate] = useState<string>(
    initial?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amountNum, setAmountNum] = useState<number | null>(
    initial?.amount !== undefined && initial.amount !== null ? initial.amount : null,
  );
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [bankAccountId, setBankAccountId] = useState(initial?.bankAccountId ?? "");
  const [paymentMethodId, setPaymentMethodId] = useState(initial?.paymentMethodId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [reconciled, setReconciled] = useState<boolean>(initial?.reconciled ?? false);
  const [reconciliationNote, setReconciliationNote] = useState<string>(
    initial?.reconciliationNote ?? "",
  );
  // Conto di contropartita per le causali di trasferimento.
  // - In create: la UI inferisce il conto sibling dal contesto se possibile,
  //   altrimenti chiede all'utente.
  // - In edit di un giroconto esistente: pre-compilato col bankAccountId del
  //   sibling letto dal server (via initial?.counterpartBankAccountId).
  const [counterpartBankAccountId, setCounterpartBankAccountId] = useState<string>(
    initial?.counterpartBankAccountId ?? "",
  );

  // Flag "sto duplicando": passa da false a true quando l'utente clicca
  // "Duplica" dentro al dialog. Dopo la transizione, il dialog si comporta
  // come se fosse un NUOVO movimento (titolo, label del submit, niente
  // pulsanti Elimina/Duplica, niente badge di giroconto) MA mantiene i
  // campi pre-compilati dell'originale così l'utente può modificarli
  // prima di confermare. Salvataggio = CREATE (id assente).
  //
  // Pattern usato altrove (es. magic-link sign in che cambia step dentro
  // lo stesso form): introduco state derivato `effectiveId` /
  // `effectiveTransferGroupId` che valgono undefined/null quando
  // isDuplicating è attivo. Tutta la UI che differenzia "edit vs create"
  // legge questi valori derivati invece di `initial?.id`.
  const [isDuplicating, setIsDuplicating] = useState(false);

  // Sync con initial quando cambia (es. apro un altro movimento)
  useEffect(() => {
    if (!open) return;
    setError(null);
    setType(initial?.type ?? "expense");
    setDate(initial?.date ?? new Date().toISOString().slice(0, 10));
    setDescription(initial?.description ?? "");
    setAmountNum(
      initial?.amount !== undefined && initial.amount !== null ? initial.amount : null,
    );
    setCategoryId(initial?.categoryId ?? "");
    setBankAccountId(initial?.bankAccountId ?? "");
    setPaymentMethodId(initial?.paymentMethodId ?? "");
    setNotes(initial?.notes ?? "");
    setReconciled(initial?.reconciled ?? false);
    setReconciliationNote(initial?.reconciliationNote ?? "");
    setCounterpartBankAccountId(initial?.counterpartBankAccountId ?? "");
    // Riapertura del dialog su un altro movimento → esce dalla modalità
    // duplica, torna allo stato coerente con initial.
    setIsDuplicating(false);
  }, [open, initial]);

  // Valori "effettivi": quando isDuplicating è true ignoriamo l'id e il
  // gruppo trasferimento dell'originale. Tutti i posti che dipendono da
  // "edit vs create" o "fa parte di un giroconto" leggono qui.
  const effectiveId = isDuplicating ? undefined : initial?.id;
  const effectiveTransferGroupId = isDuplicating
    ? null
    : initial?.transferGroupId ?? null;
  const effectiveCounterpartName = isDuplicating
    ? null
    : initial?.counterpartBankAccountName ?? null;

  // Open/close del <dialog>
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const filteredCategories = categories.filter((c) => c.type === type);
  // Categoria attualmente selezionata, con meta (isTransfer ecc.).
  // Usata per decidere se mostrare il campo "Conto di contropartita".
  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId],
  );
  const isTransferCategory = selectedCategory?.isTransfer === true;
  // Lista conti contropartita: tutti gli account dell'Holder tranne quello
  // scelto come "conto principale" del movimento (non avrebbe senso fare un
  // giroconto verso sé stessi).
  const counterpartOptions = useMemo(
    () => accounts.filter((a) => a.id !== bankAccountId),
    [accounts, bankAccountId],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Validazione locale extra: se la categoria è transfer, il conto
    // contropartita è obbligatorio. Il server lo ricontrolla, ma diamo
    // un feedback immediato all'utente.
    if (isTransferCategory && !counterpartBankAccountId) {
      setError(
        "Hai scelto una causale di trasferimento: seleziona anche il conto di contropartita.",
      );
      return;
    }
    if (
      isTransferCategory &&
      counterpartBankAccountId &&
      counterpartBankAccountId === bankAccountId
    ) {
      setError("Il conto di contropartita deve essere diverso dal conto principale.");
      return;
    }
    const payload: MovimentoInput = {
      id: effectiveId,
      date,
      description,
      amount: amountNum ?? 0,
      type,
      categoryId,
      bankAccountId,
      paymentMethodId: paymentMethodId || null,
      notes: notes || null,
      reconciled,
      reconciliationNote: reconciliationNote.trim() ? reconciliationNote.trim() : null,
      counterpartBankAccountId: isTransferCategory
        ? counterpartBankAccountId || null
        : null,
    };
    startTransition(async () => {
      const res: ActionResult = await saveMovimento(payload);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  const handleDelete = () => {
    if (!effectiveId) return;
    // Per i giroconti chiediamo conferma specifica che cita anche il sibling.
    const msg = effectiveTransferGroupId
      ? `Questo è un giroconto: verrà eliminato ANCHE il movimento speculare ${
          effectiveCounterpartName
            ? `su "${effectiveCounterpartName}"`
            : "sull'altro conto"
        }. Procedere?`
      : "Eliminare questo movimento? L'azione non è reversibile.";
    if (!confirm(msg)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteMovimento(effectiveId);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  /**
   * Duplica IN-PLACE: trasforma il dialog corrente in "Nuovo movimento"
   * pre-compilato. NON salva subito — l'utente vede il dialog cambiato di
   * stato (titolo "Nuovo movimento", bottone "Crea movimento", niente più
   * Elimina/Duplica/badge giroconto) e può modificare quello che vuole
   * prima di confermare.
   *
   * Cosa cambia:
   *  - id → undefined (via isDuplicating=true): il prossimo Salva sarà un CREATE
   *  - transferGroupId virtuale → null: niente più banner giroconto, e
   *    se la categoria era di trasferimento, il salvataggio creerà un
   *    NUOVO group (nuovo sibling sul conto contropartita).
   *  - date → oggi (uso tipico: "ho rifatto la stessa spesa")
   *  - reconciled → false, reconciliationNote → "" (il duplicato non
   *    eredita lo stato di riconciliazione)
   *  - Tutto il resto (description, amount, category, account, notes,
   *    counterpartBankAccountId) resta com'è: l'utente può cambiarlo a mano.
   *
   * Nota: per i giroconti questo è significativo — duplichi un giroconto
   * "Mediolanum → Cassa" e l'utente può cambiare l'importo prima di Salva,
   * generando un nuovo pair coerente sull'altro conto.
   */
  const handleDuplicate = () => {
    setError(null);
    const todayIso = new Date().toISOString().slice(0, 10);
    setDate(todayIso);
    setReconciled(false);
    setReconciliationNote("");
    setIsDuplicating(true);
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Click fuori dal contenuto → chiudi
        if (e.target === ref.current) onClose();
      }}
      className="rounded-lg border border-line shadow-2xl p-0 backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      style={{ maxWidth: 560, width: "calc(100vw - 32px)" }}
    >
      <form onSubmit={handleSubmit} className="bg-white">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-semibold text-base">
              {effectiveId ? "Modifica movimento" : "Nuovo movimento"}
            </div>
            <div className="text-xs text-sub">
              {isDuplicating
                ? "Duplica del movimento originale — modifica quello che serve, poi crea"
                : effectiveId
                ? "Aggiorna i campi e salva"
                : "Compila i campi obbligatori"}
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
          {/* Badge giroconto: visibile solo se siamo in EDIT di un movimento
              che fa già parte di un transferGroup. Sparisce in modalità
              "duplica" perché il duplicato genera (se la categoria è di
              trasferimento) un nuovo group a sé stante. */}
          {effectiveTransferGroupId && (
            <div className="text-xs px-3 py-2 rounded-md bg-brand-50/60 text-brand-600 border border-brand-500/30 flex items-start gap-2">
              <span aria-hidden>↔</span>
              <div>
                <div className="font-medium">Giroconto</div>
                <div className="text-[11px] opacity-90">
                  Questo movimento è legato a un movimento speculare
                  {effectiveCounterpartName
                    ? ` sul conto "${effectiveCounterpartName}"`
                    : " sull'altro conto"}
                  . Modifiche e cancellazione si propagano a entrambi i lati.
                </div>
              </div>
            </div>
          )}

          {/* Banner "stai duplicando" — mostrato quando l'utente ha cliccato
              Duplica dentro un movimento esistente. Comunica chiaramente che
              salvando si crea un NUOVO record. */}
          {isDuplicating && (
            <div className="text-xs px-3 py-2 rounded-md bg-warn-50 text-warn-600 border border-warn-500/30 flex items-start gap-2">
              <span aria-hidden>＋</span>
              <div>
                <div className="font-medium">Duplica in corso</div>
                <div className="text-[11px] opacity-90">
                  Stai creando un nuovo movimento basato sui dati di quello
                  originale (data impostata a oggi). Modifica i campi che
                  servono e poi conferma con &quot;Crea movimento&quot;. L&apos;originale
                  resta invariato.
                </div>
              </div>
            </div>
          )}

          {/* Tipo (toggle) */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setType("expense");
                setCategoryId("");
              }}
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
              onClick={() => {
                setType("income");
                setCategoryId("");
              }}
              className={`flex-1 h-9 rounded-md text-sm font-medium border transition ${
                type === "income"
                  ? "bg-ok-50 border-ok-500 text-ok-600"
                  : "bg-white border-line text-sub hover:bg-bg"
              }`}
            >
              Entrata
            </button>
          </div>

          {/* Data + Importo */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data">
              <input
                type="date"
                required
                className="input w-full"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Importo (€)">
              <NumberInput
                value={amountNum}
                onValueChange={setAmountNum}
                required
                min={0}
                className="input w-full text-right num-mono"
                placeholder="0,00"
              />
            </Field>
          </div>

          {/* Descrizione */}
          <Field label="Descrizione">
            <textarea
              required
              maxLength={1000}
              rows={2}
              className="input w-full resize-y min-h-[40px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Es. Spesa Esselunga"
            />
          </Field>

          {/* Categoria + Conto */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Categoria (${type === "income" ? "entrata" : "uscita"})`}>
              <select
                required
                className="input w-full"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">— seleziona —</option>
                {filteredCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Conto">
              <select
                required
                className="input w-full"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">— seleziona —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Conto di contropartita: appare SOLO se la categoria selezionata
              è di trasferimento (isTransfer=true). Obbligatorio in quel caso.
              Il sistema creerà un movimento speculare su questo conto, con
              segno opposto e categoria contropartita. */}
          {isTransferCategory && (
            <Field
              label="Conto di contropartita (giroconto)"
            >
              <select
                required
                className={`input w-full ${
                  !counterpartBankAccountId
                    ? "border-warn-500 bg-warn-50/30"
                    : ""
                }`}
                value={counterpartBankAccountId}
                onChange={(e) => setCounterpartBankAccountId(e.target.value)}
              >
                <option value="">— seleziona il conto sull'altro lato —</option>
                {counterpartOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-sub mt-1">
                Verrà creato in automatico un movimento speculare su questo
                conto con segno opposto. Es. <em>Mediolanum → Cassa</em>:
                uscita su Mediolanum + entrata uguale su Cassa.
              </div>
            </Field>
          )}

          {/* Modalità (opzionale) + Note */}
          <Field label="Modalità di pagamento">
            <select
              className="input w-full"
              value={paymentMethodId ?? ""}
              onChange={(e) => setPaymentMethodId(e.target.value)}
            >
              <option value="">— nessuna —</option>
              {paymentMethods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Note (opzionale)">
            <textarea
              maxLength={500}
              rows={2}
              className="input w-full !h-auto py-2"
              value={notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Annotazioni libere"
            />
          </Field>

          {/* Riconciliazione */}
          <div className="rounded-md border border-line bg-bg/40 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={reconciled}
                onChange={(e) => {
                  const next = e.target.checked;
                  // Se sta togliendo il flag su un movimento che ERA riconciliato (stato salvato a DB)
                  // chiede conferma. Se invece sta solo annullando una spunta appena messa, no.
                  if (!next && (initial?.reconciled ?? false)) {
                    const ok = window.confirm(
                      "Questo movimento risulta già riconciliato con l'estratto. Vuoi davvero rimuovere il flag di riconciliazione?",
                    );
                    if (!ok) return;
                  }
                  setReconciled(next);
                }}
              />
              Riconciliato con estratto banca
            </label>
            <Field label="Nota riconciliazione (opzionale)">
              <input
                type="text"
                maxLength={200}
                className="input w-full"
                value={reconciliationNote}
                onChange={(e) => setReconciliationNote(e.target.value)}
                placeholder='Es. "e/c aprile 2026"'
              />
            </Field>
          </div>

          {error && (
            <div className="text-xs px-3 py-2 rounded-md bg-err-50 text-err-600 border border-err-100">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line bg-bg flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {/* Elimina e Duplica appaiono solo se siamo in EDIT vero (esiste
                un id E non siamo in modalità duplica). In modalità duplica
                il dialog si comporta come "Nuovo movimento". */}
            {effectiveId && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="btn-ghost !text-err-600 hover:!bg-err-50"
              >
                Elimina
              </button>
            )}
            {effectiveId && (
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={isPending}
                title="Crea un nuovo movimento basato su questo — puoi modificare i campi prima di salvare"
                className="btn-ghost"
              >
                Duplica
              </button>
            )}
          </div>
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
              {isPending
                ? "Salvataggio…"
                : effectiveId
                ? "Salva modifiche"
                : "Crea movimento"}
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
