/**
 * Scarica le transazioni di un conto via Enable Banking.
 *
 * IMPORTANTE: la cronologia massima (`strategy=longest`, 1-3 anni a discrezione
 * della banca) è disponibile SOLO entro 1 ORA dall'authorization iniziale.
 * Dopo, l'API limita a ~90 giorni indietro. Quindi lanciare subito dopo
 * il consent flow.
 *
 * Uso:
 *   cd webapp
 *   npx tsx scripts/test-eb-tx.ts <account_uid>
 *   npx tsx scripts/test-eb-tx.ts f5dca79a-b957-42ab-97ce-e5b9694fa496
 *
 * Stampa un riepilogo + salva il JSON completo in /tmp/eb-tx-<uid>.json
 * per ispezione e per il prossimo step (mapping a Transaction).
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

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

import { listTransactions, type Transaction } from "../src/lib/psd2/enable-banking";

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error("✗ ERRORE: serve account_uid come argomento.");
    console.error("  Uso: npx tsx scripts/test-eb-tx.ts <account_uid>");
    process.exit(1);
  }

  console.log(`→ Fetch transazioni per account ${accountId}`);
  console.log("  strategy=longest (max storico, valido entro 1h dall'auth)\n");

  const all: Transaction[] = [];
  let continuationKey: string | undefined = undefined;
  let page = 0;
  const t0 = Date.now();

  do {
    page++;
    process.stdout.write(`  → pagina ${page}... `);
    const res = await listTransactions(accountId, {
      strategy: "longest",
      continuationKey,
      // PSU headers: indichiamo presenza utente per evitare rate limit "background"
      psuHeaders: {
        "PSU-IP-Address": "127.0.0.1",
        "PSU-User-Agent": "Mozilla/5.0 (Finanza Personale spike)",
      },
    });
    all.push(...res.transactions);
    continuationKey = res.continuation_key ?? undefined;
    console.log(
      `${res.transactions.length} tx${continuationKey ? " (continua)" : " (fine)"}`,
    );
  } while (continuationKey);

  const elapsedMs = Date.now() - t0;

  console.log(`\n✓ Scaricate ${all.length} transazioni in ${elapsedMs}ms`);

  if (all.length === 0) {
    console.log("\n⚠ Nessuna transazione ricevuta. Possibili cause:");
    console.log("  - Conto vuoto / senza movimenti nell'orizzonte richiesto");
    console.log("  - Banca non espone storico via PSD2 (raro)");
    console.log("  - Session scaduta o accountId errato");
    process.exit(0);
  }

  // Estrai range date
  const dates = all
    .map((t) => t.booking_date ?? t.value_date ?? t.transaction_date)
    .filter((d): d is string => !!d)
    .sort();
  const dateMin = dates[0];
  const dateMax = dates[dates.length - 1];

  console.log(`  Range date: ${dateMin} → ${dateMax}`);

  // Conteggio credit vs debit
  const credit = all.filter((t) => t.credit_debit_indicator === "CRDT").length;
  const debit = all.filter((t) => t.credit_debit_indicator === "DBIT").length;
  console.log(`  Credit (entrate): ${credit}    Debit (uscite): ${debit}`);

  // Conteggio per status
  const byStatus = all.reduce<Record<string, number>>((acc, t) => {
    const s = t.status ?? "UNKNOWN";
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `  Per status: ${Object.entries(byStatus)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
  );

  // Prime 3 + ultime 3 (per data booking)
  const sortedByDate = [...all].sort((a, b) => {
    const da = a.booking_date ?? a.value_date ?? "";
    const db = b.booking_date ?? b.value_date ?? "";
    return da.localeCompare(db);
  });

  function fmtTx(t: Transaction): string {
    const d = t.booking_date ?? t.value_date ?? "?";
    const sign = t.credit_debit_indicator === "DBIT" ? "-" : "+";
    const amt = t.transaction_amount?.amount ?? "?";
    const cur = t.transaction_amount?.currency ?? "";
    const desc =
      t.remittance_information_unstructured ??
      t.remittance_information?.join(" ") ??
      t.bank_transaction_code?.description ??
      "";
    return `  ${d}  ${sign}${amt} ${cur}  ${desc.slice(0, 80)}`;
  }

  console.log(`\n=== Prime 3 transazioni ===`);
  sortedByDate.slice(0, 3).forEach((t) => console.log(fmtTx(t)));
  console.log(`\n=== Ultime 3 transazioni ===`);
  sortedByDate.slice(-3).forEach((t) => console.log(fmtTx(t)));

  // Salva il dump completo per ispezione
  const outPath = resolve(tmpdir(), `eb-tx-${accountId}.json`);
  writeFileSync(outPath, JSON.stringify(all, null, 2), "utf-8");
  console.log(`\n📝 Dump completo salvato in: ${outPath}`);
}

main().catch((err) => {
  console.error("✗ ERRORE:", err);
  if (err && typeof err === "object" && "status" in err) {
    console.error("  HTTP status:", (err as { status: number }).status);
    if ("body" in err)
      console.error(
        "  Body:",
        JSON.stringify((err as { body: unknown }).body, null, 2),
      );
  }
  process.exit(1);
});
