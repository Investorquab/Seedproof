# Seedproof on qorechain-diana: live evidence

Every claim Seedproof makes, run against the public QoreChain testnet on 17 Nov 2026.
Scripts are in `packages/core/scripts/` (`s0` to `s5`) and `contracts/scripts/deploy.ts`.
Explorer: https://explore.qore.network

## Accounts

| Role | qor1 | 0x |
|---|---|---|
| Deployer / funder | `qor1yezwppgc3y7dr4un8p4yxp4sum9tsmnpe48ghu` | `0x2644E08518893Cd1D793386a4306B0e6CaB86e61` |
| Pocket (protected by a Home Key) | `qor1fhtc82r35tzp8umnpnmytlxxphs9kxnl2sqrrq` | `0x4dd783A871a2c413F3730CF645fCc60DE05B1A7f` |
| Steal This Seed | `qor1xkefca25d5dfwwy9tfg9rfs8tujas7pssu0pnd` | `0x35b29C75546d1A9738855a5051a6075F25D87830` |

These three are 0x-style accounts (`m/44'/60'`, what MetaMask-style wallets derive): one secp256k1 key for the qor1 address and its 0x twin, signed as `eth_secp256k1` on the native lane, so an EVM window covers the account the phone spends from.

QoreX creates classic accounts instead (`m/44'/118'`, Cosmos `secp256k1`), which have no EVM side at all. That path is proven separately below ("A QoreX-style account").

## SeedproofVault

- Address: `0xadB21AAC72079Ce455a0b09ee56f069bf5E4f27C`
- Deploy tx: `0x5f6e3db2394395246e7e568a97e78e7320c940d3b9304bf28bb009fcc7b63e10` (2,084,776 gas)
- Home Key hash: `0x0dcf788e75d0679627281c8f46e006299e1a20457947d9e5e55d44262a8a5871`
- Delay: **1 hour on this demo vault** so a full queue, wait and execute fits in a video. The default is 24 hours.
- Daily top-up limits: 5 QOR, 100 fUSD, 0.05 fETH, 0.002 fBTC
- Funded with 500 fUSD, 0.25 fETH, 0.01 fBTC, 8 QOR

## Results

### The split works (two devices, one transaction)

| Step | Result | Tx | Gas |
|---|---|---|---|
| Pocket registers its seed-derived PQ key (the state every QoreX account starts in) | code 0 | `64F9E8E4…A73E290` | 299,270 |
| Rotate to an independent Home Key (`MsgRotatePQCKey`, both keys sign) | code 0 | `D0AE4401…E9C48D3` | 455,135 |
| **R1** Send 1 QOR: classical sig from the phone, ML-DSA-87 sig from the Home Key | **code 0** | `AFF7907B…98FB1A4` | 189,083 |

After the rotation, the account's registered key equals the Home Key and not the seed-derived key (read from `/qorechain/pqc/v1/account/{addr}`).

### A thief with all 24 words

| Attempt | Chain answer | Tx |
|---|---|---|
| **R2** Send, PQ sig from the seed-derived key | refused, `pqc` code 21: hybrid PQC signature verification failed | `78C09132…E029F9` |
| **R3a** Send classical-only | refused, `pqc` code 20: registered key, hybrid signature required | `58F2C195…21169A` |
| **R3b** Rotate the PQ key to his own | refused, `pqc` code 21 | `D41ED1D6…312F48D` |
| **R3c** Register his own key from scratch | refused, `pqc` code 234: key maintenance needs the hybrid signature | `2BA92DC2…A77108E` |
| Open a wide EVM window | refused, `pqc` code 21 | `A0B6D63B…DA501D2` |
| EVM send of 1 QOR from the Pocket to his address | refused by the node: "the window does not list 0x2644… as an allowed recipient" | not included |
| Vault top-up signed with the seed-derived key | reverts `WrongHomeKey()` (simulated) | none |

### The Pocket working normally

| Step | Result | Tx |
|---|---|---|
| Home Key opens a window: 3 txs, 1 QOR of fees, **only the vault** as target | code 0 | `63C7A377…D2174AE` |
| **R4** Vault top-up of 50 fUSD, Home Key signature checked by `pqcVerify` at `0x…0a01` | success, Pocket balance 50 fUSD | `0x2efc2038…4f6283` |
| Second top-up of 60 fUSD (cap 100, 50 used) | reverts `OverDailyLimit(50000000)` | none |
| Queue a 100 fUSD withdrawal (1 hour delay) | success, id 0 | `0x1941e6e4…89d270f2` |
| After the delay: Home Key opens a 1-tx window to the vault only | code 0 | `2E23ED9A…AE3231FB` |
| Execute withdrawal id 0 (anyone may call; the Home Key already signed it when queued) | success, Pocket 50 -> 150 fUSD, 60,894 gas; window then shows 0 txs left | `0x28c9aebb…87b3a` |

