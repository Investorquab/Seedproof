import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  approveRequest,
  decodeRequestBody,
  encodeFrames,
  isApprovalRequest,
  type ApprovalRequest,
  type DecodedRequest,
} from "@seedproof/core";
import { generatePqcRecoveryCode, isValidBech32, pqcKeyFromRecoveryCode, sha256Hex, type PqcKeypair } from "@qorechain/sdk";
import { Logo } from "../components/Logo";
import { AnimatedQr } from "../components/AnimatedQr";
import { FrameReader } from "../components/FrameReader";
import { hasSealed, seal, unseal, forget } from "../lib/sealed";
import { NETWORK, shortAddress } from "../config";
import "./device.css";

const STORE = "seedproof.homekey.v1";

interface Stored {
  address: string;
  recoveryCode: string;
}

type Screen =
  | { name: "setup" }
  | { name: "show-code"; address: string; code: string }
  | { name: "locked" }
  | { name: "ready" }
  | { name: "review"; req: ApprovalRequest; decoded: DecodedRequest }
  | { name: "signed"; summary: string; frames: string[] }
  | { name: "refused"; why: string };

const fingerprint = (k: PqcKeypair) => sha256Hex(k.publicKey).replace(/^0x/, "").slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");

export function HomeKey() {
  const [screen, setScreen] = useState<Screen>(() => (hasSealed(STORE) ? { name: "locked" } : { name: "setup" }));
  const [key, setKey] = useState<{ address: string; pq: PqcKeypair } | null>(null);

  return (
    <div className="device device-home">
      <div className="device-col">
        <header className="device-head">
          <Link to="/" className="device-brand" aria-label="Seedproof home">
            <Logo size={24} variant="home" />
            <span>Home Key</span>
          </Link>
          {key && <span className="chip chip-home">{shortAddress(key.address)}</span>}
        </header>

        {screen.name === "setup" && <Setup onCreated={(address, code) => setScreen({ name: "show-code", address, code })} />}

        {screen.name === "show-code" && (
          <ShowCode
            address={screen.address}
            code={screen.code}
            onSealed={(pq) => {
              setKey({ address: screen.address, pq });
              setScreen({ name: "ready" });
            }}
          />
        )}

        {screen.name === "locked" && (
          <Unlock
            onUnlocked={(s) => {
              setKey({ address: s.address, pq: pqcKeyFromRecoveryCode(s.recoveryCode, s.address) });
              setScreen({ name: "ready" });
            }}
            onReset={() => {
              forget(STORE);
              setScreen({ name: "setup" });
            }}
          />
        )}

        {screen.name === "ready" && key && (
          <Ready
            pq={key.pq}
            onRequest={(msg) => {
              if (!isApprovalRequest(msg)) return setScreen({ name: "refused", why: "That is not a Seedproof request." });
              if (msg.account !== key.address)
                return setScreen({ name: "refused", why: "This request is for a different account than this Home Key protects." });
              if (msg.chainId !== NETWORK.chainId)
                return setScreen({ name: "refused", why: `This request is for ${msg.chainId}, not ${NETWORK.name}.` });
              setScreen({ name: "review", req: msg, decoded: decodeRequestBody(msg) });
            }}
          />
        )}

        {screen.name === "review" && key && (
          <Review
            req={screen.req}
            decoded={screen.decoded}
            onRefuse={() => setScreen({ name: "ready" })}
            onApprove={async () => {
              try {
                const res = await approveRequest(screen.req, key.pq, () => true);
                setScreen({
                  name: "signed",
                  summary: screen.decoded.lines.map((l) => l.text).join(". "),
                  frames: encodeFrames(res),
                });
              } catch (e) {
                setScreen({ name: "refused", why: e instanceof Error ? e.message : "The Home Key refused to sign." });
              }
            }}
          />
        )}

        {screen.name === "signed" && (
          <section className="stack">
            <div className="stack-tight">
              <h1 className="display device-title">Signed. Now show your phone.</h1>
              <p className="device-sub">{screen.summary}</p>
            </div>
            <AnimatedQr frames={screen.frames} color="#3F2E0B" label="Signature for your phone" />
            <p className="small home-note">This signature works once, for this request only. It cannot be reused for a bigger amount or another address.</p>
            <button type="button" className="btn btn-brass-outline btn-block" onClick={() => setScreen({ name: "ready" })}>
              Done
            </button>
          </section>
        )}

        {screen.name === "refused" && (
          <section className="stack">
            <div className="notice notice-bad">
              <div>
                <strong>Not signed</strong>
                <span>{screen.why}</span>
              </div>
            </div>
            <button type="button" className="btn btn-brass btn-block" onClick={() => setScreen({ name: "ready" })}>
              Back
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function Setup({ onCreated }: { onCreated: (address: string, code: string) => void }) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="stack">
      <div className="stack-tight">
        <h1 className="display device-title">Make this device your Home Key</h1>
        <p className="device-sub">
          It will hold a post-quantum key that is not made from your 24 words. Use a device that stays at home, ideally one you
          do not carry.
        </p>
      </div>
      <form
        className="stack-tight"
        onSubmit={(e) => {
          e.preventDefault();
          const a = address.trim();
          if (!a.startsWith("qor1") || !isValidBech32(a)) return setError("Enter your Pocket's qor1 address.");
          onCreated(a, generatePqcRecoveryCode());
        }}
      >
        <div className="field">
          <label htmlFor="acct">Your Pocket's address</label>
          <input id="acct" className="input input-home" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="qor1…" autoComplete="off" spellCheck={false} />
        </div>
        {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
        <button type="submit" className="btn btn-brass btn-block">
          Create Home Key
        </button>
      </form>
    </section>
  );
}

function ShowCode({ address, code, onSealed }: { address: string; code: string; onSealed: (pq: PqcKeypair) => void }) {
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [wrote, setWrote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pq = useMemo(() => pqcKeyFromRecoveryCode(code, address), [code, address]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pass.length < 10) return setError("Use a passphrase of at least 10 characters.");
    if (pass !== pass2) return setError("The two passphrases do not match.");
    setBusy(true);
    await seal(STORE, JSON.stringify({ address, recoveryCode: code } satisfies Stored), pass);
    onSealed(pq);
  };

  return (
    <section className="stack">
      <div className="stack-tight">
        <h1 className="display device-title">Write down this Home Key code</h1>
        <p className="device-sub">
          It rebuilds this Home Key if the device is lost. Keep it apart from your 24 words. Anyone with both holds both keys.
        </p>
      </div>
      <div className="code-card">
        <code className="recovery-code">{code}</code>
        <span className="tiny">Key fingerprint {fingerprint(pq)}</span>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} />
        <span>I wrote it down and keep it away from my recovery phrase</span>
      </label>
      <form className="stack-tight" onSubmit={save}>
        <div className="field">
          <label htmlFor="p1">Passphrase to open this Home Key</label>
          <input id="p1" type="password" className="input input-home" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor="p2">Same passphrase again</label>
          <input id="p2" type="password" className="input input-home" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
        <button type="submit" className="btn btn-brass btn-block" disabled={!wrote || busy}>
          {busy ? "Sealing…" : "Seal Home Key on this device"}
        </button>
      </form>
    </section>
  );
}

function Unlock({ onUnlocked, onReset }: { onUnlocked: (s: Stored) => void; onReset: () => void }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="stack">
      <h1 className="display device-title">Open your Home Key</h1>
      <form
        className="stack-tight"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onUnlocked(JSON.parse(await unseal(STORE, pass)) as Stored);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not open the Home Key.");
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="pass">Passphrase</label>
          <input id="pass" type="password" className="input input-home" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
        <button type="submit" className="btn btn-brass btn-block" disabled={!pass || busy}>
          {busy ? "Opening…" : "Open"}
        </button>
      </form>
      <button
        type="button"
        className="btn btn-ghost small"
        onClick={() => {
          if (confirm("Remove the Home Key from this device? You will need its written code to restore it.")) onReset();
        }}
      >
        Remove Home Key from this device
      </button>
    </section>
  );
}

function Ready({ pq, onRequest }: { pq: PqcKeypair; onRequest: (msg: unknown) => void }) {
  return (
    <section className="stack">
      <div className="stack-tight">
        <h1 className="display device-title">Read a request from your phone</h1>
        <p className="device-sub">Nothing is signed until you have read it here and approved it.</p>
      </div>
      <FrameReader tone="home" onMessage={onRequest} />
      <p className="tiny home-note">Key fingerprint {fingerprint(pq)}. This device holds no recovery phrase.</p>
    </section>
  );
}

function Review({
  req,
  decoded,
  onApprove,
  onRefuse,
}: {
  req: ApprovalRequest;
  decoded: DecodedRequest;
  onApprove: () => void;
  onRefuse: () => void;
}) {
  const minutes = Math.max(0, Math.round((req.expiresAt - Date.now() / 1000) / 60));
  const blocked = !decoded.understood || decoded.hasExtension || minutes <= 0;
  return (
    <section className="stack">
      <h1 className="display device-title">Your phone is asking to</h1>
      <div className="review-card">
        <ul className="review-lines">
          {decoded.lines.map((l, i) => (
            <li key={i} className={`risk-${l.risk}`}>
              <span className="review-line">{l.text}</span>
              {l.risk === "critical" && <span className="tiny review-flag">Read this one twice</span>}
            </li>
          ))}
        </ul>
        <dl className="review-meta">
          <dt>Account</dt>
          <dd>{shortAddress(req.account)}</dd>
          <dt>Expires</dt>
          <dd>{minutes > 0 ? `In ${minutes} minute${minutes === 1 ? "" : "s"}` : "Expired"}</dd>
          <dt>Network</dt>
          <dd>{NETWORK.name}</dd>
          {decoded.memo && (
            <>
              <dt>Memo</dt>
              <dd>{decoded.memo}</dd>
            </>
          )}
        </dl>
      </div>
      <p className="small home-note">
        This was read from the transaction itself, not from your phone's description of it. If it is not what you asked for, refuse
        it and close your window.
      </p>
      {blocked && (
        <div className="notice notice-bad">
          <div>
            <strong>Cannot sign this</strong>
            <span>
              {minutes <= 0
                ? "The request has expired. Make a new one on your phone."
                : "It contains something this Home Key cannot read. Refuse it."}
            </span>
          </div>
        </div>
      )}
      <div className="stack-tight">
        <button type="button" className="btn btn-brass btn-block btn-tall" onClick={onApprove} disabled={blocked}>
          Approve with Home Key
        </button>
        <button type="button" className="btn btn-brass-outline btn-block" onClick={onRefuse}>
          Refuse
        </button>
      </div>
    </section>
  );
}
