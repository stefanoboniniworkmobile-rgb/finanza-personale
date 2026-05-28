/**
 * Provider Twelve Data (https://twelvedata.com).
 *
 * Free tier: 800 chiamate/giorno, ~8 al minuto. Sufficiente per uso
 * personale di Finanza Personale, dove "Aggiorna tutto" su 30 asset si
 * fa una volta al giorno (e da Yahoo, con TwD come fallback solo quando
 * Yahoo rate-limita).
 *
 * Endpoint usato:
 *   GET https://api.twelvedata.com/time_series
 *     ?symbol=AAPL&interval=1day&outputsize=70&apikey=KEY
 *
 * Notazione symbol Twelve Data:
 *   - Azioni US:           "AAPL", "MSFT"           (exchange default NASDAQ/NYSE)
 *   - Azioni Italia:       "ENI:MTA", "ENEL:MTA"    (MTA = Mercato Telematico Azionario)
 *   - Azioni Germania:     "SAP:XETR"               (XETR = XETRA)
 *   - Azioni UK:           "SHEL:LSE"
 *   - Azioni Francia:      "MC:XPAR"
 *   - Azioni Olanda:       "ASML:XAMS"
 *   - Azioni Svizzera:     "NOVN:VTX"               (oppure :SWX)
 *   - Indici:              "SPX", "DJI", "IXIC", "DAX", "FTSEMIB"
 *   - Cambi:               "EUR/USD", "GBP/USD"
 *   - Cripto:              "BTC/EUR", "ETH/USD"
 *
 * Risposta time_series:
 *   { status: "ok"|"error", code?: number, message?: string,
 *     meta: { symbol, interval, currency, exchange },
 *     values: [{ datetime, open, high, low, close, volume }, ...] }
 *
 * Errori comuni:
 *   - 401: API key invalida
 *   - 404: symbol non riconosciuto
 *   - 429: quota giornaliera esaurita o rate limit minuto
 */

import type {
  AssetForFetch,
  FetchOptions,
  PriceSeriesPoint,
  ProviderResult,
} from "./types";

const BASE_URL = "https://api.twelvedata.com";

/**
 * Converte un symbol Yahoo nel formato Twelve Data, usato come fallback
 * quando Yahoo rate-limita. Conoscenza dei mercati e prefissi mappata
 * staticamente per evitare round-trip aggiuntivi.
 *
 * Ritorna `null` se non sappiamo convertire — il caller non tenta TwD.
 */
export function yahooToTwelveDataSymbol(
  yahooSymbol: string,
  assetClass: string,
): string | null {
  const s = yahooSymbol.trim();
  if (!s) return null;

  // Cambi: "EURUSD=X" → "EUR/USD"
  const fxMatch = s.match(/^([A-Z]{3})([A-Z]{3})=X$/i);
  if (fxMatch) return `${fxMatch[1].toUpperCase()}/${fxMatch[2].toUpperCase()}`;

  // Cripto: "BTC-EUR" → "BTC/EUR"
  const cryptoMatch = s.match(/^([A-Z0-9]{2,8})-([A-Z]{3})$/);
  if (cryptoMatch) {
    return `${cryptoMatch[1].toUpperCase()}/${cryptoMatch[2].toUpperCase()}`;
  }

  // Indici Yahoo "^XXXX" → notazione Twelve Data senza ^
  if (s.startsWith("^")) {
    const indexMap: Record<string, string> = {
      "^FTSEMIB": "FTSEMIB",
      "^GSPC": "SPX",
      "^DJI": "DJI",
      "^IXIC": "IXIC",
      "^NDX": "NDX",
      "^GDAXI": "DAX",
      "^FCHI": "CAC",
      "^FTSE": "UKX",
      "^N225": "N225",
      "^STOXX50E": "SX5E",
      "^STOXX": "SXXP",
      "^IBEX": "IBEX",
      "^HSI": "HSI",
      "^RUT": "RUT",
      "^VIX": "VIX",
    };
    return indexMap[s.toUpperCase()] ?? null;
  }

  // Azioni/ETF con suffisso mercato Yahoo → notazione "TICKER:EXCHANGE"
  const suffixMap: Record<string, string> = {
    MI: "MTA",
    DE: "XETR",
    PA: "XPAR",
    AS: "XAMS",
    L: "LSE",
    SW: "VTX",
    MC: "BME",
    OL: "OSE",
    ST: "OMX",
    CO: "OMX",
    HE: "OMX",
    BR: "BRU",
    VI: "VIE",
  };
  const dotIdx = s.lastIndexOf(".");
  if (dotIdx > 0) {
    const base = s.slice(0, dotIdx);
    const ySuffix = s.slice(dotIdx + 1).toUpperCase();
    const tdSuffix = suffixMap[ySuffix];
    if (tdSuffix) return `${base.toUpperCase()}:${tdSuffix}`;
    return null;
  }

  // Senza suffisso → US (Twelve Data lo gestisce con exchange default)
  if (assetClass === "stock" || assetClass === "etf") {
    return s.toUpperCase();
  }

  return null;
}

