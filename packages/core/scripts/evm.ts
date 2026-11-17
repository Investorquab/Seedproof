import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NET } from "./chain.js";
export const diana = defineChain({ id: 9800, name: "QoreChain diana", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [NET.evm] } } });
export const pub = createPublicClient({ chain: diana, transport: http() });
export const wallet = (pk: `0x${string}`) => createWalletClient({ chain: diana, transport: http(), account: privateKeyToAccount(pk) });
export const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
export const VAULT_ABI = parseAbi([
  "function topUp(address token,address to,uint256 amount,uint256 deadline,bytes pubkey,bytes signature)",
  "function queue(uint8 action,bytes payload,uint256 deadline,bytes pubkey,bytes signature) returns (uint256)",
  "function execute(uint256 id)", "function cancel(uint256 id)", "function freeze()",
  "function nonce() view returns (uint256)", "function availableToday(address) view returns (uint256)",
  "function homeKeyHash() view returns (bytes32)", "function delay() view returns (uint64)",
  "function queueLength() view returns (uint256)",
  "error WrongHomeKey()", "error BadSignature()", "error OverDailyLimit(uint256 available)", "error Expired()", "error IsFrozen()", "error NotReady(uint64 readyAt)", "error NotGuardian()",
]);
export const TOKENS = { fUSD: "0x97143B771D34ddb9130b807b135Ae675A5a963CA", fETH: "0x02292293c13880a26242690eb70a0e42B8E91c28", fBTC: "0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A" } as const;
export async function sendAndWait(label: string, p: Promise<`0x${string}`>) {
  try {
    const hash = await p;
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`${r.status === "success" ? "OK  " : "FAIL"} ${label}  gas=${r.gasUsed} tx=${hash}`);
    return { hash, status: r.status, gas: r.gasUsed.toString() };
  } catch (e: any) {
    const msg = (e.shortMessage ?? e.message ?? String(e)).split("\n").slice(0, 3).join(" | ");
    console.log(`FAIL ${label}  ${msg.slice(0, 300)}`);
    return { hash: undefined, status: "refused", error: msg };
  }
}
