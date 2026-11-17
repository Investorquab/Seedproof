/**
 * Browser end-to-end check of the Pocket against the live testnet, with Node playing the Home Key
 * (it signs with the real Home Key code from .keys, through the screen's "Copy as text" fallback).
 *
 * Run from packages/core (so @qorechain/sdk and core resolve), with the app served on :4173:
 *   (cd apps/web && npm run build && npx vite preview --port 4173 &)
 *   cd packages/core && npx tsx ../../apps/web/e2e/pocket.e2e.mts [--account pocket|steal|qorex] [--topup 1]
 *
 * Without --topup it only opens the Pocket and reads state (no transactions). --topup N needs a
 * live vault-only window on that account (open one with scripts/window.ts) and spends one call.
 * Env: CHROME_PATH (default /usr/bin/google-chrome), SEEDPROOF_KEYS_DIR (default ../../.keys), APP_URL.
 */
import { readFileSync } from "node:fs";
import { chromium } from "../node_modules/playwright/index.mjs";
import { deriveNativeAccount, deriveUnifiedAccount, pqcKeyFromRecoveryCode } from "@qorechain/sdk";
import { FrameCollector, encodeFrames, signVaultRequest, describeVaultRequest } from "../../../packages/core/src/index.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const KEYS = process.env.SEEDPROOF_KEYS_DIR ?? "../../.keys";
const APP = process.env.APP_URL ?? "http://localhost:4173";
const who = arg("account") ?? "pocket";
const topup = arg("topup");

const accounts = JSON.parse(readFileSync(`${KEYS}/accounts.json`, "utf8"));
const mnemonic: string = accounts[who].mnemonic;
const address = who === "qorex" ? (await deriveNativeAccount(mnemonic)).address : (await deriveUnifiedAccount(mnemonic)).cosmos;
const home = pqcKeyFromRecoveryCode(readFileSync(`${KEYS}/${who}-homekey.txt`, "utf8").trim(), address);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${APP}/pocket`);
await page.fill("#words", mnemonic);
await page.fill("#pp", "correct horse battery");
await page.click("button[type=submit]");
await page.waitForSelector(".protected-line, .notice-bad", { timeout: 60_000 });
console.log("account:", await page.textContent(".chip-pocket"));
console.log("status:", (await page.textContent(".protected-line").catch(() => null)) ?? "NOT PROTECTED");
console.log("thief line:", await page.textContent(".pocket-risk"));

await page.waitForSelector(".vault-teaser", { timeout: 20_000 }).catch(() => null); // 0x accounts only
if (await page.locator("text=Open vault").count()) {
  await page.click("text=Open vault");
  await page.waitForSelector(".vault-card");
  await page.waitForTimeout(4000);
  console.log("vault:", (await page.textContent(".vault-card"))?.replace(/\s+/g, " ").slice(0, 200));

  if (topup) {
    await page.click("text=Top up now");
    await page.fill("#vamt", topup);
    await page.click("text=Ask Home Key");
    await page.waitForSelector("text=Copy as text instead", { timeout: 30_000 });
    await page.click("text=Copy as text instead");
    const text: string = await page.evaluate(() => navigator.clipboard.readText());
    const collector = new FrameCollector();
    let request: any;
    for (const line of text.split("\n")) {
      const r: any = collector.add(line);
      if (r.status === "complete") request = r.message;
    }
    console.log("Home Key reads:", describeVaultRequest(request).lines.map((l) => l.text));
    await page.click("text=Scan the Home Key's answer");
    await page.click("text=Paste text");
    await page.fill("#frames", encodeFrames(signVaultRequest(request, home)).join("\n"));
    await page.click("text=Read frames");
    await page.waitForSelector(".notice-good, .notice-bad", { timeout: 120_000 });
    console.log("result:", (await page.textContent(".notice-good, .notice-bad"))?.replace(/\s+/g, " "));
    console.log("tx:", await page.getAttribute("a[href*='/tx/']", "href").catch(() => null));
  }
}

console.log("page errors:", errors);
await browser.close();
process.exit(errors.length ? 1 : 0);
