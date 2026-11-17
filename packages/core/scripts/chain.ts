/** Small Node helpers for scripts that talk to qorechain-diana. */
import { readFileSync } from "node:fs";
import { clearPqcStatusCache, deriveUnifiedAccount, fetchPqcStatus, pqcStatusPublicKey, type PqcKeypair } from "@qorechain/sdk";
import { hexToBytes } from "viem";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { createApprovalRequest, approveRequest, assembleSignedTx, ethDirectSigner, signClassicalOnly } from "../src/split.js";

export const NET = {
  chainId: "qorechain-diana",
  rest: process.env.QORE_REST ?? "https://api-testnet.qore.host",
  evm: process.env.QORE_EVM_RPC ?? "https://evm-testnet.qore.host",
  explorer: "https://explore.qore.network",
};
export const FEE = { amount: [{ denom: "uqor", amount: "200000" }], gasLimit: 2_000_000n };
export const KEYS_DIR = process.env.SEEDPROOF_KEYS_DIR ?? "../../.keys";
const KEYS = `${KEYS_DIR}/accounts.json`;

export interface Acct {
  name: string;
  address: string;
  evm: `0x${string}`;
  privateKey: `0x${string}`;
  publicKey: Uint8Array;
  seedPqc: PqcKeypair;
  signer: ReturnType<typeof ethDirectSigner>;
}

export async function load(name: string): Promise<Acct> {
  const all = JSON.parse(readFileSync(KEYS, "utf8"));
  const a = await deriveUnifiedAccount(all[name].mnemonic);
  const pub = hexToBytes(a.publicKey as `0x${string}`);
  return {
    name, address: a.cosmos, evm: a.evm as `0x${string}`, privateKey: a.privateKey as `0x${string}`,
    publicKey: pub, seedPqc: a.pqc, signer: ethDirectSigner(a.privateKey as `0x${string}`, a.cosmos, pub),
  };
}

export async function getJson(path: string) {
  const r = await fetch(NET.rest + path);
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

export async function accountInfo(address: string) {
  const { status, json } = await getJson(`/cosmos/auth/v1beta1/accounts/${address}`);
  if (status !== 200) return { accountNumber: 0n, sequence: 0n, exists: false };
  const a = json.account?.base_account ?? json.account;
  return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0), exists: true };
}

export async function balances(address: string) {
  return (await getJson(`/cosmos/bank/v1beta1/balances/${address}`)).json.balances ?? [];
}

export async function registeredKey(address: string): Promise<Uint8Array | null> {
  clearPqcStatusCache();
  const s = await fetchPqcStatus({ rest: NET.rest, address });
  return s.registered ? pqcStatusPublicKey(s) ?? null : null;
}

export interface Outcome { txhash: string; code: number; codespace?: string; rawLog: string; gasUsed?: string; height?: string }

export async function broadcast(tx: Uint8Array): Promise<Outcome> {
  const r = await fetch(`${NET.rest}/cosmos/tx/v1beta1/txs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_bytes: Buffer.from(tx).toString("base64"), mode: "BROADCAST_MODE_SYNC" }),
  });
  const j = await r.json();
  const t = j.tx_response ?? {};
  const out: Outcome = { txhash: t.txhash ?? "", code: Number(t.code ?? -1), codespace: t.codespace, rawLog: t.raw_log ?? JSON.stringify(j) };
  if (out.code !== 0 || !out.txhash) return out;
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const q = await getJson(`/cosmos/tx/v1beta1/txs/${out.txhash}`);
    if (q.status === 200 && q.json.tx_response) {
      const x = q.json.tx_response;
      return { txhash: out.txhash, code: Number(x.code), codespace: x.codespace, rawLog: x.raw_log, gasUsed: x.gas_used, height: x.height };
    }
  }
  return { ...out, rawLog: "not included after 60s" };
}

/** Hybrid tx where the PQ signature comes from `pqcKey` (seed key, Home Key, or a thief's guess). */
export async function sendHybrid(acct: Acct, messages: EncodeObject[], pqcKey: PqcKeypair, memo = ""): Promise<Outcome> {
  const info = await accountInfo(acct.address);
  const req = createApprovalRequest({
    chainId: NET.chainId, account: acct.address, classicalPubkey: acct.publicKey,
    accountNumber: info.accountNumber, sequence: info.sequence, messages, fee: FEE, memo, signBytesVersion: "v2",
  });
  const res = await approveRequest(req, pqcKey, () => true);
  return broadcast(await assembleSignedTx(req, res, acct.signer));
}

export async function sendClassical(acct: Acct, messages: EncodeObject[], memo = ""): Promise<Outcome> {
  const info = await accountInfo(acct.address);
  const req = createApprovalRequest({
    chainId: NET.chainId, account: acct.address, classicalPubkey: acct.publicKey,
    accountNumber: info.accountNumber, sequence: info.sequence, messages, fee: FEE, memo, signBytesVersion: "v2",
  });
  return broadcast(await signClassicalOnly(req, acct.signer));
}

export const msgSend = (from: string, to: string, uqor: bigint | string): EncodeObject => ({
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: { fromAddress: from, toAddress: to, amount: [{ denom: "uqor", amount: uqor.toString() }] },
});

export const show = (label: string, o: Outcome) =>
  console.log(`${o.code === 0 ? "OK  " : "FAIL"} ${label}  code=${o.code}${o.codespace ? "/" + o.codespace : ""} gas=${o.gasUsed ?? "-"} tx=${o.txhash}\n     ${o.code === 0 ? "" : o.rawLog.slice(0, 300)}`);

import { createLinkRequest, signLinkRequest, buildLinkMessage } from "../src/link.js";
/** First-time registration of `key` for the account (classical-only, with proof of possession). */
export async function registerKey(acct: Acct, key: PqcKeypair): Promise<Outcome> {
  const req = createLinkRequest({ chainId: NET.chainId, account: acct.address, registeredPublicKey: null });
  const res = signLinkRequest(req, key);
  return sendClassical(acct, [buildLinkMessage(req, res, { classicalPubkey: acct.publicKey })]);
}
