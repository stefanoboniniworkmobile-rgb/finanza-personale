"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

/**
 * Login page — magic link via email.
 *
 * Stati UI:
 *   1. form: l'utente inserisce email e clicca Accedi
 *   2. sent: dopo l'invio Auth.js redirige a /login?check=1 (verifyRequest);
 *      mostriamo dove abbiamo mandato l'email + bottone "rinvia" con cooldown
 *   3. error: ?error=... popolato da Auth.js quando qualcosa va storto
 *
 * L'email tra step 1 → step 2 viene preservata in sessionStorage (chiave
 * `fp_login_email`). sessionStorage persiste tra reload nella stessa tab,
 * ma si pulisce alla chiusura del browser — è l'ideale per dato volatile
 * come questo. Se l'utente apre il link da un'altra tab/dispositivo non
 * vedrà l'email, ma l'esperienza degrada in modo gradevole.
 *
 * Auth.js mappa gli errori a code stringhe (es. "Verification", "EmailSignin",
 * "AccessDenied"). Convertiamo i più comuni in messaggi friendly.
 */

const RESEND_COOLDOWN_SEC = 30;
const STORAGE_KEY = "fp_login_email";

export function LoginClient() {
  const t = useTranslations("auth");
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [storedEmail, setStoredEmail] = useState<string | null>(null);

  const sent = params.get("check") === "1";
  const errorCode = params.get("error");

  // Al mount in stato `sent`, recupera l'email salvata prima del signIn
  useEffect(() => {
    if (sent && typeof window !== "undefined") {
      const v = sessionStorage.getItem(STORAGE_KEY);
      if (v) setStoredEmail(v);
    }
  }, [sent]);

  // Cooldown countdown per il bottone "rinvia"
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function submit(targetEmail: string) {
    if (!targetEmail || loading || cooldown > 0) return;
    setLoading(true);
    try {
      // Salva l'email per riconoscerla post-redirect a verifyRequest
      sessionStorage.setItem(STORAGE_KEY, targetEmail);
      await signIn("nodemailer", {
        email: targetEmail,
        callbackUrl: "/dashboard",
      });
    } finally {
      // Se Auth.js fa il redirect (caso normale) questo finally non viene
      // eseguito perché il document cambia URL. È un cleanup per il caso di
      // errore inline.
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit(email);
  }

  async function onResend() {
    if (!storedEmail) return;
    setCooldown(RESEND_COOLDOWN_SEC);
    setLoading(true);
    try {
      await signIn("nodemailer", {
        email: storedEmail,
        callbackUrl: "/dashboard",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="panel w-full max-w-md p-8">
        <Logo />

        {sent ? (
          <SentState
            email={storedEmail}
            onResend={onResend}
            cooldown={cooldown}
            loading={loading}
            t={t}
          />
        ) : (
          <FormState
            email={email}
            setEmail={setEmail}
            onSubmit={onSubmit}
            loading={loading}
            errorCode={errorCode}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white font-bold">
        €
      </div>
      <div>
        <div className="font-bold">Finanza Personale</div>
        <div className="text-xs text-[var(--sub)]">
          Il tuo budget, sempre sotto controllo
        </div>
      </div>
    </div>
  );
}

function FormState({
  email,
  setEmail,
  onSubmit,
  loading,
  errorCode,
  t,
}: {
  email: string;
  setEmail: (s: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  errorCode: string | null;
  t: ReturnType<typeof useTranslations<"auth">>;
}) {
  const errorMsg = errorCode ? friendlyError(errorCode) : null;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h1 className="text-xl font-semibold tracking-tight">
        {t("signinTitle")}
      </h1>
      <p className="text-xs text-[var(--sub)]">{t("signinSubtitle")}</p>

      {errorMsg && (
        <div
          role="alert"
          className="text-xs bg-[rgba(223,27,65,0.06)] border border-[rgba(223,27,65,0.2)] text-[var(--err)] rounded-md p-2.5"
        >
          {errorMsg}
        </div>
      )}

      <label className="block">
        <span className="text-xs font-medium text-[var(--sub)]">Email</span>
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          inputMode="email"
          placeholder={t("emailPlaceholder")}
          className="input w-full mt-1 !h-10"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
      </label>
      <button
        type="submit"
        className="btn w-full !h-10 justify-center"
        disabled={loading || !email}
      >
        {loading ? "Invio in corso…" : t("signin")}
      </button>

      <p className="text-[11px] text-[var(--sub)] text-center pt-2">
        Niente password. Ti mandiamo un link via email che vale 24 ore.
      </p>
    </form>
  );
}

function SentState({
  email,
  onResend,
  cooldown,
  loading,
  t,
}: {
  email: string | null;
  onResend: () => void;
  cooldown: number;
  loading: boolean;
  t: ReturnType<typeof useTranslations<"auth">>;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-[var(--bg)] border border-[var(--line)] rounded-lg p-5 text-sm">
        <div className="text-2xl mb-2">📬</div>
        <div className="font-semibold mb-1">{t("magicLinkSent")}</div>
        {email ? (
          <>
            <div className="text-[var(--sub)] mb-3">
              Ti abbiamo mandato un link a:
            </div>
            <div className="num-mono text-[var(--ink)] bg-white border border-[var(--line)] rounded-md px-3 py-2 text-[13px] break-all">
              {email}
            </div>
          </>
        ) : (
          <div className="text-[var(--sub)]">
            {t("magicLinkInstructions")}
          </div>
        )}
        <div className="text-[11px] text-[var(--sub)] mt-3 leading-relaxed">
          Apri la casella e clicca il pulsante <strong>Accedi</strong>. Il link
          è valido per 24 ore.
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <a
          href="/login"
          className="text-xs text-[var(--sub)] hover:text-[var(--ink)] underline"
        >
          Cambia email
        </a>
        {email && (
          <button
            type="button"
            onClick={onResend}
            disabled={cooldown > 0 || loading}
            className="btn-ghost !h-8 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Invio…"
              : cooldown > 0
                ? `Rinvia tra ${cooldown}s`
                : "Non l'hai ricevuto? Rinvia"}
          </button>
        )}
      </div>

      <details className="text-[11px] text-[var(--sub)] mt-2">
        <summary className="cursor-pointer hover:text-[var(--ink)]">
          Non vedi l&apos;email?
        </summary>
        <ul className="mt-2 ml-4 space-y-1 list-disc">
          <li>Controlla la cartella Spam o Promozioni</li>
          <li>Aspetta qualche secondo, a volte ci mette un po&apos;</li>
          {email && (
            <li>
              Verifica che <strong>{email}</strong> sia corretta — usa &quot;Cambia
              email&quot; se hai sbagliato
            </li>
          )}
          <li>Il link precedente potrebbe essere ancora valido</li>
        </ul>
      </details>
    </div>
  );
}

/**
 * Auth.js error codes → messaggi friendly in italiano.
 * Codici da: https://authjs.dev/reference/core/errors
 */
function friendlyError(code: string): string {
  switch (code) {
    case "Verification":
      return "Il link è scaduto o è già stato usato. Richiedi un nuovo link qui sotto.";
    case "EmailSignin":
      return "Non sono riuscito a inviare l'email. Controlla l'indirizzo e riprova.";
    case "AccessDenied":
      return "Accesso non consentito per questa email.";
    case "Configuration":
      return "Errore di configurazione del server. Riprova tra qualche minuto.";
    default:
      return `Accesso non riuscito (${code}). Riprova o contattaci.`;
  }
}
