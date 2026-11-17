import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { EncodeObject, OfflineDirectSigner } from "@cosmjs/proto-signing";
import {
  approveRequest,
  assembleSignedTx,
  buildLinkMessage,
  createApprovalRequest,
  createLinkRequest,
  decodeRequestBody,
  encodeFrames,
  isLinkResponse,
  signClassicalOnly,
  type ApprovalResponse,
  type LinkRequest,
} from "@seedproof/core";
import {
  MSG_SEND_TYPE_URL,
  closeEvmWindowMsg,
  deriveNativeAccount,
  derivePqcCanonical,
  directSignerFromPrivateKey,
  fetchEvmWindow,
  openEvmWindowMsg,
  validateMnemonic,
} from "@qorechain/sdk";
import { Logo } from "../components/Logo";
import { AnimatedQr } from "../components/AnimatedQr";
import { FrameReader } from "../components/FrameReader";
import { hasSealed, seal, unseal, forget } from "../lib/sealed";
import { accountInfo, broadcast, explorerTx, nativeBalance, registeredPqcKey, type BroadcastOutcome } from "../lib/chain";
import { NETWORK, shortAddress } from "../config";
import "./device.css";
import "./pocket.css";

const STORE = "seedproof.pocket.v1";
const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gasLimit: 1_000_000n };

interface Wallet {
  address: string;
  publicKey: Uint8Array;
  signer: OfflineDirectSigner;
  /** Kept in memory while open: needed once, to rotate away from the seed-derived key. */
  mnemonic: string;
}

/** none: no post-quantum key on chain. seed: the key comes from the 24 words. home: a separate Home Key. */
type Protection = "checking" | "none" | "seed" | "home" | "unknown";

interface WindowView {
  live: boolean;
  remainingTxs: string;
  remainingValue: string;
  remainingBlocks: string;
}

type Flow =
  | { name: "home" }
  | { name: "send" }
  | { name: "window" }
  | { name: "ask"; frames: string[]; summary: string; onAnswer: (msg: unknown) => Promise<BroadcastOutcome> }
  | { name: "done"; outcome: BroadcastOutcome; summary: string };

