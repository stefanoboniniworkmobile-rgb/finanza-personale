/**
 * Provider Yahoo Finance — endpoint chart pubblico.
 *
 * URL: https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1mo
 *
 * Vantaggi:
 *  - Niente API key, niente registrazione, niente env var.
 *  - Copertura ottima: azioni IT (suffisso `.MI`), azioni US, ETF UCITS (`CSPX.MI`),
 *    indici (`^FTSEMIB`, `^GSPC`, `^DJI`), cambi (`EURUSD=X`), cripto (`BTC-EUR`).
 *  - Risposta JSON pulita, una sola chiamata per quote + storico insieme.
 *
 * Svantaggi:
 *  - Endpoint UFFICIOSO. Yahoo lo offre per il widget del proprio sito e ogni
 *    tanto introduce challenge anti-bot. Se smettesse di funzionare, il fallback
 *    è Stooq (che ha copertura simile, magari con notazione diversa).
 *  - Rate limit non documentato. In pratica 1-2 req/sec va benissimo, e nel
 *    refresh cron sequenziale (1 alla volta con piccola pausa) non si vede.
 *
 * Convenzione simbolo (cosa mettere in Asset.providerSymbol):
 *  - Azioni Borsa Italiana: "ENI.MI", "ENEL.MI", "ISP.MI"
 *  - Azioni US: "AAPL", "MSFT", "TSLA"
 *  - ETF MIB: "CSPX.MI", "EUNL.DE" (a seconda di dove sono quotati)
 *  - Indici: "^FTSEMIB", "^GSPC" (S&P 500), "^DJI", "^IXIC", "^STOXX50E"
 *  - Cambi: "EURUSD=X", "EURGBP=X" (suffisso =X)
 *  - Cripto: "BTC-EUR", "ETH-EUR"
 *  - Materie prime futures: "GC=F" (gold), "CL=F" (WTI)
 */

import type {
  AssetForFetch,
  FetchOptions,
  PriceSeriesPoint,
  ProviderResult,
} from "./types";

const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search";
const QUOTE_BATCH_URL = "https://query1.finance.yahoo.com/v7/finance/quote";

/**
 * Headers per le chiamate Yahoo: solo uno User-Agent MINIMALE ("Mozilla/5.0").
 *
 * Fatto misurato (luglio 2026, IP datacenter, 5+ campioni per endpoint su
 * search v1 e chart v8):
 *   - User-Agent lungo (stringa Safari completa) → HTTP 429 su TUTTI i campioni
 *   - User-Agent corto "Mozilla/5.0"             → HTTP 200 su TUTTI i campioni
 * È deterministico, non rate-limit casuale: Yahoo blocca lo UA "browser
 * completo" da server e accetta quello minimale. Referer/Origin NON c'entrano
 * (li avevo incolpati per errore). Se in futuro tornasse a dare 429, ri-misurare
 * con lo stesso metodo prima di cambiare qualcosa.
 */
const YAHOO_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0",
};

/**
 * Fetch verso Yahoo con retry su 429.
 *
 * NIENTE cookie/crumb: il vecchio flusso getcrumb faceva 2-3 richieste extra
 * per ogni chiamata e, moltiplicato per i retry, si auto-infliggeva il 429.
 * Gli endpoint che usiamo (v8 chart, v1 search) non richiedono crumb.
 * Verifica empirica (luglio 2026): fetch "nuda" con solo UA → HTTP 200.
 *
 * Restituisce sempre la `Response` finale (il caller decide come gestirla).
 */
async function yahooFetch(url: string): Promise<Response> {
  const maxAttempts = 3;
  let lastRes: Response | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, { cache: "no-store", headers: YAHOO_HEADERS });
    lastRes = res;

    if (res.status !== 429) return res;
    if (attempt === maxAttempts) return res;
    // Backoff crescente: 700ms, poi 1400ms.
    await new Promise((r) => setTimeout(r, 700 * attempt));
  }
  return lastRes as Response;
}

/**
 * Risultato di una ricerca asset via Yahoo: già normalizzato nel "linguaggio"
 * della nostra app — pronto da usare per pre-compilare AssetDialog.
 */
export type AssetSearchHit = {
  /** Symbol "leggibile" da mostrare in tabella (es. "ENI.MI"). */
  symbol: string;
  /** Symbol nel formato richiesto dal provider Yahoo (identico al symbol per Yahoo). */
  providerSymbol: string;
  /** Nome completo (es. "Eni S.p.A.", "iShares Core MSCI World UCITS ETF"). */
  name: string;
  /** Classe asset mappata dal quoteType Yahoo. */
  assetClass:
    | "stock"
    | "etf"
    | "index"
    | "currency"
    | "crypto"
    | "fund"
    | "other";
  /** Codice del mercato Yahoo (es. "MIL", "NMS"). Solo informativo. */
  exchange?: string;
};