type TwelveDataResponse = {
  status?: "ok" | "error";
  code?: number;
  message?: string;
  meta?: {
    symbol?: string;
    interval?: string;
    currency?: string;
    exchange?: string;
  };
  values?: Array<{
    datetime: string;
    open?: string;
    high?: string;
    low?: string;
    close: string;
    volume?: string;
  }>;
};

/**
 * Fetch quote + storico via Twelve Data time_series endpoint.
 *
 * Richiede `TWELVE_DATA_API_KEY` in env. Se la key manca, ritorna errore
 * descrittivo invece di provare a chiamare l'API senza autenticazione.
 *
 * In caso di rate limit (429 o errore "credits/limit"), il messaggio è
 * specifico così l'utente capisce che il problema è quota e non symbol.
 */
export async function fetchTwelveData(
  asset: AssetForFetch,
  opts: FetchOptions = {},
): Promise<ProviderResult> {
  const apikey = process.env.TWELVE_DATA_API_KEY;
  if (!apikey) {
    return {
      ok: false,
      error:
        "Twelve Data: API key non configurata (TWELVE_DATA_API_KEY in .env). Vedi docs/setup-twelvedata.md.",
    };
  }

  const days = Math.max(5, Math.min(opts.historyDays ?? 60, 365));
  // Output un po' più ampio dei `days` per assorbire weekend/festivi.
  const outputsize = days + 15;
  const symbol = encodeURIComponent(asset.providerSymbol);
  const url = `${BASE_URL}/time_series?symbol=${symbol}&interval=1day&outputsize=${outputsize}&apikey=${apikey}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      // 429 può arrivare anche come HTTP status, non solo come body.
      if (res.status === 429) {
        return {
          ok: false,
          error: `Twelve Data: rate limit (HTTP 429) — quota minuto/giorno esaurita.`,
        };
      }
      return {
        ok: false,
        error: `Twelve Data HTTP ${res.status} per "${asset.providerSymbol}"`,
      };
    }
    const json = (await res.json()) as TwelveDataResponse;

    // Twelve Data restituisce sempre 200 e l'errore è nel body con status="error".
    if (json.status === "error" || (json.code && json.code >= 400)) {
      const msg = json.message ?? "errore sconosciuto";
      if (json.code === 429 || /credit|limit|run out/i.test(msg)) {
        return {
          ok: false,
          error: `Twelve Data: quota esaurita o rate limit. ${msg}`,
        };
      }
      if (json.code === 401) {
        return {
          ok: false,
          error: `Twelve Data: API key invalida. Controlla TWELVE_DATA_API_KEY in .env.`,
        };
      }
      return { ok: false, error: `Twelve Data: ${msg}` };
    }

    const values = json.values ?? [];
    if (values.length === 0) {
      return {
        ok: false,
        error: `Twelve Data: nessun dato per "${asset.providerSymbol}". Verifica la notazione (es. "ENI:MTA", "AAPL", "EUR/USD").`,
      };
    }

    // Twelve Data restituisce `values` dal più recente al più vecchio.
    // Riordino cronologico per coerenza con gli altri provider.
    const points: PriceSeriesPoint[] = [];
    for (const v of values) {
      const date = new Date(v.datetime + "T00:00:00Z");
      const close = parseFloat(v.close);
      if (isNaN(date.getTime()) || !Number.isFinite(close)) continue;
      points.push({ date, close });
    }
    if (points.length === 0) {
      return {
        ok: false,
        error: `Twelve Data: nessun valore numerico parsabile per ${asset.providerSymbol}`,
      };
    }
    points.sort((a, b) => a.date.getTime() - b.date.getTime());

    const last = points[points.length - 1];
    const prev = points.length >= 2 ? points[points.length - 2] : null;
    const changePercent =
      prev && prev.close !== 0
        ? ((last.close - prev.close) / prev.close) * 100
        : undefined;

    const result: ProviderResult = {
      ok: true,
      quote: {
        price: last.close,
        changePercent,
        asOf: last.date,
        currency: json.meta?.currency,
      },
    };
    if (opts.withHistory) {
      (result as { history?: PriceSeriesPoint[] }).history = points.slice(-days);
    }
    return result;
  } catch (e) {
    return {
      ok: false,
      error: `Twelve Data fetch fallito: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
