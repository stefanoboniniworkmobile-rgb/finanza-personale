import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getActiveHolder } from "@/lib/holder";
import {
  MovimentiClient,
  type MovimentoRow,
} from "@/components/movimenti/MovimentiClient";
import { FilterDisclosure } from "@/components/movimenti/FilterDisclosure";
import {
  fmtEURFull,
  fmtMonthLong,
  fmtN0,
  fmtPeriodLabel,
  monthRange,
  parsePeriod,
  shiftYm,
  ymKey,
} from "@/lib/format";
import type { Prisma } from "@prisma/client";

type SearchParams = Promise<{
  period?: string; // "YYYY-MM" oppure "all"
  conto?: string;
  cat?: string;
  mod?: string;
  tipo?: "income" | "expense" | "all";
  q?: string;
  page?: string;
  ric?: "all" | "1" | "0"; // stato riconciliazione: tutti / riconciliati / da riconciliare
  ricNote?: string;        // CONTAINS sulla reconciliationNote
  origine?: "all" | "manual" | "import" | "psd2"; // filtro origine movimento
  dashboard?: "all" | "excluded";
}>;

const PAGE_SIZE = 50;

export default async function MovimentiPage(props: { searchParams: SearchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;

  const sp = await props.searchParams;
  const periodRaw = typeof sp.period === "string" ? sp.period.trim() : "all";
  const period =
    periodRaw === "all" ||
    /^\d{4}-\d{2}$/.test(periodRaw) ||
    /^\d{4}-\d{2}\.\.\d{4}-\d{2}$/.test(periodRaw)
      ? periodRaw
      : "all";
  const conto = sp.conto ?? "all";
  const cat = sp.cat ?? "all";
  const mod = sp.mod ?? "all";
  const tipo = sp.tipo ?? "all";
  const q = (sp.q ?? "").trim();
  const ric = sp.ric ?? "all";
  const ricNote = (sp.ricNote ?? "").trim();
  const dashboard = sp.dashboard ?? "all";
  // Filtro per origine movimento: manuale (entrambi i FK null),
  // import (importBatchId valorizzato), psd2 (bankConnectionId valorizzato).
  const origine = sp.origine ?? "all";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Carica dropdown options (sempre)
  const [accounts, categories, paymentMethods] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { holderId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.category.findMany({
      where: { holderId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      // isTransfer / counterpartCategoryId servono al MovimentoDialog per
      // sapere quando mostrare la select "Conto di contropartita" e con
      // quale Category creare il movimento speculare.
      select: {
        id: true,
        name: true,
        type: true,
        isTransfer: true,
        counterpartCategoryId: true,
      },
    }),
    prisma.paymentMethod.findMany({
      where: { holderId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Costruisco where Prisma in base ai filtri
  const where: Prisma.TransactionWhereInput = { holderId };
  if (period !== "all") {
    const { from, to } = monthRange(period);
    where.date = { gte: from, lt: to };
  }
  if (conto !== "all") where.bankAccountId = conto;
  if (cat !== "all") where.categoryId = cat;
  if (mod !== "all") where.paymentMethodId = mod;
  if (tipo !== "all") where.type = tipo;
  if (q) where.description = { contains: q };
  if (ric === "1") where.reconciled = true;
  else if (ric === "0") where.reconciled = false;
  if (ricNote) where.reconciliationNote = { contains: ricNote };
  if (dashboard === "excluded") {
    where.OR = [
      { category: { showInDashboard: false } },
      { category: { isTransfer: true } },
    ];
  }
  // Filtro origine: manual = entrambi i FK null; import = importBatchId NOT
  // null; psd2 = bankConnectionId NOT null. Sono mutuamente esclusivi
  // (vincolo modellato nel commento dello schema Transaction).
  if (origine === "manual") {
    where.importBatchId = null;
    where.bankConnectionId = null;
  } else if (origine === "import") {
    where.importBatchId = { not: null };
  } else if (origine === "psd2") {
    where.bankConnectionId = { not: null };
  }

  const [total, txs, sumsByType] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: {
        category: true,
        bankAccount: true,
        paymentMethod: true,
        // Per il badge "Origine" — facciamo solo SELECT del nome per
        // tooltip, evitando di tirare giù i campi pesanti del batch / connection.
        importBatch: { select: { id: true, fileName: true } },
        bankConnection: {
          select: {
            id: true,
            aspspName: true,
            bankAccount: { select: { name: true } },
          },
        },
      },
    }),
    // Aggregato su TUTTO il set filtrato (non solo la pagina corrente)
    prisma.transaction.groupBy({
      by: ["type"],
      where,
      _sum: { amount: true },
    }),
  ]);

  // Riassunto entrate/uscite sul set filtrato
  let totalIncome = 0;
  let totalExpense = 0;
  for (const s of sumsByType) {
    const v = s._sum.amount ?? 0;
    if (s.type === "income") totalIncome = v;
    else if (s.type === "expense") totalExpense = v;
  }
  const netBalance = totalIncome - totalExpense;

  // Saldo progressivo per conto: lo calcolo SOLO se l'utente ha filtrato per un conto specifico.
  // Carico TUTTI i movimenti di quel conto in ordine cronologico ASC (a prescindere
  // dagli altri filtri di visualizzazione) e compongo una mappa txId → saldo dopo l'operazione.
  let runningBalanceMap: Map<string, number> | null = null;
  let accountInitialBalance: number | null = null;
  let accountCurrentBalance: number | null = null;
  if (conto !== "all") {
    const account = await prisma.bankAccount.findFirst({
      where: { id: conto, holderId },
      select: { id: true, initialBalance: true },
    });
    if (account) {
      accountInitialBalance = account.initialBalance;
      const allForAcc = await prisma.transaction.findMany({
        where: { holderId, bankAccountId: conto },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        select: { id: true, amount: true, type: true },
      });
      runningBalanceMap = new Map<string, number>();
      let bal = account.initialBalance;
      for (const t of allForAcc) {
        bal += t.type === "income" ? t.amount : -t.amount;
        runningBalanceMap.set(t.id, Math.round(bal * 100) / 100);
      }
      accountCurrentBalance = bal;
    }
  }

  // Per i movimenti che fanno parte di un giroconto, troviamo il nome del
  // conto contropartita (il sibling con lo stesso transferGroupId su un
  // bankAccountId diverso). Una query unica per tutti i transferGroupId
  // visibili nella pagina corrente.
  const transferGroupIds = Array.from(
    new Set(
      txs
        .map((t) => t.transferGroupId)
        .filter((g): g is string => typeof g === "string" && g.length > 0),
    ),
  );
  const siblingByGroup = new Map<
    string,
    { thisId: string; otherBankAccountName: string; otherBankAccountId: string; otherTxId: string }[]
  >();
  if (transferGroupIds.length > 0) {
    const siblings = await prisma.transaction.findMany({
      where: { holderId, transferGroupId: { in: transferGroupIds } },
      select: {
        id: true,
        transferGroupId: true,
        bankAccountId: true,
        bankAccount: { select: { name: true } },
      },
    });
    // Indicizziamo i due lati per group: ognuno vede l'altro come "contropartita".
    const byGroup = new Map<string, typeof siblings>();
    for (const s of siblings) {
      if (!s.transferGroupId) continue;
      const list = byGroup.get(s.transferGroupId) ?? [];
      list.push(s);
      byGroup.set(s.transferGroupId, list);
    }
    for (const [gid, list] of byGroup) {
      siblingByGroup.set(
        gid,
        list.flatMap((self) =>
          list
            .filter((o) => o.id !== self.id)
            .map((o) => ({
              thisId: self.id,
              otherTxId: o.id,
              otherBankAccountId: o.bankAccountId,
              otherBankAccountName: o.bankAccount.name,
            })),
        ),
      );
    }
  }

  const rows: MovimentoRow[] = txs.map((t) => {
    const tg = t.transferGroupId;
    const sib = tg ? siblingByGroup.get(tg)?.find((s) => s.thisId === t.id) : undefined;
    return {
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      description: t.description,
      amount: t.amount,
      type: t.type as "income" | "expense",
      categoryId: t.categoryId,
      categoryName: t.category.name,
      categoryType: t.category.type as "income" | "expense",
      bankAccountId: t.bankAccountId,
      bankAccountName: t.bankAccount.name,
      paymentMethodId: t.paymentMethodId,
      paymentMethodName: t.paymentMethod?.name ?? null,
      notes: t.notes,
      reconciled: t.reconciled,
      reconciledAt: t.reconciledAt ? t.reconciledAt.toISOString() : null,
      reconciliationNote: t.reconciliationNote,
      runningBalance: runningBalanceMap ? runningBalanceMap.get(t.id) ?? null : null,
      transferGroupId: tg ?? null,
      counterpartBankAccountId: sib?.otherBankAccountId ?? null,
      counterpartBankAccountName: sib?.otherBankAccountName ?? null,
      // Origine: psd2 (sync banca) > import (file) > manual. Mutuamente
      // esclusivi nel modello, ma per sicurezza valutiamo psd2 prima.
      source: t.bankConnectionId
        ? ("psd2" as const)
        : t.importBatchId
          ? ("import" as const)
          : ("manual" as const),
      sourceLabel: t.bankConnection?.aspspName ?? t.importBatch?.fileName ?? null,
    };
  });

  const accountInfo =
    conto !== "all" && accountInitialBalance !== null
      ? {
          name: accounts.find((a) => a.id === conto)?.name ?? "",
          initialBalance: accountInitialBalance,
          currentBalance: accountCurrentBalance ?? accountInitialBalance,
        }
      : null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Periodo: ultimi 18 mesi + "all"
  const todayYm = ymKey(new Date());
  const periodOpts: string[] = [];
  for (let i = 0; i < 18; i++) periodOpts.push(shiftYm(todayYm, i));

  const periodRangeLabel =
    period !== "all" && period.includes("..")
      ? (() => {
          const { from, to } = parsePeriod(period);
          return fmtPeriodLabel(from, to);
        })()
      : null;

  // Conteggio filtri attivi (esclude Periodo, quasi sempre valorizzato) per il
  // badge del toggle "Filtri" su mobile.
  const activeFilterCount =
    (tipo !== "all" ? 1 : 0) +
    (conto !== "all" ? 1 : 0) +
    (cat !== "all" ? 1 : 0) +
    (mod !== "all" ? 1 : 0) +
    (q ? 1 : 0) +
    (ric !== "all" ? 1 : 0) +
    (origine !== "all" ? 1 : 0) +
    (dashboard !== "all" ? 1 : 0) +
    (ricNote ? 1 : 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">Anagrafica</div>
          <h1 className="text-xl font-semibold tracking-tight">Movimenti</h1>
        </div>
        <div className="text-xs text-sub">
          {total.toLocaleString("it-IT")} risultati · pagina {page} / {totalPages}
        </div>
      </div>

      {/* Filtri (form GET con URL persistente) */}
      <form
        action="/movimenti"
        className="panel p-3 mb-3 flex flex-wrap gap-2 items-end"
      >
        <FilterDisclosure activeCount={activeFilterCount}>
        <FilterField label="Periodo">
          <select
            name="period"
            defaultValue={period}
            className="input !h-8 !py-0 min-w-[140px]"
          >
            <option value="all">Tutti</option>
            {periodOpts.map((p) => (
              <option key={p} value={p}>
                {fmtMonthLong(p)}
              </option>
            ))}
            {periodRangeLabel && (
              <option value={period}>{periodRangeLabel}</option>
            )}
          </select>
        </FilterField>
        <FilterField label="Tipo">
          <select
            name="tipo"
            defaultValue={tipo}
            className="input !h-8 !py-0 min-w-[110px]"
          >
            <option value="all">Tutti</option>
            <option value="income">Entrate</option>
            <option value="expense">Uscite</option>
          </select>
        </FilterField>
        <FilterField label="Conto">
          <select
            name="conto"
            defaultValue={conto}
            className="input !h-8 !py-0 min-w-[140px]"
          >
            <option value="all">Tutti</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Categoria">
          <select
            name="cat"
            defaultValue={cat}
            className="input !h-8 !py-0 min-w-[160px]"
          >
            <option value="all">Tutte</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.type === "income" ? "↗" : "↘"}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Modalità">
          <select
            name="mod"
            defaultValue={mod}
            className="input !h-8 !py-0 min-w-[140px]"
          >
            <option value="all">Tutte</option>
            {paymentMethods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Cerca">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="testo descrizione…"
            className="input !h-8 !py-0 w-56"
          />
        </FilterField>
        <FilterField label="Riconc.">
          <select
            name="ric"
            defaultValue={ric}
            className="input !h-8 !py-0 min-w-[140px]"
          >
            <option value="all">Tutti</option>
            <option value="1">Riconciliati</option>
            <option value="0">Da riconciliare</option>
          </select>
        </FilterField>
        <FilterField label="Origine">
          <select
            name="origine"
            defaultValue={origine}
            className="input !h-8 !py-0 min-w-[140px]"
          >
            <option value="all">Tutte</option>
            <option value="manual">Manuale</option>
            <option value="import">Importato (file)</option>
            <option value="psd2">PSD2 (banca)</option>
          </select>
        </FilterField>
        <FilterField label="Dashboard">
          <select
            name="dashboard"
            defaultValue={dashboard}
            className="input !h-8 !py-0 min-w-[160px]"
          >
            <option value="all">Tutte</option>
            <option value="excluded">Escluse dalla dashboard</option>
          </select>
        </FilterField>
        <FilterField label="Nota riconc.">
          <input
            type="text"
            name="ricNote"
            defaultValue={ricNote}
            placeholder='es. "e/c aprile"'
            className="input !h-8 !py-0 w-44"
          />
        </FilterField>
        <button type="submit" className="btn !h-8 !text-xs">
          Applica
        </button>
        <a href="/movimenti" className="btn-ghost !h-8 !text-xs">
          Reset
        </a>
        </FilterDisclosure>
      </form>

      {/* Riassunto aggregato sul set filtrato (intero, non solo pagina corrente) */}
      <div className="panel grid grid-cols-2 sm:grid-cols-4 mb-3 overflow-hidden">
        <SummaryCell
          label="Movimenti filtrati"
          value={fmtN0(total)}
          sub={
            total === 0
              ? "Nessun risultato"
              : total === 1
                ? "1 movimento"
                : `${fmtN0(total)} movimenti`
          }
        />
        <SummaryCell
          label="Totale entrate"
          value={`+ ${fmtEURFull(totalIncome)}`}
          cls="delta-up"
          isLast={false}
        />
        <SummaryCell
          label="Totale uscite"
          value={`- ${fmtEURFull(totalExpense)}`}
          cls="delta-down"
          isLast={false}
        />
        <SummaryCell
          label="Saldo netto"
          value={(netBalance >= 0 ? "+ " : "- ") + fmtEURFull(Math.abs(netBalance))}
          cls={netBalance >= 0 ? "delta-up" : "delta-down"}
          isLast={true}
        />
      </div>

      <MovimentiClient
        rows={rows}
        categories={categories}
        accounts={accounts}
        paymentMethods={paymentMethods.map((p) => ({ ...p, type: undefined }))}
        accountInfo={accountInfo}
      />

      {/* Paginazione */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-xs">
          <PageLink
            page={page - 1}
            disabled={page <= 1}
            params={{ period, conto, cat, mod, tipo, q, ric, ricNote, dashboard }}
            label="← Prec."
          />
          <span className="text-sub">
            Pagina {page} / {totalPages}
          </span>
          <PageLink
            page={page + 1}
            disabled={page >= totalPages}
            params={{ period, conto, cat, mod, tipo, q, ric, ricNote, dashboard }}
            label="Succ. →"
          />
        </div>
      )}
    </div>
  );
}

function SummaryCell({
  label,
  value,
  sub,
  cls,
  isLast = false,
}: {
  label: string;
  value: string;
  sub?: string;
  cls?: string;
  isLast?: boolean;
}) {
  return (
    <div className={`px-4 py-3 ${isLast ? "" : "border-r border-line2"}`}>
      <div className="ph">{label}</div>
      <div className={`text-2xl font-semibold mt-1 num ${cls ?? ""}`}>
        {value}
      </div>
      {sub && <div className="text-[12px] text-sub mt-0.5">{sub}</div>}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-sub font-semibold">
        {label}
      </span>
      {children}
    </label>
  );
}

function PageLink({
  page,
  disabled,
  params,
  label,
}: {
  page: number;
  disabled: boolean;
  params: Record<string, string>;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="btn-ghost !h-7 !text-xs opacity-40 cursor-not-allowed">
        {label}
      </span>
    );
  }
  const search = new URLSearchParams({ ...params, page: String(page) }).toString();
  return (
    <a href={`/movimenti?${search}`} className="btn-ghost !h-7 !text-xs">
      {label}
    </a>
  );
}
