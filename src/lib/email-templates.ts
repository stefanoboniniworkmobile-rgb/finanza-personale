/**
 * Template HTML per email transazionali della webapp.
 *
 * Best practice rispettate:
 *  - layout table-based (Outlook e altri client legacy stripano flexbox/grid)
 *  - tutti gli stili inline (alcuni client rimuovono <style> in <head>)
 *  - max-width 600px (standard email)
 *  - preheader nascosto (testo che appare nella anteprima della casella)
 *  - versione plain-text di fallback per client che non renderizzano HTML
 *
 * Niente immagini esterne: il logo è un riquadro CSS con il carattere €.
 * Se serviranno asset, vanno hostati su CDN raggiungibile (no localhost in prod).
 */

const BRAND = {
  name: "Finanza Personale",
  // Palette coerente con globals.css
  ink: "#0a2540",
  sub: "#697386",
  line: "#e3e8ee",
  bg: "#f6f9fc",
  brandStart: "#6366f1", // indigo-500
  brandEnd: "#a855f7", // purple-500
};

export type MagicLinkTemplate = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Costruisce la versione HTML + text del magic link di accesso.
 * Il link è già pre-firmato da Auth.js, qui lo presentiamo all'utente.
 */
export function buildMagicLinkEmail(args: {
  url: string;
  to: string;
  host?: string; // dominio della webapp (es. "finanza-personale.app")
  expiryHours?: number; // default 24h, allineato con Auth.js
}): MagicLinkTemplate {
  const { url, to, host, expiryHours = 24 } = args;
  const safeHost = host ?? "Finanza Personale";

  const subject = `Accedi a ${BRAND.name}`;
  const preheader = `Apri questo link per entrare in ${BRAND.name}. Scade tra ${expiryHours} ore.`;

  // Plain-text fallback: leggibile, niente HTML, link nudo (i client mobili
  // mostrano comunque il link cliccabile).
  const text = [
    `Ciao,`,
    ``,
    `clicca questo link per accedere a ${BRAND.name}:`,
    url,
    ``,
    `Il link è valido per ${expiryHours} ore e può essere usato una sola volta.`,
    `Se non sei stato tu a richiederlo, ignora questa email.`,
    ``,
    `— ${BRAND.name}`,
    safeHost,
  ].join("\n");

  // HTML: table-based layout, inline styles, dark-mode tolerant.
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${BRAND.ink};">

<!-- preheader: testo nascosto che appare nell'anteprima della casella -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">
${escapeHtml(preheader)}
</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.bg};">
  <tr>
    <td align="center" style="padding:40px 16px;">

      <!-- Container -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.line};border-radius:12px;overflow:hidden;">

        <!-- Header con logo -->
        <tr>
          <td style="padding:32px 32px 16px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:12px;">
                  <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,${BRAND.brandStart},${BRAND.brandEnd});color:#ffffff;font-weight:700;font-size:22px;line-height:40px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                    €
                  </div>
                </td>
                <td valign="middle">
                  <div style="font-size:15px;font-weight:600;color:${BRAND.ink};line-height:1.2;">
                    ${escapeHtml(BRAND.name)}
                  </div>
                  <div style="font-size:12px;color:${BRAND.sub};margin-top:2px;">
                    Il tuo budget, sempre sotto controllo
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Corpo -->
        <tr>
          <td style="padding:8px 32px 8px 32px;">
            <h1 style="font-size:22px;font-weight:700;color:${BRAND.ink};margin:16px 0 12px 0;letter-spacing:-0.01em;">
              Accedi al tuo account
            </h1>
            <p style="font-size:14px;line-height:1.55;color:${BRAND.sub};margin:0 0 20px 0;">
              Hai richiesto un link di accesso per <strong style="color:${BRAND.ink};">${escapeHtml(to)}</strong>. Clicca il pulsante qui sotto per entrare. Il link è valido per <strong>${expiryHours} ore</strong> e può essere usato una sola volta.
            </p>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding:8px 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background:linear-gradient(135deg,${BRAND.brandStart},${BRAND.brandEnd});border-radius:8px;">
                  <a href="${escapeAttr(url)}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#ffffff !important;text-decoration:none;line-height:1;">
                    Accedi a ${escapeHtml(BRAND.name)}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Fallback link -->
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <p style="font-size:12px;color:${BRAND.sub};margin:0 0 6px 0;">
              Se il pulsante non funziona, copia e incolla questo link nel browser:
            </p>
            <p style="font-size:12px;line-height:1.4;color:${BRAND.ink};margin:0;word-break:break-all;">
              <a href="${escapeAttr(url)}" style="color:${BRAND.brandStart};text-decoration:underline;">${escapeHtml(url)}</a>
            </p>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 32px;">
            <div style="border-top:1px solid ${BRAND.line};font-size:0;line-height:0;">&nbsp;</div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px 28px 32px;">
            <p style="font-size:12px;line-height:1.55;color:${BRAND.sub};margin:0;">
              Non sei stato tu a richiedere questo accesso? Puoi tranquillamente ignorare questa email — senza il link, nessuno può entrare nel tuo account.
            </p>
          </td>
        </tr>

      </table>

      <!-- Footer fuori container -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin-top:16px;">
        <tr>
          <td align="center" style="font-size:11px;color:${BRAND.sub};line-height:1.5;">
            © ${new Date().getFullYear()} ${escapeHtml(BRAND.name)} · ${escapeHtml(safeHost)}
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>

