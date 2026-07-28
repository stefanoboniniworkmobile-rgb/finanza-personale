/**
 * Calcolo della posizione (holding) di un asset a partire dai lotti d'acquisto
 * e dall'ultimo prezzo noto. Tutto nella valuta dell'asset.
 *
 * Guadagno/perdita è POTENZIALE (non realizzato): confronta il valore attuale
 * della quantità posseduta col costo di carico (prezzo pagato + commissioni).
 */

export type LotInput = { quantity: number; price: number; fee: number };

export type Holding = {
  /** Quantità totale posseduta. */
  quantity: number;
  /** Costo di carico: Σ(quantità×prezzo) + Σ commissioni. */
  cost: number;
  /** Prezzo medio di carico: costo / quantità. */
  avgPrice: number;
  /** Valore attuale: quantità × ultimo prezzo (null se prezzo mancante). */
  value: number | null;
  /** Guadagno/perdita in valuta: valore − costo (null se prezzo mancante). */
  pnl: number | null;
  /** Guadagno/perdita percentuale sul costo (null se prezzo o costo mancante). */
  pnlPct: number | null;
};

export function computeHolding(
  lots: LotInput[],
  lastPrice: number | null,
): Holding | null {
  if (lots.length === 0) return null;

  const quantity = lots.reduce((s, l) => s + l.quantity, 0);
  const cost = lots.reduce((s, l) => s + l.quantity * l.price + (l.fee || 0), 0);
  const avgPrice = quantity !== 0 ? cost / quantity : 0;
  const value = lastPrice != null ? quantity * lastPrice : null;
  const pnl = value != null ? value - cost : null;
  const pnlPct = pnl != null && cost !== 0 ? (pnl / cost) * 100 : null;

  return { quantity, cost, avgPrice, value, pnl, pnlPct };
}
