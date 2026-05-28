/**
 * Tipi comuni del modulo Mercati.
 *
 * Ogni provider concreto (Twelve Data, ECB, Stooq, manual) implementa lo
 * stesso contratto `fetchMarketData(...)` e restituisce un `ProviderResult`.
 * Questo permette al refresh cron / alle server actions di trattare gli
 * asset in modo uniforme indipendentemente da dove vengono i prezzi.
 */

/** Nome del provider — corrisponde 1:1 a Asset.provider.
 * Tutti zero-config (no API key): yahoo è il principale, ecb per cambi/tassi
 * BCE ufficiali, stooq fallback, manual per fondi italiani senza API. */
export type ProviderName = "yahoo" | "ecb" | "stooq" | "manual";

/** Asset class — corrisponde 1:1 a Asset.assetClass. */
export type AssetClass =
  | "stock"
  | "etf"
  | "index"
  | "currency"
  | "rate"
  | "bond"
  | "fund"
  | "crypto"
  | "other";

/** Risultato del fetch quote: l'ultimo prezzo + metadati minimi. */
export type Quote = {
  /** Prezzo / valore corrente. */
  price: number;
  /** Variazione % vs il giorno precedente (opzionale, alcuni provider non la danno). */
  changePercent?: number;
  /** Timestamp di riferimento (data del prezzo). */
  asOf: Date;
  /**
   * Valuta delle quotazioni, se ricavabile dal provider.
   * Per i tassi (rate) la convenzione è "%".
   * Se non valorizzato, usiamo Asset.currency come default.
   */
  currency?: string;
};

/** Punto di una serie storica EOD. */
export type PriceSeriesPoint = {
  date: Date;
  close: number;
};

/**
 * Output unificato dei provider.
 * Mai throw — gli errori sono modellati come `{ ok: false, error }` perché
 * un fail di un asset non deve far saltare il refresh degli altri.
 */
export type ProviderResult =
  | {
      ok: true;
      quote: Quote;
      /** Storico EOD ordinato cronologicamente (vecchio → recente). Presente solo se richiesto. */
      history?: PriceSeriesPoint[];
    }
  | { ok: false; error: string };

/**
 * Sottoinsieme di Asset usato dai provider. Tutto quello che serve per
 * fare la chiamata è qui — passando un oggetto "leggero" evitiamo di
 * accoppiare i provider al Prisma client.
 */
export type AssetForFetch = {
  symbol: string;
  provider: ProviderName;
  providerSymbol: string;
  assetClass: AssetClass;
};

/** Opzioni del fetch. */
export type FetchOptions = {
  /** Se true, richiede anche lo storico (per sparkline). */
  withHistory?: boolean;
  /** Quanti giorni di storico (default 30). */
  historyDays?: number;
};
