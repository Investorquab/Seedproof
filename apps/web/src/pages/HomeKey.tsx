import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  approveRequest,
  decodeRequestBody,
  describeVaultRequest,
  encodeFrames,
  isApprovalRequest,
  isLinkRequest,
  isGuardianCard,
  isGuardianShare,
  isVaultRequest,
  recoverHomeKey,
  sealToGuardians,
  signLinkRequest,
  signVaultRequest,
  type DecodedLine,
  type GuardianCard,
  type GuardianEnvelope,
  type GuardianShare,
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

/** What the review screen shows, whatever kind of request it came from. */
interface PendingReview {
  title: string;
  lines: DecodedLine[];
  meta: [string, string][];
  /** Why it cannot be signed, if it cannot. */
  blocked: string | null;
  /** Produces the answer to hand back to the phone. */
  sign: () => Promise<unknown>;
  summary: string;
}

type Screen =
  | { name: "setup" }
  | { name: "show-code"; address: string; code: string }
  | { name: "locked" }
  | { name: "ready" }
  | { name: "review"; review: PendingReview }
  | { name: "signed"; summary: string; frames: string[] }
  | { name: "refused"; why: string }
  | { name: "guardians-collect"; cards: GuardianCard[] }
  | { name: "guardians-deliver"; envs: GuardianEnvelope[]; at: number }
  | { name: "restore" };

const fingerprint = (k: PqcKeypair) => sha256Hex(k.publicKey).replace(/^0x/, "").slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");
const minutesLeft = (unixSeconds: number) => Math.max(0, Math.round((unixSeconds - Date.now() / 1000) / 60));
const expiresText = (m: number) => (m > 0 ? `In ${m} minute${m === 1 ? "" : "s"}` : "Expired");

