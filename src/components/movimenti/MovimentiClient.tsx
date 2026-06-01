"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MovimentoDialog,
  type DialogOption,
  type CategoryDialogOption,
  type MovimentoDialogValue,
} from "./MovimentoDialog";
import { fmtDateFull, fmtN } from "@/lib/format";
import {
  bulkSetReconciliation,
  toggleReconciled,
} from "@/app/(app)/movimenti/actions";

export type MovimentoRow = {
  id: string;
  date: string; // ISO "YYYY-MM-DD"
  description: string;
  amount: number;
  type: "income" | "expense";
  categoryId: string;
  categoryName: string;
  categoryType: "income" | "expense";
  bankAccountId: string;
  bankAccountName: string;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  notes: string | null;
  // Riconciliazione
  reconciled: boolean;
  reconciledAt: string | null;   // ISO
  reconciliationNote: string | null;
  // Saldo progressivo del conto dopo questo movimento (calcolato lato server,
  // valorizzato solo quando l'utente filtra per un conto specifico)
  runningBalance: number | null;
  // Giroconto: se valorizzato, il movimento fa parte di un transfer group.
  // counterpartBankAccountName è il nome del conto dell'altro lato, usato
  // per il tooltip del badge "↔" e per il messaggio di conferma delete.
  transferGroupId: string | null;
  counterpartBankAccountId: string | null;
  counterpartBankAccountName: string | null;
  // Origine del movimento — derivata dalla presenza di bankConnectionId
  // (PSD2 sync da banca) o importBatchId (import file CSV/Excel/PDF). Se
  // entrambi assenti = manuale. `sourceLabel` è il nome leggibile della
  // banca o del batch, usato come tooltip del badge.
  source: "manual" | "import" | "psd2";
  sourceLabel: string | null;
};

export type AccountInfo = {
  name: string;
  initialBalance: number;
  currentBalance: number;
};

