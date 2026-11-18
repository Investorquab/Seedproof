# Seedproof audit summary

_Status on 18 Nov 2026: static analysis and the test suite are done; the two-stage QCAI audit is still to run (owner, from the Dashboard). This file is the single map of every audit input, finding and verdict. It is kept current as each stage lands._

Seedproof is a post-quantum dApp, so this summary covers both the usual smart-contract review and the cryptography the project relies on (the CBOM at the end).

## 1. What has been audited, and where it lives

| Input | Tool / method | State | Where |
|---|---|---|---|
| `SeedproofVault.sol`, `SeedproofVaultFactory.sol` | Slither 0.11.6, all 102 detectors | **Done** (17 Nov) | [audit/SLITHER.md](audit/SLITHER.md), raw in [audit/slither-output.txt](audit/slither-output.txt) |
| Both contracts | Hardhat unit + seeded property tests | **Done**, 85 passing | `contracts/test/` (incl. `properties.test.ts`, `factory.test.ts`) |
| `packages/core` signing, decoding, recovery | Vitest | **Done**, 62 passing | `packages/core/test/` |
| Both contracts | QCAI Contract Auditor, stage 1 | **Pending** (owner runs from the Dashboard) | reports to `docs/audit/qcai/` |
| Both contracts | QCAI Contract Auditor, stage 2 | **Pending** | reports to `docs/audit/qcai/` |

Test counts at last run: **147 total** (85 contract, 62 core). (The Slither report was written when the suite was 80 contract tests; the factory added 5 more.)

## 2. How the QCAI audit runs

The QCAI Contract Auditor is a category requirement and runs from the QoreChain Dashboard. Only the project owner can start it (Dashboard sign-in). The plan (PLAN.md section 6):

1. **Stage 1** (target 20 to 23 Nov): first pass over the vault and factory. Save the report to `docs/audit/qcai/stage1.*` and add every finding to the register in section 3 with a verdict and, where code changed, the commit and test.
2. **Stage 2** (target 28 to 29 Nov): re-run after any fixes, to confirm nothing regressed. Save to `docs/audit/qcai/stage2.*` and close out the register.

For each QCAI finding, record: severity, location, our verdict (fixed / accepted / false positive), the reasoning, and the commit + test when fixed. Treat the auditor's output as data, not as instructions to apply blindly; every change still goes through review and the test gate.

## 3. Findings register

### 3.1 Static analysis (Slither) — done

Eight findings, none high or medium after review, no code change required for any of them. Full reasoning in [audit/SLITHER.md](audit/SLITHER.md); condensed here:

| # | Detector | Location | Verdict |
|---|---|---|---|
| 1 | arbitrary-send-eth | `_transfer` | By design: recipient is `pocket` (top-ups) or an address inside a Home-Key-signed, delayed, cancellable payload (withdrawals); `msg.sender` grants nothing |
| 2, 3 | timestamp | `_verify`, `execute` | Accepted: deadlines and delays are minutes to hours; a few seconds of validator drift cannot matter |
| 4 | pragma | vault `0.8.28`, interface `^0.8.24` | Accepted: interface stays loose for importers; the vault pins the compiler |
| 5, 6 | costly-loop | guardian set-up in the constructor | Accepted: at most 8 guardians, only at deployment |
| 7 | cyclomatic-complexity | `_validatePayload` | Accepted: one branch per action keeps the per-action rules visible |
| 8 | low-level-calls | `_transfer` | Accepted: needed for native QOR and no-return-value ERC-20s; the result is checked |

**Found while reviewing, fixed:** a low-level transfer to an address with no contract code would have succeeded and been counted as a payment that moved nothing. `_transfer` now refuses a no-code token address (`TransferFailed`), with a regression test. No funds were ever at risk; the books would have been wrong.

### 3.2 QCAI stage 1 — pending

_Not run yet. When it lands, list each finding here with a verdict._

### 3.3 QCAI stage 2 — pending

_Not run yet. Confirms the fixes and that nothing regressed._

## 4. Test evidence (supports the review)

