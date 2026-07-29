/**
 * Pagina /mercati — watchlist read-only di asset finanziari.
 *
 * Server component:
 *  - Auth + Holder attivo
 *  - Carica tutti gli Asset dell'Holder + ultimi 60 giorni di AssetPrice per
 *    ognuno (1 query con orderBy + groupBy in app, perché Prisma non ha un
 *    "include limited" pulito)
 *  - Calcola variazioni: giorno (vs precedente), settimana, mese, anno
 *  - Passa al client component per il rendering interattivo
 *
 * NB: il modulo è completamente disaccoppiato da Transaction e Holder business
 * data: non c'è integrazione con conti, P&L, holdings, ecc. Solo visualizzazione
 * di andamento.
 */

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { MercatiClient, type AssetRow } from "@/components/mercati/MercatiClient";
import {
  computeHolding,
  computeAnnualizedReturn,
} from "@/lib/markets/holdings";

type SearchParams = Promise<{
  classe?: string; // filtro assetClass: "all" | "stock" | "etf" | ...
}>;

const HISTORY_DAYS = 60;

export default async function MercatiPage(props: { searchParams: SearchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;

  const sp = await props.searchParams;
  const filtroClasse = sp.classe ?? "all";

  // Carica tutti gli asset + prezzi ultimi N giorni in una query.
  // Prisma non permette di limitare le righe di una relazione `include`,
  // ma possiamo filtrare per data: solo gli ultimi 60 giorni dall'oggi.
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - HISTORY_DAYS);

  const assets = await prisma.asset.findMany({
    where: {
      holderId,
      ...(filtroClasse !== "all" ? { assetClass: filtroClasse } : {}),
    },
    include: {
      prices: {
        where: { date: { gte: fromDate } },
        orderBy: { date: "asc" },
        select: { date: true, close: true },
      },
      lots: {
        orderBy: { date: "asc" },
        select: {
          id: true,
          quantity: true,
          price: true,
          fee: true,
          date: true,
          note: true,
        },
      },
    },
    orderBy: [{ assetClass: "asc" }, { position: "asc" }, { symbol: "asc" }],
  });

  const now = new Date();
  const rows: AssetRow[] = assets.map((a) => {
    const pts = a.prices.map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      close: p.close,
    }));
    const lastPoint = pts.length > 0 ? pts[pts.length - 1] : null;
    const prevPoint = pts.length > 1 ? pts[pts.length - 2] : null;

    const changeDayPct =
      lastPoint && prevPoint && prevPoint.close !== 0
        ? ((lastPoint.close - prevPoint.close) / prevPoint.close) * 100
        : null;

    const changeWeekPct = pctChangeOver(pts, daysAgo(now, 7));
    const changeMonthPct = pctChangeOver(pts, daysAgo(now, 30));
    // Per "anno" abbiamo solo 60 giorni di storico in pagina → in pratica
    // la var YTD non è calcolabile qui. La lasciamo a null finché non
    // estendiamo la finestra di history (futuro: separare "history per
    // sparkline" 30gg da "history per metriche" 365gg).
    const changeYearPct: number | null = null;

    const lastPrice = lastPoint?.close ?? null;
    const holding = computeHolding(
      a.lots.map((l) => ({
        quantity: l.quantity,
        price: l.price,
        fee: l.fee,
        date: l.date,
      })),
      lastPrice,
      now,
    );
    const lots = a.lots.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      price: l.price,
      fee: l.fee,
      date: l.date.toISOString().slice(0, 10),
      note: l.note,
    }));

    return {
      id: a.id,
      symbol: a.symbol,
      isin: a.isin,
      name: a.name,
      assetClass: a.assetClass,
      currency: a.currency,
      provider: a.provider,
      providerSymbol: a.providerSymbol,
      notes: a.notes,
      lastPrice,
      lastAsOf: lastPoint?.date ?? null,
      changeDayPct,
      changeWeekPct,
      changeMonthPct,
      changeYearPct,
      sparkPoints: pts.map((p) => ({ date: p.date, close: p.close })),
      lots,
      holding,
    };
  });

  // Totale portafoglio per valuta (niente conversione FX: sommiamo per valuta).
  // Raccogliamo anche TUTTI i lotti della valuta per l'XIRR complessivo.
  type LotDate = { quantity: number; price: number; fee: number; date: Date };
  const byCcy = new Map<
    string,
    { value: number; cost: number; pnl: number; lots: LotDate[] }
  >();
  for (const a of assets) {
    const lastClose = a.prices.length
      ? a.prices[a.prices.length - 1].close
      : null;
    const h = computeHolding(
      a.lots.map((l) => ({
        quantity: l.quantity,
        price: l.price,
        fee: l.fee,
        date: l.date,
      })),
      lastClose,
      now,
    );
    if (!h || h.value == null || h.pnl == null) continue;
    const t = byCcy.get(a.currency) ?? { value: 0, cost: 0, pnl: 0, lots: [] };
    t.value += h.value;
    t.cost += h.cost;
    t.pnl += h.pnl;
    for (const l of a.lots) {
      t.lots.push({
        quantity: l.quantity,
        price: l.price,
        fee: l.fee,
        date: l.date,
      });
    }
    byCcy.set(a.currency, t);
  }
  const portfolio = [...byCcy.entries()]
    .map(([currency, t]) => ({
      currency,
      value: t.value,
      cost: t.cost,
      pnl: t.pnl,
      pnlPct: t.cost !== 0 ? (t.pnl / t.cost) * 100 : null,
      annualizedPct: computeAnnualizedReturn(t.lots, t.value, now),
    }))
    .sort((a, b) => b.value - a.value);

  // Conteggi per la headline
  const counts = {
    total: rows.length,
    upDay: rows.filter((r) => (r.changeDayPct ?? 0) > 0).length,
    downDay: rows.filter((r) => (r.changeDayPct ?? 0) < 0).length,
    flat: rows.filter((r) => r.changeDayPct === 0 || r.changeDayPct === null).length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">Modulo</div>
          <h1 className="text-xl font-semibold tracking-tight">Mercati</h1>
        </div>
        <div className="text-xs text-sub">
          {counts.total} asset · {counts.upDay} ↑ · {counts.downDay} ↓ · {counts.flat} =
        </div>
      </div>

      {/* Filtro per asset class — form GET URL-persistente, stile coerente con /movimenti */}
      <form
        action="/mercati"
        className="panel p-3 mb-3 flex flex-wrap gap-2 items-end"
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-sub font-semibold">
            Classe asset
          </span>
          <select
            name="classe"
            defaultValue={filtroClasse}
            className="input !h-8 !py-0 min-w-[160px]"
          >
            <option value="all">Tutte</option>
            <option value="stock">Azioni</option>
            <option value="etf">ETF</option>
            <option value="index">Indici</option>
            <option value="currency">Cambi</option>
            <option value="rate">Tassi</option>
            <option value="bond">Obbligazioni</option>
            <option value="fund">Fondi</option>
            <option value="crypto">Cripto</option>
            <option value="other">Altro</option>
          </select>
        </label>
        <button type="submit" className="btn !h-8 !text-xs">
          Applica
        </button>
        <a href="/mercati" className="btn-ghost !h-8 !text-xs">
          Reset
        </a>
      </form>

      <MercatiClient rows={rows} portfolio={portfolio} />

      <div className="mt-4 panel p-4 text-xs text-sub leading-relaxed">
        <div className="font-medium text-ink mb-1">Come funziona</div>
        Aggiungi asset alla watchlist usando il bottone in alto. I prezzi si
        aggiornano automaticamente ogni giorno (cron alle 18:30 dopo la
        chiusura delle borse EU), oppure on-demand col bottone &quot;Aggiorna
        tutto&quot; o &quot;Aggiorna&quot; sulla singola riga. I fondi italiani
        senza API pubblica (Anima, Mediolanum, Eurizon…) si aggiornano a mano:
        scegli provider &quot;manual&quot; e inserisci il NAV quando serve.
      </div>
    </div>
  );
}

/** Variazione % tra l'ultimo punto della serie e quello più recente ≤ target. */
function pctChangeOver(
  pts: Array<{ date: string; close: number }>,
  targetDate: Date,
): number | null {
  if (pts.length < 2) return null;
  const targetIso = targetDate.toISOString().slice(0, 10);
  // Trova l'ultimo punto con date <= target. Iteriamo dall'inizio (ASC).
  let baseline: number | null = null;
  for (const p of pts) {
    if (p.date <= targetIso) baseline = p.close;
    else break;
  }
  if (baseline == null || baseline === 0) return null;
  const last = pts[pts.length - 1].close;
  return ((last - baseline) / baseline) * 100;
}

function daysAgo(now: Date, n: number): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
