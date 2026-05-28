/**
 * Avvia un consent flow PSD2 su una banca production reale.
 *
 * Pre-req:
 *   - npm run dev:https deve girare su https://localhost:3000
 *   - L'app Enable Banking deve essere "Active (restricted)" con il conto
 *     della banca target già linkato (whitelistato) dal CP
 *
 * Uso:
 *   cd webapp
 *   npx tsx scripts/test-eb-start-prod.ts                 # default: Banca Mediolanum
 *   npx tsx scripts/test-eb-start-prod.ts "ING"
 *   npx tsx scripts/test-eb-start-prod.ts "Credito Emiliano"
 *   npx tsx scripts/test-eb-start-prod.ts "BBVA"
 *
 * Lo script stampa una URL: aprila nel browser, completa l'SCA della tua
 * banca, e a fine flow verrai rispedito a https://localhost:3000/api/psd2/callback
 * dove la nostra route handler mostrerà session_id + lista account.
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

import { startAuth } from "../src/lib/psd2/enable-banking";

async function main() {
  const aspspName = process.argv[2] ?? "Banca Mediolanum";

  // Validità sessione: 179 giorni (sotto il max 180gg = 15552000s).
  // NB: non uso `setDate(+180)` perché il passaggio DST nel range introduce
  // ±3600s rispetto a 180gg "assoluti" e l'API rifiuta con 422 se sfori
  // anche di un secondo. 179gg dà margine di sicurezza in qualunque stagione.
  const validUntil = new Date(Date.now() + 179 * 24 * 60 * 60 * 1000);

  console.log(`→ Avvio consent flow per "${aspspName}" (IT)...`);

  const res = await startAuth({
    aspsp: { name: aspspName, country: "IT" },
    psu_type: "personal",
    redirect_url: "https://localhost:3000/api/psd2/callback",
    state: `prod-${aspspName.toLowerCase().replace(/\s+/g, "-")}`,
    valid_until: validUntil,
    access: { balances: true, transactions: true },
    language: "it",
  });

  console.log("\n✓ Auth session creata!");
  console.log("  authorization_id:", res.authorization_id);
  console.log("\n👉 Apri questa URL nel browser e completa SCA:\n");
  console.log(res.url);
  console.log(
    "\nAssicurati che `npm run dev:https` sia attivo su https://localhost:3000",
  );
  console.log(
    "(la route /api/psd2/callback intercetta il redirect finale).\n",
  );
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
