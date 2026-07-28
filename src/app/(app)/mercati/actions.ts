"use server";

/**
 * Server Actions per il modulo Mercati (watchlist read-only).
 * Tutte Holder-scoped: ownership check obbligatorio prima di scrivere.
 *
 * NB: questo modulo NON tocca Transaction né i conti — è completamente
 * separato dal dominio "movimenti". Vedi memoria project_mercati per il
 * razionale dello scope ridotto.
 */

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  fetchMarketData,
  fetchStooq,
  fetchTwelveData,
  searchYahoo,
  suggestProvider,
  suggestProviderSymbol,
  yahooToStooqSymbol,
  yahooToTwelveDataSymbol,
  getCatalogGrouped,
  getCatalogFlat,
  type AssetSearchHit,
  type CatalogGroup,
  type ProviderName,
} from "@/lib/markets";
import {
  buildStalePriceMessage,
  shouldUseLastKnownPrice,
  shouldUseStooqFallback,
} from "@/lib/markets/fallback";
import { resolveIsin, type IsinResolution } from "@/lib/markets/isin";

const ASSET_CLASSES = [
  "stock",
  "etf",
  "index",
  "currency",
  "rate",
  "bond",
  "fund",
  "crypto",
  "other",
] as const;
const PROVIDERS = ["yahoo", "ecb", "stooq", "manual"] as const;

const assetInputSchema = z.object({
  id: z.string().optional(),
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol obbligatorio")
    .max(40)
    .transform((v) => v.toUpperCase().replace(/\s+/g, "")),
  isin: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => v === "" || /^[A-Z]{2}[A-Z0-9]{10}$/.test(v), "ISIN non valido")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  name: z.string().trim().min(1, "Nome obbligatorio").max(120),
  assetClass: z.enum(ASSET_CLASSES as unknown as [string, ...string[]]),
  currency: z.string().trim().min(1).max(8).default("EUR"),
  provider: z.enum(PROVIDERS as unknown as [string, ...string[]]).optional(),
  providerSymbol: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  // Prezzo iniziale solo per provider=manual: l'utente lo inserisce a mano.
  initialPrice: z.coerce.number().positive().max(10_000_000).optional(),
});

export type AssetInput = z.infer<typeof assetInputSchema>;

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

async function requireHolder() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  const holder = await getActiveHolder(session.user.id);
  return { holderId: holder.id };
}

/**
 * Crea o aggiorna un Asset.
 * - In create: se provider/providerSymbol non sono passati, vengono inferiti
 *   da assetClass e symbol via suggestProvider/suggestProviderSymbol.
 * - In create: se provider=manual e initialPrice è passato, salva subito il
 *   prezzo nell'AssetPrice del giorno.
 * - In update: tutti i campi sovrascritti; i prezzi storici restano.
 */
