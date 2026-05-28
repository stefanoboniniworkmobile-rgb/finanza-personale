"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMapping,
  deleteMapping,
  type MappingInput,
} from "@/app/(app)/importazioni/actions";
import type { Option } from "@/components/importazioni/TemplateForm";

export type MappingRow = {
  id: string;
  kind: "ACCOUNT" | "CATEGORY" | "PAYMENT_METHOD";
  matchType: "EXACT" | "CONTAINS" | "STARTS_WITH" | "REGEX";
  sourceValueRaw: string;
  targetId: string;
  targetName: string;
};

const KIND_LABEL: Record<MappingRow["kind"], string> = {
  ACCOUNT: "Conto",
  CATEGORY: "Categoria",
  PAYMENT_METHOD: "Modalità",
};

const MATCH_LABEL: Record<MappingRow["matchType"], string> = {
  EXACT: "= esatto",
  CONTAINS: "contiene",
  STARTS_WITH: "inizia con",
  REGEX: "regex",
};

export function MappingsManager({
  templateId,
  mappings,
  accounts,
  categoriesExpense,
  categoriesIncome,
  paymentMethods,
}: {
  templateId: string;
  mappings: MappingRow[];
  accounts: Option[];
  categoriesExpense: Option[];
  categoriesIncome: Option[];
  paymentMethods: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<MappingRow["kind"]>("CATEGORY");
  const [matchType, setMatchType] = useState<MappingRow["matchType"]>("CONTAINS");
  const [showRegex, setShowRegex] = useState(false);
  const [sourceValueRaw, setSourceValueRaw] = useState("");
  const [targetId, setTargetId] = useState("");

  const targets: Option[] = useMemo(() => {
    if (kind === "ACCOUNT") return accounts;
    if (kind === "PAYMENT_METHOD") return paymentMethods;
    return [
      ...categoriesExpense.map((c) => ({ id: c.id, name: `[Uscite] ${c.name}` })),
      ...categoriesIncome.map((c) => ({ id: c.id, name: `[Entrate] ${c.name}` })),
    ];
  }, [kind, accounts, categoriesExpense, categoriesIncome, paymentMethods]);

  const resetForm = () => {
    setEditingId(null);
    setKind("CATEGORY");
    setMatchType("CONTAINS");
    setSourceValueRaw("");
    setTargetId("");
    setError(null);
  };

  const startEdit = (m: MappingRow) => {
    setEditingId(m.id);
    setKind(m.kind);
    setMatchType(m.matchType);
    setSourceValueRaw(m.sourceValueRaw);
    setTargetId(m.targetId);
    setError(null);
    if (m.matchType === "REGEX") setShowRegex(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: MappingInput = {
      id: editingId ?? undefined,
      templateId,
      kind,
      matchType,
      sourceValueRaw,
      targetId,
    };
    startTransition(async () => {
      const r = await saveMapping(payload);
      if (!r.ok) setError(r.error);
      else {
        resetForm();
        router.refresh();
      }
    });
  };

  const onDelete = (id: string) => {
    if (!confirm("Eliminare questa regola?")) return;
    startTransition(async () => {
      const r = await deleteMapping(id);
      if (!r.ok) alert(r.error);
      else router.refresh();
    });
  };

  const grouped = useMemo(() => {
    const g: Record<MappingRow["kind"], MappingRow[]> = {
      ACCOUNT: [],
      CATEGORY: [],
      PAYMENT_METHOD: [],
    };
    for (const m of mappings) g[m.kind].push(m);
    return g;
  }, [mappings]);

  // Suggerimento UX: per ACCOUNT e PAYMENT_METHOD ha senso solo EXACT (uno scambio 1:1
  // di valore sorgente). Per CATEGORY in genere CONTAINS sulla descrizione.
  const suggestedMatchTypes = (k: MappingRow["kind"]): MappingRow["matchType"][] => {
    if (k === "CATEGORY") {
      return showRegex
        ? ["CONTAINS", "STARTS_WITH", "EXACT", "REGEX"]
        : ["CONTAINS", "STARTS_WITH", "EXACT"];
    }
    return ["EXACT"];
  };

  // Mantieni matchType coerente quando cambio kind
  const onKindChange = (k: MappingRow["kind"]) => {
    setKind(k);
    setTargetId("");
    if (k !== "CATEGORY" && matchType !== "EXACT") setMatchType("EXACT");
    if (k === "CATEGORY" && matchType === "EXACT" && !editingId) setMatchType("CONTAINS");
  };

  return (
    <div className="panel p-5 space-y-4">
      <div>
        <div className="font-semibold text-sm">Regole ({mappings.length})</div>
        <div className="text-[12px] text-sub">
          Pattern testuali che riconoscono i movimenti durante l&apos;import. Per le categorie il
          confronto avviene sulla descrizione del movimento.
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="border border-line2 rounded-md p-3 space-y-2 bg-bg/30"
      >
        <div className="text-[11px] font-semibold uppercase tracking-wider text-sub">
          {editingId ? "Modifica regola" : "Nuova regola"}
        </div>
        <div className="grid grid-cols-[110px,110px,1fr] gap-2">
          <select
            className="input"
            value={kind}
            onChange={(e) => onKindChange(e.target.value as MappingRow["kind"])}
          >
            <option value="CATEGORY">Categoria</option>
            <option value="ACCOUNT">Conto</option>
            <option value="PAYMENT_METHOD">Modalità</option>
          </select>
          <select
            className="input"
            value={matchType}
            onChange={(e) => setMatchType(e.target.value as MappingRow["matchType"])}
          >
            {suggestedMatchTypes(kind).map((t) => (
              <option key={t} value={t}>
                {MATCH_LABEL[t]}
              </option>
            ))}
          </select>
          <input
            type="text"
            required
            maxLength={200}
            className="input"
            value={sourceValueRaw}
            onChange={(e) => setSourceValueRaw(e.target.value)}
            placeholder={
              matchType === "EXACT"
                ? "Valore esatto nella colonna sorgente"
                : matchType === "REGEX"
                  ? "Regex JavaScript (case-insensitive)"
                  : "Testo cercato nella descrizione (es. AMERICAN EXPRESS)"
            }
          />
        </div>
        <div>
          <select
            required
            className="input w-full"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">— scegli {KIND_LABEL[kind].toLowerCase()} —</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {kind === "CATEGORY" && (
          <label className="flex items-center gap-1.5 text-[11px] text-sub">
            <input
              type="checkbox"
              checked={showRegex}
              onChange={(e) => setShowRegex(e.target.checked)}
            />
            Mostra anche regex (avanzato)
          </label>
        )}

        {error && (
          <div className="text-xs px-2 py-1.5 rounded bg-err-50 text-err-600 border border-err-100">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {editingId && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={resetForm}
              disabled={pending}
            >
              Annulla
            </button>
          )}
          <button type="submit" className="btn text-xs" disabled={pending}>
            {pending ? "Salvataggio…" : editingId ? "Salva" : "+ Aggiungi"}
          </button>
        </div>
      </form>

      {mappings.length === 0 ? (
        <div className="text-sm text-sub py-6 text-center border border-dashed border-line2 rounded-md">
          Nessuna regola ancora. Si creano in automatico quando applichi un pattern dalla preview di
          import, oppure manualmente qui.
        </div>
      ) : (
        <div className="space-y-3">
          {(["CATEGORY", "ACCOUNT", "PAYMENT_METHOD"] as const).map((k) =>
            grouped[k].length === 0 ? null : (
              <div key={k}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-sub mb-1">
                  {KIND_LABEL[k]} ({grouped[k].length})
                </div>
                <ul className="border border-line2 rounded-md divide-y divide-line2">
                  {grouped[k].map((m) => (
                    <li
                      key={m.id}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded border border-line text-sub font-semibold">
                            {MATCH_LABEL[m.matchType]}
                          </span>
                          <span className="font-medium truncate">{m.sourceValueRaw}</span>
                        </div>
                        <div className="text-[11px] text-sub truncate mt-0.5">
                          → {m.targetName}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="btn-ghost text-[11px]"
                          onClick={() => startEdit(m)}
                          disabled={pending}
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-[11px] !text-err-600 hover:!bg-err-50"
                          onClick={() => onDelete(m.id)}
                          disabled={pending}
                        >
                          Elimina
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
