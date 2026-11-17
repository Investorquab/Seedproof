import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { keccak256, toHex } from "viem";
import { generatePqcKeypair, pqcVerify } from "@qorechain/sdk";
import {
  VaultAction,
  b64,
  describeVaultRequest,
  homeKeyHash,
  isVaultRequest,
  signVaultRequest,
  vaultPayload,
  vaultSignedMessage,
  type VaultRequest,
} from "../src/index.js";

const vectors = JSON.parse(readFileSync(new URL("./vectors/vault-signed-message-v1.json", import.meta.url), "utf8"));
const fUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const pocket = "0x2222222222222222222222222222222222222222";
const NOW = 1_800_000_000;

const req = (action: VaultAction, payload: `0x${string}`, over: Partial<VaultRequest> = {}): VaultRequest => ({
  v: 1,
  kind: "seedproof/vault-request",
  account: "qor1example",
  pocket,
  evmChainId: "9800",
  vault: "0x1111111111111111111111111111111111111111",
  nonce: "4",
  action,
  payload,
  deadline: NOW + 600,
  ...over,
});

describe("vault signed message", () => {
  it("matches the shared vectors byte for byte", () => {
    for (const c of vectors.cases) {
      const got = vaultSignedMessage({
        evmChainId: BigInt(c.chainId),
        vault: vectors.vault,
        nonce: BigInt(c.nonce),
        action: c.action,
        payload: c.payload,
        deadline: BigInt(c.deadline),
      });
      expect(toHex(got), c.name).toBe(c.expected);
    }
  });

  it("homeKeyHash is keccak256 of the raw public key", () => {
    const k = generatePqcKeypair();
    expect(homeKeyHash(k.publicKey)).toBe(keccak256(k.publicKey));
  });
});

describe("Home Key reads vault requests in plain words", () => {
  it("top-up to the pocket in fUSD", () => {
    const d = describeVaultRequest(req(VaultAction.TopUp, vaultPayload.transfer(fUSD, pocket, 30_000_000n)));
    expect(d.understood).toBe(true);
    expect(d.lines[0]!.text).toBe("Top up your Pocket with 30 fUSD from your vault, now");
    expect(d.lines[0]!.risk).toBe("high");
  });

  it("flags a top-up to anyone else as critical", () => {
    const d = describeVaultRequest(req(VaultAction.TopUp, vaultPayload.transfer(fUSD, "0x3333333333333333333333333333333333333333", 1_000_000n)));
    expect(d.lines[0]!.text).toMatch(/to 0x3333…3333, now$/);
    expect(d.lines[0]!.risk).toBe("critical");
  });

  it("flags an unknown token as critical and shows raw units", () => {
    const d = describeVaultRequest(req(VaultAction.TopUp, vaultPayload.transfer("0x4444444444444444444444444444444444444444", pocket, 5n)));
    expect(d.lines[0]!.text).toMatch(/5 base units of unknown token/);
    expect(d.lines[0]!.risk).toBe("critical");
  });

  it("says withdrawals wait", () => {
    const d = describeVaultRequest(req(VaultAction.Withdraw, vaultPayload.transfer(fUSD, pocket, 250_000_000n)));
    expect(d.lines[0]!.text).toBe("Withdraw 250 fUSD from your vault to your Pocket, after the waiting period");
  });

  it("reads delay, guardian and key rotation as critical", () => {
    expect(describeVaultRequest(req(VaultAction.SetDelay, vaultPayload.delay(7200n))).lines[0]!.text).toBe("Change the waiting period to 2 hours");
    expect(describeVaultRequest(req(VaultAction.SetGuardian, vaultPayload.guardian(pocket, true))).lines[0]!.risk).toBe("critical");
    expect(describeVaultRequest(req(VaultAction.RotateHomeKey, vaultPayload.homeKey(keccak256("0x01")))).lines[0]!.risk).toBe("critical");
  });

  it("refuses a payload that does not match its action", () => {
    expect(describeVaultRequest(req(VaultAction.TopUp, "0x1234")).understood).toBe(false);
  });

  it("validates request shape", () => {
    expect(isVaultRequest(req(VaultAction.Cancel, vaultPayload.id(1n)))).toBe(true);
    expect(isVaultRequest({ ...req(VaultAction.Cancel, vaultPayload.id(1n)), vault: "nope" })).toBe(false);
    expect(isVaultRequest({ ...req(VaultAction.Cancel, vaultPayload.id(1n)), action: 9 })).toBe(false);
  });
});

describe("Home Key signs what it rebuilt, not what the phone sent", () => {
  it("signature verifies over the rebuilt contract message", () => {
    const k = generatePqcKeypair();
    const r = req(VaultAction.TopUp, vaultPayload.transfer(fUSD, pocket, 30_000_000n));
    const res = signVaultRequest(r, k, NOW);
    const msg = vaultSignedMessage({ evmChainId: 9800n, vault: r.vault, nonce: 4n, action: r.action, payload: r.payload, deadline: BigInt(r.deadline) });
    expect(res.messageHash).toBe(keccak256(msg));
    expect(pqcVerify(k.publicKey, msg, b64.dec(res.pqcSignature))).toBe(true);
    expect(res.pqcPublicKey).toBe(b64.enc(k.publicKey));
  });

  it("refuses expired and unreadable requests", () => {
    const k = generatePqcKeypair();
    const r = req(VaultAction.Cancel, vaultPayload.id(1n));
    expect(() => signVaultRequest(r, k, r.deadline + 1)).toThrow(/expired/);
    expect(() => signVaultRequest(req(VaultAction.TopUp, "0x00"), k, NOW)).toThrow(/not understood/);
  });
});

describe("SetPocket", () => {
  it("reads as a pocket change and flags a stranger's address as critical", async () => {
    const { describeVaultRequest, vaultPayload, VaultAction, isVaultRequest } = await import("../src/vault.js");
    const base = { v: 1 as const, kind: "seedproof/vault-request" as const, account: "qor1x", pocket: "0x4dd783A871a2c413F3730CF645fCc60DE05B1A7f", evmChainId: "9800", vault: "0xadB21AAC72079Ce455a0b09ee56f069bf5E4f27C", nonce: "0", deadline: 1 };
    const own = { ...base, action: VaultAction.SetPocket, payload: vaultPayload.pocket(base.pocket) };
    const other = { ...base, action: VaultAction.SetPocket, payload: vaultPayload.pocket("0x2644E08518893Cd1D793386a4306B0e6CaB86e61") };
    expect(isVaultRequest(own)).toBe(true);
    expect(describeVaultRequest(own).lines[0]!.text).toMatch(/^Make your Pocket the only address top-ups can pay/);
    expect(describeVaultRequest(other).lines[0]!.risk).toBe("critical");
  });
});
