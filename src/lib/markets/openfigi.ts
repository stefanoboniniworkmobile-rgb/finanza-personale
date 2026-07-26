/**
 * OpenFIGI (Bloomberg) — mapping ISIN → strumento.
 *
 * Servizio gratuito e autorevole: dato un ISIN restituisce nome ufficiale,
 * tipo strumento, mercato e ticker Bloomberg. NON dà prezzi (per quelli usiamo
 * Yahoo) e NON contiene i simboli Yahoo (simbologia proprietaria non pubblica).
 *
 * Endpoint: POST https://api.openfigi.com/v3/mapping
 * Senza API key funziona con rate limit basso (~25 req/min): sufficiente per
 * risolvere un ISIN alla volta quando l'utente aggiunge un asset.
 *
 * Verifica empirica (lug 2026):
 *   IT0004965148 → "MONCLER SPA" (Common Stock, IM)
 *   IT0005689069 → "EURIZON SOLUZIONE IMPRESE-E" (Mutual Fund, IM)
 */

export type FigiInstrument = {
  /** Nome ufficiale (es. "MONCLER SPA"). */
  name: string;
  /** securityType2 (es. "Common Stock", "Mutual Fund", "ETP"). */
  securityType: string | null;
  /** marketSector (es. "Equity"). */
  marketSector: string | null;
  /** Codice mercato Bloomberg (es. "IM" = Milano, "US", "FP" = Parigi). */
  exchCode: string | null;
  /** Ticker Bloomberg (es. "MONC", "EURSLIE"). */
  ticker: string | null;
};

/** Valida grossolanamente un ISIN (12 alfanumerici: 2 lettere paese + 10). */
export function isValidIsin(isin: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin.trim().toUpperCase());
}

export async function mapIsin(isin: string): Promise<FigiInstrument | null> {
  const code = isin.trim().toUpperCase();
  if (!isValidIsin(code)) return null;

  try {
    const res = await fetch("https://api.openfigi.com/v3/mapping", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify([{ idType: "ID_ISIN", idValue: code }]),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as Array<{
      data?: Array<{
        name?: string;
        securityType2?: string;
        marketSector?: string;
        exchCode?: string;
        ticker?: string;
      }>;
      warning?: string;
    }>;

    const first = json?.[0]?.data?.[0];
    if (!first?.name) return null;

    return {
      name: first.name,
      securityType: first.securityType2 ?? null,
      marketSector: first.marketSector ?? null,
      exchCode: first.exchCode ?? null,
      ticker: first.ticker ?? null,
    };
  } catch {
    return null;
  }
}
