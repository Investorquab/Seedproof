import { useCallback, useEffect, useMemo, useState } from "react";
import { decodeAbiParameters, parseUnits, type Hex } from "viem";
import { ENVELOPE_VERSION, VaultAction, describeVaultRequest, formatUnits, vaultPayload, type VaultRequest, type VaultResponse } from "@seedproof/core";
import { NETWORK, shortAddress } from "../config";
import { readVault, VAULT_TOKENS, type QueuedItem, type VaultState, type VaultToken } from "../lib/vault";
import "./vault.css";

interface Props {
  /** This account's own vault (from the factory, or the v1 demo vault). */
  vault: Hex;
  /** qor1 address of the account the Home Key protects. */
  account: string;
  /** The same account's 0x address: the Pocket on the EVM lane. */
  pocket: Hex;
  /** true when a live window lets this phone call the vault. */
  vaultWindowOpen: boolean;
  onOpenWindow: () => void;
  /** Show the request to the Home Key; `submit` sends the answered call. */
  onAsk: (req: VaultRequest, summary: string, submit: (res: VaultResponse) => Promise<{ txhash: string; code: number; rawLog: string }>) => void;
  onSend: (fn: "topUp" | "queue" | "execute" | "cancelWithHomeKey", args: readonly unknown[]) => Promise<{ txhash: string; code: number; rawLog: string }>;
  onDone: (outcome: { txhash: string; code: number; rawLog: string }, summary: string) => void;
  onBack: () => void;
}

type Mode = { name: "view" } | { name: "topup" } | { name: "withdraw" };

const hex = (b64: string): Hex => `0x${Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}`;

