/**
 * Client Enable Banking — wrapper minimale delle API PSD2 che ci servono.
 *
 * Documentazione di riferimento: https://enablebanking.com/docs/api/reference/
 *
 * Auth: ogni richiesta è autenticata via Bearer JWT firmato con la private key RSA
 * dell'application. Il JWT viene generato al volo (validità 1 ora, ben sotto il
 * max 24h imposto dalla API).
 *
 * Configurazione richiesta (env vars):
 *  - ENABLE_BANKING_APP_ID         : UUID dell'application (kid del JWT)
 *  - PRIVATE KEY — uno dei due:
 *      * ENABLE_BANKING_PRIVATE_KEY_PEM  : contenuto del .pem come stringa
 *                                         (richiesto in prod su Vercel —
 *                                          niente filesystem persistente)
 *      * ENABLE_BANKING_PRIVATE_KEY_PATH : path assoluto al file .pem
 *                                         (comodo in dev locale)
 *    Se sono presenti entrambi, PEM ha precedenza.
 *  - ENABLE_BANKING_BASE_URL       : opzionale, default https://api.tilisy.com
 */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

// Env vars risolte lazy (al primo uso) e non al module-load:
// gli import ES sono hoisted, quindi se leggessimo process.env al top-level
// gli script CLI che caricano .env.local manualmente non funzionerebbero.
function requireEnv(): { appId: string; baseUrl: string } {
  const appId = process.env.ENABLE_BANKING_APP_ID;
  const baseUrl = process.env.ENABLE_BANKING_BASE_URL ?? "https://api.tilisy.com";
  if (!appId) {
    throw new Error("ENABLE_BANKING_APP_ID non configurato");
  }
  return { appId, baseUrl };
}

// La private key viene letta una sola volta e tenuta in memoria del processo.
// Prima cerca il valore stringa diretto (prod Vercel), poi fa fallback su file
// (dev locale). Lancia errore esplicito se nessuno dei due è configurato.
let cachedKey: string | null = null;
function getPrivateKey(): string {
  if (cachedKey) return cachedKey;
  const pem = process.env.ENABLE_BANKING_PRIVATE_KEY_PEM;
  if (pem && pem.includes("BEGIN")) {
    cachedKey = pem;
    return cachedKey;
  }
  const keyPath = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;
  if (keyPath) {
    cachedKey = readFileSync(keyPath, "utf-8");
    return cachedKey;
  }
  throw new Error(
    "Private key Enable Banking non configurata: imposta ENABLE_BANKING_PRIVATE_KEY_PEM (prod) o ENABLE_BANKING_PRIVATE_KEY_PATH (dev)",
  );
}

// ===== JWT helpers =====

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Genera un JWT valido per `ttlSec` secondi (default 1h, max 86400).
 * Firma RS256 con la private key dell'application.
 */
export function makeJwt(ttlSec: number = 3600): string {
  const { appId } = requireEnv();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }),
  );
  const payload = base64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.tilisy.com",
      iat: now,
      exp: now + Math.min(ttlSec, 86400),
    }),
  );
  const data = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = base64url(signer.sign(getPrivateKey()));
  return `${data}.${sig}`;
}

/** Risolve la base URL al volo (per evitare letture di env al module load). */
function baseUrl(): string {
  return requireEnv().baseUrl;
}

// ===== Low-level fetch wrapper =====

class EnableBankingError extends Error {
  constructor(
    public status: number,
    public path: string,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "EnableBankingError";
  }
}

