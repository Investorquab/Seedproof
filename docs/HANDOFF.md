# Seedproof handoff

_Last updated: 17 Nov 2026, 20:45 UTC. Kept current as work lands; the change log is at the end._

Read this first if you are picking the project up. It covers what Seedproof is, what is done, where everything lives, how to run it, what we learned on the live chain, and what is left before the deadline.

- Hackathon: Build Before Q-Day, the QoreChain Developer Fest (https://build.qorechain.io). Category: **Post-Quantum dApp**.
- Final deadline: **2 Dec 2026, 23:59 UTC**. Checks run 3 to 5 Dec, winners on 16 Dec.
- Owner: Investorquab (GitHub). Repo: https://github.com/Investorquab/Seedproof (MIT).
- Other docs: [THREAT_MODEL.md](THREAT_MODEL.md) (each attacker and what stops them), [PLAN.md](PLAN.md) (strategy, pitch, judge Q&A), [TESTNET.md](TESTNET.md) (every on-chain result with tx hashes), [design/](design/) (approved mockups), [../AI_USAGE.md](../AI_USAGE.md) (AI work log, required for the AI-native award).

---

## 1. The product in one minute

**Every vault here survives a leaked key. Seedproof survives a leaked seed phrase.**

QoreChain signs every native transaction with a classical key and an ML-DSA-87 post-quantum key. QoreX and the SDK derive the post-quantum key from the same 24 words, so a stolen seed phrase gives a thief both keys. Seedproof moves the post-quantum key to a second device:

- **Pocket** (phone): holds the classical key. Spends only inside a small EVM window.
- **Home Key** (second device): holds an independent ML-DSA-87 key, made from its own recovery code (QRC1). Approves everything else after showing it in plain words.
- **Vault** (Solidity): savings. Releases funds only with a Home Key signature checked on chain by `pqcVerify`. Top-ups are instant within a daily cap; withdrawals wait a delay that a guardian or the Home Key can cancel.
- **Guardians** (2 of 3): each holds one QoreSeal-sealed Shamir share of the Home Key's recovery code. Two together rebuild a lost Home Key.

How the split works: the chain's PQ signature covers the tx body *without* the PQ extension plus the auth info. So the phone builds the body (B0) and auth info, the Home Key signs those, and the phone then attaches the extension and signs the final body classically. Neither device ever holds both keys.

---

## 2. Status on 17 Nov 2026

| Area | State |
|---|---|
| Core protocol (`packages/core`) | Done. 60 tests. Split signing for both `eth_secp256k1` (unified, QoreX-style) and Cosmos `secp256k1` accounts; clear-signing decoder; exposure check; Home Key linking; vault requests; animated-QR frames; Shamir; guardians; `MsgConvertCoin` |
| Vault contract (`contracts`) | Done and **deployed on testnet**. 67 Hardhat tests with real ML-DSA-87 signatures. Not yet: fuzz/invariant tests, Slither, 100+ test target, QCAI audits |
| On-chain proof | **Done**. R1 to R5 all passed on qorechain-diana; seven thief attempts refused. See TESTNET.md |
| Web app (`apps/web`) | Landing page with live exposure check, Pocket, Home Key, Guardian pages. Built from approved mockups. Pocket opens QoreX (classic) and 0x accounts and only opens scoped windows; checked in headless Chrome against the live chain through the REST proxy. Not yet: vault screen in Pocket, hosting, end-to-end run against the live chain through the UI |
| Q-Day Drill | **Registered** on the project page (17 Nov): Pocket account + vault contract. Proof script ready (`s6-drill-proof.ts`), to run on 18 Nov UTC; hash due on the project page by 19 Nov 23:59 UTC |
| Project page | Created 17 Nov; all four Ship Weeks badges earned: 3 of 3 SDKs verified; on chain verified: EVM window, hybrid txs, PQC registration with PoP, test tokens. Badges: hybrid tx, PQC contract; QoreSeal key and swap done on chain (press Check). Commits count only after the GitHub App is installed |
| Submission package | Not started: final README, video, cover image, project page text, QCAI audits, threat model |

---

## 3. Repository map

```
apps/web/                 Vite + React 19 app. Routes: /  /pocket  /home-key  /guardian
  src/pages/Landing.tsx     landing page + ExposureCheck
  src/pages/Pocket.tsx      phone: sealed mnemonic, protection status, send, windows, link Home Key
  src/pages/HomeKey.tsx     second device: setup (QRC1 code), review + sign, guardians setup, restore
  src/pages/Guardian.tsx    guardian: seal keys, open a share in person
  src/components/           AnimatedQr, FrameReader (camera or paste), Logo
  src/lib/chain.ts          REST reads + broadcast;  src/lib/sealed.ts  PBKDF2 + AES-GCM local storage
  src/config.ts             network endpoints, Steal This Seed words (still a SAMPLE)
packages/core/            the protocol, framework-free TypeScript (imported by the web app via a Vite alias)
  src/split.ts              createApprovalRequest / approveRequest / assembleSignedTx / ethDirectSigner
  src/decode.ts             clear signing: tx body -> plain lines with risk; unknown = refuse
  src/link.ts               register or rotate to the Home Key (proof of possession / dual signature)
  src/vault.ts              vault actions, payloads, signed message (matches Solidity byte for byte)
  src/exposure.ts           "one secret or two?" check
  src/frames.ts             multi-frame QR transport (SP1/<id>/<i>/<n>/<slice>)
  src/shamir.ts, guardians.ts   2-of-3 recovery sealed with QoreSeal
  src/convert.ts            MsgConvertCoin (bank coin -> ERC-20); not in SDK 0.14
  scripts/                  live-chain scripts (section 5)
contracts/                Hardhat 2 + solc-js 0.8.28 (compiles offline)
  contracts/SeedproofVault.sol, interfaces/IQorePQC.sol
  test/                     67 tests; helpers install a pqcVerify double at 0x...0a01
  scripts/deploy.ts         deploy to diana;  deployments/diana.json  the live vault
docs/                     this file, PLAN, TESTNET, design mockups
```

---

## 4. Run it

Node 22. Each package installs on its own (there is no workspace root).

```bash
git clone https://github.com/Investorquab/Seedproof.git && cd Seedproof
(cd packages/core && npm install && npx vitest run)        # 60 tests
(cd contracts && npm install && npx hardhat test)          # 67 tests
(cd apps/web && npm install && npm run dev)                # http://localhost:5173
(cd apps/web && npm run build)                             # production build in apps/web/dist
```

The web app imports `packages/core/src` directly, so install `packages/core` before building the web app.

---

## 5. Live testnet

Network: `qorechain-diana`, EVM chain id 9800.
REST `https://api-testnet.qore.host` · RPC `https://rpc-testnet.qore.host` · EVM `https://evm-testnet.qore.host` · explorer `https://explore.qore.network`.

| Role | qor1 | 0x |
|---|---|---|
| Funder / deployer / vault guardian | `qor1yezwppgc3y7dr4un8p4yxp4sum9tsmnpe48ghu` | `0x2644E08518893Cd1D793386a4306B0e6CaB86e61` |
| Pocket, 0x kind (Home Key protected; **registered drill account**) | `qor1fhtc82r35tzp8umnpnmytlxxphs9kxnl2sqrrq` | `0x4dd783A871a2c413F3730CF645fCc60DE05B1A7f` |
| QoreX-style test account (classic, Home Key protected) | `qor1eu6r8hjehspjx0z3m9s9vf04keundh8wsg8gzs` | none (no EVM key) |
| Steal This Seed (funded with 20 QOR, no Home Key yet) | `qor1xkefca25d5dfwwy9tfg9rfs8tujas7pssu0pnd` | `0x35b29C75546d1A9738855a5051a6075F25D87830` |
| Owner's registration wallet (QoreX) | `qor1d3ktmev8ss03m7fyczauzcwac4hjd644rvpejf` | |

**Vault:** `0xadB21AAC72079Ce455a0b09ee56f069bf5E4f27C`, bound to the Pocket's Home Key, delay **1 hour** (demo; default is 24 h), daily limits 5 QOR / 100 fUSD / 0.05 fETH / 0.002 fBTC. Withdrawal id 0 (100 fUSD) was queued, waited the delay and was executed on 17 Nov; the full cycle is in TESTNET.md.

### Secrets

Keys are **not** in git. They live in a local folder that `packages/core/scripts` reads from `.keys/` at the repo root (override with `SEEDPROOF_KEYS_DIR`):

- `.keys/accounts.json`: mnemonic and private key for `funder`, `pocket`, `steal`
- `.keys/accounts.json` also holds `qorex` (mnemonic of the classic test account) and `.keys/qorex-homekey.txt` its Home Key code
- `.keys/pocket-homekey.txt`: the Pocket's Home Key recovery code (QRC1). **Whoever holds this controls the vault and the Pocket's native lane.** Without it, the vault funds are stuck until guardians are set up.
- `.keys/funder-seal-seed.hex`: seed of the funder's QoreSeal keys (guardian 1)
- `.keys/deploy.env`: `PRIVATE_KEY`, `HOME_KEY_PUBKEY`, `GUARDIANS` for `contracts/scripts/deploy.ts`

A copy of all three files was sent to the owner on 17 Nov 2026 (`seedproof-keys.zip`). The owner must pass these to the next person privately (password manager or encrypted file), never through the repo, an issue, or chat. If they are lost, run `s0-accounts.ts` for new accounts and redeploy; the old testnet funds are then gone.

### Scripts (run from `packages/core`, in order)

| Script | Does |
|---|---|
| `npx tsx scripts/s0-accounts.ts` | Create funder, pocket, steal accounts (skips if they exist). Fund the funder from the Dashboard faucet (sign-in needed; 100 QOR + fest tokens per 24 h) |
| `s1-fund.ts` | Register the funder's PQ key, send QOR to pocket and steal |
| `s2-split.ts` | Register the pocket's seed key, rotate to a new Home Key, then R1 to R3 (good send, four thief attempts) |
| `window.ts <acct> <blocks> <maxTxs> <maxValueUqor> [targets]` | Open an EVM window (pocket: signed by Home Key; funder: by its seed key) |
| `npx hardhat run scripts/deploy.ts --network diana` (in `contracts`, after `source .keys/deploy.env` and opening a funder window) | Deploy the vault. Env: `DELAY_SECONDS`, `LIMIT_QOR`, `LIMIT_FUSD`, `LIMIT_FETH`, `LIMIT_FBTC` |
| `s3-vault-fund.ts` | Convert the funder's fest coins to ERC-20 |
| `s4-fund-vault.ts` | Send tokens and QOR to the vault (needs a funder window) |
| `s5-pocket.ts` | Home Key window scoped to the vault, real top-up, thief attempts, over-cap check, queue a withdrawal |
| `s6-drill-proof.ts` | Q-Day Drill proof: Home Key signed self-send from the pocket |
| `s8-execute.ts <id>` | Execute a queued vault action from the Pocket (open a 1-tx vault window first with `window.ts`) |
| `s9-qorex.ts` | The QoreX path: classic account, seed key registered, rotated to a Home Key, send ok, thief refused |
| `s7-badges.ts` | Funder publishes a QoreSeal key (seed in `.keys/funder-seal-seed.hex`) and swaps in pool 2 (Ship Weeks badges) |

---

## 6. Things the chain taught us (read before writing chain code)

1. **A new account can do nothing until it registers a PQ key.** `pqc` code 8. The one classical-only tx allowed is `MsgRegisterPQCKeyV2`.
2. **Two account kinds from the same 24 words.** QoreX creates classic accounts (`m/44'/118'`, `deriveNativeAccount`, Cosmos `secp256k1`): native lane only, no EVM key, so once a Home Key is linked nothing on them moves without it. MetaMask-style wallets use 0x accounts (`m/44'/60'`, `deriveUnifiedAccount`, `eth_secp256k1`: classical sig over `keccak256(SignDoc)` as 64-byte r‖s, pubkey type `/cosmos.evm.crypto.v1.ethsecp256k1.PubKey`), which also spend on the EVM lane through windows. `createApprovalRequest` takes `pubkeyType`; `ethDirectSigner` signs the 0x kind and is checked against the SDK's `signHybridEth`. The Pocket opens either kind, defaulting to whichever is live on chain (QoreX if both or neither). Both paths are proven on chain (TESTNET.md).
3. **The testnet REST API and RPC have no CORS headers.** The web app reads REST via `/qore-rest` on its own origin, proxied by Vite (dev and preview) and by `apps/web/vercel.json` when hosted. `VITE_QORE_REST` overrides it.
4. **Windows must always be scoped.** An unscoped window exposes every ERC-20 on the account (windows do not cap token amounts). The Pocket offers only: QOR-only (`nativeOnly`), vault-only, or one token contract (that token's whole balance is exposed; the app says so).
5. **Every EVM tx from a PQ-keyed account needs an open window**, contract deployment included. Window `maxValue` counts `gasLimit × maxFeePerGas` of each tx, in uqor.
6. **The chain bills at least half the gas limit.** A top-up sent with a 1.5M limit cost 750k. Use `eth_estimateGas` (a top-up is about 313k).
7. **Fest tokens are bank coins** (`erc20:0x…`, case-sensitive). Use `MsgConvertCoin` (`/cosmos.evm.erc20.v1.MsgConvertCoin`) before an EVM contract can hold them.
8. **`fetchPqcStatus` caches.** Call `clearPqcStatusCache()` before reading after a rotation.
9. Thief refusals happen at CheckTx, so they never land on chain and cost the account nothing.
10. Error codes seen: `pqc` 8 no key + classical fallback off; 20 hybrid signature required; 21 PQ signature does not verify; 234 key maintenance needs the hybrid signature.

---

## 7. Q-Day Drill (18 Nov 2026, 00:00 to 23:59 UTC)

Rules (build.qorechain.io/rules and /faq):
- Register on the **project page** before **17 Nov 23:59 UTC**: a testnet account the project uses with an ML-DSA-87 key, its **ECDSA private key**, and up to 5 contracts. Use a fresh testnet account that never held mainnet funds.
- A bot gets that ECDSA key and tries native transfers, opening EVM windows, EVM transfers, approvals and drain calls on the contracts.
- Proof: at least one successful normal tx from the drill account landing on 18 Nov (hybrid native tx with the account as sender, or an EVM tx from its 0x). Paste the 64-hex hash on the project page by **19 Nov 23:59 UTC**.
- Ranking: valid proof, then fewest successful attacks, then most value kept (worst asset ratio, account only), then jury. Five winners, $200 each.

Plan: register the **Pocket** (`qor1fhtc82r35tzp8umnpnmytlxxphs9kxnl2sqrrq`) and the vault. Keep no EVM window open on 18 Nov. Run `s6-drill-proof.ts` on 18 Nov UTC and submit its hash.

---

## 8. What is left, in priority order

1. **Drill**: registered. Keep no EVM window open on the Pocket during 18 Nov; proof tx on 18 Nov; owner submits the hash by 19 Nov 23:59 UTC.
2. **Pocket vault screen**: balances, top-up (instant), withdraw (queued, countdown), cancel; uses `VaultRequest` + Home Key round trip; vault address from `contracts/deployments/diana.json`; gas from `estimateGas`.
3. **Steal This Seed**: give the steal account a Home Key and its own vault, fund pocket and vault, put its real 24 words in `apps/web/src/config.ts` (set `isSample: false`), and add a counter of attempts and value kept.
4. **Contracts quality**: fuzz and invariant tests, reach 100+, Slither report, QCAI audit stage 1 and 2 (owner runs these from the Dashboard), `docs/audit/` + `docs/AUDIT.md`.
5. **Hosting**: deploy `apps/web` (Vercel or similar); the bundle is 3.2 MB, so code-split the routes.
6. **Submission**: README final (add live addresses and TESTNET results), cover image 16:9 at least 1200x675, 3-minute video (script in PLAN.md section 7), project page Description and How it's made, every testnet address listed, Declared vs Verified all green.
7. **Vault hardening found by the threat model**: restrict top-ups to the registered Pocket address (a stolen Home Key alone can currently send one day's cap anywhere), and look at the stolen-Home-Key race during rotation (THREAT_MODEL.md case 3).
8. Build in public daily on the project page and X (#BuildBeforeQDay). Drafts live in `docs/posts/`; note in the change log when one is posted.

---

## 9. Submission checklist

- [ ] Registration complete (GitHub, X, QoreX testnet address); category Post-Quantum dApp; country set; AI-native box ticked
- [x] Public repo, MIT LICENSE at root, commits during the fest, AI_USAGE.md
- [ ] QoreChain Build GitHub App installed on the repo
- [ ] README final: hook, problem, how it works, testnet addresses, how to run, honest limits, credits
- [x] Scoped EVM window used for real (`allowedTargets` = vault)
- [x] `pqcVerify` used in the vault (point to it clearly in README)
- [ ] Two-stage QCAI audit in `docs/audit/` and `docs/AUDIT.md`
- [ ] 100+ tests, fuzz/invariants, Slither report
- [ ] Project page text matches the final build; cover image; video up to 3 minutes; every qor1 address listed
- [ ] Q-Day Drill proof hash submitted by 19 Nov 23:59 UTC
- [ ] People's Choice vote 6 to 15 Dec; jury change requests from 6 Dec (48 h to answer); live demo 16 Dec

---

## 10. Working conventions

- Design: slate `#1C2530` is the Pocket, brass `#B5862F` / `#F1E3BF` / `#3F2E0B` is the Home Key, paper `#E9ECEF`, refused `#A8322A`, verified `#2E6A50`. Type: Archivo (wide, heavy) for display, Archivo at 78% width for seed words, Atkinson Hyperlegible Next for body. Tokens in `apps/web/src/styles.css`.
- No em dashes in user-facing UI copy. Plain words, sentence case, buttons say what happens.
- Mock up new screens before building them; keep edits to existing screens minimal.
- Every testnet claim needs a tx hash in TESTNET.md. Label anything simulated.
- Add a line to AI_USAGE.md with each meaningful commit.

---

## Change log

| When (UTC) | What changed |
|---|---|
| 17 Nov 18:30 | Handoff written: status, runbook, chain lessons, drill plan, remaining work |
| 17 Nov 18:36 | Key files sent to the owner; drill account choice explained (register the Pocket, not the personal QoreX wallet) |
| 17 Nov 18:46 | Owner had not created the project page yet; gave the New project fields (description, how it's made, 4 testnet addresses, kits) and drill registration steps. Ship Weeks badge: paste vault deploy tx `0x5f6e3db2…7b63e10` |
| 17 Nov 19:08 | Project created on the site. Funder registered a QoreSeal key and swapped in pool 2 (badges). Home Key decoder now reads `MsgRegisterKEMKey` and `MsgSwapExactIn` |
| 17 Nov 19:10 | Owner registered the drill (Pocket + vault) and earned all four Ship Weeks badges. GitHub App not compulsory but recommended (commit count shows on the project card) |
| 17 Nov 19:25 | Vault withdrawal id 0 executed after its delay (full queue, wait, execute cycle on chain). Fixed a broken import in `window.ts`. Pocket has no live window going into the drill |
| 17 Nov 19:40 | THREAT_MODEL.md written (9 attacker cases). It surfaced two vault hardening items, now on the to-do list |
| 17 Nov 20:35 | Pocket opens both account kinds (QoreX classic by default) and only scoped windows; QoreX path proven on chain (`s9-qorex.ts`); found that testnet REST has no CORS and added a same-origin proxy (Vite + vercel.json). Docs corrected: QoreX accounts are classic `m/44'/118'`, not 0x |
| 17 Nov 20:45 | Drafted the first build-in-public update (`docs/posts/2026-11-17-update.md`), not yet posted |
