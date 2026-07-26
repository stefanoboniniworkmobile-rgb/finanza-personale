/**
 * Versione dell'app e credito, centralizzati per riuso in UI.
 *
 * NEXT_PUBLIC_APP_VERSION è calcolata al build in next.config.ts
 * (formato anno-mese-XXXXX). In dev locale, se non impostata, mostra "dev".
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export const APP_CREDIT = "Sviluppato da bBorisLab";
