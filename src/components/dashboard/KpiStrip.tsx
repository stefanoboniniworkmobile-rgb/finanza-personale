import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard";
import { fmtEUR, fmtK, fmtN0 } from "@/lib/format";

export function KpiStrip({ data }: { data: DashboardData }) {
  const k = data.kpi;
  const encodedPeriod = encodeURIComponent(data.period);
  const tasso = k.entratePeriod > 0 ? Math.round((k.netto / k.entratePeriod) * 100) : 0;
  const items: KpiItem[] = [
    {
      label: "Patrimonio totale",
      value: fmtEUR(k.patrimonioTotal),
      sub: `Liq ${fmtK(k.liquidity)} · Risp ${fmtK(k.savings)}`,
      href: "/conti",
    },
    {
      label: "Entrate",
      value: fmtEUR(k.entratePeriod),
      sub:
        k.deltaEntrate === 0
          ? "primo periodo"
          : `${k.deltaEntrate >= 0 ? "▲" : "▼"} ${Math.abs(k.deltaEntrate).toFixed(1)}% vs mese prec.`,
      cls: k.deltaEntrate >= 0 ? "delta-up" : "delta-down",
      href: `/movimenti?period=${encodedPeriod}&tipo=income`,
    },
    {
      label: "Uscite",
      value: fmtEUR(k.uscitePeriod),
      sub:
        k.deltaUscite === 0
          ? "primo periodo"
          : `${k.deltaUscite <= 0 ? "▼" : "▲"} ${Math.abs(k.deltaUscite).toFixed(1)}% vs mese prec.`,
      cls: k.deltaUscite > 0 ? "delta-down" : "delta-up",
      href: `/movimenti?period=${encodedPeriod}&tipo=expense`,
    },
    {
      label: "Netto",
      value: (k.netto >= 0 ? "+" : "") + fmtEUR(k.netto),
      sub: `${tasso}% tasso risparmio`,
      cls: k.netto >= 0 ? "delta-up" : "delta-down",
      href: `/movimenti?period=${encodedPeriod}`,
    },
    {
      label: "Movimenti",
      value: fmtN0(k.movimentiTotal),
      sub: `${fmtN0(k.movimentiPeriod)} nel periodo`,
      href: `/movimenti?period=${encodedPeriod}`,
    },
    {
      label: "Escluse dalla dashboard",
      value: fmtEUR(k.excludedBalancePeriod),
      sub: "Saldo operazioni nascoste",
      cls: k.excludedBalancePeriod < 0 ? "delta-down" : "delta-up",
      href: `/movimenti?dashboard=excluded&period=${encodedPeriod}`,
    },
    {
      label: "Esposizione carte",
      value: fmtEUR(k.cardsExposure),
      sub: "Da regolare a fine mese",
      cls: k.cardsExposure < 0 ? "delta-down" : "",
      href: "/conti?type=credit_card",
    },
    {
      label: "Da verificare",
      value: fmtN0(k.daVerificare),
      sub: k.daVerificare === 0 ? "Tutto riconciliato" : "Movimenti non riconciliati",
      cls: k.daVerificare > 0 ? "delta-down" : "delta-up",
      href: `/movimenti?ric=0&period=${encodedPeriod}`,
    },
  ];

  return (
    <div className="panel grid grid-cols-7 mb-4 overflow-hidden">
      {items.map((it, i) => {
        const inner = (
          <>
            <div className="ph">{it.label}</div>
            <div className="text-2xl font-semibold mt-1 num">{it.value}</div>
            <div className={`text-[12px] text-sub mt-0.5 ${it.cls ?? ""}`}>{it.sub}</div>
          </>
        );
        const cls = `px-4 py-3 ${i < items.length - 1 ? "border-r border-line2" : ""}`;
        return it.href ? (
          <Link key={it.label} href={it.href} className={`${cls} hover:bg-bg transition`}>
            {inner}
          </Link>
        ) : (
          <div key={it.label} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

type KpiItem = {
  label: string;
  value: string;
  sub: string;
  cls?: string;
  href?: string;
};
