/**
 * Reads and writes for SeedproofVault on the EVM lane.
 * The EVM endpoint allows browser calls (CORS), so this talks to it directly.
 */
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FEST_TOKENS, NETWORK, VAULT_ADDRESS, VAULT_FACTORY } from "../config";

export const diana = defineChain({
  id: NETWORK.evmChainId,
  name: NETWORK.name,
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [NETWORK.evmRpc] } },
});

export const evmClient = createPublicClient({ chain: diana, transport: http() });

export const VAULT_ABI = parseAbi([
  "function topUp(address token,address to,uint256 amount,uint256 deadline,bytes pubkey,bytes signature)",
  "function queue(uint8 action,bytes payload,uint256 deadline,bytes pubkey,bytes signature) returns (uint256)",
  "function execute(uint256 id)",
  "function cancelWithHomeKey(uint256 id,uint256 deadline,bytes pubkey,bytes signature)",
  "function nonce() view returns (uint256)",
  "function homeKeyHash() view returns (bytes32)",
  "function delay() view returns (uint64)",
  "function frozen() view returns (bool)",
  "function guardianCount() view returns (uint256)",
  "function availableToday(address token) view returns (uint256)",
  "function dailyLimit(address token) view returns (uint256)",
  "function queueLength() view returns (uint256)",
  "function queued(uint256 id) view returns ((uint8 action,uint8 status,uint64 readyAt,bytes payload))",
  "error Expired()",
  "error WrongHomeKey()",
  "error BadLength()",
  "error BadSignature()",
  "error IsFrozen()",
  "error NotGuardian()",
  "error OverDailyLimit(uint256 available)",
  "error NotReady(uint64 readyAt)",
  "error NotPending()",
  "error TransferFailed()",
  "error UnknownAction()",
]);

const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export const NATIVE = "0x0000000000000000000000000000000000000000";

/** QOR first, then the fest tokens. QOR on the EVM lane has 18 decimals. */
export const VAULT_TOKENS = [{ symbol: "QOR", address: NATIVE, decimals: 18 }, ...FEST_TOKENS] as const;
export type VaultToken = (typeof VAULT_TOKENS)[number];

export interface QueuedItem {
  id: bigint;
  action: number;
  /** 1 Pending, 2 Executed, 3 Cancelled */
  status: number;
  readyAt: number;
  payload: Hex;
}

export interface VaultState {
  balances: Record<string, bigint>;
  pocketBalances: Record<string, bigint>;
  availableToday: Record<string, bigint>;
  dailyLimit: Record<string, bigint>;
  delay: number;
  nonce: bigint;
  frozen: boolean;
  guardians: number;
  pending: QueuedItem[];
}

async function balanceOf(token: string, holder: Hex): Promise<bigint> {
  if (token === NATIVE) return evmClient.getBalance({ address: holder });
  return evmClient.readContract({ address: token as Hex, abi: ERC20_ABI, functionName: "balanceOf", args: [holder] });
}

const reader = (vault: Hex) => <T>(functionName: string, args: unknown[] = []) =>
  evmClient.readContract({ address: vault, abi: VAULT_ABI, functionName: functionName as never, args: args as never }) as Promise<T>;

export async function readVault(vault: Hex, pocket: Hex): Promise<VaultState> {
  const read = reader(vault);
  const tokens = VAULT_TOKENS.map((t) => t.address);
  const [balances, pocketBalances, available, limits, delay, nonce, frozen, guardians, length] = await Promise.all([
    Promise.all(tokens.map((t) => balanceOf(t, vault))),
    Promise.all(tokens.map((t) => balanceOf(t, pocket))),
    Promise.all(tokens.map((t) => read<bigint>("availableToday", [t]))),
    Promise.all(tokens.map((t) => read<bigint>("dailyLimit", [t]))),
    read<bigint>("delay"),
    read<bigint>("nonce"),
    read<boolean>("frozen"),
    read<bigint>("guardianCount"),
    read<bigint>("queueLength"),
  ]);
  // Newest first; the demo vault's queue is short, so read the last 20 entries.
  const ids: bigint[] = [];
  for (let i = length - 1n; i >= 0n && ids.length < 20; i--) ids.push(i);
  const items = await Promise.all(
    ids.map(async (id) => {
      const q = await read<{ action: number; status: number; readyAt: bigint; payload: Hex }>("queued", [id]);
      return { id, action: Number(q.action), status: Number(q.status), readyAt: Number(q.readyAt), payload: q.payload };
    }),
  );
  const byToken = (values: bigint[]) => Object.fromEntries(tokens.map((t, i) => [t, values[i] ?? 0n]));
  return {
    balances: byToken(balances),
    pocketBalances: byToken(pocketBalances),
    availableToday: byToken(available),
    dailyLimit: byToken(limits),
    delay: Number(delay),
    nonce,
    frozen,
    guardians: Number(guardians),
    pending: items.filter((q) => q.status === 1),
  };
}

export interface EvmOutcome {
  txhash: string;
  code: number;
  rawLog: string;
}

/**
 * Send a vault call from the Pocket's 0x key. Gas comes from an estimate (the chain bills at
 * least half the gas limit, so a round number wastes fees and window allowance).
 */
