"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewImport,
  commitImport,
  type PreviewResult,
  type CommitInput,
} from "@/app/(app)/importazioni/actions";
import type { ProcessedRow } from "@/lib/import-engine";
import { matchPattern, proposePattern, type MatchType } from "@/lib/import-pattern";
import { fmtEURFull, fmtDateFull } from "@/lib/format";

type TemplateOpt = {
  id: string;
  name: string;
  fileType: string;
  sourceLabel: string | null;
};

type Option = { id: string; name: string };

type EditableRow = ProcessedRow & { include: boolean };

type LearnedRule = {
  kind: "ACCOUNT" | "CATEGORY" | "PAYMENT_METHOD";
  matchType: MatchType;
  pattern: string;
  targetId: string;
};

type GroupEdit = {
  editedPattern: string;
  matchType: MatchType;
  targetId: string;
};

const MATCH_LABEL: Record<MatchType, string> = {
  EXACT: "= esatto",
  CONTAINS: "contiene",
  STARTS_WITH: "inizia con",
  REGEX: "regex",
};

export function ImportFlow({
  templates,
  initialTemplateId,
  accounts,
  categoriesExpense,
  categoriesIncome,
  paymentMethods,
}: {
  templates: TemplateOpt[];
  initialTemplateId?: string;
  accounts: Option[];
  categoriesExpense: Option[];
  categoriesIncome: Option[];
  paymentMethods: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState<string>(
    initialTemplateId ?? templates[0]?.id ?? "",
  );
  const [file, setFile] = useState<File | null>(null);

  const [preview, setPreview] = useState<Extract<PreviewResult, { ok: true }> | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [filter, setFilter] = useState<"all" | "ready" | "needs" | "ambiguous" | "possible" | "duplicate" | "error">("all");
  const [showAdvancedRegex, setShowAdvancedRegex] = useState(false);

  // Pattern proposti per categoria — stato locale editabile per ogni gruppo
  const [groupEdits, setGroupEdits] = useState<Record<string, GroupEdit>>({});
  // Regole accumulate da salvare al commit
  const [rulesToSave, setRulesToSave] = useState<LearnedRule[]>([]);

  const selectedTemplate = templates.find((t) => t.id === templateId);

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!templateId) return setError("Seleziona un template");
    if (!file) return setError("Seleziona un file");

    const fd = new FormData();
    fd.append("templateId", templateId);
    fd.append("file", file);

    startTransition(async () => {
      const r = await previewImport(fd);
      if (!r.ok) return setError(r.error);
      setPreview(r);
      setRows(
        r.rows.map((row) => ({
          ...row,
          include: row.status === "ready" || row.status === "needs_mapping",
        })),
      );
      setGroupEdits({});
      setRulesToSave([]);
    });
  };

  const reset = () => {
    setPreview(null);
    setRows([]);
    setFile(null);
    setError(null);
    setSuccess(null);
    setFilter("all");
    setGroupEdits({});
    setRulesToSave([]);
  };

  // ---------- Helpers di update ----------
  const updateRow = (rowIndex: number, patch: Partial<EditableRow>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const next = { ...r, ...patch };
        // Se imposto manualmente la categoria, l'ambiguità si risolve
        if (patch.categoryId !== undefined && next.categoryCandidates?.length) {
          next.categoryCandidates = [];
        }
        // Ricalcolo lo status SOLO se l'utente ha cambiato conto/categoria,
        // e mai per duplicate/error/possible_duplicate (vanno preservati).
        const changedMapping =
          patch.bankAccountId !== undefined || patch.categoryId !== undefined;
        if (
          changedMapping &&
          next.status !== "duplicate" &&
          next.status !== "error" &&
          next.status !== "possible_duplicate"
        ) {
          next.status = next.bankAccountId && next.categoryId ? "ready" : "needs_mapping";
        }
        return next;
      }),
    );
  };

  // Apply bulk EXACT su sourceValue (per ACCOUNT/PAYMENT_METHOD)
  const applyBulkExact = (
    kind: "account" | "payment",
    sourceValueNorm: string,
    targetId: string,
  ) => {
    if (!targetId) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.status === "duplicate" || r.status === "error") return r;
        if (kind === "account") {
          if (norm(r.sourceAccount) !== sourceValueNorm) return r;
          if (r.bankAccountId) return r;
          const next = { ...r, bankAccountId: targetId };
          if (next.status !== "possible_duplicate") {
            next.status = next.bankAccountId && next.categoryId ? "ready" : "needs_mapping";
          }
          return next;
        }
        if (kind === "payment") {
          if (norm(r.sourcePayment) !== sourceValueNorm) return r;
          if (r.paymentMethodId) return r;
          return { ...r, paymentMethodId: targetId };
        }
        return r;
      }),
    );
  };

  // Apply pattern di categoria su righe matchanti
  const applyCategoryPattern = (
    type: "income" | "expense",
    pattern: string,
    matchType: MatchType,
    targetId: string,
  ) => {
    if (!pattern || !targetId) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.status === "duplicate" || r.status === "error") return r;
        if (r.categoryId) return r;
        if (r.type !== type) return r;
        if (!matchPattern(r.description, pattern, matchType)) return r;
        const next = {
          ...r,
          categoryId: targetId,
          categoryCandidates: [],
        };
        if (next.status !== "possible_duplicate") {
          next.status = next.bankAccountId && next.categoryId ? "ready" : "needs_mapping";
        }
        return next;
      }),
    );
    setRulesToSave((prev) => [
      ...prev,
      { kind: "CATEGORY", matchType, pattern, targetId },
    ]);
  };

  // ---------- Gruppi proposti per CATEGORIA ----------
  type CatGroup = {
    key: string; // type::pattern
    type: "income" | "expense";
    proposed: string;
    sampleDescriptions: string[];
    count: number;
  };
  const proposedCategoryGroups: CatGroup[] = useMemo(() => {
    const m = new Map<string, CatGroup>();
    for (const r of rows) {
      if (r.status === "duplicate" || r.status === "error") continue;
      if (r.categoryId) continue;
      if (!r.type || !r.description) continue;
      // Salto le righe con candidati multipli — la UI dedicata le gestisce
      if (r.categoryCandidates && r.categoryCandidates.length > 1) continue;
      const p = proposePattern(r.description);
      if (!p) continue;
      const key = `${r.type}::${p}`;
      const cur = m.get(key);
      if (cur) {
        cur.count++;
        if (cur.sampleDescriptions.length < 3) cur.sampleDescriptions.push(r.description);
      } else {
        m.set(key, {
          key,
          type: r.type,
          proposed: p,
          sampleDescriptions: [r.description],
          count: 1,
        });
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [rows]);

  // ---------- Gruppi per ACCOUNT/PAYMENT (logica vecchia, EXACT) ----------
  const pendingAccountPayment = useMemo(() => {
    const acc: Map<string, { sourceLabel: string; sourceNorm: string; count: number }> = new Map();
    const pay: Map<string, { sourceLabel: string; sourceNorm: string; count: number }> = new Map();
    const add = (
      mp: Map<string, { sourceLabel: string; sourceNorm: string; count: number }>,
      raw: string,
    ) => {
      const n = norm(raw);
      const label = raw.trim() === "" ? "(nessun valore nel file)" : raw;
      const cur = mp.get(n);
      if (cur) cur.count++;
      else mp.set(n, { sourceLabel: label, sourceNorm: n, count: 1 });
    };
    for (const r of rows) {
      if (r.status === "duplicate" || r.status === "error") continue;
      if (!r.bankAccountId) add(acc, r.sourceAccount);
      // Modalità di pagamento è opzionale: la mostro solo se il template mappa una colonna
      if (!r.paymentMethodId && r.sourcePayment) add(pay, r.sourcePayment);
    }
    return {
      accounts: [...acc.values()].sort((a, b) => b.count - a.count),
      payments: [...pay.values()].sort((a, b) => b.count - a.count),
    };
  }, [rows]);

  // ---------- Conteggi ----------
  const counts = useMemo(() => {
    const ambiguous = rows.filter(
      (r) =>
        (r.categoryCandidates?.length ?? 0) > 1 &&
        r.status !== "duplicate" &&
        r.status !== "error",
    ).length;
    return {
      total: rows.length,
      ready: rows.filter((r) => r.status === "ready").length,
      needs: rows.filter((r) => r.status === "needs_mapping").length,
      possible: rows.filter((r) => r.status === "possible_duplicate").length,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
      error: rows.filter((r) => r.status === "error").length,
      ambiguous,
      // Importabili = ready + possible_duplicate confermate via checkbox
      includedReady: rows.filter(
        (r) =>
          r.include && (r.status === "ready" || r.status === "possible_duplicate"),
      ).length,
    };
  }, [rows]);

  const hasPending =
    proposedCategoryGroups.length > 0 ||
    pendingAccountPayment.accounts.length > 0 ||
    pendingAccountPayment.payments.length > 0;

  // ---------- Confirm ----------
  const handleConfirm = () => {
    if (!preview) return;
    const toCommit = rows.filter(
      (r) =>
        r.include &&
        (r.status === "ready" || r.status === "possible_duplicate") &&
        r.date &&
        r.amount != null &&
        r.type &&
        r.bankAccountId &&
        r.categoryId,
    );
    if (toCommit.length === 0) {
      setError("Nessuna riga importabile selezionata");
      return;
    }
    // Dedupe regole
    const dedup: Record<string, LearnedRule> = {};
    for (const r of rulesToSave) {
      const k = `${r.kind}::${r.matchType}::${r.pattern.toLowerCase()}`;
      if (!dedup[k]) dedup[k] = r;
    }
    const payload: CommitInput = {
      templateId: preview.templateId,
      fileName: preview.fileName,
      rows: toCommit.map((r) => ({
        rowIndex: r.rowIndex,
        date: r.date!,
        description: r.description,
        amount: r.amount!,
        type: r.type!,
        notes: r.notes ?? null,
        bankAccountId: r.bankAccountId!,
        categoryId: r.categoryId!,
        paymentMethodId: r.paymentMethodId ?? null,
        sourceAccount: r.sourceAccount ?? "",
        sourceCategory: r.sourceCategory ?? "",
        sourcePayment: r.sourcePayment ?? "",
      })),
      totalRows: rows.length,
      duplicateCount: rows.filter((r) => r.status === "duplicate").length,
      errorCount: rows.filter((r) => r.status === "error").length,
      rulesToSave: Object.values(dedup),
    };
    startTransition(async () => {
      const r = await commitImport(payload);
      if (!r.ok) return setError(r.error);
      setSuccess(
        `Import completato: ${r.importedCount} movimenti aggiunti${
          r.duplicateInBatch > 0
            ? ` (${r.duplicateInBatch} duplicati scartati al salvataggio)`
            : ""
        }. Regole salvate: ${Object.keys(dedup).length}.`,
      );
      setTimeout(() => router.push("/importazioni"), 1500);
    });
  };

  // ---------- Filtro tabella ----------
  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "ready") return rows.filter((r) => r.status === "ready");
    if (filter === "needs") return rows.filter((r) => r.status === "needs_mapping" && (r.categoryCandidates?.length ?? 0) <= 1);
    if (filter === "ambiguous")
      return rows.filter(
        (r) =>
          (r.categoryCandidates?.length ?? 0) > 1 &&
          r.status !== "duplicate" &&
          r.status !== "error",
      );
    if (filter === "possible") return rows.filter((r) => r.status === "possible_duplicate");
    if (filter === "duplicate") return rows.filter((r) => r.status === "duplicate");
    if (filter === "error") return rows.filter((r) => r.status === "error");
    return rows;
  }, [rows, filter]);

  // ====================== STEP 1: UPLOAD ======================
  if (!preview) {
    return (
      <form onSubmit={handlePreview} className="space-y-4 max-w-2xl">
        <div className="panel p-5 space-y-4">
          <div>
            <div className="font-semibold text-sm">1. Scegli il template</div>
            <div className="text-[12px] text-sub">
              Le regole salvate sul template (pattern, default) verranno applicate al file.
            </div>
          </div>
          <select
            className="input w-full"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            required
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} {t.sourceLabel ? `— ${t.sourceLabel}` : ""} ({t.fileType.toUpperCase()})
              </option>
            ))}
          </select>
        </div>

        <div className="panel p-5 space-y-4">
          <div>
            <div className="font-semibold text-sm">2. Carica il file</div>
            <div className="text-[12px] text-sub">
              {selectedTemplate
                ? `Atteso: ${selectedTemplate.fileType.toUpperCase()}`
                : "Seleziona prima un template"}
            </div>
          </div>
          <input
            type="file"
            accept={selectedTemplate?.fileType === "xlsx" ? ".xlsx,.xls" : ".csv,.txt"}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-line file:bg-bg file:text-ink hover:file:bg-line2 file:cursor-pointer"
            required
          />
          {file && (
            <div className="text-[12px] text-sub">
              File: <span className="text-ink">{file.name}</span> ({Math.round(file.size / 1024)} KB)
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm px-3 py-2 rounded-md bg-err-50 text-err-600 border border-err-100 whitespace-pre-line">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => router.push("/importazioni")}
            disabled={pending}
          >
            Annulla
          </button>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Lettura…" : "Anteprima →"}
          </button>
        </div>
      </form>
    );
  }

  // ====================== STEP 2: PREVIEW ======================
  return (
    <div className="space-y-4">
      <div className="panel grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 overflow-hidden">
        <StatCell label="Totale righe" value={counts.total} />
        <StatCell label="Pronte" value={counts.ready} color="text-ok-600" />
        <StatCell label="Da completare" value={counts.needs} color="text-amber-600" />
        <StatCell label="Ambigue" value={counts.ambiguous} color="text-purple-600" />
        <StatCell label="Possibili duplicati" value={counts.possible} color="text-orange-600" />
        <StatCell label="Duplicate" value={counts.duplicate} color="text-sub" />
        <StatCell label="Errori" value={counts.error} color="text-err-600" last />
      </div>

      <div className="text-[12px] text-sub px-1 flex items-center justify-between flex-wrap gap-2">
        <span>
          Duplicati riconosciuti via hash <strong>data + importo + descrizione</strong> contro
          tutti i movimenti già in archivio (importati o manuali).
        </span>
        <span className="num-mono text-[11px]">
          Archivio: {preview.diagnostics.totalTransactionsInDb} movimenti ·{" "}
          {preview.diagnostics.hashesInDb} con hash
          {preview.diagnostics.backfilledNow > 0
            ? ` (${preview.diagnostics.backfilledNow} appena ricalcolati)`
            : ""}
        </span>
      </div>

      {hasPending && (
        <div className="panel p-4 space-y-4 border-amber-200 bg-amber-50/30">
          <div>
            <div className="font-semibold text-sm">Risolvi in massa con pattern</div>
            <div className="text-[12px] text-sub">
              Una regola = un pattern testuale che riconosce un gruppo di righe. Verrà salvata sul
              template e applicata automaticamente ai prossimi import.
            </div>
          </div>

          {/* Pattern categoria — auto-proposti */}
          {proposedCategoryGroups.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-sub mb-1.5">
                Categorie da assegnare ({sumCount(proposedCategoryGroups)} righe in {proposedCategoryGroups.length} pattern)
              </div>
              <ul className="space-y-1">
                {proposedCategoryGroups.map((g) => (
                  <CategoryGroupRow
                    key={g.key}
                    group={g}
                    edit={groupEdits[g.key]}
                    setEdit={(e) =>
                      setGroupEdits((prev) => ({ ...prev, [g.key]: e }))
                    }
                    allRows={rows}
                    categoriesExpense={categoriesExpense}
                    categoriesIncome={categoriesIncome}
                    showAdvancedRegex={showAdvancedRegex}
                    onApply={(pattern, matchType, targetId) =>
                      applyCategoryPattern(g.type, pattern, matchType, targetId)
                    }
                  />
                ))}
              </ul>
              <label className="flex items-center gap-1.5 text-[11px] text-sub mt-2">
                <input
                  type="checkbox"
                  checked={showAdvancedRegex}
                  onChange={(e) => setShowAdvancedRegex(e.target.checked)}
                />
                Mostra anche regex (avanzato)
              </label>
            </div>
          )}

          {/* Conti — EXACT come prima */}
          {pendingAccountPayment.accounts.length > 0 && (
            <ExactBulkBlock
              title={`Conto — ${sumCount(pendingAccountPayment.accounts)} righe`}
              items={pendingAccountPayment.accounts}
              options={accounts}
              placeholder="— scegli conto —"
              onApply={(it, id) => applyBulkExact("account", it.sourceNorm, id)}
            />
          )}

          {/* Modalità — EXACT */}
          {pendingAccountPayment.payments.length > 0 && (
            <ExactBulkBlock
              title={`Modalità — ${sumCount(pendingAccountPayment.payments)} righe`}
              items={pendingAccountPayment.payments}
              options={paymentMethods}
              placeholder="— scegli modalità —"
              onApply={(it, id) => applyBulkExact("payment", it.sourceNorm, id)}
            />
          )}
        </div>
      )}

      {/* Toolbar filtri */}
      <div className="panel p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            Tutte ({counts.total})
          </FilterPill>
          <FilterPill active={filter === "ready"} onClick={() => setFilter("ready")}>
            Pronte ({counts.ready})
          </FilterPill>
          <FilterPill active={filter === "needs"} onClick={() => setFilter("needs")}>
            Da completare ({counts.needs - counts.ambiguous})
          </FilterPill>
          <FilterPill active={filter === "ambiguous"} onClick={() => setFilter("ambiguous")}>
            Ambigue ({counts.ambiguous})
          </FilterPill>
          <FilterPill active={filter === "possible"} onClick={() => setFilter("possible")}>
            Possibili dup. ({counts.possible})
          </FilterPill>
          <FilterPill active={filter === "duplicate"} onClick={() => setFilter("duplicate")}>
            Duplicate ({counts.duplicate})
          </FilterPill>
          <FilterPill active={filter === "error"} onClick={() => setFilter("error")}>
            Errori ({counts.error})
          </FilterPill>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {rulesToSave.length > 0 && (
            <span className="text-[11px] text-sub">
              {rulesToSave.length} regola{rulesToSave.length === 1 ? "" : "e"} da salvare
            </span>
          )}
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => router.push("/importazioni")}
            disabled={pending}
          >
            ✕ Esci senza importare
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={reset} disabled={pending}>
            ← Cambia file
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleConfirm}
            disabled={pending || counts.includedReady === 0}
          >
            {pending ? "Importazione…" : `Importa ${counts.includedReady} righe`}
          </button>
        </div>
      </div>

      {preview.warnings.length > 0 && (
        <div className="panel p-3 bg-amber-50/40 border-amber-200 text-[13px]">
          <span className="font-medium">Avvisi:</span> {preview.warnings.join(" · ")}
        </div>
      )}
      {error && (
        <div className="text-sm px-3 py-2 rounded-md bg-err-50 text-err-600 border border-err-100 whitespace-pre-line">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm px-3 py-2 rounded-md bg-ok-50 text-ok-600 border border-ok-100">
          {success}
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-bg border-b border-line2 sticky top-0 z-10">
            <tr className="text-left uppercase tracking-wider text-[10px] text-sub">
              <th className="px-2 py-2 w-8"></th>
              <th className="px-2 py-2 w-24">Stato</th>
              <th className="px-2 py-2 w-24">Data</th>
              <th className="px-2 py-2">Descrizione</th>
              <th className="px-2 py-2 w-28 text-right">Importo</th>
              <th className="px-2 py-2 w-44">Conto</th>
              <th className="px-2 py-2 w-52">Categoria</th>
              <th className="px-2 py-2 w-40">Modalità</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <PreviewRow
                key={r.rowIndex}
                row={r}
                accounts={accounts}
                categoriesExpense={categoriesExpense}
                categoriesIncome={categoriesIncome}
                paymentMethods={paymentMethods}
                onUpdate={(patch) => updateRow(r.rowIndex, patch)}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sub">
                  Nessuna riga in questa vista
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============== CategoryGroupRow ==============

function CategoryGroupRow({
  group,
  edit,
  setEdit,
  allRows,
  categoriesExpense,
  categoriesIncome,
  showAdvancedRegex,
  onApply,
}: {
  group: {
    key: string;
    type: "income" | "expense";
    proposed: string;
    sampleDescriptions: string[];
    count: number;
  };
  edit: GroupEdit | undefined;
  setEdit: (e: GroupEdit) => void;
  allRows: EditableRow[];
  categoriesExpense: Option[];
  categoriesIncome: Option[];
  showAdvancedRegex: boolean;
  onApply: (pattern: string, matchType: MatchType, targetId: string) => void;
}) {
  // Stato corrente del gruppo, con default da proposta
  const editedPattern = edit?.editedPattern ?? group.proposed;
  const matchType: MatchType = edit?.matchType ?? "CONTAINS";
  const targetId = edit?.targetId ?? "";

  // Live count delle righe matchanti per il pattern editato
  const liveCount = useMemo(() => {
    return allRows.filter(
      (r) =>
        r.status !== "duplicate" &&
        r.status !== "error" &&
        !r.categoryId &&
        r.type === group.type &&
        matchPattern(r.description, editedPattern, matchType),
    ).length;
  }, [allRows, group.type, editedPattern, matchType]);

  const cats = group.type === "income" ? categoriesIncome : categoriesExpense;

  const matchOptions: MatchType[] = showAdvancedRegex
    ? ["CONTAINS", "STARTS_WITH", "EXACT", "REGEX"]
    : ["CONTAINS", "STARTS_WITH", "EXACT"];

  const canApply = editedPattern.trim().length > 0 && !!targetId && liveCount > 0;

  return (
    <li className="bg-white border border-line2 rounded-md px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-semibold ${
            group.type === "income"
              ? "bg-ok-50 text-ok-600 border-ok-500"
              : "bg-err-50 text-err-600 border-err-500"
          }`}
        >
          {group.type === "income" ? "Entrata" : "Uscita"}
        </span>
        <div className="text-[11px] text-sub flex-1 min-w-0 truncate" title={group.sampleDescriptions.join(" • ")}>
          {group.sampleDescriptions[0]}
        </div>
        <span className="text-[11px] text-sub num-mono">
          {liveCount}/{group.count} righe
        </span>
      </div>

      <div className="grid grid-cols-[110px,1fr,180px,auto] gap-1.5 items-center">
        <select
          className="input text-xs h-7 py-0"
          value={matchType}
          onChange={(e) => setEdit({ editedPattern, matchType: e.target.value as MatchType, targetId })}
        >
          {matchOptions.map((m) => (
            <option key={m} value={m}>
              {MATCH_LABEL[m]}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="input text-xs h-7 py-0"
          value={editedPattern}
          onChange={(e) => setEdit({ editedPattern: e.target.value, matchType, targetId })}
          placeholder="Pattern…"
        />
        <select
          className="input text-xs h-7 py-0"
          value={targetId}
          onChange={(e) => setEdit({ editedPattern, matchType, targetId: e.target.value })}
        >
          <option value="">— scegli categoria —</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn text-xs h-7 px-3"
          disabled={!canApply}
          onClick={() => onApply(editedPattern.trim(), matchType, targetId)}
          title={!canApply ? "Pattern non valido, target mancante o nessuna riga matcha" : undefined}
        >
          Applica
        </button>
      </div>
    </li>
  );
}

// ============== ExactBulkBlock (per ACCOUNT/PAYMENT) ==============

function ExactBulkBlock({
  title,
  items,
  options,
  placeholder,
  onApply,
}: {
  title: string;
  items: { sourceLabel: string; sourceNorm: string; count: number }[];
  options: Option[];
  placeholder: string;
  onApply: (
    g: { sourceLabel: string; sourceNorm: string; count: number },
    id: string,
  ) => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-sub mb-1.5">
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((g) => {
          const k = g.sourceNorm;
          const chosen = choices[k] ?? "";
          return (
            <li
              key={k}
              className="flex items-center gap-2 bg-white border border-line2 rounded-md px-2.5 py-1.5"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] truncate" title={g.sourceLabel}>
                  {g.sourceLabel}
                </div>
                <div className="text-[10px] text-sub">{g.count} righe</div>
              </div>
              <select
                className="input text-xs h-7 py-0 w-56"
                value={chosen}
                onChange={(e) => setChoices((c) => ({ ...c, [k]: e.target.value }))}
              >
                <option value="">{placeholder}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn text-xs h-7 px-3"
                disabled={!chosen}
                onClick={() => onApply(g, chosen)}
              >
                Applica
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============== PreviewRow ==============

function PreviewRow({
  row,
  accounts,
  categoriesExpense,
  categoriesIncome,
  paymentMethods,
  onUpdate,
}: {
  row: EditableRow;
  accounts: Option[];
  categoriesExpense: Option[];
  categoriesIncome: Option[];
  paymentMethods: Option[];
  onUpdate: (patch: Partial<EditableRow>) => void;
}) {
  const isLocked = row.status === "duplicate" || row.status === "error";
  const cats = row.type === "income" ? categoriesIncome : categoriesExpense;
  const dateLabel = row.date ? fmtDateFull(new Date(row.date + "T00:00:00Z")) : "—";
  const isAmbiguous = !isLocked && (row.categoryCandidates?.length ?? 0) > 1;

  // Costruisco le opzioni di categoria: se ambigua, evidenzio i candidati in cima
  const catOptions: { id: string; name: string; suggested?: boolean }[] = useMemo(() => {
    if (!isAmbiguous) return cats.map((c) => ({ id: c.id, name: c.name }));
    const candidateIds = new Set(row.categoryCandidates.map((c) => c.categoryId));
    const cands = cats
      .filter((c) => candidateIds.has(c.id))
      .map((c) => ({ id: c.id, name: `★ ${c.name}`, suggested: true }));
    const rest = cats.filter((c) => !candidateIds.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
    return [...cands, ...rest];
  }, [cats, isAmbiguous, row.categoryCandidates]);

  const rowBg = row.status === "error"
    ? "bg-err-50/30"
    : row.status === "duplicate"
      ? "bg-line2/30 text-sub"
      : row.status === "possible_duplicate"
        ? "bg-orange-50/40"
        : isAmbiguous
          ? "bg-purple-50/40"
          : row.status === "needs_mapping"
            ? "bg-amber-50/40"
            : "";

  return (
    <tr className={`border-b border-line2 ${rowBg}`}>
      <td className="px-2 py-1.5 align-top">
        <input
          type="checkbox"
          checked={row.include}
          disabled={isLocked}
          onChange={(e) => onUpdate({ include: e.target.checked })}
        />
      </td>
      <td className="px-2 py-1.5 align-top">
        <StatusBadge status={row.status} ambiguous={isAmbiguous} />
        {row.errors.length > 0 && (
          <div className="text-[10px] text-err-600 mt-0.5 leading-tight">
            {row.errors.join("; ")}
          </div>
        )}
        {isAmbiguous && (
          <div className="text-[10px] text-purple-600 mt-0.5 leading-tight">
            Più regole matchano: scegli
          </div>
        )}
        {row.status === "possible_duplicate" && (
          <div className="text-[10px] text-orange-600 mt-0.5 leading-tight">
            Stessa data + importo di un movimento già in archivio
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 align-top whitespace-nowrap num-mono">{dateLabel}</td>
      <td className="px-2 py-1.5 align-top">
        <div
          className="whitespace-normal break-words leading-snug max-w-[500px]"
          title={row.description}
        >
          {row.description || <span className="text-sub italic">vuota</span>}
        </div>
      </td>
      <td className="px-2 py-1.5 align-top text-right num-mono whitespace-nowrap">
        {row.amount != null ? (
          <span className={row.type === "income" ? "text-ok-600" : "text-err-600"}>
            {row.type === "income" ? "+" : "−"} {fmtEURFull(row.amount)}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-1.5 align-top">
        <select
          className="input w-full text-xs h-7 py-0"
          value={row.bankAccountId ?? ""}
          disabled={isLocked}
          onChange={(e) => onUpdate({ bankAccountId: e.target.value || null })}
        >
          <option value="">— scegli —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 align-top">
        <select
          className="input w-full text-xs h-7 py-0"
          value={row.categoryId ?? ""}
          disabled={isLocked || !row.type}
          onChange={(e) => onUpdate({ categoryId: e.target.value || null })}
        >
          <option value="">— scegli —</option>
          {catOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 align-top">
        <select
          className="input w-full text-xs h-7 py-0"
          value={row.paymentMethodId ?? ""}
          disabled={isLocked}
          onChange={(e) => onUpdate({ paymentMethodId: e.target.value || null })}
        >
          <option value="">— nessuna —</option>
          {paymentMethods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}

function StatusBadge({
  status,
  ambiguous,
}: {
  status: ProcessedRow["status"];
  ambiguous: boolean;
}) {
  if (ambiguous) {
    return (
      <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border bg-purple-50 text-purple-600 border-purple-500">
        Ambigua
      </span>
    );
  }
  const cfg: Record<ProcessedRow["status"], { label: string; cls: string }> = {
    ready: { label: "Pronta", cls: "bg-ok-50 text-ok-600 border-ok-500" },
    needs_mapping: { label: "Da completare", cls: "bg-amber-50 text-amber-600 border-amber-500" },
    possible_duplicate: { label: "Possibile dup.", cls: "bg-orange-50 text-orange-600 border-orange-500" },
    duplicate: { label: "Duplicata", cls: "bg-line2 text-sub border-line" },
    error: { label: "Errore", cls: "bg-err-50 text-err-600 border-err-500" },
  };
  const c = cfg[status];
  return (
    <span
      className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${c.cls}`}
    >
      {c.label}
    </span>
  );
}

function StatCell({
  label,
  value,
  color,
  last,
}: {
  label: string;
  value: number;
  color?: string;
  last?: boolean;
}) {
  return (
    <div className={`px-4 py-3 ${!last ? "border-r border-line2" : ""}`}>
      <div className="ph">{label}</div>
      <div className={`text-2xl font-semibold mt-1 num ${color ?? ""}`}>{value}</div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-md border transition ${
        active
          ? "bg-brand-50 border-brand-500 text-brand-600"
          : "bg-white border-line text-sub hover:bg-bg"
      }`}
    >
      {children}
    </button>
  );
}

// ---------- utils ----------

function norm(v: string): string {
  return (v ?? "").toString().trim().toLowerCase();
}

function sumCount(items: { count: number }[]): number {
  return items.reduce((s, it) => s + it.count, 0);
}
