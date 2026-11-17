# Seedproof

**Every vault here survives a leaked key. Seedproof survives a leaked seed phrase.**

A two-device account for [QoreChain](https://www.qorechain.io), built for [Build Before Q-Day](https://build.qorechain.io) (category: Post-Quantum dApp).

> Status: in active development on the `qorechain-diana` testnet. Not audited. Testnet only.

## The problem

QoreChain signs every native transaction twice: once with a classical secp256k1 key and once with a post-quantum ML-DSA-87 key. A thief who steals only the classical key cannot produce the second signature.

But the standard wallet derives the post-quantum key **from the same 24 words** as the classical key. The QoreX docs say so directly: "so there is no second backup". Before SDK 0.13.0 (10 Nov 2026), accounts built from a raw private key derived it **from that private key**.

So the way people actually lose crypto (a seed phrase taken by an infostealer, a tampered wallet extension, or someone standing over you) hands the thief **both** keys.

## How Seedproof works

| Piece | Holds | Can do alone |
|---|---|---|
| **Pocket** (your phone) | the classical key | spend inside today's small EVM window; ask the Home Key for anything else |
| **Home Key** (a second device, can be offline) | an independent ML-DSA-87 key, not derived from your seed | approve windows, native sends, key changes and vault withdrawals, after reading them in plain language |
| **Vault** (EVM contract) | your savings | release only with a Home Key signature, verified on chain by `pqcVerify`, after a 24-hour delay you can cancel |
| **Guardians** (2 of 3) | sealed shares of the Home Key | rebuild the Home Key if you lose it |

The Home Key signs first, on its own device. QoreChain's post-quantum signature covers the transaction body and auth info, not the classical signature, so the phone attaches the classical signature afterwards. Neither device ever holds both keys.

### What a thief with your seed phrase can do

- Native transfer: **refused** (`pqc` code 21, the post-quantum signature does not match).
- Re-key the account: **refused** (key changes need the current post-quantum key).
- Vault withdrawal: **refused** (needs a Home Key signature, then a 24-hour delay).
- EVM spend: only what today's open window allows. That is your pocket money, and you can close the window from the Home Key.

### Honest limits

- An EVM window caps transaction count, QOR value, time and target contracts. It does **not** cap ERC-20 amounts, so keep only pocket money on the account and savings in the Vault.
- Someone forcing you to go home is not stopped. The 24-hour delay and guardian cancel give time to react.
- Testnet only: `pqcVerify` and the v3.2.8 window options are not on mainnet yet.

## Repository layout

```
packages/core   two-device signing, Home Key linking, vault requests, clear-signing decoder,
                exposure check, QR frames (43 tests)
contracts/      Seedproof Vault (Hardhat + solc-js, 65 tests incl. shared vectors with core)
apps/web        landing page, Pocket (phone) and Home Key (second device)
```

## Run the app

```bash
cd packages/core && npm install
cd ../../apps/web && npm install && npm run dev
```

Routes: `/` landing and "One secret or two?" check, `/pocket` the phone, `/home-key` the second device. Secrets are kept in the browser sealed with your passphrase (PBKDF2 600,000 rounds, AES-GCM). Testnet only.

## Run the tests

```bash
# protocol (43 tests)
cd packages/core && npm install && npm test

# Seedproof Vault (65 tests)
cd contracts && npm install && npx hardhat test
```

Contract tests sign with real ML-DSA-87 keys from `@qorechain/sdk`, check every signature with the real verifier in JavaScript, and only then mark it valid in a test double installed at the `pqcVerify` precompile address (`0x...0a01`). A signature that fails the real check is never accepted.

## Credits

Built with the QoreChain kits: [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk), [`@qorechain/pqc`](https://github.com/qorechain/qorechain-pqc), and CosmJS. Licensed MIT.
