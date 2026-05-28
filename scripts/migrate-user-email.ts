/**
 * Migrazione email User: cambia l'email primaria di un User esistente.
 *
 * Contesto
 * --------
 * Con magic link, Auth.js identifica l'utente per email. Quando ti loggi
 * mettendo `stefano.bonini@rocketmail.com`, Auth.js cerca un User con quella
 * email. Se non lo trova, ne crea uno nuovo (con tutti i tuoi dati spariti
 * dalla vista, perché legati all'User vecchio con email diversa).
 *
 * Per cambiare la mail di accesso preservando dati, bisogna UPDATE
 * dell'User.email PRIMA di tentare il login con la nuova email.
 *
 * Lo script:
 *   1. trova l'User con la vecchia email (FROM_EMAIL)
 *   2. controlla che non esista già un User con la nuova email (TO_EMAIL)
 *   3. fa UPDATE User SET email = TO_EMAIL
 *   4. cancella Session attive di quell'User (forza re-login pulito)
 *   5. cancella eventuali VerificationToken pendenti per FROM_EMAIL
 *
 * Idempotente: se l'User con TO_EMAIL esiste già, non rompe niente.
 *
 * Uso:
 *   cd webapp
 *   npx tsx scripts/migrate-user-email.ts
 *
 * Per cambiare le email, modifica le costanti FROM_EMAIL e TO_EMAIL sotto.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Carica .env (tsx non ha il loader automatico di Next.js).
function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
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
}
loadEnv();

// Import DOPO loadEnv — Prisma legge DATABASE_URL all'inizializzazione
import { PrismaClient } from "@prisma/client";

const FROM_EMAIL = "stefano.bonini@fortlan-dibi.it";
const TO_EMAIL = "stefano.bonini@rocketmail.com";

async function main() {
  const prisma = new PrismaClient();

  console.log(`→ Migrazione email: ${FROM_EMAIL}  →  ${TO_EMAIL}\n`);

  const oldUser = await prisma.user.findUnique({
    where: { email: FROM_EMAIL },
    select: {
      id: true,
      email: true,
      name: true,
      _count: {
        select: {
          holders: true,
          accounts: true,
          sessions: true,
        },
      },
    },
  });

  if (!oldUser) {
    // L'utente con la vecchia email NON esiste. O era già stato migrato,
    // o l'email è sbagliata. Controlliamo se esiste con la nuova.
    const already = await prisma.user.findUnique({
      where: { email: TO_EMAIL },
      select: { id: true, email: true },
    });
    if (already) {
      console.log(
        `✓ Idempotente: utente con email ${TO_EMAIL} esiste già (id=${already.id}).`,
      );
      console.log("  Niente da fare.");
      await prisma.$disconnect();
      return;
    }
    console.error(`✗ Nessun User trovato con email ${FROM_EMAIL}.`);
    console.error(`  E nessuno con ${TO_EMAIL}.`);
    console.error("  Controlla che le costanti FROM_EMAIL/TO_EMAIL siano giuste.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`User trovato:`);
  console.log(`  id: ${oldUser.id}`);
  console.log(`  email: ${oldUser.email}`);
  console.log(`  name: ${oldUser.name ?? "(null)"}`);
  console.log(`  holders: ${oldUser._count.holders}`);
  console.log(`  AuthAccount linkati: ${oldUser._count.accounts}`);
  console.log(`  sessioni attive: ${oldUser._count.sessions}\n`);

  // Sicurezza: non sovrascrivere un User esistente con TO_EMAIL.
  const conflict = await prisma.user.findUnique({
    where: { email: TO_EMAIL },
    select: { id: true },
  });
  if (conflict) {
    console.error(
      `✗ Esiste già un User con email ${TO_EMAIL} (id=${conflict.id}).`,
    );
    console.error("  Non aggiorno per non rompere FK. Risolvi manualmente.");
    await prisma.$disconnect();
    process.exit(1);
  }

  // Update + cleanup in transazione
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: oldUser.id },
      data: { email: TO_EMAIL },
      select: { id: true, email: true },
    });
    const deletedSessions = await tx.session.deleteMany({
      where: { userId: oldUser.id },
    });
    // VerificationToken non ha FK a User: chiaviamo via identifier (vecchia email)
    const deletedTokens = await tx.verificationToken.deleteMany({
      where: { identifier: FROM_EMAIL },
    });
    return { updated, deletedSessions, deletedTokens };
  });

  console.log(`✓ User aggiornato:`);
  console.log(`  id: ${result.updated.id}`);
  console.log(`  email: ${result.updated.email}`);
  console.log(`  sessioni cancellate: ${result.deletedSessions.count}`);
  console.log(`  token magic-link cancellati: ${result.deletedTokens.count}`);
  console.log("");
  console.log("Prossimo passo:");
  console.log(`  1. Riavvia il dev server (npm run dev oppure dev:https)`);
  console.log(`  2. Apri /login`);
  console.log(`  3. Inserisci ${TO_EMAIL}`);
  console.log(`  4. Copia il magic link dalla console del server`);
  console.log(`  5. Aprilo nel browser → entri in /dashboard con tutti i tuoi dati`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("✗ ERRORE:", err);
  process.exit(1);
});
