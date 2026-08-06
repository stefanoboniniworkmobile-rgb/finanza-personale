"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Privacy dei numeri sensibili (patrimonio): sfocati di default, si rivelano
 * col tasto occhio. La scelta è salvata in localStorage e sincronizzata tra
 * tutte le istanze (valore + chip liquidità/risparmi) e tra schede aperte.
 */
const KEY = "fp:hidePatrimonio";
const listeners = new Set<() => void>();

function readHidden(): boolean {
  if (typeof window === "undefined") return true; // default: nascosto
  return localStorage.getItem(KEY) !== "0";
}
function setHiddenStore(v: boolean) {
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* storage non disponibile: ignora */
  }
  listeners.forEach((l) => l());
}

function useHidden(): boolean {
  // Parte da "nascosto" sia su server sia al primo paint client → niente
  // mismatch di idratazione; poi l'effetto allinea alla preferenza salvata.
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const sync = () => setHidden(readHidden());
    sync();
    listeners.add(sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return hidden;
}

/** Valore + tasto occhio per mostrare/nascondere. */
export function PrivacyValue({ value }: { value: string }) {
  const hidden = useHidden();
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={
          hidden
            ? "blur-[7px] select-none transition-[filter] duration-200"
            : "transition-[filter] duration-200"
        }
      >
        {value}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setHiddenStore(!hidden);
        }}
        aria-label={hidden ? "Mostra patrimonio" : "Nascondi patrimonio"}
        title={hidden ? "Mostra patrimonio" : "Nascondi patrimonio"}
        className="shrink-0 text-sub hover:text-ink transition p-1 -m-1"
      >
        {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}

/** Sfoca i dettagli collegati (chip liquidità/risparmi) senza tasto. */
export function PrivacyBlur({ children }: { children: React.ReactNode }) {
  const hidden = useHidden();
  return (
    <span
      className={
        hidden
          ? "blur-[5px] select-none pointer-events-none transition-[filter] duration-200"
          : "transition-[filter] duration-200"
      }
    >
      {children}
    </span>
  );
}
