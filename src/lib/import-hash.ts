// Hashing e normalizzazione per il riconoscimento dei duplicati in import.
// Convenzione: l'hash di un movimento è derivato da (data YYYY-MM-DD | amountSigned con 2 decimali | descrizione normalizzata).
// Stessa formula deve essere applicata sia in fase di parsing che in fase di scrittura.

import { createHash } from "crypto";

/**
 * Normalizza la descrizione per il calcolo dell'hash:
 *  - rimuove caratteri di controllo
 *  - lowercase
 *  - trim ai bordi
 *  - collapse di whitespace multipli in singolo spazio
 *
 * NON rimuoviamo punteggiatura né accenti: vogliamo distinguere
 * "Caffè bar" da "Caffe bar" (diverso bar?) e "Spesa, Esselunga" da "Spesa Esselunga".
 */
export function normalizeDescription(desc: string): string {
  if (!desc) return "";
  const s = desc.toString();
  // Rimuovi i control chars una per una (più semplice e portabile di una regex con range)
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    out += s[i];
  }
  return out.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Importo "firmato" canonico: positivo per income, negativo per expense.
 * L'importo viene sempre salvato in DB come positivo + type; qui lo firmiamo solo per
 * il calcolo dell'hash, così l'hash è stabile rispetto al verso dei movimenti.
 */
export function signedAmount(amount: number, type: "income" | "expense"): number {
  const abs = Math.abs(amount);
  return type === "income" ? abs : -abs;
}

/**
 * Costruisce l'hash univoco di una transazione ai fini di import.
 * Tornerà sempre lo stesso valore per le stesse 3 componenti.
 */
export function computeTransactionHash(input: {
  date: Date | string;
  amount: number;
  type: "income" | "expense";
  description: string;
}): string {
  const d = input.date instanceof Date ? input.date : new Date(input.date);
  const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const sa = signedAmount(input.amount, input.type).toFixed(2);
  const desc = normalizeDescription(input.description);
  const key = `${dateKey}|${sa}|${desc}`;
  return createHash("sha1").update(key).digest("hex");
}

/**
 * Chiave "debole" per il riconoscimento di POSSIBILI duplicati: solo
 * data + importo firmato. Ignora la descrizione.
 *
 * Caso d'uso: l'utente ha già un movimento manuale "Stipendio" con stesso giorno e
 * stesso importo del CSV bancario "EMOLUMENTI FDB ...". Hash forti diversi (descrizioni
 * diverse), ma la weak key coincide → la riga del CSV viene marcata come "possibile
 * duplicato" e l'utente decide.
 */
export function computeTransactionWeakKey(input: {
  date: Date | string;
  amount: number;
  type: "income" | "expense";
}): string {
  const d = input.date instanceof Date ? input.date : new Date(input.date);
  const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const sa = signedAmount(input.amount, input.type).toFixed(2);
  return `${dateKey}|${sa}`;
}
