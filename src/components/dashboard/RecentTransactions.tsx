import type { RecentRow } from "@/lib/dashboard";
import { fmtDate, fmtN } from "@/lib/format";

export function RecentTransactions({ rows }: { rows: RecentRow[] }) {
  return (
    <div className="panel overflow-x-auto">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div>
          <div className="font-semibold text-sm">Movimenti recenti</div>
          <div className="text-xs text-sub">Ultimi {rows.length} movimenti</div>
        </div>
        <a className="btn-ghost !h-8 !text-xs" href="/movimenti">
          Vedi tutti →
        </a>
      </div>
      {/* Mobile: lista compatta (la tabella a 6 colonne è per desktop) */}
      <div className="md:hidden divide-y divide-line2">
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-sub">
            Nessun movimento recente.
          </div>
        )}
        {rows.map((r) => (
          <div key={r.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[14px] truncate">
                {r.description}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span
                  className={`pill ${
                    r.type === "income"
                      ? "bg-ok-50 text-ok-600"
                      : "bg-line2 text-ink2"
                  }`}
                >
                  {r.category}
                </span>
                <span className="text-[11px] text-sub num-mono">
                  {fmtDate(r.date)}
                  {r.account ? ` · ${r.account}` : ""}
                </span>
              </div>
            </div>
            <div
              className={`num-mono font-semibold text-[14px] shrink-0 ${
                r.type === "income" ? "text-ok-600" : "text-ink"
              }`}
            >
              {r.type === "income" ? "+" : "−"}
              {fmtN(r.amount)} €
            </div>
          </div>
        ))}
      </div>

      <table className="dense hidden md:table">
        <thead>
          <tr>
            <th style={{ width: 90 }}>Data</th>
            <th>Descrizione</th>
            <th>Categoria</th>
            <th>Conto</th>
            <th>Modalità</th>
            <th className="text-right" style={{ width: 130 }}>
              Importo
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="row">
              <td className="num-mono text-sub">{fmtDate(r.date)}</td>
              <td>
                <div className="truncate max-w-[420px]" title={r.description}>
                  {r.description}
                </div>
              </td>
              <td>
                <span
                  className={`pill ${r.type === "income" ? "bg-ok-50 text-ok-600" : "bg-line2 text-ink2"}`}
                >
                  {r.category}
                </span>
              </td>
              <td className="text-ink2">{r.account}</td>
              <td className="text-sub">{r.paymentMethod ?? ""}</td>
              <td
                className={`text-right num-mono font-medium ${r.type === "income" ? "text-ok-600" : "text-ink"}`}
              >
                {r.type === "income" ? "+" : "-"}
                {fmtN(r.amount)} €
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
