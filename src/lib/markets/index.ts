/**
 * Façade del modulo Mercati.
 *
 * Le server action e il cron chiamano `fetchMarketData(asset, opts)`
 * indipendentemente dal provider. Qui dentro decidiamo a chi inoltrare la
 * chiamata in base a `asset.provider`.
 *
 * Convenzione: i provider concreti non lanciano mai eccezioni — tutti gli
 * errori (HTTP, parsing, rate limit, simbolo non trovato) sono modellati
 * come `{ ok: false, error: string }`. Questo permette al refresh cron di
 * loopare su N asset e raccogliere risultati senza dover gestire try/catch
 * per ciascuno.
 */

import {
  fetchYahoo,
  fetchYahooBatchQuote,
  searchYahoo,
  yahooToStooqSymbol,
  type AssetSearchHit,
  type BatchQuoteHit,
} from "./yahoo";
import { fetchEcb } from "./ecb";
import { fetchStooq } from "./stooq";
import { fetchTwelveData, yahooToTwelveDataSymbol } from "./twelvedata";
import type {
  AssetForFetch,
  FetchOptions,
  ProviderName,
  ProviderResult,
} from "./types";

export * from "./types";
export type { AssetSearchHit, BatchQuoteHit };
export {
  searchYahoo,
  yahooToStooqSymbol,
  fetchYahooBatchQuote,
  fetchStooq,
  fetchTwelveData,
  yahooToTwelveDataSymbol,
};
export {
  getCatalogGrouped,
  getCatalogFlat,
  getCategoriesForAssetClass,
  CATALOG_CATEGORIES_ORDER,
  type CatalogCategory,
  type CatalogHit,
  type CatalogGroup,
} from "./catalog";

/**
 * Dispatch al provider giusto. Il provider "manual" è un no-op: ritorna
 * sempre `{ ok: false, error: "manual" }` così il refresh cron non fa
 * nulla e il prezzo del fondo italiano resta quello inserito a mano
 * dall'utente.
 */
export async function fetchMarketData(
  asset: AssetForFetch,
  opts: FetchOptions = {},
): Promise<ProviderResult> {
  switch (asset.provider) {
    case "yahoo":
      return fetchYahoo(asset, opts);
    case "ecb":
      return fetchEcb(asset, opts);
    case "stooq":
      return fetchStooq(asset, opts);
    case "manual":
      return {
        ok: false,
        error:
          "provider=manual: nessun fetch automatico, aggiorna il prezzo a mano dalla scheda asset",
      };
    default:
      // Guardia per provider futuri/typo. TS dovrebbe già coprire, ma
      // meglio essere espliciti per le run dinamiche post-migration.
      return {
        ok: false,
        error: `Provider sconosciuto: "${asset.provider as string}"`,
      };
  }
}

/**
 * Suggerisce il provider di default in base a `assetClass`.
 * Usato dalla UI quando l'utente aggiunge un nuovo asset: pre-compila il
 * provider sensato (cambi/tassi → ECB ufficiale, fondi italiani → manuale,
 * azioni/ETF/indici → Stooq come provider free/affidabile di default).
 * L'utente può sempre sovrascrivere nel form.
 */
export function suggestProvider(assetClass: string): ProviderName {
  switch (assetClass) {
    case "currency":
    case "rate":
      return "ecb";
    case "fund":
      // I fondi italiani SGR non hanno API pubblica → manuale di default.
      return "manual";
    case "stock":
    case "etf":
    case "index":
      return "stooq";
    case "bond":
    case "crypto":
    case "other":
    default:
      return "stooq";
  }
}

/**
 * Costruisce un providerSymbol "ragionevole" partendo da un symbol e da
 * un provider. Best-effort: serve da pre-compilazione nel form. L'utente
 * resta libero di editarlo a mano (es. per indici dove Yahoo vuole il
 * prefisso "^").
 *
 * Esempi:
 *  - suggestProviderSymbol("ENI.MI", "yahoo")   → "ENI.MI"
 *  - suggestProviderSymbol("EUR/USD", "ecb")    → "USD"
 *  - suggestProviderSymbol("EUR/USD", "yahoo")  → "EURUSD=X"
 *  - suggestProviderSymbol("FTSEMIB", "yahoo")  → "^FTSEMIB"
 *  - suggestProviderSymbol("eni.it", "stooq")   → "eni.it"
 */
export function suggestProviderSymbol(
  symbol: string,
  provider: ProviderName,
): string {
  const s = symbol.trim();
  if (provider === "ecb") {
    // Per cambi tipo "EUR/USD" → ECB vuole solo "USD".
    const m = s.match(/^EUR\/?([A-Z]{3})$/i);
    if (m) return m[1].toUpperCase();
    // Tassi: lascia passare le stringhe magiche (ECB-MRO, EURIBOR-3M, ecc.)
    return s.toUpperCase();
  }
  if (provider === "yahoo") {
    // Cambi: "EUR/USD" o "EURUSD" → "EURUSD=X"
    const m = s.match(/^([A-Z]{3})\/?([A-Z]{3})$/i);
    if (m) return `${m[1].toUpperCase()}${m[2].toUpperCase()}=X`;
    // Indici comuni — aggiungi "^" se l'utente l'ha scritto senza
    const indicesShorthand = new Set([
      "FTSEMIB",
      "GSPC",
      "DJI",
      "IXIC",
      "STOXX50E",
      "STOXX",
      "DAX",
      "FCHI",
      "FTSE",
    ]);
    if (indicesShorthand.has(s.toUpperCase())) return `^${s.toUpperCase()}`;
    return s;
  }
  // Stooq: lowercase con .it/.us suffix usuale
  if (provider === "stooq") return s.toLowerCase();
  return s;
}