export function MovimentiClient({
  rows,
  categories,
  accounts,
  paymentMethods,
  accountInfo,
}: {
  rows: MovimentoRow[];
  // Le categorie ora portano isTransfer/counterpartCategoryId perché il
  // MovimentoDialog deve mostrare/non mostrare la select del conto contropartita.
  categories: CategoryDialogOption[];
  accounts: DialogOption[];
  paymentMethods: DialogOption[];
  accountInfo: AccountInfo | null;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MovimentoDialogValue | undefined>();

  // Selezione multipla
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkPending, startBulk] = useTransition();
  const [rowPending, startRow] = useTransition();
  const [bulkNote, setBulkNote] = useState("");

  // Reset della selezione quando cambia il set di righe visibili (es. cambio pagina/filtri).
  // Manteniamo solo gli id che sono ancora nella lista corrente.
  const rowIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  // Compute pruned selection lazily quando serve
  const effectiveSelected = useMemo(() => {
    const out = new Set<string>();
    for (const id of selected) if (rowIds.has(id)) out.add(id);
    return out;
  }, [selected, rowIds]);
  const selectedIds = useMemo(() => [...effectiveSelected], [effectiveSelected]);
  const selectedCount = selectedIds.length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const openNew = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  const openEdit = (r: MovimentoRow) => {
    setEditing({
      id: r.id,
      date: r.date,
      description: r.description,
      amount: r.amount,
      type: r.type,
      categoryId: r.categoryId,
      bankAccountId: r.bankAccountId,
      paymentMethodId: r.paymentMethodId ?? null,
      notes: r.notes ?? null,
      reconciled: r.reconciled,
      reconciliationNote: r.reconciliationNote ?? null,
      // Giroconto: passiamo i metadati al dialog così può mostrare badge
      // + select contropartita pre-compilata + conferma delete corretta.
      transferGroupId: r.transferGroupId,
      counterpartBankAccountId: r.counterpartBankAccountId,
      counterpartBankAccountName: r.counterpartBankAccountName,
    });
    setDialogOpen(true);
  };

  const onToggleRic = (id: string, current: boolean) => {
    // Conferma SOLO quando si sta togliendo una riconciliazione esistente.
    if (current) {
      const ok = window.confirm(
        "Questo movimento risulta già riconciliato con l'estratto. Vuoi davvero rimuovere il flag di riconciliazione?",
      );
      if (!ok) return;
    }
    startRow(async () => {
      const r = await toggleReconciled(id);
      if (r.ok) router.refresh();
    });
  };

  const runBulk = (reconciled: boolean, withNote: boolean) => {
    if (selectedCount === 0) return;
    // Se sto togliendo la riconciliazione → conferma esplicita con conteggio
    if (!reconciled) {
      const alreadyReconciled = rows.filter(
        (r) => effectiveSelected.has(r.id) && r.reconciled,
      ).length;
      const msg =
        alreadyReconciled > 0
          ? `Stai per annullare la riconciliazione di ${alreadyReconciled} movimenti già riconciliati (su ${selectedCount} selezionati). Procedere?`
          : `Stai per annullare la riconciliazione di ${selectedCount} movimenti. Procedere?`;
      const ok = window.confirm(msg);
      if (!ok) return;
    }
    const note = withNote ? bulkNote : undefined;
    startBulk(async () => {
      const r = await bulkSetReconciliation(selectedIds, reconciled, note);
      if (r.ok) {
        clearSelection();
        if (withNote) setBulkNote("");
        router.refresh();
      }
    });
  };

  const showBalance = accountInfo !== null;
  // Colonne: select + Data + Desc + Cat + Conto + Modalità + Importo + (Saldo?) + Ric.
  const colSpan = 8 + (showBalance ? 1 : 0);

  return (
    <>
      <div className="flex items-center justify-between mb-3 gap-3">
        {accountInfo ? (
          <div className="panel px-3 py-2 text-xs flex items-center gap-4 num-mono">
            <span>
              <span className="text-sub">Conto:</span>{" "}
              <strong className="num">{accountInfo.name}</strong>
            </span>
            <span>
              <span className="text-sub">Saldo iniziale:</span>{" "}
              <strong className={`num ${accountInfo.initialBalance < 0 ? "text-err-600" : ""}`}>
                {fmtN(accountInfo.initialBalance)} €
              </strong>
            </span>
            <span>
              <span className="text-sub">Saldo attuale:</span>{" "}
              <strong className={`num ${accountInfo.currentBalance < 0 ? "text-err-600" : "text-ok-600"}`}>
                {fmtN(accountInfo.currentBalance)} €
              </strong>
            </span>
            <span className="text-[10px] text-sub">
              (calcolato su tutti i movimenti del conto, anche fuori dai filtri di vista)
            </span>
          </div>
        ) : (
          <span />
        )}
        <button onClick={openNew} className="btn">
          + Nuovo movimento
        </button>
      </div>

      {/* Barra azioni bulk — visibile solo con selezione attiva */}
      {selectedCount > 0 && (
        <div className="panel p-3 mb-3 flex flex-wrap items-center gap-3 bg-brand-50/40 border-brand-500/30">
          <div className="text-sm font-medium">
            {selectedCount} selezionati
          </div>
          <input
            type="text"
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            placeholder='Nota riconciliazione (es. "e/c aprile")'
            maxLength={200}
            className="input !h-8 !py-0 flex-1 min-w-[220px] max-w-[420px]"
            disabled={bulkPending}
          />
          <button
            type="button"
            onClick={() => runBulk(true, true)}
            disabled={bulkPending || bulkNote.trim().length === 0}
            className="btn !h-8 !text-xs"
            title="Marca come riconciliati e scrive la nota su ciascuno"
          >
            Riconcilia con nota
          </button>
          <button
            type="button"
            onClick={() => runBulk(true, false)}
            disabled={bulkPending}
            className="btn-ghost !h-8 !text-xs"
            title="Marca come riconciliati senza toccare la nota"
          >
            Riconcilia
          </button>
          <button
            type="button"
            onClick={() => runBulk(false, false)}
            disabled={bulkPending}
            className="btn-ghost !h-8 !text-xs !text-err-600 hover:!bg-err-50"
            title="Rimuove il flag di riconciliazione (la nota resta)"
          >
            Annulla riconciliazione
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={bulkPending}
            className="btn-ghost !h-8 !text-xs"
          >
            Deseleziona tutto
          </button>
        </div>
      )}

      <div className="panel overflow-hidden">
        <table className="dense">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label="Seleziona tutti"
                />
              </th>
              <th style={{ width: 110 }}>Data</th>
              <th>Descrizione</th>
              <th>Categoria</th>
              <th>Conto</th>
              <th>Modalità</th>
              <th className="text-right" style={{ width: 130 }}>
                Importo
              </th>
              {showBalance && (
                <th className="text-right" style={{ width: 130 }}>
                  Saldo
                </th>
              )}
              <th className="text-center" style={{ width: 64 }} title="Riconciliato con estratto banca">
                Ric.
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-12 text-center text-sub">
                  Nessun movimento per i filtri attuali. Modifica i filtri o aggiungi un movimento.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isSel = effectiveSelected.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={`row cursor-pointer ${isSel ? "bg-brand-50/40" : ""}`}
                  onClick={() => openEdit(r)}
                >
                  <td
                    onClick={(e) => e.stopPropagation()}
                    className="text-center"
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleOne(r.id)}
                      aria-label="Seleziona riga"
                    />
                  </td>
                  <td className="num-mono text-sub">
                    {fmtDateFull(new Date(r.date))}
                  </td>
                  <td>
                    <div
                      className="whitespace-normal break-words leading-snug max-w-[520px] flex items-baseline gap-2"
                      title={r.description}
                    >
                      <span className="flex-1">{r.description}</span>
                      <SourceBadge source={r.source} label={r.sourceLabel} />
                    </div>
                    {r.notes && (
                      <div
                        className="text-xs text-sub whitespace-normal break-words leading-snug max-w-[520px] mt-0.5"
                        title={r.notes}
                      >
                        {r.notes}
                      </div>
                    )}
                    {r.reconciliationNote && (
                      <div
                        className="text-[11px] text-sub italic whitespace-normal break-words leading-snug max-w-[520px] mt-0.5"
                        title={`Nota riconciliazione: ${r.reconciliationNote}`}
                      >
                        ⚑ {r.reconciliationNote}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`pill ${
                        r.type === "income" ? "bg-ok-50 text-ok-600" : "bg-line2 text-ink2"
                      }`}
                    >
                      {r.categoryName}
                    </span>
                  </td>
                  <td className="text-ink2">
                    {r.bankAccountName}
                    {r.transferGroupId && (
                      <span
                        className="ml-1.5 inline-flex items-center text-[10px] font-medium text-brand-600 bg-brand-50 border border-brand-500/30 rounded px-1 py-px align-middle"
                        title={
                          r.counterpartBankAccountName
                            ? `Giroconto — contropartita su "${r.counterpartBankAccountName}"`
                            : "Giroconto"
                        }
                      >
                        ↔
                      </span>
                    )}
                  </td>
                  <td className="text-sub">{r.paymentMethodName ?? ""}</td>
                  <td
                    className={`text-right num-mono font-medium ${
                      r.type === "income" ? "text-ok-600" : "text-ink"
                    }`}
                  >
                    {r.type === "income" ? "+" : "-"}
                    {fmtN(r.amount)} €
                  </td>
                  {showBalance && (
                    <td
                      className={`text-right num-mono ${
                        r.runningBalance !== null && r.runningBalance < 0
                          ? "text-err-600"
                          : "text-sub"
                      }`}
                    >
                      {r.runningBalance !== null ? `${fmtN(r.runningBalance)} €` : "—"}
                    </td>
                  )}
                  <td className="text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => onToggleRic(r.id, r.reconciled)}
                      disabled={rowPending}
                      title={r.reconciled ? "Riconciliato — clicca per annullare (chiede conferma)" : "Da riconciliare — clicca per spuntare"}
                      className={`w-6 h-6 grid place-items-center rounded border text-xs leading-none transition ${
                        r.reconciled
                          ? "bg-ok-50 border-ok-500 text-ok-600"
                          : "bg-white border-line text-sub hover:bg-bg"
                      }`}
                      aria-pressed={r.reconciled}
                    >
                      {r.reconciled ? "✓" : ""}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <MovimentoDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        categories={categories}
        accounts={accounts}
        paymentMethods={paymentMethods}
      />
    </>
  );
}

