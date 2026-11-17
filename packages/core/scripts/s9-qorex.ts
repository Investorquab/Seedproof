/** The QoreX path on chain: a classic m/44'/118' account (what QoreX creates), seed-derived key first,
 *  then linked to a Home Key. Proves Seedproof works for existing QoreX users, not only 0x accounts. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { deriveNativeAccount, derivePqcCanonical, directSignerFromPrivateKey, generateMnemonic, generatePqcRecoveryCode, pqcKeyFromRecoveryCode, toHex } from "@qorechain/sdk";
import { createApprovalRequest, approveRequest, assembleSignedTx, signClassicalOnly } from "../src/split.js";
import { createLinkRequest, signLinkRequest, buildLinkMessage } from "../src/link.js";
import { load, sendHybrid, msgSend, show, registeredKey, accountInfo, broadcast, FEE, NET, KEYS_DIR, type Outcome } from "./chain.js";
import type { EncodeObject } from "@cosmjs/proto-signing";

const ACC = `${KEYS_DIR}/accounts.json`, HK = `${KEYS_DIR}/qorex-homekey.txt`;
const all = JSON.parse(readFileSync(ACC, "utf8"));
if (!all.qorex) { all.qorex = { mnemonic: generateMnemonic(256), path: "m/44'/118'/0'/0/0" }; writeFileSync(ACC, JSON.stringify(all, null, 1), { mode: 0o600 }); }
const m = all.qorex.mnemonic;
const a = await deriveNativeAccount(m);
const signer = await directSignerFromPrivateKey(a.privateKey, "qor");
const seedKey = derivePqcCanonical(a.address, m);
if (!existsSync(HK)) writeFileSync(HK, generatePqcRecoveryCode(), { mode: 0o600 });
const home = pqcKeyFromRecoveryCode(readFileSync(HK, "utf8").trim(), a.address);
console.log("QoreX-style account", a.address);

async function tx(msgs: EncodeObject[], mode: "classical" | "hybrid", key = home): Promise<Outcome> {
  const info = await accountInfo(a.address);
  const req = createApprovalRequest({ chainId: NET.chainId, account: a.address, classicalPubkey: a.publicKey, pubkeyType: "secp256k1",
    accountNumber: info.accountNumber, sequence: info.sequence, messages: msgs, fee: FEE, signBytesVersion: "v2" });
  if (mode === "classical") return broadcast(await signClassicalOnly(req, signer));
  return broadcast(await assembleSignedTx(req, await approveRequest(req, key, () => true), signer));
}

const f = await load("funder");
if (!(await accountInfo(a.address)).exists) show("funder sends 5 QOR to the QoreX-style account", await sendHybrid(f, [msgSend(f.address, a.address, 5_000_000n)], f.seedPqc));

let reg = await registeredKey(a.address);
if (!reg) {
  const req = createLinkRequest({ chainId: NET.chainId, account: a.address, registeredPublicKey: null });
  show("register the seed-derived key (what QoreX does on the first transfer)", await tx([buildLinkMessage(req, signLinkRequest(req, seedKey), { classicalPubkey: a.publicKey })], "classical"));
  reg = await registeredKey(a.address);
}
if (reg && toHex(reg) === toHex(seedKey.publicKey)) {
  const req = createLinkRequest({ chainId: NET.chainId, account: a.address, registeredPublicKey: reg });
  const msg = buildLinkMessage(req, signLinkRequest(req, home), { classicalPubkey: a.publicKey, oldKey: seedKey });
  show("rotate to the Home Key", await tx([msg], "hybrid", seedKey));
}
console.log("registered = Home Key:", toHex((await registeredKey(a.address))!) === toHex(home.publicKey));
show("send 0.5 QOR, Home Key signs", await tx([msgSend(a.address, f.address, 500_000n)], "hybrid", home));
show("thief with the 24 words sends 0.5 QOR", await tx([msgSend(a.address, f.address, 500_000n)], "hybrid", seedKey));