/** Mappa Yahoo quoteType → la nostra assetClass. */
function mapQuoteType(qt: string | undefined): AssetSearchHit["assetClass"] {
  switch ((qt ?? "").toUpperCase()) {
    case "EQUITY":
      return "stock";
    case "ETF":
      return "etf";
    case "INDEX":
      return "index";
    case "CURRENCY":
      return "currency";
    case "CRYPTOCURRENCY":
      return "crypto";
    case "MUTUALFUND":
      return "fund";
    default:
      return "other";
  }
}

/**
 * Ricerca asset via Yahoo Finance search endpoint pubblico.
 * Niente API key. Restituisce fino a `count` suggerimenti normalizzati.
 *
 * Caso d'uso UI: l'utente digita "eni" nel campo ricerca del dialog,
 * vede una dropdown con "ENI.MI — Eni S.p.A. (MIL, Azione)" e cliccando
 * pre-compila symbol/name/assetClass/providerSymbol.
 *
 * In caso di errore (network, rate limit, parsing) ritorna lista vuota.
 * Non blocchiamo mai la UI per una ricerca fallita.
 */
export async function searchYahoo(
  query: string,
  count = 10,
): Promise<AssetSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&lang=it-IT&region=IT&quotesCount=${count}&newsCount=0`;
  try {
    const res = await yahooFetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        exchange?: string;
        quoteType?: string;
      }>;
    };
    const quotes = json.quotes ?? [];
    return quotes
      .filter((q) => typeof q.symbol === "string" && q.symbol.length > 0)
      .map((q) => ({
        symbol: q.symbol as string,
        providerSymbol: q.symbol as string,
        name: (q.longname ?? q.shortname ?? q.symbol) as string,
        assetClass: mapQuoteType(q.quoteType),
        exchange: q.exchange,
      }));
  } catch {
    return [];
  }
}

/**
 * Converte un symbol nel formato Yahoo nel corrispondente formato Stooq,
 * usato come fallback quando Yahoo rate-limita. Stooq copre azioni/ETF
 * europei e US con notazione lowercase + suffisso country.
 *
 * Mapping suffissi mercato:
 *   Yahoo .MI → Stooq .it  (Borsa Italiana)
 *   Yahoo .DE → Stooq .de  (XETRA / Francoforte)
 *   Yahoo .PA → Stooq .fr  (Parigi)
 *   Yahoo .AS → Stooq .nl  (Amsterdam)
 *   Yahoo .L  → Stooq .uk  (Londra)
 *   Yahoo .SW → Stooq .ch  (Zurigo)
 *   Yahoo .MC → Stooq .es  (Madrid)
 *   Yahoo (nessun suffisso) → Stooq .us
 *
 * Indici: piccola lookup table, copertura parziale.
 * Cambi (EURUSD=X) → Stooq usa "eurusd" senza suffisso.
 * Cripto: Stooq copre poco — non tentiamo fallback.
 *
 * Ritorna `null` se non sappiamo convertire — il caller userà l'errore
 * Yahoo originale senza tentare Stooq.
 */
export function yahooToStooqSymbol(
  yahooSymbol: string,
  assetClass: string,
): string | null {
  const s = yahooSymbol.trim();
  if (!s) return null;

  // Cripto: Stooq non copre BTC/ETH in EUR/USD in modo affidabile.
  if (assetClass === "crypto") return null;

  // Cambi: "EURUSD=X" → "eurusd"
  const fxMatch = s.match(/^([A-Z]{3})([A-Z]{3})=X$/i);
  if (fxMatch) return `${fxMatch[1].toLowerCase()}${fxMatch[2].toLowerCase()}`;

  // Indici "^XXXX" → lookup table limitata. Su Stooq i tickers indici
  // hanno notazioni proprie (^spx vs Yahoo ^GSPC, ecc.).
  if (s.startsWith("^")) {
    const indexMap: Record<string, string> = {
      "^FTSEMIB": "^ftm",
      "^GSPC": "^spx",
      "^DJI": "^dji",
      "^IXIC": "^ndq",
      "^NDX": "^ndx",
      "^GDAXI": "^dax",
      "^FCHI": "^cac",
      "^FTSE": "^ukx",
      "^N225": "^nkx",
      "^STOXX50E": "^stx50",
      "^STOXX": "^stxe",
      "^IBEX": "^ibex",
      "^HSI": "^hsi",
      "^RUT": "^rut",
    };
    return indexMap[s.toUpperCase()] ?? null;
  }

  // Azioni/ETF con suffisso ".XX" Yahoo → suffisso Stooq
  const suffixMap: Record<string, string> = {
    MI: "it",
    DE: "de",
    PA: "fr",
    AS: "nl",
    L: "uk",
    SW: "ch",
    MC: "es",
    MAD: "es",
    OL: "no",
    ST: "se",
    CO: "dk",
    HE: "fi",
    BR: "be",
    VI: "at",
  };
  const dotIdx = s.lastIndexOf(".");
  if (dotIdx > 0) {
    const base = s.slice(0, dotIdx);
    const ySuffix = s.slice(dotIdx + 1).toUpperCase();
    const sSuffix = suffixMap[ySuffix];
    if (sSuffix) return `${base.toLowerCase()}.${sSuffix}`;
    return null;
  }

  // Niente suffisso → assunzione US (solo per azioni/ETF)
  if (assetClass === "stock" || assetClass === "etf") {
    return `${s.toLowerCase()}.us`;
  }

  return null;
}

/** Mappa "giorni di storico richiesti" → parametro `range` accettato da Yahoo. */
function rangeFromDays(days: number): string {
  if (days <= 5) return "5d";
  if (days <= 31) return "1mo";
  if (days <= 95) return "3mo";
  if (days <= 200) return "6mo";
  if (days <= 380) return "1y";
  return "2y";
}

/**
 * Struttura della risposta Yahoo (parte che ci serve):
 *  {
 *    chart: {
 *      result: [{
 *        meta: {
 *          regularMarketPrice: 180.42,
 *          chartPreviousClose: 178.10,
 *          currency: "USD",
 *          regularMarketTime: 1716480000,
 *          symbol: "AAPL",
 *          ...
 *        },
 *        timestamp: [1715875200, 1715961600, ...],
 *        indicators: { quote: [{ close: [180.10, 181.55, ...] }] }
 *      }],
 *      error: null
 *    }
 *  }
 */
type YahooMeta = {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  currency?: string;
  regularMarketTime?: number;
  symbol?: string;
};
type YahooResult = {
  meta?: YahooMeta;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};
type YahooResponse = {
  chart?: {
    result?: YahooResult[];
    error?: { code?: string; description?: string } | null;
  };
};

export async function fetchYahoo(
  asset: AssetForFetch,
  opts: FetchOptions = {},
): Promise<ProviderResult> {
  const days = Math.max(5, Math.min(opts.historyDays ?? 30, 730));
  const range = rangeFromDays(days);
  const symbol = encodeURIComponent(asset.providerSymbol);
  const url = `${BASE_URL}/${symbol}?interval=1d&range=${range}`;

  try {
    const res = await yahooFetch(url);
    if (!res.ok) {
      // 429 dopo i retry → messaggio specifico user-friendly invece di
      // "HTTP 429". L'utente capisce di aspettare invece di pensare a un bug.
      if (res.status === 429) {
        return {
          ok: false,
          error: `Yahoo: troppe richieste in corso (429). Aspetta qualche minuto e ritenta — il ticker è valido.`,
        };
      }
      return {
        ok: false,
        error: `Yahoo HTTP ${res.status} per "${asset.providerSymbol}"`,
      };
    }
    const json = (await res.json()) as YahooResponse;
    const err = json.chart?.error;
    if (err) {
      return {
        ok: false,
        error: `Yahoo: ${err.description ?? "errore"} (code ${err.code ?? "?"}) per ${asset.providerSymbol}`,
      };
    }
    const result = json.chart?.result?.[0];
    if (!result || !result.meta) {
      return {
        ok: false,
        error: `Yahoo: nessun dato per "${asset.providerSymbol}". Controlla la notazione (es. "ENI.MI", "^FTSEMIB", "EURUSD=X").`,
      };
    }

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    if (!Number.isFinite(price as number)) {
      return {
        ok: false,
        error: `Yahoo: prezzo non disponibile per ${asset.providerSymbol}`,
      };
    }
    const prevClose = meta.chartPreviousClose ?? meta.previousClose;
    const changePercent =
      prevClose && prevClose !== 0
        ? (((price as number) - prevClose) / prevClose) * 100
        : undefined;
    const asOf =
      meta.regularMarketTime != null
        ? new Date(meta.regularMarketTime * 1000)
        : new Date();

    const out: ProviderResult = {
      ok: true,
      quote: {
        price: price as number,
        changePercent,
        asOf,
        currency: meta.currency,
      },
    };

    if (opts.withHistory) {
      // Yahoo ritorna timestamp[] in secondi UNIX e close[] allineato per indice.
      const timestamps = result.timestamp ?? [];
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      const points: PriceSeriesPoint[] = [];
      for (let i = 0; i < timestamps.length && i < closes.length; i++) {
        const c = closes[i];
        if (c == null || !Number.isFinite(c)) continue;
        points.push({
          date: new Date(timestamps[i] * 1000),
          close: c,
        });
      }
      if (points.length > 0) {
        (out as { history?: PriceSeriesPoint[] }).history = points.slice(-days);
      }
    }
    return out;
  } catch (e) {
    return {
      ok: false,
      error: `Yahoo fetch fallito: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Batch quote — l'endpoint v7/finance/quote accetta più simboli per
