/**
 * MsgConvertCoin: turn a bank coin (fest tokens arrive as `erc20:0x...` bank
 * denominations) into the matching ERC-20 on the EVM lane, so the Vault and
 * EVM apps can hold it. Not in @qorechain/sdk 0.14, so we encode it here.
 *
 *   message MsgConvertCoin { Coin coin = 1; string receiver = 2; string sender = 3; }
 */
import { BinaryReader, BinaryWriter } from "cosmjs-types/binary";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";
import type { EncodeObject, GeneratedType } from "@cosmjs/proto-signing";

export const MSG_CONVERT_COIN_TYPE_URL = "/cosmos.evm.erc20.v1.MsgConvertCoin";

export interface MsgConvertCoin {
  coin?: Coin;
  receiver: string;
  sender: string;
}

export const MsgConvertCoinCodec = {
  encode(m: MsgConvertCoin, w: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (m.coin) Coin.encode(m.coin, w.uint32(10).fork()).ldelim();
    if (m.receiver) w.uint32(18).string(m.receiver);
    if (m.sender) w.uint32(26).string(m.sender);
    return w;
  },
  decode(input: Uint8Array | BinaryReader, length?: number): MsgConvertCoin {
    const r = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? r.len : r.pos + length;
    const m: MsgConvertCoin = { coin: undefined, receiver: "", sender: "" };
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >>> 3) {
        case 1: m.coin = Coin.decode(r, r.uint32()); break;
        case 2: m.receiver = r.string(); break;
        case 3: m.sender = r.string(); break;
        default: r.skipType(tag & 7);
      }
    }
    return m;
  },
  fromPartial(o: Partial<MsgConvertCoin>): MsgConvertCoin {
    return { coin: o.coin ? Coin.fromPartial(o.coin) : undefined, receiver: o.receiver ?? "", sender: o.sender ?? "" };
  },
};

export const convertRegistryTypes: [string, GeneratedType][] = [[MSG_CONVERT_COIN_TYPE_URL, MsgConvertCoinCodec as unknown as GeneratedType]];

export function convertCoinMsg(sender: string, receiver: string, denom: string, amount: bigint | string): EncodeObject {
  return { typeUrl: MSG_CONVERT_COIN_TYPE_URL, value: { coin: { denom, amount: amount.toString() }, receiver, sender } };
}
