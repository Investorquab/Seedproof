import { describe, it, expect, beforeAll } from "vitest";
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import {
  MSG_SEND_TYPE_URL,
  closeEvmWindowMsg,
  deriveNativeAccount,
  derivePqcCanonical,
  directSignerFromPrivateKey,
  generateMnemonic,
  generatePqcRecoveryCode,
  openEvmWindowMsg,
  pqcKeyFromRecoveryCode,
  qorechainTypes,
  type PqcKeypair,
  type Secp256k1Account,
} from "@qorechain/sdk";
import type { OfflineDirectSigner } from "@cosmjs/proto-signing";
import {
  ApprovalRefused,
  approveRequest,
  assembleSignedTx,
  createApprovalRequest,
  verifyPqcLikeChain,
  b64,
  checkExposure,
  decodeRequestBody,
  type ApprovalRequest,
} from "../src/index.js";

const CHAIN = "qorechain-diana";
const VERSION = "v2" as const;
const NOW = 1_800_000_000;

const sigOf = (body: TxBody): Uint8Array => {
  const ext = body.extensionOptions[0];
  if (!ext) throw new Error("no extension");
  return qorechainTypes.pqcHybrid.PQCHybridSignature.decode(ext.value).pqcSignature;
};

let mnemonic: string;
let account: Secp256k1Account;
let signer: OfflineDirectSigner;
let homeKey: PqcKeypair; // independent: from a QRC1 recovery code, NOT from the seed
let seedKey: PqcKeypair; // what QoreX / the SDK derive from the 24 words

const send = (to: string, uqor: string) => ({
  typeUrl: MSG_SEND_TYPE_URL,
  value: { fromAddress: account.address, toAddress: to, amount: [{ denom: "uqor", amount: uqor }] },
});

const request = (messages: ReturnType<typeof send>[] | any[]): ApprovalRequest =>
  createApprovalRequest({
    chainId: CHAIN,
    account: account.address,
    classicalPubkey: account.publicKey,
    accountNumber: 42n,
    sequence: 7n,
    messages,
    fee: { amount: [{ denom: "uqor", amount: "80000" }], gasLimit: 800_000n },
    signBytesVersion: VERSION,
    now: NOW,
  });

beforeAll(async () => {
  mnemonic = generateMnemonic(256);
  account = await deriveNativeAccount(mnemonic);
  signer = await directSignerFromPrivateKey(account.privateKey, "qor");
  homeKey = pqcKeyFromRecoveryCode(generatePqcRecoveryCode(), account.address);
  seedKey = derivePqcCanonical(account.address, mnemonic);
});