### The vault screen, end to end in a browser

Headless Chrome against the live chain, Pocket app built from `apps/web`. The test moved the request out with the screen's "Copy as text" fallback, signed it with the real Home Key code, and pasted the answer back (in normal use this is the animated QR).

| Step in the app | Home Key read | Result | Tx |
|---|---|---|---|
| Home Key opens a vault-only window (3 calls, 1 QOR of fees, 300 blocks) | | code 0 | `CAE5F4A8…BE30F9E0` |
| Top up 5 fUSD | "Top up your Pocket with 5 fUSD from your vault, now" | success | `0x0fe9e5db…72dc083` |
| Withdraw 20 fUSD | "Withdraw 20 fUSD from your vault to your Pocket, after the waiting period" | queued as #1, countdown shown | `0x04bd4e69…174332` |
| Cancel #1 | "Cancel waiting vault action #1" | cancelled, list empty | `0x107846c2…04996bd1` |

After the three calls the window was used up (`live: false`), and the screen asked for a new one.

### A QoreX-style account (classic, `m/44'/118'`)

Account `qor1eu6r8hjehspjx0z3m9s9vf04keundh8wsg8gzs`, script `s9-qorex.ts`.

| Step | Result | Tx | Gas |
|---|---|---|---|
| Funder sends 5 QOR | code 0 | `010C051B…BF4F981` | 201,127 |
| Register the seed-derived key, as QoreX does on the first transfer | code 0 | `E9A9F8A0…4B22F605` | 278,345 |
| Rotate to an independent Home Key | code 0 | `77B90FE5…3BDEB9` | 433,139 |
| Send 0.5 QOR, Home Key signs | **code 0** | `29F79376…ABCBB0A` | 167,121 |
| Thief with the 24 words sends 0.5 QOR | **refused, `pqc` code 21** | `0C2881EA…34F5969A` | |

A classic account has no EVM key, so after linking there is no window to manage and nothing on it moves without the Home Key.

### Steal This Seed account

`qor1xkefca25d5dfwwy9tfg9rfs8tujas7pssu0pnd` holds 20 QOR. Its 24 words will be published once the public page and counter are ready.

| Step | Result | Tx | Gas |
|---|---|---|---|
| Register the seed-derived key | code 0 | `8342347B…4EC847BC` | 299,270 |
| Rotate to an independent Home Key | code 0 | `822C46B8…90F33F1A` | 455,155 |

### Guardian encryption key and a pool swap

| Step | Result | Tx | Gas |
|---|---|---|---|
| Funder (the vault's guardian) publishes its QoreSeal ML-KEM-1024 key (`MsgRegisterKEMKey`) | code 0, key readable at `/qorechain/pqc/v1/kem/{addr}` | `83B92D77…8306D9EB` | 269,557 |
| Funder swaps 1 QOR for fUSD in AMM pool 2 | code 0 | `B2AE1013…EFBB7BADA5` | 267,312 |

### pqcVerify precompile on its own

A direct `eth_call` with a fresh ML-DSA-87 key: valid signature returns `true`, the same signature with one bit flipped returns `false`. Whole call: 312,170 gas (most of it is calldata for the 2,592-byte key and 4,627-byte signature).

A vault top-up estimates at **313,000 gas** (about 0.035 QOR at 112.5 gwei).

## Things we learned that the docs do not say outright

- A fresh account cannot send anything until it registers a PQ key: `pqc` code 8, "classical fallback not allowed". The one classical-only tx allowed is `MsgRegisterPQCKeyV2`.
- EVM transactions from an account with a PQ key need an open window. That includes contract deployment.
- A window narrowed with `allowedTargets` blocks ERC-20 transfers (their recipient is the token contract) unless that token contract is listed; if it is listed, the whole balance of that token can leave. `nativeOnly` admits only plain QOR transfers. The Pocket only opens one of these three scoped kinds.
- The REST API and RPC send no CORS headers (only the EVM endpoint does), so a browser app must read REST through a proxy on its own origin. See `apps/web/vite.config.ts` and `apps/web/vercel.json`.
- The window's `maxValue` counts each transaction's `gasLimit × maxFeePerGas`, and the chain bills at least half the gas limit. Set the gas limit from `eth_estimateGas`, not a round number.
- Fest tokens arrive as bank coins (`erc20:0x…`). `MsgConvertCoin` (`/cosmos.evm.erc20.v1.MsgConvertCoin`) moves them to the ERC-20 side. SDK 0.14 has no builder for it, so `packages/core/src/convert.ts` adds one.
- `fetchPqcStatus` caches. Call `clearPqcStatusCache()` before reading right after a rotation.
