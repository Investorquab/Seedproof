# Working on Seedproof (read me first)

You are picking up Seedproof, the owner's entry in Build Before Q-Day (QoreChain Developer Fest, category Post-Quantum dApp). Final deadline: **2 Dec 2026, 23:59 UTC**.

Read these in order before changing anything:
1. `docs/HANDOFF.md`: status, accounts, scripts, lessons from the live chain, what is left (section 8), and a change log at the end.
2. `docs/TESTNET.md`: every on-chain result with its transaction hash.
3. `docs/THREAT_MODEL.md` and `docs/PLAN.md` when you touch security or the pitch.

## Hard rules

- **Keys never go in git, chat or logs.** The owner keeps `seedproof-keys.zip`. Unzip it into `.keys/` at the repo root (gitignored; scripts read `SEEDPROOF_KEYS_DIR`, default `../../.keys` from `packages/core`). Never print a mnemonic, private key or Home Key code. Only Steal This Seed's 24 words are meant to go public, and only when the owner says so; its Home Key code never does.
- **Q-Day Drill, 18 Nov 2026 00:00 to 23:59 UTC.** The drill account is the Pocket `qor1fhtc82r35tzp8umnpnmytlxxphs9kxnl2sqrrq`; the registered contract is the v1 vault `0xadB21AAC72079Ce455a0b09ee56f069bf5E4f27C`.
  - Do **not** open an EVM window on the Pocket during 18 Nov UTC, and do not touch the v1 vault until the drill ends.
  - A proof transaction must land on 18 Nov UTC: `cd packages/core && npx tsx scripts/s6-drill-proof.ts` (Home Key signed self-send). The previous session scheduled it for 08:41 UTC. If `docs/HANDOFF.md`'s change log has no proof hash by 12:00 UTC on 18 Nov, run it yourself, record the hash, and tell the owner to paste it on the project page by **19 Nov 23:59 UTC**.
- **Every on-chain claim needs a tx hash in `docs/TESTNET.md`.** Label anything simulated.
- **Keep the handoff current as you work**: after each meaningful step, update `docs/HANDOFF.md` (status table, section 8, a change-log row with UTC time), `docs/TESTNET.md` for chain results, and add a row to `AI_USAGE.md` (required for the AI-native award). Another agent must be able to continue from wherever you stop.
- Commit in small steps and push to `origin` (github.com/Investorquab/Seedproof).

## The owner's preferences

- Distinctive, intentional UI; nothing that looks AI-generated. Design system: slate `#1C2530` is the Pocket, brass `#B5862F` / `#F1E3BF` / `#3F2E0B` the Home Key and vault; Archivo (wide, heavy) for display, Atkinson Hyperlegible Next for body. Tokens in `apps/web/src/styles.css`, mockups in `docs/design/`.
- **Mock up a new screen and get approval before building it.** Keep edits to existing screens minimal.
- **No em dashes in user-facing UI copy.** Plain words, sentence case, buttons say what happens.
- Paste-ready terminal commands when the owner must run something.
- Research before asking the owner anything (the fest site build.qorechain.io, its /rules, /faq, /prizes, and docs.qorechain.io). Do not ask what is already published.

## Commands

```bash
# install (each package on its own; core first, the web app imports it)
(cd packages/core && npm install) && (cd contracts && npm install) && (cd apps/web && npm install)

# tests
(cd packages/core && npx vitest run)                 # 62
(cd contracts && npx hardhat test)                   # 85, incl. property tests
PROPERTY_RUNS=40 PROPERTY_STEPS=150 npx hardhat test test/properties.test.ts   # bigger sweep (in contracts)

# web app
(cd apps/web && npm run dev)                          # http://localhost:5173, REST proxied at /qore-rest
(cd apps/web && npm run build && npx vite preview --port 4173)

# browser e2e against the live chain (Node plays the Home Key)
cd packages/core && npx tsx ../../apps/web/e2e/pocket.e2e.mts --account steal            # read-only
cd packages/core && npx tsx ../../apps/web/e2e/pocket.e2e.mts --account steal --topup 1  # needs a vault window

# live-chain scripts (packages/core/scripts): s0..s11, window.ts; see HANDOFF section 5
cd packages/core && npx tsx scripts/window.ts <funder|pocket|steal> <blocks> <maxTxs> <maxValueUqor> [0xTarget]
```

Network: the scripts and app need HTTPS to `api-testnet.qore.host`, `rpc-testnet.qore.host` and `evm-testnet.qore.host`. Browser tests need Chrome (`CHROME_PATH`, default `/usr/bin/google-chrome`).

## Chain facts that bite (details in HANDOFF section 6)

- A new account must register a PQ key before any other tx (`pqc` code 8). Every EVM tx from a keyed account needs an open window, contract deployment included.
- Two account kinds from the same words: QoreX classic `m/44'/118'` (`secp256k1`, no EVM side) and 0x `m/44'/60'` (`eth_secp256k1`). `createApprovalRequest` takes `pubkeyType`.
- Windows: always scoped (`nativeOnly`, or `allowedTargets`). An unscoped window exposes every ERC-20 on the account.
- The chain bills at least half the gas limit: use `eth_estimateGas` with about 20% headroom.
- Testnet REST and RPC have no CORS; the web app uses its `/qore-rest` proxy.
- `fetchPqcStatus` caches: call `clearPqcStatusCache()` before reading after a rotation.
- Fest tokens arrive as bank coins; `MsgConvertCoin` (in `packages/core/src/convert.ts`) moves them to ERC-20.

## Only the owner can do

Run the two-stage QCAI audit from the Dashboard (a hard category requirement), import the repo in Vercel (Root Directory `apps/web`; `vercel.json` has the rest), claim faucet funds (Dashboard sign-in), post updates on the project page and X, record the video, and paste the drill proof hash on the project page.
