/**
 * Provider Stooq (https://stooq.com).
 *
 * CSV pubblico senza autenticazione, copertura EU (Borsa Italiana inclusa).
 * Usato come fallback quando Twelve Data non riconosce un simbolo IT, o
 * quando si esaurisce la quota Twelve Data.
 *
 * Endpoint: GET /q/d/l/?s={symbol}&d1=YYYYMMDD&d2=YYYYMMDD&i=d
 *
 * Convenzione simboli su Stooq:
 *  - Azioni IT: "eni.it" (lowercase, suffisso .it)
 *  - ETF IT:   "cspx.it" (a volte funziona, a volte no — dipende dalla copertura)
 *  - Azioni US: "aapl.us"
 *  - Indici:   "^spx", "^dax", "^ftsemib"
 *  - Cambi:    "eurusd"
 *
 * Risposta CSV: header "Date,Open,High,Low,Close,Volume" seguito da N righe.
 * Se il simbolo non esiste, Stooq ritorna 200 con body "No data\n".
 */

import type {
  AssetForFetch,
  FetchOptions,
  PriceSeriesPoint,
  ProviderResult,
} from "./types";

export async function fetchStooq(
  asset: AssetForFetch,
  opts: FetchOptions = {},
): Promise<ProviderResult> {
  const days = Math.max(5, opts.historyDays ?? 60);

  // Importante: NON passiamo `d1`/`d2` a Stooq. Motivo: se il clock di
  // sistema è "avanti" (test/dev) o "indietro", una finestra di date
  // assoluta diventa inutilizzabile (Stooq risponde con CSV "vuoto" cioè
  // header senza righe). Chiediamo invece tutto lo storico disponibile e
  // tagliamo lato client (`points.slice(-days)` più giù).
  const sym = encodeURIComponent(asset.providerSymbol.toLowerCase());
  const url = `https://stooq.com/q/d/l/?s=${sym}&i=d`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      // UA + Referer "browser-like": Stooq a volte serve risposte diverse
      // per i bot (HTML invece di CSV, CSV vuoto, redirect). Simuliamo un
      // browser che arriva dal sito Stooq stesso.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "text/csv, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
        Referer: "https://stooq.com/",
      },
    });
    if (!res.ok) {
      return { ok: false, error: `Stooq HTTP ${res.status} per ${asset.providerSymbol}` };
    }
    const text = (await res.text()).trim();
    if (!text || text.toLowerCase().startsWith("no data")) {
      return {
        ok: false,
        error: `Stooq: nessun dato per "${asset.providerSymbol}". Verifica la notazione (es. "eni.it", "aapl.us", "^spx").`,
      };
    }
    // Diagnostica: se la risposta non sembra un CSV (no virgole, no newline
    // dopo l'header), probabilmente è HTML/JSON dovuto a bot detection.
    // Esporto un campione per capire.
    const looksLikeCsv = text.includes(",") && /\r?\n/.test(text);
    if (!looksLikeCsv) {
      const sample = text.slice(0, 120).replace(/\s+/g, " ");
      return {
        ok: false,
        error: `Stooq: risposta non-CSV per "${asset.providerSymbol}". Inizio: «${sample}»`,
      };
    }

    const lines = text.split(/\r?\n/);
    // Prima riga è l'header. Le righe successive sono dati.
    const points: PriceSeriesPoint[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 5) continue;
      const date = new Date(cols[0] + "T00:00:00Z");
      const close = parseFloat(cols[4]);
      if (isNaN(date.getTime()) || !Number.isFinite(close)) continue;
      points.push({ date, close });
    }
    if (points.length === 0) {
      // Diagnostica: include un campione del CSV per capire perché il
      // parser non ha estratto righe (header diverso? righe malformate?
      // solo "No data" senza header? Stooq cambia formato di tanto in
      // tanto).
      const sample = text.slice(0, 200).replace(/\s+/g, " ");
      return {
        ok: false,
        error: `Stooq: CSV vuoto per ${asset.providerSymbol}. Body: «${sample}»`,
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
        // Stooq non ritorna la valuta nel CSV; lasciamo undefined così la
        // facade userà Asset.currency.
      },
    };
    if (opts.withHistory) {
      (result as { history?: PriceSeriesPoint[] }).history = points.slice(-days);
    }
    return result;
  } catch (e) {
    return {
      ok: false,
      error: `Stooq fetch fallito: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
