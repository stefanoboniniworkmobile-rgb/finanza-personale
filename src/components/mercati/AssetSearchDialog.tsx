"use client";

/**
 * Dialog "Cerca asset" — flow primario per aggiungere asset alla watchlist.
 *
 * Funziona così:
 *  1. Campo search testuale in alto. A campo vuoto mostra il catalogo curato
 *     (~140 asset divisi in categorie: Azioni IT/USA/EU, ETF Azionari/
 *     Obbligazionari/Tematici, Indici, Cambi, Cripto). Da 2 char in poi fa
 *     la search live su Yahoo Finance.
 *  2. Riga di chip-filter per tipo (Tutti/Azione/ETF/Indice/Cambio/Cripto/
 *     Obbligaz./Fondo). Filtra entrambe le modalità (catalogo + search Yahoo)
 *     lato client su `assetClass`.
 *  3. Click su un risultato → saveAsset diretto con i dati del hit. Toast di
 *     conferma e chiusura dialog. L'utente può poi modificare nome/note dalla
 *     pagina Mercati cliccando sulla riga.
 *  4. Link "Inseriscilo manualmente" in fondo che apre il vecchio AssetDialog
 *     per inserire asset non coperti da Yahoo (es. fondi italiani SGR).
 *
 * Razionale: Yahoo non ha API "browse all" — la search vuole una query
 * testuale. Il catalogo curato dà l'illusione di "sfogliare" e copre i casi
 * tipici (top 20-30 per categoria). Per il long tail (singole azioni meno
 * note, ETF specifici) la search testuale via Yahoo prende il sopravvento.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveAsset,
  searchAssets,
  resolveAssetByIsin,
} from "@/app/(app)/mercati/actions";
import { getCatalogFlat, type CatalogHit } from "@/lib/markets/catalog";
import { type AssetSearchHit } from "@/lib/markets";
import { isValidIsin } from "@/lib/markets/openfigi";
import type { IsinResolution } from "@/lib/markets/isin";

/** Tipi filtrabili dal chip-row. "all" = tutti. */
type TypeFilter =
  | "all"
  | "stock"
  | "etf"
  | "index"
  | "currency"
  | "crypto"
  | "bond"
  | "fund";

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "Tutti" },
  { value: "stock", label: "Azioni" },
  { value: "etf", label: "ETF" },
  { value: "index", label: "Indici" },
  { value: "currency", label: "Cambi" },
  { value: "crypto", label: "Cripto" },
  { value: "bond", label: "Obbligaz." },
  { value: "fund", label: "Fondi" },
];

/** Filtro per mercato/regione. Mappa exchange Yahoo → categoria geografica. */
type MarketFilter = "all" | "italia" | "usa" | "europa" | "altri";

const MARKET_FILTERS: { value: MarketFilter; label: string }[] = [
  { value: "all", label: "Ogni mercato" },
  { value: "italia", label: "Italia (MIL)" },
  { value: "usa", label: "USA" },
  { value: "europa", label: "Europa" },
  { value: "altri", label: "Altri" },
];

// Set di exchange Yahoo per ciascuna regione. Yahoo non standardizza i codici
// in modo perfetto: cerchiamo di coprire i più comuni. "MIL" è univoco per
// Borsa Italiana. Per "Altri" cadono cambi (FX), cripto (CCC), Asia (OSA, HKG,
// TYO), borse minori e quanto non riconosciuto.
const US_EXCHANGES = new Set(["NMS", "NYQ", "PCX", "NCM", "BATS", "ASE", "OPR"]);
const EU_EXCHANGES = new Set([
  "PAR", // Parigi
  "AMS", // Amsterdam
  "LON",
  "LSE",
  "XETRA",
  "GER", // Francoforte (Yahoo a volte usa GER)
  "EBS", // Zurigo
  "VIE", // Vienna
  "MAD", // Madrid
  "MCE", // Madrid Bolsa
  "STX", // STOXX
  "STO", // Stoccolma
  "CPH", // Copenhagen
  "HEL", // Helsinki
  "OSL", // Oslo
  "BRU", // Bruxelles
]);

