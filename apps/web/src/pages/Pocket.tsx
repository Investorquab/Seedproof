import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { EncodeObject, OfflineDirectSigner } from "@cosmjs/proto-signing";
import { hexToBytes } from "viem";
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
  ethDirectSigner,
} from "@seedproof/core";
import {
  MSG_SEND_TYPE_URL,
  closeEvmWindowMsg,
  deriveNativeAccount,
  derivePqcCanonical,
  deriveUnifiedAccount,
  directSignerFromPrivateKey,
  type PqcKeypair,
  fetchEvmWindow,
  openEvmWindowMsg,
  validateMnemonic,
} from "@qorechain/sdk";
import { Logo } from "../components/Logo";
import { AnimatedQr } from "../components/AnimatedQr";
import { FrameReader } from "../components/FrameReader";
import { hasSealed, seal, unseal, forget } from "../lib/sealed";
import { accountInfo, broadcast, explorerTx, nativeBalance, registeredPqcKey, type BroadcastOutcome } from "../lib/chain";
import { FEST_TOKENS, NETWORK, VAULT_ADDRESS, shortAddress } from "../config";
import "./device.css";
import "./pocket.css";

const STORE = "seedproof.pocket.v1";
/** Which account the 24 words open: not secret, so kept in plain storage. */
const KIND_STORE = "seedproof.pocket.kind";

/**
 * qorex: the classic account QoreX creates (m/44'/118'). Native lane only: it has no EVM key,
 *        so nothing on it can move without the Home Key.
 * evm:   the account MetaMask-style wallets use (m/44'/60'). Same 24 words, different address,
 *        with a 0x twin that can spend inside a scoped EVM window.
 */
type AccountKind = "qorex" | "evm";
const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gasLimit: 1_000_000n };

interface Wallet {
  kind: AccountKind;
  address: string;
  /** 0x twin, evm accounts only. */
  evm?: string;
  publicKey: Uint8Array;
  signer: OfflineDirectSigner;
  /** Kept in memory while open: needed once, to rotate away from the seed-derived key. */
  mnemonic: string;
  /** The post-quantum key QoreX and the SDK derive from the same 24 words. */
  seedPqc: PqcKeypair;
}

/** none: no post-quantum key on chain. seed: the key comes from the 24 words. home: a separate Home Key. */
type Protection = "checking" | "none" | "seed" | "home" | "unknown";

interface WindowView {
  live: boolean;
  nativeOnly: boolean;
  targets: string[];
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

