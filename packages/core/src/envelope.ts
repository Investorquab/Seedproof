/**
 * Approval envelope: what the phone sends to the Home Key, and what comes back.
 *
 * QoreChain's ML-DSA-87 signature covers (B0, authInfo): the tx body WITHOUT
 * the PQC extension, plus the AuthInfo, in the network's sign-bytes form. It
 * does not cover the classical signature. So the Home Key can sign first, on a
 * separate device, and the phone attaches the extension and signs classically
 * afterwards. This mirrors `buildHybridTx` in @qorechain/sdk 0.14.
 */
import type { SignBytesVersion } from "@qorechain/sdk";

export const ENVELOPE_VERSION = 1 as const;

export interface ApprovalRequest {
  v: typeof ENVELOPE_VERSION;
  kind: "seedproof/approval-request";
  chainId: string;
  /** qor1 address of the account the tx is for. */
  account: string;
  accountNumber: string;
  sequence: string;
  signBytesVersion: SignBytesVersion;
  /** base64 TxBody bytes WITHOUT the PQC extension (B0). */
  bodyB0: string;
  /** base64 AuthInfo bytes. */
  authInfo: string;
  /** Unix seconds after which the Home Key refuses to sign. */
  expiresAt: number;
}

export interface ApprovalResponse {
  v: typeof ENVELOPE_VERSION;
  kind: "seedproof/approval-response";
  /** sha256 hex of the exact sign-bytes that were signed, so the phone can match it. */
  signBytesSha256: string;
  /** base64 4,627-byte ML-DSA-87 signature. */
  pqcSignature: string;
}

/** Base64 that works the same in browsers and Node (no Buffer). */
export const b64 = {
  enc(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  },
  dec(text: string): Uint8Array {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function isApprovalRequest(x: unknown): x is ApprovalRequest {
  const r = x as ApprovalRequest;
  return (
    !!r &&
    r.v === ENVELOPE_VERSION &&
    r.kind === "seedproof/approval-request" &&
    typeof r.chainId === "string" &&
    typeof r.account === "string" &&
    typeof r.accountNumber === "string" &&
    typeof r.sequence === "string" &&
    (r.signBytesVersion === "v1" || r.signBytesVersion === "v2") &&
    typeof r.bodyB0 === "string" &&
    typeof r.authInfo === "string" &&
    typeof r.expiresAt === "number"
  );
}