export async function sendVaultCall(
  privateKey: Hex,
  vault: Hex,
  functionName: "topUp" | "queue" | "execute" | "cancelWithHomeKey",
  args: readonly unknown[],
): Promise<EvmOutcome> {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ chain: diana, transport: http(), account });
  try {
    const gas = await evmClient.estimateContractGas({ account, address: vault, abi: VAULT_ABI, functionName, args: args as never });
    const hash = await wallet.writeContract({ address: vault, abi: VAULT_ABI, functionName, args: args as never, gas: (gas * 12n) / 10n });
    const receipt = await evmClient.waitForTransactionReceipt({ hash });
    return { txhash: hash, code: receipt.status === "success" ? 0 : 1, rawLog: receipt.status === "success" ? "" : "The vault reverted the call." };
  } catch (e) {
    return { txhash: "", code: 1, rawLog: explain(e) };
  }
}

/** Turn viem errors into a sentence a person can act on. */
function explain(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; cause?: { data?: { errorName?: string; args?: unknown[] } } };
  const name = err.cause?.data?.errorName;
  const known: Record<string, string> = {
    WrongHomeKey: "That signature is not from the Home Key this vault trusts.",
    BadSignature: "The Home Key signature did not check out.",
    Expired: "The Home Key's approval has expired. Ask again.",
    IsFrozen: "The vault is frozen. Your Home Key can unfreeze it.",
    OverDailyLimit: "That is more than today's top-up limit allows.",
    NotReady: "This withdrawal is still waiting.",
    NotPending: "This action is no longer waiting.",
  };
  if (name && known[name]) return known[name];
  const text = err.shortMessage ?? err.message ?? String(e);
  if (/authorisation window|window/i.test(text)) return "No open vault window. Open one with your Home Key first.";
  return text.split("\n")[0] ?? text;
}

const FACTORY_ABI = parseAbi([
  "function vaultOf(address pocket) view returns (address)",
  "function create(bytes32 homeKeyHash,uint64 delay,address[] guardians,address[] limitTokens,uint256[] limits) returns (address)",
  "error AlreadyHasVault(address vault)",
]);

export interface FoundVault {
  address: Hex;
  /** 1: the first demo vault (no registered Pocket). 2: made by the factory. */
  version: 1 | 2;
  /** false when the vault trusts a different Home Key than the one the chain has for this account. */
  trustsThisHomeKey: boolean;
}

/**
 * This Pocket's vault: the one the factory made for it, else the v1 demo vault if it trusts this
 * account's Home Key. A vault "belongs" to an account when its Home Key hash matches the
 * post-quantum key the chain has registered for that account.
 */
export async function findVault(pocket: Hex, registeredPqcKey: Uint8Array | null): Promise<FoundVault | null> {
  const mine = registeredPqcKey ? keccak256(registeredPqcKey).toLowerCase() : null;
  const made = (await evmClient.readContract({ address: VAULT_FACTORY, abi: FACTORY_ABI, functionName: "vaultOf", args: [pocket] })) as Hex;
  if (made && !/^0x0{40}$/i.test(made)) {
    const h = await reader(made)<Hex>("homeKeyHash");
    return { address: made, version: 2, trustsThisHomeKey: h.toLowerCase() === mine };
  }
  if (mine && (await reader(VAULT_ADDRESS)<Hex>("homeKeyHash")).toLowerCase() === mine) {
    return { address: VAULT_ADDRESS, version: 1, trustsThisHomeKey: true };
  }
  return null;
}

/** Defaults for a new vault: 24 hours to wait, and small daily top-up limits. */
export const NEW_VAULT_DEFAULTS = {
  delay: 24n * 3600n,
  limits: [
    { token: NATIVE, amount: 5n * 10n ** 18n }, // 5 QOR
    { token: FEST_TOKENS[0].address, amount: 100n * 10n ** 6n }, // 100 fUSD
    { token: FEST_TOKENS[1].address, amount: 5n * 10n ** 16n }, // 0.05 fETH
    { token: FEST_TOKENS[2].address, amount: 200_000n }, // 0.002 fBTC
  ],
} as const;

/** Create this Pocket's vault through the factory. Needs a live window that lists the factory. */
export async function createVault(privateKey: Hex, registeredPqcKey: Uint8Array): Promise<EvmOutcome & { vault?: Hex }> {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ chain: diana, transport: http(), account });
  const args = [
    keccak256(registeredPqcKey),
    NEW_VAULT_DEFAULTS.delay,
    [] as Hex[],
    NEW_VAULT_DEFAULTS.limits.map((l) => l.token as Hex),
    NEW_VAULT_DEFAULTS.limits.map((l) => l.amount),
  ] as const;
  try {
    const gas = await evmClient.estimateContractGas({ account, address: VAULT_FACTORY, abi: FACTORY_ABI, functionName: "create", args });
    const hash = await wallet.writeContract({ address: VAULT_FACTORY, abi: FACTORY_ABI, functionName: "create", args, gas: (gas * 12n) / 10n });
    const receipt = await evmClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") return { txhash: hash, code: 1, rawLog: "The factory reverted the call." };
    const vault = (await evmClient.readContract({ address: VAULT_FACTORY, abi: FACTORY_ABI, functionName: "vaultOf", args: [account.address] })) as Hex;
    return { txhash: hash, code: 0, rawLog: "", vault };
  } catch (e) {
    return { txhash: "", code: 1, rawLog: explain(e) };
  }
}
