/**
 * Risoluzione di un ISIN in un asset "pronto da aggiungere", con un punteggio
 * di CONFIDENZA che stima quanto è probabile che il simbolo Yahoo (da cui
 * prenderemo il prezzo) sia davvero lo strumento identificato dall'ISIN.
 *
 * Perché serve la confidenza: OpenFIGI dà il nome autorevole dall'ISIN, Yahoo
 * dà un simbolo cercando lo stesso ISIN — ma Yahoo NON espone l'ISIN dei suoi
 * simboli, quindi non possiamo verificare il legame a ritroso. Il segnale più
 * forte che abbiamo è il NOME: se Yahoo espone un nome e coincide con quello
 * di OpenFIGI, il simbolo è quasi certamente giusto; se Yahoo non dà il nome
 * (tipico dei fondi), non possiamo confrontarlo e la confidenza scende.
 */

import { mapIsin, isValidIsin, type FigiInstrument } from "./openfigi";
import { searchYahoo, fetchYahoo, type AssetSearchHit } from "./yahoo";

export type ConfidenceLevel = "alta" | "media" | "bassa";

export type IsinResolution = {
  isin: string;
  /** Nome autorevole da OpenFIGI (null se non trovato). */
  figiName: string | null;
  /** Simbolo Yahoo + attributi (null se Yahoo non trova nulla). */
  yahoo: {
    symbol: string;
    name: string;
    assetClass: AssetSearchHit["assetClass"];
    exchange?: string;
  } | null;
  /** Prezzo corrente da Yahoo (null se non recuperabile). */
  price: number | null;
  currency: string | null;
  confidence: {
    level: ConfidenceLevel;
    /** 0–100, indicativo. */
    percent: number;
    /** Motivi leggibili del punteggio (sia a favore sia contro). */
    reasons: string[];
  };
};

// ─── Normalizzazione nomi per il confronto ────────────────────────────────
const NAME_NOISE =
  /\b(spa|s\.?p\.?a|nv|n\.?v|inc|inc\.|plc|ag|sa|s\.?a|ltd|corp|co|the|ucits|etf|etp|acc|dist|class|cl|units?|fund|sicav|eur|usd|r|z|i|p|c|a|b|d|e)\b/gi;

