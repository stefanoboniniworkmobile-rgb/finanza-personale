"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  LineChart,
  Menu,
} from "lucide-react";

/**
 * Barra di navigazione fissa in basso, stile app nativa (solo mobile, < md).
 * Le 4 destinazioni più usate + "Altro" che apre il drawer completo (via
 * evento, così restiamo disaccoppiati dal componente del drawer).
 * Rispetta la safe-area inferiore (barra home iPhone) in modalità installata.
 */
const ITEMS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/movimenti", label: "Movimenti", icon: ArrowLeftRight },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/mercati", label: "Mercati", icon: LineChart },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navigazione principale"
    >
      <div className="grid grid-cols-5 h-14">
        {ITEMS.map((it) => {
          const active = isActive(it.href);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? "text-brand-600" : "text-sub"
              }`}
            >
              <Icon size={21} strokeWidth={active ? 2.25 : 1.75} />
              <span className="text-[10px] font-medium leading-none">
                {it.label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("fp:open-nav"))}
          className="flex flex-col items-center justify-center gap-0.5 text-sub"
          aria-label="Altro"
        >
          <Menu size={21} strokeWidth={1.75} />
          <span className="text-[10px] font-medium leading-none">Altro</span>
        </button>
      </div>
    </nav>
  );
}
