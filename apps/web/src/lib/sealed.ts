/**
 * Passphrase-sealed secrets in this browser's storage.
 * PBKDF2-SHA256 (600,000 rounds) derives an AES-GCM key; only ciphertext,
 * salt and IV are stored. Wrong passphrase = decryption fails.
 */
const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

interface SealedBlob {
  v: 1;
  salt: string;
  iv: string;
  data: string;
}

const toB64 = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(storageKey: string, secret: string, passphrase: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode(secret));
  const blob: SealedBlob = { v: 1, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
  localStorage.setItem(storageKey, JSON.stringify(blob));
}

export async function unseal(storageKey: string, passphrase: string): Promise<string> {
  const raw = localStorage.getItem(storageKey);
  if (!raw) throw new Error("Nothing is stored on this device yet.");
  const blob = JSON.parse(raw) as SealedBlob;
  const key = await keyFrom(passphrase, fromB64(blob.salt));
  try {
    const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) as BufferSource }, key, fromB64(blob.data) as BufferSource);
    return dec.decode(out);
  } catch {
    throw new Error("That passphrase does not open this device's key.");
  }
}

export const hasSealed = (storageKey: string) => localStorage.getItem(storageKey) !== null;
export const forget = (storageKey: string) => localStorage.removeItem(storageKey);
