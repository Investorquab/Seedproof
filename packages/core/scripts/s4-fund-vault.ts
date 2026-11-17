import { readFileSync } from "node:fs";
import { KEYS_DIR } from "./chain.js";
import { parseEther, parseUnits } from "viem";
import { pub, wallet, ERC20, TOKENS, sendAndWait } from "./evm.js";
const a = JSON.parse(readFileSync(`${KEYS_DIR}/accounts.json`, "utf8"));
const VAULT = JSON.parse(readFileSync(new URL("../../../contracts/deployments/diana.json", import.meta.url), "utf8")).vault;
const w = wallet(a.funder.privateKey);
for (const [t, amt] of [["fUSD", parseUnits("500", 6)], ["fETH", parseUnits("0.25", 18)], ["fBTC", parseUnits("0.01", 8)]] as const)
  await sendAndWait(`funder -> vault ${t}`, w.writeContract({ address: TOKENS[t], abi: ERC20, functionName: "transfer", args: [VAULT, amt] }));
await sendAndWait("funder -> vault 8 QOR", w.sendTransaction({ to: VAULT, value: parseEther("8") }));
for (const t of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) console.log(t, (await pub.readContract({ address: TOKENS[t], abi: ERC20, functionName: "balanceOf", args: [VAULT] })).toString());
console.log("QOR", (await pub.getBalance({ address: VAULT })).toString());
