/** QoreChain testnet (qorechain-diana). Public endpoints from the QoreChain docs. */
export const NETWORK = {
  name: "QoreChain testnet",
  chainId: "qorechain-diana",
  evmChainId: 9800,
  rest: "https://api-testnet.qore.host",
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
