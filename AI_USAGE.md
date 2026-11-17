# AI usage

Seedproof is built AI-native, with a human (Investorquab) directing and reviewing every step.

## Workflow

- **Research and idea selection:** Claude (Anthropic) read the QoreChain docs, SDK source and changelog, audited the live project gallery, and ran an independent red-team agent against candidate ideas. The human set the research brief, chose the idea and approved the plan.
- **Design:** UI mockups are produced and approved by the human before any UI code is written.
- **Code:** Claude writes code and tests in small reviewed steps; the human supervises, tests on devices and makes product decisions.
- **Audit:** QoreChain's QCAI Contract Auditor runs in two stages on the contracts; reports and the mapping of every finding are in `docs/audit/` and `docs/AUDIT.md`.

## Log

| Date (UTC) | What AI produced | Human contribution |
|---|---|---|
| 17 Nov 2026 | Field audit of 37 projects; found the seed-derived PQ key issue in QoreX docs and SDK 0.13.0 changelog; plan; `packages/core` two-device signing protocol, clear-signing decoder, exposure check; 13 tests | Wrote the research brief, chose Seedproof, set full-time scope, reviewed plan |
| 17 Nov 2026 | `SeedproofVault.sol` (Home Key signed top-ups with daily caps, delayed withdrawals and rule changes, guardian cancel and freeze, Home Key rotation) and 64 Hardhat tests using real ML-DSA-87 signatures | Approved the vault design: pocket money instant, savings delayed and cancellable |
| 17 Nov 2026 | Design canvas (landing page and four phone screens); `apps/web` built from it: landing with a working exposure check, Pocket and Home Key apps, animated QR frames, passphrase-sealed storage | Approved the visual direction (slate Pocket, brass Home Key) and the mockups before any UI code |
| 17 Nov 2026 | Home Key linking (register directly, or dual-signed rotation away from the seed-derived key), vault requests decoded in plain words, shared test vectors checked by both core and the Solidity contract, protection status in Pocket, headless browser run of the Home Key flow | Asked to keep building after approving the mockups |
| 17 Nov 2026 | Guardian recovery: Shamir over GF(256), shares sealed with QoreSeal and bound to the account; Guardian app; Home Key guardian setup and restore; headless browser run of 3 guardians and a 2 of 3 restore | Asked to continue; chose guardian recovery as the answer to "what if the Home Key is lost" |
| 17 Nov 2026 | Live testnet run: pqcVerify check, account scripts, eth_secp256k1 split signing (checked byte for byte against the SDK), `MsgConvertCoin` builder, vault deploy with starting limits, Pocket window scoped to the vault, Home Key top-up, seven thief attempts refused by the chain; `docs/TESTNET.md` with every tx hash | Opened network access for the session, funded the deployer from the Dashboard faucet |
| 17 Nov 2026 | Q-Day Drill research and proof script; handoff docs (`docs/HANDOFF.md`, `docs/PLAN.md`, design mockups in `docs/design/`) | Asked for everything documented in the repo as a handoff |
| 17 Nov 2026 | Ship Weeks badges on chain (QoreSeal key registration, AMM swap); Home Key decoder reads both messages; project page field guidance | Created the project page, filled the form, asked to finish the remaining items |
| 17 Nov 2026 | Pocket for both account kinds (QoreX classic and 0x), scoped-only windows, same-origin REST proxy after finding no CORS on testnet REST; QoreX path proven on chain; docs corrected | Asked whether only the vault is protected, whether this is a wallet or a dApp, and how QoreX social recovery and windows fit; asked to keep every doc current |
