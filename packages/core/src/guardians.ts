/**
 * Guardian recovery for the Home Key.
 *
 * The Home Key's recovery code is split with Shamir (default 2 of 3). Each
 * share is sealed with QoreSeal (ML-KEM-1024 + X25519 hybrid) to one
 * guardian's key, bound to the account and the share number as associated
 * data. One guardian alone learns nothing. Any two can help rebuild the Home
 * Key on a new device. The 24 words play no part, so a stolen seed phrase
 * does not help with recovery either.
 */
import { open as qsOpen, seal as qsSeal, envelopeFromText, envelopeToText, type SealKeyPair } from "@qorechain/qoreseal";
import { isValidRecoveryCode, normalizeRecoveryCode } from "@qorechain/sdk";
import { ENVELOPE_VERSION, b64 } from "./envelope.js";
import { combine, split } from "./shamir.js";

export const GUARDIAN_PURPOSE = "seedproof-guardian-share";
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

/** What a guardian hands over so shares can be sealed to them. Public keys only. */
export interface GuardianCard {
  v: typeof ENVELOPE_VERSION;
  kind: "seedproof/guardian-card";
  name: string;
  mlkemPublicKey: string;
  x25519PublicKey: string;
}

/** One sealed share, kept by one guardian. Ciphertext only. */
export interface GuardianEnvelope {
  v: typeof ENVELOPE_VERSION;
  kind: "seedproof/guardian-envelope";
  chainId: string;
  account: string;
  guardian: string;
  index: number;
  threshold: number;
  total: number;
  envelope: string;
}

/** A share after its guardian opened it, handed to the person recovering. */
export interface GuardianShare {
  v: typeof ENVELOPE_VERSION;
  kind: "seedproof/guardian-share";
  account: string;
  index: number;
  threshold: number;
  total: number;
  share: string;
}

export const isGuardianCard = (x: unknown): x is GuardianCard =>
  !!x && (x as GuardianCard).kind === "seedproof/guardian-card" && typeof (x as GuardianCard).mlkemPublicKey === "string";
export const isGuardianEnvelope = (x: unknown): x is GuardianEnvelope =>
  !!x && (x as GuardianEnvelope).kind === "seedproof/guardian-envelope" && typeof (x as GuardianEnvelope).envelope === "string";
export const isGuardianShare = (x: unknown): x is GuardianShare =>
  !!x && (x as GuardianShare).kind === "seedproof/guardian-share" && typeof (x as GuardianShare).share === "string";

export function guardianCard(name: string, keys: Pick<SealKeyPair, "mlkemPublicKey" | "x25519PublicKey">): GuardianCard {
  return {
    v: ENVELOPE_VERSION,
    kind: "seedproof/guardian-card",
    name: name.trim().slice(0, 60),
    mlkemPublicKey: b64.enc(keys.mlkemPublicKey),
    x25519PublicKey: b64.enc(keys.x25519PublicKey),
  };
}

const aadFor = (account: string, index: number, threshold: number, total: number) =>
  utf8.encode(`${GUARDIAN_PURPOSE}:v1|${account}|${index}|${threshold}|${total}`);

/** Home Key side: split the recovery code and seal one share to each guardian. */
export function sealToGuardians(input: {
  chainId: string;
  account: string;
  recoveryCode: string;
  guardians: GuardianCard[];
  threshold?: number;
}): GuardianEnvelope[] {
  const total = input.guardians.length;
  const threshold = input.threshold ?? 2;
  if (total < 2) throw new Error("add at least 2 guardians");
  if (threshold < 2 || threshold > total) throw new Error("threshold must be between 2 and the number of guardians");
  const keys = new Set(input.guardians.map((g) => g.mlkemPublicKey));
  if (keys.size !== total) throw new Error("each guardian must have a different key");

  const secret = utf8.encode(normalizeRecoveryCode(input.recoveryCode));
  const shares = split(secret, threshold, total);
  return input.guardians.map((g, i) => {
    const index = shares[i]!.x;
    const envelope = qsSeal({
      chainId: input.chainId,
      purpose: GUARDIAN_PURPOSE,
      recipients: [{ mlkemPublicKey: b64.dec(g.mlkemPublicKey), x25519PublicKey: b64.dec(g.x25519PublicKey) }],
      plaintext: shares[i]!.y,
      aad: aadFor(input.account, index, threshold, total),
    });
    return {
      v: ENVELOPE_VERSION,
      kind: "seedproof/guardian-envelope",
      chainId: input.chainId,
      account: input.account,
      guardian: g.name,
      index,
      threshold,
      total,
      envelope: envelopeToText(envelope),
    };
  });
}

/** Guardian side: open your sealed share. Throws if it was not sealed to you or was altered. */
export function openGuardianEnvelope(env: GuardianEnvelope, keys: SealKeyPair): GuardianShare {
  const share = qsOpen({
    chainId: env.chainId,
    purpose: GUARDIAN_PURPOSE,
    envelope: envelopeFromText(env.envelope),
    keys,
    aad: aadFor(env.account, env.index, env.threshold, env.total),
  });
  return {
    v: ENVELOPE_VERSION,
    kind: "seedproof/guardian-share",
    account: env.account,
    index: env.index,
    threshold: env.threshold,
    total: env.total,
    share: b64.enc(share),
  };
}

/** New device: rebuild the Home Key's recovery code from enough shares. */
export function recoverHomeKey(shares: GuardianShare[], account: string): string {
  if (shares.length === 0) throw new Error("no shares yet");
  const threshold = shares[0]!.threshold;
  if (shares.some((s) => s.account !== account)) throw new Error("a share belongs to a different account");
  if (shares.some((s) => s.threshold !== threshold || s.total !== shares[0]!.total)) throw new Error("shares come from different setups");
  const unique = new Map(shares.map((s) => [s.index, s]));
  if (unique.size < threshold) throw new Error(`need ${threshold} different guardians, have ${unique.size}`);
  const code = fromUtf8.decode(combine([...unique.values()].slice(0, threshold).map((s) => ({ x: s.index, y: b64.dec(s.share) }))));
  if (!isValidRecoveryCode(code)) throw new Error("the shares do not rebuild a valid Home Key code");
  return formatRecoveryCode(code);
}

/** The written form people keep: QRC1-XXXX-XXXX-… (the SDK accepts either form). */
export function formatRecoveryCode(code: string): string {
  const bare = normalizeRecoveryCode(code);
  const formatted = `QRC1-${bare.match(/.{1,4}/g)!.join("-")}`;
  return isValidRecoveryCode(formatted) ? formatted : bare;
}
