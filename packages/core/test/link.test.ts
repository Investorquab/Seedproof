import { describe, it, expect, beforeAll } from "vitest";
import {
  AlgorithmDilithium5,
  deriveNativeAccount,
  derivePqcCanonical,
  generateMnemonic,
  generatePqcRecoveryCode,
  pqcKeyFromRecoveryCode,
  pqcVerify,
  proofOfPossessionSignBytes,
  qorechainTypes,
  rotationSignBytes,
  type PqcKeypair,
  type Secp256k1Account,
} from "@qorechain/sdk";
import { b64, buildLinkMessage, createLinkRequest, isLinkRequest, isLinkResponse, signLinkRequest, registry } from "../src/index.js";

const CHAIN = "qorechain-diana";
const NOW = 1_800_000_000;
const utf8 = new TextEncoder();

let account: Secp256k1Account;
let seedKey: PqcKeypair;
let homeKey: PqcKeypair;

beforeAll(async () => {
  const mnemonic = generateMnemonic(256);
  account = await deriveNativeAccount(mnemonic);
  seedKey = derivePqcCanonical(account.address, mnemonic);
  homeKey = pqcKeyFromRecoveryCode(generatePqcRecoveryCode(), account.address);
});

const decode = (m: { typeUrl: string; value: unknown }) => registry.decode(registry.encodeAsAny(m as any));

describe("link: new account (register the Home Key directly)", () => {
  it("chooses register when nothing is on chain", () => {
    const req = createLinkRequest({ chainId: CHAIN, account: account.address, registeredPublicKey: null, now: NOW });
    expect(req.mode).toBe("register");
    expect(isLinkRequest(req)).toBe(true);
  });

  it("the Home Key's proof of possession verifies and lands in MsgRegisterPQCKeyV2", () => {
    const req = createLinkRequest({ chainId: CHAIN, account: account.address, registeredPublicKey: null, now: NOW });
    const res = signLinkRequest(req, homeKey, NOW);
    expect(isLinkResponse(res)).toBe(true);
    const pop = proofOfPossessionSignBytes({ chainId: CHAIN, account: account.address, publicKey: homeKey.publicKey, algorithmId: AlgorithmDilithium5 });
    expect(pqcVerify(homeKey.publicKey, pop, b64.dec(res.signature))).toBe(true);

    const msg = buildLinkMessage(req, res, { classicalPubkey: account.publicKey });
    expect(msg.typeUrl).toBe("/qorechain.pqc.v1.MsgRegisterPQCKeyV2");
    const v = decode(msg) as any;
    expect(b64.enc(v.publicKey)).toBe(b64.enc(homeKey.publicKey));
    expect(b64.enc(v.proofOfPossession)).toBe(res.signature);
    expect(v.keyType).toBe("hybrid");
  });

  it("the seed-derived key is never what gets registered", () => {
    const req = createLinkRequest({ chainId: CHAIN, account: account.address, registeredPublicKey: null, now: NOW });
    const v = decode(buildLinkMessage(req, signLinkRequest(req, homeKey, NOW), { classicalPubkey: account.publicKey })) as any;
    expect(b64.enc(v.publicKey)).not.toBe(b64.enc(seedKey.publicKey));
  });
});

describe("link: existing account (rotate away from the seed-derived key)", () => {
  const rotateReq = () => createLinkRequest({ chainId: CHAIN, account: account.address, registeredPublicKey: seedKey.publicKey, now: NOW });

  it("chooses rotate when a key is on chain", () => {
    expect(rotateReq().mode).toBe("rotate");
  });

  it("builds a dual-signed MsgRotatePQCKey that both keys verify", () => {
    const req = rotateReq();
    const res = signLinkRequest(req, homeKey, NOW);
    const msg = buildLinkMessage(req, res, { classicalPubkey: account.publicKey, oldKey: seedKey });
    expect(msg.typeUrl).toBe("/qorechain.pqc.v1.MsgRotatePQCKey");
    const v = decode(msg) as any;
    const bytes = utf8.encode(rotationSignBytes(CHAIN, AlgorithmDilithium5, account.address, seedKey.publicKey, homeKey.publicKey));
    expect(pqcVerify(seedKey.publicKey, bytes, v.oldSignature)).toBe(true);
    expect(pqcVerify(homeKey.publicKey, bytes, v.newSignature)).toBe(true);
    expect(b64.enc(v.newPublicKey)).toBe(b64.enc(homeKey.publicKey));
  });

  it("refuses an old key that is not the registered one", () => {
    const req = rotateReq();
    const res = signLinkRequest(req, homeKey, NOW);
    const other = pqcKeyFromRecoveryCode(generatePqcRecoveryCode(), account.address);
    expect(() => buildLinkMessage(req, res, { classicalPubkey: account.publicKey, oldKey: other })).toThrow(/old key/);
  });

  it("refuses a forged Home Key answer", () => {
    const req = rotateReq();
    const res = signLinkRequest(req, homeKey, NOW);
    const forged = { ...res, newPublicKey: b64.enc(pqcKeyFromRecoveryCode(generatePqcRecoveryCode(), account.address).publicKey) };
    expect(() => buildLinkMessage(req, forged, { classicalPubkey: account.publicKey, oldKey: seedKey })).toThrow(/does not verify/);
  });

  it("refuses to link a key to itself", () => {
    const req = createLinkRequest({ chainId: CHAIN, account: account.address, registeredPublicKey: homeKey.publicKey, now: NOW });
    expect(() => signLinkRequest(req, homeKey, NOW)).toThrow(/already/);
  });

  it("refuses an expired link request", () => {
    const req = rotateReq();
    expect(() => signLinkRequest(req, homeKey, req.expiresAt + 1)).toThrow(/expired/);
  });

  it("a rotate answer cannot be used as a register answer", () => {
    const res = signLinkRequest(rotateReq(), homeKey, NOW);
    const regReq = createLinkRequest({ chainId: CHAIN, account: account.address, registeredPublicKey: null, now: NOW });
    expect(() => buildLinkMessage(regReq, res, { classicalPubkey: account.publicKey })).toThrow(/different kind/);
  });

  it("decodes through the shared registry", () => {
    expect(qorechainTypes.pqc.MsgRotatePQCKey).toBeDefined();
  });
});