// chiamata. Lo usiamo in "Aggiorna tutto" per ridurre N richieste a 1.
// Riduce drasticamente le occasioni di 429.
//
// Risposta:
//   { quoteResponse: { result: [ { symbol, regularMarketPrice, ... } ], error: null } }
//
// Limiti pratici: Yahoo accetta fino a ~250 simboli per request. Spezziamo
// in chunk di 50 per sicurezza (URL più corte, errore granulare).
// ─────────────────────────────────────────────────────────────────────

export type BatchQuoteHit = {
  /** Simbolo Yahoo identico al providerSymbol passato. */
  providerSymbol: string;
  price: number;
  previousClose?: number;
  changePercent?: number;
  asOf: Date;
  currency?: string;
};

type YahooQuoteV7Item = {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketChangePercent?: number;
  regularMarketTime?: number;
  currency?: string;
};
type YahooQuoteV7Response = {
  quoteResponse?: {
    result?: YahooQuoteV7Item[];
    error?: { description?: string; code?: string } | null;
  };
};

/**
 * Recupera quote (solo prezzo attuale + change, NO storico) per N simboli
 * in 1 chiamata HTTP. Spezza in chunk di 50 se ce ne sono di più.
 *
 * Usato da `refreshAllAssets` per evitare il pattern "30 chiamate sequenziali
 * → 429 al N-esimo". La sparkline NON viene aggiornata da qui — per quella
 * serve l'endpoint chart (chiamata singola con history) che resta in
 * `fetchYahoo` e viene chiamato dal refresh singolo o dal cron notturno.
 *
 * Ritorna una `Map providerSymbol → BatchQuoteHit`. Simboli non riconosciuti
 * da Yahoo semplicemente non compaiono nella map: il caller li individua per
 * differenza e li segnala come errore al singolo asset.
 */
