"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { sendTransactionalEmail } from "@/lib/email-send";
import { buildEmailChangeConfirmEmail } from "@/lib/email-templates";

/**
 * Server actions per la pagina /impostazioni/account.
 *
 * Cambio email: doppio step con conferma sulla nuova mail.
 *   1. requestEmailChange(newEmail): valida, crea EmailChangeRequest con token
 *      random, manda email di conferma alla nuova address
 *   2. confirmEmailChange(token): valida token (esiste, non scaduto, non usato),
 *      UPDATE User.email, cancella tutte le Session, logout forzato globale
 *
 * Logout:
 *   - logoutCurrent: signOut della sessione corrente
 *   - logoutAll: cancella TUTTE le Session dell'utente (incluso il corrente)
 */

const EMAIL_CHANGE_EXPIRY_HOURS = 1;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: "Email non valida" });

export type RequestEmailChangeResult =
  | { ok: true; sentTo: string }
  | { ok: false; error: string };

/**
 * Avvia il cambio email: l'utente loggato inserisce la nuova email,
 * gli mandiamo un link di conferma sulla nuova address.
 */
export async function requestEmailChange(
  formData: FormData,
): Promise<RequestEmailChangeResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Non autenticato" };
  }
  const userId = session.user.id;

  const raw = String(formData.get("newEmail") ?? "");
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Email non valida" };
  }
  const newEmail = parsed.data;

  // Recupera l'email attuale per controlli
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!me) return { ok: false, error: "Utente non trovato" };

  if (me.email.toLowerCase() === newEmail) {
    return { ok: false, error: "La nuova email è uguale a quella attuale" };
  }

  // Verifica conflitto: non possiamo migrare a un'email già in uso
  const conflict = await prisma.user.findUnique({
    where: { email: newEmail },
    select: { id: true },
  });
  if (conflict) {
    return {
      ok: false,
      error:
        "Questa email è già associata a un altro account. Usa un'altra email o contatta l'assistenza.",
    };
  }

  // Pulisci eventuali richieste pendenti precedenti per evitare confusione
  await prisma.emailChangeRequest.deleteMany({
    where: { userId, used: false },
  });

  // Genera token sicuro (256 bit, hex)
  const token = randomBytes(32).toString("hex");
  const expires = new Date(
    Date.now() + EMAIL_CHANGE_EXPIRY_HOURS * 60 * 60 * 1000,
  );

  await prisma.emailChangeRequest.create({
    data: { userId, newEmail, token, expires },
  });

  // Costruisci URL di conferma. AUTH_URL è settato in env (es. http://localhost:3000).
  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const confirmUrl = `${baseUrl}/account/confirm-email-change?token=${encodeURIComponent(token)}`;

  let host: string | undefined;
  try {
    host = new URL(baseUrl).host;
  } catch {
    host = undefined;
  }

  // Manda l'email
  const tpl = buildEmailChangeConfirmEmail({
    url: confirmUrl,
    oldEmail: me.email,
    newEmail,
    host,
    expiryHours: EMAIL_CHANGE_EXPIRY_HOURS,
  });

  try {
    await sendTransactionalEmail({
      to: newEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  } catch (e) {
    console.error("✗ Failed to send email change confirmation:", e);
    return {
      ok: false,
      error:
        "Non sono riuscito a spedire l'email di conferma. Riprova tra qualche minuto.",
    };
  }

  return { ok: true, sentTo: newEmail };
}

/**
 * Conferma il cambio email a partire da un token valido.
 * Chiamato dalla pagina /account/confirm-email-change.
 *
 * Risultato esplicito (non throw) così la pagina può mostrare success/error.
 */
export type ConfirmEmailChangeResult =
  | {
      ok: true;
      oldEmail: string;
      newEmail: string;
    }
  | { ok: false; error: string };

export async function confirmEmailChange(
  token: string,
): Promise<ConfirmEmailChangeResult> {
  if (!token || token.length < 32) {
    return { ok: false, error: "Token mancante o malformato" };
  }

  const req = await prisma.emailChangeRequest.findUnique({
    where: { token },
    include: {
      user: { select: { id: true, email: true } },
    },
  });
  if (!req) return { ok: false, error: "Link non valido" };
  if (req.used) return { ok: false, error: "Link già usato" };
  if (req.expires < new Date()) return { ok: false, error: "Link scaduto" };

  // Doppio check sul conflitto: tra request e confirm potrebbe essere apparso
  // un altro User con la stessa newEmail (improbabile ma copriamo).
  const conflict = await prisma.user.findUnique({
    where: { email: req.newEmail },
    select: { id: true },
  });
  if (conflict && conflict.id !== req.userId) {
    return {
      ok: false,
      error: "Questa email è ora associata a un altro account",
    };
  }

  const oldEmail = req.user.email;
  const newEmail = req.newEmail;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: req.userId },
      data: { email: newEmail },
    });
    await tx.emailChangeRequest.update({
      where: { id: req.id },
      data: { used: true },
    });
    // Cancella TUTTE le Session: forza re-login con la nuova email su tutti
    // i dispositivi. Operazione di sicurezza standard dopo cambio identità.
    await tx.session.deleteMany({ where: { userId: req.userId } });
  });

  return { ok: true, oldEmail, newEmail };
}

/** Logout della sessione corrente. */
export async function logoutCurrent(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

/**
 * Logout da tutti i dispositivi.
 * Cancella tutte le Session dell'utente in DB e poi sloggia la corrente.
 */
export async function logoutAll(): Promise<void> {
  const session = await auth();
  if (session?.user?.id) {
    await prisma.session.deleteMany({ where: { userId: session.user.id } });
  }
  // signOut effettivo sulla corrente (cookie cleanup + redirect)
  await signOut({ redirectTo: "/login" });
}

/**
 * Cancella una singola sessione (utile per "termina questa sessione" da una
 * lista di sessioni attive).
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  // Safety: l'utente può cancellare SOLO le proprie sessioni
  const target = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });
  if (!target || target.userId !== session.user.id) {
    return; // silent fail per non leakare ID validità
  }

  await prisma.session.delete({ where: { id: sessionId } });
  revalidatePath("/impostazioni/account");
}

/** Annulla una richiesta di cambio email pendente. */
export async function cancelEmailChangeRequest(
  requestId: string,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const target = await prisma.emailChangeRequest.findUnique({
    where: { id: requestId },
    select: { userId: true },
  });
  if (!target || target.userId !== session.user.id) return;

  await prisma.emailChangeRequest.delete({ where: { id: requestId } });
  revalidatePath("/impostazioni/account");
}
