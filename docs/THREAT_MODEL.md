# Seedproof threat model

What each kind of attacker gets, what stops them, and what they can still take. Claims marked **on chain** were tested on qorechain-diana; the transaction hashes are in [TESTNET.md](TESTNET.md).

## What we protect

1. **Savings in the vault**: fUSD, fETH, fBTC and QOR held by `SeedproofVault`.
2. **The account itself**: its native balance, and who controls its post-quantum key.
3. **Pocket money**: on 0x accounts, what sits on the account for daily spending through a scoped EVM window.

## The pieces and where they live

| Piece | Where | Holds | Alone it can |
|---|---|---|---|
| Seed phrase (24 words) | the owner's backup, the phone | the classical secp256k1 key | sign the classical half of a tx |
| Pocket | phone | the classical key, unlocked by a passphrase | spend inside an open window; ask the Home Key for anything else |
| Home Key | second device, can stay offline | an ML-DSA-87 key made from its own QRC1 code, not from the seed | sign the post-quantum half of a tx; sign vault requests. It cannot send a tx: it has no classical key |
| Vault | EVM contract | savings | pay out only on a Home Key signature checked by `pqcVerify`; withdrawals wait a delay |
| Guardians (3) | three people | one QoreSeal-sealed Shamir share each of the Home Key code | one share reveals nothing; two rebuild the Home Key. A vault guardian can also freeze and cancel, never move funds |

## Attackers

### 1. Seed phrase stolen (infostealer, fake wallet extension, photo of the backup, shoulder surfing)

The attack Seedproof exists for. With a default QoreX account, the seed gives the thief **both** keys (the post-quantum key is derived from the same words), so the whole account is lost.

| The thief tries | Result |
|---|---|
| Native send, PQ half signed with the seed-derived key | **Refused on chain**, `pqc` code 21 |
| Native send with no PQ signature | **Refused on chain**, `pqc` code 20 |
| Rotate the account's PQ key to one of his own | **Refused on chain**, code 21: the current key (Home Key) must sign |
| Register a fresh PQ key | **Refused on chain**, code 234 |
| Open or widen an EVM window | **Refused on chain**, code 21 |
| EVM transfer to his own address | **Refused by the node**: not an allowed target of the open window, or no window open |
| Vault top-up or withdrawal signed with the seed-derived key | **Reverts** `WrongHomeKey` |

**Still exposed:**
- **QoreX (classic) accounts: nothing.** They have no EVM key, so there is no window to abuse; every movement needs the Home Key.
- **0x accounts:** whatever the currently open window allows, until it expires or the Home Key closes it. A window caps the number of txs, QOR value (including fees), blocks, and targets, but **not** ERC-20 amounts. So the Pocket only opens scoped windows:
  - QOR-only (`nativeOnly`): at most the QOR cap; tokens cannot move.
  - Vault-only: only fees; every vault action still needs a Home Key signature.
  - One token contract: that token's **whole** balance on the account, so keep only today's amount there.

  It never opens an unscoped window, which would expose every token on the account.

**Response:** close the window from the Home Key, then move to a new account (new seed, same Home Key, or a fresh Home Key).

### 2. Only the classical private key stolen (the Q-Day Drill attacker)

A strict subset of case 1: the private key without the words. Same results. With a default QoreX account this attacker is also stopped, because the post-quantum key comes from the words, not the private key. Seedproof's difference shows in case 1. (Accounts built from a raw private key with SDK 0.12 or earlier had the PQ key derived from that key; the exposure check detects this.)

### 3. Home Key device stolen

The thief has the ML-DSA-87 key (if they get past the device's passphrase seal) but no classical key.

- Cannot send any native tx: the chain needs the classical signature too.
- **Can** sign vault requests, and anyone may submit them, because `msg.sender` grants nothing. So:
  - Top-ups only ever pay the vault's registered Pocket address (`NotPocket` otherwise), so a stolen Home Key alone cannot send even one day's cap to the thief. Changing the Pocket (`SetPocket`) waits the delay, and a guardian can cancel it. **Contract v2: tested (73 Hardhat tests), deploying after the 18 Nov drill.** The v1 demo vault at `0xadB2…f27C` still lets a stolen Home Key top up to any address, up to one day's cap.
  - Withdrawals and rule changes wait the delay (24 h by default; 1 h on the demo vault), and a guardian can cancel or freeze in that time.
- **Response:** a guardian freezes the vault (stops top-ups and `execute`). The owner restores the Home Key from two guardians, rotates the account's PQ key to a new key (needs the classical key, which the thief lacks), then on the vault unfreezes and queues `RotateHomeKey`. The thief holds the old key too and can queue actions of his own during the delay; guardians cancel those. This race is the weak spot of the current design.

### 4. Home Key lost or broken

- Two of the three guardians each open their share on the new device, in person. The QRC1 code is rebuilt and the same key comes back. Tested end to end in a headless browser (wrong guardian refused; 2 of 3 restore gives an identical code).
- Without guardians, a lost Home Key means the account's native lane and the vault are locked. That is the price of a key no one else holds, and why guardian setup is part of onboarding.

### 5. Phone lost or stolen

- The mnemonic is sealed on the phone (PBKDF2, 600,000 rounds, then AES-GCM). A thief who breaks the passphrase is in case 1.
- **Response:** close the window from the Home Key; restore the seed on a new phone.

### 6. Forced to unlock both devices (wrench attack)

Not prevented. What helps:
- Only pocket money is instantly spendable.
- Vault top-ups are capped per day.
- Withdrawals wait the delay; a guardian who hears about it can cancel or freeze. Guardians cannot be forced by the attacker in the same room.

### 7. Tampered request between devices (malicious phone app or QR swap)

- The Home Key never trusts a summary from the phone. It decodes the exact bytes it will sign and shows each action in plain words; anything it cannot decode makes the request refusable (`ApprovalRefused: not-understood`).
- Requests carry the chain id, account, sequence and an expiry; the Home Key checks the account and chain match its own.
- Vault requests are rebuilt from their fields and hashed before signing, with the vault address, chain id and nonce inside the signed bytes, so a signature cannot be replayed on another vault, chain or nonce.

### 8. Guardians collude

Two guardians together can rebuild the Home Key. That gives them case 3 (no classical key). Choose guardians who do not know each other well, and keep the threshold at 2 of 3 or higher.

### 9. Quantum attacker (the reason QoreChain exists)

Breaks secp256k1, so gets the classical key from any public key on chain. That is case 2: stopped by the ML-DSA-87 signature, the same as against a classical thief. The vault checks ML-DSA-87 through `pqcVerify`, not ECDSA.

## Out of scope and known limits

- Testnet only: `pqcVerify` and the v3.2.8 window options are not on mainnet yet.
- Malware on **both** devices at once.
- The QR and copy-paste transport is not authenticated by itself; safety comes from clear signing and the signed fields, not the channel.
- Guardians in the demo run as three local browser profiles, not three people.
- Not audited (QCAI audit pending).