describe("two-device hybrid signing", () => {
  it("phone + Home Key produce a tx the chain's PQC check accepts", async () => {
    const req = request([send(account.address, "1000000")]);
    const res = await approveRequest(req, homeKey, () => true, NOW);
    const tx = await assembleSignedTx(req, res, signer);
    expect(verifyPqcLikeChain(tx, homeKey.publicKey, CHAIN, VERSION, sigOf)).toBe(true);
  });

  it("a thief with the 24 words cannot pass once the Home Key is independent (chain code 21)", async () => {
    const req = request([send("qor1thief", "5000000")]);
    // The thief derives the PQ key exactly like QoreX does, from the stolen words.
    const forged = await approveRequest(req, seedKey, () => true, NOW);
    const tx = await assembleSignedTx(req, forged, signer);
    expect(verifyPqcLikeChain(tx, homeKey.publicKey, CHAIN, VERSION, sigOf)).toBe(false);
  });

  it("on a default account (PQ key from the seed) the same thief passes: the problem we fix", async () => {
    const req = request([send("qor1thief", "5000000")]);
    const forged = await approveRequest(req, seedKey, () => true, NOW);
    const tx = await assembleSignedTx(req, forged, signer);
    expect(verifyPqcLikeChain(tx, seedKey.publicKey, CHAIN, VERSION, sigOf)).toBe(true);
  });

  it("an approval cannot be reused for a different transaction", async () => {
    const approved = request([send(account.address, "1")]);
    const res = await approveRequest(approved, homeKey, () => true, NOW);
    const swapped = request([send("qor1thief", "999000000")]);
    await expect(assembleSignedTx(swapped, res, signer)).rejects.toThrow(/does not match/);
  });

  it("tampering with the body after approval fails the chain check", async () => {
    const req = request([send(account.address, "1")]);
    const res = await approveRequest(req, homeKey, () => true, NOW);
    const tampered: ApprovalRequest = { ...req, bodyB0: request([send("qor1thief", "999")]).bodyB0 };
    // Skip the phone's own guard to model a malicious phone app.
    const forcedRes = { ...res, signBytesSha256: "" };
    const tx = await assembleSignedTx(tampered, forcedRes as any, signer).catch(() => null);
    if (tx) expect(verifyPqcLikeChain(tx, homeKey.publicKey, CHAIN, VERSION, sigOf)).toBe(false);
  });

  it("refuses expired requests", async () => {
    const req = request([send(account.address, "1")]);
    await expect(approveRequest(req, homeKey, () => true, req.expiresAt + 1)).rejects.toBeInstanceOf(ApprovalRefused);
  });

  it("refuses when the human declines", async () => {
    const req = request([send(account.address, "1")]);
    await expect(approveRequest(req, homeKey, () => false, NOW)).rejects.toMatchObject({ reason: "user-declined" });
  });
});

describe("clear signing on the Home Key", () => {
  it("renders a send in plain language", () => {
    const d = decodeRequestBody(request([send("qor1abcdefghijklmnopqrstuvwxyz0123", "2500000")]));
    expect(d.understood).toBe(true);
    expect(d.lines[0]?.text).toMatch(/^Send 2\.5 QOR to qor1abcdef\.\.\./);
  });

  it("names a send to the account itself", () => {
    const d = decodeRequestBody(request([send(account.address, "1000000")]));
    expect(d.lines[0]?.text).toBe("Send 1 QOR to your own account");
  });

  it("flags an unscoped window as critical and a scoped one as high", () => {
    const open = (targets: string[]) =>
      openEvmWindowMsg({ sender: account.address, blocks: 7200, maxTxs: 5, maxValue: "20000000", allowedTargets: targets });
    expect(decodeRequestBody(request([open([])])).lines[0]?.risk).toBe("critical");
    const scoped = decodeRequestBody(request([open(["0x1111111111111111111111111111111111111111"])]));
    expect(scoped.lines[0]?.risk).toBe("high");
    expect(scoped.lines[0]?.text).toMatch(/up to 5 transactions, 20 QOR/);
  });

  it("closing the window is low risk", () => {
    expect(decodeRequestBody(request([closeEvmWindowMsg(account.address)])).lines[0]?.risk).toBe("low");
  });

  it("refuses to sign anything it cannot read", async () => {
    const req = request([send(account.address, "1")]);
    const body = TxBody.decode(b64.dec(req.bodyB0));
    body.messages.push({ typeUrl: "/cosmos.authz.v1beta1.MsgExec", value: new Uint8Array([1, 2, 3]) });
    const sneaky = { ...req, bodyB0: b64.enc(TxBody.encode(body).finish()) };
    await expect(approveRequest(sneaky, homeKey, () => true, NOW)).rejects.toMatchObject({ reason: "not-understood" });
  });
});

describe("one secret or two?", () => {
  it("default account: ONE_SECRET via the canonical mnemonic derivation", () => {
    const v = checkExposure({ address: account.address, registeredPqcPublicKey: seedKey.publicKey, mnemonic });
    expect(v.verdict).toBe("ONE_SECRET");
  });

  it("Seedproof account: TWO_SECRETS", () => {
    const v = checkExposure({ address: account.address, registeredPqcPublicKey: homeKey.publicKey, mnemonic, privateKey: account.privateKey });
    expect(v.verdict).toBe("TWO_SECRETS");
  });
});