  const open = async (mnemonic: string, want?: AccountKind) => {
    const [classic, unified] = await Promise.all([deriveNativeAccount(mnemonic), deriveUnifiedAccount(mnemonic)]);
    const opened: Record<AccountKind, Wallet> = {
      qorex: {
        kind: "qorex",
        address: classic.address,
        publicKey: classic.publicKey,
        signer: await directSignerFromPrivateKey(classic.privateKey, "qor"),
        mnemonic,
        seedPqc: derivePqcCanonical(classic.address, mnemonic),
      },
      evm: {
        kind: "evm",
        address: unified.cosmos,
        evm: unified.evm,
        publicKey: hexToBytes(unified.publicKey as `0x${string}`),
        signer: ethDirectSigner(unified.privateKey as `0x${string}`, unified.cosmos, hexToBytes(unified.publicKey as `0x${string}`)),
        mnemonic,
        seedPqc: unified.pqc,
      },
    };
    let kind = want ?? (readKind() as AccountKind | null);
    if (!kind) {
      // First open: use whichever account is already live on chain; the QoreX one if both or neither.
      const live = async (a: string) => (await registeredPqcKey(a).catch(() => null)) !== null || (await nativeBalance(a).catch(() => 0n)) > 0n;
      const [q, e] = await Promise.all([live(opened.qorex.address), live(opened.evm.address)]);
      kind = e && !q ? "evm" : "qorex";
    }
    writeKind(kind);
    setWallet(opened[kind]);
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
        {wallet && (
          <PocketHome
            key={wallet.address}
            wallet={wallet}
            onSwitch={() => open(wallet.mnemonic, wallet.kind === "qorex" ? "evm" : "qorex")}
          />
        )}
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

function readKind(): string | null {
  try {
    return localStorage.getItem(KIND_STORE);
  } catch {
    return null;
  }
}

function writeKind(kind: AccountKind) {
  try {
    localStorage.setItem(KIND_STORE, kind);
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
}

function PocketHome({ wallet, onSwitch }: { wallet: Wallet; onSwitch: () => void }) {
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
        const seedPub = wallet.seedPqc.publicKey;
        const same = seedPub.length === reg.length && seedPub.every((x, i) => x === reg[i]);
        setProtection(same ? "seed" : "home");
      }
      setBalance(b);
      setWin({
        live: Boolean(w.live),
        nativeOnly: Boolean(w.nativeOnly),
        targets: (w.allowedTargets ?? []).map((t) => t.toLowerCase()),
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
      pubkeyType: wallet.kind === "evm" ? "eth_secp256k1" : "secp256k1",
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
        const seedKey = wallet.seedPqc;
        const linkMsg = buildLinkMessage(linkReq, msg, { classicalPubkey: wallet.publicKey, oldKey: seedKey });
        const info = await accountInfo(wallet.address);
        const req = createApprovalRequest({
          chainId: NETWORK.chainId,
          account: wallet.address,
          classicalPubkey: wallet.publicKey,
          pubkeyType: wallet.kind === "evm" ? "eth_secp256k1" : "secp256k1",
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

  // What a thief holding only the 24 words could move right now. Only a live EVM window gives them
  // anything: its QOR cap (value plus fees), and the whole balance of any token contract it lists.
  const exposure = wallet.kind === "evm" && win?.live ? BigInt(win.remainingValue) : 0n;
  const atRisk = balance === null ? null : exposure < balance ? exposure : balance;
  const exposedTokens =
    wallet.kind === "evm" && win?.live && !win.nativeOnly
      ? win.targets.length === 0
        ? ["every token on this account"]
        : FEST_TOKENS.filter((t) => win.targets.includes(t.address.toLowerCase())).map((t) => `all your ${t.symbol}`)
      : [];

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
        <p className="small protected-line">
          {wallet.kind === "qorex"
            ? "Protected by your Home Key. Your 24 words alone can move nothing."
            : "Protected by your Home Key. Your 24 words alone can only spend what an open window allows."}
        </p>
      )}
      <div className="pocket-card">
        <div className="stack-tight" style={{ gap: 4 }}>
          <span className="small pocket-soft">On this account</span>
          <span className="pocket-balance">
            {balance === null ? "…" : qor(balance)} <span>QOR</span>
          </span>
        </div>
        {wallet.kind === "evm" && win && (
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
          {exposedTokens.length > 0 && ` Plus ${exposedTokens.join(" and ")}, while this window is open.`}
        </p>
        <div className="pocket-actions">
          <button type="button" className="btn pocket-btn-light" onClick={() => setFlow({ name: "send" })}>
            Send QOR
          </button>
          {wallet.kind === "evm" &&
            (win?.live ? (
              <button type="button" className="btn pocket-btn-dark" onClick={() => ask([closeEvmWindowMsg(wallet.address)])}>
                Close window
              </button>
            ) : (
              <button type="button" className="btn pocket-btn-dark" onClick={() => setFlow({ name: "window" })}>
                Open window
              </button>
            ))}
        </div>
      </div>

      <p className="small muted account-kind">
        {wallet.kind === "qorex"
          ? "QoreX account. It has no EVM side, so every payment goes through your Home Key."
          : `0x account (${shortAddress(wallet.evm ?? "")}). It can spend inside a small window you open.`}{" "}
        <button type="button" className="btn btn-ghost small" onClick={onSwitch}>
          {wallet.kind === "qorex" ? "Use the 0x account instead" : "Use the QoreX account instead"}
        </button>
      </p>

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
          onSubmit={(maxTxs, uqor, scope) =>
            ask([
              openEvmWindowMsg({
                sender: wallet.address,
                blocks: 14_400,
                maxTxs,
                maxValue: uqor,
                // Never an open-to-anything window: it would expose every token on the account.
                ...(scope === "qor" ? { nativeOnly: true } : { allowedTargets: [scope === "vault" ? VAULT_ADDRESS : scope] }),
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

type WindowScope = "qor" | "vault" | string;

function WindowForm({ onSubmit, onCancel }: { onSubmit: (maxTxs: number, uqor: string, scope: WindowScope) => Promise<void>; onCancel: () => void }) {
  const [scope, setScope] = useState<WindowScope>("qor");
  const [txs, setTxs] = useState("5");
  const [amount, setAmount] = useState("20");
  const [error, setError] = useState<string | null>(null);
  const token = FEST_TOKENS.find((t) => t.address === scope);
  return (
    <form
      className="pocket-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await onSubmit(Math.max(1, Math.min(50, Number(txs) || 1)), String(Math.round(Number(amount) * 1_000_000)), scope);
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
        <label htmlFor="scope">What it is for</label>
        <select id="scope" className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="qor">Send QOR to anyone</option>
          <option value="vault">Top up from your vault</option>
          {FEST_TOKENS.map((t) => (
            <option key={t.address} value={t.address}>
              Spend {t.symbol}
            </option>
          ))}
        </select>
      </div>
      <p className="small window-scope-note">
        {scope === "qor"
          ? "Plain QOR transfers only. Your tokens cannot move through this window."
          : scope === "vault"
            ? "Only your vault. Every top-up still needs your Home Key's signature."
            : `Only the ${token?.symbol} contract. All the ${token?.symbol} on this account can leave while it is open, so keep only today's ${token?.symbol} here.`}
      </p>
      <div className="field">
        <label htmlFor="txs">Payments</label>
        <input id="txs" className="input" inputMode="numeric" value={txs} onChange={(e) => setTxs(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cap">{scope === "qor" ? "Most QOR that can leave, including fees" : "Most QOR for fees"}</label>
        <input id="cap" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