async function ebFetch<T>(
  path: string,
  init?: RequestInit & { psuHeaders?: Record<string, string> },
): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${makeJwt()}`);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // PSU headers (presenza utente) per evitare rate limit "background"
  if (init?.psuHeaders) {
    for (const [k, v] of Object.entries(init.psuHeaders)) {
      headers.set(k, v);
    }
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    throw new EnableBankingError(
      res.status,
      path,
      `Enable Banking ${res.status} on ${path}: ${text.slice(0, 300)}`,
      parsed,
    );
  }
  return parsed as T;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// ===== Types (subset dei campi che ci servono) =====

export type Aspsp = {
  name: string;
  country: string;
  bic?: string;
  logo?: string;
  psu_types: ("personal" | "business")[];
  auth_methods?: AspspAuthMethod[];
  maximum_consent_validity: number; // secondi (tipicamente 15552000 = 180 gg)
  beta?: boolean;
  // Capabilities esposte dall'integrazione (Enable Banking le restituisce solo se non default)
  required_psu_headers?: string[];
};

export type AspspAuthMethod = {
  name: string;
  title?: string;
  approach: "REDIRECT" | "DECOUPLED" | "EMBEDDED";
  psu_type: "personal" | "business";
  hidden_method?: boolean;
};

export type StartAuthInput = {
  aspsp: { name: string; country: string };
  psu_type?: "personal" | "business";
  auth_method?: string;
  redirect_url: string;
  state?: string;
  valid_until: Date;
  access?: {
    accounts?: Array<{ iban?: string; other?: { identification: string; scheme_name: string } }>;
    balances?: boolean;
    transactions?: boolean;
  };
  language?: string;
};

export type StartAuthResponse = {
  url: string;
  authorization_id: string;
};

export type SessionAccount = {
  uid: string;
  identification_hash: string;
  identification_hashes?: string[];
  account_type?: string;
  cash_account_type?: string;
  currency: string;
  identifications?: Array<{ identification: string; scheme_name: string }>;
  product?: string;
  details?: string;
  usage?: string;
  account_servicer?: { name?: string; bic_fi?: string };
};

export type SessionStatus =
  | "AUTHORIZED"
  | "PENDING_AUTHORIZATION"
  | "INVALID"
  | "CANCELLED"
  | "RETURNED_FROM_BANK"
  | "EXPIRED";

export type Session = {
  session_id: string;
  status: SessionStatus;
  accounts: SessionAccount[];
  aspsp: { name: string; country: string };
  psu_type: "personal" | "business";
  access: {
    valid_until: string; // ISO datetime
    accounts?: unknown[];
    balances?: boolean;
    transactions?: boolean;
  };
  created: string; // ISO
};

export type Transaction = {
  entry_reference?: string;
  transaction_id?: string;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status: "BOOK" | "PDNG" | "INFO" | "OTHR";
  booking_date?: string; // YYYY-MM-DD
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
  remittance_information_unstructured?: string;
  debtor?: { name?: string; account?: Record<string, string> };
  creditor?: { name?: string; account?: Record<string, string> };
  bank_transaction_code?: { description?: string; code?: string };
  // ... molti altri campi opzionali
};

export type TransactionsResponse = {
  transactions: Transaction[];
  continuation_key: string | null;
};

// ===== Public API =====

/** Lista ASPSP disponibili (banche/carte) per un paese. */
export async function listAspsps(country: string = "IT"): Promise<Aspsp[]> {
  const data = await ebFetch<{ aspsps: Aspsp[] }>(
    `/aspsps?country=${encodeURIComponent(country)}`,
  );
  return data.aspsps;
}

/**
 * Avvia un flow di autorizzazione AIS.
 * Ritorna un URL dove redirezionare l'utente per autenticarsi presso l'ASPSP.
 */
export async function startAuth(
  input: StartAuthInput,
): Promise<StartAuthResponse> {
  const body = {
    access: {
      valid_until: input.valid_until.toISOString(),
      balances: input.access?.balances ?? true,
      transactions: input.access?.transactions ?? true,
      ...(input.access?.accounts ? { accounts: input.access.accounts } : {}),
    },
    aspsp: input.aspsp,
    state: input.state ?? "",
    redirect_url: input.redirect_url,
    psu_type: input.psu_type ?? "personal",
    auth_method: input.auth_method,
    language: input.language ?? "it",
  };
  return ebFetch<StartAuthResponse>("/auth", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Completa l'autorizzazione dopo il redirect dell'utente.
 * Il `code` arriva nella querystring del redirect_url.
 */
export async function authorizeSession(code: string): Promise<Session> {
  return ebFetch<Session>("/sessions", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

/** Stato corrente di una sessione (per verificare scadenza/revoca). */
export async function getSession(sessionId: string): Promise<Session> {
  return ebFetch<Session>(`/sessions/${encodeURIComponent(sessionId)}`);
}

/** Revoca esplicita di una sessione. */
export async function deleteSession(sessionId: string): Promise<void> {
  await ebFetch<unknown>(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

/**
 * Fetch transazioni di un conto.
 *
 * `strategy=longest` è raccomandato al primo sync (scarica tutto lo storico
 * disponibile, in genere 1-3 anni). Gli ASPSPs limitano la full history a
 * ~1 ora dopo l'authorization iniziale, dopo solo 90 giorni indietro.
 *
 * Gestire la paginazione via `continuation_key`: se non null, richiamare
 * con lo stesso `continuationKey` finché non ritorna null.
 */
export async function listTransactions(
  accountId: string,
  opts: {
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;
    continuationKey?: string;
    strategy?: "default" | "longest";
    psuHeaders?: Record<string, string>;
  } = {},
): Promise<TransactionsResponse> {
  const params = new URLSearchParams();
  if (opts.dateFrom) params.set("date_from", opts.dateFrom);
  if (opts.dateTo) params.set("date_to", opts.dateTo);
  if (opts.continuationKey) params.set("continuation_key", opts.continuationKey);
  if (opts.strategy) params.set("strategy", opts.strategy);
  const qs = params.toString();
  return ebFetch<TransactionsResponse>(
    `/accounts/${encodeURIComponent(accountId)}/transactions${qs ? "?" + qs : ""}`,
    { psuHeaders: opts.psuHeaders },
  );
}

// ===== Balances =====

/**
 * Schema Berlin Group standard per un saldo. `balance_type` indica COSA è
 * il numero:
 *  - CLBD (Closing Booked) — saldo contabile a chiusura (BOOK only)
 *  - OPBD (Opening Booked) — saldo contabile in apertura
 *  - AVLB (Available) — saldo disponibile (può includere fido)
 *  - ITAV (Interim Available) — disponibile intra-giornaliero
 *  - CLAV (Closing Available) — disponibile a chiusura
 *  - FWAV (Forward Available) — disponibile considerando movimenti futuri
 *  - PRCD (Previously Closed Booked) — saldo contabile precedente chiusura
 *
 * Per il nostro confronto con i movimenti BOOK usiamo CLBD (o OPBD come
 * fallback). AVLB è sconsigliato perché può includere PDNG/fido.
 */
export type Balance = {
  balance_amount: { amount: string; currency: string };
  balance_type: string;
  last_change_date_time?: string;
  reference_date?: string; // YYYY-MM-DD
  name?: string;
};

export type BalancesResponse = {
  balances: Balance[];
};

/**
 * Fetch dei saldi correnti del conto. EB ritorna 1-N balance objects,
 * tipicamente uno per ciascun balance_type rilevante per la banca.
 *
 * Esempio Mediolanum: ritorna spesso solo CLBD oppure CLBD + AVLB.
 */
export async function getAccountBalances(
  accountId: string,
  psuHeaders?: Record<string, string>,
): Promise<BalancesResponse> {
  return ebFetch<BalancesResponse>(
    `/accounts/${encodeURIComponent(accountId)}/balances`,
    { psuHeaders },
  );
}

export { EnableBankingError };
