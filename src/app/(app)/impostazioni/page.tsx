"use client";
import { useState } from "react";
import Link from "next/link";

export default function ImpostazioniPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");

  async function onImport() {
    if (!file) return;
    setStatus("Caricamento…");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/import", { method: "POST", body: fd });
    const json = await res.json();
    if (res.ok) {
      setStatus(
        `Import completato: ${json.transactions} movimenti, ${json.accounts} conti, ${json.categories} categorie, ${json.paymentMethods} modalità.`,
      );
    } else {
      setStatus(`Errore: ${json.error || "import fallito"}`);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Impostazioni</h1>

      <div className="panel p-6 mb-4">
        <div className="text-[11px] uppercase tracking-wider text-[var(--sub)] font-semibold mb-3">
          Account
        </div>
        <div className="text-sm mb-3">
          Gestisci la tua email di accesso, le sessioni attive e il logout.
        </div>
        <Link href="/impostazioni/account" className="btn">
          Gestisci account →
        </Link>
      </div>

      <div className="panel p-6 mb-4">
        <div className="text-[11px] uppercase tracking-wider text-[var(--sub)] font-semibold mb-3">
          Intestatari
        </div>
        <div className="text-sm mb-3">
          Gestisci i perimetri di dati separati (es. Stefano, Lorenzo).
          Ogni intestatario ha i propri conti, categorie, budget e movimenti.
        </div>
        <Link href="/impostazioni/intestatari" className="btn">
          Gestisci intestatari →
        </Link>
      </div>

      <div className="panel p-6 mb-4">
        <div className="text-[11px] uppercase tracking-wider text-[var(--sub)] font-semibold mb-3">
          Import / Export
        </div>
        <div className="text-sm mb-4">
          Carica il tuo <code>registro_spese.xlsm</code>: l'app importerà movimenti,
          categorie, conti e modalità mantenendo i flag (es. categorie escluse dalla
          dashboard).
        </div>
        <input
          type="file"
          accept=".xlsx,.xlsm,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm mb-3"
        />
        <div>
          <button className="btn" disabled={!file} onClick={onImport}>
            Importa
          </button>
        </div>
        {status && (
          <div className="mt-3 text-sm text-[var(--sub)]">{status}</div>
        )}
      </div>

      <div className="panel p-6">
        <div className="text-[11px] uppercase tracking-wider text-[var(--sub)] font-semibold mb-3">
          Stack tecnologico
        </div>
        <ul className="text-sm space-y-1.5">
          <li>Next.js 15 + TypeScript</li>
          <li>PostgreSQL su Supabase (in dev: SQLite locale)</li>
          <li>Auth.js · email magic link</li>
          <li>Prisma ORM</li>
          <li>Tailwind CSS</li>
          <li>Hosting Vercel</li>
        </ul>
      </div>
    </div>
  );
}
