import { fetchPqcStatus, pqcStatusPublicKey } from "@qorechain/sdk";
import { NETWORK } from "../config";

/** The ML-DSA-87 public key the chain has registered for an account, if any. */
export async function registeredPqcKey(address: string): Promise<Uint8Array | null> {
  const status = await fetchPqcStatus({ rest: NETWORK.rest, address });
  if (!status.registered) return null;
  return pqcStatusPublicKey(status) ?? null;
}

export interface AccountInfo {
  accountNumber: bigint;
  sequence: bigint;
}

/** Account number and sequence from the standard Cosmos auth route. */
export async function accountInfo(address: string): Promise<AccountInfo> {
  const res = await fetch(`${NETWORK.rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (!res.ok) throw new Error(`Could not read the account (${res.status}). Is it funded yet?`);
  const json = await res.json();
  // Accounts can be wrapped (e.g. eth accounts carry base_account).
  const acct = json.account?.base_account ?? json.account;
  return { accountNumber: BigInt(acct.account_number ?? 0), sequence: BigInt(acct.sequence ?? 0) };
}

export async function nativeBalance(address: string, denom = "uqor"): Promise<bigint> {
  const res = await fetch(`${NETWORK.rest}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${denom}`);
  if (!res.ok) return 0n;
  const json = await res.json();
  return BigInt(json.balance?.amount ?? 0);
}

export interface BroadcastOutcome {
  txhash: string;
  code: number;
  rawLog: string;
}

export async function broadcast(txBytes: Uint8Array): Promise<BroadcastOutcome> {
  let bin = "";
  for (const b of txBytes) bin += String.fromCharCode(b);
  const res = await fetch(`${NETWORK.rest}/cosmos/tx/v1beta1/txs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_bytes: btoa(bin), mode: "BROADCAST_MODE_SYNC" }),
  });
  const json = await res.json();
  const r = json.tx_response ?? {};
  return { txhash: r.txhash ?? "", code: Number(r.code ?? -1), rawLog: r.raw_log ?? JSON.stringify(json) };
}

export const explorerTx = (hash: string) => `${NETWORK.explorer}/tx/${hash}`;