export async function fetchYahooBatchQuote(
  providerSymbols: string[],
): Promise<
  { ok: true; quotes: Map<string, BatchQuoteHit> } | { ok: false; error: string }
> {
  if (providerSymbols.length === 0) {
    return { ok: true, quotes: new Map() };
  }
  const CHUNK_SIZE = 50;
  const out = new Map<string, BatchQuoteHit>();

  for (let i = 0; i < providerSymbols.length; i += CHUNK_SIZE) {
    const chunk = providerSymbols.slice(i, i + CHUNK_SIZE);
    // Note: NON usiamo encodeURIComponent sul join — i simboli Yahoo
    // contengono '^', '.', '=', '-' che vanno bene in query string. Ma
    // encodiamo le virgole per sicurezza? No, Yahoo le vuole letterali.
    // Simboli problematici (es. '^FTSEMIB') vanno encodati singolarmente.
    const symbolsParam = chunk
      .map((s) => encodeURIComponent(s))
      .join(",");
    const url = `${QUOTE_BATCH_URL}?symbols=${symbolsParam}`;
    const res = await yahooFetch(url);
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 429
            ? `Yahoo batch HTTP 429 (rate limit) per ${chunk.length} simboli`
            : `Yahoo batch HTTP ${res.status} per ${chunk.length} simboli`,
      };
    }
    let json: YahooQuoteV7Response;
    try {
      json = (await res.json()) as YahooQuoteV7Response;
    } catch {
      return { ok: false, error: "Yahoo batch: risposta non-JSON" };
    }
    const err = json.quoteResponse?.error;
    if (err) {
      return {
        ok: false,
        error: `Yahoo batch: ${err.description ?? "errore"}${err.code ? ` (${err.code})` : ""}`,
      };
    }
    const results = json.quoteResponse?.result ?? [];
    for (const r of results) {
      if (!r.symbol || typeof r.regularMarketPrice !== "number") continue;
      const prev =
        r.regularMarketPreviousClose ??
        r.previousClose ??
        r.chartPreviousClose;
      const changePercent =
        typeof r.regularMarketChangePercent === "number"
          ? r.regularMarketChangePercent
          : prev && prev !== 0
            ? ((r.regularMarketPrice - prev) / prev) * 100
            : undefined;
      out.set(r.symbol, {
        providerSymbol: r.symbol,
        price: r.regularMarketPrice,
        previousClose: prev,
        changePercent,
        asOf: r.regularMarketTime
          ? new Date(r.regularMarketTime * 1000)
          : new Date(),
        currency: r.currency,
      });
    }
  }

  return { ok: true, quotes: out };
}
