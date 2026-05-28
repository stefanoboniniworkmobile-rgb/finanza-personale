// Estrazione di pattern significativi dalle descrizioni dei movimenti bancari
// e funzioni di match per i mapping di import.

/**
 * Tipo di match supportato dai mapping.
 *  - EXACT: confronto esatto su una colonna sorgente strutturata (es. colCategory)
 *  - CONTAINS: pattern presente come sottostringa nella descrizione (case-insensitive)
 *  - STARTS_WITH: la descrizione inizia con il pattern
 *  - REGEX: regex JavaScript con flag "i"
 */
export type MatchType = "EXACT" | "CONTAINS" | "STARTS_WITH" | "REGEX";

// Prefissi banali ricorrenti negli estratti italiani: vengono potati per estrarre il "merchant".
// Lista da arricchire nel tempo via feedback dell'utente.
const COMMON_PREFIXES = [
  "pagamento preautorizzato",
  "pagamento pos",
  "pagamento sepa",
  "pagamento online",
  "pagamento",
  "addebito mese",
  "addebito",
  "accredito mese",
  "accredito",
  "sepa dd core da",
  "sepa dd core",
  "sepa dd",
  "sepa dd b2b da",
  "sepa dd b2b",
  "bonifico a credito",
  "bonifico a debito",
  "bonifico istantaneo a credito",
  "bonifico istantaneo a debito",
  "bonifico istantaneo",
  "bon istantaneo a credito",
  "bon istantaneo a debito",
  "bon istantaneo",
  "bonifico ordinario",
  "bonifico",
  "emolumenti",
  "stipendio",
  "prelievo bancomat",
  "prelievo",
  "ricarica",
  "rimborso",
  "girofondo",
  "giroconto",
  "commissioni",
  "competenze c/c",
  "competenze",
  "canone carta bancomat",
  "canone carta",
  "canone",
  "imposta di bollo",
  "imposta bollo",
];

// Suffissi/parole banali che spesso seguono il merchant.
const COMMON_TAILS = [
  "spa",
  "s.p.a.",
  "s.p.a",
  "srl",
  "s.r.l.",
  "s.r.l",
  "sa",
  "s.a.",
  "s.a",
  "snc",
  "italia",
  "italy",
  "europe",
  "european",
];

// Token "rumore" tipici dei codici di riferimento
const NOISE_TOKEN = /^(rif\.?|cro|mandato|core|tes\.num\.?|prg|prg\.|sat\d*|operazione|operaz\.?|presso|tipo|tariffa)$/i;

const DATE_PATTERN = /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;
const LONG_NUMBER = /^[a-z]?\d{4,}$/i;
const SHORT_NUMBER = /^\d{1,3}$/;

/**
 * Estrae un pattern proposto a partire da una descrizione bancaria.
 * L'output è sempre maiuscolo, già "pulito".
 *
 * Esempi:
 *   "PAGAMENTO PREAUTORIZZATO AMERICAN EXPRESS ITALIA … MANDATO E20… CORE 26…"
 *      -> "AMERICAN EXPRESS"
 *   "SEPA DD CORE DA SATISPAY EUROPE S.A. MANDATO SAT0200…"
 *      -> "SATISPAY"
 *   "BONIFICO A CREDITO FDB HOLDING SPA FDB HOLDING SPA RIF. 0000004 30/04/2026 …"
 *      -> "FDB HOLDING"
 *   "EMOLUMENTI FDB HOLDING SPA ACCREDITO COMPETENZE MESE DI MARZO 2026 …"
 *      -> "FDB HOLDING"
 */
export function proposePattern(description: string): string {
  if (!description) return "";
  let s = description.toString();

  // Normalizza spazi e case
  s = s.replace(/\s+/g, " ").trim();
  let lower = s.toLowerCase();

  // Rimuove prefissi banali dal lato sinistro (in ordine, dal più lungo)
  for (const p of COMMON_PREFIXES) {
    if (lower.startsWith(p + " ") || lower === p) {
      s = s.slice(p.length).trim();
      lower = s.toLowerCase();
    }
  }

  // Tokenizza
  const tokens = s.split(/\s+/).filter(Boolean);

  const kept: string[] = [];
  for (const tk of tokens) {
    const t = tk.replace(/^[^a-zA-Z0-9àèéìòùÀÈÉÌÒÙ]+|[^a-zA-Z0-9àèéìòùÀÈÉÌÒÙ]+$/g, ""); // toglie punteggiatura ai bordi
    if (!t) continue;
    if (DATE_PATTERN.test(t)) break; // da qui in poi è "metadata", stop
    if (LONG_NUMBER.test(t)) break;
    if (SHORT_NUMBER.test(t)) continue;
    if (NOISE_TOKEN.test(t)) break; // RIF., MANDATO, CORE: stop alla prima
    if (COMMON_TAILS.includes(t.toLowerCase())) continue;
    kept.push(t);
    if (kept.length >= 3) break; // max 3 token significativi
  }

  // Se kept è vuoto fallback alla descrizione cruda (troncata)
  if (kept.length === 0) {
    return s.slice(0, 40).trim().toUpperCase();
  }

  return kept.join(" ").toUpperCase();
}

/**
 * Verifica se una descrizione matcha un pattern secondo il matchType indicato.
 * Tutti i confronti sono case-insensitive. La descrizione viene normalizzata
 * (collasso spazi) prima del confronto.
 */
export function matchPattern(
  description: string,
  pattern: string,
  matchType: MatchType,
): boolean {
  if (!pattern) return false;
  const haystack = (description ?? "").toString().replace(/\s+/g, " ").trim().toLowerCase();
  const needle = pattern.replace(/\s+/g, " ").trim().toLowerCase();
  if (!haystack || !needle) return false;

  switch (matchType) {
    case "EXACT":
      return haystack === needle;
    case "CONTAINS":
      return haystack.includes(needle);
    case "STARTS_WITH":
      return haystack.startsWith(needle);
    case "REGEX":
      try {
        const re = new RegExp(pattern, "i");
        return re.test(description ?? "");
      } catch {
        return false;
      }
    default:
      return false;
  }
}