function hoursText(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  const h = seconds / 3600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? "" : "s"}`;
}

function untilText(readyAt: number, now: number): string {
  const s = Math.max(0, readyAt - now);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function readItem(item: QueuedItem): { token: VaultToken | undefined; amount: bigint; to: string } | null {
  if (item.action !== VaultAction.Withdraw) return null;
  const [token, to, amount] = decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], item.payload);
  return { token: VAULT_TOKENS.find((t) => t.address.toLowerCase() === token.toLowerCase()), amount, to };
}

export function PocketVault(props: Props) {
  const [state, setState] = useState<VaultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ name: "view" });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setState(await readVault(props.vault, props.pocket));
    } catch {
      setError("Could not read the vault from the QoreChain testnet.");
    }
  }, [props.vault, props.pocket]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  /** Build a vault request at the vault's current nonce, ready for the Home Key. */
  const request = useCallback(
    async (action: VaultAction, payload: Hex): Promise<VaultRequest> => {
      const fresh = await readVault(props.vault, props.pocket);
      return {
        v: ENVELOPE_VERSION,
        kind: "seedproof/vault-request",
        account: props.account,
        pocket: props.pocket,
        evmChainId: String(NETWORK.evmChainId),
        vault: props.vault,
        nonce: fresh.nonce.toString(),
        action,
        payload,
        deadline: Math.floor(Date.now() / 1000) + 900,
      };
    },
    [props.account, props.pocket, props.vault],
  );

  const ask = async (action: VaultAction, payload: Hex, call: (req: VaultRequest, res: VaultResponse) => Promise<{ txhash: string; code: number; rawLog: string }>) => {
    const req = await request(action, payload);
    const summary = describeVaultRequest(req).lines.map((l) => l.text).join(". ");
    props.onAsk(req, summary, (res) => call(req, res));
  };

  const topUp = (token: VaultToken, amount: bigint) =>
    ask(VaultAction.TopUp, vaultPayload.transfer(token.address, props.pocket, amount), (req, res) =>
      props.onSend("topUp", [token.address, props.pocket, amount, BigInt(req.deadline), hex(res.pqcPublicKey), hex(res.pqcSignature)]),
    );

  const withdraw = (token: VaultToken, amount: bigint) =>
    ask(VaultAction.Withdraw, vaultPayload.transfer(token.address, props.pocket, amount), (req, res) =>
      props.onSend("queue", [VaultAction.Withdraw, req.payload, BigInt(req.deadline), hex(res.pqcPublicKey), hex(res.pqcSignature)]),
    );

  const cancel = (id: bigint) =>
    ask(VaultAction.Cancel, vaultPayload.id(id), (req, res) =>
      props.onSend("cancelWithHomeKey", [id, BigInt(req.deadline), hex(res.pqcPublicKey), hex(res.pqcSignature)]),
    );

  const execute = async (item: QueuedItem, label: string) => {
    const outcome = await props.onSend("execute", [item.id]);
    props.onDone(outcome, label);
  };

  const main = VAULT_TOKENS[1]; // fUSD leads, as in the design
  const others = VAULT_TOKENS.filter((t) => t !== main);

  return (
    <section className="stack vault">
      <div className="vault-head">
        <button type="button" className="btn btn-ghost small" onClick={props.onBack}>
          Back to Pocket
        </button>
        <span className="small muted">{shortAddress(props.vault)}</span>
      </div>

      {error && (
        <div className="notice notice-plain">
          <div>
            <strong>Offline</strong>
            <span>
              {error}{" "}
              <button type="button" className="btn btn-ghost small" onClick={refresh}>
                Try again
              </button>
            </span>
          </div>
        </div>
      )}

      {state?.frozen && (
        <div className="notice notice-bad">
          <div>
            <strong>Frozen by a guardian</strong>
            <span>Nothing can leave the vault until your Home Key unfreezes it.</span>
          </div>
        </div>
      )}

      <section aria-label="Vault balances" className="vault-card">
        <div className="vault-row">
          <span className="small vault-soft">At home, in your vault</span>
          <span className="vault-note-xs">Moves only with your Home Key</span>
        </div>
        <span className="vault-balance">
          {state ? formatUnits(state.balances[main.address] ?? 0n, main.decimals) : "…"} <span>{main.symbol}</span>
        </span>
        <div className="vault-others">
          {others.map((t) => (
            <span key={t.address} className="vault-chip">
              <strong>{state ? formatUnits(state.balances[t.address] ?? 0n, t.decimals) : "…"}</strong>
              <span>{t.symbol}</span>
            </span>
          ))}
        </div>
        {state && (
          <div className="stack-tight" style={{ gap: 6 }}>
            <div className="vault-row small">
              <span>Top up today</span>
              <strong>
                {formatUnits(state.availableToday[main.address] ?? 0n, main.decimals)} of {formatUnits(state.dailyLimit[main.address] ?? 0n, main.decimals)} {main.symbol} left
              </strong>
            </div>
            <Meter value={state.availableToday[main.address] ?? 0n} max={state.dailyLimit[main.address] ?? 0n} label={`${main.symbol} top-up left today`} />
          </div>
        )}
        {props.vaultWindowOpen ? (
          <div className="vault-actions">
            <button type="button" className="btn vault-btn-solid" onClick={() => setMode({ name: "topup" })} disabled={!state || state.frozen}>
              Top up now
            </button>
            <button type="button" className="btn vault-btn-line" onClick={() => setMode({ name: "withdraw" })} disabled={!state}>
              Withdraw
            </button>
          </div>
        ) : (
          <div className="stack-tight">
            <button type="button" className="btn vault-btn-solid btn-block" onClick={props.onOpenWindow}>
              Open a vault window
            </button>
            <p className="vault-note">Your phone can only reach the vault through a window your Home Key opens. It lets this phone call the vault and nothing else.</p>
          </div>
        )}
        {state && (
          <p className="vault-note">
            Top-ups arrive at once, up to today's limit. Anything bigger is a withdrawal and waits {hoursText(state.delay)}.
          </p>
        )}
      </section>

      {mode.name !== "view" && state && (
        <AmountForm
          kind={mode.name}
          state={state}
          delay={state.delay}
          onCancel={() => setMode({ name: "view" })}
          onSubmit={(token, amount) => (mode.name === "topup" ? topUp(token, amount) : withdraw(token, amount))}
        />
      )}

      {state && state.pending.length > 0 && (
        <section aria-labelledby="waiting" className="stack-tight">
          <h2 id="waiting" className="vault-h2">
            Waiting
          </h2>
          {state.pending.map((item) => {
            const r = readItem(item);
            const label = r?.token
              ? `Withdraw ${formatUnits(r.amount, r.token.decimals)} ${r.token.symbol} to ${r.to.toLowerCase() === props.pocket.toLowerCase() ? "your Pocket" : shortAddress(r.to)}`
              : `Vault rule change #${item.id}`;
            const ready = item.readyAt <= now;
            const done = Math.min(1, Math.max(0, 1 - (item.readyAt - now) / Math.max(1, state.delay)));
            return (
              <div key={String(item.id)} className="vault-wait">
                <div className="vault-row">
                  <strong>{label}</strong>
                  <span className="small muted">#{String(item.id)}</span>
                </div>
                <Meter value={BigInt(Math.round(done * 1000))} max={1000n} label={ready ? "Ready" : `Ready in ${untilText(item.readyAt, now)}`} tone="ink" />
                <div className="vault-row">
                  <span className="small muted">
                    {ready
                      ? "Ready. Anyone can finish it now."
                      : `Ready ${new Date(item.readyAt * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}, in ${untilText(item.readyAt, now)}`}
                  </span>
                  {ready ? (
                    props.vaultWindowOpen && (
                      <button type="button" className="btn btn-ink vault-small-btn" onClick={() => execute(item, label)}>
                        Finish
                      </button>
                    )
                  ) : (
                    props.vaultWindowOpen && (
                      <button type="button" className="btn vault-cancel" onClick={() => cancel(item.id)}>
                        Cancel
                      </button>
                    )
                  )}
                </div>
                {!ready && <p className="small muted" style={{ margin: 0 }}>Not you? Cancel it here with your Home Key, or ask a guardian to cancel it.</p>}
              </div>
            );
          })}
        </section>
      )}

      {state && (
        <section aria-label="Guardians" className="vault-guardians">
          <span aria-hidden="true" className="vault-dots">
            {Array.from({ length: Math.max(1, state.guardians) }, (_, i) => (
              <span key={i} />
            ))}
          </span>
          <span className="small">
            {state.guardians === 0
              ? "No guardians yet. Add guardians so someone can freeze the vault if your Home Key is stolen."
              : `${state.guardians} guardian${state.guardians === 1 ? "" : "s"} can freeze this vault or cancel a withdrawal. They can never move your money.`}
          </span>
        </section>
      )}
    </section>
  );
}

