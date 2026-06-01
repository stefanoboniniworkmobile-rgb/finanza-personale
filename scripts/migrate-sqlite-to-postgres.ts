/**
 * Migrazione dati one-shot da SQLite (db.sqlite locale) a Postgres (Supabase prod).
 *
 * Pre-condizioni:
 *  1. Schema Prisma con provider="postgresql".
 *  2. Tabelle già create su Supabase: `npx prisma db push` lanciato prima.
 *  3. DATABASE_URL nel .env punta al pooler Supabase (porta 6543).
 *  4. db.sqlite locale presente in `prisma/db.sqlite`.
 *  5. Pacchetto `better-sqlite3` installato (devDependencies).
 *
 * Uso:
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * Sicurezza:
 *  - Assume tabelle Postgres VUOTE. Se ci sono record esistenti gli insert
 *    falliscono con P2002 (unique constraint).
 *  - Non cancella nulla da SQLite: l'origine resta intatta.
 */

import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";

const SQLITE_PATH = resolve(process.cwd(), "prisma/db.sqlite");

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const pg = new PrismaClient();

/** Legge tutte le righe di una tabella SQLite come array di oggetti raw. */
function readAll(table: string): Record<string, unknown>[] {
  return sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<
    string,
    unknown
  >[];
}

/** SQLite tiene le date come Int (epoch ms) o stringa ISO. Normalizza a Date. */
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** SQLite usa Int 0/1 per booleani. Normalizza a boolean. */
function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1" || v === "true";
}

/**
 * Set di nomi colonna che convenzionalmente in questo schema sono date.
 * Tutti i campi che corrispondono vengono convertiti a Date prima del
 * `pg.<model>.create()` — evita ripetizione di toDate per ogni modello.
 */
const DATE_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "date",
  "valueDate",
  "expires",
  "expiresAt",
  "emailVerified",
  "lastSyncedAt",
  "lastSyncAt",
  "lastSyncedTxDate",
  "lastSeenAt",
  "validUntil",
  "reconciledAt",
  "startedAt",
  "finishedAt",
  "nextRunAt",
]);

/**
 * Set di nomi colonna che convenzionalmente in questo schema sono boolean.
 * Su SQLite arrivano come 0/1, Postgres vuole true/false.
 */
const BOOL_FIELDS = new Set([
  "reconciled",
  "isTransfer",
  "used",
  "showInDashboard", // Category
  "hasBudget", // Category
  "forceAbs", // ImportTemplate
  "invertSigns", // ImportTemplate
]);

/**
 * Normalizza un record SQLite per Prisma postgres:
 *  - colonne in DATE_FIELDS → Date (o null se vuoto)
 *  - colonne in BOOL_FIELDS → boolean
 *  - resto invariato
 *
 * Garantisce createdAt/updatedAt valorizzati (se NULL nello SQLite mette ora corrente).
 */
function prepRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (DATE_FIELDS.has(k)) {
      out[k] = toDate(v) ?? (k === "createdAt" || k === "updatedAt" ? new Date() : null);
    } else if (BOOL_FIELDS.has(k)) {
      out[k] = toBool(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function main() {
  console.log(`[migrate] Aperto SQLite: ${SQLITE_PATH}`);
  console.log(`[migrate] Connesso a Postgres via Prisma`);

  // ─── 1) User + tabelle Auth.js standalone ──────────────────────────
  const users = readAll("User");
  for (const u of users) {
    await pg.user.create({ data: prepRow(u) as never });
  }
  console.log(`[migrate] User: ${users.length}`);

  const verifTokens = readAll("VerificationToken");
  for (const t of verifTokens) {
    await pg.verificationToken.create({ data: prepRow(t) as never });
  }
  console.log(`[migrate] VerificationToken: ${verifTokens.length}`);

  const pendingPsd2 = readAll("PendingPsd2Session");
  for (const p of pendingPsd2) {
    await pg.pendingPsd2Session.create({ data: prepRow(p) as never });
  }
  console.log(`[migrate] PendingPsd2Session: ${pendingPsd2.length}`);

  // ─── 2) FK → User ──────────────────────────────────────────────────
  const accounts = readAll("AuthAccount");
  for (const a of accounts) {
    await pg.authAccount.create({ data: prepRow(a) as never });
  }
  console.log(`[migrate] AuthAccount: ${accounts.length}`);

  const sessions = readAll("Session");
  for (const s of sessions) {
    await pg.session.create({ data: prepRow(s) as never });
  }
  console.log(`[migrate] Session: ${sessions.length}`);

  const emailChanges = readAll("EmailChangeRequest");
  for (const e of emailChanges) {
    await pg.emailChangeRequest.create({ data: prepRow(e) as never });
  }
  console.log(`[migrate] EmailChangeRequest: ${emailChanges.length}`);

  const holders = readAll("Holder");
  for (const h of holders) {
    await pg.holder.create({ data: prepRow(h) as never });
  }
  console.log(`[migrate] Holder: ${holders.length}`);

  // ─── 3) FK → Holder ────────────────────────────────────────────────
  const bankAccs = readAll("BankAccount");
  for (const b of bankAccs) {
    await pg.bankAccount.create({ data: prepRow(b) as never });
  }
  console.log(`[migrate] BankAccount: ${bankAccs.length}`);

  // Category: inserisco SENZA counterpartCategoryId per evitare self-FK
  // mancante. Lo aggiorno dopo in un secondo passaggio.
  const categories = readAll("Category");
  for (const c of categories) {
    const prepped = prepRow(c);
    prepped.counterpartCategoryId = null;
    await pg.category.create({ data: prepped as never });
  }
  console.log(`[migrate] Category (senza counterpart): ${categories.length}`);

  const paymentMethods = readAll("PaymentMethod");
  for (const p of paymentMethods) {
    await pg.paymentMethod.create({ data: prepRow(p) as never });
  }
  console.log(`[migrate] PaymentMethod: ${paymentMethods.length}`);

  const forecasts = readAll("Forecast");
  for (const f of forecasts) {
    await pg.forecast.create({ data: prepRow(f) as never });
  }
  console.log(`[migrate] Forecast: ${forecasts.length}`);

  const assets = readAll("Asset");
  for (const a of assets) {
    await pg.asset.create({ data: prepRow(a) as never });
  }
  console.log(`[migrate] Asset: ${assets.length}`);

  const bankConns = readAll("BankConnection");
  for (const bc of bankConns) {
    await pg.bankConnection.create({ data: prepRow(bc) as never });
  }
  console.log(`[migrate] BankConnection: ${bankConns.length}`);

  // ─── 4) UPDATE Category counterpart ────────────────────────────────
  let counterpartUpdates = 0;
  for (const c of categories) {
    const cp = c.counterpartCategoryId;
    if (cp) {
      await pg.category.update({
        where: { id: c.id as string },
        data: { counterpartCategoryId: cp as string },
      });
      counterpartUpdates++;
    }
  }
  console.log(`[migrate] Category counterpart updates: ${counterpartUpdates}`);

  // ─── 5) ImportTemplate ─────────────────────────────────────────────
  const importTemplates = readAll("ImportTemplate");
  for (const t of importTemplates) {
    await pg.importTemplate.create({ data: prepRow(t) as never });
  }
  console.log(`[migrate] ImportTemplate: ${importTemplates.length}`);

  // ─── 6) Tabelle figlie varie ───────────────────────────────────────
  const monthlyOverrides = readAll("MonthlyBudgetOverride");
  for (const m of monthlyOverrides) {
    await pg.monthlyBudgetOverride.create({ data: prepRow(m) as never });
  }
  console.log(`[migrate] MonthlyBudgetOverride: ${monthlyOverrides.length}`);

  const forecastBudgets = readAll("ForecastBudget");
  for (const f of forecastBudgets) {
    await pg.forecastBudget.create({ data: prepRow(f) as never });
  }
  console.log(`[migrate] ForecastBudget: ${forecastBudgets.length}`);

  const importBatches = readAll("ImportBatch");
  for (const ib of importBatches) {
    await pg.importBatch.create({ data: prepRow(ib) as never });
  }
  console.log(`[migrate] ImportBatch: ${importBatches.length}`);

  const importMappings = readAll("ImportMapping");
  for (const im of importMappings) {
    await pg.importMapping.create({ data: prepRow(im) as never });
  }
  console.log(`[migrate] ImportMapping: ${importMappings.length}`);

  const syncJobs = readAll("SyncJob");
  for (const sj of syncJobs) {
    await pg.syncJob.create({ data: prepRow(sj) as never });
  }
  console.log(`[migrate] SyncJob: ${syncJobs.length}`);

  const assetPrices = readAll("AssetPrice");
  for (const ap of assetPrices) {
    await pg.assetPrice.create({ data: prepRow(ap) as never });
  }
  console.log(`[migrate] AssetPrice: ${assetPrices.length}`);

  // ─── 7) Transaction (la più grossa) ────────────────────────────────
  const txs = readAll("Transaction");
  let inserted = 0;
  for (const t of txs) {
    await pg.transaction.create({ data: prepRow(t) as never });
    inserted++;
    if (inserted % 50 === 0)
      console.log(`[migrate] Transaction: ${inserted}/${txs.length}`);
  }
  console.log(`[migrate] Transaction totali: ${inserted}`);

  console.log(`\n[migrate] ✓ Migrazione completata.`);
}

main()
  .catch((e) => {
    console.error(`[migrate] ✗ ERRORE:`, e);
    process.exit(1);
  })
  .finally(async () => {
    await pg.$disconnect();
    sqlite.close();
  });
