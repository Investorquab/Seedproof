import { describe, it, expect } from "vitest";
import { createApprovalRequest, registry } from "../src/split.js";
import { decodeRequestBody } from "../src/decode.js";
import { convertCoinMsg, MsgConvertCoinCodec, MSG_CONVERT_COIN_TYPE_URL } from "../src/convert.js";

const ACC = "qor1fhtc82r35tzp8umnpnmytlxxphs9kxnl2sqrrq";
const FUSD = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const req = (msg: ReturnType<typeof convertCoinMsg>) =>
  createApprovalRequest({ chainId: "qorechain-diana", account: ACC, classicalPubkey: new Uint8Array(33).fill(2), accountNumber: 1n, sequence: 0n,
    messages: [msg], fee: { amount: [], gasLimit: 1n }, signBytesVersion: "v2" });

describe("MsgConvertCoin", () => {
  it("round-trips through the registry", () => {
    const any = registry.encodeAsAny(convertCoinMsg(ACC, "0x4dd783A871a2c413F3730CF645fCc60DE05B1A7f", FUSD, 5_000_000n));
    expect(any.typeUrl).toBe(MSG_CONVERT_COIN_TYPE_URL);
    expect(MsgConvertCoinCodec.decode(any.value)).toEqual({ coin: { denom: FUSD, amount: "5000000" }, receiver: "0x4dd783A871a2c413F3730CF645fCc60DE05B1A7f", sender: ACC });
  });
  it("reads as plain words on the Home Key", () => {
    const d = decodeRequestBody(req(convertCoinMsg(ACC, "0x4dd783A871a2c413F3730CF645fCc60DE05B1A7f", FUSD, 5_000_000n)));
    expect(d.understood).toBe(true);
    expect(d.lines[0]!.text).toMatch(/^Move 5 fUSD to the EVM side/);
  });
  it("refuses an unknown or mis-cased denomination", () => {
    expect(decodeRequestBody(req(convertCoinMsg(ACC, "0x00", "erc20:0xdead", 1n))).understood).toBe(false);
    expect(decodeRequestBody(req(convertCoinMsg(ACC, "0x00", FUSD.toLowerCase(), 1n))).understood).toBe(false);
  });
});
