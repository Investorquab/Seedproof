/** Execute a queued vault action from the Pocket once its delay has passed.  npx tsx scripts/s8-execute.ts <id> */
import { readFileSync } from "node:fs";
import { load, getJson } from "./chain.js";
import { pub, wallet, ERC20, VAULT_ABI, TOKENS, sendAndWait } from "./evm.js";
const VAULT = JSON.parse(readFileSync(new URL("../../../contracts/deployments/diana.json", import.meta.url), "utf8")).vault as `0x${string}`;
const id = BigInt(process.argv[2] ?? 0);
const p = await load("pocket");
const before = await pub.readContract({ address: TOKENS.fUSD, abi: ERC20, functionName: "balanceOf", args: [p.evm] });
const gas = await pub.estimateContractGas({ account: p.evm, address: VAULT, abi: VAULT_ABI, functionName: "execute", args: [id] });
console.log("estimateGas", gas.toString());
await sendAndWait(`Pocket: execute queued action ${id}`, wallet(p.privateKey).writeContract({ address: VAULT, abi: VAULT_ABI, functionName: "execute", args: [id], gas: (gas * 12n) / 10n }));
const after = await pub.readContract({ address: TOKENS.fUSD, abi: ERC20, functionName: "balanceOf", args: [p.evm] });
console.log("pocket fUSD", before.toString(), "->", after.toString());
console.log(JSON.stringify((await getJson(`/qorechain/pqc/v1/evm_window/${p.address}`)).json));
