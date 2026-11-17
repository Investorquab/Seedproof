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
