import { describe, it, expect } from "vitest";
import { generateSealKeys } from "@qorechain/qoreseal";
import { generatePqcRecoveryCode, normalizeRecoveryCode, pqcKeyFromRecoveryCode } from "@qorechain/sdk";
import { combine, split } from "../src/shamir.js";
import { guardianCard, isGuardianEnvelope, openGuardianEnvelope, recoverHomeKey, sealToGuardians } from "../src/index.js";

const CHAIN = "qorechain-diana";
const ACCOUNT = "qor1uc3cp25vmle480j082c5qmxz686d2jk56l6uz2";

describe("Shamir over GF(256)", () => {
  const secret = crypto.getRandomValues(new Uint8Array(48));

  it("any 2 of 3 shares rebuild the secret", () => {
    const s = split(secret, 2, 3);
    for (const pair of [[0, 1], [0, 2], [1, 2], [2, 0]]) {
      expect(combine(pair.map((i) => s[i]!))).toEqual(secret);
    }
  });

  it("3 of 5 works with any 3 and with all 5", () => {
    const s = split(secret, 3, 5);
    expect(combine([s[4]!, s[1]!, s[2]!])).toEqual(secret);
    expect(combine(s)).toEqual(secret);
  });

  it("one share alone is not the secret, and two of a 3-of-5 rebuild something else", () => {
    const s = split(secret, 3, 5);
    expect(s[0]!.y).not.toEqual(secret);
    expect(combine([s[0]!, s[1]!])).not.toEqual(secret);
  });

  it("a single share is uniformly distributed (it does not leak the secret byte)", () => {
    // For a fixed secret byte, share 1's byte over many splits should take many values.
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(split(new Uint8Array([42]), 2, 2)[0]!.y[0]!);
    expect(seen.size).toBeGreaterThan(240);
  });

  it("rejects bad parameters and duplicate shares", () => {
    expect(() => split(secret, 1, 3)).toThrow();
    expect(() => split(secret, 4, 3)).toThrow();
    const s = split(secret, 2, 3);
    expect(() => combine([s[0]!, s[0]!])).toThrow(/duplicate/);
  });
});

describe("guardian recovery with QoreSeal", () => {
  const code = generatePqcRecoveryCode();
  const keys = [generateSealKeys(), generateSealKeys(), generateSealKeys()];
  const cards = keys.map((k, i) => guardianCard(["Ada", "Bayo", "Chika"][i]!, k));
  const envs = sealToGuardians({ chainId: CHAIN, account: ACCOUNT, recoveryCode: code, guardians: cards });

  it("produces one sealed envelope per guardian, ciphertext only", () => {
    expect(envs).toHaveLength(3);
    for (const e of envs) {
      expect(isGuardianEnvelope(e)).toBe(true);
      expect(e.envelope).not.toContain(code);
      expect(e.envelope.startsWith("qoreseal:")).toBe(true);
    }
  });

  it("any two guardians rebuild the same Home Key", () => {
    const a = openGuardianEnvelope(envs[0]!, keys[0]!);
    const c = openGuardianEnvelope(envs[2]!, keys[2]!);
    const rebuilt = recoverHomeKey([a, c], ACCOUNT);
    expect(rebuilt).toBe(code);
    expect(normalizeRecoveryCode(rebuilt)).toBe(normalizeRecoveryCode(code));
    expect(pqcKeyFromRecoveryCode(rebuilt, ACCOUNT).publicKey).toEqual(pqcKeyFromRecoveryCode(code, ACCOUNT).publicKey);
  });

  it("one guardian is not enough", () => {
    expect(() => recoverHomeKey([openGuardianEnvelope(envs[1]!, keys[1]!)], ACCOUNT)).toThrow(/need 2/);
  });

  it("the same guardian twice is not enough", () => {
    const b = openGuardianEnvelope(envs[1]!, keys[1]!);
    expect(() => recoverHomeKey([b, b], ACCOUNT)).toThrow(/need 2/);
  });

  it("a guardian cannot open someone else's envelope", () => {
    expect(() => openGuardianEnvelope(envs[0]!, keys[1]!)).toThrow();
  });

  it("an envelope moved to another account will not open", () => {
    expect(() => openGuardianEnvelope({ ...envs[0]!, account: "qor1someoneelse" }, keys[0]!)).toThrow();
  });

  it("refuses shares for a different account", () => {
    const a = openGuardianEnvelope(envs[0]!, keys[0]!);
    const b = openGuardianEnvelope(envs[1]!, keys[1]!);
    expect(() => recoverHomeKey([a, { ...b, account: "qor1other" }], ACCOUNT)).toThrow(/different account/);
  });

  it("needs at least 2 distinct guardians to set up", () => {
    expect(() => sealToGuardians({ chainId: CHAIN, account: ACCOUNT, recoveryCode: code, guardians: [cards[0]!] })).toThrow();
    expect(() => sealToGuardians({ chainId: CHAIN, account: ACCOUNT, recoveryCode: code, guardians: [cards[0]!, cards[0]!] })).toThrow(/different key/);
  });
});