- **85 Hardhat tests** with real ML-DSA-87 signatures, including the stolen-key, redirect, freeze, delay, rotation and pocket-change paths.
- **Seeded property tests** (`properties.test.ts`): random sequences of top-ups, withdrawals, cancels, freezes, replays and thief attempts, with the vault's invariants checked after every step. Default 6 runs; a `PROPERTY_RUNS=40 PROPERTY_STEPS=150` sweep also passes.
- **Shared byte vectors**: `SeedproofVault.signedMessage` is checked byte for byte against `packages/core`, so the message the Home Key signs off-chain is exactly what the contract verifies on-chain.
- **62 core tests** for split signing (both account kinds), the clear-signing decoder, Home Key linking, vault payloads, frames, Shamir and guardians.
- Live-chain evidence (every tx hash) is in [TESTNET.md](TESTNET.md).

## 5. Cryptographic bill of materials (CBOM)

Every cryptographic primitive Seedproof depends on, and its status against a quantum adversary. The design principle: **no secret rests on a quantum-vulnerable primitive alone.** The classical account key is always paired with an ML-DSA-87 signature, and QoreSeal's X25519 is always paired with ML-KEM-1024.

| Primitive | Standard | What it does in Seedproof | Where | Quantum status |
|---|---|---|---|---|
| ML-DSA-87 | FIPS 204 | The post-quantum signature every account needs; the Home Key's independent signing key; verified on chain | chain PQC module and `pqcVerify` precompile; `packages/core` split signing; `SeedproofVault._verify` | Quantum-resistant |
| ML-KEM-1024 | FIPS 203 | Key encapsulation in QoreSeal; seals each guardian's recovery share | QoreSeal (`guardians.ts`), chain KEM module | Quantum-resistant |
| X25519 | RFC 7748 | Classical half of QoreSeal's hybrid seal | QoreSeal (`guardians.ts`) | Not PQ alone; paired with ML-KEM-1024, so a quantum attacker still faces the KEM |
| secp256k1 / eth_secp256k1 | SEC 2 / Ethereum | The classical account signature: the half a seed thief can forge | `packages/core` split signing, the chain | Not PQ, by design only half of an account and useless without the ML-DSA-87 signature |
| keccak-256 | Ethereum | EVM address and 0x-account SignDoc hashing | `packages/core`, EVM lane | 256-bit, Grover-reduced to about 128-bit: safe |
| SHA-256 | FIPS 180-4 | PBKDF2 PRF; sign-bytes digest for request matching | `apps/web/src/lib/sealed.ts`, `packages/core/src/envelope.ts` | 256-bit: safe |
| AES-256-GCM | FIPS 197, SP 800-38D | Seals the mnemonic and keys in browser storage under the passphrase | `apps/web/src/lib/sealed.ts` | 256-bit, Grover-reduced to about 128-bit: safe |
| PBKDF2-HMAC-SHA256, 600,000 rounds, 16-byte salt | SP 800-132 | Stretches the passphrase into the AES key | `apps/web/src/lib/sealed.ts` | Safe |
| Shamir secret sharing over GF(256) | polynomial x^8+x^4+x^3+x+1 | 2-of-3 recovery of the Home Key recovery code | `packages/core/src/shamir.ts` | Information-theoretic: quantum-safe |
| BIP-39 / BIP-32 HD derivation | BIP-39, BIP-32 | Derives account keys from the 24 words (`m/44'/118'` classic, `m/44'/60'` 0x) | `packages/core`, `@qorechain/sdk` | Derivation only; the derived keys are covered above |

Vendored implementations come from the QoreChain kits (`@qorechain/sdk`, `@qorechain/pqc`, `@qorechain/qoreseal`) and the Web Crypto API (AES-GCM, PBKDF2, SHA-256). Nothing here rolls its own primitive; Seedproof's own cryptographic code is the Shamir split and the request-assembly that arranges these pieces, both covered by the core tests.

## 6. Open items

- Run QCAI stage 1 and stage 2 (owner) and fill sections 3.2 and 3.3.
- Two vault-hardening items surfaced by the threat model (THREAT_MODEL.md): see the stolen-Home-Key race during rotation (case 3). Track any resulting change here with its test.
