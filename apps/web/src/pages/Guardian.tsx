import { useState } from "react";
import { Link } from "react-router-dom";
import { generateSealKeys, sealKeysFromSeed, type SealKeyPair } from "@qorechain/qoreseal";
import { b64, encodeFrames, guardianCard, isGuardianEnvelope, openGuardianEnvelope, type GuardianEnvelope } from "@seedproof/core";
import { Logo } from "../components/Logo";
import { AnimatedQr } from "../components/AnimatedQr";
import { FrameReader } from "../components/FrameReader";
import { hasSealed, seal, unseal, forget } from "../lib/sealed";
import { shortAddress } from "../config";
import "./device.css";
import "./guardian.css";

const STORE = "seedproof.guardian.v1";

interface Stored {
  name: string;
  seed: string;
}

type Screen =
  | { name: "setup" }
  | { name: "locked" }
  | { name: "ready" }
  | { name: "card" }
  | { name: "open" }
  | { name: "confirm"; env: GuardianEnvelope }
  | { name: "share"; env: GuardianEnvelope; frames: string[] }
  | { name: "error"; why: string };

/**
 * A guardian keeps one sealed share of a friend's Home Key. Alone it is
 * useless. When the friend loses their Home Key, the guardian opens their share
 * in person and shows it to the friend's new device.
 */
