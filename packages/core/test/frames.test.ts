import { describe, it, expect } from "vitest";
import { generatePqcKeypair, pqcSign } from "@qorechain/sdk";
import { encodeFrames, FrameCollector, b64 } from "../src/index.js";

const sample = () => {
  const k = generatePqcKeypair();
  return { kind: "seedproof/approval-response", pqcSignature: b64.enc(pqcSign(k.secretKey, new Uint8Array([1, 2, 3]))) };
};

describe("multi-frame transport", () => {
  it("splits a signature into several frames and joins them back", () => {
    const msg = sample();
    const frames = encodeFrames(msg);
    expect(frames.length).toBeGreaterThan(1);
    const c = new FrameCollector();
    let last;
    for (const f of frames) last = c.add(f);
    expect(last).toEqual({ status: "complete", message: msg });
  });

  it("accepts frames out of order and repeated", () => {
    const msg = sample();
    const frames = encodeFrames(msg, 700);
    const c = new FrameCollector();
    const shuffled = [...frames].reverse();
    c.add(shuffled[0]!);
    c.add(shuffled[0]!);
    let last;
    for (const f of shuffled.slice(1)) last = c.add(f);
    expect(last).toEqual({ status: "complete", message: msg });
  });

  it("reports progress while frames are missing", () => {
    const frames = encodeFrames(sample(), 700);
    const c = new FrameCollector();
    expect(c.add(frames[0]!)).toEqual({ status: "progress", have: 1, total: frames.length });
  });

  it("rejects a tampered frame by checksum", () => {
    const frames = encodeFrames(sample(), 700);
    const c = new FrameCollector();
    const bad = frames.map((f, i) => (i === 1 ? f.slice(0, -4) + "AAAA" : f));
    let last;
    for (const f of bad) last = c.add(f);
    expect(last).toMatchObject({ status: "ignored", reason: "checksum mismatch" });
  });

  it("ignores text that is not a Seedproof frame", () => {
    expect(new FrameCollector().add("https://example.com")).toMatchObject({ status: "ignored" });
  });

  it("starts over when frames of a new message arrive", () => {
    const a = encodeFrames(sample(), 700);
    const b = encodeFrames({ x: 1 }, 700);
    const c = new FrameCollector();
    c.add(a[0]!);
    expect(c.add(b[0]!)).toEqual({ status: "complete", message: { x: 1 } });
  });

  it("keeps a single-frame message in one frame", () => {
    expect(encodeFrames({ hello: "world" })).toHaveLength(1);
  });
});
