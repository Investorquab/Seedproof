/**
 * Clear signing for the Home Key.
 *
 * The Home Key never trusts a summary sent by the phone. It decodes the exact
 * body bytes it is about to sign and turns every message into plain language.
 * Any message type it does not understand makes the whole request refusable
 * (the Bybit and Radiant lesson: what you read must be what you sign).
 */
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { qorechainTypes, MSG_SEND_TYPE_URL } from "@qorechain/sdk";
import { b64, type ApprovalRequest } from "./envelope.js";
import { MSG_CONVERT_COIN_TYPE_URL, MsgConvertCoinCodec } from "./convert.js";
import { KNOWN_TOKENS, formatUnits } from "./vault.js";

const pqc = qorechainTypes.pqc;

export type Risk = "low" | "high" | "critical";

export interface DecodedLine {
  typeUrl: string;
  text: string;
  risk: Risk;
}

export interface DecodedRequest {
  lines: DecodedLine[];
  memo: string;
  /** false when at least one message is unknown: the Home Key must refuse. */
  understood: boolean;
  /** true when the PQC extension is already present (it must not be). */
  hasExtension: boolean;
}

/** 1 QOR = 1,000,000 uqor. */
export function formatCoin(amount: string, denom: string): string {
  if (denom === "uqor") {
    const n = BigInt(amount);
    const whole = n / 1_000_000n;
    const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return `${whole}${frac ? "." + frac : ""} QOR`;
  }
  return `${amount} ${denom}`;
}

function short(addr: string): string {
  return addr.length > 16 ? `${addr.slice(0, 10)}...${addr.slice(-6)}` : addr;
}

export function decodeRequestBody(req: Pick<ApprovalRequest, "bodyB0"> & Partial<Pick<ApprovalRequest, "account">>): DecodedRequest {
  const body = TxBody.decode(b64.dec(req.bodyB0));
  const lines: DecodedLine[] = [];
  let understood = true;

  for (const any of body.messages) {
    switch (any.typeUrl) {
      case MSG_SEND_TYPE_URL: {
        const m = MsgSend.decode(any.value);
        const amounts = m.amount.map((c) => formatCoin(c.amount, c.denom)).join(" + ");
        lines.push({
          typeUrl: any.typeUrl,
          text: `Send ${amounts} to ${m.toAddress === req.account ? "your own account" : short(m.toAddress)}`,
          risk: "high",
        });
        break;
      }
      case MSG_CONVERT_COIN_TYPE_URL: {
        const m = MsgConvertCoinCodec.decode(any.value);
        const denom = m.coin?.denom ?? "";
        const token = denom.startsWith("erc20:") ? KNOWN_TOKENS[denom.slice(6)] : undefined; // case-sensitive, as the chain matches it
        const amount = token ? `${formatUnits(BigInt(m.coin?.amount ?? 0), token.decimals)} ${token.symbol}` : formatCoin(m.coin?.amount ?? "0", denom);
        const own = req.account && m.sender === req.account;
        lines.push({
          typeUrl: any.typeUrl,
          text: `Move ${amount} to the EVM side, to ${short(m.receiver)}`,
          risk: token && own ? "high" : "critical",
        });
        if (!token) understood = false;
        break;
      }
      case "/qorechain.pqc.v1.MsgOpenEVMWindow": {
        const m = pqc.MsgOpenEVMWindow.decode(any.value);
        const value = formatCoin(String(m.maxValue), "uqor");
        const targets =
          m.allowedTargets.length === 0
            ? "ANY contract"
            : m.allowedTargets.map(short).join(", ");
        lines.push({
          typeUrl: any.typeUrl,
          text:
            `Open spending window: up to ${m.maxTxs} transactions, ${value}, ` +
            `for ${m.blocks} blocks, to ${targets}`,
          risk: m.allowedTargets.length === 0 ? "critical" : "high",
        });
        break;
      }
      case "/qorechain.pqc.v1.MsgCloseEVMWindow": {
        lines.push({ typeUrl: any.typeUrl, text: "Close the spending window now", risk: "low" });
        break;
      }
      case "/qorechain.pqc.v1.MsgRotatePQCKey": {
        lines.push({
          typeUrl: any.typeUrl,
          text: "Replace the Home Key with a new post-quantum key",
          risk: "critical",
        });
        break;
      }
      default: {
        understood = false;
        lines.push({
          typeUrl: any.typeUrl,
          text: `Unknown action (${any.typeUrl}). Refuse unless you know exactly what this is.`,
          risk: "critical",
        });
      }
    }
  }

  return {
    lines,
    memo: body.memo,
    understood,
    hasExtension: body.extensionOptions.length > 0 || body.nonCriticalExtensionOptions.length > 0,
  };
}
