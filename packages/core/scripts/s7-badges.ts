/** Ship Weeks badges from a project address (funder, also the vault's guardian):
 *  register a QoreSeal (ML-KEM-1024) key on chain, and swap in the native AMM. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generateSealKeys, sealKeysFromSeed, buildRegisterKemKeyMessage } from "@qorechain/qoreseal";
import { qorechainTypes, fetchKemKey } from "@qorechain/sdk";
import { load, sendHybrid, show, NET, KEYS_DIR } from "./chain.js";
const f = await load("funder");

const SEED = `${KEYS_DIR}/funder-seal-seed.hex`;
if (!existsSync(SEED)) writeFileSync(SEED, Buffer.from(generateSealKeys().seed).toString("hex"), { mode: 0o600 });
const keys = sealKeysFromSeed(Uint8Array.from(Buffer.from(readFileSync(SEED, "utf8").trim(), "hex")));
const reg = buildRegisterKemKeyMessage({ sender: f.address, mlkemPublicKey: keys.mlkemPublicKey });
const decoded = qorechainTypes.pqc.MsgRegisterKEMKey.decode(reg.value);
show("funder registers its QoreSeal key (ML-KEM-1024)", await sendHybrid(f, [{ typeUrl: reg.typeUrl, value: decoded }], f.seedPqc, "seedproof: guardian seal key"));
const k: any = await fetchKemKey({ rest: NET.rest, address: f.address });
console.log("on chain:", k.found ?? k.registered ?? JSON.stringify(k).slice(0, 120));

const swap = { typeUrl: "/qorechain.amm.v1.MsgSwapExactIn", value: { sender: f.address, poolId: "2", tokenIn: { denom: "uqor", amount: "1000000" }, denomOut: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", minOut: "1" } };
show("funder swaps 1 QOR for fUSD in pool 2", await sendHybrid(f, [swap], f.seedPqc, "seedproof: first swap"));
