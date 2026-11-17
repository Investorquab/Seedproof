/** Steal This Seed, step 1: give the public account an independent Home Key.
 *  Same path a QoreX user takes: seed-derived key registered first, then rotated away. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePqcRecoveryCode, pqcKeyFromRecoveryCode, toHex } from "@qorechain/sdk";
import { load, sendHybrid, show, registeredKey, registerKey, NET, KEYS_DIR } from "./chain.js";
import { createLinkRequest, signLinkRequest, buildLinkMessage } from "../src/link.js";
const HK = `${KEYS_DIR}/steal-homekey.txt`;
const a = await load("steal");
if (!existsSync(HK)) writeFileSync(HK, generatePqcRecoveryCode(), { mode: 0o600 });
const home = pqcKeyFromRecoveryCode(readFileSync(HK, "utf8").trim(), a.address);
let reg = await registeredKey(a.address);
if (!reg) { show("register the seed-derived key", await registerKey(a, a.seedPqc)); reg = await registeredKey(a.address); }
if (reg && toHex(reg) === toHex(a.seedPqc.publicKey)) {
  const req = createLinkRequest({ chainId: NET.chainId, account: a.address, registeredPublicKey: reg });
  show("rotate to the Home Key", await sendHybrid(a, [buildLinkMessage(req, signLinkRequest(req, home), { classicalPubkey: a.publicKey, oldKey: a.seedPqc })], a.seedPqc, "seedproof: steal this seed"));
}
console.log(a.address, "registered = Home Key:", toHex((await registeredKey(a.address))!) === toHex(home.publicKey));
