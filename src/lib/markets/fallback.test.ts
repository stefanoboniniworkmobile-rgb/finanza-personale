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

test("buildStalePriceMessage reports the last known price and its date", () => {
  const msg = buildStalePriceMessage("fetch failed: timeout", {
    close: 1234.5,
    date: new Date(Date.UTC(2026, 6, 22)),
  });
  assert.match(msg, /1\.234,50/);
  assert.match(msg, /22\/07\/2026/);
});

test("buildStalePriceMessage stays generic when no price is stored yet", () => {
  const msg = buildStalePriceMessage("fetch failed: timeout");
  assert.match(msg, /ultimo prezzo noto/i);
  assert.doesNotMatch(msg, /\d{2}\/\d{2}\/\d{4}/);
});

test("suggestProvider defaults equity-like assets to Yahoo", () => {
  assert.equal(suggestProvider("stock"), "yahoo");
  assert.equal(suggestProvider("etf"), "yahoo");
  assert.equal(suggestProvider("index"), "yahoo");
  assert.equal(suggestProvider("currency"), "ecb");
  assert.equal(suggestProvider("fund"), "manual");
});

test("shouldUseStooqFallback triggers for Yahoo rate-limit errors", () => {
  assert.equal(shouldUseStooqFallback("Yahoo batch HTTP 429 (rate limit)"), true);
  assert.equal(shouldUseStooqFallback("stooq ok"), false);
});
