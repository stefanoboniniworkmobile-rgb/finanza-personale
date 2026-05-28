"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CategorySlice } from "@/lib/dashboard";
import { fmtN, fmtPeriodLabel, parsePeriod } from "@/lib/format";

const PALETTE = ["#635bff", "#00a663", "#bf6a02", "#df1b41", "#06b6d4", "#a855f7", "#94a3b8"];

export function CategoriesDonut({
  slices,
  totalUscite,
  period,
}: {
  slices: CategorySlice[];
  totalUscite: number;
  period: string;
}) {
  const colored = slices.map((s, i) => ({
    ...s,
    color: s.isOther ? "#94a3b8" : PALETTE[i] ?? "#94a3b8",
  }));

  return (
    <div className="panel p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-semibold text-sm">Composizione uscite</div>
          <div className="text-xs text-sub">
            {(() => {
              const { from, to } = parsePeriod(period);
              return fmtPeriodLabel(from, to);
            })()}{" "}
            · top 6 categorie
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="relative" style={{ width: 150, height: 150 }}>
          {totalUscite > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={colored}
                  dataKey="amount"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={1}
                  stroke="#fff"
                  strokeWidth={2}
                >
                  {colored.map((s, i) => (
                    <Cell key={i} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #e3e8ee",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value: any) => [fmtN(Number(value)) + " €", ""]}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs text-sub">
              Nessuna uscita
            </div>
          )}
          <div className="absolute inset-0 grid place-items-center text-center pointer-events-none">
            <div>
              <div className="text-[9px] text-sub uppercase tracking-wider">Uscite</div>
              <div className="font-semibold num text-sm leading-tight">
                {fmtN(totalUscite)} €
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-[11px] flex-1 min-w-0">
        {colored.map((s) => (
          <div
            key={s.name}
            className={`flex items-center gap-2 min-w-0 ${s.isOther ? "pt-1 mt-1 border-t border-line2" : ""}`}
          >
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: s.color }}
            />
            <span
              className={`flex-1 truncate ${s.isOther ? "text-sub italic" : ""}`}
              title={s.isOther ? s.hidden?.join(", ") : s.name}
            >
              {s.name}
            </span>
            <span className="num-mono text-sub shrink-0">{fmtN(s.amount)} €</span>
            <span
              className="num-mono text-ink2 shrink-0 text-right"
              style={{ width: 34 }}
            >
              {(s.pct * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
