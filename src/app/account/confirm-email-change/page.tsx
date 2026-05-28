import Link from "next/link";
import { confirmEmailChange } from "@/app/(app)/impostazioni/account/actions";

/**
 * Pagina target del link nella mail di conferma cambio email.
 *
 * Path: /account/confirm-email-change?token=...
 *
 * NB: questa pagina è FUORI dal gruppo (app), quindi non passa dal middleware
 * di auth (il middleware allow listava /api/auth, ora aggiungiamo anche
 * /account). Non serve essere loggati per confermare il cambio: il token
 * stesso è la credenziale.
 */

type PageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ConfirmEmailChangePage({
  searchParams,
}: PageProps) {
  const { token } = await searchParams;
  const result = token
    ? await confirmEmailChange(token)
    : ({ ok: false as const, error: "Token mancante" } as const);

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-[var(--bg)]">
      <div className="panel w-full max-w-md p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white font-bold text-2xl mx-auto mb-4">
          €
        </div>

        {result.ok ? (
          <>
            <div className="text-3xl mb-2">✓</div>
            <h1 className="text-xl font-semibold mb-2">
              Email aggiornata
            </h1>
            <p className="text-sm text-[var(--sub)] mb-1">
              La tua email di accesso è ora:
            </p>
            <p className="num-mono text-[var(--ink)] font-medium mb-4 break-all">
              {result.newEmail}
            </p>
            <p className="text-xs text-[var(--sub)] mb-5">
              Tutte le sessioni attive sono state chiuse. Accedi con la nuova
              email per continuare.
            </p>
            <Link href="/login" className="btn !h-10 inline-flex">
              Vai al login
            </Link>
          </>
        ) : (
          <>
            <div className="text-3xl mb-2 text-[var(--err)]">✕</div>
            <h1 className="text-xl font-semibold mb-2">
              Impossibile confermare
            </h1>
            <p className="text-sm text-[var(--sub)] mb-5">{result.error}</p>
            <p className="text-xs text-[var(--sub)] mb-5">
              Torna in Account &gt; Cambia email per richiedere un nuovo link.
            </p>
            <Link href="/login" className="btn-ghost !h-10 inline-flex">
              Vai al login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
