import { describe, it, expect } from "vitest";
import { deriveUnifiedAccount, generateMnemonic, generatePqcKeypair, signHybridEth, pqcVerify, hybridSignBytes } from "@qorechain/sdk";
import { TxRaw, TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { keccak256, hexToBytes, recoverPublicKey, toHex } from "viem";
import { SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { createApprovalRequest, approveRequest, assembleSignedTx, ethDirectSigner, registry } from "../src/split.js";

const CHAIN = "qorechain-diana";
const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gasLimit: 1_000_000n };

describe("split signing for unified (eth_secp256k1) accounts", () => {
  it("builds the same body and authInfo as the SDK's signHybridEth", async () => {
    const acct = await deriveUnifiedAccount(generateMnemonic(256));
    const home = generatePqcKeypair();
    const pub = hexToBytes(acct.publicKey as `0x${string}`);
    const messages = [
      { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: acct.cosmos, toAddress: acct.cosmos, amount: [{ denom: "uqor", amount: "1" }] } },
    ];

    const req = createApprovalRequest({
      chainId: CHAIN, account: acct.cosmos, classicalPubkey: pub, accountNumber: 7n, sequence: 3n,
      messages, fee: FEE, signBytesVersion: "v2", memo: "",
    });
    const res = await approveRequest(req, home, () => true);
    const tx = TxRaw.decode(await assembleSignedTx(req, res, ethDirectSigner(acct.privateKey as `0x${string}`, acct.cosmos, pub)));

    const sdk = signHybridEth({
      account: { privateKey: acct.privateKey, publicKey: acct.publicKey, pqc: home },
      chainId: CHAIN, accountNumber: 7n, sequence: 3n, messages,
      fee: { amount: FEE.amount, gas: FEE.gasLimit.toString() }, signBytesVersion: "v2",
      encodeMessage: (m) => registry.encodeAsAny(m),
    });

    // Same authInfo (pubkey type URL, sequence, fee) and same B0.
    expect(toHex(tx.authInfoBytes)).toBe(toHex(sdk.authInfoBytes));
    const strip = (b: Uint8Array) => { const x = TxBody.decode(b); x.extensionOptions = []; return toHex(TxBody.encode(x).finish()); };
    expect(strip(tx.bodyBytes)).toBe(strip(sdk.bodyBytes));

    // PQ part: verifies over the hybrid sign-bytes of B0 with the Home Key.
    const b0 = TxBody.decode(tx.bodyBytes); b0.extensionOptions = [];
    const msg = hybridSignBytes("v2", CHAIN, TxBody.encode(b0).finish(), tx.authInfoBytes);
    expect(pqcVerify(home.publicKey, msg, Uint8Array.from(Buffer.from(res.pqcSignature, "base64")))).toBe(true);

    // Classical part: 64-byte r||s over keccak256(SignDoc(final body)), recovering to the account key.
    const sig = tx.signatures[0]!;
    expect(sig.length).toBe(64);
    const doc = SignDoc.encode(SignDoc.fromPartial({ bodyBytes: tx.bodyBytes, authInfoBytes: tx.authInfoBytes, chainId: CHAIN, accountNumber: 7n })).finish();
    const hash = keccak256(doc);
    const candidates = await Promise.all([27, 28].map((v) => recoverPublicKey({ hash, signature: toHex(new Uint8Array([...sig, v])) })));
    const sdkRecovered = await Promise.all([27, 28].map((v) => recoverPublicKey({ hash: keccak256(SignDoc.encode(SignDoc.fromPartial({ bodyBytes: sdk.bodyBytes, authInfoBytes: sdk.authInfoBytes, chainId: CHAIN, accountNumber: 7n })).finish()), signature: toHex(new Uint8Array([...sdk.classicalSignature, v])) })));
    const ours = candidates.map((c) => c.toLowerCase());
    expect(sdkRecovered.some((c) => ours.includes(c.toLowerCase()))).toBe(true);
    // low-s
    const s = BigInt(toHex(sig.slice(32)));
    expect(s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n).toBe(true);
  });
});

describe("account kinds", () => {
  it("labels the signer key by account kind (QoreX classic vs 0x unified)", async () => {
    const { AuthInfo } = await import("cosmjs-types/cosmos/tx/v1beta1/tx");
    const base = { chainId: CHAIN, account: "qor1x", classicalPubkey: new Uint8Array(33).fill(2), accountNumber: 1n, sequence: 0n, messages: [], fee: FEE, signBytesVersion: "v2" as const };
    const type = (pubkeyType?: "secp256k1" | "eth_secp256k1") =>
      AuthInfo.decode(Buffer.from(createApprovalRequest({ ...base, pubkeyType }).authInfo, "base64")).signerInfos[0]!.publicKey!.typeUrl;
    expect(type("secp256k1")).toBe("/cosmos.crypto.secp256k1.PubKey");
    expect(type("eth_secp256k1")).toBe("/cosmos.evm.crypto.v1.ethsecp256k1.PubKey");
    expect(type()).toBe("/cosmos.evm.crypto.v1.ethsecp256k1.PubKey");
  });
});
