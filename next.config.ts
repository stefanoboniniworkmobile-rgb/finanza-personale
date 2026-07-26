import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { execSync } from "node:child_process";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n.ts");

/**
 * Versione automatica: `anno-mese-XXXXX`, con XXXXX = progressivo assoluto dei
 * commit su 5 cifre.
 *
 * Il conteggio si prende così:
 *  - in locale → `git rev-list --count HEAD` (history completa).
 *  - su Vercel → l'API GitHub, perché Vercel clona in modo SHALLOW e il git
 *    count sarebbe troncato (restava fermo a ~10). Misurato: l'header `Link`
 *    di /commits?per_page=1 dà il numero di pagine = numero di commit.
 *
 * Fallback a catena: se una fonte non risponde, si usa l'altra; in ultima
 * istanza 0, senza mai rompere il build.
 */
function gitCount(): number {
  try {
    return parseInt(
      execSync("git rev-list --count HEAD", { encoding: "utf8" }).trim(),
      10,
    );
  } catch {
    return 0;
  }
}

async function githubCommitCount(): Promise<number | null> {
  const owner = process.env.VERCEL_GIT_REPO_OWNER || "stefanoboniniworkmobile-rgb";
  const repo = process.env.VERCEL_GIT_REPO_SLUG || "finanza-personale";
  const branch = process.env.VERCEL_GIT_COMMIT_REF || "main";
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=1`,
      {
        headers: {
          "User-Agent": "finanza-personale-build",
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!res.ok) return null;
    const link = res.headers.get("link");
    if (!link) return null;
    const m = link.match(/\bpage=(\d+)>;\s*rel="last"/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

async function appVersion(): Promise<string> {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");

  let count = gitCount();
  let source = "git";
  // Su Vercel il git count è troncato dal clone shallow: preferisci l'API.
  if (process.env.VERCEL) {
    const apiCount = await githubCommitCount();
    if (apiCount && apiCount >= count) {
      count = apiCount;
      source = "github-api";
    }
  }

  const seq = String(Number.isFinite(count) ? count : 0).padStart(5, "0");
  const version = `${yyyy}-${mm}-${seq}`;
  console.log(`[version] commit count = ${count} (${source}) → ${version}`);
  return version;
}

export default async function config(): Promise<NextConfig> {
  const version = await appVersion();
  return withNextIntl({
    typedRoutes: false,
    env: {
      // Inlined nel bundle (server + client) al build.
      NEXT_PUBLIC_APP_VERSION: version,
    },
  });
}
