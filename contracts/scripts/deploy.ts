/**
 * Deploy SeedproofVault to qorechain-diana.
 *
 *   PRIVATE_KEY=0x...            deployer (pays gas, has no power over the vault)
 *   HOME_KEY_PUBKEY=0x...        2,592-byte ML-DSA-87 public key of the Home Key
 *   GUARDIANS=0xA,0xB,0xC        optional, comma separated
 *   DELAY_SECONDS=86400          optional, 3600 to 2592000
 *   LIMIT_QOR=5                  optional daily top-up limits, in whole tokens
 *   LIMIT_FUSD=100  LIMIT_FETH=0.05  LIMIT_FBTC=0.002
 *
 *   npx hardhat run scripts/deploy.ts --network diana
 */
import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const TOKENS = {
  QOR: { address: ethers.ZeroAddress, decimals: 18 },
  FUSD: { address: "0x97143B771D34ddb9130b807b135Ae675A5a963CA", decimals: 6 },
  FETH: { address: "0x02292293c13880a26242690eb70a0e42B8E91c28", decimals: 18 },
  FBTC: { address: "0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A", decimals: 8 },
} as const;

async function main() {
  const pub = process.env.HOME_KEY_PUBKEY;
  if (!pub || ethers.dataLength(pub) !== 2592) throw new Error("HOME_KEY_PUBKEY must be the 2,592-byte ML-DSA-87 public key");
  const homeKeyHash = ethers.keccak256(pub);
  const delay = BigInt(process.env.DELAY_SECONDS ?? 86400);
  const guardians = (process.env.GUARDIANS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const limitTokens: string[] = [];
  const limits: bigint[] = [];
  for (const [name, t] of Object.entries(TOKENS)) {
    const v = process.env[`LIMIT_${name}`];
    if (v === undefined) continue;
    limitTokens.push(t.address);
    limits.push(ethers.parseUnits(v, t.decimals));
  }

  const [deployer] = await ethers.getSigners();
  console.log("network   ", network.name, (await ethers.provider.getNetwork()).chainId);
  console.log("deployer  ", deployer.address, ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "QOR");
  console.log("homeKey   ", homeKeyHash);
  console.log("delay     ", delay.toString(), "s");
  console.log("guardians ", guardians.join(", ") || "(none)");

  const Vault = await ethers.getContractFactory("SeedproofVault");
  const vault = await Vault.deploy(homeKeyHash, delay, guardians, limitTokens, limits);
  const tx = vault.deploymentTransaction()!;
  console.log("tx        ", tx.hash);
  const receipt = await tx.wait();
  const address = await vault.getAddress();
  console.log("vault     ", address, "gas", receipt?.gasUsed.toString());

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    vault: address,
    deployTx: tx.hash,
    block: receipt?.blockNumber,
    homeKeyHash,
    delay: Number(delay),
    guardians,
    limits: Object.fromEntries(limitTokens.map((t, i) => [t, limits[i].toString()])),
  };
  const dir = path.join(__dirname, "..", "deployments");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
