import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { execSync } from "node:child_process";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n.ts");

/**
 * Versione automatica dell'app: formato `anno-mese-XXXXX`, dove XXXXX è il
 * progressivo assoluto dei commit git (`git rev-list --count HEAD`) su 5 cifre.
 *
 * Calcolata al momento del build: su Vercel il build parte a ogni deploy da
 * push su main, quindi anno/mese sono quelli del deploy e il contatore avanza
 * di pari passo con i commit pubblicati. Nessuno stato da mantenere a mano.
 *
 * Se git non è disponibile (build isolato senza history) il contatore degrada
 * a 00000 invece di rompere il build.
 */
function appVersion(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  let count = 0;
  try {
    count = parseInt(
      execSync("git rev-list --count HEAD", { encoding: "utf8" }).trim(),
      10,
    );
  } catch {
    count = 0;
  }
  const seq = String(Number.isFinite(count) ? count : 0).padStart(5, "0");
  const version = `${yyyy}-${mm}-${seq}`;
  // Visibile nei log di build Vercel: se `count` resta basso e costante tra
  // deploy, il clone è ancora shallow (serve `git fetch --unshallow`).
  console.log(`[version] commit count = ${count} → ${version}`);
  return version;
}

const nextConfig: NextConfig = {
  typedRoutes: false,
  env: {
    // Inlined nel bundle (server + client) al build.
    NEXT_PUBLIC_APP_VERSION: appVersion(),
  },
};

export default withNextIntl(nextConfig);
