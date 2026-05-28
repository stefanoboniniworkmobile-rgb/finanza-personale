import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getActiveHolder } from "@/lib/holder";
import { TemplateForm } from "@/components/importazioni/TemplateForm";
import { MappingsManager } from "@/components/importazioni/MappingsManager";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;
  const { id } = await params;

  const [tpl, accounts, categories, paymentMethods] = await Promise.all([
    prisma.importTemplate.findFirst({
      where: { id, holderId },
      include: {
        mappings: {
          include: {
            bankAccount: { select: { id: true, name: true } },
            category: { select: { id: true, name: true, type: true } },
            paymentMethod: { select: { id: true, name: true } },
          },
          orderBy: [{ kind: "asc" }, { sourceValueNorm: "asc" }],
        },
      },
    }),
    prisma.bankAccount.findMany({
      where: { holderId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({
      where: { holderId },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
    prisma.paymentMethod.findMany({
      where: { holderId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!tpl) notFound();

  const categoriesExpense = categories.filter((c) => c.type === "expense");
  const categoriesIncome = categories.filter((c) => c.type === "income");

  const mappingsForUi = tpl.mappings.map((m) => ({
    id: m.id,
    kind: m.kind as "ACCOUNT" | "CATEGORY" | "PAYMENT_METHOD",
    matchType: (m.matchType ?? "EXACT") as
      | "EXACT"
      | "CONTAINS"
      | "STARTS_WITH"
      | "REGEX",
    sourceValueRaw: m.sourceValueRaw,
    targetId:
      m.bankAccountId ?? m.categoryId ?? m.paymentMethodId ?? "",
    targetName:
      m.bankAccount?.name ?? m.category?.name ?? m.paymentMethod?.name ?? "",
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">
            <Link href="/importazioni/templates" className="hover:underline">
              Template di import
            </Link>{" "}
            / Modifica
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{tpl.name}</h1>
          {tpl.sourceLabel && (
            <div className="text-sm text-sub">{tpl.sourceLabel}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/importazioni/nuovo?templateId=${tpl.id}`} className="btn">
            Importa con questo template
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr,3fr] gap-4">
        <div>
          <TemplateForm
            initial={{
              id: tpl.id,
              name: tpl.name,
              sourceLabel: tpl.sourceLabel,
              fileType: tpl.fileType as any,
              sheetName: tpl.sheetName,
              headerRow: tpl.headerRow,
              delimiter: tpl.delimiter,
              encoding: tpl.encoding,
              decimalSep: tpl.decimalSep,
              thousandsSep: tpl.thousandsSep,
              dateFormat: tpl.dateFormat as any,
              signMode: tpl.signMode as any,
              colDate: tpl.colDate,
              colDescription: tpl.colDescription,
              colAmount: tpl.colAmount,
              colDebit: tpl.colDebit,
              colCredit: tpl.colCredit,
              colType: tpl.colType,
              typeIncomeValue: tpl.typeIncomeValue,
              typeExpenseValue: tpl.typeExpenseValue,
              colAccount: tpl.colAccount,
              colCategory: tpl.colCategory,
              colPaymentMethod: tpl.colPaymentMethod,
              colNotes: tpl.colNotes,
              defaultBankAccountId: tpl.defaultBankAccountId,
              defaultCategoryExpenseId: tpl.defaultCategoryExpenseId,
              defaultCategoryIncomeId: tpl.defaultCategoryIncomeId,
              defaultPaymentMethodId: tpl.defaultPaymentMethodId,
              forceAbs: tpl.forceAbs,
              invertSigns: tpl.invertSigns,
              skipRowsContaining: tpl.skipRowsContaining,
            }}
            accounts={accounts}
            categoriesExpense={categoriesExpense}
            categoriesIncome={categoriesIncome}
            paymentMethods={paymentMethods}
          />
        </div>

        <div>
          <MappingsManager
            templateId={tpl.id}
            mappings={mappingsForUi}
            accounts={accounts}
            categoriesExpense={categoriesExpense}
            categoriesIncome={categoriesIncome}
            paymentMethods={paymentMethods}
          />
        </div>
      </div>
    </div>
  );
}
