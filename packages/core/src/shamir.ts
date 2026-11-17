/**
 * Shamir secret sharing over GF(256) (AES field, polynomial x^8+x^4+x^3+x+1).
 * Any `threshold` shares rebuild the secret; fewer reveal nothing about it.
 * Share x-coordinates are 1..n. Randomness comes from crypto.getRandomValues.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // multiply by the generator 3: x*2 xor x, reduced
    let x2 = x << 1;
    if (x2 & 0x100) x2 ^= 0x11b;
    x = x2 ^ x;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);
const div = (a: number, b: number): number => {
  if (b === 0) throw new Error("division by zero");
  return a === 0 ? 0 : EXP[(LOG[a]! + 255 - LOG[b]!) % 255]!;
};

export interface Share {
  /** x-coordinate, 1..255 */
  x: number;
  y: Uint8Array;
}

export function split(secret: Uint8Array, threshold: number, total: number, random: (n: number) => Uint8Array = rand): Share[] {
  if (!(Number.isInteger(threshold) && Number.isInteger(total))) throw new Error("threshold and total must be integers");
  if (threshold < 2) throw new Error("threshold must be at least 2");
  if (total < threshold || total > 255) throw new Error("total must be between threshold and 255");
  if (secret.length === 0) throw new Error("empty secret");

  const shares: Share[] = Array.from({ length: total }, (_, i) => ({ x: i + 1, y: new Uint8Array(secret.length) }));
  for (let b = 0; b < secret.length; b++) {
    // coefficients: a0 = secret byte, a1..a(k-1) random
    const coeffs = new Uint8Array(threshold);
    coeffs[0] = secret[b]!;
    coeffs.set(random(threshold - 1), 1);
    for (const s of shares) {
      // Horner's rule
      let y = 0;
      for (let c = threshold - 1; c >= 0; c--) y = mul(y, s.x) ^ coeffs[c]!;
      s.y[b] = y;
    }
  }
  return shares;
}

export function combine(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error("need at least 2 shares");
  const len = shares[0]!.y.length;
  const xs = new Set<number>();
  for (const s of shares) {
    if (s.y.length !== len) throw new Error("shares have different lengths");
    if (s.x < 1 || s.x > 255 || xs.has(s.x)) throw new Error("duplicate or invalid share index");
    xs.add(s.x);
  }
  const out = new Uint8Array(len);
  for (let b = 0; b < len; b++) {
    // Lagrange interpolation at x = 0
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = mul(num, shares[j]!.x);
        den = mul(den, shares[i]!.x ^ shares[j]!.x);
      }
      acc ^= mul(shares[i]!.y[b]!, div(num, den));
    }
    out[b] = acc;
  }
  return out;
}

function rand(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
