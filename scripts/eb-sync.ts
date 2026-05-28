/**
 * Sync transazioni PSD2 da Enable Banking → DB.
 *
 * Usa BankConnection già esistenti (vedi scripts/eb-bootstrap.ts per crearne una).
 *
 * Strategia di default (incrementale):
 *  - se è il primo sync per quel conto e ci sono già tx in DB per quel BankAccount
 *    (tipico: hai importato lo storico via Excel) → parte da max(date) + 1 giorno,
 *    così non duplica nulla
 *  - se il primo sync è davvero "da zero" (BankAccount vuoto) → strategy=longest
 *    (storico 1-3 anni se la banca lo espone)
 *  - sync successivi → da lastSyncedTxDate - 7gg buffer (assorbe correzioni banca)
 *
 * Uso:
 *   cd webapp
 *
 *   # Sync di TUTTE le BankConnection attive dell'unico Holder
 *   npx tsx scripts/eb-sync.ts
 *
 *   # Sync di una specifica BankConnection
 *   npx tsx scripts/eb-sync.ts <bankConnectionId>
 *
 *   # Force full re-fetch (storico massimo, ignora cutoff)
 *   npx tsx scripts/eb-sync.ts <bankConnectionId> --full
 *
 *   # Range esplicito
 *   npx tsx scripts/eb-sync.ts <bankConnectionId> --from 2026-05-01
 *   npx tsx scripts/eb-sync.ts <bankConnectionId> --from 2026-01-01 --to 2026-06-30
 *
 *   # Dry-run (mostra cosa farebbe senza scrivere su DB)
 *   npx tsx scripts/eb-sync.ts <bankConnectionId> --dry-run
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
import { syncBankConnection } from "../src/lib/psd2/sync";

type ParsedArgs = {
  bankConnectionId?: string;
  from?: string;
  to?: string;
  full?: boolean;
  dryRun?: boolean;
};

function parseArgs(): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--full") out.full = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--from") {
      out.from = process.argv[++i];
    } else if (a === "--to") {
      out.to = process.argv[++i];
    } else if (!a.startsWith("--") && !out.bankConnectionId) {
      out.bankConnectionId = a;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs();

  if (args.dryRun) {
    console.error("✗ --dry-run non ancora supportato. Rimuovi il flag.");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    // Carica le connessioni da syncare
    const connections = args.bankConnectionId
      ? await prisma.bankConnection.findMany({
          where: { id: args.bankConnectionId },
          include: { bankAccount: true, holder: true },
        })
      : await prisma.bankConnection.findMany({
          where: { status: "active" },
          include: { bankAccount: true, holder: true },
        });

    if (connections.length === 0) {
      console.error(
        args.bankConnectionId
          ? `✗ BankConnection ${args.bankConnectionId} non trovata`
          : "✗ Nessuna BankConnection attiva. Crea con scripts/eb-bootstrap.ts",
      );
      process.exit(1);
    }

    console.log(
      `→ Sync di ${connections.length} BankConnection${connections.length > 1 ? "i" : ""}\n`,
    );

    let totalInserted = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    for (const conn of connections) {
      console.log(
        `── ${conn.holder.name} / ${conn.bankAccount.name} (${conn.aspspName})`,
      );
      console.log(`   id: ${conn.id}`);
      console.log(
        `   lastSyncedTxDate: ${conn.lastSyncedTxDate?.toISOString().slice(0, 10) ?? "<mai sincronizzato>"}`,
      );
      console.log(
        `   validUntil: ${conn.validUntil.toISOString().slice(0, 10)} (status: ${conn.status})`,
      );

      try {
        const stats = await syncBankConnection(prisma, conn.id, {
          from: args.from,
          to: args.to,
          full: args.full,
          psuHeaders: {
            "PSU-IP-Address": "127.0.0.1",
            "PSU-User-Agent": "Mozilla/5.0 (Finanza Personale sync)",
          },
        });

        console.log(`   ✓ Sync completato in ${stats.elapsedMs}ms`);
        console.log(
          `     Pagine: ${stats.pagesFetched}    TX ricevute: ${stats.txReceived}`,
        );
        console.log(
          `     Inserite: ${stats.txInserted}    Aggiornate: ${stats.txUpdated}    Skipped: ${stats.txSkipped}`,
        );
        if (stats.dateRangeReceived) {
          console.log(
            `     Range: ${stats.dateRangeReceived.min} → ${stats.dateRangeReceived.max}`,
          );
        }
        if (stats.newLastSyncedTxDate) {
          console.log(
            `     Nuovo lastSyncedTxDate: ${stats.newLastSyncedTxDate.toISOString().slice(0, 10)}`,
          );
        }
        totalInserted += stats.txInserted;
        totalUpdated += stats.txUpdated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`   ✗ ERRORE: ${msg}`);
        errors.push(`${conn.bankAccount.name}: ${msg}`);
        // Marca la connection in error
        await prisma.bankConnection.update({
          where: { id: conn.id },
          data: { status: "error", errorMessage: msg },
        });
      }
      console.log();
    }

    console.log("═══════════════════════════════════════");
    console.log(
      `✓ Totale: ${totalInserted} inserite, ${totalUpdated} aggiornate`,
    );
    if (errors.length > 0) {
      console.log(`✗ ${errors.length} errori:`);
      errors.forEach((e) => console.log(`   ${e}`));
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("✗ ERRORE FATALE:", err);
  process.exit(1);
});
