"use client";

import { useEffect, useState } from "react";
import {
  listAspspsAction,
  initiateBankConnectionFlow,
  type AspspOption,
} from "@/app/(app)/bank-connections-actions";

type BankAccountUi = {
  id: string;
  name: string;
  alreadyConnectedTo: string | null;
};

export function ConnectFormClient({
  bankAccounts,
}: {
  bankAccounts: BankAccountUi[];
}) {
  const [loadingAspsps, setLoadingAspsps] = useState(true);
  const [aspsps, setAspsps] = useState<AspspOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showBeta, setShowBeta] = useState(true);

  const [aspspName, setAspspName] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listAspspsAction("IT");
      if (cancelled) return;
      if (res.ok && res.data) {
        setAspsps(res.data);
      } else if (!res.ok) {
        setLoadError(res.error);
      }
      setLoadingAspsps(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleAspsps = showBeta ? aspsps : aspsps.filter((a) => !a.beta);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!aspspName || !bankAccountId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await initiateBankConnectionFlow({
        aspspName,
        aspspCountry: "IT",
        bankAccountId,
      });
      if (res.ok && res.data) {
        // Redirect al provider per il consent flow
        window.location.href = res.data.url;
      } else if (!res.ok) {
        setSubmitError(res.error);
        setSubmitting(false);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const eligible = bankAccounts.filter((ba) => !ba.alreadyConnectedTo);

  if (loadError) {
    return (
      <div className="panel p-4 border-red-300 bg-red-50 text-red-800 text-sm">
        Errore nel caricamento delle banche disponibili: {loadError}
      </div>
    );
  }

  if (bankAccounts.length === 0) {
    return (
      <div className="panel p-4 text-sm">
        Non hai ancora creato nessun conto bancario per questo intestatario.{" "}
        <a href="/conti" className="underline">
          Crea prima un conto in /conti
        </a>
        .
      </div>
    );
  }

  if (eligible.length === 0) {
    return (
      <div className="panel p-4 text-sm">
        Tutti i tuoi conti hanno già una connessione PSD2 attiva. Se vuoi
        ricollegarne uno, prima disconnettilo dalla{" "}
        <a href="/impostazioni/banche" className="underline">
          lista banche
        </a>
        .
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="panel p-4 max-w-2xl space-y-4">
      {/* Step 1: ASPSP */}
      <div>
        <label className="block text-sm font-medium mb-1">
          1. Banca (ASPSP)
        </label>
        <div className="text-xs text-sub mb-2">
          Seleziona la banca a cui appartiene il conto che vuoi collegare. Le
          banche &quot;beta&quot; sono integrate da Enable Banking ma con
          maturità ancora in valutazione.
        </div>
        {loadingAspsps ? (
          <div className="text-sm text-sub">Carico lista banche...</div>
        ) : (
          <>
            <select
              className="input w-full"
              value={aspspName}
              onChange={(e) => setAspspName(e.target.value)}
              required
            >
              <option value="">— scegli una banca —</option>
              {visibleAspsps.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                  {a.beta ? " (beta)" : ""}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 mt-2 text-xs text-sub">
              <input
                type="checkbox"
                checked={showBeta}
                onChange={(e) => setShowBeta(e.target.checked)}
              />
              Includi banche in beta ({aspsps.filter((a) => a.beta).length})
            </label>
          </>
        )}
      </div>

      {/* Step 2: BankAccount locale */}
      <div>
        <label className="block text-sm font-medium mb-1">
          2. A quale conto dell&apos;app la associo?
        </label>
        <div className="text-xs text-sub mb-2">
          Le transazioni scaricate verranno aggiunte a questo conto. Devi avere
          un conto bancario già creato in <code>/conti</code>.
        </div>
        <select
          className="input w-full"
          value={bankAccountId}
          onChange={(e) => setBankAccountId(e.target.value)}
          required
        >
          <option value="">— scegli un conto —</option>
          {bankAccounts.map((ba) => (
            <option
              key={ba.id}
              value={ba.id}
              disabled={!!ba.alreadyConnectedTo}
            >
              {ba.name}
              {ba.alreadyConnectedTo
                ? ` — già connesso a ${ba.alreadyConnectedTo}`
                : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="btn"
          disabled={submitting || !aspspName || !bankAccountId}
        >
          {submitting ? "Avvio..." : "Avvia connessione →"}
        </button>
        <a href="/impostazioni/banche" className="btn-ghost text-sm">
          Annulla
        </a>
      </div>

      {submitError && (
        <div className="panel p-3 border-red-300 bg-red-50 text-red-800 text-sm">
          ✗ {submitError}
        </div>
      )}

      <div className="text-xs text-sub leading-relaxed border-t border-[var(--line)] pt-3">
        Cliccando &quot;Avvia connessione&quot; verrai reindirizzato al sito
        della banca per autenticarti e dare il consenso PSD2 di 6 mesi
        all&apos;applicazione. Al termine atterrerai automaticamente di nuovo
        qui con la nuova connessione registrata.
      </div>
    </form>
  );
}
