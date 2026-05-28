/**
 * Logica condivisa per importare un registro_spese.xlsm nel DB di un utente.
 * Usata sia dall'API /api/import che dallo script CLI scripts/import-excel.ts.
 */
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { NO_BUDGET_DEFAULT } from "@/lib/budget";

export type ImportResult = {
  accounts: number;
  categories: number;
  paymentMethods: number;
  transactions: number;
  skipped: number;
};

/** Normalizza una stringa rimuovendo spazi extra; ritorna null se vuota */
const norm = (s: any): string | null => {
  if (s === null || s === undefined) return null;
  const v = String(s).trim();
  return v.length ? v : null;
};

/** Converte una cella Excel in Date. Excel salva le date come numeri seriali. */
function excelDate(v: any): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel epoch 1899-12-30
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms);
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function importExcelForHolder(
  holderId: string,
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<ImportResult> {
  // Verifico che l'Holder esista
  const holder = await prisma.holder.findUnique({
    where: { id: holderId },
    select: { id: true },
  });
  if (!holder) throw new Error(`Holder ${holderId} non trovato`);

  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const result: ImportResult = {
    accounts: 0,
    categories: 0,
    paymentMethods: 0,
    transactions: 0,
    skipped: 0,
  };

  // ---- 1) CATEGORIE ----
  const sheetCat = wb.Sheets["Categorie"];
  if (sheetCat) {
    const rows = XLSX.utils.sheet_to_json<any[]>(sheetCat, { header: 1 });
    // Le prime 2 righe sono titolo+vuota, riga 3 è header. Iniziamo da riga 4.
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const name = norm(r?.[0]);
      const tipo = norm(r?.[1]); // "Entrata" | "Uscita"
      const dashFlag = norm(r?.[2]); // "S" | "N"
      if (!name || !tipo) continue;
      const type = tipo.toLowerCase().startsWith("e") ? "income" : "expense";
      const showInDashboard = dashFlag === "S";
      const hasBudget = !NO_BUDGET_DEFAULT.has(name);
      await prisma.category.upsert({
        where: { holderId_name: { holderId, name } },
        update: { type, showInDashboard },
        create: { holderId, name, type, showInDashboard, hasBudget },
      });
      result.categories++;
    }
  }

  // ---- 2) CONTI ----
  const sheetConti = wb.Sheets["Conti"];
  if (sheetConti) {
    const rows = XLSX.utils.sheet_to_json<any[]>(sheetConti, { header: 1 });
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const name = norm(r?.[0]);
      if (!name) continue;
      const initialBalance = Number(r?.[1]) || 0;
      const notes = norm(r?.[2]);
      // Tipo dedotto dal nome
      const lower = name.toLowerCase();
      const type = lower.includes("carta")
        ? "credit_card"
        : lower.includes("deposito") || lower.includes("vincolato") || lower.includes("scalable")
        ? "savings"
        : lower.includes("cassa")
        ? "cash"
        : "liquidity";
      await prisma.bankAccount.upsert({
        where: { holderId_name: { holderId, name } },
        update: { initialBalance, notes, type },
        create: { holderId, name, initialBalance, notes, type },
      });
      result.accounts++;
    }
  }

  // ---- 3) MODALITÀ DI PAGAMENTO ----
  const sheetMod = wb.Sheets["Modalità"] || wb.Sheets["Modalita"];
  if (sheetMod) {
    const rows = XLSX.utils.sheet_to_json<any[]>(sheetMod, { header: 1 });
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const name = norm(r?.[0]);
      if (!name) continue;
      const notes = norm(r?.[1]);
      await prisma.paymentMethod.upsert({
        where: { holderId_name: { holderId, name } },
        update: { notes },
        create: { holderId, name, notes },
      });
      result.paymentMethods++;
    }
  }

  // ---- 4) MOVIMENTI ----
  const sheetMov = wb.Sheets["Movimenti"];
  if (sheetMov) {
    const rows = XLSX.utils.sheet_to_json<any[]>(sheetMov, { header: 1 });
    // Cache: name → id, per categorie/conti/modalità
    const cats = new Map(
      (await prisma.category.findMany({ where: { holderId } })).map((c) => [c.name, c.id]),
    );
    const accs = new Map(
      (await prisma.bankAccount.findMany({ where: { holderId } })).map((a) => [a.name, a.id]),
    );
    const mods = new Map(
      (await prisma.paymentMethod.findMany({ where: { holderId } })).map((m) => [m.name, m.id]),
    );

    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const date = excelDate(r?.[0]);
      const desc = norm(r?.[1]);
      const catName = norm(r?.[2]);
      const tipo = norm(r?.[3]); // Entrata | Uscita
      const accName = norm(r?.[4]);
      const modName = norm(r?.[5]);
      const amount = Number(r?.[6]);
      const notes = norm(r?.[7]);
      if (!date || !catName || !accName || !amount) {
        result.skipped++;
        continue;
      }
      const catId = cats.get(catName);
      const accId = accs.get(accName);
      if (!catId || !accId) {
        result.skipped++;
        continue;
      }
      const modId = modName ? mods.get(modName) : undefined;
      const type = tipo?.toLowerCase().startsWith("e") ? "income" : "expense";
      await prisma.transaction.create({
        data: {
          holderId,
          date,
          description: desc || "(senza descrizione)",
          categoryId: catId,
          bankAccountId: accId,
          paymentMethodId: modId,
          amount: Math.abs(amount),
          type,
          notes,
        },
      });
      result.transactions++;
    }
  }

  return result;
}
