/**
 * Vault requests: what the Home Key signs for the Seedproof Vault contract.
 *
 * The Home Key rebuilds the exact bytes the contract verifies
 * (`SeedproofVault.signedMessage`) from the request's fields, decodes the
 * payload itself and shows it in plain words. It never signs bytes the phone
 * computed, and never trusts the phone's description of a token.
 */
import { decodeAbiParameters, encodeAbiParameters, getAddress, isAddress, keccak256, toBytes, toHex, type Hex } from "viem";
import { pqcSign, type PqcKeypair } from "@qorechain/sdk";
import { ENVELOPE_VERSION, b64 } from "./envelope.js";
import type { DecodedLine } from "./decode.js";

/** Mirrors `SeedproofVault.Action`. Order matters. */
export const VaultAction = {
  TopUp: 0,
  Withdraw: 1,
  Cancel: 2,
  Unfreeze: 3,
  SetGuardian: 4,
  SetDailyLimit: 5,
  SetDelay: 6,
  RotateHomeKey: 7,
  SetPocket: 8,
} as const;
export type VaultAction = (typeof VaultAction)[keyof typeof VaultAction];
const ACTION_NAME = Object.fromEntries(Object.entries(VaultAction).map(([k, v]) => [v, k])) as Record<number, string>;

export const VAULT_DOMAIN: Hex = keccak256(toBytes("seedproof.vault.v1"));
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

/** Tokens the Home Key recognises on its own (QoreChain testnet fest tokens). */
export const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  [NATIVE_TOKEN]: { symbol: "QOR", decimals: 18 },
  "0x97143B771D34ddb9130b807b135Ae675A5a963CA": { symbol: "fUSD", decimals: 6 },
  "0x02292293c13880a26242690eb70a0e42B8E91c28": { symbol: "fETH", decimals: 18 },
  "0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A": { symbol: "fBTC", decimals: 8 },
};

export const vaultPayload = {
  transfer: (token: string, to: string, amount: bigint): Hex =>
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [getAddress(token), getAddress(to), amount]),
  id: (id: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [id]),
  none: (): Hex => "0x",
  guardian: (g: string, enabled: boolean): Hex => encodeAbiParameters([{ type: "address" }, { type: "bool" }], [getAddress(g), enabled]),
  limit: (token: string, limit: bigint): Hex => encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [getAddress(token), limit]),
  delay: (seconds: bigint): Hex => encodeAbiParameters([{ type: "uint64" }], [seconds]),
  homeKey: (hash: Hex): Hex => encodeAbiParameters([{ type: "bytes32" }], [hash]),
  pocket: (addr: string): Hex => encodeAbiParameters([{ type: "address" }], [getAddress(addr)]),
};

/** The exact bytes `SeedproofVault.signedMessage(action, payload, nonce, deadline)` returns. */
export function vaultSignedMessage(i: {
  evmChainId: bigint;
  vault: string;
  nonce: bigint;
  action: VaultAction;
  payload: Hex;
  deadline: bigint;
}): Uint8Array {
  const encoded = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint8" },
      { type: "bytes" },
      { type: "uint256" },
    ],
    [VAULT_DOMAIN, i.evmChainId, getAddress(i.vault), i.nonce, i.action, i.payload, i.deadline],
  );
  return toBytes(encoded);
}

/** keccak256 of an ML-DSA-87 public key: what the vault stores as `homeKeyHash`. */
export const homeKeyHash = (publicKey: Uint8Array): Hex => keccak256(publicKey);

export interface VaultRequest {
  v: typeof ENVELOPE_VERSION;
  kind: "seedproof/vault-request";
  /** qor1 account this Home Key protects (binding check). */
  account: string;
  /** 0x address of the same account's pocket on the EVM lane, so the Home Key can say "your Pocket". */
  pocket: string;
  evmChainId: string;
  vault: string;
  nonce: string;
  action: VaultAction;
  payload: Hex;
  deadline: number;
}

export interface VaultResponse {
  v: typeof ENVELOPE_VERSION;
  kind: "seedproof/vault-response";
  /** keccak256 of the signed bytes, so the phone can match the answer to its request. */
  messageHash: Hex;
  pqcPublicKey: string;
  pqcSignature: string;
}

export function isVaultRequest(x: unknown): x is VaultRequest {
  const r = x as VaultRequest;
  return (
    !!r &&
    r.v === ENVELOPE_VERSION &&
    r.kind === "seedproof/vault-request" &&
    typeof r.account === "string" &&
    isAddress(r.pocket) &&
    isAddress(r.vault) &&
    /^\d+$/.test(r.evmChainId) &&
    /^\d+$/.test(r.nonce) &&
    Number.isInteger(r.action) &&
    r.action >= 0 &&
    r.action <= 8 &&
    /^0x([0-9a-fA-F]{2})*$/.test(r.payload) &&
    Number.isInteger(r.deadline)
  );
}

