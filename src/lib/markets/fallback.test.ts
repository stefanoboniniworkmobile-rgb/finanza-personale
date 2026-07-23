import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseLastKnownPrice, buildStalePriceMessage, shouldUseStooqFallback } from "./fallback.ts";
import { suggestProvider } from "./index.ts";

test("shouldUseLastKnownPrice returns true for transient provider errors", () => {
  assert.equal(shouldUseLastKnownPrice("Yahoo: troppe richieste in corso (429)"), true);
  assert.equal(shouldUseLastKnownPrice("fetch failed: timeout"), true);
});

test("buildStalePriceMessage uses a provider-neutral message", () => {
  const msg = buildStalePriceMessage("Yahoo: troppe richieste in corso (429)");
  assert.match(msg, /ultimo prezzo noto/i);
  assert.match(msg, /provider di dati/i);
  assert.doesNotMatch(msg, /yahoo/i);
});

test("suggestProvider prefers Stooq for equity-like assets", () => {
  assert.equal(suggestProvider("stock"), "stooq");
  assert.equal(suggestProvider("etf"), "stooq");
  assert.equal(suggestProvider("index"), "stooq");
  assert.equal(suggestProvider("currency"), "ecb");
  assert.equal(suggestProvider("fund"), "manual");
});

test("shouldUseStooqFallback triggers for Yahoo rate-limit errors", () => {
  assert.equal(shouldUseStooqFallback("Yahoo batch HTTP 429 (rate limit)"), true);
  assert.equal(shouldUseStooqFallback("stooq ok"), false);
});
