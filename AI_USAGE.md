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
