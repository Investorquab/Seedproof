# Seedproof: build and win plan

> Snapshot of the plan written on 17 Nov 2026. What is done and what is left is tracked in [HANDOFF.md](HANDOFF.md); live results are in [TESTNET.md](TESTNET.md).

Build Before Q-Day (QoreChain Developer Fest). Category: **Post-Quantum dApp**. Deadline **2 Dec 2026, 23:59 UTC** (freeze target: 2 Dec, 18:00 UTC).
A separate side project (Quantum Pass) is built elsewhere and is out of scope here.

---

## 1. The idea in one line

**Every vault here survives a leaked key. Seedproof survives a leaked seed phrase.**

QoreX and the SDK derive the ML-DSA-87 key from the same 24 words as the classical key ("no second backup"). Raw-key accounts before SDK 0.13.0 derived it from the private key itself. So a stolen seed phrase hands over both keys. Seedproof splits them across two devices:

| Piece | Holds | Can do alone |
|---|---|---|
| **Phone** (Seedproof Pocket) | classical key (from the mnemonic) | spend inside today's EVM window; ask the Home Key for anything else |
| **Home Key** (second device, can be offline) | an **independent** ML-DSA-87 key, rotated in with `MsgRotatePQCKey` | approve: open, widen or close windows, native sends, key changes, vault withdrawals |
| **Seedproof Vault** (EVM contract) | savings (fUSD, fETH, fBTC, QOR) | release only with a Home Key ML-DSA signature (`pqcVerify` at `0x…0A01`) after a cancellable 24h delay |
| **Guardians** (2 of 3) | QoreSeal-sealed shares of the Home Key's recovery code | rebuild the Home Key if it is lost |

Honest limits (say them out loud, judges reward this):
- An EVM window caps tx count, QOR value, time and targets. It does **not** cap ERC-20 amounts. So the pocket is what sits on the account. Savings live in the Vault.
- A wrench attacker can force you home. The 24h vault delay plus guardian cancel is the answer, not a promise of immunity.

---

## 2. What the field audit told us (17 Nov, 37 of 72 project pages opened)

- No project addresses seed-phrase theft, an independent PQ key, a second device, or PQ key recovery. This holds across all 20 vault, agent-leash and checker projects; some explicitly derive both keys from one phrase. This is our open lane.
- One project publishes its ECDSA key ("the key is free, the money isn't"). We publish the **24 words**. Pitch as an escalation, not a copy.
- Bar to beat in PQ dApp: the strongest entries show 100 to 170 Foundry tests, near-full coverage, a clean Slither run, and most of their declared kits Verified.
- About two-thirds of projects have no demo video. Most open with mechanism, not a human story.
- Expect "isn't this just the QRC1 recovery code?" (answer in Q&A below).

---

## 3. Riskiest assumptions

| # | Assumption | Result (17 Nov, see TESTNET.md) |
|---|---|---|
| R1 | PQ signature can be made on a second device | **Passed on testnet**: Home Key signed, phone attached classical sig, code 0 |
| R2 | Mnemonic account can rotate to an independent PQ key, and seed-derived signing then fails | **Passed**: rotation code 0; seed-key send refused, `pqc` code 21 |
| R3 | Attacker with the seed cannot re-key | **Passed**: rotate refused (21), fresh register refused (234), classical-only refused (20) |
| R4 | `pqcVerify` verifies our vault message; gas acceptable | **Passed**: valid true, tampered false; top-up about 313k gas |
| R5 | Window scope bounds what a seed thief can do | **Passed**: EVM send to a non-listed target refused by the node |
| R6 | QoreSeal seal to 3 guardians + 2-of-3 Shamir round trip | Passed offline (tests and headless browser); not yet on chain with registered KEM keys |
| R7 | Animated QR carries a 4,627-byte signature in reasonable time | Passed offline (11 frames, browser test) |
| R8 | QoreX on the phone after rotation | Expected to fail native signing (code 21); Pocket is our own app. Not yet shown on video |

---

## 4. MVP: real, simulated honestly, cut

**Built for real (on qorechain-diana):**
1. Split-signing protocol: request envelope (chainId, accountNumber, sequence, B0, authInfo), signed response (ML-DSA sig), expiry.
2. Home Key app: decodes every request into plain language before signing (clear signing), refuses anything it cannot read, answers by animated QR.
3. Pocket app: daily spending through a scoped EVM window; asks for approvals; shows "what a thief could take right now".
4. Onboarding: rotate the PQ key to an independent Home Key; open the first scoped window.
5. Seedproof Vault: Home Key signed top-ups with daily caps; withdrawals and rule changes behind a delay; cancel by Home Key or guardian; freeze by guardian; nonce and deadline bound.
6. "One secret or two?" exposure check.
7. Guardian recovery: 2-of-3 Shamir, each share sealed with QoreSeal (ML-KEM-1024 + X25519).
8. Steal This Seed: a live testnet account with published 24 words, funds in pocket and vault, public counter.
9. Attacker scripts used in the video.

