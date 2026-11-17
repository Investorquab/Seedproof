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
import { PubKey as Secp256k1PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys";
import { keccak256, hexToBytes } from "viem";
import { sign as secpSign } from "viem/accounts";
import {
  AlgorithmDilithium5,
  buildHybridSignatureExtension,
  ETHSECP256K1_PUBKEY_TYPE,
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
import { convertRegistryTypes } from "./convert.js";

export const registry = new Registry([...defaultRegistryTypes, ...qorechainRegistryTypes, ...convertRegistryTypes]);

export interface FeeSpec {
  amount: { denom: string; amount: string }[];
  gasLimit: bigint;
}

export interface CreateRequestInput {
  chainId: string;
  account: string;
  /** 33-byte compressed secp256k1 public key of the account. */
  classicalPubkey: Uint8Array;
  /**
   * How the chain knows this key. "eth_secp256k1" for unified accounts
   * (m/44'/60', the ones with a 0x twin, used by QoreX and the EVM window);
   * "secp256k1" for classic Cosmos-path accounts. Default "eth_secp256k1".
   */
  pubkeyType?: "eth_secp256k1" | "secp256k1";
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

  const pubkey =
    (input.pubkeyType ?? "eth_secp256k1") === "eth_secp256k1"
      ? { typeUrl: ETHSECP256K1_PUBKEY_TYPE, value: Secp256k1PubKey.encode({ key: input.classicalPubkey }).finish() }
      : encodePubkey(encodeSecp256k1Pubkey(input.classicalPubkey));
  const authInfo = makeAuthInfoBytes(
    [{ pubkey, sequence: Number(input.sequence) }],
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

/**
 * Classical-only signing. The chain accepts exactly one such tx per account:
 * the FIRST post-quantum key registration (MsgRegisterPQCKeyV2). Everything
 * after it must be hybrid-signed.
 */
export async function signClassicalOnly(req: ApprovalRequest, signer: OfflineDirectSigner): Promise<Uint8Array> {
  const bodyBytes = b64.dec(req.bodyB0);
  const authInfoBytes = b64.dec(req.authInfo);
  const signDoc = SignDoc.fromPartial({ bodyBytes, authInfoBytes, chainId: req.chainId, accountNumber: BigInt(req.accountNumber) });
  const { signature } = await signer.signDirect(req.account, signDoc);
  return TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [b64.dec(signature.signature)] })).finish();
}

/**
 * cosmjs-style direct signer for a unified (eth_secp256k1) account: the chain
 * checks secp256k1 over keccak256(SignDoc), as 64-byte r||s with low s.
 */
export function ethDirectSigner(privateKey: `0x${string}`, address: string, publicKey: Uint8Array): OfflineDirectSigner {
  return {
    async getAccounts() {
      return [{ address, algo: "secp256k1" as const, pubkey: publicKey }];
    },
    async signDirect(signerAddress, signDoc) {
      if (signerAddress !== address) throw new Error("signer does not hold this account");
      const hash = keccak256(SignDoc.encode(signDoc).finish());
      const sig = await secpSign({ hash, privateKey });
      const rs = new Uint8Array(64);
      rs.set(hexToBytes(sig.r, { size: 32 }), 0);
      rs.set(hexToBytes(sig.s, { size: 32 }), 32);
      return {
        signed: signDoc,
        signature: {
          pub_key: { type: "ethermint/PubKeyEthSecp256k1", value: b64.enc(publicKey) },
          signature: b64.enc(rs),
        },
      };
    },
  };
}