export async function saveAsset(raw: AssetInput): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const parse = assetInputSchema.safeParse(raw);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;

  const provider = (v.provider ?? suggestProvider(v.assetClass)) as ProviderName;
  const providerSymbol =
    v.providerSymbol && v.providerSymbol.length > 0
      ? v.providerSymbol
      : suggestProviderSymbol(v.symbol, provider);

  try {
    let savedId: string;
    if (v.id) {
      const existing = await prisma.asset.findFirst({
        where: { id: v.id, holderId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Asset non trovato" };
      const updated = await prisma.asset.update({
        where: { id: v.id },
        data: {
          symbol: v.symbol,
          isin: v.isin ?? null,
          name: v.name,
          assetClass: v.assetClass,
          currency: v.currency,
          provider,
          providerSymbol,
          notes: v.notes ?? null,
        },
      });
      savedId = updated.id;
    } else {
      const created = await prisma.asset.create({
        data: {
          holderId,
          symbol: v.symbol,
          isin: v.isin ?? null,
          name: v.name,
          assetClass: v.assetClass,
          currency: v.currency,
          provider,
          providerSymbol,
          notes: v.notes ?? null,
        },
        select: { id: true },
      });
      savedId = created.id;
      // Se provider=manual e l'utente ha indicato un prezzo iniziale,
      // salviamolo subito così la tabella mostra qualcosa.
      if (provider === "manual" && v.initialPrice && v.initialPrice > 0) {
        await prisma.assetPrice.create({
          data: {
            assetId: savedId,
            date: midnightUtcToday(),
            close: v.initialPrice,
            source: "manual",
          },
        });
      }
    }

    revalidatePath("/mercati");
    return { ok: true, id: savedId };
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err.code === "P2002") {
      return {
        ok: false,
        error: "Esiste già un asset con questo symbol nella tua watchlist",
      };
    }
    return {
      ok: false,
      error: `Errore salvataggio: ${err.message ?? "sconosciuto"}`,
    };
  }
}

/** Elimina un asset (e tutti i suoi prezzi storici via onDelete: Cascade). */
export async function deleteAsset(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const existing = await prisma.asset.findFirst({
    where: { id, holderId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Asset non trovato" };
  await prisma.asset.delete({ where: { id } });
  revalidatePath("/mercati");
  return { ok: true, id };
}

/**
 * Inserisce manualmente un prezzo per un asset (tipicamente per provider=manual,
 * ma supportato anche per gli altri se l'utente vuole "correggere" un punto).
 * Upsert su (assetId, date): se per quella data esisteva già un prezzo, lo sovrascrive.
 */
export async function setManualPrice(
  assetId: string,
  price: number,
  dateIso?: string,
): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, holderId },
    select: { id: true },
  });
  if (!asset) return { ok: false, error: "Asset non trovato" };
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Prezzo non valido" };
  }
  const date = dateIso
    ? new Date(dateIso + "T00:00:00Z")
    : midnightUtcToday();
  await prisma.assetPrice.upsert({
    where: { assetId_date: { assetId, date } },
    update: { close: price, source: "manual" },
    create: { assetId, date, close: price, source: "manual" },
  });
  revalidatePath("/mercati");
  return { ok: true, id: assetId };
}

/**
 * Refresh delle quotazioni di un singolo asset (bottone "Aggiorna" sulla riga).
 * Salva quote + storico in AssetPrice (upsert per giorno). Provider=manual
 * viene ignorato (no fetch automatico).
 */