export function isVaultResponse(x: unknown): x is VaultResponse {
  const r = x as VaultResponse;
  return !!r && r.kind === "seedproof/vault-response" && typeof r.pqcSignature === "string" && typeof r.pqcPublicKey === "string";
}

export function formatUnits(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 6);
  return `${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function describeAmount(token: string, amount: bigint): { text: string; known: boolean } {
  const t = KNOWN_TOKENS[getAddress(token)];
  if (t) return { text: `${formatUnits(amount, t.decimals)} ${t.symbol}`, known: true };
  return { text: `${amount.toString()} base units of unknown token ${short(token)}`, known: false };
}

function who(addr: string, pocket: string): string {
  return getAddress(addr) === getAddress(pocket) ? "your Pocket" : short(getAddress(addr));
}

export interface DescribedVaultRequest {
  lines: DecodedLine[];
  understood: boolean;
}

/** Plain-language reading of a vault request, decoded from the payload itself. */
export function describeVaultRequest(req: VaultRequest): DescribedVaultRequest {
  const line = (text: string, risk: DecodedLine["risk"]): DecodedLine => ({ typeUrl: `vault:${ACTION_NAME[req.action] ?? req.action}`, text, risk });
  try {
    switch (req.action) {
      case VaultAction.TopUp:
      case VaultAction.Withdraw: {
        const [token, to, amount] = decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], req.payload);
        const a = describeAmount(token, amount);
        const toPocket = getAddress(to) === getAddress(req.pocket);
        const verb = req.action === VaultAction.TopUp ? "Top up" : "Withdraw";
        const text =
          req.action === VaultAction.TopUp && toPocket
            ? `Top up your Pocket with ${a.text} from your vault, now`
            : `${verb} ${a.text} from your vault to ${who(to, req.pocket)}${req.action === VaultAction.Withdraw ? ", after the waiting period" : ", now"}`;
        return { lines: [line(text, !a.known || !toPocket ? "critical" : "high")], understood: true };
      }
      case VaultAction.Cancel: {
        const [id] = decodeAbiParameters([{ type: "uint256" }], req.payload);
        return { lines: [line(`Cancel waiting vault action #${id}`, "low")], understood: true };
      }
      case VaultAction.Unfreeze:
        return { lines: [line("Unfreeze your vault", "high")], understood: req.payload === "0x" };
      case VaultAction.SetGuardian: {
        const [g, on] = decodeAbiParameters([{ type: "address" }, { type: "bool" }], req.payload);
        return { lines: [line(`${on ? "Add" : "Remove"} guardian ${short(g)}`, "critical")], understood: true };
      }
      case VaultAction.SetDailyLimit: {
        const [token, limit] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], req.payload);
        return { lines: [line(`Set the daily top-up limit to ${describeAmount(token, limit).text}`, "high")], understood: true };
      }
      case VaultAction.SetDelay: {
        const [d] = decodeAbiParameters([{ type: "uint64" }], req.payload);
        const hours = Number(d) / 3600;
        return { lines: [line(`Change the waiting period to ${hours >= 1 ? `${hours} hours` : `${d} seconds`}`, "critical")], understood: true };
      }
      case VaultAction.SetPocket: {
        const [p] = decodeAbiParameters([{ type: "address" }], req.payload);
        const same = getAddress(p) === getAddress(req.pocket);
        return {
          lines: [line(`Make ${same ? "your Pocket" : short(p)} the only address top-ups can pay, after the waiting period`, same ? "high" : "critical")],
          understood: true,
        };
      }
      case VaultAction.RotateHomeKey:
        return { lines: [line("Replace the Home Key that controls this vault", "critical")], understood: true };
      default:
        return { lines: [line("Unknown vault action. Refuse.", "critical")], understood: false };
    }
  } catch {
    return { lines: [line("This vault request could not be read. Refuse.", "critical")], understood: false };
  }
}

/** Home Key side: rebuild the bytes from the fields, then sign. */
export function signVaultRequest(req: VaultRequest, homeKey: PqcKeypair, now: number = Math.floor(Date.now() / 1000)): VaultResponse {
  if (now > req.deadline) throw new Error("vault request expired");
  if (!describeVaultRequest(req).understood) throw new Error("vault request not understood");
  const message = vaultSignedMessage({
    evmChainId: BigInt(req.evmChainId),
    vault: req.vault,
    nonce: BigInt(req.nonce),
    action: req.action,
    payload: req.payload,
    deadline: BigInt(req.deadline),
  });
  return {
    v: ENVELOPE_VERSION,
    kind: "seedproof/vault-response",
    messageHash: keccak256(message),
    pqcPublicKey: b64.enc(homeKey.publicKey),
    pqcSignature: b64.enc(pqcSign(homeKey.secretKey, message)),
  };
}

export const toHexBytes = (b: Uint8Array): Hex => toHex(b);
