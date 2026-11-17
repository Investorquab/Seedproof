# Seedproof

**Most vaults here survive a leaked key. Seedproof survives a leaked seed phrase too.**

A two-device account and post-quantum savings vault for [QoreChain](https://www.qorechain.io), built for [Build Before Q-Day](https://build.qorechain.io) (category: Post-Quantum dApp).

> Live on the `qorechain-diana` testnet. Not audited yet (QCAI audit pending). Testnet only.
> Every claim below has a transaction hash in [docs/TESTNET.md](docs/TESTNET.md). Picking the project up? Start with [docs/HANDOFF.md](docs/HANDOFF.md).

## The problem

QoreChain signs every native transaction twice: with a classical secp256k1 key and with a post-quantum ML-DSA-87 key. A thief who steals only the classical key cannot make the second signature.

But the standard wallet derives the post-quantum key **from the same 24 words** as the classical key. The QoreX docs say so plainly ("so there is no second backup"), and QoreX cannot yet rotate that key. So the way people actually lose crypto (a seed phrase taken by an infostealer, a fake wallet extension, a photo of the backup, someone standing over you) hands the thief **both** keys.

## What Seedproof does

It moves the post-quantum key to a second device, so the 24 words alone can no longer move anything.

| Piece | Holds | Can do alone |
|---|---|---|
| **Pocket** (your phone) | the classical key, sealed by a passphrase | spend inside a small, scoped EVM window; ask the Home Key for everything else |
| **Home Key** (a second device, can stay offline) | an independent ML-DSA-87 key from its own recovery code, not from your seed | read every request back in plain words, then sign: sends, windows, key changes, vault actions |
| **Vault** (your own contract, made by a factory) | your savings | top-ups pay only your Pocket, capped per day; anything else waits 24 hours and can be cancelled; every action needs a Home Key signature checked on chain by `pqcVerify` |
| **Guardians** (2 of 3) | one QoreSeal-sealed share each (ML-KEM-1024 + X25519) | two together rebuild a lost Home Key; one alone learns nothing. Vault guardians can freeze and cancel, never move funds |

How the split works: the chain's post-quantum signature covers the transaction body *without* its PQ extension, plus the auth info. So the phone builds the transaction, the Home Key signs it, and the phone attaches the PQ signature and adds its classical signature last. Neither device ever holds both keys.

It works for normal QoreX accounts (classic `m/44'/118'`, no EVM side, so nothing on them moves without the Home Key) and for 0x accounts (`m/44'/60'`, which can also spend through scoped EVM windows).

## Proven on the live testnet

| What happened | Chain's answer |
|---|---|
| Rotate a live account's key from its seed-derived key to an independent Home Key (`MsgRotatePQCKey`) | accepted |
| Send signed by the Home Key | accepted |
| Thief with all 24 words: send | refused, `pqc` code 21 |
| Thief: send with no PQ signature | refused, `pqc` code 20 |
| Thief: swap the key for his own | refused, code 21 |
| Thief: register a fresh key | refused, code 234 |
| Thief: open a wide EVM window | refused, code 21 |
| Thief: EVM send to himself through the open window | refused by the node: not an allowed target |
| Thief: vault top-up signed with the seed-derived key | reverts `WrongHomeKey` |
| Same flow on a classic QoreX-style account | Home Key send accepted, thief refused (code 21) |
| Vault: Home Key top-up, over-limit top-up, withdrawal with delay, cancel | accepted, refused, waited then paid, cancelled |
| In the browser app: top-up, withdraw, cancel, create your own vault | all on chain, the Home Key reading each one back in plain words |

## Where the required pieces are

- **`pqcVerify`** (precompile `0x…0a01`): every vault action checks the Home Key's ML-DSA-87 signature in [`SeedproofVault.sol` line 160](contracts/contracts/SeedproofVault.sol#L160). Tested live: a valid signature returns true, a tampered one false; a top-up costs about 313,000 gas.
- **Scoped EVM window**: the Pocket only opens QOR-only (`nativeOnly`), vault-only, factory-only or single-token windows, never an open-to-anything one ([`Pocket.tsx`](apps/web/src/pages/Pocket.tsx), `WindowForm`). On chain, the vault-only window refused the thief's transfer.
- **Tests**: 85 Hardhat tests (real ML-DSA-87 signatures, seeded property tests with invariants after every step, the factory, byte vectors shared with the TypeScript core) and 62 core tests.
- **Static analysis**: Slither, 8 findings, all reviewed ([docs/audit/SLITHER.md](docs/audit/SLITHER.md)).
- **QCAI audit**: two-stage audit pending; reports will go in `docs/audit/` with `docs/AUDIT.md` mapping each finding.

## Live addresses (qorechain-diana, EVM chain 9800)

| What | Address |
|---|---|
| Vault factory (v2 vaults) | `0xD583AC106f7c6faDAe8C6E18eCf3FBa4554eF238` |
| Steal This Seed vault (made in the app) | `0xEaCf1C1Dd83F2C08c4e3a56a2839Ba31663ceE29` |
| First demo vault (v1, Q-Day Drill contract) | `0xadB21AAC72079Ce455a0b09ee56f069bf5E4f27C` |
| Pocket test account (Home Key linked, drill account) | `qor1fhtc82r35tzp8umnpnmytlxxphs9kxnl2sqrrq` |
| QoreX-style test account (Home Key linked) | `qor1eu6r8hjehspjx0z3m9s9vf04keundh8wsg8gzs` |
| Steal This Seed account (Home Key linked) | `qor1xkefca25d5dfwwy9tfg9rfs8tujas7pssu0pnd` |
| Deployer and vault guardian | `qor1yezwppgc3y7dr4un8p4yxp4sum9tsmnpe48ghu` |

## Honest limits

- A window caps transaction count, QOR value, time and targets, but **not** ERC-20 amounts: a window that lists a token contract exposes that token's whole balance on the account. The Pocket says so before you open one. Keep savings in the vault.
- Once your Home Key is linked, the QoreX app can no longer send from that account (it signs with the key from your 24 words, which the chain now refuses). You send from the Seedproof Pocket; QoreX still shows your balances.
- Someone forcing you to unlock both devices is not stopped. The daily cap, the delay and guardian cancel limit what they get and give time to react.
- A stolen Home Key **and** seed phrase together is every secret. The vault still makes them wait the delay, and a guardian can freeze it.
- Testnet only: `pqcVerify` and the v3.2.8 window options are not on mainnet yet. Guardians in the demo are three browser profiles, not three people.

Full analysis: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) (nine attacker cases, including what we cannot stop yet).

