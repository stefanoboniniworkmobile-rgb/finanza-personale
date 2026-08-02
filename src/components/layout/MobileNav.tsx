"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { SidebarNav } from "./SidebarNav";
import { AppCredit } from "./AppCredit";

/**
 * Drawer di navigazione completo (solo mobile). Non ha un pulsante proprio:
 * viene aperto dall'evento `fp:open-nav` (lo emette la tab "Altro" della
 * barra in basso). Montato via portal su document.body per non essere
 * intrappolato dal backdrop-blur della topbar.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMounted(true), []);

  // Apri quando la barra in basso emette l'evento.
  useEffect(() => {
    const openNav = () => setOpen(true);
    window.addEventListener("fp:open-nav", openNav);
    return () => window.removeEventListener("fp:open-nav", openNav);
  }, []);

  // Chiudi al cambio pagina.
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

  const drawer = (
    <div className="md:hidden fixed inset-0 z-50">
      <div
        className="fp-drawer-backdrop absolute inset-0 bg-black/40"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        className="fp-drawer-panel absolute inset-y-0 left-0 w-[264px] max-w-[82vw] bg-white border-r border-line flex flex-col shadow-2xl"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="h-[52px] shrink-0 px-4 flex items-center justify-between border-b border-line">
          <span className="font-semibold text-[13.5px] tracking-tight text-ink">
            Finanza Personale
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Chiudi menù"
            className="w-9 h-9 grid place-items-center rounded-lg text-sub hover:bg-line2 transition-colors"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <div
          className="shrink-0 px-4 py-3 border-t border-line"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <AppCredit />
        </div>
      </aside>
    </div>
  );

  return <>{open && mounted && createPortal(drawer, document.body)}</>;
}
