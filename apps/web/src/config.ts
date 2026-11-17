/** QoreChain testnet (qorechain-diana). Public endpoints from the QoreChain docs. */
export const NETWORK = {
  name: "QoreChain testnet",
  chainId: "qorechain-diana",
  evmChainId: 9800,
  /**
   * The testnet REST API has no CORS headers, so the app reads it through its own origin:
   * Vite proxies /qore-rest in dev and preview, and vercel.json rewrites it when hosted.
   * Set VITE_QORE_REST to a CORS-enabled endpoint to skip the proxy.
   */
  rest: (import.meta.env.VITE_QORE_REST as string | undefined) ?? `${typeof window === "undefined" ? "" : window.location.origin}/qore-rest`,
  rpc: "https://rpc-testnet.qore.host",
  evmRpc: "https://evm-testnet.qore.host",
  explorer: "https://explore.qore.network",
  signBytesVersion: "v2" as const,
} as const;

export const REPO_URL = "https://github.com/Investorquab/Seedproof";

/**
 * The public "Steal this seed" account. These are a SAMPLE until the funded
 * testnet account is created; then they are replaced with its real words.
 */
export const STEAL_THIS_SEED = {
  isSample: true,
  address: "qor1h7m3c5u9yq2r8fz0l6t4wax2xk9",
  words: [
    "change", "wish", "distance", "blade", "march", "cement", "badge", "symbol",
    "mimic", "head", "music", "focus", "bicycle", "buyer", "palace", "gloom",
    "erode", "another", "spatial", "teach", "tired", "comfort", "member", "slender",
  ],
};

export const shortAddress = (a: string) => (a.length > 16 ? `${a.slice(0, 7)}…${a.slice(-4)}` : a);

/** The live demo vault on qorechain-diana (contracts/deployments/diana.json). */
export const VAULT_ADDRESS = "0xadB21AAC72079Ce455a0b09ee56f069bf5E4f27C";

/** Fest test tokens (ERC-20 side). */
export const FEST_TOKENS = [
  { symbol: "fUSD", address: "0x97143B771D34ddb9130b807b135Ae675A5a963CA", decimals: 6 },
  { symbol: "fETH", address: "0x02292293c13880a26242690eb70a0e42B8E91c28", decimals: 18 },
  { symbol: "fBTC", address: "0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A", decimals: 8 },
] as const;
