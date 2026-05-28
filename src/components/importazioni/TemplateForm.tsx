"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTemplate, type TemplateInput } from "@/app/(app)/importazioni/actions";

export type Option = { id: string; name: string };

export type TemplateFormInitial = Partial<TemplateInput> & { id?: string };

export function TemplateForm({
  initial,
  accounts,
  categoriesExpense,
  categoriesIncome,
  paymentMethods,
}: {
  initial?: TemplateFormInitial;
  accounts: Option[];
  categoriesExpense: Option[];
  categoriesIncome: Option[];
  paymentMethods: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [sourceLabel, setSourceLabel] = useState(initial?.sourceLabel ?? "");
  const [fileType, setFileType] = useState<"csv" | "xlsx">(
    (initial?.fileType as any) ?? "csv",
  );

  const [sheetName, setSheetName] = useState(initial?.sheetName ?? "");
  const [headerRow, setHeaderRow] = useState<number>(initial?.headerRow ?? 1);
  const [delimiter, setDelimiter] = useState(initial?.delimiter ?? ",");
  const [encoding, setEncoding] = useState(initial?.encoding ?? "utf-8");
  const [decimalSep, setDecimalSep] = useState(initial?.decimalSep ?? ",");
  const [thousandsSep, setThousandsSep] = useState(initial?.thousandsSep ?? ".");
  const [dateFormat, setDateFormat] = useState(initial?.dateFormat ?? "DD/MM/YYYY");

  const [signMode, setSignMode] = useState<"SIGNED" | "DEBIT_CREDIT" | "AMOUNT_PLUS_TYPE">(
    (initial?.signMode as any) ?? "SIGNED",
  );

  const [colDate, setColDate] = useState(initial?.colDate ?? "");
  const [colDescription, setColDescription] = useState(initial?.colDescription ?? "");
  const [colAmount, setColAmount] = useState(initial?.colAmount ?? "");
  const [colDebit, setColDebit] = useState(initial?.colDebit ?? "");
  const [colCredit, setColCredit] = useState(initial?.colCredit ?? "");
  const [colType, setColType] = useState(initial?.colType ?? "");
  const [typeIncomeValue, setTypeIncomeValue] = useState(initial?.typeIncomeValue ?? "");
  const [typeExpenseValue, setTypeExpenseValue] = useState(initial?.typeExpenseValue ?? "");

  const [colAccount, setColAccount] = useState(initial?.colAccount ?? "");
  const [colCategory, setColCategory] = useState(initial?.colCategory ?? "");
  const [colPaymentMethod, setColPaymentMethod] = useState(initial?.colPaymentMethod ?? "");
  const [colNotes, setColNotes] = useState(initial?.colNotes ?? "");

  const [defaultBankAccountId, setDefaultBankAccountId] = useState(
    initial?.defaultBankAccountId ?? "",
  );
  const [defaultCategoryExpenseId, setDefaultCategoryExpenseId] = useState(
    initial?.defaultCategoryExpenseId ?? "",
  );
  const [defaultCategoryIncomeId, setDefaultCategoryIncomeId] = useState(
    initial?.defaultCategoryIncomeId ?? "",
  );
  const [defaultPaymentMethodId, setDefaultPaymentMethodId] = useState(
    initial?.defaultPaymentMethodId ?? "",
  );
  const [forceAbs, setForceAbs] = useState<boolean>(initial?.forceAbs ?? true);
  const [invertSigns, setInvertSigns] = useState<boolean>(initial?.invertSigns ?? false);
  const [skipRowsContaining, setSkipRowsContaining] = useState(initial?.skipRowsContaining ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: TemplateInput = {
      id: initial?.id,
      name,
      sourceLabel: sourceLabel || null,
      fileType,
      sheetName: fileType === "xlsx" ? sheetName || null : null,
      headerRow,
      delimiter,
      encoding,
      decimalSep,
      thousandsSep,
      dateFormat: dateFormat as any,
      signMode,
      colDate,
      colDescription,
      colAmount: colAmount || null,
      colDebit: colDebit || null,
      colCredit: colCredit || null,
      colType: colType || null,
      typeIncomeValue: typeIncomeValue || null,
      typeExpenseValue: typeExpenseValue || null,
      colAccount: colAccount || null,
      colCategory: colCategory || null,
      colPaymentMethod: colPaymentMethod || null,
      colNotes: colNotes || null,
      defaultBankAccountId: defaultBankAccountId || null,
      defaultCategoryExpenseId: defaultCategoryExpenseId || null,
      defaultCategoryIncomeId: defaultCategoryIncomeId || null,
      defaultPaymentMethodId: defaultPaymentMethodId || null,
      forceAbs,
      invertSigns,
      skipRowsContaining: skipRowsContaining || null,
    };
    startTransition(async () => {
      const r = await saveTemplate(payload);
      if (!r.ok) setError(r.error);
      else router.push(`/importazioni/templates/${r.id}`);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Intestazione: identità del template */}
      <Section title="Identità" hint="Come chiami questo template e da dove arriva.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome">
            <input
              type="text"
              required
              maxLength={80}
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Es. Revolut CSV"
            />
          </Field>
          <Field label="Descrizione fonte (opzionale)">
            <input
              type="text"
              maxLength={200}
              className="input w-full"
              value={sourceLabel ?? ""}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="Es. Estratto carta personale, formato XYZ"
            />
          </Field>
        </div>
      </Section>

      {/* Parsing */}
      <Section title="Lettura file" hint="Come è fatto il file in input.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo file">
            <select
              className="input w-full"
              value={fileType}
              onChange={(e) => setFileType(e.target.value as any)}
            >
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (XLSX/XLS)</option>
            </select>
          </Field>
          <Field label="Riga delle intestazioni">
            <input
              type="number"
              min={1}
              max={50}
              className="input w-full"
              value={headerRow}
              onChange={(e) => setHeaderRow(Number(e.target.value) || 1)}
            />
          </Field>
        </div>

        {fileType === "csv" ? (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Delimitatore">
              <select
                className="input w-full"
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
              >
                <option value=",">Virgola ( , )</option>
                <option value=";">Punto e virgola ( ; )</option>
                <option value={"\t"}>Tabulazione</option>
                <option value="|">Pipe ( | )</option>
              </select>
            </Field>
            <Field label="Encoding">
              <select
                className="input w-full"
                value={encoding}
                onChange={(e) => setEncoding(e.target.value)}
              >
                <option value="utf-8">UTF-8</option>
                <option value="latin1">ISO-8859-1 (Latin1)</option>
                <option value="windows-1252">Windows-1252</option>
              </select>
            </Field>
            <Field label="Formato data">
              <select
                className="input w-full"
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="DD-MM-YYYY">DD-MM-YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                <option value="AUTO">Auto</option>
              </select>
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nome foglio (opzionale)">
              <input
                type="text"
                className="input w-full"
                value={sheetName ?? ""}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="Vuoto = primo foglio"
              />
            </Field>
            <Field label="Formato data">
              <select
                className="input w-full"
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="DD-MM-YYYY">DD-MM-YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                <option value="AUTO">Auto</option>
              </select>
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Separatore decimale negli importi">
            <select
              className="input w-full"
              value={decimalSep}
              onChange={(e) => setDecimalSep(e.target.value)}
            >
              <option value=",">Virgola — 1.234,56 (formato italiano)</option>
              <option value=".">Punto — 1,234.56 (formato US/UK)</option>
            </select>
          </Field>
          <Field label="Separatore migliaia">
            <select
              className="input w-full"
              value={thousandsSep}
              onChange={(e) => setThousandsSep(e.target.value)}
            >
              <option value=".">Punto</option>
              <option value=",">Virgola</option>
              <option value=" ">Spazio</option>
              <option value="">Nessuno</option>
            </select>
          </Field>
        </div>
      </Section>

      {/* Colonne obbligatorie */}
      <Section
        title="Colonne obbligatorie"
        hint="Indica i nomi delle intestazioni così come sono scritte nel file (case-insensitive)."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data">
            <input
              type="text"
              required
              className="input w-full"
              value={colDate}
              onChange={(e) => setColDate(e.target.value)}
              placeholder="Es. Data, Date, Data Operazione"
            />
          </Field>
          <Field label="Descrizione">
            <input
              type="text"
              required
              className="input w-full"
              value={colDescription}
              onChange={(e) => setColDescription(e.target.value)}
              placeholder="Es. Descrizione, Causale, Merchant"
            />
          </Field>
        </div>
      </Section>

      {/* Importo */}
      <Section
        title="Importo e segno"
        hint="Come distingue il file le entrate dalle uscite."
      >
        <div className="flex gap-2">
          <SignTab active={signMode === "SIGNED"} onClick={() => setSignMode("SIGNED")}>
            Una colonna con segno (+/-)
          </SignTab>
          <SignTab
            active={signMode === "DEBIT_CREDIT"}
            onClick={() => setSignMode("DEBIT_CREDIT")}
          >
            Due colonne Dare/Avere
          </SignTab>
          <SignTab
            active={signMode === "AMOUNT_PLUS_TYPE"}
            onClick={() => setSignMode("AMOUNT_PLUS_TYPE")}
          >
            Importo + colonna tipo
          </SignTab>
        </div>

        {signMode === "SIGNED" && (
          <Field label="Colonna importo">
            <input
              type="text"
              required
              className="input w-full"
              value={colAmount}
              onChange={(e) => setColAmount(e.target.value)}
              placeholder="Es. Importo, Amount"
            />
          </Field>
        )}
        {signMode === "DEBIT_CREDIT" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Colonna Dare (uscite)">
              <input
                type="text"
                required
                className="input w-full"
                value={colDebit}
                onChange={(e) => setColDebit(e.target.value)}
                placeholder="Es. Dare, Addebiti"
              />
            </Field>
            <Field label="Colonna Avere (entrate)">
              <input
                type="text"
                required
                className="input w-full"
                value={colCredit}
                onChange={(e) => setColCredit(e.target.value)}
                placeholder="Es. Avere, Accrediti"
              />
            </Field>
          </div>
        )}
        {signMode === "AMOUNT_PLUS_TYPE" && (
          <>
            <Field label="Colonna importo">
              <input
                type="text"
                required
                className="input w-full"
                value={colAmount}
                onChange={(e) => setColAmount(e.target.value)}
                placeholder="Es. Importo"
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Colonna tipo">
                <input
                  type="text"
                  required
                  className="input w-full"
                  value={colType}
                  onChange={(e) => setColType(e.target.value)}
                  placeholder="Es. Tipo, Direzione, D/A"
                />
              </Field>
              <Field label="Valore = Entrata">
                <input
                  type="text"
                  required
                  className="input w-full"
                  value={typeIncomeValue}
                  onChange={(e) => setTypeIncomeValue(e.target.value)}
                  placeholder="Es. A, IN, Avere"
                />
              </Field>
              <Field label="Valore = Uscita">
                <input
                  type="text"
                  required
                  className="input w-full"
                  value={typeExpenseValue}
                  onChange={(e) => setTypeExpenseValue(e.target.value)}
                  placeholder="Es. D, OUT, Dare"
                />
              </Field>
            </div>
          </>
        )}

        <label className="flex items-center gap-2 text-[12px] text-sub mt-2">
          <input
            type="checkbox"
            checked={forceAbs}
            onChange={(e) => setForceAbs(e.target.checked)}
          />
          Forza valore assoluto sui campi numerici (utile se i segni nel file sono incoerenti)
        </label>

        <label className="flex items-start gap-2 text-[12px] text-sub mt-1">
          <input
            type="checkbox"
            className="mt-[3px]"
            checked={invertSigns}
            onChange={(e) => setInvertSigns(e.target.checked)}
          />
          <span>
            Inverti il segno (uscite con segno <strong>positivo</strong>, entrate con segno <strong>negativo</strong>)
            <span className="block text-[11px] text-sub/80">
              Utile per estratti in cui i prelievi e gli addebiti sono indicati con il + e gli accrediti con il −.
            </span>
          </span>
        </label>

        <Field label="Salta righe contenenti (opzionale)">
          <input
            type="text"
            maxLength={80}
            className="input w-full"
            value={skipRowsContaining ?? ""}
            onChange={(e) => setSkipRowsContaining(e.target.value)}
            placeholder='Es. "Totale" — case-insensitive, in qualunque cella'
          />
        </Field>
      </Section>

      {/* Colonne lookup (opzionali) */}
      <Section
        title="Mappatura entità (opzionale)"
        hint="Indica le colonne del file che contengono Conto, Categoria e Modalità di pagamento. Le equivalenze testo → entità app le configuri nella sezione Mapping di questo template."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Colonna conto">
            <input
              type="text"
              className="input w-full"
              value={colAccount}
              onChange={(e) => setColAccount(e.target.value)}
              placeholder="Vuoto = usa il default qui sotto"
            />
          </Field>
          <Field label="Colonna categoria">
            <input
              type="text"
              className="input w-full"
              value={colCategory}
              onChange={(e) => setColCategory(e.target.value)}
            />
          </Field>
          <Field label="Colonna modalità di pagamento">
            <input
              type="text"
              className="input w-full"
              value={colPaymentMethod}
              onChange={(e) => setColPaymentMethod(e.target.value)}
            />
          </Field>
          <Field label="Colonna note (opzionale)">
            <input
              type="text"
              className="input w-full"
              value={colNotes}
              onChange={(e) => setColNotes(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      {/* Default */}
      <Section
        title="Valori di default"
        hint="Usati quando la colonna corrispondente è vuota o nessun mapping ha trovato match. Il conto è sempre richiesto."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Conto di default">
            <select
              className="input w-full"
              value={defaultBankAccountId ?? ""}
              onChange={(e) => setDefaultBankAccountId(e.target.value)}
            >
              <option value="">— nessuno —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Modalità di pagamento di default">
            <select
              className="input w-full"
              value={defaultPaymentMethodId ?? ""}
              onChange={(e) => setDefaultPaymentMethodId(e.target.value)}
            >
              <option value="">— nessuna —</option>
              {paymentMethods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoria di default per le uscite">
            <select
              className="input w-full"
              value={defaultCategoryExpenseId ?? ""}
              onChange={(e) => setDefaultCategoryExpenseId(e.target.value)}
            >
              <option value="">— nessuna —</option>
              {categoriesExpense.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoria di default per le entrate">
            <select
              className="input w-full"
              value={defaultCategoryIncomeId ?? ""}
              onChange={(e) => setDefaultCategoryIncomeId(e.target.value)}
            >
              <option value="">— nessuna —</option>
              {categoriesIncome.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {error && (
        <div className="text-sm px-3 py-2 rounded-md bg-err-50 text-err-600 border border-err-100">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => router.push("/importazioni/templates")}
          disabled={pending}
        >
          Annulla
        </button>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Salvataggio…" : initial?.id ? "Salva modifiche" : "Crea template"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel p-5 space-y-3">
      <div>
        <div className="font-semibold text-sm">{title}</div>
        {hint && <div className="text-[12px] text-sub">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-sub mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}

function SignTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 h-9 rounded-md text-xs font-medium border transition ${
        active
          ? "bg-brand-50 border-brand-500 text-brand-600"
          : "bg-white border-line text-sub hover:bg-bg"
      }`}
    >
      {children}
    </button>
  );
}
