/**
 * "One secret or two?"
 *
 * Given secrets the user already holds, rebuild every post-quantum key that
 * standard tooling would derive from them, and compare with the key the chain
 * has registered. A match means a thief with that secret holds BOTH keys.
 *
 * Runs locally. Never send a real seed phrase anywhere; use this on accounts
 * you control, ideally throwaway testnet accounts.
 */
import { derivePqcCanonical, derivePqcLegacy, unifiedAccountFromSeed, toHex } from "@qorechain/sdk";

export type ExposureVerdict =
  | { verdict: "ONE_SECRET"; derivation: Derivation; explain: string }
  | { verdict: "TWO_SECRETS"; checked: Derivation[]; explain: string };

export type Derivation =
  | "canonical-mnemonic" // QoreX, SDK, wallet adapter: SHAKE-256("qorechain:pqc:v1|" + address + "|" + mnemonic)
  | "legacy-bridge-mnemonic" // old tooling: SHAKE-256(mnemonic)
  | "pre-0.13-raw-key"; // SDK <= 0.12 unifiedAccountFromSeed: derived from the classical private key

const EXPLAIN: Record<Derivation, string> = {
  "canonical-mnemonic":
    "Your post-quantum key is derived from your 24 words. Anyone who steals the words holds both keys.",
  "legacy-bridge-mnemonic":
    "Your post-quantum key comes from an old derivation of your 24 words. Anyone who steals the words holds both keys.",
  "pre-0.13-raw-key":
    "Your post-quantum key was derived from your classical private key (SDK 0.12 or earlier). Anyone who steals that one key holds both.",
};

function eq(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && toHex(a) === toHex(b);
}

export interface ExposureInput {
  address: string;
  registeredPqcPublicKey: Uint8Array;
  mnemonic?: string;
  /** 32-byte classical private key, for raw-key accounts. */
  privateKey?: Uint8Array;
}

export function checkExposure(input: ExposureInput): ExposureVerdict {
  const checked: Derivation[] = [];
  const reg = input.registeredPqcPublicKey;

  if (input.mnemonic) {
    checked.push("canonical-mnemonic");
    if (eq(derivePqcCanonical(input.address, input.mnemonic).publicKey, reg)) {
      return { verdict: "ONE_SECRET", derivation: "canonical-mnemonic", explain: EXPLAIN["canonical-mnemonic"] };
    }
    checked.push("legacy-bridge-mnemonic");
    if (eq(derivePqcLegacy(input.mnemonic).publicKey, reg)) {
      return { verdict: "ONE_SECRET", derivation: "legacy-bridge-mnemonic", explain: EXPLAIN["legacy-bridge-mnemonic"] };
    }
  }

  if (input.privateKey) {
    checked.push("pre-0.13-raw-key");
    const legacy = unifiedAccountFromSeed(input.privateKey, { legacySeedDerivation: true });
    const pk = legacy.pqc?.publicKey;
    if (pk && eq(pk, reg)) {
      return { verdict: "ONE_SECRET", derivation: "pre-0.13-raw-key", explain: EXPLAIN["pre-0.13-raw-key"] };
    }
  }

  return {
    verdict: "TWO_SECRETS",
    checked,
    explain: "None of the standard derivations from these secrets produce your registered post-quantum key.",
  };
}