export async function refreshAsset(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const asset = await prisma.asset.findFirst({
    where: { id, holderId },
    select: {
      id: true,
      symbol: true,
      provider: true,
      providerSymbol: true,
      assetClass: true,
    },
  });
  if (!asset) return { ok: false, error: "Asset non trovato" };
  if (asset.provider === "manual") {
    return {
      ok: false,
      error: "Asset manuale: aggiorna il prezzo dalla scheda asset, non c'è fetch automatico.",
    };
  }
  let res = await fetchMarketData(
    {
      symbol: asset.symbol,
      provider: asset.provider as ProviderName,
      providerSymbol: asset.providerSymbol,
      assetClass: asset.assetClass as "stock", // cast loose: l'enum è esaustivo nel runtime check del provider
    },
    { withHistory: true, historyDays: 60 },
  );

  // ─── Fallback gratuito su rate limit / provider bloccato ─────────────
  // Per gli asset già esistenti che usano Yahoo, proviamo prima Stooq (free)
  // e poi Twelve Data come secondo fallback se disponibile. Il messaggio
  // mostrato all'utente resta neutro: non vogliamo più etichettare l'errore
  // come "Yahoo" quando il problema è il provider di dati nel suo insieme.
  let usedFallback: false | "stooq" | "twelvedata" = false;
  if (!res.ok && shouldUseStooqFallback(res.error) && asset.provider === "yahoo") {
    const stooqSymbol = yahooToStooqSymbol(asset.providerSymbol, asset.assetClass);
    if (stooqSymbol) {
      const stooqRes = await fetchStooq(
        {
          symbol: asset.symbol,
          provider: "stooq",
          providerSymbol: stooqSymbol,
          assetClass: asset.assetClass as "stock",
        },
        { withHistory: true, historyDays: 60 },
      );
      if (stooqRes.ok) {
        res = stooqRes;
        usedFallback = "stooq";
      } else {
        const tdSym = yahooToTwelveDataSymbol(asset.providerSymbol, asset.assetClass);
        if (tdSym) {
          const tdRes = await fetchTwelveData(
            {
              symbol: asset.symbol,
              provider: "yahoo",
              providerSymbol: tdSym,
              assetClass: asset.assetClass as "stock",
            },
            { withHistory: true, historyDays: 60 },
          );
          if (tdRes.ok) {
            res = tdRes;
            usedFallback = "twelvedata";
          } else {
            res = {
              ok: false,
              error: `Il provider di dati è temporaneamente limitato. Stooq e Twelve Data non hanno restituito dati: ${tdRes.error}`,
            };
          }
        } else {
          res = {
            ok: false,
            error: `Il provider di dati è temporaneamente limitato. Stooq non ha restituito dati: ${stooqRes.error}`,
          };
        }
      }
    } else {
      const tdSym = yahooToTwelveDataSymbol(asset.providerSymbol, asset.assetClass);
      if (tdSym) {
        const tdRes = await fetchTwelveData(
          {
            symbol: asset.symbol,
            provider: "yahoo",
            providerSymbol: tdSym,
            assetClass: asset.assetClass as "stock",
          },
          { withHistory: true, historyDays: 60 },
        );
        if (tdRes.ok) {
          res = tdRes;
          usedFallback = "twelvedata";
        } else {
          res = {
            ok: false,
            error: `Il provider di dati è temporaneamente limitato. Nessun fallback gratuito disponibile: ${tdRes.error}`,
          };
        }
      } else {
        res = {
          ok: false,
          error: `Il provider di dati è temporaneamente limitato. Nessun fallback gratuito disponibile.`,
        };
      }
    }
  }

  if (!res.ok) {
    const lastKnown = await prisma.assetPrice.findFirst({
      where: { assetId: id },
      orderBy: { date: "desc" },
      select: { close: true, date: true },
    });

    if (lastKnown && shouldUseLastKnownPrice(res.error)) {
      return { ok: false, error: buildStalePriceMessage(res.error, lastKnown) };
    }

    return { ok: false, error: res.error };
  }

  // Persiste l'ultimo prezzo + tutto lo storico ritornato.
  // Upsert per (assetId, date) → idempotente.
  const points = res.history ?? [];
  // Garantisce di salvare comunque il quote "attuale" anche se la history è vuota.
  const today = midnightUtcToday();
  const todayPoint = { date: today, close: res.quote.price };
  const allPoints = points.length > 0 ? points : [todayPoint];

  // Forziamo che l'ultimo punto sia sempre "asOf" della quote — alcuni provider
  // (es. Yahoo) ritornano history daily che si ferma a ieri mentre la quote è
  // intraday di oggi.
  if (
    points.length > 0 &&
    points[points.length - 1].date.toISOString().slice(0, 10) !==
      today.toISOString().slice(0, 10)
  ) {
    allPoints.push(todayPoint);
  }

  // Source nel DB: provider configurato sull'asset, o tag fallback se
  // abbiamo dovuto rinunciare a Yahoo per rate limit. Utile per analizzare
  // i dati storici e capire quale punto è arrivato da dove.
  const sourceTag =
    usedFallback === "twelvedata"
      ? "twelvedata-fallback"
      : usedFallback === "stooq"
        ? "stooq-fallback"
        : asset.provider;

  // Batch upsert (Prisma non ha upsertMany, ciclo in transazione).
  await prisma.$transaction(
    allPoints.map((p) =>
      prisma.assetPrice.upsert({
        where: { assetId_date: { assetId: id, date: normalizeToUtcMidnight(p.date) } },
        update: { close: p.close, source: sourceTag },
        create: {
          assetId: id,
          date: normalizeToUtcMidnight(p.date),
          close: p.close,
          source: sourceTag,
        },
      }),
    ),
  );

  revalidatePath("/mercati");
  return { ok: true, id };
}

