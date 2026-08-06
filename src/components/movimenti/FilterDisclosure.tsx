"use client";

import { useState } from "react";
import { SlidersHorizontal, ChevronDown } from "lucide-react";

/**
 * Contenitore dei filtri Movimenti responsivo.
 *  - Desktop (md+): i figli restano in linea nel form (display:contents), come prima.
 *  - Mobile: tutti i filtri sono collassati dietro un toggle "Filtri (N)" per non
 *    occupare mezza schermata; espandendoli diventano a piena larghezza.
 * Un solo set di campi → nessun doppione di input nel form GET.
 */
export function FilterDisclosure({
  activeCount,
  children,
}: {
  activeCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="md:hidden w-full input !h-9 flex items-center justify-between"
      >
        <span className="flex items-center gap-2 text-sm text-ink">
          <SlidersHorizontal size={15} />
          Filtri
          {activeCount > 0 && (
            <span className="pill bg-brand-50 text-brand-600">{activeCount}</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`text-sub transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`fp-filters-adv md:contents ${
          open ? "flex flex-col gap-2 w-full mt-1" : "hidden"
        }`}
      >
        {children}
      </div>
    </>
  );
}
