import test from "node:test";
import assert from "node:assert/strict";
import { monthRange } from "./format";

test("monthRange supports YYYY-MM..YYYY-MM ranges", () => {
  const range = monthRange("2026-01..2026-03");

  assert.equal(range.from.getFullYear(), 2026);
  assert.equal(range.from.getMonth(), 0);
  assert.equal(range.to.getFullYear(), 2026);
  assert.equal(range.to.getMonth(), 3);
});
