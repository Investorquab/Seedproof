/**
 * Property tests: long random sequences of real vault actions (signed with real ML-DSA-87
 * keys), checked after every step against a small model of what the vault promises.
 *
 * Hardhat has no built-in fuzzer, so this is a seeded random walk. Each run prints its seed;
 * replay a failure with PROPERTY_SEED=<seed> npx hardhat test test/properties.test.ts.
 * PROPERTY_RUNS and PROPERTY_STEPS scale it up (defaults 6 runs x 45 steps).
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Action, HOUR, NATIVE, enc, increase, installPqcDouble, keyHash, newKey, now, sign } from "./helpers";

const E = (v: string) => ethers.parseEther(v);

const DAY = 24 * HOUR;
const RUNS = Number(process.env.PROPERTY_RUNS ?? 6);
const STEPS = Number(process.env.PROPERTY_STEPS ?? 45);
const LIMIT = E("5");
const DELAY = 6 * HOUR;

/** mulberry32: small, seedable, good enough to pick actions. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pending {
  id: bigint;
  amount: bigint;
  to: string;
  readyAt: number;
}

async function succeeds(p: Promise<unknown>): Promise<boolean> {
  try {
    const tx = (await p) as { wait?: () => Promise<unknown> };
    if (tx && typeof tx.wait === "function") await tx.wait();
    return true;
  } catch {
    return false;
  }
}

describe("SeedproofVault properties (seeded random walk)", function () {
  this.timeout(600_000);
  const base = process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : 20261117;

  for (let run = 0; run < RUNS; run++) {
    const seed = base + run;
    it(`holds every invariant over ${STEPS} random steps (seed ${seed})`, async () => {
      const r = rng(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
      const amount = (max: bigint) => (max * BigInt(Math.floor(r() * 1000) + 1)) / 1000n;

      const [pocket, guardian, thief, stranger] = (await ethers.getSigners()) as HardhatEthersSigner[];
      const home = newKey();
      const seedKey = newKey(); // what a thief derives from the stolen 24 words
      const mock = await installPqcDouble();
      const Vault = await ethers.getContractFactory("SeedproofVault");
      const vault = await Vault.deploy(keyHash(home), pocket.address, DELAY, [guardian.address], [NATIVE], [LIMIT]);
      const vaultAddr = await vault.getAddress();
      await pocket.sendTransaction({ to: vaultAddr, value: E("60") });

      // The model: what the vault should hold and owe after every step.
      let balance = E("60");
      let nonce = 0n;
      let frozen = false;
      const spent = new Map<number, bigint>();
      const pending: Pending[] = [];
      let lastUsed: { action: Action; payload: string; s: Awaited<ReturnType<typeof sign>> } | null = null;
      const log: string[] = [];
      const hits: Record<string, number> = {};

      const day = async () => Math.floor((await now()) / DAY);

      for (let step = 0; step < STEPS; step++) {
        const op = pick([
          "topUp",
          "topUp",
          "topUpOverCap",
          "thiefSeedKey",
          "thiefRedirect",
          "queueWithdraw",
          "queueWithdraw",
          "execute",
          "execute",
          "guardianCancel",
          "homeCancel",
          "replay",
          "thiefGuardianPowers",
          "freeze",
          "unfreeze",
          "time",
          "time",
        ] as const);
        log.push(op);

        if (op === "topUp" || op === "topUpOverCap") {
          const d = await day();
          const used = spent.get(d) ?? 0n;
          const left = LIMIT - used;
          const amt = op === "topUp" ? (left > 0n ? amount(left) : 1n) : left + amount(E("2"));
          const p = enc.transfer(NATIVE, pocket.address, amt);
          const s = await sign(vault, mock, home, Action.TopUp, p);
          // Re-read the day: signing advances no time, but be exact.
          const ok = await succeeds(vault.connect(pick([pocket, stranger, thief])).topUp(NATIVE, pocket.address, amt, s.deadline, s.pubkey, s.signature));
          const expected = !frozen && amt <= left && amt <= balance;
          expect(ok, `step ${step} ${op} amt=${amt} left=${left} frozen=${frozen}`).to.equal(expected);
          if (ok) {
            hits.topUpOk = (hits.topUpOk ?? 0) + 1;
            balance -= amt;
            nonce++;
            spent.set(d, used + amt);
            lastUsed = { action: Action.TopUp, payload: p, s };
          }
        } else if (op === "thiefSeedKey") {
          // Thief signs with the key from the 24 words: never accepted, whatever the target.
          const to = pick([pocket.address, thief.address]);
          const p = enc.transfer(NATIVE, to, 1n);
          const s = await sign(vault, mock, seedKey, Action.TopUp, p);
          expect(await succeeds(vault.connect(thief).topUp(NATIVE, to, 1n, s.deadline, s.pubkey, s.signature))).to.equal(false);
          const w = enc.transfer(NATIVE, thief.address, 1n);
          const sw = await sign(vault, mock, seedKey, Action.Withdraw, w);
          expect(await succeeds(vault.connect(thief).queue(Action.Withdraw, w, sw.deadline, sw.pubkey, sw.signature))).to.equal(false);
        } else if (op === "thiefRedirect") {
          // Even a genuine Home Key signature cannot make a top-up pay anyone but the pocket.
          const p = enc.transfer(NATIVE, thief.address, 1n);
          const s = await sign(vault, mock, home, Action.TopUp, p);
          expect(await succeeds(vault.connect(thief).topUp(NATIVE, thief.address, 1n, s.deadline, s.pubkey, s.signature))).to.equal(false);
        } else if (op === "queueWithdraw") {
          const to = pick([pocket.address, stranger.address]);
          const amt = amount(E("4"));
          const p = enc.transfer(NATIVE, to, amt);
          const s = await sign(vault, mock, home, Action.Withdraw, p);
          const ok = await succeeds(vault.connect(pick([pocket, stranger])).queue(Action.Withdraw, p, s.deadline, s.pubkey, s.signature));
          expect(ok, `step ${step} queue`).to.equal(true);
          nonce++;
          pending.push({ id: (await vault.queueLength()) - 1n, amount: amt, to, readyAt: (await now()) + DELAY });
          lastUsed = { action: Action.Withdraw, payload: p, s };
        } else if (op === "execute") {
          if (pending.length === 0) continue;
          const q = pick(pending);
          const ready = (await now()) + 1 >= q.readyAt; // the next block is at least 1 s later
          const ok = await succeeds(vault.connect(pick([pocket, stranger, thief])).execute(q.id));
          const expected = !frozen && ready && q.amount <= balance;
          if (ok !== expected) {
            // readyAt is exact on chain; re-derive from the contract before failing.
            const onchain = await vault.queued(q.id);
            expect(ok, `step ${step} execute id=${q.id} readyAt=${onchain.readyAt} frozen=${frozen}`).to.equal(expected);
          }
          if (ok) {
            hits.executeOk = (hits.executeOk ?? 0) + 1;
            balance -= q.amount;
            pending.splice(pending.indexOf(q), 1);
          }
        } else if (op === "guardianCancel" || op === "homeCancel") {
          if (pending.length === 0) continue;
          const q = pick(pending);
          let ok: boolean;
          if (op === "guardianCancel") ok = await succeeds(vault.connect(guardian).cancel(q.id));
          else {
            const s = await sign(vault, mock, home, Action.Cancel, enc.id(q.id));
            ok = await succeeds(vault.connect(pick([pocket, stranger])).cancelWithHomeKey(q.id, s.deadline, s.pubkey, s.signature));
            if (ok) nonce++;
          }
          expect(ok, `step ${step} ${op}`).to.equal(true);
          hits.cancelOk = (hits.cancelOk ?? 0) + 1;
          pending.splice(pending.indexOf(q), 1);
        } else if (op === "replay") {
          if (!lastUsed) continue;
          const { action, payload, s } = lastUsed;
          const ok =
            action === Action.TopUp
              ? await succeeds(vault.connect(thief).topUp(NATIVE, pocket.address, ethers.AbiCoder.defaultAbiCoder().decode(["address", "address", "uint256"], payload)[2], s.deadline, s.pubkey, s.signature))
              : await succeeds(vault.connect(thief).queue(action, payload, s.deadline, s.pubkey, s.signature));
          expect(ok, `step ${step} replay`).to.equal(false);
        } else if (op === "thiefGuardianPowers") {
          expect(await succeeds(vault.connect(thief).freeze())).to.equal(false);
          if (pending.length) expect(await succeeds(vault.connect(thief).cancel(pick(pending).id))).to.equal(false);
        } else if (op === "freeze") {
          expect(await succeeds(vault.connect(guardian).freeze())).to.equal(true);
          frozen = true;
        } else if (op === "unfreeze") {
          const s = await sign(vault, mock, home, Action.Unfreeze, "0x");
          const ok = await succeeds(vault.connect(pick([pocket, stranger])).unfreeze(s.deadline, s.pubkey, s.signature));
          expect(ok, `step ${step} unfreeze`).to.equal(true);
          nonce++;
          frozen = false;
        } else if (op === "time") {
          await increase(Math.floor(r() * 10 * HOUR));
        }

        // ---- invariants, after every step ----
        expect(await ethers.provider.getBalance(vaultAddr), `balance after step ${step} (${log.join(",")})`).to.equal(balance);
        expect(await vault.nonce(), `nonce after step ${step}`).to.equal(nonce);
        expect(await vault.frozen()).to.equal(frozen);
        expect(await vault.pocket()).to.equal(pocket.address);
        expect(await vault.homeKeyHash()).to.equal(keyHash(home));
        const today = await day();
        expect(await vault.spentOnDay(NATIVE, today)).to.be.lte(LIMIT);
        expect(await vault.spentOnDay(NATIVE, today)).to.equal(spent.get(today) ?? 0n);
      }
      if (process.env.PROPERTY_STATS) console.log(`      seed ${seed}:`, JSON.stringify(hits));
    });
  }
});
