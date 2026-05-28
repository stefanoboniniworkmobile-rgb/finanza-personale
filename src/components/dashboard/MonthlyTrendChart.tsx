"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "@/lib/dashboard";
import { fmtN } from "@/lib/format";

export function MonthlyTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="panel p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-semibold text-sm">Andamento entrate/uscite</div>
          <div className="text-xs text-sub">Ultimi 6 mesi · giroconti esclusi</div>
        </div>
        <div className="seg">
          <button className="active">Mese</button>
          <button disabled>Settimana</button>
          <button disabled>Trim.</button>
        </div>
      </div>
      <div className="flex-1 min-h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
          >
            <CartesianGrid stroke="#eef0f4" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#697386", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#697386", fontSize: 11 }}
              tickFormatter={(v) =>
                v >= 1000 ? Math.round(v / 1000) + "k" : String(v)
              }
            />
            <Tooltip
              contentStyle={{
                background: "#fff",
                border: "1px solid #e3e8ee",
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: "#0a2540", fontWeight: 600 }}
              formatter={(value: any, name) => [
                fmtN(Number(value)) + " €",
                name === "entrate" ? "Entrate" : name === "uscite" ? "Uscite" : "Netto",
              ]}
            />
            <Bar dataKey="entrate" fill="#00a663" radius={[3, 3, 0, 0]} barSize={18} />
            <Bar dataKey="uscite" fill="#df1b41" radius={[3, 3, 0, 0]} barSize={18} />
            <Line
              type="monotone"
              dataKey="netto"
              stroke="#635bff"
              strokeWidth={2}
              dot={{ r: 3, fill: "#635bff" }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 text-[11px] text-sub mt-2">
        <span className="flex items-center gap-1">
          <span className="dot" style={{ background: "#00a663" }} /> Entrate
        </span>
        <span className="flex items-center gap-1">
          <span className="dot" style={{ background: "#df1b41" }} /> Uscite
        </span>
        <span className="flex items-center gap-1">
          <span className="dot" style={{ background: "#635bff" }} /> Netto
        </span>
      </div>
    </div>
  );
}
