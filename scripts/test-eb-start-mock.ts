/**
 * Step 2 dello spike Enable Banking — avvia un flow di consenso per Mock ASPSP.
 *
 * Stampa l'URL dove andare ad autenticarsi. Tu lo apri in browser, fai login
 * con le credenziali mock fornite da Enable Banking (sono visibili nella pagina
 * di login stessa), e a fine flow Enable Banking ti reindirizza a
 * http://localhost:3000/api/psd2/callback?code=... — la route handler in app
 * riceve il code e mostra la sessione.
 *
 * PRE-REQ: `npm run dev` deve essere in esecuzione su localhost:3000 perché
 * il redirect finale possa atterrare sulla route handler.
 *
 * Uso:
 *   cd webapp
 *   npx tsx scripts/test-eb-start-mock.ts
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
  // Validità sessione: chiediamo 90 giorni (sotto il max 180gg, comodo per spike)
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 90);

  const res = await startAuth({
    aspsp: { name: "Mock ASPSP", country: "IT" },
    psu_type: "personal",
    redirect_url: "http://localhost:3000/api/psd2/callback",
    state: "spike-mock-test",
    valid_until: validUntil,
    access: { balances: true, transactions: true },
    language: "it",
  });

  console.log("\n✓ Auth session creata!");
  console.log("  authorization_id:", res.authorization_id);
  console.log(
    "\n👉 Apri questa URL nel browser e completa il consenso Mock:\n",
  );
  console.log(res.url);
  console.log(
    "\nAssicurati che `npm run dev` sia in esecuzione su localhost:3000",
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
