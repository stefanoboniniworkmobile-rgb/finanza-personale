/**
 * Helper centralizzato per inviare email transazionali.
 *
 * In dev (RESEND_API_KEY non impostata): stampa il contenuto in console.
 * In prod: spedisce via Resend SMTP usando nodemailer.
 *
 * Centralizzato qui per non duplicare la logica in src/auth.ts e nelle
 * server actions di cambio email.
 */

const useResend = !!process.env.RESEND_API_KEY;

const FROM =
  process.env.EMAIL_FROM || "Finanza Personale <noreply@localhost>";

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendTransactionalEmail(
  payload: EmailPayload,
): Promise<void> {
  if (!useResend) {
    // Dev: stampa in console invece di spedire. Niente HTML, mostra solo
    // gli essenziali per copiare/incollare il link nei test.
    const linkMatch = payload.text.match(/https?:\/\/\S+/);
    console.log("\n========== EMAIL (DEV, non spedita) ==========");
    console.log(`A:       ${payload.to}`);
    console.log(`Oggetto: ${payload.subject}`);
    if (linkMatch) {
      console.log(`Link:    ${linkMatch[0]}`);
    }
    console.log("==============================================\n");
    return;
  }

  // Prod: spedisce via Resend SMTP
  const { createTransport } = await import("nodemailer");
  const transporter = createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: { user: "resend", pass: process.env.RESEND_API_KEY! },
  });

  await transporter.sendMail({
    from: FROM,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });
}
