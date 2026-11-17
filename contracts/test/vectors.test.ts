import { expect } from "chai";
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { keccak256 } from "ethers";
import { generatePqcKeypair } from "@qorechain/sdk";

// The same file packages/core checks: both sides must produce identical bytes.
const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../packages/core/test/vectors/vault-signed-message-v1.json"), "utf8"),
);

describe("SeedproofVault.signedMessage matches packages/core", () => {
  it("returns the shared vector bytes for every case", async () => {
    const Vault = await ethers.getContractFactory("SeedproofVault");
    const tmp = await Vault.deploy(keccak256(generatePqcKeypair().publicKey), 3600, [], [], []);
    const code = await ethers.provider.getCode(await tmp.getAddress());
    // signedMessage only reads address(this) and block.chainid, so the runtime
    // code at the vector's address answers exactly like a deployed vault.
    await network.provider.send("hardhat_setCode", [vectors.vault, code]);
    const vault = Vault.attach(vectors.vault) as any;
    const { chainId } = await ethers.provider.getNetwork();

    let checked = 0;
    for (const c of vectors.cases) {
      if (BigInt(c.chainId) !== chainId) continue; // other-chain cases are checked in core only
      const got = await vault.signedMessage(c.action, c.payload, c.nonce, c.deadline);
      expect(got, c.name).to.equal(c.expected);
      checked++;
    }
    expect(checked).to.be.greaterThan(3);
  });
});