**Simulated honestly (labelled in UI and README):** guardians run as three local profiles in the demo; device transport is QR or copy-paste text, not a hardened relay.

**Cut:** hardware wallet support; mainnet (pqcVerify and v3.2.8 window options are testnet only); native PQ multisig.

---

## 5. Kits and features to get Verified

Verification means the package is in a dependency file, or the feature appears in transactions from the project's qor1 addresses.
- Kits: `@qorechain/sdk`, `@qorechain/pqc`, `@qorechain/qoreseal` (in use); candidates `@qorechain/qoresign`, `@qorechain/qorex-types` + `@qorechain/qorex-wallet-mock` (e2e tests), QoreScan CBOM in CI.
- Features: scoped EVM window, PQC key registration with proof of possession, PQC key rotation, hybrid ML-DSA-87 txs, QoreSeal, fest test tokens, Solidity PQC verify.
- Stretch: link the phone key as an abstract-account authenticator with `denom_limits` so ERC-20 pocket caps are chain-enforced too.

---

## 6. Milestones

| Dates (UTC) | Milestone |
|---|---|
| 17 to 18 Nov | Repo, README, AI_USAGE.md, project page filled, first post |
| 18 Nov | Q-Day Drill (proof hash by 19 Nov 23:59) |
| 18 to 20 Nov | Spikes on chain (done 17 Nov) |
| 20 to 23 Nov | Contracts: 100+ tests, fuzz and invariants, Slither; QCAI stage 1 |
| 22 to 26 Nov | Apps end to end on testnet through the UI |
| 26 to 28 Nov | Exposure check, guardian recovery on chain, Steal This Seed live |
| 28 to 29 Nov | QCAI stage 2 + AUDIT.md, CBOM, e2e tests, THREAT_MODEL.md |
| 30 Nov to 1 Dec | Video, cover image, README final, checklist green |
| 2 Dec | Buffer; freeze 18:00 UTC; check Declared vs Verified |

Build in public: post on the project page and X (#BuildBeforeQDay) daily. "Most active" ranks the last 7 days of commits, updates and on-chain milestones.

---

## 7. Pitch plan

- **Hook (README line 1, cover, first 5 s of video):** "Every vault here survives a leaked key. Seedproof survives a leaked seed phrase."
- **One-sentence retell:** "The QoreChain account where your 24 words can leak and you lose only today's pocket money."
- **Framing:** we finish what SDK 0.13 started (a second secret, kept apart), for everyone, with a second device and recovery. Not "QoreChain is broken".
- **Human story:** the Christmas Eve 2025 tampered wallet extension that harvested seed phrases; the rise in wrench attacks in 2025. One face, one number. Verify figures before using them.
- **Moment to remember:** the 24 words on screen, the attacker script failing with `pqc` code 21, and the explorer link.
- **Video (3:00):** 0:00 hook + exposure check says ONE SECRET on a default account. 0:20 default account drained from its published seed. 1:00 same attack on Seedproof: code 21, only the pocket moves, vault refuses. 2:00 Home Key closes the window; guardian recovery. 2:30 verified list, tests, Steal This Seed counter, link.
- **Design:** distinctive identity (slate Pocket, brass Home Key). See `docs/design/`.

---

## 8. Judge Q&A (hardest first)

1. **"Isn't this just a 2FA wallet (Bitkey, Casa, Safe spending limits)?"** Those need multisig scripts or contract wallets per chain. Here a normal QoreChain account gets it from the protocol: every validator enforces the second signature on every native tx and gates every EVM tx through the window. And it stays quantum-safe, which a second secp256k1 key would not.
2. **"QoreX could add a random-PQ-key button tomorrow."** The key is the easy part. The product is the second device, clear signing of every request, the delayed vault and recovery. Without recovery, a random key is a way to lose your funds.
3. **"Isn't this just the QRC1 recovery code?"** A code kept next to your seed phrase is the same secret. QRC1 covers raw-key accounts; QoreX mnemonic users still have one secret.
4. **"What can a thief still take?"** Exactly what the open window allows, shown live in Pocket, plus nothing from the vault without the Home Key.
5. **"What if the Home Key is lost or stolen?"** Lost: 2-of-3 guardians rebuild it. Stolen alone: it holds no classical key and cannot sign a tx on its own; the owner rotates with phone + guardians.