export function HomeKey() {
  const [screen, setScreen] = useState<Screen>(() => (hasSealed(STORE) ? { name: "locked" } : { name: "setup" }));
  const [key, setKey] = useState<{ address: string; pq: PqcKeypair; code: string } | null>(null);

  /** Turn whatever the phone sent into something a person can read before signing. */
  const toReview = (msg: unknown): PendingReview | string => {
    if (!key) return "The Home Key is not open.";

    if (isApprovalRequest(msg)) {
      if (msg.account !== key.address) return "This request is for a different account than this Home Key protects.";
      if (msg.chainId !== NETWORK.chainId) return `This request is for ${msg.chainId}, not ${NETWORK.name}.`;
      const decoded = decodeRequestBody(msg);
      const m = minutesLeft(msg.expiresAt);
      return {
        title: "Your phone is asking to",
        lines: decoded.lines,
        meta: [
          ["Account", shortAddress(msg.account)],
          ["Expires", expiresText(m)],
          ["Network", NETWORK.name],
          ...(decoded.memo ? ([["Memo", decoded.memo]] as [string, string][]) : []),
        ],
        blocked:
          m <= 0
            ? "The request has expired. Make a new one on your phone."
            : !decoded.understood || decoded.hasExtension
              ? "It contains something this Home Key cannot read. Refuse it."
              : null,
        sign: () => approveRequest(msg, key.pq, () => true),
        summary: decoded.lines.map((l) => l.text).join(". "),
      };
    }

    if (isLinkRequest(msg)) {
      if (msg.account !== key.address) return "This link request is for a different account than this Home Key protects.";
      if (msg.chainId !== NETWORK.chainId) return `This link request is for ${msg.chainId}, not ${NETWORK.name}.`;
      const m = minutesLeft(msg.expiresAt);
      const text =
        msg.mode === "register"
          ? "Make this Home Key the post-quantum key of your account"
          : "Replace the post-quantum key made from your 24 words with this Home Key";
      return {
        title: "Link this Home Key",
        lines: [{ typeUrl: "link", text, risk: "critical" }],
        meta: [
          ["Account", shortAddress(msg.account)],
          ["After this", "Your 24 words alone can no longer move your money"],
          ["Expires", expiresText(m)],
        ],
        blocked: m <= 0 ? "The request has expired. Start linking again on your phone." : null,
        sign: async () => signLinkRequest(msg, key.pq),
        summary: text,
      };
    }

    if (isVaultRequest(msg)) {
      if (msg.account !== key.address) return "This vault request is for a different account than this Home Key protects.";
      if (msg.evmChainId !== String(NETWORK.evmChainId)) return `This vault request is for chain ${msg.evmChainId}, not ${NETWORK.name}.`;
      const d = describeVaultRequest(msg);
      const m = minutesLeft(msg.deadline);
      return {
        title: "Your phone is asking to",
        lines: d.lines,
        meta: [
          ["Vault", shortAddress(msg.vault)],
          ["Request number", msg.nonce],
          ["Expires", expiresText(m)],
        ],
        blocked: m <= 0 ? "The request has expired. Make a new one on your phone." : !d.understood ? "This Home Key cannot read this vault request. Refuse it." : null,
        sign: async () => signVaultRequest(msg, key.pq),
        summary: d.lines.map((l) => l.text).join(". "),
      };
    }

    return "That is not a Seedproof request.";
  };

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

        {screen.name === "setup" && (
          <Setup onCreated={(address, code) => setScreen({ name: "show-code", address, code })} onRestore={() => setScreen({ name: "restore" })} />
        )}

        {screen.name === "restore" && (
          <Restore onRestored={(address, code) => setScreen({ name: "show-code", address, code })} onCancel={() => setScreen({ name: "setup" })} />
        )}

        {screen.name === "show-code" && (
          <ShowCode
            address={screen.address}
            code={screen.code}
            onSealed={(pq) => {
              setKey({ address: screen.address, pq, code: screen.code });
              setScreen({ name: "ready" });
            }}
          />
        )}

        {screen.name === "locked" && (
          <Unlock
            onUnlocked={(s) => {
              setKey({ address: s.address, pq: pqcKeyFromRecoveryCode(s.recoveryCode, s.address), code: s.recoveryCode });
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
            onGuardians={() => setScreen({ name: "guardians-collect", cards: [] })}
            onRequest={(msg) => {
              const r = toReview(msg);
              setScreen(typeof r === "string" ? { name: "refused", why: r } : { name: "review", review: r });
            }}
          />
        )}

        {screen.name === "review" && (
          <Review
            review={screen.review}
            onRefuse={() => setScreen({ name: "ready" })}
            onApprove={async () => {
              try {
                const answer = await screen.review.sign();
                setScreen({ name: "signed", summary: screen.review.summary, frames: encodeFrames(answer) });
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
            <AnimatedQr frames={screen.frames} color="#3F2E0B" label="Answer for your phone" />
            <p className="small home-note">This signature works once, for this request only. It cannot be reused for a bigger amount or another address.</p>
            <button type="button" className="btn btn-brass-outline btn-block" onClick={() => setScreen({ name: "ready" })}>
              Done
            </button>
          </section>
        )}

        {screen.name === "guardians-collect" && key && (
          <GuardiansCollect
            cards={screen.cards}
            onCard={(c) =>
              setScreen({ name: "guardians-collect", cards: screen.cards.some((x) => x.mlkemPublicKey === c.mlkemPublicKey) ? screen.cards : [...screen.cards, c] })
            }
            onSeal={() => {
              try {
                const envs = sealToGuardians({ chainId: NETWORK.chainId, account: key.address, recoveryCode: key.code, guardians: screen.cards, threshold: screen.cards.length >= 4 ? 3 : 2 });
                setScreen({ name: "guardians-deliver", envs, at: 0 });
              } catch (e) {
                setScreen({ name: "refused", why: e instanceof Error ? e.message : "Could not seal the pieces." });
              }
            }}
            onCancel={() => setScreen({ name: "ready" })}
          />
        )}

        {screen.name === "guardians-deliver" && (
          <section className="stack">
            <div className="stack-tight">
              <h1 className="display device-title">Give this piece to {screen.envs[screen.at]!.guardian}</h1>
              <p className="device-sub">
                Piece {screen.at + 1} of {screen.envs.length}. It is sealed to {screen.envs[screen.at]!.guardian} alone and opens nothing by itself.
                Any {screen.envs[0]!.threshold} guardians together can rebuild this Home Key.
              </p>
            </div>
            <AnimatedQr key={screen.at} frames={encodeFrames(screen.envs[screen.at]!)} color="#3F2E0B" label={`Sealed piece for ${screen.envs[screen.at]!.guardian}`} />
            {screen.at + 1 < screen.envs.length ? (
              <button type="button" className="btn btn-brass btn-block" onClick={() => setScreen({ ...screen, at: screen.at + 1 })}>
                Next guardian
              </button>
            ) : (
              <button type="button" className="btn btn-brass btn-block" onClick={() => setScreen({ name: "ready" })}>
                All guardians have their piece
              </button>
            )}
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

function Setup({ onCreated, onRestore }: { onCreated: (address: string, code: string) => void; onRestore: () => void }) {
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
      <button type="button" className="btn btn-ghost" onClick={onRestore}>
        Lost your Home Key? Restore it with your guardians
      </button>
    </section>
  );
}

function Restore({ onRestored, onCancel }: { onRestored: (address: string, code: string) => void; onCancel: () => void }) {
  const [address, setAddress] = useState("");
  const [shares, setShares] = useState<GuardianShare[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ok = address.trim().startsWith("qor1") && isValidBech32(address.trim());
  const need = shares[0]?.threshold ?? 2;

  const onShare = (m: unknown) => {
    setError(null);
    if (!isGuardianShare(m)) return setError("That is not a guardian piece.");
    if (m.account !== address.trim()) return setError("That piece belongs to a different account.");
    const next = shares.some((s) => s.index === m.index) ? shares : [...shares, m];
    setShares(next);
    if (next.length >= m.threshold) {
      try {
        onRestored(address.trim(), recoverHomeKey(next, address.trim()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "The pieces do not fit together.");
      }
    }
  };

  return (
    <section className="stack">
      <div className="stack-tight">
        <h1 className="display device-title">Restore your Home Key</h1>
        <p className="device-sub">Meet your guardians in person. Each one opens their piece and shows it to this device.</p>
      </div>
      <div className="field">
        <label htmlFor="raddr">Your Pocket's address</label>
        <input id="raddr" className="input input-home" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="qor1…" autoComplete="off" spellCheck={false} disabled={shares.length > 0} />
      </div>
      {ok && (
        <>
          <p className="small home-note" role="status">
            {shares.length === 0 ? `Pieces needed: ${need}` : `Got ${shares.length} of ${need} pieces`}
          </p>
          <FrameReader key={shares.length} tone="home" onMessage={onShare} />
        </>
      )}
      {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}

function GuardiansCollect({
  cards,
  onCard,
  onSeal,
  onCancel,
}: {
  cards: GuardianCard[];
  onCard: (c: GuardianCard) => void;
  onSeal: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="stack">
      <div className="stack-tight">
        <h1 className="display device-title">Choose your guardians</h1>
        <p className="device-sub">
          Three people you trust and can meet. Each gets one sealed piece of this Home Key. Two of them together can help you rebuild it.
          Your 24 words are not involved.
        </p>
      </div>
      {cards.length > 0 && (
        <ol className="guardian-list">
          {cards.map((c) => (
            <li key={c.mlkemPublicKey}>{c.name}</li>
          ))}
        </ol>
      )}
      <p className="small home-note">Ask each guardian to open Seedproof Guardian and show you their card.</p>
      <FrameReader
        key={cards.length}
        tone="home"
        onMessage={(m) => {
          setError(null);
          if (!isGuardianCard(m)) return setError("That is not a guardian card.");
          onCard(m);
        }}
      />
      {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
      <button type="button" className="btn btn-brass btn-block" disabled={cards.length < 2} onClick={onSeal}>
        {cards.length < 2 ? "Add at least 2 guardians" : `Seal ${cards.length} pieces`}
      </button>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
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

function Ready({ pq, onRequest, onGuardians }: { pq: PqcKeypair; onRequest: (msg: unknown) => void; onGuardians: () => void }) {
  return (
    <section className="stack">
      <div className="stack-tight">
        <h1 className="display device-title">Read a request from your phone</h1>
        <p className="device-sub">Nothing is signed until you have read it here and approved it.</p>
      </div>
      <FrameReader tone="home" onMessage={onRequest} />
      <button type="button" className="btn btn-brass-outline btn-block" onClick={onGuardians}>
        Set up guardians
      </button>
      <p className="tiny home-note">Key fingerprint {fingerprint(pq)}. This device holds no recovery phrase.</p>
    </section>
  );
}

function Review({ review, onApprove, onRefuse }: { review: PendingReview; onApprove: () => void; onRefuse: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="stack">
      <h1 className="display device-title">{review.title}</h1>
      <div className="review-card">
        <ul className="review-lines">
          {review.lines.map((l, i) => (
            <li key={i} className={`risk-${l.risk}`}>
              <span className="review-line">{l.text}</span>
              {l.risk === "critical" && <span className="tiny review-flag">Read this one twice</span>}
            </li>
          ))}
        </ul>
        <dl className="review-meta">
          {review.meta.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="small home-note">
        This was read from the request itself, not from your phone's description of it. If it is not what you asked for, refuse it
        and close your window.
      </p>
      {review.blocked && (
        <div className="notice notice-bad">
          <div>
            <strong>Cannot sign this</strong>
            <span>{review.blocked}</span>
          </div>
        </div>
      )}
      <div className="stack-tight">
        <button
          type="button"
          className="btn btn-brass btn-block btn-tall"
          disabled={Boolean(review.blocked) || busy}
          onClick={() => {
            setBusy(true);
            onApprove();
          }}
        >
          {busy ? "Signing…" : "Approve with Home Key"}
        </button>
        <button type="button" className="btn btn-brass-outline btn-block" onClick={onRefuse}>
          Refuse
        </button>
      </div>
    </section>
  );
}
