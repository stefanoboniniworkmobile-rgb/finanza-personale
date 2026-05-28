/**
 * GET /api/cron/refresh-prices
 *
 * Endpoint cron Vercel: aggiorna le quotazioni di TUTTI gli Asset non-manuali
 * di TUTTI gli Holder. Pensato per girare 1-2 volte al giorno (es. dopo la
 * chiusura dei mercati europei) e tenere la watchlist fresca senza che
 * l'utente debba cliccare "Aggiorna".
 *
 * Autenticazione:
 *  - Vercel Cron invia automaticamente `Authorization: Bearer <CRON_SECRET>`.
 *  - In dev: testabile manualmente con
 *    `curl -H "Authorization: Bearer dev" http://localhost:3000/api/cron/refresh-prices`
 *    avendo CRON_SECRET=dev in .env.local.
 *
 * Cosa fa:
 *  1) Carica TUTTI gli Asset con provider != "manual" (i manual non si
 *     toccano: il prezzo è inserito a mano dall'utente).
 *  2) Per ognuno chiama fetchMarketData con history=30 giorni.
 *  3) Persiste i punti (upsert su (assetId, date)) — idempotente.
 *  4) Pausa di 250ms tra una chiamata e l'altra per essere gentili coi
 *     provider pubblici (in particolare Yahoo).
 *
 * Massimo MAX_PER_RUN asset per invocazione: se la watchlist totale è grossa
 * (300+ asset distribuiti su molti Holder), splittiamo automaticamente in
 * più cron run per non sforare il budget serverless. Gli asset più vecchi
 * (lastSyncedAt più vecchio o mai aggiornato) hanno priorità.
 *
 * Schedule consigliato in vercel.json:
 *
 *   {
 *     "crons": [
 *       { "path": "/api/cron/refresh-prices", "schedule": "30 18 * * 1-5" }
 *     ]
 *   }
 *
 * Cioè ogni giorno feriale alle 18:30 UTC (~chiusura serale mercati EU).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchMarketData, type ProviderName } from "@/lib/markets";

const MAX_PER_RUN = 50;
const PAUSE_MS = 250;
const HISTORY_DAYS = 30;

export async function GET(req: NextRequest) {
  // Auth: Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Selezioniamo gli asset da aggiornare: tutti i non-manual, ordinati per
  // ultimo prezzo più vecchio (asc), così quelli mai aggiornati o aggiornati
  // tempo fa hanno priorità su quelli appena aggiornati.
  // Usiamo una query a step:
  //  1) findMany degli Asset con il loro ultimo AssetPrice (max date)
  //  2) sort in app per maxDate ASC
  //  3) prendi i primi MAX_PER_RUN
  const assets = await prisma.asset.findMany({
    where: { provider: { not: "manual" } },
    select: {
      id: true,
      symbol: true,
      provider: true,
      providerSymbol: true,
      assetClass: true,
      prices: {
        orderBy: { date: "desc" },
        take: 1,
        select: { date: true },
      },
    },
  });
  const sorted = assets
    .map((a) => ({
      ...a,
      lastSyncDate: a.prices[0]?.date.getTime() ?? 0,
    }))
    .sort((x, y) => x.lastSyncDate - y.lastSyncDate)
    .slice(0, MAX_PER_RUN);

  const results: Array<{ id: string; symbol: string; ok: boolean; error?: string }> = [];
  for (const a of sorted) {
    const res = await fetchMarketData(
      {
        symbol: a.symbol,
        provider: a.provider as ProviderName,
        providerSymbol: a.providerSymbol,
        assetClass: a.assetClass as "stock",
      },
      { withHistory: true, historyDays: HISTORY_DAYS },
    );
    if (!res.ok) {
      results.push({ id: a.id, symbol: a.symbol, ok: false, error: res.error });
    } else {
      try {
        const points = res.history ?? [];
        const today = midnightUtcToday();
        const todayPoint = { date: today, close: res.quote.price };
        const allPoints =
          points.length > 0
            ? points.some(
                (p) =>
                  p.date.toISOString().slice(0, 10) ===
                  today.toISOString().slice(0, 10),
              )
              ? points
              : [...points, todayPoint]
            : [todayPoint];

        // Upsert sequenziale (Prisma non ha createMany con conflict resolution su SQLite).
        // Per 30 punti × 50 asset = 1500 upsert: accettabile a 250ms tra chiamate API
        // (i write SQLite sono trascurabili rispetto al fetch HTTP).
        await prisma.$transaction(
          allPoints.map((p) =>
            prisma.assetPrice.upsert({
              where: {
                assetId_date: {
                  assetId: a.id,
                  date: normalizeToUtcMidnight(p.date),
                },
              },
              update: { close: p.close, source: a.provider },
              create: {
                assetId: a.id,
                date: normalizeToUtcMidnight(p.date),
                close: p.close,
                source: a.provider,
              },
            }),
          ),
        );
        results.push({ id: a.id, symbol: a.symbol, ok: true });
      } catch (e) {
        results.push({
          id: a.id,
          symbol: a.symbol,
          ok: false,
          error: `DB write fallito: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}

function midnightUtcToday(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function normalizeToUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
