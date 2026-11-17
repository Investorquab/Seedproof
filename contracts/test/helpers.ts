import { ethers, network } from "hardhat";
import { generatePqcKeypair, pqcSign, pqcVerify, type PqcKeypair } from "@qorechain/sdk";
// Contracts are used through ethers' dynamic ABI interface (no typechain step).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SeedproofVault = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MockQorePQC = any;

export const PQC_ADDRESS = "0x0000000000000000000000000000000000000a01";
export const NATIVE = ethers.ZeroAddress;
export const HOUR = 3600;
export const DAY = 86400;

export enum Action {
  TopUp,
  Withdraw,
  Cancel,
  Unfreeze,
  SetGuardian,
  SetDailyLimit,
  SetDelay,
  RotateHomeKey,
  SetPocket,
}

const coder = ethers.AbiCoder.defaultAbiCoder();
export const enc = {
  transfer: (token: string, to: string, amount: bigint) => coder.encode(["address", "address", "uint256"], [token, to, amount]),
  id: (id: bigint | number) => coder.encode(["uint256"], [id]),
  guardian: (g: string, on: boolean) => coder.encode(["address", "bool"], [g, on]),
  limit: (token: string, limit: bigint) => coder.encode(["address", "uint256"], [token, limit]),
  delay: (d: number) => coder.encode(["uint64"], [d]),
  key: (h: string) => coder.encode(["bytes32"], [h]),
  pocket: (a: string) => coder.encode(["address"], [a]),
};

export const keyHash = (k: PqcKeypair) => ethers.keccak256(k.publicKey);

/** Install the precompile test double at 0x...0a01. */
export async function installPqcDouble(): Promise<MockQorePQC> {
  const Mock = await ethers.getContractFactory("MockQorePQC");
  const tmp = await Mock.deploy();
  const code = await ethers.provider.getCode(await tmp.getAddress());
  await network.provider.send("hardhat_setCode", [PQC_ADDRESS, code]);
  return Mock.attach(PQC_ADDRESS) as unknown as MockQorePQC;
}

export async function removePqcPrecompile() {
  await network.provider.send("hardhat_setCode", [PQC_ADDRESS, "0x"]);
}

export async function now(): Promise<number> {
  const b = await ethers.provider.getBlock("latest");
  return b!.timestamp;
}

export async function increase(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

export interface Signed {
  pubkey: Uint8Array;
  signature: Uint8Array;
  deadline: bigint;
}

/**
 * Sign an action with a REAL ML-DSA-87 key, check it with the REAL verifier,
 * and only then register the exact triple as valid in the precompile double.
 * A signature that fails the real check is never registered.
 */
export async function sign(
  vault: SeedproofVault,
  mock: MockQorePQC,
  key: PqcKeypair,
  action: Action,
  payload: string,
  opts: { nonce?: bigint; deadline?: bigint; claimPubkey?: Uint8Array } = {},
): Promise<Signed> {
  const nonce = opts.nonce ?? (await vault.nonce());
  const deadline = opts.deadline ?? BigInt((await now()) + HOUR);
  const message = ethers.getBytes(await vault.signedMessage(action, payload, nonce, deadline));
  const signature = pqcSign(key.secretKey, message);
  const pubkey = opts.claimPubkey ?? key.publicKey;
  if (pqcVerify(pubkey, message, signature)) {
    const triple = ethers.keccak256(coder.encode(["bytes", "bytes", "bytes"], [pubkey, signature, message]));
    await mock.setValid(triple, true);
  }
  return { pubkey, signature, deadline };
}

export function newKey(): PqcKeypair {
  return generatePqcKeypair();
}
