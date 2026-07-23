export function shouldUseLastKnownPrice(error: string): boolean {
  return /429|rate limit|timeout|fetch failed|network|temporarily unavailable|too many requests|connection/i.test(error);
}

export function shouldUseStooqFallback(error: string): boolean {
  return shouldUseLastKnownPrice(error);
}

export function buildStalePriceMessage(error: string): string {
  const isTransient = shouldUseLastKnownPrice(error);
  const base = isTransient
    ? "Il provider di dati è temporaneamente limitato o non risponde"
    : (error.trim() || "Servizio dati temporaneamente non disponibile");
  return `Dati non aggiornati: ${base}. Mostro l'ultimo prezzo noto finché il provider torna disponibile.`;
}
