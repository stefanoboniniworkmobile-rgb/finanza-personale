import Link from "next/link";
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  PiggyBank,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import type { DashboardData } from "@/lib/dashboard";
import { fmtEUR, fmtK, fmtN0 } from "@/lib/format";

type Tone = "brand" | "ok" | "err";
const BADGE: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-600",
  ok: "bg-ok-50 text-ok-600",
  err: "bg-err-50 text-err-600",
};

type IconType = React.ComponentType<{ size?: number; strokeWidth?: number }>;

export function KpiStrip({ data }: { data: DashboardData }) {
  const k = data.kpi;
  const p = encodeURIComponent(data.period);
  const tasso =
    k.entratePeriod > 0 ? Math.round((k.netto / k.entratePeriod) * 100) : 0;

  return (
    <div className="mb-5 space-y-3">
      {/* KPI principali */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PrimaryCard
          href="/conti"
          icon={Wallet}
          tone="brand"
          label="Patrimonio totale"
          value={fmtEUR(k.patrimonioTotal)}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <Chip>Liquidità {fmtK(k.liquidity)}</Chip>
            <Chip>Risparmi {fmtK(k.savings)}</Chip>
          </div>
        </PrimaryCard>

        <PrimaryCard
          href={`/movimenti?period=${p}&tipo=income`}
          icon={ArrowDownLeft}
          tone="ok"
          label="Entrate"
          value={fmtEUR(k.entratePeriod)}
        >
          <Delta pct={k.deltaEntrate} goodWhenUp />
        </PrimaryCard>

        <PrimaryCard
          href={`/movimenti?period=${p}&tipo=expense`}
          icon={ArrowUpRight}
          tone="err"
          label="Uscite"
          value={fmtEUR(k.uscitePeriod)}
        >
          <Delta pct={k.deltaUscite} goodWhenUp={false} />
        </PrimaryCard>

        <PrimaryCard
          href={`/movimenti?period=${p}`}
          icon={PiggyBank}
          tone={k.netto >= 0 ? "ok" : "err"}
          label="Netto del periodo"
          value={(k.netto >= 0 ? "+" : "") + fmtEUR(k.netto)}
        >
          <SavingsRate pct={tasso} />
        </PrimaryCard>
      </div>

      {/* Riepilogo secondario: una riga sottile, non una seconda fila di contatori */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[12px] text-sub">
        <SummaryStat
          href={`/movimenti?period=${p}`}
          value={fmtN0(k.movimentiTotal)}
          label={`movimenti · ${fmtN0(k.movimentiPeriod)} nel periodo`}
        />
        <Dot />
        <SummaryStat
          href="/conti?type=credit_card"
          value={fmtEUR(k.cardsExposure)}
          label="esposizione carte"
          tone={k.cardsExposure < 0 ? "err" : undefined}
        />
        <Dot />
        <SummaryStat
          href={`/movimenti?ric=0&period=${p}`}
          value={fmtN0(k.daVerificare)}
          label={k.daVerificare === 0 ? "riconciliato" : "da verificare"}
          tone={k.daVerificare > 0 ? "err" : "ok"}
        />
        <Dot />
        <SummaryStat
          href={`/movimenti?dashboard=excluded&period=${p}`}
          value={fmtEUR(k.excludedBalancePeriod)}
          label="escluse dalla dashboard"
        />
      </div>
    </div>
  );
}

function PrimaryCard({
  href,
  icon: Icon,
  tone,
  label,
  value,
  children,
}: {
  href: string;
  icon: IconType;
  tone: Tone;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="panel p-4 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
    >
      <div className="flex items-center justify-between">
        <span className="ph">{label}</span>
        <span className={`w-8 h-8 rounded-lg grid place-items-center ${BADGE[tone]}`}>
          <Icon size={16} strokeWidth={2} />
        </span>
      </div>
      <div className="text-[26px] leading-none font-semibold num tracking-tight text-ink mt-3">
        {value}
      </div>
      <div className="mt-2.5 min-h-[22px]">{children}</div>
    </Link>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-line2 text-ink2 text-[11px] font-medium px-1.5 py-0.5 num">
      {children}
    </span>
  );
}

function Delta({ pct, goodWhenUp }: { pct: number; goodWhenUp: boolean }) {
  if (!pct) return <span className="text-[12px] text-sub">Primo periodo</span>;
  const up = pct >= 0;
  const good = goodWhenUp ? up : !up;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[12px] font-medium ${
        good ? "text-ok-600" : "text-err-600"
      }`}
    >
      <Icon size={14} strokeWidth={2.25} />
      {Math.abs(pct).toFixed(1)}%
      <span className="text-sub font-normal">vs mese prec.</span>
    </span>
  );
}

function SavingsRate({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-sub">Tasso di risparmio</span>
        <span className="font-semibold num text-ink">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-line2 overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 0 ? "bg-ok-500" : "bg-err-500"}`}
          style={{ width: `${w}%` }}
        />
      </div>
    </div>
  );
}

function SummaryStat({
  href,
  value,
  label,
  tone,
}: {
  href: string;
  value: string;
  label: string;
  tone?: "ok" | "err";
}) {
  const valueCls =
    tone === "err" ? "text-err-600" : tone === "ok" ? "text-ok-600" : "text-ink2";
  return (
    <Link href={href} className="hover:text-ink transition-colors">
      <span className={`font-semibold num ${valueCls}`}>{value}</span>{" "}
      {label}
    </Link>
  );
}

function Dot() {
  return (
    <span className="text-line select-none" aria-hidden>
      ·
    </span>
  );
}
