/** R1-R3 on the live chain: link an independent Home Key, then show the seed alone no longer signs. */
import { KEYS_DIR } from "./chain.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { generatePqcRecoveryCode, pqcKeyFromRecoveryCode, toHex, rotationSignBytes, AlgorithmDilithium5, pqcSign, rotatePqcKeyMsg, generatePqcKeypair } from "@qorechain/sdk";
import { load, sendHybrid, sendClassical, msgSend, show, registeredKey, registerKey, NET } from "./chain.js";
import { createLinkRequest, signLinkRequest, buildLinkMessage } from "../src/link.js";

const HK = `${KEYS_DIR}/pocket-homekey.txt`;
const p = await load("pocket"), f = await load("funder");
if (!existsSync(HK)) writeFileSync(HK, generatePqcRecoveryCode(), { mode: 0o600 });
const home = pqcKeyFromRecoveryCode(readFileSync(HK, "utf8").trim(), p.address);
const results: Record<string, unknown> = {};
const rec = (k: string, o: any) => { show(k, o); results[k] = { tx: o.txhash, code: o.code, codespace: o.codespace, gas: o.gasUsed, log: o.code ? o.rawLog.slice(0, 200) : undefined }; };

let reg = await registeredKey(p.address);
if (!reg) { rec("pocket registers seed-derived key (QoreX default)", await registerKey(p, p.seedPqc)); reg = await registeredKey(p.address); }

if (toHex(reg!) === toHex(p.seedPqc.publicKey)) {
  console.log("state: ONE SECRET (registered key = seed-derived)");
  const req = createLinkRequest({ chainId: NET.chainId, account: p.address, registeredPublicKey: reg });
  const res = signLinkRequest(req, home);
  const msg = buildLinkMessage(req, res, { classicalPubkey: p.publicKey, oldKey: p.seedPqc });
  rec("rotate seed key -> Home Key (tx signed with current seed key)", await sendHybrid(p, [msg], p.seedPqc, "seedproof: link Home Key"));
  reg = await registeredKey(p.address);
}
console.log("registered = Home Key?", toHex(reg!) === toHex(home.publicKey));

rec("R1 send 1 QOR, PQ sig from Home Key (split signing)", await sendHybrid(p, [msgSend(p.address, f.address, 1_000_000n)], home, "seedproof: R1"));
rec("R2 thief: send 1 QOR, PQ sig from seed-derived key", await sendHybrid(p, [msgSend(p.address, f.address, 1_000_000n)], p.seedPqc));
rec("R3a thief: classical-only tx", await sendClassical(p, [msgSend(p.address, f.address, 1_000_000n)]));
// R3b: thief rotates to his own key, signing the old-key part with the seed key
const thiefKey = generatePqcKeypair();
const bytes = new TextEncoder().encode(rotationSignBytes(NET.chainId, AlgorithmDilithium5, p.address, home.publicKey, thiefKey.publicKey));
const thiefRotate = rotatePqcKeyMsg({ sender: p.address, oldPublicKey: home.publicKey, newPublicKey: thiefKey.publicKey, oldSignature: pqcSign(p.seedPqc.secretKey, bytes), newSignature: pqcSign(thiefKey.secretKey, bytes) });
rec("R3b thief: rotate to his own key (tx signed with seed key)", await sendHybrid(p, [thiefRotate], p.seedPqc));
rec("R3c thief: fresh registration of his key (classical)", await registerKey(p, thiefKey));
console.log("registered still Home Key?", toHex((await registeredKey(p.address))!) === toHex(home.publicKey));
writeFileSync(`${KEYS_DIR}/s2-results.json`, JSON.stringify(results, null, 1));
