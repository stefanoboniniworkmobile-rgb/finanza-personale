/**
 * Calcolo della posizione (holding) di un asset a partire dai lotti d'acquisto
 * e dall'ultimo prezzo noto. Tutto nella valuta dell'asset.
 *
 * Oltre a valore e guadagno/perdita POTENZIALE, calcola:
 *  - costo medio di carico (commissioni incluse);
 *  - giacenza media: da quanti giorni, in media, è investito il capitale,
 *    pesata per l'importo di ogni acquisto → Σ(costo_i × giorni_i) / Σ costo_i;
 *  - rendimento medio annuo: XIRR (money-weighted internal rate of return) sui
 *    flussi datati — ogni acquisto (uscita, alla sua data) e il valore attuale
 *    (entrata, oggi). È la % annua che, applicata a ciascun acquisto dalla sua
 *    data, riporta al valore odierno: tiene conto di quanto e di quando hai
 *    investito. È il modo corretto per confrontare acquisti in date diverse.
 */

export type LotInput = {
  quantity: number;
  price: number;
  fee: number;
  /** Data d'acquisto: serve per giacenza media e rendimento annualizzato. */
  date: Date;
};

export type Holding = {
  quantity: number;
  cost: number;
  avgPrice: number;
  value: number | null;
  pnl: number | null;
  pnlPct: number | null;
  /** Giacenza media in giorni (pesata per costo). null se non calcolabile. */
  avgHoldingDays: number | null;
  /** Rendimento medio annuo % (XIRR). null se troppo recente o non risolvibile. */
  annualizedPct: number | null;
};

const MS_PER_DAY = 86_400_000;
const MS_PER_YEAR = 365.25 * MS_PER_DAY;

/**
 * XIRR: tasso annuo r tale che Σ importo_i / (1+r)^(anni_i) = 0, dove anni_i è
 * il tempo (in anni) di ciascun flusso misurato in AVANTI dalla prima data
 * (convenzione Excel XIRR). Risolto per bisezione (robusta, niente derivate).
 * Ritorna il tasso come frazione (0,08 = 8%/anno) o null se non c'è una radice
 * nel range plausibile [-99,99%, +1000%].
 */
function xirr(
  cashflows: { amount: number; date: Date }[],
): number | null {
  if (cashflows.length < 2) return null;
  if (!cashflows.some((c) => c.amount > 0)) return null;
  if (!cashflows.some((c) => c.amount < 0)) return null;

  const ref = Math.min(...cashflows.map((c) => c.date.getTime()));
  const npv = (rate: number) =>
    cashflows.reduce((s, c) => {
      const years = (c.date.getTime() - ref) / MS_PER_YEAR;
      return s + c.amount / Math.pow(1 + rate, years);
    }, 0);

  let lo = -0.9999;
  let hi = 10; // +1000%/anno
  let flo = npv(lo);
  let fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  if (flo * fhi > 0) return null; // nessun cambio di segno → nessuna radice

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

export function computeHolding(
  lots: LotInput[],
  lastPrice: number | null,
  now: Date = new Date(),
): Holding | null {
  if (lots.length === 0) return null;

  const quantity = lots.reduce((s, l) => s + l.quantity, 0);
  const cost = lots.reduce((s, l) => s + l.quantity * l.price + (l.fee || 0), 0);
  const avgPrice = quantity !== 0 ? cost / quantity : 0;
  const value = lastPrice != null ? quantity * lastPrice : null;
  const pnl = value != null ? value - cost : null;
  const pnlPct = pnl != null && cost !== 0 ? (pnl / cost) * 100 : null;

  // Giacenza media pesata per il costo di ciascun lotto.
  let weightedDays = 0;
  let weightTotal = 0;
  for (const l of lots) {
    const lotCost = l.quantity * l.price + (l.fee || 0);
    const days = Math.max(0, (now.getTime() - l.date.getTime()) / MS_PER_DAY);
    weightedDays += lotCost * days;
    weightTotal += lotCost;
  }
  const avgHoldingDays = weightTotal > 0 ? weightedDays / weightTotal : null;

  // Rendimento medio annuo = XIRR sui flussi datati (acquisti in uscita alla
  // loro data + valore attuale in entrata oggi). Guardia: sotto i 14 giorni di
  // giacenza media annualizzare dà numeri fuorvianti → null.
  let annualizedPct: number | null = null;
  if (
    value != null &&
    cost > 0 &&
    avgHoldingDays != null &&
    avgHoldingDays >= 14
  ) {
    const cashflows = lots.map((l) => ({
      amount: -(l.quantity * l.price + (l.fee || 0)),
      date: l.date,
    }));
    cashflows.push({ amount: value, date: now });
    const r = xirr(cashflows);
    if (r != null && Number.isFinite(r)) annualizedPct = r * 100;
  }

  return {
    quantity,
    cost,
    avgPrice,
    value,
    pnl,
    pnlPct,
    avgHoldingDays,
    annualizedPct,
  };
}

/**
 * Rendimento medio annuo di un insieme di acquisti (portafoglio o singolo
 * asset): XIRR su tutti i lotti (uscite alle loro date) + il valore attuale
 * complessivo (entrata oggi). Ritorna la % annua, o null se non calcolabile
 * (nessun valore, costo ≤ 0, o giacenza media < 14 giorni).
 */
export function computeAnnualizedReturn(
  lots: LotInput[],
  totalValue: number | null,
  now: Date = new Date(),
): number | null {
  if (lots.length === 0 || totalValue == null) return null;

  let weightedDays = 0;
  let weightTotal = 0;
  for (const l of lots) {
    const lotCost = l.quantity * l.price + (l.fee || 0);
    const days = Math.max(0, (now.getTime() - l.date.getTime()) / MS_PER_DAY);
    weightedDays += lotCost * days;
    weightTotal += lotCost;
  }
  if (weightTotal <= 0) return null;
  const avgDays = weightedDays / weightTotal;
  if (avgDays < 14) return null;

  const cashflows = lots.map((l) => ({
    amount: -(l.quantity * l.price + (l.fee || 0)),
    date: l.date,
  }));
  cashflows.push({ amount: totalValue, date: now });
  const r = xirr(cashflows);
  return r != null && Number.isFinite(r) ? r * 100 : null;
}

/** Formatta una giacenza in giorni in etichetta breve ("18 gg", "7 mesi", "2a 3m"). */
export function formatHoldingPeriod(days: number | null): string {
  if (days == null || days <= 0) return "—";
  if (days < 45) return `${Math.round(days)} gg`;
  const months = days / 30.44;
  if (months < 18) return `${Math.round(months)} mesi`;
  const years = days / 365.25;
  let y = Math.floor(years);
  let remMonths = Math.round((years - y) * 12);
  if (remMonths === 12) {
    y += 1;
    remMonths = 0;
  }
  return remMonths > 0 ? `${y}a ${remMonths}m` : `${y} anni`;
}