</body>
</html>`;

  return { subject, html, text };
}

/**
 * Email di conferma per il cambio dell'indirizzo email dell'account.
 * Mandata alla NUOVA email; clic sul link conferma e aggiorna User.email.
 */
export function buildEmailChangeConfirmEmail(args: {
  url: string;
  oldEmail: string;
  newEmail: string;
  host?: string;
  expiryHours?: number;
}): MagicLinkTemplate {
  const { url, oldEmail, newEmail, host, expiryHours = 1 } = args;
  const safeHost = host ?? "Finanza Personale";

  const subject = `Conferma il nuovo indirizzo email per ${BRAND.name}`;
  const preheader = `Conferma l'email ${newEmail} per ${BRAND.name}. Link valido ${expiryHours} ora.`;

  const text = [
    `Ciao,`,
    ``,
    `qualcuno (presumibilmente tu) ha richiesto di cambiare l'email`,
    `di accesso a ${BRAND.name} da:`,
    `  ${oldEmail}`,
    `a:`,
    `  ${newEmail}`,
    ``,
    `Conferma cliccando questo link:`,
    url,
    ``,
    `Il link è valido per ${expiryHours} ora e può essere usato una sola volta.`,
    `Dopo la conferma tutte le sessioni attive verranno disconnesse e dovrai`,
    `riaccedere con la nuova email.`,
    ``,
    `Se non sei stato tu, IGNORA questa email. Il cambio non avverrà.`,
    ``,
    `— ${BRAND.name}`,
    safeHost,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${BRAND.ink};">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">
${escapeHtml(preheader)}
</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.bg};">
  <tr>
    <td align="center" style="padding:40px 16px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.line};border-radius:12px;overflow:hidden;">

        <tr>
          <td style="padding:32px 32px 16px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:12px;">
                  <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,${BRAND.brandStart},${BRAND.brandEnd});color:#ffffff;font-weight:700;font-size:22px;line-height:40px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                    €
                  </div>
                </td>
                <td valign="middle">
                  <div style="font-size:15px;font-weight:600;color:${BRAND.ink};line-height:1.2;">
                    ${escapeHtml(BRAND.name)}
                  </div>
                  <div style="font-size:12px;color:${BRAND.sub};margin-top:2px;">
                    Conferma cambio email
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:8px 32px 8px 32px;">
            <h1 style="font-size:22px;font-weight:700;color:${BRAND.ink};margin:16px 0 12px 0;letter-spacing:-0.01em;">
              Conferma il nuovo indirizzo
            </h1>
            <p style="font-size:14px;line-height:1.55;color:${BRAND.sub};margin:0 0 16px 0;">
              Qualcuno ha richiesto di cambiare l'email di accesso al tuo account ${escapeHtml(BRAND.name)}:
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.bg};border:1px solid ${BRAND.line};border-radius:8px;margin:0 0 20px 0;">
              <tr>
                <td style="padding:12px 16px;font-size:13px;color:${BRAND.sub};">
                  <div style="margin-bottom:6px;">Da: <span style="color:${BRAND.ink};font-family:'JetBrains Mono',ui-monospace,monospace;">${escapeHtml(oldEmail)}</span></div>
                  <div>A: <span style="color:${BRAND.ink};font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:600;">${escapeHtml(newEmail)}</span></div>
                </td>
              </tr>
            </table>
            <p style="font-size:14px;line-height:1.55;color:${BRAND.sub};margin:0 0 20px 0;">
              Per confermare, clicca il pulsante qui sotto. Il link è valido per <strong>${expiryHours} ora</strong>. Dopo la conferma tutte le sessioni attive verranno disconnesse.
            </p>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:8px 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background:linear-gradient(135deg,${BRAND.brandStart},${BRAND.brandEnd});border-radius:8px;">
                  <a href="${escapeAttr(url)}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#ffffff !important;text-decoration:none;line-height:1;">
                    Conferma il cambio email
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px 24px 32px;">
            <p style="font-size:12px;color:${BRAND.sub};margin:0 0 6px 0;">
              Se il pulsante non funziona, copia e incolla questo link nel browser:
            </p>
            <p style="font-size:12px;line-height:1.4;color:${BRAND.ink};margin:0;word-break:break-all;">
              <a href="${escapeAttr(url)}" style="color:${BRAND.brandStart};text-decoration:underline;">${escapeHtml(url)}</a>
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px;">
            <div style="border-top:1px solid ${BRAND.line};font-size:0;line-height:0;">&nbsp;</div>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 32px 28px 32px;">
            <p style="font-size:12px;line-height:1.55;color:${BRAND.sub};margin:0;">
              Non sei stato tu a richiedere il cambio? Ignora questa email. Nessuna modifica avverrà finché il link non viene cliccato.
            </p>
          </td>
        </tr>

      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin-top:16px;">
        <tr>
          <td align="center" style="font-size:11px;color:${BRAND.sub};line-height:1.5;">
            © ${new Date().getFullYear()} ${escapeHtml(BRAND.name)} · ${escapeHtml(safeHost)}
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>

</body>
</html>`;

  return { subject, html, text };
}

/** Escape minimo per content HTML (testo dentro tag). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape per attributi HTML (href, ecc.). */
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
