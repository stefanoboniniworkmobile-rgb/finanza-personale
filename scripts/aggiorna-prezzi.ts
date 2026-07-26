/**
 * CLI per aggiornare le quotazioni degli asset dal TUO computer.
 *
 * Perché esiste: da server (Vercel) Yahoo blocca le richieste (401/429) e
 * Stooq ha un anti-bot. Dal tuo IP residenziale, invece, Yahoo risponde.
 * Questo script prende i prezzi EOD + storico e li scrive sul database di
 * produzione (Supabase, lo stesso che vedi nell'app online).
 *
 * ⚠️  Lancialo con la VPN STACCATA: le VPN escono da IP datacenter, che
 *     vengono bloccati esattamente come i server (vedrai errori 000/429).
 *
 * Uso:
 *   npm run prezzi                    # ultimi 60 giorni, tutti gli asset
 *   npm run prezzi -- --giorni 365    # backfill: ultimo anno di storico
 *   npm run prezzi -- --solo MONC.MI  # un solo asset
 */
import { prisma } from "../src/lib/db";
import { fetchMarketData } from "../src/lib/markets";
import type { AssetClass, ProviderName } from "../src/lib/markets";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Normalizza una data a mezzanotte UTC: chiave stabile per l'upsert per giorno. */
function normalizeToUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function midnightUtcToday(): Date {
  return normalizeToUtcMidnight(new Date());
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const giorni = Math.max(5, parseInt(arg("giorni") ?? "60", 10) || 60);
  const solo = arg("solo");

  const assets = await prisma.asset.findMany({
    where: {
      provider: { not: "manual" },
      ...(solo ? { OR: [{ symbol: solo }, { providerSymbol: solo }] } : {}),
    },
    select: {
      id: true,
      symbol: true,
      provider: true,
      providerSymbol: true,
      assetClass: true,
    },
    orderBy: { symbol: "asc" },
  });

  if (assets.length === 0) {
    console.log(
      `Nessun asset da aggiornare${solo ? ` (filtro --solo ${solo})` : ""}.`,
    );
    return;
  }

  console.log(
    `Aggiorno ${assets.length} asset · storico ${giorni} giorni · scrivo sul DB di produzione`,
  );
  console.log(
    "Se vedi errori 000/429, controlla che la VPN sia STACCATA.\n",
  );

  let ok = 0;
  let ko = 0;
  const today = midnightUtcToday();

  for (const a of assets) {
    process.stdout.write(`• ${a.symbol} [${a.provider}] … `);
    const res = await fetchMarketData(
      {
        symbol: a.symbol,
        provider: a.provider as ProviderName,
        providerSymbol: a.providerSymbol,
        assetClass: a.assetClass as AssetClass,
      },
      { withHistory: true, historyDays: giorni },
    );

    if (!res.ok) {
      ko++;
      console.log(`ERRORE: ${res.error}`);
      await sleep(1500);
      continue;
    }

    // Punti da salvare: tutto lo storico ritornato, o almeno il prezzo di oggi.
    const points = res.history ?? [];
    const allPoints =
      points.length > 0 ? [...points] : [{ date: today, close: res.quote.price }];

    // Forza l'ultimo prezzo (quote) come punto di oggi se lo storico si ferma
    // a ieri — così la riga in tabella mostra sempre il valore più fresco.
    const last = allPoints[allPoints.length - 1];
    if (normalizeToUtcMidnight(last.date).getTime() !== today.getTime()) {
      allPoints.push({ date: today, close: res.quote.price });
    }

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

    ok++;
    console.log(
      `ok · ${res.quote.price} (${allPoints.length} punti, al ${res.quote.asOf
        .toISOString()
        .slice(0, 10)})`,
    );
    await sleep(1500);
  }

  console.log(`\nFatto: ${ok} aggiornati, ${ko} falliti.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