const qor = (uqor: bigint | string) => {
  const n = BigInt(uqor);
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${n / 1_000_000n}${frac ? "." + frac.slice(0, 2) : ""}`;
};

export function Pocket() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [locked, setLocked] = useState(() => hasSealed(STORE));

  const open = async (mnemonic: string) => {
    const acct = await deriveNativeAccount(mnemonic);
    setWallet({ address: acct.address, publicKey: acct.publicKey, signer: await directSignerFromPrivateKey(acct.privateKey, "qor"), mnemonic });
  };

  return (
    <div className="device device-pocket">
      <div className="device-col">
        <header className="device-head">
          <Link to="/" className="device-brand" aria-label="Seedproof home">
            <Logo size={24} />
            <span>Pocket</span>
          </Link>
          {wallet && <span className="chip chip-pocket">{shortAddress(wallet.address)}</span>}
        </header>
        {!wallet && !locked && <PocketSetup onReady={open} />}
        {!wallet && locked && (
          <PocketUnlock
            onReady={open}
            onReset={() => {
              forget(STORE);
              setLocked(false);
            }}
          />
        )}
        {wallet && <PocketHome wallet={wallet} />}
      </div>
    </div>
  );
}

function PocketSetup({ onReady }: { onReady: (m: string) => Promise<void> }) {
  const [words, setWords] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="stack">
      <div className="stack-tight">
        <h1 className="display device-title">Set up your Pocket</h1>
        <p className="device-sub muted">
          Your 24 words give this phone the classical key. Once your Home Key is linked, the words alone can only spend today's
          pocket money.
        </p>
      </div>
      <form
        className="stack-tight"
        onSubmit={async (e) => {
          e.preventDefault();
          const m = words.trim().toLowerCase().replace(/\s+/g, " ");
          if (!validateMnemonic(m)) return setError("That is not a valid 12 or 24 word recovery phrase.");
          if (pass.length < 10) return setError("Use a passphrase of at least 10 characters.");
          setBusy(true);
          await seal(STORE, m, pass);
          await onReady(m);
        }}
      >
        <div className="field">
          <label htmlFor="words">Recovery phrase (testnet only)</label>
          <textarea id="words" className="input" rows={3} value={words} onChange={(e) => setWords(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="pp">Passphrase for this phone</label>
          <input id="pp" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
        <button type="submit" className="btn btn-ink btn-block" disabled={busy}>
          {busy ? "Sealing…" : "Seal Pocket on this phone"}
        </button>
      </form>
    </section>
  );
}

function PocketUnlock({ onReady, onReset }: { onReady: (m: string) => Promise<void>; onReset: () => void }) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="stack">
      <h1 className="display device-title">Open your Pocket</h1>
      <form
        className="stack-tight"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onReady(await unseal(STORE, pass));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not open the Pocket.");
          }
        }}
      >
        <div className="field">
          <label htmlFor="pass">Passphrase</label>
          <input id="pass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
        <button type="submit" className="btn btn-ink btn-block" disabled={!pass}>
          Open
        </button>
      </form>
      <button type="button" className="btn btn-ghost small" onClick={() => confirm("Remove the Pocket from this phone?") && onReset()}>
        Remove Pocket from this phone
      </button>
    </section>
  );
}

function PocketHome({ wallet }: { wallet: Wallet }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [win, setWin] = useState<WindowView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow>({ name: "home" });
  const [protection, setProtection] = useState<Protection>("checking");
  const [registered, setRegistered] = useState<Uint8Array | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [b, w, reg] = await Promise.all([
        nativeBalance(wallet.address),
        fetchEvmWindow({ rest: NETWORK.rest, address: wallet.address }),
        registeredPqcKey(wallet.address),
      ]);
      setRegistered(reg);
      if (!reg) setProtection("none");
      else {
        const seedPub = derivePqcCanonical(wallet.address, wallet.mnemonic).publicKey;
        const same = seedPub.length === reg.length && seedPub.every((x, i) => x === reg[i]);
        setProtection(same ? "seed" : "home");
      }
      setBalance(b);
      setWin({
        live: Boolean(w.live),
        remainingTxs: String(w.remainingTxs ?? "0"),
        remainingValue: String(w.remainingValue ?? "0"),
        remainingBlocks: String(w.remainingBlocks ?? "0"),
      });
    } catch {
      setLoadError("Could not reach the QoreChain testnet.");
      setProtection("unknown");
    }
  }, [wallet.address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ask = async (messages: EncodeObject[]) => {
    const info = await accountInfo(wallet.address);
    const req = createApprovalRequest({
      chainId: NETWORK.chainId,
      account: wallet.address,
      classicalPubkey: wallet.publicKey,
      accountNumber: info.accountNumber,
      sequence: info.sequence,
      messages,
      fee: FEE,
      signBytesVersion: NETWORK.signBytesVersion,
    });
    const summary = decodeRequestBody(req).lines.map((l) => l.text).join(". ");
    setFlow({
      name: "ask",
      frames: encodeFrames(req),
      summary,
      onAnswer: async (msg) => {
        const res = msg as ApprovalResponse;
        if (res?.kind !== "seedproof/approval-response") throw new Error("That is not a Home Key answer to this request.");
        return broadcast(await assembleSignedTx(req, res, wallet.signer));
      },
    });
  };

  /** Make the Home Key the account's post-quantum key (register, or rotate away from the seed-derived key). */
  const link = async () => {
    const linkReq: LinkRequest = createLinkRequest({ chainId: NETWORK.chainId, account: wallet.address, registeredPublicKey: registered });
    setFlow({
      name: "ask",
      frames: encodeFrames(linkReq),
      summary:
        linkReq.mode === "register"
          ? "Make your Home Key this account's post-quantum key"
          : "Replace the post-quantum key made from your 24 words with your Home Key",
      onAnswer: async (msg) => {
        if (!isLinkResponse(msg)) throw new Error("That is not a Home Key answer to a link request.");
        const seedKey = derivePqcCanonical(wallet.address, wallet.mnemonic);
        const linkMsg = buildLinkMessage(linkReq, msg, { classicalPubkey: wallet.publicKey, oldKey: seedKey });
        const info = await accountInfo(wallet.address);
        const req = createApprovalRequest({
          chainId: NETWORK.chainId,
          account: wallet.address,
          classicalPubkey: wallet.publicKey,
          accountNumber: info.accountNumber,
          sequence: info.sequence,
          messages: [linkMsg],
          fee: FEE,
          signBytesVersion: NETWORK.signBytesVersion,
        });
        if (linkReq.mode === "register") {
          // The first registration is the one tx the chain accepts with only the classical signature.
          return broadcast(await signClassicalOnly(req, wallet.signer));
        }
        // A rotation is signed one last time by the seed-derived key it retires.
        const res = await approveRequest(req, seedKey, () => true);
        return broadcast(await assembleSignedTx(req, res, wallet.signer));
      },
    });
  };

  const exposure = win?.live ? BigInt(win.remainingValue) : 0n;
  const atRisk = balance === null ? null : exposure < balance ? exposure : balance;

  if (flow.name === "ask") {
    return (
      <AskHomeKey
        flow={flow}
        onCancel={() => setFlow({ name: "home" })}
        onDone={(outcome) => {
          setFlow({ name: "done", outcome, summary: flow.summary });
          refresh();
        }}
      />
    );
  }

  if (flow.name === "done") {
    const ok = flow.outcome.code === 0;
    return (
      <section className="stack">
        <div className={`notice ${ok ? "notice-good" : "notice-bad"}`}>
          <div>
            <strong>{ok ? "Sent" : "Refused by the chain"}</strong>
            <span>{ok ? flow.summary : flow.outcome.rawLog}</span>
          </div>
        </div>
        {flow.outcome.txhash && (
          <a href={explorerTx(flow.outcome.txhash)} className="small" target="_blank" rel="noreferrer">
            View on the explorer
          </a>
        )}
        <button type="button" className="btn btn-ink btn-block" onClick={() => setFlow({ name: "home" })}>
          Back to Pocket
        </button>
      </section>
    );
  }

  return (
    <section className="stack">
      {(protection === "none" || protection === "seed") && (
        <div className="notice notice-bad">
          <div className="stack-tight">
            <div>
              <strong>{protection === "none" ? "Not protected yet" : "One secret"}</strong>
              <span>
                {protection === "none"
                  ? "This account has no post-quantum key. Link your Home Key before anyone else registers one."
                  : "Your post-quantum key comes from your 24 words. Anyone who has the words holds both keys."}
              </span>
            </div>
            <button type="button" className="btn btn-ink" onClick={link}>
              Link your Home Key
            </button>
          </div>
        </div>
      )}
      {protection === "home" && (
        <p className="small protected-line">Protected by your Home Key. Your 24 words alone can only spend today's window.</p>
      )}
      <div className="pocket-card">
        <div className="stack-tight" style={{ gap: 4 }}>
          <span className="small pocket-soft">On this account</span>
          <span className="pocket-balance">
            {balance === null ? "…" : qor(balance)} <span>QOR</span>
          </span>
        </div>
        {win && (
          <div className="stack-tight" style={{ gap: 8 }}>
            <div className="pocket-row small pocket-soft">
              <span>{win.live ? `Window open, ${win.remainingBlocks} blocks left` : "No window open"}</span>
              <span>{win.live ? `${win.remainingTxs} payments left` : ""}</span>
            </div>
          </div>
        )}
        <p className="pocket-risk">
          {atRisk === null
            ? "Checking what this phone can spend…"
            : atRisk === 0n
              ? "If someone has your 24 words, they can take nothing right now."
              : `If someone has your 24 words, this is the most they could take right now: ${qor(atRisk)} QOR.`}
        </p>
        <div className="pocket-actions">
          <button type="button" className="btn pocket-btn-light" onClick={() => setFlow({ name: "send" })}>
            Send QOR
          </button>
          {win?.live ? (
            <button type="button" className="btn pocket-btn-dark" onClick={() => ask([closeEvmWindowMsg(wallet.address)])}>
              Close window
            </button>
          ) : (
            <button type="button" className="btn pocket-btn-dark" onClick={() => setFlow({ name: "window" })}>
              Open window
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="notice notice-plain">
          <div>
            <strong>Offline</strong>
            <span>
              {loadError}{" "}
              <button type="button" className="btn btn-ghost small" onClick={refresh}>
                Try again
              </button>
            </span>
          </div>
        </div>
      )}

      {flow.name === "send" && (
        <SendForm
          onCancel={() => setFlow({ name: "home" })}
          onSubmit={(to, uqor) =>
            ask([{ typeUrl: MSG_SEND_TYPE_URL, value: { fromAddress: wallet.address, toAddress: to, amount: [{ denom: "uqor", amount: uqor }] } }])
          }
        />
      )}

      {flow.name === "window" && (
        <WindowForm
          onCancel={() => setFlow({ name: "home" })}
          onSubmit={(maxTxs, uqor, target) =>
            ask([
              openEvmWindowMsg({
                sender: wallet.address,
                blocks: 14_400,
                maxTxs,
                maxValue: uqor,
                allowedTargets: target ? [target] : [],
              }),
            ])
          }
        />
      )}
    </section>
  );
}

function SendForm({ onSubmit, onCancel }: { onSubmit: (to: string, uqor: string) => Promise<void>; onCancel: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="pocket-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!to.startsWith("qor1")) return setError("Enter a qor1 address.");
        const n = Number(amount);
        if (!(n > 0)) return setError("Enter an amount above 0.");
        try {
          await onSubmit(to.trim(), String(Math.round(n * 1_000_000)));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not build the request.");
        }
      }}
    >
      <h2 className="display display-s">Send QOR</h2>
      <p className="small muted" style={{ margin: 0 }}>A native send always needs your Home Key.</p>
      <div className="field">
        <label htmlFor="to">To</label>
        <input id="to" className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="qor1…" autoComplete="off" spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor="amt">Amount in QOR</label>
        <input id="amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
      <div className="pocket-actions">
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-ink">
          Ask Home Key
        </button>
      </div>
    </form>
  );
}

function WindowForm({ onSubmit, onCancel }: { onSubmit: (maxTxs: number, uqor: string, target: string) => Promise<void>; onCancel: () => void }) {
  const [txs, setTxs] = useState("5");
  const [amount, setAmount] = useState("20");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="pocket-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = target.trim();
        if (t && !/^0x[0-9a-fA-F]{40}$/.test(t)) return setError("The token must be a 0x contract address.");
        try {
          await onSubmit(Math.max(1, Math.min(50, Number(txs) || 1)), String(Math.round(Number(amount) * 1_000_000)), t);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not build the request.");
        }
      }}
    >
      <h2 className="display display-s">Open today's window</h2>
      <p className="small muted" style={{ margin: 0 }}>
        For about one day, this phone can make a few EVM payments on its own. Anyone with your 24 words could too, so keep it small.
      </p>
      <div className="field">
        <label htmlFor="txs">Payments</label>
        <input id="txs" className="input" inputMode="numeric" value={txs} onChange={(e) => setTxs(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cap">Most QOR that can leave, including fees</label>
        <input id="cap" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="tgt">Only this token contract (recommended)</label>
        <input id="tgt" className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
      </div>
      {error && <p className="small" style={{ color: "var(--refused)", margin: 0 }}>{error}</p>}
      <div className="pocket-actions">
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-ink">
          Ask Home Key
        </button>
      </div>
    </form>
  );
}

function AskHomeKey({
  flow,
  onCancel,
  onDone,
}: {
  flow: { frames: string[]; summary: string; onAnswer: (msg: unknown) => Promise<BroadcastOutcome> };
  onCancel: () => void;
  onDone: (o: BroadcastOutcome) => void;
}) {
  const [step, setStep] = useState<"show" | "read">("show");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onAnswer = async (msg: unknown) => {
    setError(null);
    setBusy(true);
    try {
      onDone(await flow.onAnswer(msg));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish the transaction.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <h1 className="display device-title">{step === "show" ? "Show this to your Home Key" : "Read the Home Key's answer"}</h1>
      <div className="pocket-ask-card">
        <span className="small muted">You are asking to</span>
        <span className="pocket-ask-line">{flow.summary}</span>
        <span className="small muted">Your Home Key will read this back to you before it signs.</span>
      </div>
      {step === "show" ? (
        <>
          <AnimatedQr frames={flow.frames} label="Request for your Home Key" />
          <button type="button" className="btn btn-ink btn-block btn-tall" onClick={() => setStep("read")}>
            Scan the Home Key's answer
          </button>
        </>
      ) : (
        <FrameReader tone="pocket" onMessage={onAnswer} />
      )}
      {busy && <p className="small muted" role="status">Sending to QoreChain…</p>}
      {error && (
        <div className="notice notice-bad">
          <div>
            <strong>Not sent</strong>
            <span>{error}</span>
          </div>
        </div>
      )}
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancel request
      </button>
    </section>
  );
}
