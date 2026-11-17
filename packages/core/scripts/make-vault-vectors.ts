// Writes test/vectors/vault-signed-message-v1.json: the exact bytes the vault
// contract must return from signedMessage() for fixed inputs. Checked by both
// packages/core (vitest) and contracts (hardhat).
import { writeFileSync } from "node:fs";
import { toHex } from "viem";
import { VaultAction, vaultPayload, vaultSignedMessage } from "../src/vault.js";

const vault = "0x1111111111111111111111111111111111111111";
const pocket = "0x2222222222222222222222222222222222222222";
const fUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const cases = [
  { name: "topup-fusd", chainId: 31337n, action: VaultAction.TopUp, payload: vaultPayload.transfer(fUSD, pocket, 30_000_000n), nonce: 7n, deadline: 1_800_000_000n },
  { name: "withdraw-native", chainId: 31337n, action: VaultAction.Withdraw, payload: vaultPayload.transfer("0x0000000000000000000000000000000000000000", pocket, 10n ** 18n), nonce: 0n, deadline: 1n },
  { name: "cancel", chainId: 31337n, action: VaultAction.Cancel, payload: vaultPayload.id(3n), nonce: 99n, deadline: 2_000_000_000n },
  { name: "unfreeze", chainId: 31337n, action: VaultAction.Unfreeze, payload: vaultPayload.none(), nonce: 1n, deadline: 5n },
  { name: "set-delay", chainId: 31337n, action: VaultAction.SetDelay, payload: vaultPayload.delay(172_800n), nonce: 2n, deadline: 6n },
  { name: "diana-topup", chainId: 9800n, action: VaultAction.TopUp, payload: vaultPayload.transfer(fUSD, pocket, 1n), nonce: 0n, deadline: 1_800_000_000n },
];
const out = {
  description: "SeedproofVault.signedMessage(action, payload, nonce, deadline) for vault " + vault,
  vault,
  cases: cases.map((c) => ({
    name: c.name,
    chainId: c.chainId.toString(),
    action: c.action,
    payload: c.payload,
    nonce: c.nonce.toString(),
    deadline: c.deadline.toString(),
    expected: toHex(vaultSignedMessage({ evmChainId: c.chainId, vault, nonce: c.nonce, action: c.action, payload: c.payload, deadline: c.deadline })),
  })),
};
writeFileSync(new URL("../test/vectors/vault-signed-message-v1.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.cases.length} cases`);
