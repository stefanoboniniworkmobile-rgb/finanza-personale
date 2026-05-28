/**
 * Provider European Central Bank (BCE) — Statistical Data Warehouse.
 *
 * Pubblico, no auth, no rate limit pratico (ragionevole).
 * Endpoint: https://data-api.ecb.europa.eu/service/data/{DATAFLOW}/{KEY}?format=jsondata
 *
 * Usi tipici:
 *
 * 1. Cambi EUR→X (tassi giornalieri di riferimento BCE):
 *    Dataflow: EXR. Key: D.{CCY}.EUR.SP00.A  (D=daily, SP00=spot, A=average)
 *    Esempio: D.USD.EUR.SP00.A → ultimo cambio EUR/USD
 *    Per asset.providerSymbol passiamo la sigla della valuta destinazione
 *    (es. "USD"), NON "EUR/USD". Il rapporto EUR è implicito.
 *
 * 2. Tasso BCE main refinancing (MRO):
 *    Dataflow: FM. Key: B.U2.EUR.4F.KR.MRR_FR.LEV
 *    asset.providerSymbol = stringa magica "ECB-MRO" (vedi switch sotto).
 *
 * 3. EURIBOR 3M:
 *    Dataflow: FM. Key: D.U2.EUR.RT.MM.EURIBOR3MD_.HSTA
 *    asset.providerSymbol = "EURIBOR-3M".
 *
 * Risposta JSON: format SDMX-JSON, abbastanza intricato. Estraiamo solo
 * l'ultimo valore + data tramite parser ad-hoc.
 */

import type {
  AssetForFetch,
  FetchOptions,
  PriceSeriesPoint,
  ProviderResult,
} from "./types";

const ECB_BASE = "https://data-api.ecb.europa.eu/service/data";

/**
 * Mappa providerSymbol → URL ECB. Solo i tassi macro hanno mapping
 * "speciale"; le valute sono tutte gestite in modo uniforme via EXR.
 */
function buildEcbUrl(asset: AssetForFetch, lastN: number): string | null {
  const sym = asset.providerSymbol.toUpperCase().trim();

  if (asset.assetClass === "currency") {
    // EUR base: il cambio "EUR/USD" → providerSymbol = "USD"
    // L'ECB pubblica solo i tassi a partire da EUR. Per cambi non-EUR base
    // (es. USD/JPY) il calcolo va fatto a mano e per ora non lo supportiamo.
    if (!/^[A-Z]{3}$/.test(sym) || sym === "EUR") return null;
    return `${ECB_BASE}/EXR/D.${sym}.EUR.SP00.A?format=jsondata&lastNObservations=${lastN}`;
  }

  if (asset.assetClass === "rate") {
    switch (sym) {
      case "ECB-MRO":
      case "MRO":
      case "ECBREFI":
        return `${ECB_BASE}/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?format=jsondata&lastNObservations=${lastN}`;
      case "EURIBOR-3M":
      case "EURIBOR3M":
        return `${ECB_BASE}/FM/D.U2.EUR.RT.MM.EURIBOR3MD_.HSTA?format=jsondata&lastNObservations=${lastN}`;
      case "EURIBOR-6M":
      case "EURIBOR6M":
        return `${ECB_BASE}/FM/D.U2.EUR.RT.MM.EURIBOR6MD_.HSTA?format=jsondata&lastNObservations=${lastN}`;
      case "EURIBOR-12M":
      case "EURIBOR12M":
        return `${ECB_BASE}/FM/D.U2.EUR.RT.MM.EURIBOR1YD_.HSTA?format=jsondata&lastNObservations=${lastN}`;
      default:
        return null;
    }
  }

  return null;
}

/**
 * Parser SDMX-JSON minimale: estrae la lista (data, valore) ordinata
 * cronologicamente. SDMX è verboso ma la parte che ci serve è in fondo a
 * un albero di 4-5 chiavi, quasi sempre con indici "0".
 *
 * Struttura tipica:
 *   {
 *     dataSets: [{
 *       series: {
 *         "0:0:0:0:0:0": {
 *           observations: { "0": [VALUE, ...], "1": [VALUE, ...], ... }
 *         }
 *       }
 *     }],
 *     structure: {
 *       dimensions: { observation: [{ values: [{ id: "2026-05-23" }, ...] }] }
 *     }
 *   }
 */
function parseEcbJson(json: unknown): PriceSeriesPoint[] {
  try {
    const root = json as {
      dataSets?: Array<{ series?: Record<string, { observations?: Record<string, unknown[]> }> }>;
      structure?: {
        dimensions?: { observation?: Array<{ values?: Array<{ id?: string }> }> };
      };
    };
    const series = root.dataSets?.[0]?.series ?? {};
    const seriesKeys = Object.keys(series);
    if (seriesKeys.length === 0) return [];
    const observations = series[seriesKeys[0]]?.observations ?? {};
    const dateValues =
      root.structure?.dimensions?.observation?.[0]?.values ?? [];
    const out: PriceSeriesPoint[] = [];
    for (const idxStr of Object.keys(observations)) {
      const idx = parseInt(idxStr, 10);
      const raw = observations[idxStr];
      const v = Array.isArray(raw) ? raw[0] : null;
      const dateStr = dateValues[idx]?.id;
      if (typeof v !== "number" || !dateStr) continue;
      out.push({ date: new Date(dateStr + "T00:00:00Z"), close: v });
    }
    return out.sort((a, b) => a.date.getTime() - b.date.getTime());
  } catch {
    return [];
  }
}

export async function fetchEcb(
  asset: AssetForFetch,
  opts: FetchOptions = {},
): Promise<ProviderResult> {
  const lastN = opts.withHistory ? Math.max(5, opts.historyDays ?? 30) : 2;
  const url = buildEcbUrl(asset, lastN);
  if (!url) {
    return {
      ok: false,
      error: `ECB provider non sa servire "${asset.providerSymbol}" (assetClass=${asset.assetClass})`,
    };
  }

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, error: `ECB HTTP ${res.status} per ${asset.providerSymbol}` };
    }
    const json = (await res.json()) as unknown;
    const points = parseEcbJson(json);
    if (points.length === 0) {
      return { ok: false, error: `ECB: nessuna osservazione per ${asset.providerSymbol}` };
    }
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
        currency: asset.assetClass === "rate" ? "%" : asset.providerSymbol,
      },
    };
    if (opts.withHistory) {
      (result as { history?: PriceSeriesPoint[] }).history = points;
    }
    return result;
  } catch (e) {
    return {
      ok: false,
      error: `ECB fetch fallito: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
