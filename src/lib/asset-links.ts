/**
 * Link alla pagina pubblica con la quotazione di un asset, da aprire nel
 * browser dell'utente (non dal server, che verrebbe bloccato).
 *
 * Priorità:
 *  1) Azione italiana CON ISIN → scheda ufficiale Borsa Italiana.
 *  2) Fallback → pagina Yahoo Finance per ticker (sempre disponibile: usiamo
 *     il providerSymbol in notazione Yahoo, es. "MONC.MI", "AAPL").
 *
 * Ritorna null solo se non abbiamo nemmeno un ticker su cui costruire il link.
 */
export type QuoteLink = { url: string; label: string };

export function quotePageLink(a: {
  symbol: string;
  providerSymbol: string;
  isin: string | null;
  assetClass: string;
}): QuoteLink | null {
  const isItalian =
    /\.MI$/i.test(a.providerSymbol) ||
    /\.MI$/i.test(a.symbol) ||
    (a.isin?.toUpperCase().startsWith("IT") ?? false);

  // Borsa Italiana indicizza per ISIN. Copriamo le azioni (path /azioni/),
  // il caso più comune e l'unico che abbiamo verificato; il resto va su Yahoo.
  if (a.isin && isItalian && a.assetClass === "stock") {
    return {
      url: `https://www.borsaitaliana.it/borsa/azioni/scheda/${encodeURIComponent(
        a.isin,
      )}.html?lang=it`,
      label: "Borsa Italiana",
    };
  }

  if (a.providerSymbol) {
    return {
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(
        a.providerSymbol,
      )}/`,
      label: "Yahoo Finance",
    };
  }

  return null;
}
