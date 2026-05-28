import type { AccountRow } from "@/lib/dashboard";
import { fmtN } from "@/lib/format";

export function AccountsTable({
  accounts,
  totalCount,
}: {
  accounts: AccountRow[];
  totalCount: number;
}) {
  const totIni = accounts.reduce((s, a) => s + a.initialBalance, 0);
  const totEnt = accounts.reduce((s, a) => s + a.entrate, 0);
  const totUsc = accounts.reduce((s, a) => s + a.uscite, 0);
  const totSaldo = accounts.reduce((s, a) => s + a.saldo, 0);
  const totMovs = accounts.reduce((s, a) => s + a.movs, 0);

  return (
    <div className="panel overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div>
          <div className="font-semibold text-sm">Saldi per conto</div>
          <div className="text-xs text-sub">{accounts.length} conti collegati</div>
        </div>
        <button className="btn-ghost" disabled>
          + Aggiungi conto
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="dense">
          <thead>
            <tr>
              <th>Conto</th>
              <th>Tipo</th>
              <th className="text-right">Saldo iniz.</th>
              <th className="text-right">Entrate</th>
              <th className="text-right">Uscite</th>
              <th className="text-right">Saldo</th>
              <th className="text-right">Mov.</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="row">
                <td>
                  <div className="font-medium">{a.name}</div>
                  {a.notes && (
                    <div className="text-xs text-sub truncate max-w-[260px]">
                      {a.notes}
                    </div>
                  )}
                </td>
                <td>
                  <AccountTypeBadge type={a.type} name={a.name} />
                </td>
                <td className="text-right num-mono text-sub">{fmtN(a.initialBalance)}</td>
                <td className="text-right num-mono text-ok-600">{fmtN(a.entrate)}</td>
                <td className="text-right num-mono text-err-600">{fmtN(a.uscite)}</td>
                <td
                  className={`text-right num-mono font-semibold ${a.saldo < 0 ? "text-err-600" : ""}`}
                >
                  {fmtN(a.saldo)}
                </td>
                <td className="text-right num-mono text-sub">{a.movs}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="font-semibold text-xs">
                TOTALE
              </td>
              <td className="text-right num-mono text-sub">{fmtN(totIni)}</td>
              <td className="text-right num-mono text-ok-600">{fmtN(totEnt)}</td>
              <td className="text-right num-mono text-err-600">{fmtN(totUsc)}</td>
              <td className="text-right num-mono font-semibold">{fmtN(totSaldo)}</td>
              <td className="text-right num-mono text-sub">{totMovs || totalCount}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function AccountTypeBadge({ type, name }: { type: string; name: string }) {
  const lower = name.toLowerCase();
  if (type === "credit_card")
    return <span className="pill bg-err-50 text-err-600">Carta</span>;
  if (type === "savings") {
    if (lower.includes("scalable"))
      return <span className="pill bg-warn-50 text-warn-600">Investim.</span>;
    return <span className="pill bg-warn-50 text-warn-600">Risparmio</span>;
  }
  if (type === "cash") return <span className="pill bg-line2 text-sub">Contanti</span>;
  if (lower.includes("satispay") || lower.includes("paypal"))
    return <span className="pill bg-brand-50 text-brand-600">E-wallet</span>;
  return <span className="pill bg-ok-50 text-ok-600">C/C</span>;
}
