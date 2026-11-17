/**
 * Two-device hybrid signing for QoreChain.
 *
 *   phone:    createApprovalRequest  ->  (B0, authInfo)          --QR/relay-->
 *   home key: approveRequest         ->  ML-DSA-87 over sign-bytes  --QR/relay-->
 *   phone:    assembleSignedTx       ->  final body + classical sig  -> broadcast
 *
 * The phone never holds the ML-DSA-87 key. The Home Key never holds the
 * classical key. A thief with the seed phrase gets only the classical key.
 */
import { Registry, makeAuthInfoBytes, encodePubkey, type EncodeObject, type OfflineDirectSigner } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import { encodeSecp256k1Pubkey } from "@cosmjs/amino";
import { TxBody, TxRaw, SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing";
import {
  AlgorithmDilithium5,
  buildHybridSignatureExtension,
  encodeHybridExtension,
  hybridSignBytes,
  pqcSign,
  pqcVerify,
  qorechainRegistryTypes,
  sha256Hex,
  type PqcKeypair,
  type SignBytesVersion,
} from "@qorechain/sdk";
import { ENVELOPE_VERSION, b64, type ApprovalRequest, type ApprovalResponse } from "./envelope.js";
import { decodeRequestBody } from "./decode.js";

export const registry = new Registry([...defaultRegistryTypes, ...qorechainRegistryTypes]);

export interface FeeSpec {
  amount: { denom: string; amount: string }[];
  gasLimit: bigint;
}

export interface CreateRequestInput {
  chainId: string;
  account: string;
  /** 33-byte compressed secp256k1 public key of the account. */
  classicalPubkey: Uint8Array;
  accountNumber: bigint;
  sequence: bigint;
  messages: readonly EncodeObject[];
  fee: FeeSpec;
  memo?: string;
  signBytesVersion: SignBytesVersion;
  /** Seconds the request stays valid. Default 600. */
  ttlSeconds?: number;
  now?: number;
}

/** Phone side, step 1: encode B0 and AuthInfo exactly as the chain will see them. */
export function createApprovalRequest(input: CreateRequestInput): ApprovalRequest {
  const body = TxBody.fromPartial({
    messages: input.messages.map((m) => registry.encodeAsAny(m)),
    memo: input.memo ?? "",
  });
  const bodyB0 = TxBody.encode(body).finish();

  const authInfo = makeAuthInfoBytes(
    [{ pubkey: encodePubkey(encodeSecp256k1Pubkey(input.classicalPubkey)), sequence: Number(input.sequence) }],
    input.fee.amount,
    Number(input.fee.gasLimit),
    undefined,
    undefined,
    SignMode.SIGN_MODE_DIRECT,
  );

  const now = input.now ?? Math.floor(Date.now() / 1000);
  return {
    v: ENVELOPE_VERSION,
    kind: "seedproof/approval-request",
    chainId: input.chainId,
    account: input.account,
    accountNumber: input.accountNumber.toString(),
    sequence: input.sequence.toString(),
    signBytesVersion: input.signBytesVersion,
    bodyB0: b64.enc(bodyB0),
    authInfo: b64.enc(authInfo),
    expiresAt: now + (input.ttlSeconds ?? 600),
  };
}

export function requestSignBytes(req: ApprovalRequest): Uint8Array {
  return hybridSignBytes(req.signBytesVersion, req.chainId, b64.dec(req.bodyB0), b64.dec(req.authInfo));
}

export type RefusalReason = "expired" | "not-understood" | "has-extension" | "user-declined";

export class ApprovalRefused extends Error {
  readonly reason: RefusalReason;
  constructor(reason: RefusalReason) {
    super(`approval refused: ${reason}`);
    this.name = "ApprovalRefused";
    this.reason = reason;
  }
}

/** Home Key side: decode, check, sign. `confirm` is where the human reads the lines. */
export async function approveRequest(
  req: ApprovalRequest,
  homeKey: PqcKeypair,
  confirm: (lines: ReturnType<typeof decodeRequestBody>) => Promise<boolean> | boolean,
  now: number = Math.floor(Date.now() / 1000),
): Promise<ApprovalResponse> {
  if (now > req.expiresAt) throw new ApprovalRefused("expired");
  const decoded = decodeRequestBody(req);
  if (decoded.hasExtension) throw new ApprovalRefused("has-extension");
  if (!decoded.understood) throw new ApprovalRefused("not-understood");
  if (!(await confirm(decoded))) throw new ApprovalRefused("user-declined");

  const signBytes = requestSignBytes(req);
  return {
    v: ENVELOPE_VERSION,
    kind: "seedproof/approval-response",
    signBytesSha256: sha256Hex(signBytes),
    pqcSignature: b64.enc(pqcSign(homeKey.secretKey, signBytes)),
  };
}

/** Phone side, step 2: attach the Home Key signature, then sign classically. */
export async function assembleSignedTx(
  req: ApprovalRequest,
  res: ApprovalResponse,
  signer: OfflineDirectSigner,
): Promise<Uint8Array> {
  if (res.signBytesSha256 !== sha256Hex(requestSignBytes(req))) {
    throw new Error("approval does not match this request");
  }
  const ext = buildHybridSignatureExtension({
    algorithmId: AlgorithmDilithium5,
    signature: b64.dec(res.pqcSignature),
  });
  const finalBody = TxBody.decode(b64.dec(req.bodyB0));
  finalBody.extensionOptions = [encodeHybridExtension(ext)];
  const bodyBytes = TxBody.encode(finalBody).finish();
  const authInfoBytes = b64.dec(req.authInfo);

  const signDoc = SignDoc.fromPartial({
    bodyBytes,
    authInfoBytes,
    chainId: req.chainId,
    accountNumber: BigInt(req.accountNumber),
  });
  const { signature } = await signer.signDirect(req.account, signDoc);
  return TxRaw.encode(
    TxRaw.fromPartial({
      bodyBytes,
      authInfoBytes,
      signatures: [b64.dec(signature.signature)],
    }),
  ).finish();
}

/**
 * Offline mirror of the chain's PQC check: strip the extension, rebuild B0,
 * verify ML-DSA-87 against the registered key. `false` here is what the chain
 * reports as `pqc` code 21 (hybrid_verify_failed).
 */
export function verifyPqcLikeChain(
  txBytes: Uint8Array,
  registeredPqcPublicKey: Uint8Array,
  chainId: string,
  signBytesVersion: SignBytesVersion,
  extractSignature: (body: TxBody) => Uint8Array,
): boolean {
  const raw = TxRaw.decode(txBytes);
  const body = TxBody.decode(raw.bodyBytes);
  const sig = extractSignature(body);
  body.extensionOptions = [];
  const b0 = TxBody.encode(body).finish();
  const msg = hybridSignBytes(signBytesVersion, chainId, b0, raw.authInfoBytes);
  return pqcVerify(registeredPqcPublicKey, msg, sig);
}