function exchangeToMarket(exchange?: string): MarketFilter {
  if (!exchange) return "altri";
  const e = exchange.toUpperCase();
  if (e === "MIL") return "italia";
  if (US_EXCHANGES.has(e)) return "usa";
  if (EU_EXCHANGES.has(e)) return "europa";
  return "altri";
}

/** Label corte per chip in riga risultato (singolare). */
const CLASS_LABEL_SHORT: Record<string, string> = {
  stock: "Azione",
  etf: "ETF",
  index: "Indice",
  currency: "Cambio",
  crypto: "Cripto",
  fund: "Fondo",
  bond: "Obbligaz.",
  other: "Altro",
};

/**
 * Un hit unificato: può venire dal catalogo curato (ha `category`) o
 * dalla search Yahoo (no `category`). La UI lista entrambi nello stesso modo
 * — la sola differenza è il raggruppamento del catalogo per categoria.
 */
type UnifiedHit = AssetSearchHit & { category?: string };

export function AssetSearchDialog({
  open,
  onClose,
  onOpenManual,
}: {
  open: boolean;
  onClose: () => void;
  /** Chiude questo dialog e apre il vecchio AssetDialog per inserimento manuale. */
  onOpenManual: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [yahooResults, setYahooResults] = useState<AssetSearchHit[]>([]);
  const [yahooLoading, setYahooLoading] = useState(false);
  // Modalità ISIN: se l'utente incolla un ISIN, risolviamo nome (Bloomberg)
  // + simbolo/prezzo (Yahoo) + confidenza invece della ricerca testuale.
  const [isinRes, setIsinRes] = useState<IsinResolution | null>(null);
  const [isinLoading, setIsinLoading] = useState(false);

  // Riga in pending mentre saveAsset è in corso (per disabilitare la riga
  // cliccata e mostrare spinner inline).
  const [pendingHit, setPendingHit] = useState<string | null>(null);
  const [, startSave] = useTransition();
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null,
  );

  // Catalogo: carico una sola volta all'apertura. È puro JS (no fetch), quindi
  // costo zero.
  const catalog = useMemo<CatalogHit[]>(() => getCatalogFlat(), []);

  // Reset stato all'apertura
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTypeFilter("all");
    setMarketFilter("all");
    setYahooResults([]);
    setYahooLoading(false);
    setPendingHit(null);
    setToast(null);
  }, [open]);

  // Open/close del <dialog>
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Debounce: ISIN → risoluzione Bloomberg+Yahoo; altrimenti search testuale.
  useEffect(() => {
    const raw = query.trim();
    const code = raw.toUpperCase();
    setIsinRes(null);

    if (isValidIsin(code)) {
      setYahooResults([]);
      setYahooLoading(false);
      setIsinLoading(true);
      const t = setTimeout(async () => {
        const r = await resolveAssetByIsin(code);
        setIsinRes(r.ok ? r.data : null);
        setIsinLoading(false);
      }, 350);
      return () => clearTimeout(t);
    }

    setIsinLoading(false);
    if (raw.length < 2) {
      setYahooResults([]);
      setYahooLoading(false);
      return;
    }
    setYahooLoading(true);
    const t = setTimeout(async () => {
      const res = await searchAssets(raw);
      if (res.ok) setYahooResults(res.results);
      else setYahooResults([]);
      setYahooLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // ─── Calcolo lista da mostrare ───────────────────────────────────────
  //
  // Logica:
  //  - q < 2 char → mostra il catalogo (eventualmente filtrato per tipo)
  //  - q ≥ 2 char → mostra i risultati Yahoo (eventualmente filtrati per tipo)
  // In entrambi i casi la lista viene raggruppata: per `category` se viene
  // dal catalogo, per `assetClass` (label) altrimenti.
  const isSearchMode = query.trim().length >= 2;
  const isIsinMode = isValidIsin(query.trim().toUpperCase());

  type Group = { label: string; items: UnifiedHit[] };

  // Predicato singolo che applica entrambi i filtri (tipo + mercato).
  // Usato sia per il catalogo che per i risultati Yahoo.
  const matchesFilters = (h: UnifiedHit): boolean => {
    if (typeFilter !== "all" && h.assetClass !== typeFilter) return false;
    if (marketFilter !== "all" && exchangeToMarket(h.exchange) !== marketFilter)
      return false;
    return true;
  };

  const groups: Group[] = useMemo(() => {
    if (isSearchMode) {
      const filtered = yahooResults.filter(matchesFilters);
      // Raggruppo per assetClass label (mantiene ordine TYPE_FILTERS).
      const byCls = new Map<string, UnifiedHit[]>();
      for (const h of filtered) {
        const k = h.assetClass;
        const arr = byCls.get(k) ?? [];
        arr.push(h);
        byCls.set(k, arr);
      }
      const order: string[] = ["stock", "etf", "index", "currency", "crypto", "fund", "bond", "other"];
      return order
        .filter((k) => (byCls.get(k)?.length ?? 0) > 0)
        .map((k) => ({
          label: pluralLabel(k),
          items: byCls.get(k) ?? [],
        }));
    }
    // Modalità catalogo
    const filtered = catalog.filter(matchesFilters);
    // Raggruppo per `category` (ordine determinato dall'ordine di
    // inserimento nel catalogo).
    const byCat = new Map<string, UnifiedHit[]>();
    const orderSeen: string[] = [];
    for (const h of filtered) {
      if (!byCat.has(h.category)) {
        byCat.set(h.category, []);
        orderSeen.push(h.category);
      }
      byCat.get(h.category)!.push(h);
    }
    return orderSeen.map((cat) => ({
      label: cat,
      items: byCat.get(cat) ?? [],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearchMode, yahooResults, catalog, typeFilter, marketFilter]);

  const totalShown = groups.reduce((s, g) => s + g.items.length, 0);

  // ─── Aggiunta asset al click ─────────────────────────────────────────
  /**
   * Click su un asset → chiama saveAsset col mapping minimale (symbol+name+
   * assetClass+providerSymbol). currency default EUR — l'utente può
   * modificare dopo dalla pagina mercati.
   */
  const pickAndAdd = (hit: UnifiedHit) => {
    const key = `${hit.symbol}-${hit.providerSymbol}`;
    setPendingHit(key);
    setToast(null);
    startSave(async () => {
      const res = await saveAsset({
        symbol: hit.symbol,
        isin: null,
        name: hit.name,
        assetClass: hit.assetClass,
        currency: "EUR",
        provider: "yahoo",
        providerSymbol: hit.providerSymbol,
        notes: null,
      });
      setPendingHit(null);
      if (!res.ok) {
        setToast({ kind: "err", msg: res.error });
        return;
      }
      setToast({ kind: "ok", msg: `Aggiunto: ${hit.name}` });
      router.refresh();
      // Lascia aperto il dialog per aggiungere altri asset di fila —
      // chiudere richiede di cliccare la X o "Chiudi" in basso. Più
      // veloce per chi vuole popolare la watchlist con 5-10 asset.
    });
  };

  /** Aggiunge l'asset risolto da ISIN: nome Bloomberg + simbolo/prezzo Yahoo. */
  const addFromIsin = (r: IsinResolution) => {
    if (!r.yahoo) return;
    setPendingHit("ISIN");
    setToast(null);
    startSave(async () => {
      const res = await saveAsset({
        symbol: r.yahoo!.symbol,
        isin: r.isin,
        name: r.figiName ?? r.yahoo!.name,
        assetClass: r.yahoo!.assetClass,
        currency: r.currency ?? "EUR",
        provider: "yahoo",
        providerSymbol: r.yahoo!.symbol,
        notes: null,
      });
      setPendingHit(null);
      if (!res.ok) {
        setToast({ kind: "err", msg: res.error });
        return;
      }
      setToast({ kind: "ok", msg: `Aggiunto: ${r.figiName ?? r.yahoo!.name}` });
      router.refresh();
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
      style={{ maxWidth: 720, width: "calc(100vw - 32px)" }}
    >
      <div className="bg-white flex flex-col" style={{ maxHeight: "min(86vh, 720px)" }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <div className="font-semibold text-base">Cerca asset</div>
            <div className="text-xs text-sub">
              Cerca per nome o ticker, oppure sfoglia il catalogo. Clic su un
              risultato lo aggiunge alla watchlist.
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

        {/* Search + filtri */}
        <div className="px-5 py-3 border-b border-line space-y-3 shrink-0 bg-bg/40">
          <input
            type="text"
            className="input w-full"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder='Cerca "eni", "S&P 500", "EUR/USD", "AAPL"…'
          />
          <div className="space-y-1.5">
            {/* Riga 1 — Tipo di asset */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-sub w-14 shrink-0">
                Tipo
              </span>
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setTypeFilter(f.value)}
                  className={
                    "text-xs px-2.5 py-1 rounded-full border transition-colors " +
                    (typeFilter === f.value
                      ? "bg-ink text-white border-ink"
                      : "bg-white text-ink2 border-line hover:bg-bg")
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
            {/* Riga 2 — Mercato/regione */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-sub w-14 shrink-0">
                Mercato
              </span>
              {MARKET_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setMarketFilter(f.value)}
                  className={
                    "text-xs px-2.5 py-1 rounded-full border transition-colors " +
                    (marketFilter === f.value
                      ? "bg-ink text-white border-ink"
                      : "bg-white text-ink2 border-line hover:bg-bg")
                  }
                >
                  {f.label}
                </button>
              ))}
              <div className="ml-auto text-[11px] text-sub">
                {isIsinMode
                  ? isinLoading
                    ? "Risolvo ISIN…"
                    : isinRes
                      ? "ISIN risolto"
                      : "ISIN non trovato"
                  : isSearchMode
                    ? yahooLoading
                      ? "Cercando…"
                      : `${totalShown} da Yahoo`
                    : `${totalShown} dal catalogo`}
              </div>
            </div>
          </div>
          {toast && (
            <div
              className={
                "text-xs px-3 py-2 rounded-md border " +
                (toast.kind === "ok"
                  ? "bg-ok-50 text-ok-600 border-ok-100"
                  : "bg-err-50 text-err-600 border-err-100")
              }
            >
              {toast.msg}
            </div>
          )}
        </div>

        {/* Lista risultati */}
        <div className="overflow-y-auto flex-1 min-h-[200px]">
          {isIsinMode ? (
            <IsinAddCard
              loading={isinLoading}
              res={isinRes}
              pending={pendingHit === "ISIN"}
              onAdd={addFromIsin}
              onManual={onOpenManual}
            />
          ) : (
          <>
          {/* Modalità ricerca con loading */}
          {isSearchMode && yahooLoading && (
            <div className="px-4 py-3 text-xs text-sub italic">Cercando su Yahoo…</div>
          )}
          {/* Nessun risultato */}
          {!yahooLoading && totalShown === 0 && (
            <div className="px-4 py-6 text-center text-sm text-sub space-y-2">
              <div>
                {isSearchMode
                  ? "Nessun risultato per la tua ricerca con questo filtro."
                  : typeFilter === "bond"
                    ? "Le obbligazioni singole non sono su Yahoo. Per ETF obbligazionari prova il filtro \"ETF\"."
                    : typeFilter === "fund"
                      ? "I fondi italiani SGR non sono su Yahoo. Usa \"Inseriscilo manualmente\" qui sotto."
                      : "Nessun asset nel catalogo per questo filtro."}
              </div>
              <button
                type="button"
                onClick={onOpenManual}
                className="text-xs text-acc-700 hover:underline"
              >
                Inseriscilo manualmente →
              </button>
            </div>
          )}
          {/* Gruppi */}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="sticky top-0 z-10 px-4 py-1.5 bg-bg/95 backdrop-blur-sm border-b border-line text-[10px] font-semibold uppercase tracking-wider text-sub">
                {g.label}
                <span className="ml-2 text-sub/70 normal-case">
                  · {g.items.length}
                </span>
              </div>
              {g.items.map((hit) => {
                const key = `${hit.symbol}-${hit.providerSymbol}`;
                const isPending = pendingHit === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={isPending}
                    onClick={() => pickAndAdd(hit)}
                    className="w-full text-left px-4 py-2.5 hover:bg-bg border-b border-line2 last:border-b-0 disabled:opacity-50"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium num-mono text-sm">{hit.symbol}</span>
                      <span className="text-[11px] text-sub">
                        {CLASS_LABEL_SHORT[hit.assetClass] ?? hit.assetClass}
                        {hit.exchange ? ` · ${hit.exchange}` : ""}
                      </span>
                      {isPending && (
                        <span className="ml-auto text-[11px] text-sub italic">
                          Aggiungendo…
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink2 leading-snug truncate">
                      {hit.name}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line bg-bg flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onOpenManual}
            className="text-xs text-acc-700 hover:underline"
          >
            Non trovi l'asset? Inseriscilo manualmente →
          </button>
          <button type="button" onClick={onClose} className="btn-ghost">
            Chiudi
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Card mostrata quando l'utente incolla un ISIN: nome autorevole da Bloomberg
 * (OpenFIGI), simbolo/prezzo da Yahoo e punteggio di confidenza sul fatto che
 * il simbolo Yahoo sia davvero quello strumento.
 */
function IsinAddCard({
  loading,
  res,
  pending,
  onAdd,
  onManual,
}: {
  loading: boolean;
  res: IsinResolution | null;
  pending: boolean;
  onAdd: (r: IsinResolution) => void;
  onManual: () => void;
}) {
  if (loading) {
    return (
      <div className="px-4 py-6 text-sm text-sub italic">
        Risolvo l&apos;ISIN su Bloomberg e Yahoo…
      </div>
    );
  }
  if (!res) {
    return (
      <div className="px-4 py-6 text-center text-sm text-sub space-y-2">
        <div>ISIN non riconosciuto. Verifica il codice o inseriscilo a mano.</div>
        <button
          type="button"
          onClick={onManual}
          className="text-xs text-brand-600 hover:underline"
        >
          Inseriscilo manualmente →
        </button>
      </div>
    );
  }

  const c = res.confidence;
  const tone =
    c.level === "alta"
      ? { box: "border-ok-100 bg-ok-50", chip: "border-ok-100 text-ok-600", label: "Alta" }
      : c.level === "media"
        ? { box: "border-warn-100 bg-warn-50", chip: "border-warn-100 text-warn-600", label: "Media" }
        : { box: "border-err-100 bg-err-50", chip: "border-err-100 text-err-600", label: "Bassa" };

  return (
    <div className="p-4">
      <div className={`rounded-lg border p-3.5 space-y-2.5 ${tone.box}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-sub mb-0.5">
              Nome (Bloomberg)
            </div>
            <div className="text-sm font-semibold leading-snug">
              {res.figiName ?? "Non trovato su OpenFIGI"}
            </div>
          </div>
          <span
            className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-white ${tone.chip}`}
          >
            Confidenza {tone.label} · {c.percent}%
          </span>
        </div>

        <div className="text-xs text-sub num-mono">
          {res.yahoo
            ? `${res.yahoo.symbol} · ${res.price != null ? res.price : "—"} ${res.currency ?? ""}`
            : "Yahoo: nessun simbolo per questo ISIN"}
        </div>

        <ul className="text-[11px] text-sub space-y-0.5 list-disc pl-4">
          {c.reasons.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>

        {c.level !== "alta" && res.yahoo && (
          <div className={`text-[11px] font-medium ${tone.chip.split(" ")[1]}`}>
            Verifica il prezzo/NAV su una fonte ufficiale prima di fidarti.
          </div>
        )}

        <div className="pt-1">
          {res.yahoo ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => onAdd(res)}
              className="btn !h-8 !text-xs disabled:opacity-50"
            >
              {pending ? "Aggiungendo…" : "Aggiungi alla watchlist"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onManual}
              className="btn-ghost !h-8 !text-xs"
            >
              Nessun prezzo Yahoo — inseriscilo manualmente →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Etichetta plurale per il raggruppamento "search Yahoo". */
function pluralLabel(cls: string): string {
  switch (cls) {
    case "stock":
      return "Azioni";
    case "etf":
      return "ETF";
    case "index":
      return "Indici";
    case "currency":
      return "Cambi";
    case "crypto":
      return "Cripto";
    case "fund":
      return "Fondi";
    case "bond":
      return "Obbligazioni";
    default:
      return "Altro";
  }
}
