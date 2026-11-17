# Slither report for SeedproofVault

- Tool: Slither 0.11.6, all 102 detectors, solc 0.8.28 with the same settings as the build (optimizer 200 runs, `cancun`).
- Target: `contracts/contracts/SeedproofVault.sol` (vault v2, with the registered Pocket), run on 17 Nov 2026.
- Raw output: [slither-output.txt](slither-output.txt).
- Result: **8 findings, none high or medium after review. No code change needed for any of them.**

To reproduce:

```bash
pip install slither-analyzer solc-select && solc-select install 0.8.28 && solc-select use 0.8.28
cd contracts && slither contracts/SeedproofVault.sol --solc-args "--optimize --optimize-runs 200 --evm-version cancun"
```

| # | Detector | Where | Verdict | Why |
|---|---|---|---|---|
| 1 | arbitrary-send-eth (high in Slither's scale) | `_transfer`, native `to.call{value}` | **By design** | The recipient is never chosen by the caller alone. Top-ups pay only `pocket` (`NotPocket` otherwise). Withdrawals pay the address inside a payload the Home Key signed with ML-DSA-87 (checked by `pqcVerify`), and only after the delay, which a guardian can cancel. `msg.sender` grants nothing. Covered by the stolen-key and redirect tests, and by the property tests. |
| 2 | timestamp | `_verify` (`block.timestamp > deadline`) | Accepted | Deadlines are minutes to hours. Validators can shift a timestamp by seconds, which cannot matter at that scale. |
| 3 | timestamp | `execute` (`block.timestamp < readyAt`) | Accepted | Same reasoning. The delay is at least 1 hour. |
| 4 | pragma | `0.8.28` in the vault, `^0.8.24` in `IQorePQC` | Accepted | The interface stays loose on purpose so other projects can import it; the vault pins the compiler. |
| 5, 6 | costly-loop | `_setGuardian` counter inside the constructor loop | Accepted | At most 8 guardians (`TooManyGuardians`), only at deployment. |
| 7 | cyclomatic-complexity | `_validatePayload` (13) | Accepted | One branch per action type, each checking its own payload. Splitting it would hide the per-action rules. |
| 8 | low-level-calls | `_transfer` | Accepted | Needed for native QOR and for ERC-20 tokens that return no value. The call result is checked, and so is the returned bool when there is one. |

## Found while reviewing, fixed

Reading `_transfer` for finding 8 showed a gap Slither does not flag. A low-level `transfer` call to an address with **no contract code** succeeds and returns no data, so the vault would have counted a payment that moved nothing. No funds could be lost this way, but the books would be wrong. Fixed: `_transfer` now refuses a token address with no code (`TransferFailed`). Test: "refuses a token address with no contract code instead of pretending to pay".

## Related checks

- 80 Hardhat tests, including 6 seeded property runs (random sequences of top-ups, withdrawals, cancels, freezes, replays and thief attempts, with invariants checked after every step). A 40 x 150 step sweep also passed: `PROPERTY_RUNS=40 PROPERTY_STEPS=150 npx hardhat test test/properties.test.ts`.
- The two-stage QCAI audit is separate and still to run (owner, from the Dashboard).