function Meter({ value, max, label, tone = "brass" }: { value: bigint; max: bigint; label: string; tone?: "brass" | "ink" }) {
  const pct = max > 0n ? Number((value * 1000n) / max) / 10 : 0;
  return (
    <div role="img" aria-label={label} className={`vault-meter vault-meter-${tone}`}>
      <span style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function AmountForm({
  kind,
  state,
  delay,
  onSubmit,
  onCancel,
}: {
  kind: "topup" | "withdraw";
  state: VaultState;
  delay: number;
  onSubmit: (token: VaultToken, amount: bigint) => Promise<void>;
  onCancel: () => void;
}) {
  const [tokenAddr, setTokenAddr] = useState<string>(VAULT_TOKENS[1].address);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const token = useMemo(() => VAULT_TOKENS.find((t) => t.address === tokenAddr)!, [tokenAddr]);
  const inVault = state.balances[token.address] ?? 0n;
  const today = state.availableToday[token.address] ?? 0n;
  return (
    <form
      className="pocket-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        let value: bigint;
        try {
          value = parseUnits(amount.trim() || "0", token.decimals);
        } catch {
          return setError("Enter an amount like 25 or 0.5.");
        }
        if (value <= 0n) return setError("Enter an amount above 0.");
        if (value > inVault) return setError(`The vault holds ${formatUnits(inVault, token.decimals)} ${token.symbol}.`);
        if (kind === "topup" && value > today) return setError(`Today you can top up ${formatUnits(today, token.decimals)} ${token.symbol} more. Withdraw for a bigger amount.`);
        try {
          await onSubmit(token, value);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not build the request.");
        }
      }}
    >
      <h2 className="display display-s">{kind === "topup" ? "Top up your Pocket" : "Withdraw to your Pocket"}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {kind === "topup"
          ? "Arrives as soon as your Home Key approves, up to today's limit."
          : `Waits ${hoursText(delay)} after your Home Key approves. You or a guardian can cancel it while it waits.`}
      </p>
      <div className="field">
        <label htmlFor="vtok">Token</label>
        <select id="vtok" className="input" value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)}>
          {VAULT_TOKENS.map((t) => (
            <option key={t.address} value={t.address}>
              {t.symbol} ({formatUnits(state.balances[t.address] ?? 0n, t.decimals)} in vault)
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="vamt">Amount</label>
        <input id="vamt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {kind === "topup" && (
          <span className="small muted">
            Up to {formatUnits(today, token.decimals)} {token.symbol} today
          </span>
        )}
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