export type RefreshFailure = {
  id: string;
  symbol: string;
  name: string;
  error: string;
};

/**
 * Refresh di TUTTI gli asset non-manual dell'Holder. Usato dal bottone
 * "Aggiorna tutto" in pagina mercati.
 *
 * Strategia per minimizzare 429 Yahoo:
 *  - Asset provider="yahoo" → 1 sola chiamata batch (v7/finance/quote)
 *    che restituisce le quote di tutti i simboli in un colpo solo.
 *    NON aggiorna la sparkline (storico): la quote contiene solo il
 *    prezzo attuale + previousClose. Per la sparkline serve il refresh
 *    singolo (click "Aggiorna" su riga) o il cron notturno.
 *  - Asset provider="ecb" (cambi BCE) → loop singolo come prima.
 *    Nessun rate limit BCE, niente problemi.
 *
 * Restituisce anche `failures: RefreshFailure[]` con il dettaglio di
 * quali asset hanno fallito e perché.
 */
export async function refreshAllAssets(): Promise<
  | {
      ok: true;
      refreshed: number;
      errors: number;
      failures: RefreshFailure[];
    }
  | { ok: false; error: string }
> {
  const { holderId } = await requireHolder();
  const assets = await prisma.asset.findMany({
    where: { holderId, provider: { not: "manual" } },
    select: { id: true, symbol: true, name: true },
    orderBy: { symbol: "asc" },
  });
  let refreshed = 0;
  let errors = 0;
  const failures: RefreshFailure[] = [];

  // Refresh per-asset via l'endpoint chart v8 (dentro refreshAsset): porta
  // anche lo storico per la sparkline. NON usiamo più il batch
  // v7/finance/quote — da luglio 2026 risponde 401 Unauthorized. Una piccola
  // pausa tra le chiamate tiene basso il rischio di 429 lato Yahoo.
  for (const a of assets) {
    const r = await refreshAsset(a.id);
    if (r.ok) {
      refreshed++;
    } else {
      errors++;
      failures.push({
        id: a.id,
        symbol: a.symbol,
        name: a.name,
        error: r.error,
      });
    }
    await new Promise((res) => setTimeout(res, 400));
  }

  revalidatePath("/mercati");
  return { ok: true, refreshed, errors, failures };
}

/**
 * Cerca asset via Yahoo per nome o ticker parziale.
 *
 * UX: l'utente nel dialog "+ Nuovo asset" digita "eni" e riceve in dropdown:
 *  - ENI.MI — Eni S.p.A. (Azione, MIL)
 *  - ENI.PA — Eni S.p.A. (Azione, Parigi)
 *  - ...
 * Click sul risultato pre-compila il form col symbol/name/assetClass/providerSymbol
 * corretti — niente più "devo sapere il ticker esatto".
 *
 * Auth check (no abusi: l'endpoint Yahoo è pubblico ma vogliamo limitarlo
 * agli utenti autenticati dell'app).
 *
 * Restituisce sempre `ok: true` con array (eventualmente vuoto), non solleva
 * errori per la UI: una ricerca fallita = lista vuota.
 */
/**
 * Risolve un ISIN in un asset pronto da aggiungere: nome autorevole da
 * OpenFIGI (Bloomberg) + simbolo/prezzo da Yahoo + punteggio di confidenza
 * (quanto è probabile che il simbolo Yahoo sia davvero quello strumento).
 */
