import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { PqcKeypair } from "@qorechain/sdk";
import {
  Action,
  DAY,
  HOUR,
  NATIVE,
  enc,
  increase,
  installPqcDouble,
  keyHash,
  newKey,
  now,
  removePqcPrecompile,
  sign,
  type MockQorePQC,
  type SeedproofVault,
} from "./helpers";

const E = (n: string) => ethers.parseEther(n);

describe("SeedproofVault", function () {
  // ML-DSA-87 keygen and signing are real; keep them shared across tests.
  let home: PqcKeypair;
  let thiefPq: PqcKeypair;
  before(() => {
    home = newKey();
    thiefPq = newKey();
  });

  let mock: MockQorePQC;
  let vault: SeedproofVault;
  let token: any;
  let owner: HardhatEthersSigner; // the phone / pocket account (classical key)
  let guardian: HardhatEthersSigner;
  let guardian2: HardhatEthersSigner;
  let thief: HardhatEthersSigner; // holds the stolen seed phrase, so the classical key
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, guardian, guardian2, thief, stranger] = await ethers.getSigners();
    mock = await installPqcDouble();
    const Vault = await ethers.getContractFactory("SeedproofVault");
    vault = await Vault.deploy(keyHash(home), owner.address, 24 * HOUR, [guardian.address, guardian2.address], [], []);
    const Token = await ethers.getContractFactory("TestToken");
    token = await Token.deploy();
    await owner.sendTransaction({ to: await vault.getAddress(), value: E("100") });
    await token.mint(await vault.getAddress(), E("1000"));
  });

  async function setLimitNow(tokenAddr: string, limit: bigint) {
    const p = enc.limit(tokenAddr, limit);
    const s = await sign(vault, mock, home, Action.SetDailyLimit, p);
    await vault.queue(Action.SetDailyLimit, p, s.deadline, s.pubkey, s.signature);
    const id = (await vault.queueLength()) - 1n;
    await increase(24 * HOUR);
    await vault.execute(id);
  }

  async function queueWithdraw(tokenAddr: string, to: string, amount: bigint) {
    const p = enc.transfer(tokenAddr, to, amount);
    const s = await sign(vault, mock, home, Action.Withdraw, p);
    await vault.queue(Action.Withdraw, p, s.deadline, s.pubkey, s.signature);
    return (await vault.queueLength()) - 1n;
  }

  // ------------------------------------------------------------ deployment
  describe("deployment", () => {
    it("stores the Home Key hash, delay and guardians", async () => {
      expect(await vault.homeKeyHash()).to.equal(keyHash(home));
      expect(await vault.delay()).to.equal(24n * BigInt(HOUR));
      expect(await vault.isGuardian(guardian.address)).to.equal(true);
      expect(await vault.isGuardian(guardian2.address)).to.equal(true);
      expect(await vault.guardianCount()).to.equal(2n);
      expect(await vault.frozen()).to.equal(false);
      expect(await vault.nonce()).to.equal(0n);
    });

    it("rejects a zero Home Key hash", async () => {
      const Vault = await ethers.getContractFactory("SeedproofVault");
      await expect(Vault.deploy(ethers.ZeroHash, owner.address, DAY, [], [], [])).to.be.revertedWithCustomError(vault, "WrongHomeKey");
    });

    it("rejects a delay shorter than 1 hour", async () => {
      const Vault = await ethers.getContractFactory("SeedproofVault");
      await expect(Vault.deploy(keyHash(home), owner.address, HOUR - 1, [], [], [])).to.be.revertedWithCustomError(vault, "BadDelay");
    });

    it("rejects a delay longer than 30 days", async () => {
      const Vault = await ethers.getContractFactory("SeedproofVault");
      await expect(Vault.deploy(keyHash(home), owner.address, 30 * DAY + 1, [], [], [])).to.be.revertedWithCustomError(vault, "BadDelay");
    });

    it("rejects a zero-address guardian", async () => {
      const Vault = await ethers.getContractFactory("SeedproofVault");
      await expect(Vault.deploy(keyHash(home), owner.address, DAY, [ethers.ZeroAddress], [], [])).to.be.revertedWithCustomError(vault, "BadGuardian");
    });

    it("counts a duplicated guardian once", async () => {
      const Vault = await ethers.getContractFactory("SeedproofVault");
      const v = await Vault.deploy(keyHash(home), owner.address, DAY, [guardian.address, guardian.address], [], []);
      expect(await v.guardianCount()).to.equal(1n);
    });

    it("sets starting daily limits from the constructor", async () => {
      const Vault = await ethers.getContractFactory("SeedproofVault");
      const t = ethers.Wallet.createRandom().address;
      const v = await Vault.deploy(keyHash(home), owner.address, DAY, [], [ethers.ZeroAddress, t], [E("5"), 123n]);
      expect(await v.dailyLimit(ethers.ZeroAddress)).to.equal(E("5"));
      expect(await v.dailyLimit(t)).to.equal(123n);
      await expect(v.deploymentTransaction()).to.emit(v, "DailyLimitSet").withArgs(t, 123n);
    });

    it("rejects starting limits whose lengths do not match", async () => {
      const Vault = await ethers.getContractFactory("SeedproofVault");
      await expect(Vault.deploy(keyHash(home), owner.address, DAY, [], [ethers.ZeroAddress], [])).to.be.revertedWithCustomError(vault, "BadLength");
    });

    it("caps guardians at 8", async () => {
      const Vault = await ethers.getContractFactory("SeedproofVault");
      const nine = Array.from({ length: 9 }, () => ethers.Wallet.createRandom().address);
      await expect(Vault.deploy(keyHash(home), owner.address, DAY, nine, [], [])).to.be.revertedWithCustomError(vault, "TooManyGuardians");
    });

    it("accepts native deposits and emits Deposited", async () => {
      await expect(stranger.sendTransaction({ to: await vault.getAddress(), value: E("1") }))
        .to.emit(vault, "Deposited")
        .withArgs(NATIVE, stranger.address, E("1"));
    });
  });

  // ------------------------------------------------------- signed messages
  describe("signed message binding", () => {
    it("binds chain, vault, nonce, action, payload and deadline", async () => {
      const p = enc.transfer(NATIVE, owner.address, 1n);
      const base = await vault.signedMessage(Action.TopUp, p, 0, 100);
      expect(await vault.signedMessage(Action.Withdraw, p, 0, 100)).to.not.equal(base);
      expect(await vault.signedMessage(Action.TopUp, enc.transfer(NATIVE, thief.address, 1n), 0, 100)).to.not.equal(base);
      expect(await vault.signedMessage(Action.TopUp, p, 1, 100)).to.not.equal(base);
      expect(await vault.signedMessage(Action.TopUp, p, 0, 101)).to.not.equal(base);
      const Vault = await ethers.getContractFactory("SeedproofVault");
      const other = await Vault.deploy(keyHash(home), owner.address, DAY, [], [], []);
      expect(await other.signedMessage(Action.TopUp, p, 0, 100)).to.not.equal(base);
    });

    it("uses the documented domain", async () => {
      expect(await vault.DOMAIN()).to.equal(ethers.id("seedproof.vault.v1"));
    });
  });

  // --------------------------------------------------------------- top-ups
  describe("topUp (instant pocket money)", () => {
    beforeEach(async () => {
      await setLimitNow(NATIVE, E("5"));
      await setLimitNow(await token.getAddress(), E("20"));
    });

    it("sends native QOR to the pocket within the daily limit", async () => {
      const p = enc.transfer(NATIVE, owner.address, E("2"));
      const s = await sign(vault, mock, home, Action.TopUp, p);
      await expect(vault.topUp(NATIVE, owner.address, E("2"), s.deadline, s.pubkey, s.signature)).to.changeEtherBalances(
        [vault, owner],
        [-E("2"), E("2")],
      );
    });

    it("sends tokens to the pocket within the daily limit", async () => {
      const t = await token.getAddress();
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(t, owner.address, E("10")));
      await vault.topUp(t, owner.address, E("10"), s.deadline, s.pubkey, s.signature);
      expect(await token.balanceOf(owner.address)).to.equal(E("10"));
    });

    it("consumes a nonce and emits ToppedUp", async () => {
      const n = await vault.nonce();
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("1")));
      await expect(vault.topUp(NATIVE, owner.address, E("1"), s.deadline, s.pubkey, s.signature))
        .to.emit(vault, "ToppedUp")
        .withArgs(NATIVE, owner.address, E("1"), n);
      expect(await vault.nonce()).to.equal(n + 1n);
    });

    it("refuses more than the daily limit", async () => {
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("6")));
      await expect(vault.topUp(NATIVE, owner.address, E("6"), s.deadline, s.pubkey, s.signature))
        .to.be.revertedWithCustomError(vault, "OverDailyLimit")
        .withArgs(E("5"));
    });

    it("tracks the limit across several top-ups in one day", async () => {
      let s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("3")));
      await vault.topUp(NATIVE, owner.address, E("3"), s.deadline, s.pubkey, s.signature);
      expect(await vault.availableToday(NATIVE)).to.equal(E("2"));
      s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("3")));
      await expect(vault.topUp(NATIVE, owner.address, E("3"), s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "OverDailyLimit",
      );
    });

    it("resets the limit on the next UTC day", async () => {
      let s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("5")));
      await vault.topUp(NATIVE, owner.address, E("5"), s.deadline, s.pubkey, s.signature);
      await increase(DAY);
      s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("5")));
      await expect(vault.topUp(NATIVE, owner.address, E("5"), s.deadline, s.pubkey, s.signature)).to.not.be.reverted;
    });

    it("refuses tokens with no limit set (default zero)", async () => {
      const Token = await ethers.getContractFactory("TestToken");
      const other = await Token.deploy();
      const a = await other.getAddress();
      await other.mint(await vault.getAddress(), E("1"));
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(a, owner.address, 1n));
      await expect(vault.topUp(a, owner.address, 1n, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "OverDailyLimit",
      );
    });

    it("refuses while frozen", async () => {
      await vault.connect(guardian).freeze();
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("1")));
      await expect(vault.topUp(NATIVE, owner.address, E("1"), s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "IsFrozen",
      );
    });

    it("refuses an expired signature", async () => {
      const deadline = BigInt((await now()) + 10);
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("1")), { deadline });
      await increase(60);
      await expect(vault.topUp(NATIVE, owner.address, E("1"), s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "Expired",
      );
    });

    it("refuses to send to the zero address", async () => {
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, ethers.ZeroAddress, 1n));
      await expect(vault.topUp(NATIVE, ethers.ZeroAddress, 1n, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "NotPocket",
      );
    });

    it("pays only the registered pocket, even with a valid Home Key signature (stolen Home Key)", async () => {
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, thief.address, E("1")));
      const before = await vault.nonce();
      await expect(
        vault.connect(thief).topUp(NATIVE, thief.address, E("1"), s.deadline, s.pubkey, s.signature),
      ).to.be.revertedWithCustomError(vault, "NotPocket");
      expect(await vault.nonce()).to.equal(before); // nothing consumed
    });

    it("sends to the signed recipient no matter who submits", async () => {
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("1")));
      await expect(
        vault.connect(thief).topUp(NATIVE, owner.address, E("1"), s.deadline, s.pubkey, s.signature),
      ).to.changeEtherBalance(owner, E("1"));
    });
  });

  // ------------------------------------------- the seed thief (the point)
  describe("a thief holding the seed phrase", () => {
    beforeEach(async () => {
      await setLimitNow(NATIVE, E("5"));
    });

    it("cannot top up with a key derived from the seed (wrong Home Key)", async () => {
      const s = await sign(vault, mock, thiefPq, Action.TopUp, enc.transfer(NATIVE, owner.address, E("1")));
      await expect(
        vault.connect(thief).topUp(NATIVE, owner.address, E("1"), s.deadline, s.pubkey, s.signature),
      ).to.be.revertedWithCustomError(vault, "WrongHomeKey");
    });

    it("cannot pass by claiming the Home Key's public key with its own signature", async () => {
      const s = await sign(vault, mock, thiefPq, Action.TopUp, enc.transfer(NATIVE, owner.address, E("1")), {
        claimPubkey: home.publicKey,
      });
      await expect(
        vault.connect(thief).topUp(NATIVE, owner.address, E("1"), s.deadline, s.pubkey, s.signature),
      ).to.be.revertedWithCustomError(vault, "BadSignature");
    });

    it("cannot redirect an owner-signed top-up to itself", async () => {
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("1")));
      await expect(
        vault.connect(thief).topUp(NATIVE, thief.address, E("1"), s.deadline, s.pubkey, s.signature),
      ).to.be.revertedWithCustomError(vault, "NotPocket");
    });

    it("cannot raise the amount of an owner-signed top-up", async () => {
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("1")));
      await expect(
        vault.connect(thief).topUp(NATIVE, owner.address, E("4"), s.deadline, s.pubkey, s.signature),
      ).to.be.revertedWithCustomError(vault, "BadSignature");
    });

    it("cannot replay a used signature", async () => {
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, E("1")));
      await vault.topUp(NATIVE, owner.address, E("1"), s.deadline, s.pubkey, s.signature);
      await expect(
        vault.connect(thief).topUp(NATIVE, owner.address, E("1"), s.deadline, s.pubkey, s.signature),
      ).to.be.revertedWithCustomError(vault, "BadSignature");
    });

    it("cannot reuse a top-up signature as a withdrawal", async () => {
      const p = enc.transfer(NATIVE, owner.address, E("1"));
      const s = await sign(vault, mock, home, Action.TopUp, p);
      await expect(vault.connect(thief).queue(Action.Withdraw, p, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "BadSignature",
      );
    });

    it("cannot queue a withdrawal or rotate the Home Key", async () => {
      const w = enc.transfer(NATIVE, thief.address, E("100"));
      let s = await sign(vault, mock, thiefPq, Action.Withdraw, w);
      await expect(vault.connect(thief).queue(Action.Withdraw, w, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "WrongHomeKey",
      );
      const r = enc.key(keyHash(thiefPq));
      s = await sign(vault, mock, thiefPq, Action.RotateHomeKey, r);
      await expect(
        vault.connect(thief).queue(Action.RotateHomeKey, r, s.deadline, s.pubkey, s.signature),
      ).to.be.revertedWithCustomError(vault, "WrongHomeKey");
    });

    it("cannot unfreeze after a guardian freezes", async () => {
      await vault.connect(guardian).freeze();
      const s = await sign(vault, mock, thiefPq, Action.Unfreeze, "0x");
      await expect(vault.connect(thief).unfreeze(s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "WrongHomeKey",
      );
    });

    it("leaves the vault untouched after every attempt", async () => {
      const before = await ethers.provider.getBalance(await vault.getAddress());
      const s = await sign(vault, mock, thiefPq, Action.TopUp, enc.transfer(NATIVE, thief.address, E("5")));
      await vault.connect(thief).topUp(NATIVE, thief.address, E("5"), s.deadline, s.pubkey, s.signature).catch(() => {});
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(before);
    });
  });

  // ------------------------------------------------------- length checks
  describe("input validation", () => {
    it("refuses a public key of the wrong length", async () => {
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, 1n));
      await expect(
        vault.topUp(NATIVE, owner.address, 1n, s.deadline, s.pubkey.slice(1), s.signature),
      ).to.be.revertedWithCustomError(vault, "BadLength");
    });

    it("refuses a signature of the wrong length", async () => {
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, 1n));
      await expect(
        vault.topUp(NATIVE, owner.address, 1n, s.deadline, s.pubkey, s.signature.slice(1)),
      ).to.be.revertedWithCustomError(vault, "BadLength");
    });

    it("fails closed when the precompile is not active", async () => {
      await setLimitNow(NATIVE, E("1"));
      const s = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, owner.address, 1n));
      await removePqcPrecompile();
      await expect(vault.topUp(NATIVE, owner.address, 1n, s.deadline, s.pubkey, s.signature)).to.be.reverted;
    });
  });

  // ------------------------------------------------- delayed withdrawals
  describe("queue and execute (delayed withdrawals)", () => {
    it("queues a withdrawal with readyAt = now + delay", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("50"));
      const q = await vault.queued(id);
      expect(q.status).to.equal(1n); // Pending
      expect(q.readyAt).to.equal(BigInt(await now()) + 24n * BigInt(HOUR));
    });

    it("emits Queued_ with the payload and nonce", async () => {
      const p = enc.transfer(NATIVE, owner.address, E("1"));
      const n = await vault.nonce();
      const s = await sign(vault, mock, home, Action.Withdraw, p);
      await expect(vault.queue(Action.Withdraw, p, s.deadline, s.pubkey, s.signature)).to.emit(vault, "Queued_");
      expect(await vault.nonce()).to.equal(n + 1n);
    });

    it("refuses to execute before the delay", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("50"));
      await increase(24 * HOUR - 60);
      await expect(vault.execute(id)).to.be.revertedWithCustomError(vault, "NotReady");
    });

    it("executes after the delay, by anyone", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("50"));
      await increase(24 * HOUR);
      await expect(vault.connect(stranger).execute(id)).to.changeEtherBalances([vault, owner], [-E("50"), E("50")]);
      expect((await vault.queued(id)).status).to.equal(2n); // Executed
    });

    it("executes token withdrawals", async () => {
      const t = await token.getAddress();
      const id = await queueWithdraw(t, owner.address, E("300"));
      await increase(24 * HOUR);
      await vault.execute(id);
      expect(await token.balanceOf(owner.address)).to.equal(E("300"));
    });

    it("cannot execute twice", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("1"));
      await increase(24 * HOUR);
      await vault.execute(id);
      await expect(vault.execute(id)).to.be.revertedWithCustomError(vault, "NotPending");
    });

    it("cannot execute while frozen", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("1"));
      await vault.connect(guardian).freeze();
      await increase(24 * HOUR);
      await expect(vault.execute(id)).to.be.revertedWithCustomError(vault, "IsFrozen");
    });

    it("refuses TopUp, Cancel and Unfreeze through the queue", async () => {
      for (const a of [Action.TopUp, Action.Cancel, Action.Unfreeze]) {
        const p = a === Action.TopUp ? enc.transfer(NATIVE, owner.address, 1n) : a === Action.Cancel ? enc.id(0) : "0x";
        const s = await sign(vault, mock, home, a, p);
        await expect(vault.queue(a, p, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(vault, "UnknownAction");
      }
    });

    it("refuses a withdrawal to the zero address at queue time", async () => {
      const p = enc.transfer(NATIVE, ethers.ZeroAddress, 1n);
      const s = await sign(vault, mock, home, Action.Withdraw, p);
      await expect(vault.queue(Action.Withdraw, p, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "TransferFailed",
      );
    });

    it("stays pending when the recipient rejects funds", async () => {
      const R = await ethers.getContractFactory("RejectingReceiver");
      const r = await R.deploy();
      const id = await queueWithdraw(NATIVE, await r.getAddress(), E("1"));
      await increase(24 * HOUR);
      await expect(vault.execute(id)).to.be.revertedWithCustomError(vault, "TransferFailed");
      expect((await vault.queued(id)).status).to.equal(1n);
    });

    it("blocks re-entry during a native transfer", async () => {
      const R = await ethers.getContractFactory("ReentrantReceiver");
      const r = await R.deploy();
      const id = await queueWithdraw(NATIVE, await r.getAddress(), E("1"));
      await r.arm(await vault.getAddress(), id);
      await increase(24 * HOUR);
      await vault.execute(id);
      expect(await r.attempted()).to.equal(true);
      expect(await r.reentered()).to.equal(false);
      expect(await ethers.provider.getBalance(await r.getAddress())).to.equal(E("1"));
    });
  });

  // --------------------------------------------------------- cancelling
  describe("cancel (the guardian's veto)", () => {
    it("any guardian can cancel a pending withdrawal", async () => {
      const id = await queueWithdraw(NATIVE, thief.address, E("90"));
      await expect(vault.connect(guardian2).cancel(id)).to.emit(vault, "Cancelled").withArgs(id, guardian2.address);
      await increase(24 * HOUR);
      await expect(vault.execute(id)).to.be.revertedWithCustomError(vault, "NotPending");
    });

    it("a non-guardian cannot cancel", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("1"));
      await expect(vault.connect(stranger).cancel(id)).to.be.revertedWithCustomError(vault, "NotGuardian");
    });

    it("the Home Key can cancel", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("1"));
      const s = await sign(vault, mock, home, Action.Cancel, enc.id(id));
      await expect(vault.connect(stranger).cancelWithHomeKey(id, s.deadline, s.pubkey, s.signature))
        .to.emit(vault, "Cancelled")
        .withArgs(id, ethers.ZeroAddress);
    });

    it("a seed-derived key cannot cancel", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("1"));
      const s = await sign(vault, mock, thiefPq, Action.Cancel, enc.id(id));
      await expect(vault.cancelWithHomeKey(id, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "WrongHomeKey",
      );
    });

    it("cannot cancel an executed action", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("1"));
      await increase(24 * HOUR);
      await vault.execute(id);
      await expect(vault.connect(guardian).cancel(id)).to.be.revertedWithCustomError(vault, "NotPending");
    });

    it("cannot cancel twice", async () => {
      const id = await queueWithdraw(NATIVE, owner.address, E("1"));
      await vault.connect(guardian).cancel(id);
      await expect(vault.connect(guardian2).cancel(id)).to.be.revertedWithCustomError(vault, "NotPending");
    });

    it("a coerced withdrawal can be stopped inside the delay (wrench scenario)", async () => {
      // The owner is forced to sign with the Home Key. A guardian sees the alert and cancels.
      const id = await queueWithdraw(NATIVE, thief.address, E("100"));
      await increase(3 * HOUR);
      await vault.connect(guardian).cancel(id);
      await increase(24 * HOUR);
      await expect(vault.execute(id)).to.be.revertedWithCustomError(vault, "NotPending");
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(E("100"));
    });
  });

  // --------------------------------------------------------- freezing
  describe("freeze and unfreeze", () => {
    it("a guardian can freeze", async () => {
      await expect(vault.connect(guardian).freeze()).to.emit(vault, "Frozen").withArgs(guardian.address);
      expect(await vault.frozen()).to.equal(true);
    });

    it("a non-guardian cannot freeze", async () => {
      await expect(vault.connect(stranger).freeze()).to.be.revertedWithCustomError(vault, "NotGuardian");
    });

    it("only the Home Key can unfreeze", async () => {
      await vault.connect(guardian).freeze();
      const s = await sign(vault, mock, home, Action.Unfreeze, "0x");
      await expect(vault.connect(stranger).unfreeze(s.deadline, s.pubkey, s.signature)).to.emit(vault, "Unfrozen");
      expect(await vault.frozen()).to.equal(false);
    });

    it("a guardian has no path to unfreeze or move funds", async () => {
      const g = vault.connect(guardian);
      expect(g.unfreeze).to.be.a("function");
      await vault.connect(guardian).freeze();
      const s = await sign(vault, mock, thiefPq, Action.Unfreeze, "0x");
      await expect(g.unfreeze(s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(vault, "WrongHomeKey");
    });

    it("queuing still works while frozen, so recovery can be prepared", async () => {
      await vault.connect(guardian).freeze();
      const id = await queueWithdraw(NATIVE, owner.address, E("1"));
      expect((await vault.queued(id)).status).to.equal(1n);
    });
  });

  // ----------------------------------------------------- configuration
  describe("rule changes (delayed)", () => {
    it("sets a daily limit after the delay", async () => {
      await setLimitNow(NATIVE, E("7"));
      expect(await vault.dailyLimit(NATIVE)).to.equal(E("7"));
    });

    it("adds and removes a guardian", async () => {
      let p = enc.guardian(stranger.address, true);
      let s = await sign(vault, mock, home, Action.SetGuardian, p);
      await vault.queue(Action.SetGuardian, p, s.deadline, s.pubkey, s.signature);
      await increase(24 * HOUR);
      await vault.execute((await vault.queueLength()) - 1n);
      expect(await vault.isGuardian(stranger.address)).to.equal(true);
      expect(await vault.guardianCount()).to.equal(3n);

      p = enc.guardian(stranger.address, false);
      s = await sign(vault, mock, home, Action.SetGuardian, p);
      await vault.queue(Action.SetGuardian, p, s.deadline, s.pubkey, s.signature);
      await increase(24 * HOUR);
      await vault.execute((await vault.queueLength()) - 1n);
      expect(await vault.isGuardian(stranger.address)).to.equal(false);
      expect(await vault.guardianCount()).to.equal(2n);
    });

    it("starts with the pocket given at deployment", async () => {
      expect(await vault.pocket()).to.equal(owner.address);
    });

    it("refuses a zero pocket at deployment", async () => {
      const Vault = await ethers.getContractFactory("SeedproofVault");
      await expect(Vault.deploy(keyHash(home), ethers.ZeroAddress, DAY, [], [], [])).to.be.revertedWithCustomError(vault, "NotPocket");
    });

    it("moves the pocket only after the delay, and top-ups follow it", async () => {
      await setLimitNow(NATIVE, E("5"));
      const p = enc.pocket(stranger.address);
      const s = await sign(vault, mock, home, Action.SetPocket, p);
      await expect(vault.queue(Action.SetPocket, p, s.deadline, s.pubkey, s.signature)).to.emit(vault, "Queued_");
      const id = (await vault.queueLength()) - 1n;
      await expect(vault.execute(id)).to.be.revertedWithCustomError(vault, "NotReady");
      expect(await vault.pocket()).to.equal(owner.address);
      await increase(24 * HOUR);
      await expect(vault.execute(id)).to.emit(vault, "PocketSet").withArgs(stranger.address);
      const t = await sign(vault, mock, home, Action.TopUp, enc.transfer(NATIVE, stranger.address, E("1")));
      await expect(vault.topUp(NATIVE, stranger.address, E("1"), t.deadline, t.pubkey, t.signature)).to.changeEtherBalance(stranger, E("1"));
    });

    it("lets a guardian cancel a pocket change (stolen Home Key)", async () => {
      const p = enc.pocket(thief.address);
      const s = await sign(vault, mock, home, Action.SetPocket, p);
      await vault.queue(Action.SetPocket, p, s.deadline, s.pubkey, s.signature);
      const id = (await vault.queueLength()) - 1n;
      await vault.connect(guardian).cancel(id);
      await increase(24 * HOUR);
      await expect(vault.execute(id)).to.be.revertedWithCustomError(vault, "NotPending");
      expect(await vault.pocket()).to.equal(owner.address);
    });

    it("refuses a zero pocket at queue time", async () => {
      const p = enc.pocket(ethers.ZeroAddress);
      const s = await sign(vault, mock, home, Action.SetPocket, p);
      await expect(vault.queue(Action.SetPocket, p, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(vault, "NotPocket");
    });

    it("refuses a zero-address guardian at queue time", async () => {
      const p = enc.guardian(ethers.ZeroAddress, true);
      const s = await sign(vault, mock, home, Action.SetGuardian, p);
      await expect(vault.queue(Action.SetGuardian, p, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "BadGuardian",
      );
    });

    it("changes the delay within bounds", async () => {
      const p = enc.delay(2 * DAY);
      const s = await sign(vault, mock, home, Action.SetDelay, p);
      await vault.queue(Action.SetDelay, p, s.deadline, s.pubkey, s.signature);
      await increase(24 * HOUR);
      await vault.execute((await vault.queueLength()) - 1n);
      expect(await vault.delay()).to.equal(BigInt(2 * DAY));
    });

    it("refuses a delay out of bounds at queue time", async () => {
      for (const d of [HOUR - 1, 30 * DAY + 1]) {
        const p = enc.delay(d);
        const s = await sign(vault, mock, home, Action.SetDelay, p);
        await expect(vault.queue(Action.SetDelay, p, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
          vault,
          "BadDelay",
        );
      }
    });

    it("rotates the Home Key: old key stops, new key works", async () => {
      const next = newKey();
      const p = enc.key(keyHash(next));
      const s = await sign(vault, mock, home, Action.RotateHomeKey, p);
      await vault.queue(Action.RotateHomeKey, p, s.deadline, s.pubkey, s.signature);
      await increase(24 * HOUR);
      await vault.execute((await vault.queueLength()) - 1n);
      expect(await vault.homeKeyHash()).to.equal(keyHash(next));

      const w = enc.transfer(NATIVE, owner.address, 1n);
      const old = await sign(vault, mock, home, Action.Withdraw, w);
      await expect(vault.queue(Action.Withdraw, w, old.deadline, old.pubkey, old.signature)).to.be.revertedWithCustomError(
        vault,
        "WrongHomeKey",
      );
      const fresh = await sign(vault, mock, next, Action.Withdraw, w);
      await expect(vault.queue(Action.Withdraw, w, fresh.deadline, fresh.pubkey, fresh.signature)).to.not.be.reverted;
    });

    it("refuses rotating to a zero hash", async () => {
      const p = enc.key(ethers.ZeroHash);
      const s = await sign(vault, mock, home, Action.RotateHomeKey, p);
      await expect(vault.queue(Action.RotateHomeKey, p, s.deadline, s.pubkey, s.signature)).to.be.revertedWithCustomError(
        vault,
        "WrongHomeKey",
      );
    });

    it("a guardian can veto a key rotation", async () => {
      const p = enc.key(keyHash(newKey()));
      const s = await sign(vault, mock, home, Action.RotateHomeKey, p);
      await vault.queue(Action.RotateHomeKey, p, s.deadline, s.pubkey, s.signature);
      const id = (await vault.queueLength()) - 1n;
      await vault.connect(guardian).cancel(id);
      await increase(24 * HOUR);
      await expect(vault.execute(id)).to.be.revertedWithCustomError(vault, "NotPending");
      expect(await vault.homeKeyHash()).to.equal(keyHash(home));
    });
  });
});
