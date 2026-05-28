"use client";

/**
 * Client component della pagina /mercati.
 * Tabella interattiva con:
 *  - colonne: Symbol | Nome | Classe | Ultimo | Var Giorno/Settimana/Mese | Sparkline | Aggiorna
 *  - bottone "Cerca asset" che apre AssetSearchDialog (catalogo + search Yahoo
 *    + filtri tipo). Da lì asset cliccato → saveAsset diretto. In caso di
 *    asset non Yahoo (es. fondi SGR), il dialog ricerca rinvia al fallback
 *    AssetDialog manuale.
 *  - bottone "Aggiorna tutto" che chiama refreshAllAssets
 *  - click su riga apre AssetDialog in modalità edit (modifica/elimina/NAV)
 *  - bottone "Aggiorna" inline su ogni riga che chiama refreshAsset(id)
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AssetDialog, type AssetDialogValue } from "./AssetDialog";
import { AssetSearchDialog } from "./AssetSearchDialog";
import { Sparkline } from "./Sparkline";
import {
  refreshAsset,
  refreshAllAssets,
  type RefreshFailure,
} from "@/app/(app)/mercati/actions";
import { fmtN } from "@/lib/format";

export type AssetRow = {
  id: string;
  symbol: string;
  isin: string | null;
  name: string;
  assetClass: string;
  currency: string;
  provider: string;
  providerSymbol: string;
  notes: string | null;
  lastPrice: number | null;
  lastAsOf: string | null; // ISO YYYY-MM-DD
  changeDayPct: number | null;
  changeWeekPct: number | null;
  changeMonthPct: number | null;
  changeYearPct: number | null;
  sparkPoints: Array<{ date: string; close: number }>;
};

const CLASS_LABELS: Record<string, string> = {
  stock: "Azione",
  etf: "ETF",
  index: "Indice",
  currency: "Cambio",
  rate: "Tasso",
  bond: "Obbligaz.",
  fund: "Fondo",
  crypto: "Cripto",
  other: "Altro",
};

export function MercatiClient({ rows }: { rows: AssetRow[] }) {
  const router = useRouter();
  // Dialog ricerca: il flow primario per aggiungere asset (cerca + filtri tipo).
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  // Dialog modifica/manuale: aperto da click su una riga esistente, o dal link
  // "Inseriscilo manualmente" dentro al dialog ricerca per casi fuori-Yahoo.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AssetDialogValue | undefined>();
  const [rowPending, startRow] = useTransition();
  const [bulkPending, startBulk] = useTransition();
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  /**
   * Lista dei fallimenti dell'ultimo "Aggiorna tutto" (oppure errori singoli
   * accumulati da "Aggiorna" sulla riga). Mostrata in un pannello dedicato
   * sotto la toolbar con un bottone Riprova per ciascun asset. Si svuota
   * quando l'utente la chiude o quando parte un nuovo "Aggiorna tutto".
   */
  const [refreshFailures, setRefreshFailures] = useState<RefreshFailure[]>([]);
  // Asset al momento in retry (mostra "Riprovo…" inline e disabilita il btn).
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Ricerca free-text lato client: filtra la watchlist per symbol/nome/ISIN.
  // Vuoto → mostra tutti i row (default). Scritto → filtra case-insensitive
  // su uno qualsiasi dei tre campi.
  // Pure client-side: i dati sono già caricati dal server, non serve round-trip.
  const [searchText, setSearchText] = useState("");
  const filteredRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.symbol.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.isin ?? "").toLowerCase().includes(q),
    );
  }, [rows, searchText]);

  /**
   * Apre il dialog ricerca (flow primario). Da lì l'utente può cliccare un
   * asset del catalogo o dei risultati Yahoo e aggiungerlo direttamente.
   */
  const openSearch = () => {
    setSearchDialogOpen(true);
  };

  /**
   * Apre il dialog di inserimento manuale. Tipicamente lanciato dal link
   * "Inseriscilo manualmente" dentro AssetSearchDialog quando l'asset non
   * è coperto da Yahoo (es. fondi italiani SGR).
   */
  const openManual = () => {
    setSearchDialogOpen(false);
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (r: AssetRow) => {
    setEditing({
      id: r.id,
      symbol: r.symbol,
      isin: r.isin ?? "",
      name: r.name,
      assetClass: r.assetClass,
      currency: r.currency,
      provider: r.provider,
      providerSymbol: r.providerSymbol,
      notes: r.notes ?? "",
    });
    setDialogOpen(true);
  };

  const onRefreshOne = (id: string) => {
    startRow(async () => {
      const r = await refreshAsset(id);
      if (r.ok) {
        // Successo → tolgo l'asset dalla lista errori (se c'era).
        setRefreshFailures((prev) => prev.filter((f) => f.id !== id));
        router.refresh();
      } else {
        // Fallimento → aggiungo (o aggiorno) l'asset nella lista errori.
        const row = rows.find((r) => r.id === id);
        const failure: RefreshFailure = {
          id,
          symbol: row?.symbol ?? id,
          name: row?.name ?? "",
          error: r.error,
        };
        setRefreshFailures((prev) => {
          const without = prev.filter((f) => f.id !== id);
          return [failure, ...without];
        });
      }
    });
  };

  /** Riprovo l'aggiornamento di un singolo asset dalla lista errori. */
  const onRetryFailure = (id: string) => {
    setRetryingId(id);
    startRow(async () => {
      const r = await refreshAsset(id);
      if (r.ok) {
        setRefreshFailures((prev) => prev.filter((f) => f.id !== id));
        router.refresh();
      } else {
        // Aggiorno il messaggio d'errore dell'asset.
        setRefreshFailures((prev) =>
          prev.map((f) => (f.id === id ? { ...f, error: r.error } : f)),
        );
      }
      setRetryingId(null);
    });
  };

  const onRefreshAll = () => {
    setRefreshMsg(null);
    setRefreshFailures([]);
    startBulk(async () => {
      const r = await refreshAllAssets();
      if (r.ok) {
        setRefreshMsg(
          `Aggiornati ${r.refreshed} asset${r.errors > 0 ? ` · ${r.errors} con errore (dettaglio sotto)` : ""}`,
        );
        setRefreshFailures(r.failures);
        router.refresh();
      } else {
        setRefreshMsg(`Errore: ${r.error}`);
      }
    });
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-[260px]">
          {/* Ricerca sulla watchlist. Vuoto = mostra tutti. */}
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Cerca per nome, symbol o ISIN…"
            className="input !h-8 !py-0 w-72"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText("")}
              className="text-sub hover:text-ink text-xs"
              title="Pulisci ricerca"
            >
              ✕
            </button>
          )}
          {searchText && (
            <div className="text-xs text-sub">
              {filteredRows.length} di {rows.length}
            </div>
          )}
          {refreshMsg && (
            <div className="text-xs text-sub italic">{refreshMsg}</div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRefreshAll}
            disabled={bulkPending || rows.length === 0}
            className="btn-ghost"
          >
            {bulkPending ? "Aggiornamento…" : "Aggiorna tutto"}
          </button>
          <button onClick={openSearch} className="btn">
            Cerca asset
          </button>
        </div>
      </div>

      {/* ─── Pannello errori aggiornamento ────────────────────────────
          Mostrato quando "Aggiorna tutto" o "Aggiorna" su singola riga
          hanno fallito. Lista compatta con symbol + nome + motivo +
          bottone Riprova per ciascuno. */}
      {refreshFailures.length > 0 && (
        <div className="mb-3 rounded-md border border-err-100 bg-err-50/40 overflow-hidden">
          <div className="px-3 py-2 border-b border-err-100 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-err-600">
              {refreshFailures.length === 1
                ? "1 asset non aggiornato"
                : `${refreshFailures.length} asset non aggiornati`}
            </div>
            <button
              type="button"
              onClick={() => setRefreshFailures([])}
              className="text-[11px] text-sub hover:text-ink"
              title="Nascondi questo pannello"
            >
              Nascondi
            </button>
          </div>
          <ul className="divide-y divide-err-100">
            {refreshFailures.map((f) => {
              const isRetrying = retryingId === f.id;
              return (
                <li
                  key={f.id}
                  className="px-3 py-2 flex items-center gap-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="num-mono font-medium text-ink">
                        {f.symbol}
                      </span>
                      <span className="text-sub truncate">{f.name}</span>
                    </div>
                    <div className="text-err-600 mt-0.5 leading-snug">
                      {f.error}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRetryFailure(f.id)}
                    disabled={isRetrying || rowPending}
                    className="btn-ghost !text-xs whitespace-nowrap"
                  >
                    {isRetrying ? "Riprovo…" : "Riprova"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="panel overflow-hidden">
        <table className="dense">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Symbol</th>
              <th>Nome</th>
              <th style={{ width: 90 }}>Classe</th>
              <th className="text-right" style={{ width: 110 }}>
                Ultimo
              </th>
              <th className="text-right" style={{ width: 80 }} title="Variazione vs giorno precedente">
                Var giorno
              </th>
              <th className="text-right" style={{ width: 80 }} title="Variazione vs 7 giorni fa">
                Var 7g
              </th>
              <th className="text-right" style={{ width: 80 }} title="Variazione vs 30 giorni fa">
                Var 30g
              </th>
              <th style={{ width: 140 }} title="Andamento ultimi 30 giorni">
                Andamento
              </th>
              <th style={{ width: 90 }} className="text-right">
                {/* azione */}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-sub">
                  Nessun asset nella watchlist. Aggiungine uno col bottone in alto.
                </td>
              </tr>
            )}
            {rows.length > 0 && filteredRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-sub">
                  Nessun asset corrisponde a &quot;{searchText}&quot;.
                  {" "}
                  <button
                    type="button"
                    onClick={() => setSearchText("")}
                    className="underline"
                  >
                    Pulisci ricerca
                  </button>
                </td>
              </tr>
            )}
            {filteredRows.map((r) => (
              <tr
                key={r.id}
                className="row cursor-pointer"
                onClick={() => openEdit(r)}
              >
                <td className="font-medium num-mono">
                  {r.symbol}
                  {r.provider === "manual" && (
                    <span
                      className="ml-1 inline-block text-[9px] font-medium text-warn-600 bg-warn-50 border border-warn-500/30 rounded px-1 align-middle"
                      title="Provider manuale: prezzo aggiornato a mano dall'utente"
                    >
                      MAN
                    </span>
                  )}
                </td>
                <td>
                  <div className="leading-snug">{r.name}</div>
                  {r.isin && (
                    <div className="text-[10px] text-sub num-mono" title="ISIN">
                      {r.isin}
                    </div>
                  )}
                </td>
                <td>
                  <span className="pill bg-line2 text-ink2">
                    {CLASS_LABELS[r.assetClass] ?? r.assetClass}
                  </span>
                </td>
                <td className="text-right num-mono">
                  {r.lastPrice != null ? (
                    <>
                      {fmtN(r.lastPrice)} {r.currency !== "%" ? r.currency : "%"}
                      {r.lastAsOf && (
                        <div className="text-[10px] text-sub">{r.lastAsOf}</div>
                      )}
                    </>
                  ) : (
                    <span className="text-sub">—</span>
                  )}
                </td>
                <ChangeCell pct={r.changeDayPct} />
                <ChangeCell pct={r.changeWeekPct} />
                <ChangeCell pct={r.changeMonthPct} />
                <td>
                  <Sparkline points={r.sparkPoints} />
                </td>
                <td
                  className="text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onRefreshOne(r.id)}
                    disabled={rowPending || r.provider === "manual"}
                    title={
                      r.provider === "manual"
                        ? "Asset manuale: aggiorna il prezzo dalla scheda"
                        : "Aggiorna ora"
                    }
                    className="btn-ghost !h-7 !text-[11px] !px-2"
                  >
                    {rowPending ? "…" : "↻"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AssetSearchDialog
        open={searchDialogOpen}
        onClose={() => setSearchDialogOpen(false)}
        onOpenManual={openManual}
      />

      <AssetDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
      />
    </>
  );
}

function ChangeCell({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <td className="text-right num-mono text-sub">—</td>;
  }
  const sign = pct > 0 ? "+" : "";
  const cls =
    pct > 0
      ? "text-ok-600"
      : pct < 0
        ? "text-err-600"
        : "text-sub";
  return (
    <td className={`text-right num-mono font-medium ${cls}`}>
      {sign}
      {pct.toFixed(2)}%
    </td>
  );
}
