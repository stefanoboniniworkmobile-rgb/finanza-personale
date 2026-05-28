/**
 * Client component per la pagina di abbinamento PSD2.
 *
 * Riceve in ingresso la lista di account ritornati da Enable Banking, già
 * annotati col matching automatico (vedi /impostazioni/banche/abbinamento/page.tsx).
 * Per ogni account permette all'utente di scegliere fra tre azioni:
 *   - link: collega a un BankAccount in anagrafica (dropdown coi candidati)
 *   - create: crea un nuovo BankAccount inline (form con campi pre-compilati)
 *   - skip: ignora questo account
 *
 * Al submit invia tutto in un colpo a POST /api/psd2/match, che a sua volta
 * crea BankConnection + SyncJob e lancia il sync in background. La risposta
 * contiene la lista dei jobId, e questo componente redirige a
 * /impostazioni/banche?status=connected&jobs=id1,id2 dove la lista mostra
 * il progress del sync iniziale.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NumberInput } from "@/components/ui/NumberInput";

export type AccountRow = {
  providerUid: string;
  product: string | null;
  details: string | null;
  cashAccountType: string | null;
  currency: string;
  creditLimit: string | null;
  detectedIban: string | null;
  detectedPan: string | null;
  defaultAction: "link" | "create" | "skip";
  defaultBankAccountId: string | null;
  defaultReason: string;
  suggestedNewName: string;
  suggestedNewType: "liquidity" | "credit_card" | "savings" | "cash";
  wasAlreadyLinkedTo: string | null;
};

export type Candidate = {
  id: string;
  name: string;
  type: string;
  iban: string | null;
  cardMaskedPan: string | null;
};

type RowState = {
  action: "link" | "create" | "skip";
  bankAccountId: string;
  newName: string;
  newType: "liquidity" | "credit_card" | "savings" | "cash";
  newInitialBalance: number;
  newIban: string;
  newPan: string;
};

const TYPE_OPTIONS = [
  { value: "liquidity", label: "Conto corrente / liquidità" },
  { value: "credit_card", label: "Carta di credito / e-wallet" },
  { value: "savings", label: "Risparmio / investimento" },
  { value: "cash", label: "Contanti / cassa" },
] as const;

export function AbbinamentoClient({
  pendingId,
  aspspName,
  rows,
  candidates,
}: {
  pendingId: string;
  aspspName: string;
  rows: AccountRow[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Stato per ogni riga, inizializzato dai default suggeriti
  const [states, setStates] = useState<Record<string, RowState>>(() => {
    const out: Record<string, RowState> = {};
    for (const r of rows) {
      out[r.providerUid] = {
        action: r.defaultAction,
        bankAccountId: r.defaultBankAccountId ?? "",
        newName: r.suggestedNewName,
        newType: r.suggestedNewType,
        newInitialBalance: 0,
        newIban: r.detectedIban ?? "",
        newPan: r.detectedPan ?? "",
      };
    }
    return out;
  });

  const updateRow = (uid: string, patch: Partial<RowState>) => {
    setStates((prev) => ({ ...prev, [uid]: { ...prev[uid], ...patch } }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Costruisci il payload validando lato client
    const mappings: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const s = states[r.providerUid];
      if (s.action === "skip") {
        mappings.push({ action: "skip", providerUid: r.providerUid });
      } else if (s.action === "link") {
        if (!s.bankAccountId) {
          setError(
            `Per "${r.suggestedNewName}" hai scelto "Collega" ma non hai selezionato un conto in anagrafica.`,
          );
          return;
        }
        mappings.push({
          action: "link",
          providerUid: r.providerUid,
          bankAccountId: s.bankAccountId,
        });
      } else {
        // create
        if (!s.newName.trim()) {
          setError(
            `Per "${r.suggestedNewName}" hai scelto "Codifica nuovo conto" ma il nome è vuoto.`,
          );
          return;
        }
        mappings.push({
          action: "create",
          providerUid: r.providerUid,
          newAccount: {
            name: s.newName.trim(),
            type: s.newType,
            initialBalance: s.newInitialBalance,
            iban: s.newIban.trim() || null,
            cardMaskedPan: s.newPan.trim() || null,
          },
        });
      }
    }

    startTransition(async () => {
      const res = await fetch("/api/psd2/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingId, mappings }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Errore sconosciuto");
        return;
      }
      const jobs = (data.jobIds as string[]).join(",");
      const qs = jobs.length > 0 ? `?status=connected&jobs=${jobs}` : "?status=connected";
      router.push(`/impostazioni/banche${qs}`);
    });
  };

  // Riepilogo: quanti link, create, skip
  const counts = Object.values(states).reduce(
    (acc, s) => {
      acc[s.action]++;
      return acc;
    },
    { link: 0, create: 0, skip: 0 },
  );

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        {rows.map((r) => {
          const s = states[r.providerUid];
          const isCard = r.detectedPan != null || r.cashAccountType === "CARD";

          return (
            <div key={r.providerUid} className="panel p-4">
              {/* Header riga: descrizione dell'account ritornato dalla banca */}
              <div className="flex items-start justify-between gap-4 mb-3 pb-3 border-b border-line">
                <div className="min-w-0">
                  <div className="text-xs text-sub uppercase tracking-wider mb-0.5">
                    Conto ritornato da {aspspName}
                  </div>
                  <div className="font-semibold text-base">
                    {r.product ?? r.details ?? "Conto bancario"}
                  </div>
                  <div className="text-xs text-sub mt-1 space-x-3">
                    {r.detectedIban && (
                      <span>
                        IBAN: <code className="font-mono">{r.detectedIban}</code>
                      </span>
                    )}
                    {r.detectedPan && (
                      <span>
                        Carta: <code className="font-mono">{r.detectedPan}</code>
                      </span>
                    )}
                    <span>Valuta: {r.currency}</span>
                    {r.creditLimit && <span>Fido: {r.creditLimit}</span>}
                  </div>
                </div>
                {r.wasAlreadyLinkedTo && (
                  <div className="text-xs px-2 py-1 rounded bg-ok-50 text-ok-600 whitespace-nowrap">
                    Riconnessione
                  </div>
                )}
              </div>

              {/* Hint sul matching */}
              <div className="text-xs text-sub mb-3 italic">
                {r.defaultReason}
              </div>

              {/* Radio: azione */}
              <div className="space-y-2">
                <ActionRadio
                  name={`action-${r.providerUid}`}
                  value="link"
                  current={s.action}
                  onChange={(v) => updateRow(r.providerUid, { action: v })}
                  label="Collega a un conto esistente in anagrafica"
                  disabled={candidates.length === 0}
                  disabledHint={
                    candidates.length === 0
                      ? "Nessun conto in anagrafica per questo intestatario"
                      : null
                  }
                >
                  {s.action === "link" && (
                    <>
                      <select
                        className={`input mt-2 w-full md:max-w-md ${
                          !s.bankAccountId
                            ? "border-amber-400 ring-1 ring-amber-200"
                            : ""
                        }`}
                        value={s.bankAccountId}
                        onChange={(e) =>
                          updateRow(r.providerUid, {
                            bankAccountId: e.target.value,
                          })
                        }
                      >
                        <option value="">— Scegli un conto —</option>
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.iban ? ` · ${c.iban}` : ""}
                            {c.cardMaskedPan ? ` · ${c.cardMaskedPan}` : ""}
                          </option>
                        ))}
                      </select>
                      {!s.bankAccountId && (
                        <div className="text-[11px] text-amber-700 mt-1">
                          Scegli un conto esistente, oppure passa a
                          &quot;Codifica nuovo conto&quot; per crearne uno nuovo.
                        </div>
                      )}
                    </>
                  )}
                </ActionRadio>

                <ActionRadio
                  name={`action-${r.providerUid}`}
                  value="create"
                  current={s.action}
                  onChange={(v) => updateRow(r.providerUid, { action: v })}
                  label="Codifica nuovo conto in anagrafica"
                >
                  {s.action === "create" && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FieldMini label="Nome">
                        <input
                          type="text"
                          className="input w-full"
                          required
                          maxLength={80}
                          value={s.newName}
                          onChange={(e) =>
                            updateRow(r.providerUid, { newName: e.target.value })
                          }
                        />
                      </FieldMini>
                      <FieldMini label="Tipo">
                        <select
                          className="input w-full"
                          value={s.newType}
                          onChange={(e) =>
                            updateRow(r.providerUid, {
                              newType: e.target.value as RowState["newType"],
                            })
                          }
                        >
                          {TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </FieldMini>
                      <FieldMini label="Saldo iniziale (€)">
                        <NumberInput
                          value={s.newInitialBalance}
                          onValueChange={(v) =>
                            updateRow(r.providerUid, { newInitialBalance: v ?? 0 })
                          }
                          keepZero
                          className="input w-full text-right num-mono"
                        />
                      </FieldMini>
                      <FieldMini label={isCard ? "PAN mascherato" : "IBAN"}>
                        {isCard ? (
                          <input
                            type="text"
                            className="input w-full font-mono"
                            maxLength={25}
                            value={s.newPan}
                            onChange={(e) =>
                              updateRow(r.providerUid, { newPan: e.target.value })
                            }
                            placeholder="5189********6765"
                          />
                        ) : (
                          <input
                            type="text"
                            className="input w-full font-mono uppercase"
                            maxLength={40}
                            value={s.newIban}
                            onChange={(e) =>
                              updateRow(r.providerUid, {
                                newIban: e.target.value,
                              })
                            }
                            placeholder="IT60X0542811101000000123456"
                          />
                        )}
                      </FieldMini>
                    </div>
                  )}
                </ActionRadio>

                <ActionRadio
                  name={`action-${r.providerUid}`}
                  value="skip"
                  current={s.action}
                  onChange={(v) => updateRow(r.providerUid, { action: v })}
                  label="Scarta questo conto"
                />
              </div>
            </div>
          );
        })}

        {error && (
          <div className="text-sm px-3 py-2 rounded-md bg-err-50 text-err-600 border border-err-100">
            {error}
          </div>
        )}

        <div className="panel p-4 flex items-center justify-between gap-3">
          <div className="text-xs text-sub">
            Da collegare: <b className="text-ink">{counts.link + counts.create}</b>
            {counts.skip > 0 && (
              <>
                {" "}
                · Scartati: <b className="text-ink">{counts.skip}</b>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <a href="/impostazioni/banche" className="btn-ghost">
              Annulla
            </a>
            <button
              type="submit"
              disabled={isPending || counts.link + counts.create === 0}
              className="btn"
            >
              {isPending ? "Salvataggio…" : "Conferma e collega"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function ActionRadio({
  name,
  value,
  current,
  onChange,
  label,
  disabled,
  disabledHint,
  children,
}: {
  name: string;
  value: "link" | "create" | "skip";
  current: "link" | "create" | "skip";
  onChange: (v: "link" | "create" | "skip") => void;
  label: string;
  disabled?: boolean;
  disabledHint?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={`block rounded-md border ${current === value ? "border-ink bg-bg" : "border-line"} p-3 cursor-pointer ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          checked={current === value}
          onChange={() => onChange(value)}
          disabled={disabled}
        />
        <span className="text-sm font-medium">{label}</span>
        {disabled && disabledHint && (
          <span className="text-xs text-sub ml-2">({disabledHint})</span>
        )}
      </div>
      {children}
    </label>
  );
}

function FieldMini({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}
