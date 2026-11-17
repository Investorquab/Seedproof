/** R5 + vault on the live chain. Pocket spends inside a window scoped to the vault; a seed thief tries every door. */
import { KEYS_DIR } from "./chain.js";
import { readFileSync, writeFileSync } from "node:fs";
import { parseUnits, toHex, parseEther } from "viem";
import { pqcKeyFromRecoveryCode, openEvmWindowMsg } from "@qorechain/sdk";
import { load, sendHybrid, show, getJson } from "./chain.js";
import { pub, wallet, ERC20, VAULT_ABI, TOKENS, sendAndWait } from "./evm.js";
import { VaultAction, vaultPayload, signVaultRequest, type VaultRequest } from "../src/vault.js";
import { b64 } from "../src/envelope.js";

const VAULT = JSON.parse(readFileSync(new URL("../../../contracts/deployments/diana.json", import.meta.url), "utf8")).vault as `0x${string}`;
const p = await load("pocket"), f = await load("funder");
const home = pqcKeyFromRecoveryCode(readFileSync(`${KEYS_DIR}/pocket-homekey.txt`, "utf8").trim(), p.address);
const out: Record<string, unknown> = { vault: VAULT };

// Home Key approves a window: 3 txs, 1 QOR of fees, only the vault.
const winMsg = openEvmWindowMsg({ sender: p.address, blocks: 600, maxTxs: 3, maxValue: "1000000", allowedTargets: [VAULT] });
const w0 = await sendHybrid(p, [winMsg], home, "seedproof: pocket window");
show("Home Key opens Pocket window (vault only, 3 txs, 1 QOR)", w0); out.window = w0.txhash;
console.log(JSON.stringify((await getJson(`/qorechain/pqc/v1/evm_window/${p.address}`)).json));

async function vaultReq(action: number, payload: `0x${string}`): Promise<VaultRequest> {
  return { v: 1 as any, kind: "seedproof/vault-request", account: p.address, pocket: p.evm, evmChainId: "9800", vault: VAULT,
    nonce: (await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "nonce" })).toString(), action: action as any, payload, deadline: Math.floor(Date.now() / 1000) + 900 };
}
const pw = wallet(p.privateKey);

// 1. Real top-up: 50 fUSD to the Pocket, signed by the Home Key.
const amt = parseUnits("50", 6);
const req = await vaultReq(VaultAction.TopUp, vaultPayload.transfer(TOKENS.fUSD, p.evm, amt));
const res = signVaultRequest(req, home);
out.topUp = await sendAndWait("Pocket: top-up 50 fUSD with Home Key signature", pw.writeContract({ address: VAULT, abi: VAULT_ABI, functionName: "topUp",
  args: [TOKENS.fUSD, p.evm, amt, BigInt(req.deadline), toHex(b64.dec(res.pqcPublicKey)), toHex(b64.dec(res.pqcSignature))], gas: 1_500_000n }));
console.log("pocket fUSD:", (await pub.readContract({ address: TOKENS.fUSD, abi: ERC20, functionName: "balanceOf", args: [p.evm] })).toString());

// 2. Thief with the seed: signs the top-up with the seed-derived PQ key (eth_call, no window spent).
const tReq = await vaultReq(VaultAction.TopUp, vaultPayload.transfer(TOKENS.fUSD, p.evm, amt));
const tRes = signVaultRequest(tReq, p.seedPqc);
try {
  await pub.simulateContract({ account: p.evm, address: VAULT, abi: VAULT_ABI, functionName: "topUp",
    args: [TOKENS.fUSD, p.evm, amt, BigInt(tReq.deadline), toHex(b64.dec(tRes.pqcPublicKey)), toHex(b64.dec(tRes.pqcSignature))] });
  console.log("FAIL thief top-up with seed key was accepted!"); out.thiefTopUp = "ACCEPTED";
} catch (e: any) { console.log("OK   thief top-up with seed key refused:", e.cause?.data?.errorName ?? e.shortMessage); out.thiefTopUp = e.cause?.data?.errorName ?? "reverted"; }

// 3. Thief (holding the classical key) sends QOR out of the Pocket on the EVM lane: not an allowed target.
out.thiefEvmSend = await sendAndWait("thief: EVM send 1 QOR from Pocket to his address", pw.sendTransaction({ to: f.evm, value: parseEther("1") }));

// 4. Thief tries to widen the window with the seed key (native lane).
const wide = openEvmWindowMsg({ sender: p.address, blocks: 600, maxTxs: 50, maxValue: "20000000" });
const r4 = await sendHybrid(p, [wide], p.seedPqc); show("thief: open a wide window with seed key", r4); out.thiefWiden = { code: r4.code, tx: r4.txhash };

// 5. Over the daily cap: 60 more fUSD (limit 100, 50 used) -> refused on eth_call.
const oReq = await vaultReq(VaultAction.TopUp, vaultPayload.transfer(TOKENS.fUSD, p.evm, parseUnits("60", 6)));
const oRes = signVaultRequest(oReq, home);
try {
  await pub.simulateContract({ account: p.evm, address: VAULT, abi: VAULT_ABI, functionName: "topUp",
    args: [TOKENS.fUSD, p.evm, parseUnits("60", 6), BigInt(oReq.deadline), toHex(b64.dec(oRes.pqcPublicKey)), toHex(b64.dec(oRes.pqcSignature))] });
  console.log("FAIL over-cap accepted"); out.overCap = "ACCEPTED";
} catch (e: any) { console.log("OK   over daily cap refused:", e.cause?.data?.errorName, e.cause?.data?.args?.map(String)); out.overCap = e.cause?.data?.errorName; }

// 6. Queue a Withdraw of 100 fUSD (1h delay), Home Key signed.
const wd = await vaultReq(VaultAction.Withdraw, vaultPayload.transfer(TOKENS.fUSD, p.evm, parseUnits("100", 6)));
const wdr = signVaultRequest(wd, home);
out.queueWithdraw = await sendAndWait("Pocket: queue withdraw 100 fUSD (1h delay)", pw.writeContract({ address: VAULT, abi: VAULT_ABI, functionName: "queue",
  args: [VaultAction.Withdraw, wd.payload, BigInt(wd.deadline), toHex(b64.dec(wdr.pqcPublicKey)), toHex(b64.dec(wdr.pqcSignature))], gas: 1_500_000n }));
console.log(JSON.stringify((await getJson(`/qorechain/pqc/v1/evm_window/${p.address}`)).json));
writeFileSync(`${KEYS_DIR}/s5-results.json`, JSON.stringify(out, (_, v) => typeof v === "bigint" ? v.toString() : v, 1));