## Repository

```
packages/core   two-device signing (both account kinds), Home Key linking, clear-signing decoder,
                vault requests, guardian recovery (Shamir 2 of 3 + QoreSeal), exposure check,
                animated QR frames, MsgConvertCoin; live-chain scripts in scripts/ (62 tests)
contracts/      SeedproofVault (v2: registered Pocket), SeedproofVaultFactory, deploy scripts,
                deployments/diana.json (85 tests)
apps/web        landing page with the "One secret or two?" check, Pocket, Home Key, Guardian
docs/           HANDOFF, TESTNET, THREAT_MODEL, PLAN, audit/, design/ (approved mockups), posts/
```

## Run it

```bash
(cd packages/core && npm install && npx vitest run)     # 62 tests
(cd contracts && npm install && npx hardhat test)       # 85 tests
(cd apps/web && npm install && npm run dev)             # http://localhost:5173
```

Install `packages/core` before the web app (the app imports it directly). Routes: `/` landing and exposure check, `/pocket` the phone, `/home-key` the second device, `/guardian` for the people who can rebuild a lost Home Key. Secrets stay in the browser, sealed with your passphrase (PBKDF2 600,000 rounds, AES-GCM). The testnet REST API sends no CORS headers, so the app reads it through `/qore-rest` on its own origin (Vite proxy in dev, `vercel.json` when hosted).

## Credits

Built with the QoreChain kits [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk), [`@qorechain/pqc`](https://github.com/qorechain/qorechain-pqc) and `@qorechain/qoreseal`, plus CosmJS, viem, Hardhat and React. Built with AI tools; see [AI_USAGE.md](AI_USAGE.md). Licensed MIT.
