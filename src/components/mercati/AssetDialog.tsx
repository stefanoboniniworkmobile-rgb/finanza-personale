"use client";

/**
 * Dialog di inserimento manuale o modifica di un Asset.
 *
 * Comportamento:
 *  - Campi: symbol, isin, name, assetClass, currency, provider, providerSymbol, notes
 *  - Quando cambia assetClass o symbol, pre-compila provider/providerSymbol via
 *    suggerimenti del modulo lib/markets (senza sovrascrivere modifiche manuali esplicite)
 *  - Se provider=manual, mostra un campo extra "Prezzo NAV" per inserire subito un valore
 *  - Bottone Elimina (solo edit) e Aggiorna NAV (solo provider=manual)
 *
 * NB: il flow primario per AGGIUNGERE asset alla watchlist è ora
 * `AssetSearchDialog` (search + filtri + click → add). Questo dialog è
 * usato per:
 *  - MODIFICARE un asset esistente (click su una riga in /mercati)
 *  - INSERIMENTO MANUALE di asset non coperti da Yahoo (es. fondi italiani
 *    SGR) — aperto dal link "Inseriscilo manualmente" dentro AssetSearchDialog.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveAsset,
  deleteAsset,
  setManualPrice,
  resolveAssetByIsin,
  addLot,
  deleteLot,
  type AssetInput,
} from "@/app/(app)/mercati/actions";
import { NumberInput } from "@/components/ui/NumberInput";
import type { IsinResolution } from "@/lib/markets/isin";
import { computeHolding } from "@/lib/markets/holdings";
import { fmtN } from "@/lib/format";

type LotView = {
  id: string;
  quantity: number;
  price: number;
  fee: number;
  date: string;
  note: string | null;
};

export type AssetDialogValue = Partial<AssetInput> & {
  id?: string;
  symbol?: string;
  isin?: string | null;
  name?: string;
  assetClass?: string;
  currency?: string;
  provider?: string;
  providerSymbol?: string;
  notes?: string | null;
  lots?: LotView[];
  lastPrice?: number | null;
};

const ASSET_CLASS_OPTIONS: { value: string; label: string }[] = [
  { value: "stock", label: "Azione" },
  { value: "etf", label: "ETF" },
  { value: "index", label: "Indice" },
  { value: "currency", label: "Cambio" },
  { value: "rate", label: "Tasso" },
  { value: "bond", label: "Obbligazione" },
  { value: "fund", label: "Fondo comune" },
  { value: "crypto", label: "Criptovaluta" },
  { value: "other", label: "Altro" },
];

const PROVIDER_OPTIONS: { value: string; label: string; hint?: string }[] = [
  { value: "yahoo", label: "Yahoo Finance", hint: "Azioni, ETF, indici, fondi (NAV) e crypto" },
  { value: "ecb", label: "BCE (ufficiale)", hint: "Solo cambi EUR/X e tassi BCE" },
  { value: "manual", label: "Manuale", hint: "Inserisci il prezzo a mano" },
  { value: "stooq", label: "Stooq (deprecato)", hint: "Bloccato da anti-bot: non aggiorna più" },
];

// Suggerimenti runtime (mirror lato client di suggestProvider/suggestProviderSymbol
// dal server). Tenuti minimali per non duplicare logica — il server fa il lavoro
// "vero" comunque. Qui solo per UX di pre-compilazione.
function clientSuggestProvider(cls: string): string {
  if (cls === "currency" || cls === "rate") return "ecb";
  if (cls === "fund") return "manual";
  return "yahoo";
}
function clientSuggestProviderSymbol(symbol: string, provider: string): string {
  const s = symbol.trim();
  if (!s) return "";
  if (provider === "ecb") {
    const m = s.match(/^EUR\/?([A-Z]{3})$/i);
    if (m) return m[1].toUpperCase();
    return s.toUpperCase();
  }
  if (provider === "yahoo") {
    const m = s.match(/^([A-Z]{3})\/?([A-Z]{3})$/i);
    if (m) return `${m[1].toUpperCase()}${m[2].toUpperCase()}=X`;
    const idx = new Set(["FTSEMIB", "GSPC", "DJI", "IXIC", "STOXX50E", "DAX"]);
    if (idx.has(s.toUpperCase())) return `^${s.toUpperCase()}`;
    return s;
  }
  if (provider === "stooq") return s.toLowerCase();
  return s;
}

export function AssetDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: AssetDialogValue;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Risoluzione da ISIN: nome autorevole (OpenFIGI) + simbolo/prezzo (Yahoo)
  // + confidenza. `resolution` è mostrata come anteprima con warning.
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<IsinResolution | null>(null);
  // Acquisti (lotti) per il calcolo del guadagno/perdita.
  const [lots, setLots] = useState<LotView[]>(initial?.lots ?? []);
  const [lotQty, setLotQty] = useState<number | null>(null);
  const [lotPrice, setLotPrice] = useState<number | null>(null);
  const [lotFee, setLotFee] = useState<number | null>(null);
  const [lotDate, setLotDate] = useState("");
  const [lotBusy, setLotBusy] = useState(false);

  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [isin, setIsin] = useState(initial?.isin ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [assetClass, setAssetClass] = useState(initial?.assetClass ?? "stock");
  const [currency, setCurrency] = useState(initial?.currency ?? "EUR");
  const [provider, setProvider] = useState(initial?.provider ?? "yahoo");
  const [providerSymbol, setProviderSymbol] = useState(initial?.providerSymbol ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [initialPrice, setInitialPrice] = useState<number | null>(null);
  // Flag per sapere se l'utente ha toccato manualmente provider/providerSymbol.
  // Se sì, smettiamo di sovrascriverli con i suggerimenti automatici.
  const [providerTouched, setProviderTouched] = useState(false);
  const [providerSymbolTouched, setProviderSymbolTouched] = useState(false);

  // Sync con initial quando il dialog si apre con un nuovo movimento.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setResolution(null);
    setResolving(false);
    setLots(initial?.lots ?? []);
    setLotQty(null);
    setLotPrice(null);
    setLotFee(null);
    // Precompila la data d'acquisto con oggi: campo obbligatorio, così non
    // si dimentica (era la causa più probabile di "aggiunto ma non salvato").
    setLotDate(new Date().toISOString().slice(0, 10));
    setSymbol(initial?.symbol ?? "");
    setIsin(initial?.isin ?? "");
    setName(initial?.name ?? "");
    setAssetClass(initial?.assetClass ?? "stock");
    setCurrency(initial?.currency ?? "EUR");
    setProvider(initial?.provider ?? "yahoo");
    setProviderSymbol(initial?.providerSymbol ?? "");
    setNotes(initial?.notes ?? "");
    setInitialPrice(null);
    // In create (no id) ripartiamo con i touched a false così i suggerimenti
    // ri-popolano i campi mentre l'utente digita. In edit invece consideriamo
    // i campi "già toccati" — l'utente li ha scelti consapevolmente.
    setProviderTouched(!!initial?.id);
    setProviderSymbolTouched(!!initial?.id);
  }, [open, initial]);

  // Auto-suggest del provider quando cambia assetClass (solo se l'utente non
  // l'ha già toccato manualmente).
  useEffect(() => {
    if (providerTouched) return;
    setProvider(clientSuggestProvider(assetClass));
  }, [assetClass, providerTouched]);

  // Auto-suggest del providerSymbol quando cambia symbol o provider.
  useEffect(() => {
    if (providerSymbolTouched) return;
    setProviderSymbol(clientSuggestProviderSymbol(symbol, provider));
  }, [symbol, provider, providerSymbolTouched]);

  // Open/close del <dialog>
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const isManualProvider = provider === "manual";

  /**
   * Risolve l'ISIN inserito: chiama OpenFIGI (nome) + Yahoo (simbolo/prezzo),
   * pre-compila i campi e mostra il punteggio di confidenza. Non forza nulla:
   * l'utente vede l'anteprima e può correggere prima di salvare.
   */
  const handleResolveIsin = async () => {
    const code = isin.trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(code)) {
      setError("Inserisci un ISIN valido (12 caratteri).");
      return;
    }
    setError(null);
    setResolution(null);
    setResolving(true);
    const r = await resolveAssetByIsin(code);
    setResolving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const res = r.data;
    setResolution(res);
    // Pre-compila coi dati risolti (l'utente può poi ritoccare).
    if (res.figiName) setName(res.figiName);
    if (res.yahoo) {
      setSymbol(res.yahoo.symbol);
      setAssetClass(res.yahoo.assetClass);
      setProvider("yahoo");
      setProviderTouched(true);
      setProviderSymbol(res.yahoo.symbol);
      setProviderSymbolTouched(true);
    }
    if (res.currency) setCurrency(res.currency);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: AssetInput = {
      id: initial?.id,
      symbol,
      isin: isin.trim() ? isin.trim() : null,
      name,
      assetClass: assetClass as AssetInput["assetClass"],
      currency: currency.trim() || "EUR",
      provider: provider as AssetInput["provider"],
      providerSymbol: providerSymbol.trim(),
      notes: notes.trim() ? notes.trim() : null,
      // initialPrice viene letto solo lato server quando provider=manual + create
      initialPrice: !initial?.id && isManualProvider && initialPrice && initialPrice > 0
        ? initialPrice
        : undefined,
    };
    startTransition(async () => {
      const res = await saveAsset(payload);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  const handleDelete = () => {
    if (!initial?.id) return;
    if (
      !confirm(
        "Eliminare questo asset dalla watchlist? Lo storico prezzi verrà cancellato.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAsset(initial.id!);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  /** Aggiorna il NAV manualmente — usato solo per provider=manual in edit. */
  const handleUpdateManual = () => {
    if (!initial?.id || !initialPrice || initialPrice <= 0) {
      setError("Inserisci un prezzo valido prima di aggiornare");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setManualPrice(initial.id!, initialPrice);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        setInitialPrice(null);
      }
    });
  };

  const providerHint = useMemo(
    () => PROVIDER_OPTIONS.find((p) => p.value === provider)?.hint ?? "",
    [provider],
  );

  const holdingSummary = useMemo(
    () =>
      computeHolding(
        lots.map((l) => ({ quantity: l.quantity, price: l.price, fee: l.fee })),
        initial?.lastPrice ?? null,
      ),
    [lots, initial?.lastPrice],
  );

  const addLotHandler = async () => {
    if (!initial?.id) return;
    if (!lotQty || lotQty <= 0 || lotPrice == null || lotPrice < 0 || !lotDate) {
      setError("Inserisci quantità, prezzo e data dell'acquisto.");
      return;
    }
    setError(null);
    setLotBusy(true);
    const res = await addLot({
      assetId: initial.id,
      quantity: lotQty,
      price: lotPrice,
      fee: lotFee ?? 0,
      date: lotDate,
    });
    setLotBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Aggiorna subito la lista (ottimistico) + ricarica la tabella.
    setLots((prev) =>
      [
        ...prev,
        {
          id: `tmp-${prev.length}-${lotDate}`,
          quantity: lotQty,
          price: lotPrice,
          fee: lotFee ?? 0,
          date: lotDate,
          note: null,
        },
      ].sort((a, b) => a.date.localeCompare(b.date)),
    );
    setLotQty(null);
    setLotPrice(null);
    setLotFee(null);
    setLotDate("");
    router.refresh();
  };

  const deleteLotHandler = async (lotId: string) => {
    const prev = lots;
    setLots((p) => p.filter((l) => l.id !== lotId));
    if (lotId.startsWith("tmp-")) return;
    const res = await deleteLot(lotId);
    if (!res.ok) {
      setError(res.error);
      setLots(prev);
      return;
    }
    router.refresh();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="rounded-lg border border-line shadow-2xl p-0 backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      style={{ maxWidth: 580, width: "calc(100vw - 32px)" }}
    >
      <form onSubmit={handleSubmit} className="bg-white">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-semibold text-base">
              {initial?.id ? "Modifica asset" : "Inserimento manuale"}
            </div>
            <div className="text-xs text-sub">
              {initial?.id
                ? "Modifica i dati dell'asset o aggiorna il NAV"
                : "Per asset non coperti da Yahoo (es. fondi italiani SGR)"}
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
          {/* Symbol + Classe */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Symbol (label)">
              <input
                type="text"
                required
                maxLength={40}
                className="input w-full num-mono"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="Es. ENI.MI, AAPL, EUR/USD"
              />
            </Field>
            <Field label="Classe asset">
              <select
                className="input w-full"
                value={assetClass}
                onChange={(e) => setAssetClass(e.target.value)}
              >
                {ASSET_CLASS_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Nome + ISIN */}
          <Field label="Nome">
            <input
              type="text"
              required
              maxLength={120}
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Es. "Eni S.p.A.", "iShares Core S&P 500 UCITS ETF"'
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="ISIN (opzionale)">
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={12}
                  className="input w-full num-mono"
                  value={isin}
                  onChange={(e) => setIsin(e.target.value.toUpperCase())}
                  placeholder="Es. IT0003132476"
                />
                <button
                  type="button"
                  onClick={handleResolveIsin}
                  disabled={resolving || isin.trim().length !== 12}
                  className="btn-ghost !text-xs whitespace-nowrap"
                  title="Cerca nome e prezzo partendo dall'ISIN"
                >
                  {resolving ? "…" : "Risolvi"}
                </button>
              </div>
              <div className="text-[11px] text-sub mt-1">
                Da ISIN: nome certo (Bloomberg) + prezzo (Yahoo)
              </div>
            </Field>
            <Field label="Valuta">
              <input
                type="text"
                maxLength={8}
                className="input w-full"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                placeholder="EUR"
              />
            </Field>
          </div>

          {resolution && <IsinResolutionCard r={resolution} />}

          {/* Provider + ProviderSymbol */}
          <div className="rounded-md border border-line bg-bg/40 p-3 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-sub">
              Sorgente dati
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider">
                <select
                  className="input w-full"
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setProviderTouched(true);
                  }}
                >
                  {PROVIDER_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {providerHint && (
                  <div className="text-[11px] text-sub mt-1">{providerHint}</div>
                )}
              </Field>
              <Field label="Symbol provider">
                <input
                  type="text"
                  maxLength={60}
                  className="input w-full num-mono"
                  value={providerSymbol}
                  onChange={(e) => {
                    setProviderSymbol(e.target.value);
                    setProviderSymbolTouched(true);
                  }}
                  disabled={isManualProvider}
                  placeholder={
                    provider === "yahoo"
                      ? "Es. ENI.MI, ^FTSEMIB, EURUSD=X"
                      : provider === "ecb"
                        ? "Es. USD, ECB-MRO, EURIBOR-3M"
                        : provider === "stooq"
                          ? "Es. eni.it, ^ftsemib"
                          : "—"
                  }
                />
              </Field>
            </div>
          </div>

          {/* Prezzo manuale: solo per provider=manual */}
          {isManualProvider && (
            <Field
              label={
                initial?.id
                  ? "Aggiorna NAV (€)"
                  : "Prezzo iniziale NAV (€) — opzionale"
              }
            >
              <div className="flex gap-2">
                <NumberInput
                  value={initialPrice}
                  onValueChange={setInitialPrice}
                  min={0}
                  className="input flex-1 text-right num-mono"
                  placeholder="0,00"
                />
                {initial?.id && (
                  <button
                    type="button"
                    onClick={handleUpdateManual}
                    disabled={isPending || !initialPrice || initialPrice <= 0}
                    className="btn-ghost !text-xs whitespace-nowrap"
                  >
                    Salva NAV
                  </button>
                )}
              </div>
              <div className="text-[11px] text-sub mt-1">
                {initial?.id
                  ? "Inserisci il NAV attuale del fondo e clicca \"Salva NAV\" — verrà registrato come prezzo di oggi."
                  : "Se inserito, verrà salvato come prezzo del giorno di creazione."}
              </div>
            </Field>
          )}

          {/* Acquisti (portafoglio) — solo in modifica (serve l'asset esistente) */}
          {initial?.id && (
            <div className="rounded-md border border-line p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sub">
                  Acquisti (portafoglio)
                </div>
                {holdingSummary && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] justify-end">
                    <span className="text-sub">
                      Qtà{" "}
                      <b className="text-ink num">{fmtN(holdingSummary.quantity)}</b>
                    </span>
                    <span className="text-sub">
                      Medio{" "}
                      <b className="text-ink num">{fmtN(holdingSummary.avgPrice)}</b>
                    </span>
                    {holdingSummary.pnl != null && holdingSummary.pnlPct != null && (
                      <span
                        className={
                          holdingSummary.pnl >= 0 ? "text-ok-600" : "text-err-600"
                        }
                      >
                        <b className="num">
                          {holdingSummary.pnl >= 0 ? "+" : "−"}
                          {fmtN(Math.abs(holdingSummary.pnl))} (
                          {holdingSummary.pnl >= 0 ? "+" : ""}
                          {holdingSummary.pnlPct.toFixed(1)}%)
                        </b>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {lots.length > 0 && (
                <div className="space-y-1">
                  {lots.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center gap-2 text-xs num-mono"
                    >
                      <span className="w-16 text-right">{fmtN(l.quantity)}</span>
                      <span className="text-sub">×</span>
                      <span className="w-20 text-right">{fmtN(l.price)}</span>
                      {l.fee > 0 && (
                        <span className="text-sub text-[10px]">
                          +{fmtN(l.fee)} comm.
                        </span>
                      )}
                      <span className="text-sub ml-auto">{l.date}</span>
                      <button
                        type="button"
                        onClick={() => deleteLotHandler(l.id)}
                        aria-label="Elimina acquisto"
                        className="text-err-600 hover:bg-err-50 rounded w-6 h-6 grid place-items-center leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                <label className="block">
                  <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1">
                    Quantità
                  </div>
                  <NumberInput
                    value={lotQty}
                    onValueChange={setLotQty}
                    min={0}
                    className="input w-full text-right num-mono"
                    placeholder="0"
                  />
                </label>
                <label className="block">
                  <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1">
                    Prezzo
                  </div>
                  <NumberInput
                    value={lotPrice}
                    onValueChange={setLotPrice}
                    min={0}
                    className="input w-full text-right num-mono"
                    placeholder="0,00"
                  />
                </label>
                <label className="block">
                  <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1">
                    Commissioni
                  </div>
                  <NumberInput
                    value={lotFee}
                    onValueChange={setLotFee}
                    min={0}
                    className="input w-full text-right num-mono"
                    placeholder="0,00"
                  />
                </label>
                <label className="block">
                  <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-1">
                    Data
                  </div>
                  <input
                    type="date"
                    value={lotDate}
                    onChange={(e) => setLotDate(e.target.value)}
                    className="input w-full"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={addLotHandler}
                disabled={lotBusy}
                className="btn-ghost !h-8 !text-xs"
              >
                {lotBusy ? "Aggiungo…" : "+ Aggiungi acquisto"}
              </button>
            </div>
          )}

          {/* Note */}
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
              {isPending ? "Salvataggio…" : initial?.id ? "Salva modifiche" : "Crea asset"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Anteprima della risoluzione ISIN con badge di confidenza.
 * alta = verde, media = ambra, bassa = rosso. Elenca i motivi del punteggio,
 * e per media/bassa invita a verificare il prezzo/NAV prima di fidarsi.
 */
function IsinResolutionCard({ r }: { r: IsinResolution }) {
  const c = r.confidence;
  const tone =
    c.level === "alta"
      ? { box: "border-ok-100 bg-ok-50", chip: "border-ok-100 text-ok-600", label: "Alta" }
      : c.level === "media"
        ? { box: "border-warn-100 bg-warn-50", chip: "border-warn-100 text-warn-600", label: "Media" }
        : { box: "border-err-100 bg-err-50", chip: "border-err-100 text-err-600", label: "Bassa" };

  return (
    <div className={`rounded-md border p-3 space-y-2 ${tone.box}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-snug">
          {r.figiName ?? "Nome non trovato su OpenFIGI"}
        </div>
        <span
          className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-white ${tone.chip}`}
        >
          Confidenza {tone.label} · {c.percent}%
        </span>
      </div>

      <div className="text-xs text-sub num-mono">
        {r.yahoo
          ? `${r.yahoo.symbol} · ${r.price != null ? r.price : "—"} ${r.currency ?? ""}`
          : "Yahoo: nessun simbolo trovato per questo ISIN"}
      </div>

      <ul className="text-[11px] text-sub space-y-0.5 list-disc pl-4">
        {c.reasons.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>

      {c.level !== "alta" && (
        <div className={`text-[11px] font-medium ${tone.chip.split(" ")[1]}`}>
          Verifica il prezzo/NAV su una fonte ufficiale prima di fidarti.
        </div>
      )}
    </div>
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
