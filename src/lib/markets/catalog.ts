/**
 * Catalogo curato di asset "popolari" per il dialog di ricerca Mercati.
 *
 * Razionale: Yahoo non ha un'API "browse all" — la search vuole almeno una
 * query testuale. Per dare un'esperienza di tipo "sfoglia" a campo vuoto,
 * questo file contiene una selezione di asset rappresentativi raggruppati
 * per categoria di presentazione.
 *
 * Convenzioni:
 *  - `symbol` e `providerSymbol` coincidono per quasi tutto: tutto il
 *    catalogo passa per Yahoo (anche cambi/cripto/indici).
 *  - `category` è puramente di presentazione (raggruppamento UI lungo).
 *    L'`assetClass` resta quello "tecnico" che va in DB e che pilota il
 *    filtro per tipo nel dialog ricerca (chip "Tutti / Azione / ETF /
 *    Indice / Cambio / Cripto / ...").
 *  - Per i cambi notazione visiva "EUR/USD" + providerSymbol Yahoo
 *    "EURUSD=X". L'`assetInputSchema` poi normalizza il symbol a uppercase
 *    senza slash.
 *  - Per gli indici notazione Yahoo "^FTSEMIB", "^GSPC", ...
 *
 * Manutenzione: aggiornare quando un asset cambia ticker (delisting,
 * fusioni) o quando vogliamo aggiungere/rimuovere categorie. Niente fetch
 * runtime — è un array statico, deterministico, zero dipendenze esterne.
 *
 * Filtraggio per tipo (`assetClass`): il dialog ricerca filtra il flat
 * `CATALOG` sul campo `assetClass`. Le categorie di presentazione (es.
 * "Azioni Italia" vs "Azioni USA") sono solo un raggruppamento UI nella
 * vista "Tutti" e nelle viste "Azione" (mostrate tutte insieme).
 */

import type { AssetSearchHit } from "./yahoo";

export type CatalogCategory =
  | "Azioni Italia"
  | "Azioni USA"
  | "Azioni Europa"
  | "ETF Azionari"
  | "ETF Obbligazionari"
  | "ETF Materie prime e tematici"
  | "Indici"
  | "Cambi"
  | "Cripto";

export type CatalogHit = AssetSearchHit & {
  category: CatalogCategory;
};

/**
 * Catalogo flat. Ordine di inserimento = ordine UI dentro ogni categoria.
 */
