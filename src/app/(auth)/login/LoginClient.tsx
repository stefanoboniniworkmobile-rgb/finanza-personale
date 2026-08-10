"use client";

import { useState, useEffect, useRef } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

/**
 * Login — codice OTP via email (6 cifre).
 *
 * Perché il codice e non (solo) il magic link: su iPhone l'app installata in
 * home (PWA standalone) e Safari sono contenitori separati. Il link della mail
 * apre Safari, quindi il login non "attecchisce" sull'app. Digitando invece il
 * codice DENTRO l'app, la verifica avviene nello stesso contenitore e l'app
 * resta loggata. Il link resta come alternativa (utile da desktop/Safari).
 *
 * Flusso:
 *   1. stage "email": l'utente inserisce l'email → signIn(redirect:false) invia
 *      il codice e restiamo sulla pagina.
 *   2. stage "code": l'utente digita il codice → navighiamo (GET) alla callback
 *      di Auth.js `/api/auth/callback/nodemailer?token=CODICE&email=…`, che
 *      verifica e crea la sessione nel contenitore corrente.
 *
 * `?error=` è popolato da Auth.js quando la verifica fallisce (codice errato o
 * scaduto): lo mostriamo in cima al form.
 */

const RESEND_COOLDOWN_SEC = 30;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function LoginClient() {
  const t = useTranslations("auth");
  const params = useSearchParams();

  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [normEmail, setNormEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const codeInputRef = useRef<HTMLInputElement>(null);

  // Errore proveniente dalla callback (codice errato/scaduto).
  useEffect(() => {
    const err = params.get("error");
    if (err) setError(friendlyError(err));
  }, [params]);

  // Countdown per "rinvia".
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (stage === "code") codeInputRef.current?.focus();
  }, [stage]);

  async function sendCode(targetRaw: string) {
    const norm = normalizeEmail(targetRaw);
    if (!norm || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await signIn("nodemailer", {
        email: norm,
        redirect: false,
        callbackUrl: "/dashboard",
      });
      if (res?.error) {
        setError(friendlyError(res.error));
      } else {
        setNormEmail(norm);
        setStage("code");
        setCooldown(RESEND_COOLDOWN_SEC);
      }
    } catch {
      setError("Non sono riuscito a inviare il codice. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) {
      setError("Inserisci le 6 cifre del codice.");
      return;
    }
    setLoading(true);
    // Navigazione a pagina intera: la callback verifica il codice e imposta il
    // cookie di sessione nel contenitore corrente (quindi anche nella PWA).
    const qs = new URLSearchParams({
      token: clean,
      email: normEmail,
      callbackUrl: "/dashboard",
    });
    window.location.href = `/api/auth/callback/nodemailer?${qs.toString()}`;
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="panel w-full max-w-md p-8">
        <Logo />

        {stage === "email" ? (
          <EmailStage
            email={email}
            setEmail={setEmail}
            onSubmit={(e) => {
              e.preventDefault();
              sendCode(email);
            }}
            loading={loading}
            error={error}
            t={t}
          />
        ) : (
          <CodeStage
            email={normEmail}
            code={code}
            setCode={setCode}
            onSubmit={verifyCode}
            onBack={() => {
              setStage("email");
              setCode("");
              setError(null);
            }}
            onResend={() => sendCode(normEmail)}
            cooldown={cooldown}
            loading={loading}
            error={error}
            inputRef={codeInputRef}
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

function EmailStage({
  email,
  setEmail,
  onSubmit,
  loading,
  error,
  t,
}: {
  email: string;
  setEmail: (s: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  error: string | null;
  t: ReturnType<typeof useTranslations<"auth">>;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h1 className="text-xl font-semibold tracking-tight">
        {t("signinTitle")}
      </h1>
      <p className="text-xs text-[var(--sub)]">
        Inserisci la tua email: ti mandiamo un codice a 6 cifre da digitare qui.
      </p>

      {error && (
        <div
          role="alert"
          className="text-xs bg-[rgba(223,27,65,0.06)] border border-[rgba(223,27,65,0.2)] text-[var(--err)] rounded-md p-2.5"
        >
          {error}
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
        {loading ? "Invio in corso…" : "Inviami il codice"}
      </button>

      <p className="text-[11px] text-[var(--sub)] text-center pt-2">
        Niente password. Il codice vale 15 minuti.
      </p>
    </form>
  );
}

function CodeStage({
  email,
  code,
  setCode,
  onSubmit,
  onBack,
  onResend,
  cooldown,
  loading,
  error,
  inputRef,
}: {
  email: string;
  code: string;
  setCode: (s: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  onResend: () => void;
  cooldown: number;
  loading: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Inserisci il codice
        </h1>
        <p className="text-xs text-[var(--sub)] mt-1">
          Abbiamo inviato un codice a 6 cifre a{" "}
          <strong className="text-[var(--ink)]">{email}</strong>. Controlla anche
          Spam/Promozioni.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="text-xs bg-[rgba(223,27,65,0.06)] border border-[rgba(223,27,65,0.2)] text-[var(--err)] rounded-md p-2.5"
        >
          {error}
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={6}
        placeholder="••••••"
        className="input w-full !h-14 text-center num-mono tracking-[0.5em] text-2xl"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        disabled={loading}
      />

      <button
        type="submit"
        className="btn w-full !h-10 justify-center"
        disabled={loading || code.replace(/\D/g, "").length !== 6}
      >
        {loading ? "Verifica…" : "Entra"}
      </button>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-[var(--sub)] hover:text-[var(--ink)] underline"
        >
          Cambia email
        </button>
        <button
          type="button"
          onClick={onResend}
          disabled={cooldown > 0 || loading}
          className="btn-ghost !h-8 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cooldown > 0 ? `Rinvia tra ${cooldown}s` : "Rinvia codice"}
        </button>
      </div>

      <p className="text-[11px] text-[var(--sub)] text-center">
        Il codice vale 15 minuti e si usa una sola volta.
      </p>
    </form>
  );
}

/**
 * Auth.js error codes → messaggi friendly in italiano.
 * Codici da: https://authjs.dev/reference/core/errors
 */
function friendlyError(code: string): string {
  switch (code) {
    case "Verification":
      return "Codice errato o scaduto. Richiedine uno nuovo qui sotto.";
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
