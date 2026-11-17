/**
 * Linking: make the Home Key the account's post-quantum key.
 *
 * Two cases, decided by the phone from what the chain has registered:
 *
 * - register: the account has no PQ key yet. The Home Key's key becomes the
 *   first and only key, with a proof of possession signed by the Home Key.
 *   The seed-derived key is never registered at all. The registration tx is
 *   the one classical-signed tx the chain accepts.
 *
 * - rotate: the account already has the seed-derived key (QoreX, SDK). The
 *   chain's MsgRotatePQCKey must be signed by BOTH the old and the new key over
 *   "qorechain-pqc-rotate-v1|chain|alg|account|oldHex|newHex". The Home Key
 *   signs with the new key; the phone signs with the old (seed-derived) key and
 *   hybrid-signs the tx with it one last time. After this, the 24 words no
 *   longer produce a valid post-quantum signature.
 */
import {
  AlgorithmDilithium5,
  buildRegisterPqcKeyMsg,
  pqcSign,
  pqcVerify,
  proofOfPossessionSignBytes,
  rotatePqcKeyMsg,
  rotationSignBytes,
  type PqcKeypair,
} from "@qorechain/sdk";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { ENVELOPE_VERSION, b64 } from "./envelope.js";

const utf8 = new TextEncoder();

export interface LinkRequest {
  v: typeof ENVELOPE_VERSION;
  kind: "seedproof/link-request";
  mode: "register" | "rotate";
  chainId: string;
  account: string;
  /** base64 of the currently registered (seed-derived) key; rotate only. */
  oldPublicKey?: string;
  expiresAt: number;
}

export interface LinkResponse {
  v: typeof ENVELOPE_VERSION;
  kind: "seedproof/link-response";
  mode: "register" | "rotate";
  /** base64 2,592-byte ML-DSA-87 public key of the Home Key. */
  newPublicKey: string;
  /** base64 signature: the proof of possession (register) or the new-key rotation signature (rotate). */
  signature: string;
}

export function isLinkRequest(x: unknown): x is LinkRequest {
  const r = x as LinkRequest;
  return (
    !!r &&
    r.v === ENVELOPE_VERSION &&
    r.kind === "seedproof/link-request" &&
    (r.mode === "register" || (r.mode === "rotate" && typeof r.oldPublicKey === "string")) &&
    typeof r.chainId === "string" &&
    typeof r.account === "string" &&
    typeof r.expiresAt === "number"
  );
}

export function isLinkResponse(x: unknown): x is LinkResponse {
  const r = x as LinkResponse;
  return !!r && r.v === ENVELOPE_VERSION && r.kind === "seedproof/link-response" && typeof r.newPublicKey === "string" && typeof r.signature === "string";
}

export function createLinkRequest(input: {
  chainId: string;
  account: string;
  registeredPublicKey: Uint8Array | null;
  ttlSeconds?: number;
  now?: number;
}): LinkRequest {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  return {
    v: ENVELOPE_VERSION,
    kind: "seedproof/link-request",
    mode: input.registeredPublicKey ? "rotate" : "register",
    chainId: input.chainId,
    account: input.account,
    oldPublicKey: input.registeredPublicKey ? b64.enc(input.registeredPublicKey) : undefined,
    expiresAt: now + (input.ttlSeconds ?? 900),
  };
}

function linkBytes(req: LinkRequest, newPub: Uint8Array): Uint8Array {
  if (req.mode === "register") {
    return proofOfPossessionSignBytes({ chainId: req.chainId, account: req.account, publicKey: newPub, algorithmId: AlgorithmDilithium5 });
  }
  return utf8.encode(rotationSignBytes(req.chainId, AlgorithmDilithium5, req.account, b64.dec(req.oldPublicKey!), newPub));
}

/** Home Key side. */
export function signLinkRequest(req: LinkRequest, homeKey: PqcKeypair, now: number = Math.floor(Date.now() / 1000)): LinkResponse {
  if (now > req.expiresAt) throw new Error("link request expired");
  if (req.mode === "rotate" && b64.enc(homeKey.publicKey) === req.oldPublicKey) {
    throw new Error("this Home Key is already the account's key");
  }
  return {
    v: ENVELOPE_VERSION,
    kind: "seedproof/link-response",
    mode: req.mode,
    newPublicKey: b64.enc(homeKey.publicKey),
    signature: b64.enc(pqcSign(homeKey.secretKey, linkBytes(req, homeKey.publicKey))),
  };
}

/**
 * Phone side: check the Home Key's signature, then build the chain message.
 * For rotate, `oldKey` is the seed-derived keypair (the phone derives it from
 * the 24 words) and must match the request's old public key.
 */
export function buildLinkMessage(
  req: LinkRequest,
  res: LinkResponse,
  opts: { classicalPubkey: Uint8Array; oldKey?: PqcKeypair },
): EncodeObject {
  if (res.mode !== req.mode) throw new Error("Home Key answered a different kind of link");
  const newPub = b64.dec(res.newPublicKey);
  const sig = b64.dec(res.signature);
  const bytes = linkBytes(req, newPub);
  if (!pqcVerify(newPub, bytes, sig)) throw new Error("the Home Key's signature does not verify");

  if (req.mode === "register") {
    return buildRegisterPqcKeyMsg(req.account, {
      pqcKeypair: { publicKey: newPub, secretKey: new Uint8Array(0) },
      ecdsaPubkey: opts.classicalPubkey,
      keyType: "hybrid",
      proofOfPossession: sig,
    });
  }

  const oldKey = opts.oldKey;
  if (!oldKey || b64.enc(oldKey.publicKey) !== req.oldPublicKey) {
    throw new Error("the old key does not match the key registered for this account");
  }
  return rotatePqcKeyMsg({
    sender: req.account,
    oldPublicKey: oldKey.publicKey,
    newPublicKey: newPub,
    oldSignature: pqcSign(oldKey.secretKey, bytes),
    newSignature: sig,
  });
}
