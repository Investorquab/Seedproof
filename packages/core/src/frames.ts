/**
 * Multi-frame transport between the phone and the Home Key.
 *
 * A single QR code holds at most 2,953 bytes, and an ML-DSA-87 signature alone
 * is 4,627 bytes. So every message is split into numbered frames that play as
 * an animated QR code (or are copied as text). Frames can arrive in any order
 * and repeat; the collector finishes once it has all of them and the checksum
 * of the joined text matches.
 *
 *   SP1/<id>/<index>/<total>/<payload slice>
 *
 * <id> is the first 12 hex chars of sha256(full text): it ties frames to one
 * message and doubles as the integrity check.
 */
import { sha256Hex } from "@qorechain/sdk";

export const FRAME_PREFIX = "SP1";
export const DEFAULT_FRAME_CHARS = 900;

const enc = new TextEncoder();

function messageId(text: string): string {
  return sha256Hex(enc.encode(text)).replace(/^0x/, "").slice(0, 12);
}

export function encodeFrames(message: unknown, frameChars: number = DEFAULT_FRAME_CHARS): string[] {
  if (frameChars < 64) throw new Error("frameChars too small");
  const text = JSON.stringify(message);
  const id = messageId(text);
  const total = Math.max(1, Math.ceil(text.length / frameChars));
  const frames: string[] = [];
  for (let i = 0; i < total; i++) {
    frames.push(`${FRAME_PREFIX}/${id}/${i + 1}/${total}/${text.slice(i * frameChars, (i + 1) * frameChars)}`);
  }
  return frames;
}

export type FrameResult =
  | { status: "ignored"; reason: string }
  | { status: "progress"; have: number; total: number }
  | { status: "complete"; message: unknown };

export class FrameCollector {
  private id: string | null = null;
  private total = 0;
  private parts = new Map<number, string>();

  reset(): void {
    this.id = null;
    this.total = 0;
    this.parts.clear();
  }

  add(frame: string): FrameResult {
    const m = /^SP1\/([0-9a-f]{12})\/(\d+)\/(\d+)\/([\s\S]*)$/.exec(frame);
    if (!m) return { status: "ignored", reason: "not a Seedproof frame" };
    const [, id, idxS, totalS, data] = m as unknown as [string, string, string, string, string];
    const idx = Number(idxS);
    const total = Number(totalS);
    if (!(total >= 1 && total <= 512 && idx >= 1 && idx <= total)) {
      return { status: "ignored", reason: "bad frame numbers" };
    }
    if (this.id !== id) {
      // A new message starts: forget the old one.
      this.reset();
      this.id = id;
      this.total = total;
    } else if (this.total !== total) {
      return { status: "ignored", reason: "frame count changed" };
    }
    this.parts.set(idx, data);
    if (this.parts.size < this.total) return { status: "progress", have: this.parts.size, total: this.total };

    let text = "";
    for (let i = 1; i <= this.total; i++) text += this.parts.get(i);
    if (messageId(text) !== this.id) {
      this.reset();
      return { status: "ignored", reason: "checksum mismatch" };
    }
    this.reset();
    return { status: "complete", message: JSON.parse(text) };
  }
}