export async function resolveAssetByIsin(
  isin: string,
): Promise<{ ok: true; data: IsinResolution } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Non autenticato" };
  }
  const r = await resolveIsin(isin);
  if (!r) return { ok: false, error: "ISIN non valido (attesi 12 caratteri)" };
  return { ok: true, data: r };
}

// ─── Lotti d'acquisto (portafoglio) ──────────────────────────────────────
const lotInputSchema = z.object({
  assetId: z.string().min(1),
  quantity: z.coerce.number().positive().max(1_000_000_000_000),
  price: z.coerce.number().min(0).max(1_000_000_000_000),
  fee: z.coerce.number().min(0).max(1_000_000_000).default(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida"),
  note: z.string().trim().max(200).nullable().optional(),
});
export type LotInput = z.input<typeof lotInputSchema>;

/** Aggiunge un acquisto (lotto) a un asset dell'Holder attivo. */
export async function addLot(raw: LotInput): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const parsed = lotInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dati non validi" };
  }
  const p = parsed.data;
  const asset = await prisma.asset.findFirst({
    where: { id: p.assetId, holderId },
    select: { id: true },
  });
  if (!asset) return { ok: false, error: "Asset non trovato" };

  await prisma.assetLot.create({
    data: {
      assetId: asset.id,
      quantity: p.quantity,
      price: p.price,
      fee: p.fee,
      date: new Date(p.date + "T00:00:00Z"),
      note: p.note?.trim() ? p.note.trim() : null,
    },
  });
  revalidatePath("/mercati");
  return { ok: true, id: asset.id };
}

/** Elimina un acquisto (lotto). Verifica che appartenga all'Holder attivo. */
export async function deleteLot(lotId: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const lot = await prisma.assetLot.findFirst({
    where: { id: lotId, asset: { holderId } },
    select: { id: true, assetId: true },
  });
  if (!lot) return { ok: false, error: "Acquisto non trovato" };

  await prisma.assetLot.delete({ where: { id: lot.id } });
  revalidatePath("/mercati");
  return { ok: true, id: lot.assetId };
}

export async function searchAssets(
  query: string,
): Promise<{ ok: true; results: AssetSearchHit[] } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Non autenticato" };
  }
  const q = (query ?? "").trim();
  if (q.length < 2) {
    // Sotto i 2 caratteri non perdiamo tempo a chiamare Yahoo: ritorniamo subito.
    return { ok: true, results: [] };
  }
  if (q.length > 60) {
    return { ok: false, error: "Query troppo lunga" };
  }
  const results = await searchYahoo(q, 10);
  if (results.length > 0) {
    return { ok: true, results };
  }

  const catalog = getCatalogFlat()
    .filter((hit) => {
      const haystack = `${hit.symbol} ${hit.name}`.toLowerCase();
      return haystack.includes(q.toLowerCase());
    })
    .slice(0, 10);

  return { ok: true, results: catalog };
}

/**
 * Catalogo curato di asset "popolari" da mostrare nel dialog quando il campo
 * ricerca è vuoto. Categorizzato (Azioni IT, ETF, Indici, Cambi, Cripto).
 *
 * Wrap in server action invece di esporre direttamente `getCatalogGrouped`
 * dal client per:
 *  - mantenere l'auth check (coerente con searchAssets),
 *  - poter in futuro arricchire il catalogo con dati derivati dall'utente
 *    (es. "asset già nella tua watchlist" per filtrarli o badge "già aggiunto")
 *    senza dover toccare la UI.
 */
export async function browseCatalog(): Promise<
  { ok: true; groups: CatalogGroup[] } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Non autenticato" };
  }
  return { ok: true, groups: getCatalogGrouped() };
}

/** Util: mezzanotte UTC del giorno corrente (per chiavi date stabili). */
function midnightUtcToday(): Date {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Util: normalizza una Date a mezzanotte UTC (per upsert by date senza drift TZ). */
function normalizeToUtcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
