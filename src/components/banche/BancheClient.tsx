"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  syncBankConnectionAction,
  previewSyncAction,
  deleteBankConnectionAction,
  verifyBankBalanceAction,
  type BalanceCheck,
} from "@/app/(app)/bank-connections-actions";
import type { PreviewTx } from "@/lib/psd2/sync";

type Row = {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  aspspName: string;
  aspspCountry: string;
  provider: string;
  status: string;
  errorMessage: string | null;
  validUntilIso: string;
  lastSyncAtIso: string | null;
  lastSyncedTxDateIso: string | null;
  txCount: number;
};

type PreviewState = {
  connId: string;
  aspspName: string;
  lastSyncAtIso: string | null;
  preview: PreviewTx[];
  wouldInsert: number;
  wouldUpdate: number;
  wouldSkip: number;
  range: { min: string; max: string } | null;
  elapsedMs: number;
};

export function BancheClient({
  rows,
  bankAccounts: _bankAccounts,
  initialMessage,
}: {
  rows: Row[];
  bankAccounts: { id: string; name: string }[];
  initialMessage?: { kind: "ok" | "err"; msg: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Record<string, "preview" | "commit" | "delete" | "balance" | null>>({});
  const [balanceCheck, setBalanceCheck] = useState<{
    aspspName: string;
    data: BalanceCheck;
  } | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    initialMessage ?? null,
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Modal "Sincronizza da una data": l'utente clicca "Da data..." su una
  // connessione, sceglie la data (es. 1 anno fa), e il sync usa quella
  // come dateFrom. Risolve il caso "il primo sync ha scaricato solo gli
  // ultimi 2 movimenti perché il BankAccount aveva già qualche tx in DB".
  const [dateSyncFor, setDateSyncFor] = useState<{
    connId: string;
    aspspName: string;
  } | null>(null);
  /**
   * Set di previewId per cui l'utente ha scelto di "sostituire la tx manuale":
   * alla conferma, oltre a importare la PSD2, viene cancellata la tx manuale
   * matchata (duplicateMatch.id). Solo per righe con suspectedDuplicate=true.
   */
  const [replacements, setReplacements] = useState<Set<string>>(new Set());
  const [showAlreadyPresent, setShowAlreadyPresent] = useState(false);
  const [, startTransition] = useTransition();

  function showToast(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 5000);
  }

  /**
   * Inizializza la selezione di default:
   * - "insert" (incluse quelle marcate suspectedDuplicate) → selezionate
   * - "update" con isHealing=true → selezionate (servono a popolare il
   *   providerEntryRef sulle tx legacy, sennò il bug dedup ritorna)
   * - "update" normale → NON selezionato (sono refresh metadata su tx già
   *   correttamente riconosciute, di solito unchanged)
   * - "skip" → NON selezionate (sono no-op comunque)
   */
  function initialSelection(items: PreviewTx[]): Set<string> {
    return new Set(
      items
        .filter((p) => p.action === "insert" || p.isHealing)
        .map((p) => p.id),
    );
  }

  async function handlePreview(id: string, aspspName: string, lastSyncAtIso: string | null) {
    setBusy((b) => ({ ...b, [id]: "preview" }));
    try {
      const res = await previewSyncAction(id);
      if (res.ok && res.data) {
        setPreview({
          connId: id,
          aspspName,
          lastSyncAtIso,
          preview: res.data.preview,
          wouldInsert: res.data.wouldInsert,
          wouldUpdate: res.data.wouldUpdate,
          wouldSkip: res.data.wouldSkip,
          range: res.data.range,
          elapsedMs: res.data.elapsedMs,
        });
        setSelected(initialSelection(res.data.preview));
        setReplacements(new Set());
        setShowAlreadyPresent(false);
      } else if (!res.ok) {
        showToast("err", `✗ ${res.error}`);
      }
    } finally {
      setBusy((b) => ({ ...b, [id]: null }));
    }
  }

  async function handleCommit() {
    if (!preview) return;
    const { connId, aspspName } = preview;
    setBusy((b) => ({ ...b, [connId]: "commit" }));
    try {
      // Per i replacements: oltre a importare la PSD2, raccolgo gli id delle
      // tx manuali da cancellare. Il match arriva da preview.duplicateMatch.
      const replaceManualTxIds: string[] = [];
      for (const previewId of replacements) {
        if (!selected.has(previewId)) continue; // solo se anche importi la PSD2
        const tx = preview.preview.find((p) => p.id === previewId);
        if (tx?.duplicateMatch?.id) replaceManualTxIds.push(tx.duplicateMatch.id);
      }
      const res = await syncBankConnectionAction(connId, {
        selectedIds: Array.from(selected),
        replaceManualTxIds,
      });
      if (res.ok && res.data) {
        const { inserted, updated, skipped, healed, manualReplaced } = res.data;
        const parts: string[] = [];
        if (inserted > 0) parts.push(`${inserted} importate`);
        if (updated > 0) parts.push(`${updated} aggiornate`);
        if (healed > 0) parts.push(`${healed} guarite`);
        if (manualReplaced && manualReplaced > 0)
          parts.push(`${manualReplaced} manuali sostituite`);
        if (skipped > 0) parts.push(`${skipped} saltate`);
        if (parts.length === 0) parts.push("nessuna nuova");
        showToast("ok", `✓ ${aspspName}: ${parts.join(", ")}`);
        setPreview(null);
        setSelected(new Set());
        setReplacements(new Set());
        startTransition(() => router.refresh());
      } else if (!res.ok) {
        showToast("err", `✗ ${res.error}`);
      }
    } finally {
      setBusy((b) => ({ ...b, [connId]: null }));
    }
  }

  function toggleReplacement(id: string) {
    setReplacements((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible(visibleIds: string[]) {
    const allSelected = visibleIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  /**
   * Esegue il sync con una data esplicita di partenza. Salta il preview
   * (chiama direttamente syncBankConnectionAction con opts.from). Utile per
   * recuperare lo storico quando il sync auto-incrementale ha pescato poco
   * perché c'erano già tx nel BankAccount.
   */
  async function handleDateSync(connId: string, aspspName: string, dateIso: string) {
    setBusy((b) => ({ ...b, [connId]: "commit" }));
    setDateSyncFor(null);
    try {
      const res = await syncBankConnectionAction(connId, { from: dateIso });
      if (res.ok && res.data) {
        const { inserted, updated, healed } = res.data;
        const parts: string[] = [];
        if (inserted > 0) parts.push(`${inserted} importate`);
        if (updated > 0) parts.push(`${updated} aggiornate`);
        if (healed > 0) parts.push(`${healed} guarite`);
        if (parts.length === 0) parts.push("nessuna nuova");
        showToast(
          "ok",
          `✓ ${aspspName} (dal ${dateIso}): ${parts.join(", ")}`,
        );
        startTransition(() => router.refresh());
      } else if (!res.ok) {
        showToast("err", `✗ ${res.error}`);
      }
    } finally {
      setBusy((b) => ({ ...b, [connId]: null }));
    }
  }

  async function handleVerifyBalance(id: string, aspspName: string) {
    setBusy((b) => ({ ...b, [id]: "balance" }));
    try {
      const res = await verifyBankBalanceAction(id);
      if (res.ok && res.data) {
        setBalanceCheck({ aspspName, data: res.data });
      } else if (!res.ok) {
        showToast("err", `✗ ${res.error}`);
      }
    } finally {
      setBusy((b) => ({ ...b, [id]: null }));
    }
  }

  async function handleDelete(id: string, name: string, txCount: number) {
    const txMsg =
      txCount > 0
        ? `\n\nLe ${txCount} transazioni già importate restano nei tuoi movimenti (perdono solo il legame con questa connessione).`
        : "";
    if (
      !confirm(
        `Cancellare il collegamento "${name}"?${txMsg}\n\nIl consenso viene anche revocato presso la banca. Per ricollegarti dovrai rifare il consent flow (SCA).`,
      )
    )
      return;
    setBusy((b) => ({ ...b, [id]: "delete" }));
    try {
      const res = await deleteBankConnectionAction(id);
      if (res.ok) {
        const kept = res.data?.txKept ?? 0;
        showToast(
          "ok",
          `✓ Collegamento "${name}" cancellato${kept > 0 ? ` (${kept} transazioni conservate)` : ""}`,
        );
        startTransition(() => router.refresh());
      } else {
        showToast("err", `✗ ${res.error}`);
      }
    } finally {
      setBusy((b) => ({ ...b, [id]: null }));
    }
  }

  if (rows.length === 0) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-sm text-sub mb-3">
          Nessuna banca ancora connessa per questo intestatario.
        </p>
        <a href="/impostazioni/banche/collega" className="btn">
          + Collega il primo conto
        </a>
      </div>
    );
  }

  return (
    <>
      {toast && (
        <div
          className={`mb-3 panel p-3 text-sm ${
            toast.kind === "ok"
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--line2)] text-xs uppercase text-sub">
            <tr>
              <th className="text-left px-3 py-2">Banca</th>
              <th className="text-left px-3 py-2">Conto</th>
              <th className="text-left px-3 py-2">Stato</th>
              <th className="text-left px-3 py-2">Ultimo sync</th>
              <th className="text-left px-3 py-2">Scadenza</th>
              <th className="text-right px-3 py-2">Tx</th>
              <th className="text-right px-3 py-2">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ongoing = busy[r.id];
              const validUntil = new Date(r.validUntilIso);
              const lastSync = r.lastSyncAtIso ? new Date(r.lastSyncAtIso) : null;
              const daysToExpiry = Math.ceil(
                (validUntil.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
              );
              const expiringSoon = daysToExpiry > 0 && daysToExpiry <= 14;
              const expired = daysToExpiry <= 0;

              return (
                <tr
                  key={r.id}
                  className="border-t border-[var(--line)] hover:bg-[var(--line2)]/40"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.aspspName}</div>
                    <div className="text-xs text-sub">{r.aspspCountry}</div>
                  </td>
                  <td className="px-3 py-2">{r.bankAccountName}</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      status={r.status}
                      expired={expired}
                      expiringSoon={expiringSoon}
                    />
                    {r.errorMessage && (
                      <div
                        className="text-xs text-red-700 mt-0.5 max-w-xs truncate"
                        title={r.errorMessage}
                      >
                        {r.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {lastSync ? (
                      <>
                        {lastSync.toLocaleDateString("it-IT")}{" "}
                        <span className="text-sub">
                          {lastSync.toLocaleTimeString("it-IT", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </>
                    ) : (
                      <span className="text-sub">Mai</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {validUntil.toLocaleDateString("it-IT")}
                    <div className="text-sub">
                      {expired
                        ? "Scaduta"
                        : daysToExpiry === 1
                          ? "domani"
                          : `${daysToExpiry} giorni`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.txCount}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="inline-flex flex-col items-end gap-0.5">
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => handlePreview(r.id, r.aspspName, r.lastSyncAtIso)}
                        disabled={!!ongoing || expired}
                        title={
                          expired
                            ? "Consenso scaduto — ricollega"
                            : "Scarica e mostra preview transazioni prima dell'import"
                        }
                      >
                        {ongoing === "preview"
                          ? "Carico..."
                          : ongoing === "commit"
                            ? "Importo..."
                            : "Sincronizza"}
                      </button>
                      {lastSync && (
                        <span className="text-[10px] text-sub">
                          Ultimo: {lastSync.toLocaleDateString("it-IT", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                          })}{" "}
                          {lastSync.toLocaleTimeString("it-IT", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn-ghost text-xs ml-2"
                      onClick={() =>
                        setDateSyncFor({ connId: r.id, aspspName: r.aspspName })
                      }
                      disabled={!!ongoing || expired}
                      title={
                        expired
                          ? "Consenso scaduto"
                          : "Scarica transazioni a partire da una data specifica (utile per recuperare storico)"
                      }
                    >
                      Da data…
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs ml-2"
                      onClick={() => handleVerifyBalance(r.id, r.aspspName)}
                      disabled={!!ongoing || expired}
                      title={
                        expired
                          ? "Consenso scaduto"
                          : "Verifica il saldo della banca e confrontalo con il saldo calcolato dai movimenti in DB"
                      }
                    >
                      {ongoing === "balance" ? "..." : "Saldo"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs text-red-700 ml-2"
                      onClick={() => handleDelete(r.id, r.aspspName, r.txCount)}
                      disabled={!!ongoing}
                      title="Cancella collegamento (le tx restano nei movimenti)"
                    >
                      {ongoing === "delete" ? "..." : "Cancella"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal "Sincronizza da una data" */}
      {dateSyncFor && (
        <DateSyncModal
          aspspName={dateSyncFor.aspspName}
          onCancel={() => setDateSyncFor(null)}
          onConfirm={(dateIso) =>
            handleDateSync(dateSyncFor.connId, dateSyncFor.aspspName, dateIso)
          }
        />
      )}

      {/* Modal verifica saldo */}
      {balanceCheck && (
        <BalanceCheckModal
          aspspName={balanceCheck.aspspName}
          data={balanceCheck.data}
          onClose={() => setBalanceCheck(null)}
        />
      )}

      {/* Modal preview */}
      {preview && (
        <PreviewModal
          state={preview}
          selected={selected}
          replacements={replacements}
          showAlreadyPresent={showAlreadyPresent}
          onToggleSelect={toggleSelected}
          onToggleAllVisible={toggleAllVisible}
          onToggleReplacement={toggleReplacement}
          onToggleShowAlreadyPresent={() => setShowAlreadyPresent((v) => !v)}
          onCancel={() => {
            setPreview(null);
            setSelected(new Set());
            setReplacements(new Set());
          }}
          onConfirm={handleCommit}
          confirming={busy[preview.connId] === "commit"}
        />
      )}
    </>
  );
}

/**
 * Modal "Sincronizza da una data": piccolo dialog con date input e preset
 * rapidi (ultimo mese / 3 mesi / 6 mesi / 1 anno / 2 anni). L'utente sceglie
 * la data di partenza e il sync chiama listTransactions con dateFrom = quel
 * valore — bypassando la logica auto-incrementale che altrimenti partirebbe
 * dall'ultima tx in DB.
 *
 * NB: la banca potrebbe NON avere lo storico fino alla data scelta — in quel
 * caso l'API torna solo quello che ha. Niente errore.
 */
function DateSyncModal({
  aspspName,
  onCancel,
  onConfirm,
}: {
  aspspName: string;
  onCancel: () => void;
  onConfirm: (dateIso: string) => void;
}) {
  // Default: 1 anno fa. È il sweet spot tra "abbastanza per popolare la
  // base storica" e "non troppo per non sforare i limiti EB della banca".
  const defaultDate = new Date();
  defaultDate.setFullYear(defaultDate.getFullYear() - 1);
  const defaultIso = defaultDate.toISOString().slice(0, 10);
  const [dateIso, setDateIso] = useState<string>(defaultIso);

  function setPresetMonths(n: number) {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    setDateIso(d.toISOString().slice(0, 10));
  }
  function setPresetYears(n: number) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - n);
    setDateIso(d.toISOString().slice(0, 10));
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg border border-line shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line">
          <div className="font-semibold text-base">
            Sincronizza da una data — {aspspName}
          </div>
          <div className="text-xs text-sub mt-0.5">
            Scarica le transazioni a partire dalla data scelta. Utile per
            recuperare storico che il sync automatico non aveva preso.
          </div>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-1">
              Data inizio
            </div>
            <input
              type="date"
              className="input w-full"
              value={dateIso}
              onChange={(e) => setDateIso(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-1">
              Preset rapidi
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="btn-ghost !text-[11px] !h-7"
                onClick={() => setPresetMonths(1)}
              >
                Ultimo mese
              </button>
              <button
                type="button"
                className="btn-ghost !text-[11px] !h-7"
                onClick={() => setPresetMonths(3)}
              >
                3 mesi
              </button>
              <button
                type="button"
                className="btn-ghost !text-[11px] !h-7"
                onClick={() => setPresetMonths(6)}
              >
                6 mesi
              </button>
              <button
                type="button"
                className="btn-ghost !text-[11px] !h-7"
                onClick={() => setPresetYears(1)}
              >
                1 anno
              </button>
              <button
                type="button"
                className="btn-ghost !text-[11px] !h-7"
                onClick={() => setPresetYears(2)}
              >
                2 anni
              </button>
              <button
                type="button"
                className="btn-ghost !text-[11px] !h-7"
                onClick={() => setPresetYears(5)}
              >
                5 anni
              </button>
            </div>
          </div>
          <div className="text-[11px] text-sub leading-relaxed">
            Le transazioni già importate non vengono duplicate (dedup
            automatico). Quelle nuove vengono aggiunte.{" "}
            <strong>Nota</strong>: molte banche italiane via PSD2 espongono
            solo gli <em>ultimi 60-90 giorni</em> di storico, anche se chiedi
            indietro un anno. È un limite della banca, non aggirabile
            dall&apos;app. Per dati più vecchi serve l&apos;import del file
            dall&apos;area clienti della banca.
          </div>
        </div>
        <div className="px-5 py-3 border-t border-line bg-bg flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost">
            Annulla
          </button>
          <button
            type="button"
            onClick={() => onConfirm(dateIso)}
            disabled={!dateIso}
            className="btn"
          >
            Scarica da {dateIso}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  expired,
  expiringSoon,
}: {
  status: string;
  expired: boolean;
  expiringSoon: boolean;
}) {
  const effective = expired ? "expired" : expiringSoon ? "expiring" : status;
  const label =
    effective === "active"
      ? "Attiva"
      : effective === "expiring"
        ? "In scadenza"
        : effective === "expired"
          ? "Scaduta"
          : effective === "error"
            ? "Errore"
            : effective === "revoked"
              ? "Revocata"
              : effective;
  const color =
    effective === "active"
      ? "bg-green-100 text-green-800"
      : effective === "expiring"
        ? "bg-amber-100 text-amber-800"
        : effective === "expired"
          ? "bg-gray-200 text-gray-700"
          : effective === "error"
            ? "bg-red-100 text-red-800"
            : "bg-gray-200 text-gray-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      ● {label}
    </span>
  );
}

function PreviewModal({
  state,
  selected,
  replacements,
  showAlreadyPresent,
  onToggleSelect,
  onToggleAllVisible,
  onToggleReplacement,
  onToggleShowAlreadyPresent,
  onCancel,
  onConfirm,
  confirming,
}: {
  state: PreviewState;
  selected: Set<string>;
  replacements: Set<string>;
  showAlreadyPresent: boolean;
  onToggleSelect: (id: string) => void;
  onToggleAllVisible: (ids: string[]) => void;
  onToggleReplacement: (id: string) => void;
  onToggleShowAlreadyPresent: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const total = state.preview.length;
  const allInserts = state.preview.filter((p) => p.action === "insert");
  const allUpdates = state.preview.filter((p) => p.action === "update");
  const healingUpdates = allUpdates.filter((p) => p.isHealing);
  const pureUpdates = allUpdates.filter((p) => !p.isHealing);
  const allSkips = state.preview.filter((p) => p.action === "skip");
  const suspects = state.preview.filter((p) => p.suspectedDuplicate);

  // Visible: di default solo le tx "nuove" (action=insert).
  // Toggle showAlreadyPresent rivela anche update + skip (tx già in DB,
  // incluse quelle che hanno bisogno di healing del providerEntryRef).
  const visible = useMemo(() => {
    const filtered = showAlreadyPresent
      ? state.preview
      : state.preview.filter((p) => p.action === "insert");
    return [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  }, [state.preview, showAlreadyPresent]);

  const visibleIds = visible.map((v) => v.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  const selectedCount = selected.size;
  const alreadyPresentCount = allUpdates.length + allSkips.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[var(--line)] p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Anteprima sync</h2>
            <div className="text-xs text-sub mt-0.5">
              {state.aspspName} · {state.elapsedMs}ms ·{" "}
              {state.range
                ? `range ${state.range.min} → ${state.range.max}`
                : "nessuna transazione nel range"}
              {state.lastSyncAtIso && (
                <>
                  {" · "}ultimo sync:{" "}
                  {new Date(state.lastSyncAtIso).toLocaleDateString("it-IT", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                  })}{" "}
                  {new Date(state.lastSyncAtIso).toLocaleTimeString("it-IT", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={onCancel}
            disabled={confirming}
          >
            ✕
          </button>
        </div>

        {/* Riassunto + toggle */}
        <div className="border-b border-[var(--line)] p-3 flex flex-wrap gap-3 text-sm items-center">
          <Badge color="green" label={`${allInserts.length} nuove`} />
          {suspects.length > 0 && (
            <Badge
              color="yellow"
              label={`⚠ ${suspects.length} probabile duplicato`}
            />
          )}
          {healingUpdates.length > 0 && (
            <Badge
              color="blue"
              label={`↻ ${healingUpdates.length} guarigione ref`}
            />
          )}
          {alreadyPresentCount > 0 && (
            <button
              type="button"
              className={`text-xs px-2 py-0.5 rounded border ${
                showAlreadyPresent
                  ? "bg-gray-200 border-gray-300 text-gray-800"
                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
              onClick={onToggleShowAlreadyPresent}
              title={
                showAlreadyPresent
                  ? "Nascondi tx già presenti in DB"
                  : "Mostra anche tx già presenti (aggiornamenti + skip)"
              }
            >
              {showAlreadyPresent ? "▾" : "▸"} {alreadyPresentCount} già presenti
              {pureUpdates.length > 0 || allSkips.length > 0
                ? ` (${pureUpdates.length} aggiorn. + ${allSkips.length} skip)`
                : ""}
            </button>
          )}
          <span className="text-sub ml-auto">
            Totale scaricate: <strong>{total}</strong> · Visibili:{" "}
            <strong>{visible.length}</strong> · Selezionate:{" "}
            <strong>{selectedCount}</strong>
          </span>
        </div>

        {/* Tabella */}
        <div className="flex-1 overflow-auto">
          {visible.length === 0 ? (
            <div className="p-8 text-center text-sm text-sub">
              {total === 0
                ? "Nessuna transazione scaricata nel range."
                : "Nessuna transazione nuova. Tutte già presenti in DB."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[var(--line2)] text-xs uppercase text-sub sticky top-0">
                <tr>
                  <th className="text-center px-2 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            !allVisibleSelected && someVisibleSelected;
                      }}
                      onChange={() => onToggleAllVisible(visibleIds)}
                      title={
                        allVisibleSelected
                          ? "Deseleziona tutte visibili"
                          : "Seleziona tutte visibili"
                      }
                    />
                  </th>
                  <th className="text-left px-3 py-2">Data</th>
                  <th className="text-left px-3 py-2">Descrizione</th>
                  <th className="text-right px-3 py-2">Importo</th>
                  <th className="text-center px-3 py-2">Azione</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((tx) => {
                  const isSelected = selected.has(tx.id);
                  const willReplace = replacements.has(tx.id);
                  const dupTitle = tx.duplicateMatch
                    ? `Probabile duplicato di un movimento già presente:\n${tx.duplicateMatch.date} · ${tx.duplicateMatch.amount.toFixed(2)} € · ${tx.duplicateMatch.description}`
                    : "";
                  return (
                    <tr
                      key={tx.id}
                      className={`border-t border-[var(--line)] ${
                        tx.suspectedDuplicate ? "bg-amber-50/60" : ""
                      } ${!isSelected ? "opacity-50" : ""}`}
                    >
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelect(tx.id)}
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums">
                        {tx.date}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="max-w-md truncate" title={tx.description}>
                          {tx.description}
                        </div>
                        {tx.suspectedDuplicate && tx.duplicateMatch && (
                          <div className="mt-1 flex flex-col gap-0.5">
                            <span
                              className="inline-block self-start px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200 text-amber-900 cursor-help"
                              title={dupTitle}
                            >
                              ⚠ probabile duplicato di:{" "}
                              {tx.duplicateMatch.date} ·{" "}
                              {tx.duplicateMatch.amount.toFixed(2)} € ·{" "}
                              {tx.duplicateMatch.description.slice(0, 60)}
                              {tx.duplicateMatch.description.length > 60 ? "…" : ""}
                            </span>
                            <label
                              className="inline-flex items-center gap-1 text-[10px] text-amber-900 cursor-pointer self-start"
                              title={`Alla conferma cancella la tx manuale "${tx.duplicateMatch.description.slice(0, 80)}" e importa questa al suo posto`}
                            >
                              <input
                                type="checkbox"
                                checked={willReplace}
                                disabled={!isSelected}
                                onChange={() => onToggleReplacement(tx.id)}
                                className="scale-90"
                              />
                              <span>
                                ↔ sostituisci la tx manuale (cancella e
                                rimpiazza)
                              </span>
                            </label>
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-medium ${
                          tx.type === "income"
                            ? "text-green-700"
                            : "text-red-700"
                        }`}
                      >
                        {tx.type === "income" ? "+" : "-"}
                        {tx.amount.toLocaleString("it-IT", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        €
                      </td>
                      <td className="px-3 py-2 text-center">
                        <ActionPill action={tx.action} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--line)] p-3 flex items-center justify-between gap-2">
          <div className="text-xs text-sub">
            I movimenti deselezionati non verranno importati. I sospetti
            duplicati sono pre-selezionati ma evidenziati in giallo —
            spunta &quot;↔ sostituisci&quot; per cancellare la versione
            manuale al posto di tenerle entrambe.
            {replacements.size > 0 && (
              <span className="block mt-1 text-amber-800 font-medium">
                Verranno sostituite {replacements.size}{" "}
                {replacements.size === 1 ? "tx manuale" : "tx manuali"} esistenti.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="btn-ghost"
              onClick={onCancel}
              disabled={confirming}
            >
              Annulla
            </button>
            <button
              type="button"
              className="btn"
              onClick={onConfirm}
              disabled={confirming || selectedCount === 0}
            >
              {confirming
                ? "Importazione in corso..."
                : selectedCount === 0
                  ? "Nessuna selezionata"
                  : `Conferma import (${selectedCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Badge({
  color,
  label,
}: {
  color: "green" | "amber" | "yellow" | "blue" | "gray";
  label: string;
}) {
  const cls =
    color === "green"
      ? "bg-green-100 text-green-800"
      : color === "amber"
        ? "bg-amber-100 text-amber-800"
        : color === "yellow"
          ? "bg-amber-200 text-amber-900"
          : color === "blue"
            ? "bg-blue-100 text-blue-800"
            : "bg-gray-200 text-gray-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function ActionPill({ action }: { action: PreviewTx["action"] }) {
  const cfg =
    action === "insert"
      ? { label: "Nuova", cls: "bg-green-100 text-green-800" }
      : action === "update"
        ? { label: "Aggiorna", cls: "bg-amber-100 text-amber-800" }
        : { label: "Skip", cls: "bg-gray-200 text-gray-700" };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function BalanceCheckModal({
  aspspName,
  data,
  onClose,
}: {
  aspspName: string;
  data: BalanceCheck;
  onClose: () => void;
}) {
  // Tolleranza: < 1€ = ok (verde), < 10€ = warning (giallo), oltre = rosso
  const absDelta = Math.abs(data.delta);
  const status: "ok" | "warn" | "err" =
    absDelta < 1 ? "ok" : absDelta < 10 ? "warn" : "err";
  const statusCls =
    status === "ok"
      ? "bg-green-100 text-green-800 border-green-300"
      : status === "warn"
        ? "bg-amber-100 text-amber-800 border-amber-300"
        : "bg-red-100 text-red-800 border-red-300";
  const statusLabel =
    status === "ok"
      ? "● Saldi allineati"
      : status === "warn"
        ? "● Differenza minima"
        : "● Saldi disallineati";

  const fmt = (n: number) =>
    n.toLocaleString("it-IT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const balanceTypeLabel: Record<string, string> = {
    CLBD: "Saldo contabile (chiusura)",
    OPBD: "Saldo contabile (apertura)",
    AVLB: "Saldo disponibile",
    ITAV: "Disponibile intra-giornaliero",
    CLAV: "Disponibile a chiusura",
    FWAV: "Disponibile prospettico",
    PRCD: "Saldo contabile precedente",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--line)] p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Verifica saldo</h2>
            <div className="text-xs text-sub mt-0.5">
              {aspspName} · {data.bankAccountName}
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="p-4">
          <div
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${statusCls} mb-4`}
          >
            {statusLabel}
          </div>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-[var(--line)]">
                <td className="py-2 text-sub">Saldo banca</td>
                <td className="py-2 text-right tabular-nums font-medium">
                  {fmt(data.bankBalance)} {data.bankBalanceCurrency}
                </td>
              </tr>
              <tr className="border-b border-[var(--line)]">
                <td className="py-2 text-sub text-xs pl-3" colSpan={2}>
                  {balanceTypeLabel[data.bankBalanceType] ??
                    data.bankBalanceType}
                  {data.bankReferenceDate && (
                    <> · al {data.bankReferenceDate}</>
                  )}
                </td>
              </tr>
              <tr className="border-b border-[var(--line)]">
                <td className="py-2 text-sub">Saldo app (calcolato)</td>
                <td className="py-2 text-right tabular-nums font-medium">
                  {fmt(data.appBalance)} EUR
                </td>
              </tr>
              <tr className="border-b border-[var(--line)]">
                <td className="py-2 text-sub text-xs pl-3" colSpan={2}>
                  Iniziale {fmt(data.appInitialBalance)} + {data.appTxCount}{" "}
                  movimenti
                </td>
              </tr>
              <tr>
                <td className="py-3 font-medium">Differenza (banca − app)</td>
                <td
                  className={`py-3 text-right tabular-nums font-semibold text-lg ${
                    status === "ok"
                      ? "text-green-700"
                      : status === "warn"
                        ? "text-amber-700"
                        : "text-red-700"
                  }`}
                >
                  {data.delta >= 0 ? "+" : "−"}
                  {fmt(Math.abs(data.delta))} EUR
                </td>
              </tr>
            </tbody>
          </table>
          {status !== "ok" && (
            <div className="mt-3 text-xs text-sub">
              {status === "warn"
                ? "Differenza piccola, di solito imputabile a transazioni PDNG ancora non contabilizzate o ad arrotondamenti. Rifai il sync per allineare."
                : "Differenza significativa. Possibili cause: saldo iniziale del BankAccount sbagliato, transazioni mancanti, transazioni duplicate, oppure operazioni PDNG non ancora viste. Controlla in /movimenti."}
            </div>
          )}
        </div>
        <div className="border-t border-[var(--line)] p-3 flex justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
