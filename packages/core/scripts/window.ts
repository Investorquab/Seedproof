/** Open an EVM window for an account, PQ-signed with its seed key (funder) or Home Key (pocket).
 *  npx tsx scripts/window.ts <account> <blocks> <maxTxs> <maxValueUqor> [target,target]  */
import { readFileSync } from "node:fs";
import { openEvmWindowMsg, pqcKeyFromRecoveryCode } from "@qorechain/sdk";
import { load, sendHybrid, show, getJson, KEYS_DIR } from "./chain.js";
const [name, blocks, maxTxs, maxValue, targets] = process.argv.slice(2);
const a = await load(name);
const key = name === "pocket" ? pqcKeyFromRecoveryCode(readFileSync(`${KEYS_DIR}/pocket-homekey.txt`, "utf8").trim(), a.address) : a.seedPqc;
const msg = openEvmWindowMsg({ sender: a.address, blocks: Number(blocks), maxTxs: Number(maxTxs), maxValue, allowedTargets: targets ? targets.split(",") : undefined });
show(`open window ${name} blocks=${blocks} txs=${maxTxs} value=${maxValue}uqor targets=${targets ?? "any"}`, await sendHybrid(a, [msg], key));
console.log(JSON.stringify((await getJson(`/qorechain/pqc/v1/evm_window/${a.address}`)).json));
