import { useState } from "react";
import { checkExposure } from "@seedproof/core";
import { isValidBech32, validateMnemonic } from "@qorechain/sdk";
import { registeredPqcKey } from "../lib/chain";

type Result =
  | { kind: "one"; text: string }
  | { kind: "two"; text: string }
  | { kind: "none"; text: string }
  | { kind: "error"; text: string };

function parseSecret(raw: string): { mnemonic?: string; privateKey?: Uint8Array } | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const hex = s.replace(/^0x/, "");
  if (/^[0-9a-f]{64}$/.test(hex)) {
    return { privateKey: Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))) };
  }
  if (validateMnemonic(s)) return { mnemonic: s };
  return null;
}

/** Runs entirely in the browser. The secret is never sent anywhere. */
export function ExposureCheck() {
  const [address, setAddress] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    const addr = address.trim();
    if (!addr.startsWith("qor1") || !isValidBech32(addr)) {
      setResult({ kind: "error", text: "Enter the account's qor1 address." });
      return;
    }
    const parsed = parseSecret(secret);
    if (!parsed) {
      setResult({ kind: "error", text: "Enter a valid 12 or 24 word recovery phrase, or a 64 character private key." });
      return;
    }
    setBusy(true);
    try {
      const key = await registeredPqcKey(addr);
      if (!key) {
        setResult({
          kind: "none",
          text: "This account has no post-quantum key on chain yet. Whoever holds its classical key can register one first and lock the owner out.",
        });
        return;
      }
      const v = checkExposure({ address: addr, registeredPqcPublicKey: key, ...parsed });
      setResult(v.verdict === "ONE_SECRET" ? { kind: "one", text: v.explain } : { kind: "two", text: v.explain });
    } catch {
      setResult({ kind: "error", text: "Could not reach the QoreChain testnet. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="check">
      <h2 id="check-title" className="display display-l">One secret or two?</h2>
      <p className="lede">
        Check whether your post-quantum key can be rebuilt from your recovery phrase. Use a throwaway testnet account. The
        check runs in this browser and sends nothing but the address.
      </p>
      <form className="check-form" onSubmit={run}>
        <div className="field">
          <label htmlFor="addr">Account address</label>
          <input id="addr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="qor1…" autoComplete="off" spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="secret">Recovery phrase or private key</label>
          <textarea id="secret" className="input" rows={3} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        <div className="check-actions">
          <button type="submit" className="btn btn-ink" disabled={busy}>
            {busy ? "Checking…" : "Check this account"}
          </button>
          <span className="small muted">Checks the QoreX, SDK and SDK 0.12 raw-key derivations</span>
        </div>
      </form>

      <div role="status" aria-live="polite">
        {result && (
          <div className={`notice ${result.kind === "two" ? "notice-good" : result.kind === "error" ? "notice-plain" : "notice-bad"}`}>
            <div>
              <strong>
                {result.kind === "one" && "One secret"}
                {result.kind === "two" && "Two secrets"}
                {result.kind === "none" && "No post-quantum key yet"}
                {result.kind === "error" && "Check not run"}
              </strong>
              <span>
                {result.text}
                {result.kind === "one" && " Move it to a Home Key to fix this."}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
