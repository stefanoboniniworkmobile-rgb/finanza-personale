"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  TrendingUp,
  LineChart,
  Landmark,
  Tags,
  CreditCard,
  Upload,
  LayoutTemplate,
  Building2,
  Settings,
} from "lucide-react";

type IconType = React.ComponentType<{
  size?: number;
  strokeWidth?: number;
  className?: string;
}>;

type Item = { href: string; label: string; icon: IconType };

export function SidebarNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const sections: { title: string; items: Item[] }[] = [
    {
      title: t("general"),
      items: [
        { href: "/dashboard", label: t("dashboard"), icon: LayoutDashboard },
        { href: "/movimenti", label: t("movimenti"), icon: ArrowLeftRight },
        { href: "/budget", label: t("budget"), icon: Wallet },
        { href: "/forecast", label: t("forecast"), icon: TrendingUp },
        { href: "/mercati", label: "Mercati", icon: LineChart },
      ],
    },
    {
      title: t("anagrafiche"),
      items: [
        { href: "/conti", label: t("conti"), icon: Landmark },
        { href: "/categorie", label: t("categorie"), icon: Tags },
        { href: "/modalita", label: t("modalita"), icon: CreditCard },
      ],
    },
    {
      title: "Strumenti",
      items: [
        { href: "/importazioni", label: "Importazioni", icon: Upload },
        {
          href: "/importazioni/templates",
          label: "Template import",
          icon: LayoutTemplate,
        },
        { href: "/impostazioni/banche", label: "Banche", icon: Building2 },
      ],
    },
    {
      title: t("system"),
      items: [{ href: "/impostazioni", label: t("impostazioni"), icon: Settings }],
    },
  ];

  // Voce attiva = quella col percorso più specifico che è prefisso della rotta
  // corrente (così "Template import" vince su "Importazioni", "Banche" su
  // "Impostazioni").
  const activeHref = sections
    .flatMap((s) => s.items)
    .filter((it) => pathname === it.href || pathname.startsWith(it.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="px-2.5 py-3 space-y-5">
      {sections.map((s) => (
        <div key={s.title}>
          <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sub/80">
            {s.title}
          </div>
          <div className="space-y-0.5">
            {s.items.map((it) => {
              const active = it.href === activeHref;
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors " +
                    (active
                      ? "bg-brand-50 text-brand-700"
                      : "text-ink2 hover:bg-line2 hover:text-ink")
                  }
                >
                  <Icon
                    size={16}
                    strokeWidth={active ? 2.25 : 1.75}
                    className={
                      active ? "text-brand-600" : "text-sub group-hover:text-ink2"
                    }
                  />
                  <span>{it.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
