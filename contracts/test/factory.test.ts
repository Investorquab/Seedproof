import { expect } from "chai";
import { ethers } from "hardhat";
import { Action, HOUR, NATIVE, enc, installPqcDouble, keyHash, newKey, sign } from "./helpers";

const E = (v: string) => ethers.parseEther(v);

describe("SeedproofVaultFactory", () => {
  async function setup() {
    const [alice, bob, guardian, thief] = await ethers.getSigners();
    const mock = await installPqcDouble();
    const Factory = await ethers.getContractFactory("SeedproofVaultFactory");
    const factory = await Factory.deploy();
    return { alice, bob, guardian, thief, mock, factory };
  }

  it("creates a vault whose pocket is the caller and records it", async () => {
    const { alice, guardian, factory } = await setup();
    const home = newKey();
    await expect(factory.connect(alice).create(keyHash(home), 24 * HOUR, [guardian.address], [NATIVE], [E("5")])).to.emit(
      factory,
      "VaultCreated",
    );
    const addr = await factory.vaultOf(alice.address);
    const vault = await ethers.getContractAt("SeedproofVault", addr);
    expect(await vault.pocket()).to.equal(alice.address);
    expect(await vault.homeKeyHash()).to.equal(keyHash(home));
    expect(await vault.isGuardian(guardian.address)).to.equal(true);
    expect(await vault.dailyLimit(NATIVE)).to.equal(E("5"));
    expect(await vault.delay()).to.equal(BigInt(24 * HOUR));
  });

  it("allows one vault per pocket", async () => {
    const { alice, factory } = await setup();
    await factory.connect(alice).create(keyHash(newKey()), HOUR, [], [], []);
    await expect(factory.connect(alice).create(keyHash(newKey()), HOUR, [], [], [])).to.be.revertedWithCustomError(factory, "AlreadyHasVault");
  });

  it("gives each pocket its own vault, and nobody can create one for someone else", async () => {
    const { alice, bob, thief, factory } = await setup();
    await factory.connect(alice).create(keyHash(newKey()), HOUR, [], [], []);
    await factory.connect(bob).create(keyHash(newKey()), HOUR, [], [], []);
    expect(await factory.vaultOf(alice.address)).to.not.equal(await factory.vaultOf(bob.address));
    // A thief calling create gets a vault for the thief's own address, never for alice.
    await factory.connect(thief).create(keyHash(newKey()), HOUR, [], [], []);
    const v = await ethers.getContractAt("SeedproofVault", await factory.vaultOf(thief.address));
    expect(await v.pocket()).to.equal(thief.address);
  });

  it("passes constructor checks through (bad delay, zero Home Key)", async () => {
    const { alice, factory } = await setup();
    const Vault = await ethers.getContractFactory("SeedproofVault");
    await expect(factory.connect(alice).create(keyHash(newKey()), 60, [], [], [])).to.be.revertedWithCustomError(Vault, "BadDelay");
    await expect(factory.connect(alice).create(ethers.ZeroHash, HOUR, [], [], [])).to.be.revertedWithCustomError(Vault, "WrongHomeKey");
    expect(await factory.vaultOf(alice.address)).to.equal(ethers.ZeroAddress);
  });

  it("creates a vault that works: Home Key top-up pays the pocket", async () => {
    const { alice, thief, mock, factory } = await setup();
    const home = newKey();
    await factory.connect(alice).create(keyHash(home), HOUR, [], [NATIVE], [E("5")]);
    const vault = await ethers.getContractAt("SeedproofVault", await factory.vaultOf(alice.address));
    await alice.sendTransaction({ to: await vault.getAddress(), value: E("10") });
    const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, alice.address, E("2")));
    await expect(vault.connect(thief).topUp(NATIVE, alice.address, E("2"), s.deadline, s.pubkey, s.signature)).to.changeEtherBalance(alice, E("2"));
  });
});
