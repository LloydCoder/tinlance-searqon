import test from "node:test";
import assert from "node:assert/strict";
import { wireUserAgent } from "../src/security/user-agent.js";

test("wire user-agent contains the product token and descriptive version", () => {
  assert.match(wireUserAgent(), /SearqonBot\/0.2/);
  assert.match(wireUserAgent("Custom_Bot"), /Custom_Bot\/0.2/);
});

test("wire user-agent enforces RFC 9309 product-token characters", () => {
  for (const token of ["Bot2", "Bad Bot", "Bot.", "Bot/1", ""]) {
    assert.throws(() => wireUserAgent(token), /product token/);
  }
});
