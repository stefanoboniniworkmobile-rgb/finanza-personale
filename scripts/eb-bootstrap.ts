/**
 * Bootstrap di una BankConnection PSD2 nel DB.
 *
 * Da lanciare DOPO aver completato un consent flow Enable Banking (script
 * test-eb-start-prod.ts → callback → screenshot/copia session_id + account_uid).
 *
 * Uso:
 *   cd webapp
 *   npx tsx scripts/eb-bootstrap.ts \
 *     --session 80daf75c-a4dd-4f5b-8e25-178a51c55643 \
 *     --account f5dca79a-b957-42ab-97ce-e5b9694fa496 \
 *     --aspsp "Banca Mediolanum" \
 *     --bank "Mediolanum" \
 *     --validUntil "2026-11-12T19:26:58.659Z"
 *
 * Argomenti:
 *   --session     session_id ritornato da Enable Banking dopo authorize
 *   --account     uid dell'account dentro la session
 *   --aspsp       nome ASPSP esatto come listato da listAspsps (es. "Banca Mediolanum")
 *   --bank        nome del BankAccount nel TUO DB (es. "Mediolanum")
 *   --validUntil  ISO datetime di scadenza consenso (dal callback page)
 *   --holder      [opzionale] nome dell'Holder. Default: l'unico Holder se uno solo, altrimenti errore.
 *   --country     [opzionale] paese ASPSP. Default "IT".
 *
 * Effetto: crea (o aggiorna se esiste) una BankConnection. Idempotente:
 * (provider, providerAccountId) è UNIQUE, quindi rilanciando con stessi parametri
 * fa solo update di sessionId / validUntil / status.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

import { PrismaClient } from "@prisma/client";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = process.argv[i + 1];
      if (v && !v.startsWith("--")) {
        args[k] = v;
        i++;
      } else {
        args[k] = "true";
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const required = ["session", "account", "aspsp", "bank", "validUntil"];
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error(`✗ Argomenti mancanti: ${missing.join(", ")}`);
    console.error("  Vedi commenti in cima al file per la sintassi completa.");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    // Risolve Holder
    const holders = await prisma.holder.findMany();
    if (holders.length === 0) {
      console.error("✗ Nessun Holder nel DB. Crea prima un Holder.");
      process.exit(1);
    }
    let holder;
    if (args.holder) {
      holder = holders.find((h) => h.name === args.holder);
      if (!holder) {
        console.error(
          `✗ Holder "${args.holder}" non trovato. Disponibili: ${holders.map((h) => h.name).join(", ")}`,
        );
        process.exit(1);
      }
    } else if (holders.length === 1) {
      holder = holders[0];
    } else {
      console.error(
        `✗ Più di un Holder nel DB (${holders.map((h) => h.name).join(", ")}). Specifica --holder <nome>.`,
      );
      process.exit(1);
    }
    console.log(`  Holder: ${holder.name} (${holder.id})`);

    // Risolve BankAccount
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { holderId_name: { holderId: holder.id, name: args.bank } },
    });
    if (!bankAccount) {
      const all = await prisma.bankAccount.findMany({
        where: { holderId: holder.id },
      });
      console.error(
        `✗ BankAccount "${args.bank}" non trovato per Holder ${holder.name}.`,
      );
      console.error(`  Disponibili: ${all.map((a) => a.name).join(", ")}`);
      process.exit(1);
    }
    console.log(`  BankAccount: ${bankAccount.name} (${bankAccount.id})`);

    // Parse validUntil
    const validUntil = new Date(args.validUntil);
    if (Number.isNaN(validUntil.getTime())) {
      console.error(`✗ validUntil "${args.validUntil}" non è un ISO datetime valido`);
      process.exit(1);
    }
    console.log(`  Scadenza consenso: ${validUntil.toISOString()}`);

    // Upsert BankConnection — chiave (provider, providerAccountId)
    const provider = "enable_banking";
    const existing = await prisma.bankConnection.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId: args.account,
        },
      },
    });

    let conn;
    if (existing) {
      console.log(`  → BankConnection già esistente, aggiorno session/validUntil`);
      conn = await prisma.bankConnection.update({
        where: { id: existing.id },
        data: {
          sessionId: args.session,
          validUntil,
          status: "active",
          errorMessage: null,
          aspspName: args.aspsp,
          aspspCountry: args.country ?? "IT",
        },
      });
    } else {
      console.log(`  → Creo nuova BankConnection`);
      conn = await prisma.bankConnection.create({
        data: {
          holderId: holder.id,
          bankAccountId: bankAccount.id,
          provider,
          aspspName: args.aspsp,
          aspspCountry: args.country ?? "IT",
          sessionId: args.session,
          providerAccountId: args.account,
          validUntil,
          status: "active",
        },
      });
    }

    console.log(`\n✓ BankConnection pronta:`);
    console.log(`  id:                 ${conn.id}`);
    console.log(`  Holder + Account:   ${holder.name} → ${bankAccount.name}`);
    console.log(`  ASPSP:              ${conn.aspspName} (${conn.aspspCountry})`);
    console.log(`  sessionId:          ${conn.sessionId}`);
    console.log(`  providerAccountId:  ${conn.providerAccountId}`);
    console.log(`  validUntil:         ${conn.validUntil.toISOString()}`);
    console.log(`  status:             ${conn.status}`);
    console.log(`\nProssimo step:`);
    console.log(`  npx tsx scripts/eb-sync.ts ${conn.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("✗ ERRORE:", err);
  process.exit(1);
});
