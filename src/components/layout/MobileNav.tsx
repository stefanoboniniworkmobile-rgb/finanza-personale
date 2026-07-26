"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "./SidebarNav";
import { APP_VERSION, APP_CREDIT } from "@/lib/version";

/**
 * Navigazione mobile: un pulsante hamburger (solo < md) che apre la sidebar
 * come drawer a scomparsa con backdrop. Su desktop non compare (la sidebar
 * statica la gestisce il layout).
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Chiudi il drawer quando cambia pagina.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Blocca lo scroll del body mentre il drawer è aperto.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Apri menù"
        className="md:hidden w-9 h-9 -ml-1 grid place-items-center rounded-lg text-ink hover:bg-line2 transition-colors"
      >
        <Menu size={20} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-[264px] max-w-[82vw] bg-white border-r border-line flex flex-col shadow-2xl">
            <div className="h-[52px] shrink-0 px-4 flex items-center justify-between border-b border-line">
              <span className="font-semibold text-[13.5px] tracking-tight text-ink">
                Finanza Personale
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Chiudi menù"
                className="w-8 h-8 grid place-items-center rounded-lg text-sub hover:bg-line2 transition-colors"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarNav />
            </div>
            <div className="shrink-0 px-4 py-3 border-t border-line text-[10px] leading-relaxed text-sub">
              <div className="num-mono">v{APP_VERSION}</div>
              <div>{APP_CREDIT}</div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
