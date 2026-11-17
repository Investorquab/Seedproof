/** Create the three testnet accounts the scripts use (funder, pocket, steal). Fund `funder` from the Dashboard faucet. */
import { generateMnemonic, deriveUnifiedAccount } from "@qorechain/sdk";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { KEYS_DIR } from "./chain.js";
const f = `${KEYS_DIR}/accounts.json`;
if (existsSync(f)) { console.log(`${f} already exists`); process.exit(0); }
mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
const out: Record<string, unknown> = {};
for (const name of ["funder", "pocket", "steal"]) {
  const m = generateMnemonic(256); const a = await deriveUnifiedAccount(m);
  out[name] = { mnemonic: m, privateKey: a.privateKey, cosmos: a.cosmos, evm: a.evm };
  console.log(name.padEnd(7), a.cosmos, a.evm);
}
writeFileSync(f, JSON.stringify(out, null, 1), { mode: 0o600 });
console.log("\nFund the funder address from the faucet, then run s1-fund.ts.");
