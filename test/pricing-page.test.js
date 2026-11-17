import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pricingPage = new URL("../apps/web/public/pricing/index.html", import.meta.url);

test("public pricing page publishes all six proposed plan prices and annual totals", async () => {
  const html = await readFile(pricingPage, "utf8");
  for (const expected of [
    "Free", "Starter", "Growth", "Agency", "Business", "Enterprise",
    "$79", "$806", "$199", "$2,030", "$499", "$5,090", "$999", "$10,190",
    "From $2,500", "15% annual discount", "billed upfront"
  ]) assert.ok(html.includes(expected), `pricing page is missing ${expected}`);
});

test("public pricing page discloses the exact trial, usage, and overage policy", async () => {
  const html = await readFile(pricingPage, "utf8");
  for (const expected of [
    "14 days", "Successful AI answer checks total", "Crawl page credits total",
    "no payment card", "No automatic conversion", "80%", "100%",
    "$0.025", "$0.020", "$0.0175", "$0.015",
    "$4 / 1,000", "$10 / 1,000", "$1 / 10,000",
    "Overages are off by default", "No unused usage rollover"
  ]) assert.ok(html.includes(expected), `pricing page is missing policy disclosure: ${expected}`);
});

test("public pricing page separates proposed packages from available product capabilities", async () => {
  const html = await readFile(pricingPage, "utf8");
  assert.match(html, /proposed hosted packages/i);
  assert.match(html, /not currently available for purchase/i);
  assert.match(html, /feature eligibility is not proof of implementation/i);
  assert.match(html, /open-source toolkit remains free/i);
});