export function Guardian() {
  const [screen, setScreen] = useState<Screen>(() => (hasSealed(STORE) ? { name: "locked" } : { name: "setup" }));
  const [me, setMe] = useState<{ name: string; keys: SealKeyPair } | null>(null);

  const go = (s: Screen) => setScreen(s);

  return (
    <div className="device device-guardian">
      <div className="device-col">
        <header className="device-head">
          <Link to="/" className="device-brand" aria-label="Seedproof home">
            <Logo size={24} />
            <span>Guardian</span>
          </Link>
          {me && <span className="chip chip-guardian">{me.name}</span>}
        </header>

        {screen.name === "setup" && (
          <GuardianSetup
            onReady={(name, keys) => {
              setMe({ name, keys });
              go({ name: "card" });
            }}
          />
        )}

        {screen.name === "locked" && (
          <GuardianUnlock
            onReady={(s) => {
              setMe({ name: s.name, keys: sealKeysFromSeed(b64.dec(s.seed)) });
              go({ name: "ready" });
            }}
            onReset={() => {
              forget(STORE);
              go({ name: "setup" });
            }}
          />
        )}

        {screen.name === "ready" && me && (
          <section className="stack">
            <div className="stack-tight">
              <h1 className="display device-title">You are a guardian</h1>
              <p className="device-sub muted">
                You keep one sealed piece of a friend's Home Key. On its own it opens nothing. If they lose their Home Key, you and
                one other guardian help them rebuild it, in person.
              </p>
            </div>
            <button type="button" className="btn btn-ink btn-block btn-tall" onClick={() => go({ name: "open" })}>
              Help a friend recover
            </button>
            <button type="button" className="btn btn-outline btn-block" onClick={() => go({ name: "card" })}>
              Show my guardian card
            </button>
          </section>
        )}

        {screen.name === "card" && me && (
          <section className="stack">
            <div className="stack-tight">
              <h1 className="display device-title">Show this to your friend's Home Key</h1>
              <p className="device-sub muted">This card holds only public keys. Their Home Key seals your piece to it.</p>
            </div>
            <AnimatedQr frames={encodeFrames(guardianCard(me.name, me.keys))} label="Guardian card" />
            <button type="button" className="btn btn-ink btn-block" onClick={() => go({ name: "ready" })}>
              Done
            </button>
          </section>
        )}

        {screen.name === "open" && me && (
          <section className="stack">
            <div className="stack-tight">
              <h1 className="display device-title">Read your sealed piece</h1>
              <p className="device-sub muted">Scan or paste the sealed piece your friend gave you when they set you up.</p>
            </div>
            <FrameReader
              onMessage={(m) => (isGuardianEnvelope(m) ? go({ name: "confirm", env: m }) : go({ name: "error", why: "That is not a sealed guardian piece." }))}
            />
            <button type="button" className="btn btn-ghost" onClick={() => go({ name: "ready" })}>
              Cancel
            </button>
          </section>
        )}

        {screen.name === "confirm" && me && (
          <section className="stack">
            <h1 className="display device-title">Is your friend in front of you?</h1>
            <div className="guardian-card-box">
              <p className="guardian-line">Help rebuild the Home Key of {shortAddress(screen.env.account)}</p>
              <p className="small muted">
                Piece {screen.env.index} of {screen.env.total}. They need {screen.env.threshold} pieces from different guardians.
              </p>
            </div>
            <p className="small">
              Only continue if you can see your friend and know they asked for this. Someone pretending to be them might ask over a
              message or a call.
            </p>
            <button
              type="button"
              className="btn btn-ink btn-block btn-tall"
              onClick={() => {
                try {
                  const share = openGuardianEnvelope(screen.env, me.keys);
                  go({ name: "share", env: screen.env, frames: encodeFrames(share) });
                } catch {
                  go({ name: "error", why: "This piece was not sealed to you, or it was changed. Ask your friend which guardian it belongs to." });
                }
              }}
            >
              They are here. Open my piece
            </button>
            <button type="button" className="btn btn-outline btn-block" onClick={() => go({ name: "ready" })}>
              Not now
            </button>
          </section>
        )}

        {screen.name === "share" && (
          <section className="stack">
            <div className="stack-tight">
              <h1 className="display device-title">Show this to their new Home Key</h1>
              <p className="device-sub muted">Close this screen once they have scanned it.</p>
            </div>
            <AnimatedQr frames={screen.frames} label="Guardian piece" />
            <button type="button" className="btn btn-ink btn-block" onClick={() => go({ name: "ready" })}>
              Done, close it
            </button>
          </section>
        )}

        {screen.name === "error" && (
          <section className="stack">
            <div className="notice notice-bad">
              <div>
                <strong>Could not open</strong>
                <span>{screen.why}</span>
              </div>
            </div>
            <button type="button" className="btn btn-ink btn-block" onClick={() => go({ name: me ? "ready" : "setup" })}>
              Back
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function GuardianSetup({ onReady }: { onReady: (name: string, keys: SealKeyPair) => void }) {
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="stack">
      <div className="stack-tight">
        <h1 className="display device-title">Become someone's guardian</h1>
        <p className="device-sub muted">
          A friend asked you to keep one piece of their Home Key. This device makes your guardian keys. You never see their money
          and cannot move it.
        </p>
      </div>
      <form
        className="stack-tight"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Enter the name your friend knows you by.");
          if (pass.length < 10) return setError("Use a passphrase of at least 10 characters.");
          setBusy(true);
          const keys = generateSealKeys();
          await seal(STORE, JSON.stringify({ name: name.trim(), seed: b64.enc(keys.seed) } satisfies Stored), pass);
          onReady(name.trim(), keys);
        }}
      >
        <div className="field">
          <label htmlFor="gname">Your name</label>
          <input id="gname" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="gpass">Passphrase for this device</label>
          <input id="gpass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
        <button type="submit" className="btn btn-ink btn-block" disabled={busy}>
          {busy ? "Making keys…" : "Make my guardian keys"}
        </button>
      </form>
    </section>
  );
}

function GuardianUnlock({ onReady, onReset }: { onReady: (s: Stored) => void; onReset: () => void }) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="stack">
      <h1 className="display device-title">Open your guardian keys</h1>
      <form
        className="stack-tight"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            onReady(JSON.parse(await unseal(STORE, pass)) as Stored);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not open.");
          }
        }}
      >
        <div className="field">
          <label htmlFor="gp">Passphrase</label>
          <input id="gp" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
        <button type="submit" className="btn btn-ink btn-block" disabled={!pass}>
          Open
        </button>
      </form>
      <button type="button" className="btn btn-ghost small" onClick={() => confirm("Remove your guardian keys from this device? Pieces sealed to you will no longer open.") && onReset()}>
        Remove guardian keys from this device
      </button>
    </section>
  );
}
