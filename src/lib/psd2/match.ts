/**
 * Matching tra account ritornati da Enable Banking e BankAccount in anagrafica.
 *
 * Contesto: quando l'utente avvia il consenso PSD2 su una banca, EB può
 * restituire 1..N account (es. Credem ritorna c/c + carta EGO). L'app deve
 * sapere a quale BankAccount dell'anagrafica associare ognuno. Per evitare
 * di chiedere all'utente alla cieca, proviamo a fare un matching automatico
 * usando IBAN e gli ultimi 4 del PAN.
 *
 * Regole (in ordine di precedenza):
 *  1) Se l'account EB ha IBAN e c'è UN SOLO candidato con stesso IBAN → match "perfect"
 *  2) Se l'account EB è una carta (CPAN/PAN) e c'è UN SOLO candidato con
 *     stesso last4 del PAN → match "perfect"
 *  3) Altrimenti: nessun match. La UI mostra "non collegato" e l'utente sceglie
 *     se scartare o codificare un nuovo BankAccount.
 *
 * Niente match "partial" per ora: vogliamo che il fallback sia sempre una
 * scelta esplicita dell'utente, non un'euristica fragile. Si potrà aggiungere
 * dopo se servirà (es. match sul `name` o sul `product` quando IBAN/PAN
 * mancano del tutto).
 */

import type { SessionAccount } from "./enable-banking";

/** Forma minima del BankAccount in anagrafica per il matching. */
export type BankAccountCandidate = {
  id: string;
  name: string;
  type: string;
  iban: string | null;
  cardMaskedPan: string | null;
};

/** Esito del matching per un singolo SessionAccount. */
export type MatchResult = {
  /** ID del BankAccount candidato suggerito. Null se nessun match. */
  matchedBankAccountId: string | null;
  /** "perfect": match univoco su IBAN o last4 PAN. "none": nessun match. */
  confidence: "perfect" | "none";
  /** Stringa human-readable per la UI. */
  reason: string;
  /** IBAN normalizzato estratto dall'account EB (utile per pre-compilare form). */
  detectedIban: string | null;
  /** PAN mascherato estratto dall'account EB (utile per pre-compilare form). */
  detectedPan: string | null;
};

/**
 * Normalizza un IBAN: uppercase, niente spazi interni. Restituisce null se
 * l'input è null/undefined/stringa vuota.
 */
export function normalizeIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const cleaned = iban.replace(/\s+/g, "").toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Estrae gli ultimi 4 caratteri alfanumerici da un PAN (possibilmente mascherato).
 * Es. "5189********6765" → "6765"
 *      "1234 **** **** 5678" → "5678"
 *      "abcd1234" → "1234"
 * Restituisce null se non riesce a estrarre 4 caratteri alfanumerici dalla coda.
 */
export function extractLast4(pan: string | null | undefined): string | null {
  if (!pan) return null;
  // Tieni solo alfanumerici (rimuove spazi, asterischi, trattini)
  const alnum = pan.replace(/[^A-Za-z0-9]/g, "");
  if (alnum.length < 4) return null;
  return alnum.slice(-4);
}

/**
 * Estrae IBAN e PAN da un SessionAccount EB.
 *
 * EB ritorna due strutture diverse:
 *  - c/c: account_id.iban valorizzato
 *  - carta: account_id (custom, scheme_name="CPAN") con identification = PAN mascherato
 *
 * Inoltre `all_account_ids` può contenere più identificativi (es. IBAN + BBAN).
 * Ci basta uno per tipo.
 */
export function extractIdentifiers(account: ProviderAccountLike): {
  iban: string | null;
  pan: string | null;
} {
  // IBAN: prova prima account_id.iban, poi cerca nelle all_account_ids con
  // scheme_name="IBAN".
  let iban: string | null = null;
  if (account.account_id?.iban) {
    iban = normalizeIban(account.account_id.iban);
  } else if (account.all_account_ids) {
    const ibanEntry = account.all_account_ids.find(
      (id) => id.scheme_name === "IBAN",
    );
    if (ibanEntry?.identification) {
      iban = normalizeIban(ibanEntry.identification);
    }
  }

  // PAN: cerca scheme_name CPAN/PAN nelle identifications o in account_id.other
  let pan: string | null = null;
  if (account.account_id?.other?.identification) {
    const scheme = account.account_id.other.scheme_name?.toUpperCase();
    if (scheme === "CPAN" || scheme === "PAN" || scheme === "MASKEDPAN") {
      pan = account.account_id.other.identification;
    }
  }
  if (!pan && account.all_account_ids) {
    const panEntry = account.all_account_ids.find((id) => {
      const s = id.scheme_name?.toUpperCase();
      return s === "CPAN" || s === "PAN" || s === "MASKEDPAN";
    });
    if (panEntry?.identification) {
      pan = panEntry.identification;
    }
  }

  return { iban, pan };
}

/**
 * Forma estesa dell'account EB usata da extractIdentifiers. SessionAccount
 * (in enable-banking.ts) ha già la maggior parte di questi campi; la
 * ridefiniamo qui per ergonomia perché alcuni payload reali includono
 * `account_id` strutturato (iban / other) che il type SessionAccount
 * non rappresenta esplicitamente.
 */