function normalizeName(s: string): Set<string> {
  const cleaned = s
    .toUpperCase()
    .replace(/[.,\-/()]/g, " ")
    .replace(NAME_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return new Set(cleaned.split(" ").filter((t) => t.length >= 2));
}

/** Jaccard token overlap tra due nomi normalizzati (0..1). */
function nameOverlap(a: string, b: string): number {
  const sa = normalizeName(a);
  const sb = normalizeName(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return inter / union;
}

// ─── Compatibilità tipo strumento ─────────────────────────────────────────
function figiClass(securityType: string | null): string {
  const t = (securityType ?? "").toLowerCase();
  if (t.includes("etp") || t.includes("etf")) return "etf";
  if (t.includes("mutual fund") || t.includes("fund")) return "fund";
  if (t.includes("common stock") || t.includes("stock") || t.includes("equity"))
    return "stock";
  if (t.includes("bond") || t.includes("note")) return "bond";
  if (t.includes("index")) return "index";
  return "other";
}

function typeCompatible(figiC: string, yahooC: string): boolean {
  if (figiC === yahooC) return true;
  const fundish = new Set(["fund", "etf"]);
  if (fundish.has(figiC) && fundish.has(yahooC)) return true;
  return false;
}

// ─── Compatibilità mercato ────────────────────────────────────────────────
// exchCode Bloomberg → codici mercato Yahoo (il campo `exchange` della search
// è un CODICE tipo "MIL"/"NMS"/"PAR", non il nome esteso).
const EXCH_MAP: Record<string, string[]> = {
  IM: ["mil"], // Milano
  US: ["nms", "nyq", "ngm", "ncm", "pnk", "ase", "bts"], // Nasdaq/NYSE/AMEX
  FP: ["par"], // Parigi
  LN: ["lse", "ise"], // Londra
  GR: ["fra", "ger", "gbo", "stu", "mun", "ham", "dus", "ber"], // Germania/Xetra
  GY: ["fra", "ger", "gbo", "stu", "mun", "ham", "dus", "ber"],
  SM: ["mce"], // Madrid
  NA: [], // "not available" su OpenFIGI → nessun vincolo
};

/** "match" | "mismatch" | "unknown" */
function venueCompat(
  exchCode: string | null,
  yahooExch: string | undefined,
): "match" | "mismatch" | "unknown" {
  if (!exchCode || !yahooExch) return "unknown";
  const keys = EXCH_MAP[exchCode.toUpperCase()];
  if (!keys) return "unknown";
  if (keys.length === 0) return "unknown";
  const y = yahooExch.toLowerCase();
  return keys.some((k) => y.includes(k)) ? "match" : "mismatch";
}

function score(
  figi: FigiInstrument | null,
  hit: AssetSearchHit | null,
): IsinResolution["confidence"] {
  const reasons: string[] = [];

  if (!hit) {
    return {
      level: "bassa",
      percent: 0,
      reasons: ["Yahoo non ha trovato nessun simbolo per questo ISIN."],
    };
  }
  if (!figi) {
    reasons.push(
      "OpenFIGI non ha restituito l'identità: non posso confermare cosa sia.",
    );
    return { level: "bassa", percent: 20, reasons };
  }

  let pts = 0;

  // Segnale forte: il nome. searchYahoo mette name = symbol quando Yahoo non
  // fornisce un nome vero → lo usiamo per capire se il confronto è possibile.
  const yahooHasName = hit.name !== hit.symbol;
  if (yahooHasName) {
    const ov = nameOverlap(figi.name, hit.name);
    if (ov >= 0.4) {
      pts += 55;
      reasons.push(`Nome coerente tra OpenFIGI e Yahoo ("${hit.name}").`);
    } else {
      reasons.push(
        `Attenzione: il nome Yahoo ("${hit.name}") differisce da OpenFIGI ("${figi.name}") — potrebbe essere un'altra classe/strumento.`,
      );
    }
  } else {
    reasons.push(
      "Yahoo non fornisce il nome di questo simbolo: impossibile confrontarlo con l'identità OpenFIGI.",
    );
  }

  // Tipo strumento.
  const fc = figiClass(figi.securityType);
  if (typeCompatible(fc, hit.assetClass)) {
    pts += 30;
    reasons.push("Tipo strumento coerente.");
  } else {
    reasons.push(
      `Tipo strumento diverso (OpenFIGI: ${fc}, Yahoo: ${hit.assetClass}).`,
    );
  }

  // Mercato.
  const vc = venueCompat(figi.exchCode, hit.exchange);
  if (vc === "match") {
    pts += 15;
    reasons.push("Mercato coerente.");
  } else if (vc === "mismatch") {
    reasons.push(
      `Mercato diverso (OpenFIGI: ${figi.exchCode}, Yahoo: ${hit.exchange}): per i fondi è spesso solo un'etichetta del feed, ma resta un motivo in meno per fidarsi.`,
    );
  }

  const level: ConfidenceLevel =
    pts >= 75 ? "alta" : pts >= 40 ? "media" : "bassa";
  return { level, percent: pts, reasons };
}

// ─── Entry point ──────────────────────────────────────────────────────────
export async function resolveIsin(isinRaw: string): Promise<IsinResolution | null> {
  const isin = isinRaw.trim().toUpperCase();
  if (!isValidIsin(isin)) return null;

  const [figi, hits] = await Promise.all([mapIsin(isin), searchYahoo(isin, 5)]);
  const hit = hits[0] ?? null;

  let price: number | null = null;
  let currency: string | null = null;
  if (hit) {
    const r = await fetchYahoo(
      {
        symbol: hit.symbol,
        provider: "yahoo",
        providerSymbol: hit.symbol,
        assetClass: hit.assetClass,
      },
      { withHistory: false },
    );
    if (r.ok) {
      price = r.quote.price;
      currency = r.quote.currency ?? null;
    }
  }

  return {
    isin,
    figiName: figi?.name ?? null,
    yahoo: hit
      ? {
          symbol: hit.symbol,
          name: hit.name,
          assetClass: hit.assetClass,
          exchange: hit.exchange,
        }
      : null,
    price,
    currency,
    confidence: score(figi, hit),
  };
}
