import { Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
// The check needs the SDK (key derivation); load it after the page itself.
const ExposureCheck = lazy(() => import("./ExposureCheck").then((m) => ({ default: m.ExposureCheck })));
import { REPO_URL, STEAL_THIS_SEED, shortAddress } from "../config";
import "./landing.css";

const ROWS: { act: string; std: string; sp: string; partial?: boolean }[] = [
  { act: "Send QOR from the account", std: "Done, all of it", sp: "Refused, signature does not match" },
  { act: "Open a bigger spending window", std: "Done", sp: "Refused, needs the Home Key" },
  { act: "Replace the post-quantum key", std: "Done, owner locked out", sp: "Refused, needs the Home Key" },
  { act: "Withdraw savings", std: "Done", sp: "Refused, needs the Home Key, then 24 hours" },
  { act: "Spend today's pocket", std: "Done", sp: "Up to today's limit, until you close it", partial: true },
];

export function Landing() {
  return (
    <div className="landing">
      <header className="site-header wrap">
        <Link to="/" className="brand" aria-label="Seedproof home">
          <Logo />
          <span>Seedproof</span>
        </Link>
        <nav aria-label="Main" className="site-nav">
          <a href="#how">How it works</a>
          <a href="#steal">Steal this seed</a>
          <a href="#check">Check your account</a>
          <a href={REPO_URL}>GitHub</a>
          <Link to="/pocket" className="btn btn-ink">
            Set up Seedproof
          </Link>
        </nav>
      </header>

      <main className="wrap">
        <section id="steal" className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title" className="display display-xl">
              Here are my 24 words. Take them.
            </h1>
            <p className="lede">
              This testnet account's seed phrase is public on purpose. Its post-quantum key lives on a second device and is
              not made from these words, so they open today's pocket money and nothing else.
            </p>
            <div className="hero-actions">
              <a href="#ledger" className="btn btn-ink">
                Try to drain it
              </a>
              <a href="#how" className="btn btn-outline">
                How it works
              </a>
            </div>
            <p className="small muted">Every other vault in this fest survives a leaked key. Seedproof survives a leaked seed phrase.</p>
          </div>

          <figure className="seed-card">
            <figcaption className="seed-card-head">
              <span className="display display-s">Recovery phrase</span>
              <span className="small muted">
                Testnet account {shortAddress(STEAL_THIS_SEED.address)}
                {STEAL_THIS_SEED.isSample ? ", sample until funded" : ", funded"}
              </span>
            </figcaption>
            <ol className="seed-grid">
              {STEAL_THIS_SEED.words.map((w, i) => (
                <li key={i}>
                  <span className="seed-n">{i + 1}</span>
                  <span className="seed-word">{w}</span>
                </li>
              ))}
            </ol>
            <div id="ledger" className="ledger">
              <div className="ledger-cell ledger-pocket">
                <span className="tiny">Open to these words</span>
                <span className="ledger-num">20 fUSD</span>
                <span className="tiny">Today's pocket window, 5 payments max</span>
              </div>
              <div className="ledger-cell ledger-home">
                <span className="tiny">Locked at home</span>
                <span className="ledger-num">1,000 fUSD</span>
                <span className="tiny">Needs the Home Key and a 24 hour wait</span>
              </div>
              <div className="ledger-cell ledger-last">
                <span className="tiny">Last attempt</span>
                <span className="ledger-num ledger-refused">Refused</span>
                <span className="tiny">Native send, post-quantum signature did not match</span>
              </div>
            </div>
          </figure>
        </section>

        <section className="block" aria-labelledby="open-title">
          <h2 id="open-title" className="display display-l narrow">What a stolen seed phrase opens</h2>
          <div className="table-box">
            <table className="compare">
              <thead>
                <tr>
                  <th scope="col">The thief tries to</th>
                  <th scope="col">A standard QoreChain account</th>
                  <th scope="col">A Seedproof account</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.act}>
                    <th scope="row">{r.act}</th>
                    <td className="bad">{r.std}</td>
                    <td className={r.partial ? "partial" : "good"}>{r.sp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted narrow-text">
            A standard account's post-quantum key is made from the same 24 words. The QoreX docs say it plainly: the key needs no
            separate backup. Accounts made from a raw private key with SDK 0.12 or earlier made it from that key instead.
          </p>
        </section>

        <section id="how" className="block" aria-labelledby="how-title">
          <h2 id="how-title" className="display display-l narrow">Two devices. Neither holds both keys.</h2>
          <div className="duo">
            <article className="duo-card duo-pocket">
              <h3 className="display display-m">Pocket</h3>
              <p>
                Your phone. It keeps the classical key from your 24 words and spends freely inside today's window: a few payments,
                to the token you chose, until tonight.
              </p>
              <ul>
                <li>Shows what a thief could take right now</li>
                <li>Asks the Home Key for anything bigger</li>
                <li>Never holds the post-quantum key</li>
              </ul>
              <Link to="/pocket" className="btn duo-btn-pocket">
                Open Pocket
              </Link>
            </article>
            <article className="duo-card duo-home">
              <h3 className="display display-m">Home Key</h3>
              <p>A second device that stays home, even an old phone with no network. It holds a post-quantum key that no seed phrase can rebuild.</p>
              <ul>
                <li>Reads every request back to you in plain words</li>
                <li>Refuses anything it cannot read</li>
                <li>Can be rebuilt by 2 of your 3 guardians if lost</li>
              </ul>
              <Link to="/home-key" className="btn btn-brass">
                Open Home Key
              </Link>
            </article>
          </div>
        </section>

        <section className="block why" aria-labelledby="why-title">
          <h2 id="why-title" className="display display-l">People lose their words, not their keys</h2>
          <div className="why-text">
            <p>
              On Christmas Eve 2025 a tampered Trust Wallet browser extension shipped a backdoor that sent users' recovery
              phrases to an attacker. Infostealers now search hundreds of wallet extensions for them. And in 2025 CertiK counted 72
              attacks where someone was physically forced to open their wallet.
            </p>
            <p>Each of these takes the 24 words. On QoreChain today, the 24 words are both keys. Seedproof makes them one.</p>
          </div>
        </section>

        <section id="check" className="block" aria-labelledby="check-title">
          <Suspense fallback={<p className="small muted">Loading the check…</p>}>
            <ExposureCheck />
          </Suspense>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap footer-inner">
          <p>Seedproof is a testnet prototype for Build Before Q-Day, the QoreChain developer fest. Not audited. Do not use real funds.</p>
          <p>
            <a href={REPO_URL}>Source on GitHub</a>, MIT licence
          </p>
        </div>
      </footer>
    </div>
  );
}
