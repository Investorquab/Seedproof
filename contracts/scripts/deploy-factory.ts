/**
 * Deploy SeedproofVaultFactory to qorechain-diana. Each Pocket then creates its own vault with
 * factory.create(...). The factory keeps no power over the vaults it creates.
 *
 *   PRIVATE_KEY=0x... npx hardhat run scripts/deploy-factory.ts --network diana
 *   (the deployer needs an open EVM window: packages/core/scripts/window.ts funder ...)
 */
import { ethers, network } from "hardhat";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer", deployer.address);
  const Factory = await ethers.getContractFactory("SeedproofVaultFactory");
  const factory = await Factory.deploy();
  const tx = factory.deploymentTransaction()!;
  const receipt = await tx.wait();
  const address = await factory.getAddress();
  console.log("factory ", address, "tx", tx.hash, "gas", receipt?.gasUsed.toString());
  const dir = path.join(__dirname, "..", "deployments");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  const current = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  current.factory = { address, deployTx: tx.hash, block: receipt?.blockNumber, vaultVersion: 2 };
  writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