export type ProviderAccountLike = Partial<SessionAccount> & {
  account_id?: {
    iban?: string | null;
    other?: {
      identification: string;
      scheme_name: string;
      issuer?: string | null;
    } | null;
  } | null;
  all_account_ids?: Array<{
    identification: string;
    scheme_name: string;
    issuer?: string | null;
  }> | null;
};

/**
 * Esegue il matching di UN account EB contro la lista di candidati.
 *
 * Restituisce sempre un MatchResult, anche in caso di no-match (con
 * `matchedBankAccountId: null` e `confidence: "none"`).
 *
 * Match "perfect" solo se UNIVOCO. Se due BankAccount in anagrafica hanno
 * lo stesso IBAN (caso patologico, lo unique constraint a livello Holder
 * non c'è perché due Holder dello stesso User potrebbero condividere conti
 * cointestati: ma in pratica raro), preferiamo restituire "none" e far
 * scegliere l'utente, piuttosto che indovinare.
 */
export function matchProviderAccount(
  account: ProviderAccountLike,
  candidates: readonly BankAccountCandidate[],
): MatchResult {
  const { iban: detectedIban, pan: detectedPan } = extractIdentifiers(account);

  // Step 1: IBAN match
  if (detectedIban) {
    const ibanMatches = candidates.filter(
      (c) => normalizeIban(c.iban) === detectedIban,
    );
    if (ibanMatches.length === 1) {
      return {
        matchedBankAccountId: ibanMatches[0].id,
        confidence: "perfect",
        reason: `IBAN coincide con "${ibanMatches[0].name}"`,
        detectedIban,
        detectedPan,
      };
    }
    if (ibanMatches.length > 1) {
      return {
        matchedBankAccountId: null,
        confidence: "none",
        reason: `Più conti in anagrafica con lo stesso IBAN (${ibanMatches.length}). Scegli manualmente.`,
        detectedIban,
        detectedPan,
      };
    }
  }

  // Step 2: PAN last4 match (per carte)
  if (detectedPan) {
    const last4 = extractLast4(detectedPan);
    if (last4) {
      const panMatches = candidates.filter(
        (c) => extractLast4(c.cardMaskedPan) === last4,
      );
      if (panMatches.length === 1) {
        return {
          matchedBankAccountId: panMatches[0].id,
          confidence: "perfect",
          reason: `Ultimi 4 della carta coincidono con "${panMatches[0].name}"`,
          detectedIban,
          detectedPan,
        };
      }
      if (panMatches.length > 1) {
        return {
          matchedBankAccountId: null,
          confidence: "none",
          reason: `Più carte in anagrafica con stessi ultimi 4 (${panMatches.length}). Scegli manualmente.`,
          detectedIban,
          detectedPan,
        };
      }
    }
  }

  // Step 3: nessun match
  return {
    matchedBankAccountId: null,
    confidence: "none",
    reason: detectedIban
      ? `Nessun conto in anagrafica con IBAN ${detectedIban}`
      : detectedPan
        ? `Nessuna carta in anagrafica con PAN ${detectedPan}`
        : "Account senza IBAN né PAN identificabili",
    detectedIban,
    detectedPan,
  };
}

/**
 * Suggerisce un `type` per BankAccount (liquidity | credit_card | savings | cash)
 * a partire dai campi semantici di un SessionAccount EB. Usato per pre-compilare
 * il form "codifica nuovo conto" nella pagina abbinamento.
 *
 * Regole:
 *  - cash_account_type=CARD o presence di other(CPAN) → credit_card
 *  - cash_account_type=SVGS → savings
 *  - cash_account_type=CACC (Cash/Current) o default → liquidity
 */
export function suggestAccountType(
  account: ProviderAccountLike,
): "liquidity" | "credit_card" | "savings" | "cash" {
  const cat = account.cash_account_type?.toUpperCase();
  if (cat === "CARD") return "credit_card";
  if (cat === "SVGS") return "savings";

  // Fallback: se ha PAN ma non IBAN → carta
  if (account.account_id?.other && !account.account_id?.iban) {
    const scheme = account.account_id.other.scheme_name?.toUpperCase();
    if (scheme === "CPAN" || scheme === "PAN" || scheme === "MASKEDPAN") {
      return "credit_card";
    }
  }
  return "liquidity";
}

/**
 * Suggerisce un nome leggibile per BankAccount a partire da un SessionAccount EB.
 * Usato per pre-compilare il form "codifica nuovo conto".
 *
 * Strategia: prima `product` (es. "Conto Corrente", "Carta EGO"), altrimenti
 * `details`, altrimenti `cash_account_type`. Prepende l'ASPSP name se passato
 * per disambiguare (es. "Credito Emiliano — Carta EGO").
 */
export function suggestAccountName(
  account: ProviderAccountLike,
  aspspName?: string,
): string {
  const candidate =
    account.product ||
    account.details ||
    account.cash_account_type ||
    "Conto bancario";
  if (aspspName && !candidate.toLowerCase().includes(aspspName.toLowerCase())) {
    return `${aspspName} — ${candidate}`;
  }
  return candidate;
}
