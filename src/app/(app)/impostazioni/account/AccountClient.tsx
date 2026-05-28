"use client";

import { useState, useTransition } from "react";
import {
  requestEmailChange,
  cancelEmailChangeRequest,
  logoutCurrent,
  logoutAll,
  revokeSession,
} from "./actions";

type UserInfo = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  createdAt: string;
};

type SessionInfo = {
  id: string;
  expiresIso: string;
  isCurrent: boolean;
};

type PendingChange = {
  id: string;
  newEmail: string;
  expiresIso: string;
  createdAtIso: string;
};

export default function AccountClient({
  user,
  sessions,
  pendingChange,
}: {
  user: UserInfo;
  sessions: SessionInfo[];
  pendingChange: PendingChange | null;
}) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-1">Account</h1>
      <p className="text-sm text-[var(--sub)] mb-6">
        Gestisci la tua email di accesso e le sessioni attive.
      </p>

      <AccountInfoPanel user={user} />
      <EmailChangePanel
        currentEmail={user.email}
        pendingChange={pendingChange}
      />
      <SessionsPanel sessions={sessions} />
      <DangerPanel />
    </div>
  );
}

function AccountInfoPanel({ user }: { user: UserInfo }) {
  const created = new Date(user.createdAt).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return (
    <div className="panel p-6 mb-4">
      <div className="text-[11px] uppercase tracking-wider text-[var(--sub)] font-semibold mb-3">
        Profilo
      </div>
      <div className="flex items-center gap-4">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="w-12 h-12 rounded-full border border-[var(--line)]"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white font-bold text-lg">
            {initials(user.name ?? user.email)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px]">
            {user.name ?? user.email.split("@")[0]}
          </div>
          <div className="text-xs text-[var(--sub)] num-mono truncate">
            {user.email}
          </div>
          <div className="text-[11px] text-[var(--sub)] mt-1">
            Iscritto dal {created}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailChangePanel({
  currentEmail,
  pendingChange,
}: {
  currentEmail: string;
  pendingChange: PendingChange | null;
}) {
  const [pending, startTransition] = useTransition();
  const [newEmail, setNewEmail] = useState("");
  const [result, setResult] = useState<
    | { kind: "idle" }
    | { kind: "ok"; sentTo: string }
    | { kind: "err"; msg: string }
  >({ kind: "idle" });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    const fd = new FormData();
    fd.set("newEmail", newEmail);
    startTransition(async () => {
      const r = await requestEmailChange(fd);
      if (r.ok) {
        setResult({ kind: "ok", sentTo: r.sentTo });
        setNewEmail("");
      } else {
        setResult({ kind: "err", msg: r.error });
      }
    });
  }

  function onCancel() {
    if (!pendingChange) return;
    if (!confirm("Annullare la richiesta di cambio email pendente?")) return;
    startTransition(async () => {
      await cancelEmailChangeRequest(pendingChange.id);
      setResult({ kind: "idle" });
    });
  }

  return (
    <div className="panel p-6 mb-4">
      <div className="text-[11px] uppercase tracking-wider text-[var(--sub)] font-semibold mb-3">
        Cambia email di accesso
      </div>

      {pendingChange && (
        <div className="bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.25)] rounded-md p-3 text-sm mb-4">
          <div className="font-medium mb-1">
            Richiesta pendente verso{" "}
            <span className="num-mono">{pendingChange.newEmail}</span>
          </div>
          <div className="text-xs text-[var(--sub)]">
            Apri la mail su <strong>{pendingChange.newEmail}</strong> e clicca
            il link di conferma. Il link scade il{" "}
            {new Date(pendingChange.expiresIso).toLocaleString("it-IT", {
              dateStyle: "short",
              timeStyle: "short",
            })}
            .
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="btn-ghost !h-7 text-xs"
              disabled={pending}
            >
              Annulla richiesta
            </button>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-sm">
          Email attuale:{" "}
          <span className="num-mono text-[var(--ink)]">{currentEmail}</span>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-[var(--sub)]">
            Nuova email
          </span>
          <input
            type="email"
            placeholder="nuova@esempio.it"
            className="input w-full mt-1 !h-10"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            disabled={pending || !!pendingChange}
            required
          />
        </label>

        {result.kind === "err" && (
          <div className="text-xs text-[var(--err)] bg-[rgba(223,27,65,0.06)] border border-[rgba(223,27,65,0.2)] rounded-md p-2.5">
            {result.msg}
          </div>
        )}
        {result.kind === "ok" && (
          <div className="text-xs text-[var(--ok)] bg-[rgba(0,166,99,0.06)] border border-[rgba(0,166,99,0.2)] rounded-md p-2.5">
            Email di conferma mandata a{" "}
            <strong className="num-mono">{result.sentTo}</strong>. Apri la
            casella e clicca il link per completare il cambio.
          </div>
        )}

        <button
          type="submit"
          className="btn !h-10"
          disabled={pending || !newEmail || !!pendingChange}
        >
          {pending ? "Invio…" : "Manda link di conferma"}
        </button>

        <p className="text-[11px] text-[var(--sub)] leading-relaxed">
          Per sicurezza, manderemo un link di conferma alla nuova email.
          Cliccandolo, tutte le sessioni attive verranno chiuse e dovrai
          riaccedere con la nuova email.
        </p>
      </form>
    </div>
  );
}

function SessionsPanel({ sessions }: { sessions: SessionInfo[] }) {
  const [pending, startTransition] = useTransition();

  function onRevoke(id: string) {
    if (!confirm("Terminare questa sessione?")) return;
    startTransition(async () => {
      await revokeSession(id);
    });
  }

  return (
    <div className="panel p-6 mb-4">
      <div className="text-[11px] uppercase tracking-wider text-[var(--sub)] font-semibold mb-3">
        Sessioni attive ({sessions.length})
      </div>
      {sessions.length === 0 ? (
        <div className="text-sm text-[var(--sub)]">Nessuna sessione attiva.</div>
      ) : (
        <ul className="divide-y divide-line2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium flex items-center gap-2">
                  Browser
                  {s.isCurrent && (
                    <span className="pill bg-[rgba(0,166,99,0.1)] text-[var(--ok)]">
                      questa sessione
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--sub)] num-mono">
                  scade{" "}
                  {new Date(s.expiresIso).toLocaleDateString("it-IT", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRevoke(s.id)}
                disabled={pending || s.isCurrent}
                className="btn-ghost !h-7 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  s.isCurrent
                    ? "Usa 'Esci' qui sotto per terminare questa sessione"
                    : "Termina questa sessione"
                }
              >
                Termina
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DangerPanel() {
  return (
    <div className="panel p-6">
      <div className="text-[11px] uppercase tracking-wider text-[var(--sub)] font-semibold mb-3">
        Logout
      </div>
      <div className="flex flex-wrap gap-2">
        <form action={logoutCurrent}>
          <button type="submit" className="btn-ghost">
            Esci
          </button>
        </form>
        <form action={logoutAll}>
          <button type="submit" className="btn-ghost text-[var(--err)] border-[rgba(223,27,65,0.3)] hover:bg-[rgba(223,27,65,0.05)]">
            Esci da tutti i dispositivi
          </button>
        </form>
      </div>
      <p className="text-[11px] text-[var(--sub)] mt-3 leading-relaxed">
        &quot;Esci&quot; chiude solo la sessione corrente.
        &quot;Esci da tutti i dispositivi&quot; cancella tutte le sessioni
        attive (utile se hai dimenticato di sloggarti da un computer condiviso).
      </p>
    </div>
  );
}

function initials(s: string): string {
  const parts = s
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
