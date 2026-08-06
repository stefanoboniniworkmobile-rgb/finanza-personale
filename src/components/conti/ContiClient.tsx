"use client";

import { useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { ContoDialog, type ContoDialogValue } from "./ContoDialog";
import { fmtN } from "@/lib/format";

export type ContoRow = {
  id: string;
  name: string;
  type: string;
  notes: string | null;
  bank: string | null;
  initialBalance: number;
  iban: string | null;
  cardMaskedPan: string | null;
  saldo: number; // calcolato
  txCount: number;
};

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  liquidity: { label: "C/C", cls: "bg-ok-50 text-ok-600" },
  credit_card: { label: "Carta", cls: "bg-err-50 text-err-600" },
  savings: { label: "Risparmio", cls: "bg-warn-50 text-warn-600" },
  cash: { label: "Contanti", cls: "bg-line2 text-sub" },
};

const NO_BANK = "__none__";

// Avatar dell'istituto: iniziali + colore stabile derivato dal nome, così ogni
// banca ha sempre lo stesso "badge" ed è riconoscibile a colpo d'occhio.
const AVATAR_PALETTE = [
  "bg-brand-50 text-brand-600",
  "bg-ok-50 text-ok-600",
  "bg-warn-50 text-warn-600",
  "bg-err-50 text-err-600",
  "bg-line2 text-ink2",
];
function bankInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function avatarClass(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// Griglia desktop condivisa: stesse colonne in intestazione, righe e totale, così
// restano allineate tra card di istituti diversi.
const DESK_COLS = "grid grid-cols-[1fr_110px_130px_140px_80px] gap-4";

export function ContiClient({ rows }: { rows: ContoRow[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContoDialogValue | undefined>();

  const openNew = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (r: ContoRow) => {
    setEditing({
      id: r.id,
      name: r.name,
      type: r.type as any,
      bank: r.bank ?? null,
      initialBalance: r.initialBalance,
      notes: r.notes ?? null,
      iban: r.iban ?? null,
      cardMaskedPan: r.cardMaskedPan ?? null,
    });
    setDialogOpen(true);
  };

  const totIni = rows.reduce((s, r) => s + r.initialBalance, 0);
  const totSaldo = rows.reduce((s, r) => s + r.saldo, 0);
  const totMovs = rows.reduce((s, r) => s + r.txCount, 0);

  // Elenco istituti già usati, per l'autocomplete del dialog.
  const bankOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.bank?.trim()) set.add(r.bank.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Raggruppamento per istituto: banche in ordine alfabetico, "Senza istituto"
  // sempre in fondo. Ogni gruppo porta con sé il subtotale del saldo.
  const groups = useMemo(() => {
    const map = new Map<string, ContoRow[]>();
    for (const r of rows) {
      const key = r.bank?.trim() || NO_BANK;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const keys = [...map.keys()].sort((a, b) => {
      if (a === NO_BANK) return 1;
      if (b === NO_BANK) return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => {
      const rs = map.get(k)!;
      return {
        key: k,
        label: k === NO_BANK ? "Senza istituto" : k,
        rows: rs,
        subIni: rs.reduce((s, r) => s + r.initialBalance, 0),
        subSaldo: rs.reduce((s, r) => s + r.saldo, 0),
        subMovs: rs.reduce((s, r) => s + r.txCount, 0),
      };
    });
  }, [rows]);

  // Mostriamo le intestazioni di gruppo solo se c'è almeno un istituto valorizzato.
  const grouped = groups.some((g) => g.key !== NO_BANK);

  return (
    <>
      <div className="flex items-center justify-end mb-3">
        <button onClick={openNew} className="btn">
          + Nuovo conto
        </button>
      </div>

      {/* Mobile: schede raggruppate per istituto */}
      <div className="md:hidden space-y-3">
        {rows.length === 0 && (
          <div className="panel px-4 py-8 text-center text-sm text-sub">
            Nessun conto. Aggiungine uno col bottone qui sopra.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key} className="panel overflow-hidden">
            {grouped && (
              <div className="px-3 py-3 flex items-center gap-3 border-b border-line2">
                <span
                  className={`w-9 h-9 rounded-xl grid place-items-center text-[12px] font-bold shrink-0 ${
                    g.key === NO_BANK
                      ? "bg-line2 text-sub"
                      : avatarClass(g.key)
                  }`}
                >
                  {g.key === NO_BANK ? (
                    <Landmark size={16} strokeWidth={2} />
                  ) : (
                    bankInitials(g.label)
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[14px] truncate">
                    {g.label}
                  </div>
                  <div className="text-[11px] text-sub">
                    {g.rows.length} cont{g.rows.length === 1 ? "o" : "i"}
                  </div>
                </div>
                <div
                  className={`num-mono font-semibold text-[16px] shrink-0 ${
                    g.subSaldo < 0 ? "text-err-600" : ""
                  }`}
                >
                  {fmtN(g.subSaldo)} €
                </div>
              </div>
            )}
            <div className="divide-y divide-line2">
              {g.rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openEdit(r)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-bg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[14px] truncate">
                        {r.name}
                      </span>
                      <span
                        className={`pill shrink-0 ${
                          TYPE_LABEL[r.type]?.cls ?? "bg-line2 text-sub"
                        }`}
                      >
                        {TYPE_LABEL[r.type]?.label ?? r.type}
                      </span>
                    </div>
                    <div className="text-[11px] text-sub mt-0.5 num-mono">
                      {r.txCount} mov.
                      {r.iban
                        ? ` · ${r.iban.slice(0, 2)}…${r.iban.slice(-4)}`
                        : ""}
                    </div>
                  </div>
                  <div
                    className={`num-mono font-semibold text-[15px] shrink-0 ${
                      r.saldo < 0 ? "text-err-600" : ""
                    }`}
                  >
                    {fmtN(r.saldo)} €
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
        {rows.length > 0 && (
          <div className="panel px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold">TOTALE</span>
            <span
              className={`num-mono font-semibold text-[15px] ${
                totSaldo < 0 ? "text-err-600" : ""
              }`}
            >
              {fmtN(totSaldo)} €
            </span>
          </div>
        )}
      </div>

      {/* Desktop: card per istituto (colonne allineate tra le card) */}
      <div className="hidden md:block space-y-3">
        {rows.length === 0 && (
          <div className="panel px-4 py-12 text-center text-sub">
            Nessun conto. Aggiungine uno col bottone qui sopra.
          </div>
        )}
        {rows.length > 0 && (
          <div
            className={`${DESK_COLS} items-center px-4 text-[10px] uppercase tracking-wider text-sub font-semibold`}
          >
            <div>Conto</div>
            <div>Tipo</div>
            <div className="text-right">Saldo iniziale</div>
            <div className="text-right">Saldo attuale</div>
            <div className="text-right">N. mov.</div>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key} className="panel overflow-hidden">
            {grouped && (
              <div className="px-4 py-3 flex items-center gap-3 border-b border-line2">
                <span
                  className={`w-9 h-9 rounded-xl grid place-items-center text-[12px] font-bold shrink-0 ${
                    g.key === NO_BANK ? "bg-line2 text-sub" : avatarClass(g.key)
                  }`}
                >
                  {g.key === NO_BANK ? (
                    <Landmark size={16} strokeWidth={2} />
                  ) : (
                    bankInitials(g.label)
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[14px] truncate">
                    {g.label}
                  </div>
                  <div className="text-[11px] text-sub">
                    {g.rows.length} cont{g.rows.length === 1 ? "o" : "i"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="ph">Saldo istituto</div>
                  <div
                    className={`num-mono font-semibold text-[16px] ${
                      g.subSaldo < 0 ? "text-err-600" : ""
                    }`}
                  >
                    {fmtN(g.subSaldo)} €
                  </div>
                </div>
              </div>
            )}
            <div className="divide-y divide-line2">
              {g.rows.map((r) => (
                <div
                  key={r.id}
                  onClick={() => openEdit(r)}
                  className={`${DESK_COLS} items-center px-4 py-2.5 cursor-pointer hover:bg-bg transition-colors`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.name}</div>
                    {r.notes && (
                      <div
                        className="text-xs text-sub truncate"
                        title={r.notes}
                      >
                        {r.notes}
                      </div>
                    )}
                  </div>
                  <div>
                    <span
                      className={`pill ${
                        TYPE_LABEL[r.type]?.cls ?? "bg-line2 text-sub"
                      }`}
                    >
                      {TYPE_LABEL[r.type]?.label ?? r.type}
                    </span>
                  </div>
                  <div className="text-right num-mono text-sub">
                    {fmtN(r.initialBalance)}
                  </div>
                  <div
                    className={`text-right num-mono font-semibold ${
                      r.saldo < 0 ? "text-err-600" : ""
                    }`}
                  >
                    {fmtN(r.saldo)}
                  </div>
                  <div className="text-right num-mono text-sub">{r.txCount}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {rows.length > 0 && (
          <div className={`panel ${DESK_COLS} items-center px-4 py-3`}>
            <div className="font-semibold text-xs uppercase tracking-wide">
              Totale
            </div>
            <div />
            <div className="text-right num-mono text-sub">{fmtN(totIni)}</div>
            <div
              className={`text-right num-mono font-semibold ${
                totSaldo < 0 ? "text-err-600" : ""
              }`}
            >
              {fmtN(totSaldo)}
            </div>
            <div className="text-right num-mono text-sub">{totMovs}</div>
          </div>
        )}
      </div>

      <ContoDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        banks={bankOptions}
      />
    </>
  );
}