const CATALOG: CatalogHit[] = [
  // ─── Azioni Italia (Borsa Italiana, suffisso .MI) ──────────────────
  { category: "Azioni Italia", symbol: "ENI.MI", providerSymbol: "ENI.MI", name: "Eni S.p.A.", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "ENEL.MI", providerSymbol: "ENEL.MI", name: "Enel S.p.A.", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "ISP.MI", providerSymbol: "ISP.MI", name: "Intesa Sanpaolo", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "UCG.MI", providerSymbol: "UCG.MI", name: "UniCredit", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "STLAM.MI", providerSymbol: "STLAM.MI", name: "Stellantis N.V.", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "G.MI", providerSymbol: "G.MI", name: "Assicurazioni Generali", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "RACE.MI", providerSymbol: "RACE.MI", name: "Ferrari N.V.", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "STM.MI", providerSymbol: "STM.MI", name: "STMicroelectronics", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "LDO.MI", providerSymbol: "LDO.MI", name: "Leonardo", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "MB.MI", providerSymbol: "MB.MI", name: "Mediobanca", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "BMPS.MI", providerSymbol: "BMPS.MI", name: "Banca Monte dei Paschi di Siena", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "PIRC.MI", providerSymbol: "PIRC.MI", name: "Pirelli & C.", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "PST.MI", providerSymbol: "PST.MI", name: "Poste Italiane", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "TIT.MI", providerSymbol: "TIT.MI", name: "Telecom Italia", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "MONC.MI", providerSymbol: "MONC.MI", name: "Moncler", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "PRY.MI", providerSymbol: "PRY.MI", name: "Prysmian Group", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "CPR.MI", providerSymbol: "CPR.MI", name: "Davide Campari-Milano", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "DIA.MI", providerSymbol: "DIA.MI", name: "DiaSorin", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "REC.MI", providerSymbol: "REC.MI", name: "Recordati", assetClass: "stock", exchange: "MIL" },
  { category: "Azioni Italia", symbol: "HER.MI", providerSymbol: "HER.MI", name: "Hera", assetClass: "stock", exchange: "MIL" },

  // ─── Azioni USA (NASDAQ + NYSE) ────────────────────────────────────
  { category: "Azioni USA", symbol: "AAPL", providerSymbol: "AAPL", name: "Apple Inc.", assetClass: "stock", exchange: "NMS" },
  { category: "Azioni USA", symbol: "MSFT", providerSymbol: "MSFT", name: "Microsoft Corp.", assetClass: "stock", exchange: "NMS" },
  { category: "Azioni USA", symbol: "GOOGL", providerSymbol: "GOOGL", name: "Alphabet Inc. (Class A)", assetClass: "stock", exchange: "NMS" },
  { category: "Azioni USA", symbol: "AMZN", providerSymbol: "AMZN", name: "Amazon.com Inc.", assetClass: "stock", exchange: "NMS" },
  { category: "Azioni USA", symbol: "NVDA", providerSymbol: "NVDA", name: "NVIDIA Corp.", assetClass: "stock", exchange: "NMS" },
  { category: "Azioni USA", symbol: "META", providerSymbol: "META", name: "Meta Platforms Inc.", assetClass: "stock", exchange: "NMS" },
  { category: "Azioni USA", symbol: "TSLA", providerSymbol: "TSLA", name: "Tesla Inc.", assetClass: "stock", exchange: "NMS" },
  { category: "Azioni USA", symbol: "BRK-B", providerSymbol: "BRK-B", name: "Berkshire Hathaway (Class B)", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "JPM", providerSymbol: "JPM", name: "JPMorgan Chase & Co.", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "V", providerSymbol: "V", name: "Visa Inc.", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "MA", providerSymbol: "MA", name: "Mastercard Inc.", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "JNJ", providerSymbol: "JNJ", name: "Johnson & Johnson", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "WMT", providerSymbol: "WMT", name: "Walmart Inc.", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "PG", providerSymbol: "PG", name: "Procter & Gamble", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "XOM", providerSymbol: "XOM", name: "Exxon Mobil Corp.", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "KO", providerSymbol: "KO", name: "The Coca-Cola Company", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "DIS", providerSymbol: "DIS", name: "The Walt Disney Company", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "MCD", providerSymbol: "MCD", name: "McDonald's Corp.", assetClass: "stock", exchange: "NYQ" },
  { category: "Azioni USA", symbol: "NFLX", providerSymbol: "NFLX", name: "Netflix Inc.", assetClass: "stock", exchange: "NMS" },
  { category: "Azioni USA", symbol: "AMD", providerSymbol: "AMD", name: "Advanced Micro Devices", assetClass: "stock", exchange: "NMS" },

  // ─── Azioni Europa (escluso Italia) ────────────────────────────────
  { category: "Azioni Europa", symbol: "ASML.AS", providerSymbol: "ASML.AS", name: "ASML Holding (Amsterdam)", assetClass: "stock", exchange: "AMS" },
  { category: "Azioni Europa", symbol: "MC.PA", providerSymbol: "MC.PA", name: "LVMH Moët Hennessy (Parigi)", assetClass: "stock", exchange: "PAR" },
  { category: "Azioni Europa", symbol: "OR.PA", providerSymbol: "OR.PA", name: "L'Oréal (Parigi)", assetClass: "stock", exchange: "PAR" },
  { category: "Azioni Europa", symbol: "AIR.PA", providerSymbol: "AIR.PA", name: "Airbus (Parigi)", assetClass: "stock", exchange: "PAR" },
  { category: "Azioni Europa", symbol: "TTE.PA", providerSymbol: "TTE.PA", name: "TotalEnergies (Parigi)", assetClass: "stock", exchange: "PAR" },
  { category: "Azioni Europa", symbol: "SAN.PA", providerSymbol: "SAN.PA", name: "Sanofi (Parigi)", assetClass: "stock", exchange: "PAR" },
  { category: "Azioni Europa", symbol: "SAP.DE", providerSymbol: "SAP.DE", name: "SAP SE (Francoforte)", assetClass: "stock", exchange: "XETRA" },
  { category: "Azioni Europa", symbol: "SIE.DE", providerSymbol: "SIE.DE", name: "Siemens AG (Francoforte)", assetClass: "stock", exchange: "XETRA" },
  { category: "Azioni Europa", symbol: "BMW.DE", providerSymbol: "BMW.DE", name: "BMW (Francoforte)", assetClass: "stock", exchange: "XETRA" },
  { category: "Azioni Europa", symbol: "VOW3.DE", providerSymbol: "VOW3.DE", name: "Volkswagen Pref. (Francoforte)", assetClass: "stock", exchange: "XETRA" },
  { category: "Azioni Europa", symbol: "NOVN.SW", providerSymbol: "NOVN.SW", name: "Novartis (Zurigo)", assetClass: "stock", exchange: "EBS" },
  { category: "Azioni Europa", symbol: "NESN.SW", providerSymbol: "NESN.SW", name: "Nestlé (Zurigo)", assetClass: "stock", exchange: "EBS" },
  { category: "Azioni Europa", symbol: "ROG.SW", providerSymbol: "ROG.SW", name: "Roche Holding (Zurigo)", assetClass: "stock", exchange: "EBS" },
  { category: "Azioni Europa", symbol: "SHEL.L", providerSymbol: "SHEL.L", name: "Shell plc (Londra)", assetClass: "stock", exchange: "LSE" },
  { category: "Azioni Europa", symbol: "HSBA.L", providerSymbol: "HSBA.L", name: "HSBC Holdings (Londra)", assetClass: "stock", exchange: "LSE" },

  // ─── ETF Azionari (UCITS, quotati MIL/XETRA/AMS) ───────────────────
  { category: "ETF Azionari", symbol: "CSPX.MI", providerSymbol: "CSPX.MI", name: "iShares Core S&P 500 UCITS ETF (Acc)", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Azionari", symbol: "VUSA.MI", providerSymbol: "VUSA.MI", name: "Vanguard S&P 500 UCITS ETF (Dist)", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Azionari", symbol: "VWCE.DE", providerSymbol: "VWCE.DE", name: "Vanguard FTSE All-World UCITS ETF (Acc)", assetClass: "etf", exchange: "XETRA" },
  { category: "ETF Azionari", symbol: "EUNL.DE", providerSymbol: "EUNL.DE", name: "iShares Core MSCI World UCITS ETF", assetClass: "etf", exchange: "XETRA" },
  { category: "ETF Azionari", symbol: "IWDA.AS", providerSymbol: "IWDA.AS", name: "iShares Core MSCI World UCITS USD Acc", assetClass: "etf", exchange: "AMS" },
  { category: "ETF Azionari", symbol: "IEUR.MI", providerSymbol: "IEUR.MI", name: "iShares Core MSCI Europe UCITS ETF", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Azionari", symbol: "EIMI.DE", providerSymbol: "EIMI.DE", name: "iShares Core MSCI EM IMI UCITS ETF", assetClass: "etf", exchange: "XETRA" },
  { category: "ETF Azionari", symbol: "VFEM.MI", providerSymbol: "VFEM.MI", name: "Vanguard FTSE Emerging Markets UCITS", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Azionari", symbol: "EUNH.DE", providerSymbol: "EUNH.DE", name: "iShares Core EURO STOXX 50 UCITS ETF", assetClass: "etf", exchange: "XETRA" },
  { category: "ETF Azionari", symbol: "ITPS.MI", providerSymbol: "ITPS.MI", name: "iShares FTSE MIB UCITS ETF", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Azionari", symbol: "WSML.DE", providerSymbol: "WSML.DE", name: "iShares MSCI World Small Cap UCITS", assetClass: "etf", exchange: "XETRA" },
  { category: "ETF Azionari", symbol: "IUSN.DE", providerSymbol: "IUSN.DE", name: "iShares MSCI World Small Cap UCITS (Acc)", assetClass: "etf", exchange: "XETRA" },
  { category: "ETF Azionari", symbol: "QQQ", providerSymbol: "QQQ", name: "Invesco QQQ Trust (NASDAQ-100)", assetClass: "etf", exchange: "NMS" },
  { category: "ETF Azionari", symbol: "SPY", providerSymbol: "SPY", name: "SPDR S&P 500 ETF Trust", assetClass: "etf", exchange: "PCX" },
  { category: "ETF Azionari", symbol: "VTI", providerSymbol: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "etf", exchange: "PCX" },
  { category: "ETF Azionari", symbol: "VEA", providerSymbol: "VEA", name: "Vanguard FTSE Developed Markets", assetClass: "etf", exchange: "PCX" },
  { category: "ETF Azionari", symbol: "VWO", providerSymbol: "VWO", name: "Vanguard FTSE Emerging Markets", assetClass: "etf", exchange: "PCX" },
  { category: "ETF Azionari", symbol: "ARKK", providerSymbol: "ARKK", name: "ARK Innovation ETF", assetClass: "etf", exchange: "PCX" },
  { category: "ETF Azionari", symbol: "IUMS.MI", providerSymbol: "IUMS.MI", name: "iShares Edge MSCI World Min. Vol UCITS", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Azionari", symbol: "QDVE.DE", providerSymbol: "QDVE.DE", name: "iShares S&P 500 IT Sector UCITS", assetClass: "etf", exchange: "XETRA" },

  // ─── ETF Obbligazionari ────────────────────────────────────────────
  { category: "ETF Obbligazionari", symbol: "AGGH.MI", providerSymbol: "AGGH.MI", name: "iShares Core Global Aggregate Bond EUR Hedged", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Obbligazionari", symbol: "IEAC.MI", providerSymbol: "IEAC.MI", name: "iShares Core € Corp Bond UCITS ETF", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Obbligazionari", symbol: "IBGL.MI", providerSymbol: "IBGL.MI", name: "iShares Core € Govt Bond UCITS ETF", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Obbligazionari", symbol: "VEMT.MI", providerSymbol: "VEMT.MI", name: "Vanguard USD Emerging Markets Govt Bond", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Obbligazionari", symbol: "IEGA.MI", providerSymbol: "IEGA.MI", name: "iShares € Aggregate Bond UCITS ETF", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Obbligazionari", symbol: "IUS7.DE", providerSymbol: "IUS7.DE", name: "iShares $ Treasury Bond 7-10y UCITS", assetClass: "etf", exchange: "XETRA" },
  { category: "ETF Obbligazionari", symbol: "TLT", providerSymbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF", assetClass: "etf", exchange: "NMS" },
  { category: "ETF Obbligazionari", symbol: "HYG", providerSymbol: "HYG", name: "iShares iBoxx $ High Yield Corp Bond", assetClass: "etf", exchange: "PCX" },

  // ─── ETF Materie Prime e tematici ─────────────────────────────────
  { category: "ETF Materie prime e tematici", symbol: "SGLD.MI", providerSymbol: "SGLD.MI", name: "Invesco Physical Gold ETC", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Materie prime e tematici", symbol: "PHAU.MI", providerSymbol: "PHAU.MI", name: "WisdomTree Physical Gold", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Materie prime e tematici", symbol: "PHAG.MI", providerSymbol: "PHAG.MI", name: "WisdomTree Physical Silver", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Materie prime e tematici", symbol: "GLD", providerSymbol: "GLD", name: "SPDR Gold Shares", assetClass: "etf", exchange: "PCX" },
  { category: "ETF Materie prime e tematici", symbol: "XEON.MI", providerSymbol: "XEON.MI", name: "Xtrackers II EUR Overnight Rate Swap", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Materie prime e tematici", symbol: "ICLN", providerSymbol: "ICLN", name: "iShares Global Clean Energy ETF", assetClass: "etf", exchange: "NMS" },
  { category: "ETF Materie prime e tematici", symbol: "ROBO.MI", providerSymbol: "ROBO.MI", name: "iShares Automation & Robotics UCITS", assetClass: "etf", exchange: "MIL" },
  { category: "ETF Materie prime e tematici", symbol: "DGTL.MI", providerSymbol: "DGTL.MI", name: "iShares Digitalisation UCITS ETF", assetClass: "etf", exchange: "MIL" },

  // ─── Indici (notazione Yahoo con ^) ────────────────────────────────
  { category: "Indici", symbol: "^FTSEMIB", providerSymbol: "^FTSEMIB", name: "FTSE MIB (Milano)", assetClass: "index", exchange: "MIL" },
  { category: "Indici", symbol: "^GSPC", providerSymbol: "^GSPC", name: "S&P 500", assetClass: "index", exchange: "NYC" },
  { category: "Indici", symbol: "^IXIC", providerSymbol: "^IXIC", name: "NASDAQ Composite", assetClass: "index", exchange: "NMS" },
  { category: "Indici", symbol: "^NDX", providerSymbol: "^NDX", name: "NASDAQ-100", assetClass: "index", exchange: "NMS" },
  { category: "Indici", symbol: "^DJI", providerSymbol: "^DJI", name: "Dow Jones Industrial Average", assetClass: "index", exchange: "NYC" },
  { category: "Indici", symbol: "^RUT", providerSymbol: "^RUT", name: "Russell 2000", assetClass: "index", exchange: "NYC" },
  { category: "Indici", symbol: "^STOXX50E", providerSymbol: "^STOXX50E", name: "EURO STOXX 50", assetClass: "index", exchange: "STX" },
  { category: "Indici", symbol: "^STOXX", providerSymbol: "^STOXX", name: "STOXX Europe 600", assetClass: "index", exchange: "STX" },
  { category: "Indici", symbol: "^GDAXI", providerSymbol: "^GDAXI", name: "DAX (Francoforte)", assetClass: "index", exchange: "XETRA" },
  { category: "Indici", symbol: "^FCHI", providerSymbol: "^FCHI", name: "CAC 40 (Parigi)", assetClass: "index", exchange: "PAR" },
  { category: "Indici", symbol: "^FTSE", providerSymbol: "^FTSE", name: "FTSE 100 (Londra)", assetClass: "index", exchange: "LON" },
  { category: "Indici", symbol: "^IBEX", providerSymbol: "^IBEX", name: "IBEX 35 (Madrid)", assetClass: "index", exchange: "MAD" },
  { category: "Indici", symbol: "^N225", providerSymbol: "^N225", name: "Nikkei 225 (Tokyo)", assetClass: "index", exchange: "OSA" },
  { category: "Indici", symbol: "^HSI", providerSymbol: "^HSI", name: "Hang Seng Index (Hong Kong)", assetClass: "index", exchange: "HKG" },
  { category: "Indici", symbol: "^VIX", providerSymbol: "^VIX", name: "CBOE Volatility Index (VIX)", assetClass: "index", exchange: "CBOE" },

  // ─── Cambi (notazione Yahoo XXXYYY=X) ──────────────────────────────
  { category: "Cambi", symbol: "EUR/USD", providerSymbol: "EURUSD=X", name: "Euro / Dollaro USA", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "EUR/GBP", providerSymbol: "EURGBP=X", name: "Euro / Sterlina UK", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "EUR/CHF", providerSymbol: "EURCHF=X", name: "Euro / Franco Svizzero", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "EUR/JPY", providerSymbol: "EURJPY=X", name: "Euro / Yen Giapponese", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "EUR/CNY", providerSymbol: "EURCNY=X", name: "Euro / Yuan Cinese", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "EUR/CAD", providerSymbol: "EURCAD=X", name: "Euro / Dollaro Canadese", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "EUR/AUD", providerSymbol: "EURAUD=X", name: "Euro / Dollaro Australiano", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "EUR/SEK", providerSymbol: "EURSEK=X", name: "Euro / Corona Svedese", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "EUR/NOK", providerSymbol: "EURNOK=X", name: "Euro / Corona Norvegese", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "USD/JPY", providerSymbol: "USDJPY=X", name: "Dollaro USA / Yen Giapponese", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "USD/CHF", providerSymbol: "USDCHF=X", name: "Dollaro USA / Franco Svizzero", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "GBP/USD", providerSymbol: "GBPUSD=X", name: "Sterlina UK / Dollaro USA", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "AUD/USD", providerSymbol: "AUDUSD=X", name: "Dollaro Australiano / USD", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "USD/CAD", providerSymbol: "USDCAD=X", name: "Dollaro USA / Dollaro Canadese", assetClass: "currency", exchange: "FX" },
  { category: "Cambi", symbol: "NZD/USD", providerSymbol: "NZDUSD=X", name: "Dollaro Neozelandese / USD", assetClass: "currency", exchange: "FX" },

  // ─── Cripto (denominati in EUR per coerenza app, alcuni anche USD) ─
  { category: "Cripto", symbol: "BTC-EUR", providerSymbol: "BTC-EUR", name: "Bitcoin (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "ETH-EUR", providerSymbol: "ETH-EUR", name: "Ethereum (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "SOL-EUR", providerSymbol: "SOL-EUR", name: "Solana (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "BNB-EUR", providerSymbol: "BNB-EUR", name: "BNB (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "XRP-EUR", providerSymbol: "XRP-EUR", name: "XRP (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "ADA-EUR", providerSymbol: "ADA-EUR", name: "Cardano (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "DOGE-EUR", providerSymbol: "DOGE-EUR", name: "Dogecoin (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "DOT-EUR", providerSymbol: "DOT-EUR", name: "Polkadot (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "MATIC-EUR", providerSymbol: "MATIC-EUR", name: "Polygon (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "AVAX-EUR", providerSymbol: "AVAX-EUR", name: "Avalanche (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "LINK-EUR", providerSymbol: "LINK-EUR", name: "Chainlink (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "BTC-USD", providerSymbol: "BTC-USD", name: "Bitcoin (USD)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "ETH-USD", providerSymbol: "ETH-USD", name: "Ethereum (USD)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "LTC-EUR", providerSymbol: "LTC-EUR", name: "Litecoin (EUR)", assetClass: "crypto", exchange: "CCC" },
  { category: "Cripto", symbol: "USDT-USD", providerSymbol: "USDT-USD", name: "Tether (USD)", assetClass: "crypto", exchange: "CCC" },
];

/** Ordine fisso delle categorie nella UI (vista "Tutti"). */
export const CATALOG_CATEGORIES_ORDER: CatalogCategory[] = [
  "Azioni Italia",
  "Azioni USA",
  "Azioni Europa",
  "ETF Azionari",
  "ETF Obbligazionari",
  "ETF Materie prime e tematici",
  "Indici",
  "Cambi",
  "Cripto",
];

export type CatalogGroup = {
  category: CatalogCategory;
  items: CatalogHit[];
};

/** Restituisce il catalogo completo flat (utile per filtro client-side). */
export function getCatalogFlat(): CatalogHit[] {
  return CATALOG.slice();
}

/**
 * Restituisce il catalogo raggruppato per categoria nell'ordine fisso.
 * Le categorie vuote vengono omesse.
 */
export function getCatalogGrouped(): CatalogGroup[] {
  const byCat = new Map<CatalogCategory, CatalogHit[]>();
  for (const hit of CATALOG) {
    const arr = byCat.get(hit.category) ?? [];
    arr.push(hit);
    byCat.set(hit.category, arr);
  }
  return CATALOG_CATEGORIES_ORDER.flatMap((cat) => {
    const items = byCat.get(cat) ?? [];
    if (items.length === 0) return [];
    return [{ category: cat, items }];
  });
}

/**
 * Mappa `assetClass` (tipo tecnico Asset) → lista di categorie del
 * catalogo che la includono. Serve al filtro chip nel dialog ricerca:
 * "Mostrami solo i risultati di tipo Azione" → tutte le categorie il
 * cui assetClass è "stock".
 *
 * Implementazione semplice: scorriamo `CATALOG` e raccogliamo le
 * categorie distinte per ciascun assetClass.
 */
export function getCategoriesForAssetClass(
  assetClass: AssetSearchHit["assetClass"],
): CatalogCategory[] {
  const set = new Set<CatalogCategory>();
  for (const hit of CATALOG) {
    if (hit.assetClass === assetClass) set.add(hit.category);
  }
  // Mantieni l'ordine fisso definito in CATALOG_CATEGORIES_ORDER
  return CATALOG_CATEGORIES_ORDER.filter((c) => set.has(c));
}