/**
 * Badge origine del movimento. Tre stati: manuale, importato (file CSV/Excel/PDF),
 * PSD2 (sync banca via Enable Banking). I primi due si distinguono per colore
 * sottile; il tooltip ne svela la fonte specifica (nome del file o della banca).
 *
 * I dati arrivano già calcolati dal server component (vedi `movimenti/page.tsx`
 * → mapping txs.map). Niente fetch o calcolo qui dentro.
 */
function SourceBadge({
  source,
  label,
}: {
  source: "manual" | "import" | "psd2";
  label: string | null;
}) {
  if (source === "manual") {
    return (
      <span
        className="text-[10px] font-medium uppercase tracking-wide text-sub bg-line2/60 border border-line2 rounded px-1.5 py-px shrink-0"
        title="Inserito a mano"
      >
        Man.
      </span>
    );
  }
  if (source === "import") {
    return (
      <span
        className="text-[10px] font-medium uppercase tracking-wide text-acc-700 bg-acc-50 border border-acc-100 rounded px-1.5 py-px shrink-0"
        title={label ? `Importato dal file: ${label}` : "Importato da file"}
      >
        Imp.
      </span>
    );
  }
  // psd2
  return (
    <span
      className="text-[10px] font-medium uppercase tracking-wide text-brand-600 bg-brand-50 border border-brand-500/30 rounded px-1.5 py-px shrink-0"
      title={label ? `Sincronizzato da: ${label}` : "Sincronizzato da banca via PSD2"}
    >
      PSD2
    </span>
  );
}
