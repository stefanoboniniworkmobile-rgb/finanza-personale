import { fmtDateFull, fmtN } from "@/lib/format";

/** Ultimo prezzo salvato in AssetPrice per l'asset che stiamo aggiornando. */
export type LastKnownPrice = { close: number; date: Date };

export function shouldUseLastKnownPrice(error: string): boolean {
  return /429|rate limit|timeout|fetch failed|network|temporarily unavailable|too many requests|connection/i.test(error);
}

export function shouldUseStooqFallback(error: string): boolean {
  return shouldUseLastKnownPrice(error);
}

/**
 * Messaggio mostrato quando nessun provider ha risposto e la riga continua a
 * esporre il prezzo già in DB.
 *
 * Se `lastKnown` c'è, lo esplicitiamo con valore e data: senza, l'utente legge
 * "mostro l'ultimo prezzo noto" ma non ha modo di sapere di quando sia, che è
 * l'unica informazione che conta per decidere se fidarsi del numero a video.
 */
export function buildStalePriceMessage(
  error: string,
  lastKnown?: LastKnownPrice | null,
): string {
  const isTransient = shouldUseLastKnownPrice(error);
  const base = isTransient
    ? "Il provider di dati è temporaneamente limitato o non risponde"
    : (error.trim() || "Servizio dati temporaneamente non disponibile");
  const tail = lastKnown
    ? `Resta a video l'ultimo prezzo noto: ${fmtN(lastKnown.close)} del ${fmtDateFull(lastKnown.date)}.`
    : "Mostro l'ultimo prezzo noto finché il provider torna disponibile.";
  return `Dati non aggiornati: ${base}. ${tail}`;
}
