/**
 * Smoke test Enable Banking — chiama GET /aspsps?country=IT e stampa la lista.
 *
 * Verifica end-to-end che:
 *  - le env vars siano caricate
 *  - la private key sia leggibile
 *  - il JWT signing funzioni
 *  - la connettività verso api.tilisy.com sia OK
 *  - l'application sia attiva in sandbox
 *
 * Uso:
 *   cd webapp
 *   npx tsx scripts/test-eb-aspsps.ts
 *
 * Output atteso: una tabella con tutte le banche italiane integrate da Enable
 * Banking, con focus sui 4 conti di interesse (Credem, Mediolanum, ING, BBVA).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Carica .env.local manualmente (tsx non ha il loader automatico di Next.js).
function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    console.warn("⚠ .env.local non trovato a", path);
    return;
  }
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

// Import DOPO loadEnvLocal — il modulo legge process.env all'inizializzazione
import { listAspsps } from "../src/lib/psd2/enable-banking";

// I tuoi 5 conti. "credito emiliano" è il nome con cui Enable Banking
// elenca Credem (substring match "credem" non basta perché loro usano
// il nome legale completo).
// "satispay" aggiunto per verificare se EB ha integrato Satispay come ASPSP
// (Satispay è IMEL italiano regolamentato PSD2 — espone API PSD2 su
// openbanking.satispay.com, ma non è scontato che EB l'abbia mappata).
const TARGETS = ["credito emiliano", "mediolanum", "ing", "bbva", "satispay"];

async function main() {
  console.log("→ Chiamata GET /aspsps?country=IT in corso...\n");

  const aspsps = await listAspsps("IT");

  console.log(`✓ Ricevuti ${aspsps.length} ASPSP per l'Italia\n`);
  console.log("=== TUTTI GLI ASPSP IT ===");
  for (const a of aspsps) {
    const beta = a.beta ? " [BETA]" : "";
    const psu = a.psu_types?.join(",") ?? "?";
    const days = Math.round(a.maximum_consent_validity / 86400);
    console.log(
      `  • ${a.name.padEnd(40)} psu=${psu.padEnd(20)} consent=${days}gg${beta}`,
    );
  }

  console.log("\n=== MATCH SUI TUOI CONTI ===");
  for (const target of TARGETS) {
    const matches = aspsps.filter((a) =>
      a.name.toLowerCase().includes(target),
    );
    if (matches.length === 0) {
      console.log(`  ✗ ${target.toUpperCase()}: NESSUN MATCH`);
    } else {
      console.log(`  ✓ ${target.toUpperCase()}: ${matches.length} match`);
      for (const m of matches) {
        const days = Math.round(m.maximum_consent_validity / 86400);
        const psu = m.psu_types?.join(",") ?? "?";
        console.log(
          `      → name="${m.name}" country=${m.country} psu=${psu} consent=${days}gg`,
        );
        if (m.auth_methods && m.auth_methods.length > 0) {
          const methods = m.auth_methods
            .map((am) => `${am.name}(${am.approach}/${am.psu_type})`)
            .join(", ");
          console.log(`        auth_methods: ${methods}`);
        }
      }
    }
  }

  // Bonus: verifica eventuali Amex (atteso: nessuno per IT)
  const amex = aspsps.filter(
    (a) =>
      a.name.toLowerCase().includes("american express") ||
      a.name.toLowerCase().includes("amex"),
  );
  console.log("\n=== EVENTUALI AMEX (verifica) ===");
  if (amex.length === 0) {
    console.log("  ✗ Nessun ASPSP Amex per IT (atteso)");
  } else {
    for (const a of amex) {
      console.log(`  • ${a.name} (${a.country})`);
    }
  }
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
