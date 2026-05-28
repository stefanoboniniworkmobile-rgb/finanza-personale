import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { buildMagicLinkEmail } from "@/lib/email-templates";

/**
 * Auth.js (NextAuth v5) — configurazione.
 *
 * Provider: magic link via email (Nodemailer).
 *   - In dev (RESEND_API_KEY non impostata): il link viene stampato in console,
 *     niente email reale spedita. Tu lo copi e incolli nel browser.
 *   - In prod (RESEND_API_KEY impostata): il link viene spedito via Resend SMTP.
 *     Resend è gratuito fino a 3.000 email/mese.
 *
 * Storage: Prisma adapter (User/AuthAccount/Session/VerificationToken).
 * Strategy: database session (cookie httpOnly che referenzia Session in DB), 90 giorni.
 *
 * Perché magic link e non Google OAuth: scelta UX di Stefano. Non vogliamo
 * costringere l'utente a creare/avere un account Google per usare la app.
 * Magic link basta avere un'email — chiunque ne ha una.
 *
 * Primo accesso utente nuovo
 * --------------------------
 * Non serve un callback `events.createUser`: il primo Holder viene creato
 * lazy da `lib/holder.ts.getActiveHolder` alla prima query in dashboard,
 * usando il nome dell'utente se disponibile o la parte locale dell'email
 * come fallback.
 */
const useResend = !!process.env.RESEND_API_KEY;

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Sessione lunga: 90 giorni. Non devi reinserire la mail di continuo.
  session: { strategy: "database", maxAge: 90 * 24 * 60 * 60 },
  pages: { signIn: "/login", verifyRequest: "/login?check=1" },
  providers: [
    Nodemailer({
      from: process.env.EMAIL_FROM || "Finanza Personale <noreply@localhost>",
      // Provider Resend per produzione, fallback "jsonTransport" in dev (link in console)
      server: useResend
        ? {
            host: "smtp.resend.com",
            port: 465,
            auth: { user: "resend", pass: process.env.RESEND_API_KEY! },
          }
        : { jsonTransport: true },
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        // Estrae l'host dall'URL del callback (es. "finanza-personale.app").
        // Usato nel footer dell'email per orientare l'utente.
        let host: string | undefined;
        try {
          host = new URL(url).host;
        } catch {
          host = undefined;
        }

        const { subject, html, text } = buildMagicLinkEmail({
          url,
          to: identifier,
          host,
          expiryHours: 24,
        });

        if (!useResend) {
          // Dev: stampa il link in console al posto di inviare la mail.
          // Niente HTML rendering, copi il link e basta.
          console.log("\n========== MAGIC LINK ==========");
          console.log(`Per:     ${identifier}`);
          console.log(`Oggetto: ${subject}`);
          console.log(`Link:    ${url}`);
          console.log("================================\n");
          return;
        }

        // Prod: spedisce via Resend (configurato in provider.server).
        const { createTransport } = await import("nodemailer");
        const transporter = createTransport(
          provider.server as Parameters<typeof createTransport>[0],
        );
        await transporter.sendMail({
          to: identifier,
          from: provider.from as string,
          subject,
          text,
          html,
        });
      },
    }),
  ],
});
