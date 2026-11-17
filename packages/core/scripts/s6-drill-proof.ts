/** Q-Day Drill proof: a normal hybrid-signed native tx from the drill account, PQ-signed by its Home Key.
 *  Must land on 18 Nov (UTC). Prints the 64-hex hash to paste on the project page. */
import { readFileSync } from "node:fs";
import { pqcKeyFromRecoveryCode } from "@qorechain/sdk";
import { load, sendHybrid, msgSend, show, KEYS_DIR } from "./chain.js";
const p = await load("pocket");
const home = pqcKeyFromRecoveryCode(readFileSync(`${KEYS_DIR}/pocket-homekey.txt`, "utf8").trim(), p.address);
const o = await sendHybrid(p, [msgSend(p.address, p.address, 10_000n)], home, "seedproof: q-day drill proof");
show("drill proof: self-send 0.01 QOR, Home Key signed", o);
console.log(`UTC now: ${new Date().toISOString()}\nPROOF HASH: ${o.txhash}`);
