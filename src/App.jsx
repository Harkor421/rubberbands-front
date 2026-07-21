import React, { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * Rubberbands & More — hold the coin, collect the dollar.
 * The drawer accumulates ETH (creator fees). Every 5 minutes it hands $1 of
 * ETH to every holder — biggest bags first — until it runs out. Live over
 * WebSocket (rubberbands-back); demo offline.
 */

const WS_URL = import.meta.env.VITE_WS_URL || "wss://rubberbands-back-production.up.railway.app";
const STATIC_CA = import.meta.env.VITE_CA || "";
const BUY_BASE = (import.meta.env.VITE_BUY_URL || "https://www.noxa.fun").replace(/\/$/, "");
const EXPLORER = (import.meta.env.VITE_EXPLORER || "https://robinhoodchain.blockscout.com").replace(/\/$/, "");
const TICKER = (import.meta.env.VITE_TICKER || "RBM").toUpperCase();

export default function App() {
  const [wsStatus, setWsStatus] = useState("connecting");
  const [demo, setDemo] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef({ tries: 0, timer: null });
  const demoTimerRef = useRef(null);

  const [mint, setMint] = useState(STATIC_CA);
  const [holders, setHolders] = useState([]);
  const [holderCount, setHolderCount] = useState(null);
  const [eligibleCount, setEligibleCount] = useState(null);
  const [cycle, setCycle] = useState(null); // cycle_state message from the dispenser
  const [payments, setPayments] = useState([]);
  const [copied, setCopied] = useState(false);
  const [lookup, setLookup] = useState("");
  const [toasts, setToasts] = useState([]);
  const nowTick = useNow(1000);
  const toastId = useRef(0);

  const connected = wsStatus === "connected";

  function pushToast(t) {
    const id = ++toastId.current;
    setToasts((p) => [...p, { id, ...t }].slice(-4));
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), t.big ? 8000 : 5200);
  }

  /* ------------------------------ websocket ----------------------------- */
  useEffect(() => {
    connectWS();
    demoTimerRef.current = setTimeout(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) enterDemo();
    }, 1200);
    return () => {
      try {
        wsRef.current?.close(1000, "shutdown");
        clearTimeout(reconnectRef.current.timer);
        clearTimeout(demoTimerRef.current);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connectWS() {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    let sock;
    try {
      sock = new WebSocket(WS_URL);
    } catch {
      return scheduleReconnect();
    }
    wsRef.current = sock;
    sock.addEventListener("open", () => {
      setWsStatus("connected");
      setDemo(false);
      reconnectRef.current.tries = 0;
    });
    sock.addEventListener("message", (ev) => {
      try {
        handleMessage(JSON.parse(ev.data));
      } catch {}
    });
    sock.addEventListener("close", () => {
      setWsStatus("disconnected");
      scheduleReconnect();
    });
    sock.addEventListener("error", () => {
      try {
        sock.close();
      } catch {}
    });
  }
  function scheduleReconnect() {
    const n = (reconnectRef.current.tries = (reconnectRef.current.tries || 0) + 1);
    reconnectRef.current.timer = setTimeout(connectWS, Math.min(1000 * 2 ** (n - 1), 10000));
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case "service_status":
        if (msg.ca && !STATIC_CA) setMint(msg.ca);
        return;
      case "holders_update": {
        setHolders(Array.isArray(msg.holders) ? msg.holders : []);
        if (Number.isFinite(msg.totalHolders)) setHolderCount(msg.totalHolders);
        if (Number.isFinite(msg.eligibleHolders)) setEligibleCount(msg.eligibleHolders);
        if (msg.mint && !STATIC_CA) setMint(msg.mint);
        return;
      }
      case "cycle_state":
        setCycle(msg);
        return;
      case "distribution_result":
        if (msg.count > 0)
          pushToast({
            big: msg.count >= 10,
            title: `$${fmtNum(msg.totalUsd)} HANDED OUT`,
            body: `${msg.count} holder${msg.count === 1 ? "" : "s"} got their dollar${msg.ranOut ? " — drawer ran out before the tail" : ""}. Check your wallet.`,
          });
        return;
      case "payments_update":
        if (Array.isArray(msg.payments) && msg.payments.length)
          setPayments((prev) => [...prev, ...msg.payments].slice(-200));
        return;
      default:
        return;
    }
  }

  /* ------------------------------ demo mode ----------------------------- */
  const demoRef = useRef({ potEth: 0.0052, ethUsd: 3600, nextPayTs: 0, paidUsd: 8214, payouts: 8214 });
  function demoState(d) {
    return {
      type: "cycle_state",
      potEth: d.potEth,
      potUsd: d.potEth * d.ethUsd,
      ethUsd: d.ethUsd,
      payoutUsd: 1,
      payEveryMs: 300000,
      nextPayTs: d.nextPayTs,
      coverage: Math.floor(d.potEth * d.ethUsd),
      eligibleHolders: 20,
      paidUsdTotal: d.paidUsd,
      paidEthTotal: d.paidUsd / d.ethUsd,
      payoutsTotal: d.payouts,
      mcapUsd: 92_500,
      running: true,
      dryRun: true,
      ts: Date.now(),
    };
  }
  function enterDemo() {
    setDemo(true);
    const d = demoRef.current;
    d.nextPayTs = Date.now() + 45_000;
    const hs = makeDemoHolders();
    setHolders(hs);
    setHolderCount(1187);
    setEligibleCount(hs.length);
    setCycle(demoState(d));
    setPayments(
      hs.slice(0, 9).map((h, i) => ({
        to: h.owner,
        usd: 1,
        eth: 1 / d.ethUsd,
        rank: h.rank,
        sig: `demo-${i}`,
        ts: Date.now() - i * 45000,
      }))
    );
  }
  useEffect(() => {
    if (!demo) return;
    const id = setInterval(() => {
      const d = demoRef.current;
      d.potEth += 0.00012 + Math.random() * 0.0004; // fees trickling in
      if (Date.now() >= d.nextPayTs) {
        d.nextPayTs = Date.now() + 45_000; // fast cycle so the preview stays alive
        const hs = holdersRef.current;
        const count = Math.min(Math.floor(d.potEth * d.ethUsd), hs.length);
        if (count > 0) {
          d.potEth -= count / d.ethUsd;
          d.paidUsd += count;
          d.payouts += count;
          demoBurst(count);
          pushToast({
            title: `$${count} HANDED OUT`,
            body: `${count} holders got their dollar${count < hs.length ? " — drawer ran out before the tail" : ""}.`,
          });
        }
      }
      setCycle(demoState(d));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);
  const holdersRef = useRef([]);
  holdersRef.current = holders;
  function demoBurst(count) {
    const d = demoRef.current;
    const pays = holdersRef.current.slice(0, count).map((h) => ({
      to: h.owner,
      usd: 1,
      eth: 1 / d.ethUsd,
      rank: h.rank,
      sig: `sim-${Date.now().toString(16)}-${h.owner.slice(2, 6)}`,
      ts: Date.now(),
    }));
    setHolders((prev) => prev.map((h) => (h.rank <= count ? { ...h, paidUsd: (h.paidUsd || 0) + 1 } : h)));
    setPayments((prev) => [...prev, ...pays].slice(-200));
  }

  /* ------------------------------- derived ------------------------------ */
  const displayCA = mint || "";
  const buyUrl = displayCA ? `${BUY_BASE}/token/${displayCA}` : BUY_BASE;
  const live = Boolean(cycle?.running);
  const potEth = cycle?.potEth ?? null;
  const potUsd = cycle?.potUsd ?? null;
  const payoutUsd = cycle?.payoutUsd ?? 1;
  const coverage = cycle?.coverage ?? null;
  const paidUsd = cycle?.paidUsdTotal ?? 0;
  const payoutsTotal = cycle?.payoutsTotal ?? 0;
  const paySecs = cycle?.nextPayTs ? Math.max(0, Math.ceil((cycle.nextPayTs - nowTick) / 1000)) : null;
  const paidAnim = useCountUp(paidUsd, 900);
  const holdersAnim = useCountUp(holderCount ?? 0, 900);
  const lineAnim = useCountUp(eligibleCount ?? 0, 900);
  const payoutsAnim = useCountUp(payoutsTotal, 900);
  const feed = useMemo(() => [...payments].slice(-40).reverse(), [payments]);
  const lookupResult = useMemo(() => {
    const q = lookup.trim().toLowerCase();
    if (!q) return null;
    return holders.find((h) => h.owner.toLowerCase() === q) || null;
  }, [lookup, holders]);

  const copyCA = async () => {
    if (!displayCA) return;
    try {
      await navigator.clipboard.writeText(displayCA);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  /* -------------------------------- render ------------------------------ */
  return (
    <div className="wrap">
      {/* rolling office-tape ticker */}
      <div className="tape" aria-hidden="true">
        <div className="tape-track">
          {[0, 1].map((rep) => (
            <span key={rep} className="tape-group">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="tape-item">
                  HOLD ${TICKER} — GET $1 <BandLoop size={22} /> EVERY 5 MINUTES <BandLoop size={22} /> BIGGEST BAGS FIRST <BandLoop size={22} /> NO CLAIMING <BandLoop size={22} />
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <header className="nav">
        <a className="brand" href="#top">
          <BandBall size={42} className="brand-ball" />
          <span className="brand-name">Rubberbands <em>&amp;</em> More</span>
        </a>
        <nav className="nav-r">
          <a className="nav-link" href="#how">How it works</a>
          <a className="nav-link" href="#paid">Paid</a>
          <a className="nav-link" href="#spot">Your spot</a>
          <a className="btn chunky" href={buyUrl} target="_blank" rel="noreferrer">GET ${TICKER}</a>
        </nav>
      </header>

      <main className="page" id="top">
        {/* hero: split — pitch left, dispenser right */}
        <section className="hero">
          <span className="deco deco-pin1"><Pin color="#ffd21f" /></span>
          <span className="deco deco-pin2"><Pin color="#3b6fe0" /></span>
          <span className="deco deco-band1"><BandLoop size={64} loose /></span>
          <span className="deco deco-band2"><BandLoop size={46} loose /></span>

          <div className="hero-l">
            <Reveal><span className="eyebrow">office supplies pay better than your job</span></Reveal>
            <Reveal delay={0.08}><h1 className="mega">
              <span className="mega-line">HOLD ${TICKER}.</span>
              <span className="mega-line hot">GET $1.</span>
              <span className="mega-line">EVERY 5 MIN.</span>
            </h1></Reveal>
            <Reveal delay={0.16}><p className="hero-sub">
              <strong>Rubberbands &amp; More</strong> is stupid simple: creator fees pile up
              in the drawer. Every <strong>5 minutes</strong> we hand{" "}
              <strong>$1 in ETH</strong> to every holder — <strong>biggest bags
              first</strong> — until the drawer runs out. No staking. No claiming.
              Just a dollar, on the dot.
            </p></Reveal>
            <Reveal delay={0.24} className="hero-cta">
              <a className="btn chunky big" href={buyUrl} target="_blank" rel="noreferrer">GET ${TICKER} <BandBall size={24} bare /></a>
              <a className="btn hollow" href="#how">how it works</a>
            </Reveal>
            {displayCA && (
              <Reveal delay={0.3}><button className={`ca ${copied ? "copied" : ""}`} onClick={copyCA}>
                <span className="ca-tag">CA</span>
                <span className="ca-val">{displayCA}</span>
                <span className="ca-copy">{copied ? "copied!" : "copy"}</span>
              </button></Reveal>
            )}
          </div>

          <Reveal delay={0.15}>
          <aside className="drawer">
            <span className="drawer-pin"><Pin color="#e8501f" /></span>
            <div className="drawer-head">
              <span className="drawer-title">The Drawer</span>
              <span className={`led ${live ? "on" : ""}`}>{live ? "● PAYING OUT" : demo ? "● PREVIEW" : "○ RESTOCKING"}</span>
            </div>
            <div className="drawer-timer">
              <span className="dt-label">next dollar drop in</span>
              <span className={`dt-clock ${paySecs != null && paySecs <= 10 ? "soon" : ""}`}>{paySecs == null ? "--:--" : fmtClock(paySecs)}</span>
            </div>
            <div className="drawer-rows">
              <div className="dr">
                <span>In the drawer</span>
                <b>{potEth == null ? "—" : `${fmtQty(potEth)} ETH`}</b>
              </div>
              <div className="dr">
                <span>Drawer value</span>
                <b>{potUsd == null ? "—" : `$${fmtNum(potUsd)}`}</b>
              </div>
              <div className="dr">
                <span>Covers this round</span>
                <b>{coverage == null ? "—" : `${Math.min(coverage, eligibleCount ?? coverage).toLocaleString()} of ${(eligibleCount ?? 0).toLocaleString()} holders`}</b>
              </div>
              <div className="dr">
                <span>Payout</span>
                <b>${fmtNum(payoutUsd)} per holder</b>
              </div>
            </div>
            <p className="drawer-note">
              {live
                ? `Paid top-down by bag size. Hold ≥${cycle?.minEligiblePct ?? 0.1}% of $${TICKER} and you're in the line.`
                : `Payouts start the moment $${TICKER} trades. Get your spot in line.`}
            </p>
          </aside>
          </Reveal>
        </section>

        {/* stat strip */}
        <section className="stats">
          <Reveal><div className="stat"><b>{holderCount == null ? "—" : Math.round(holdersAnim).toLocaleString()}</b><span>holders</span><Smiley /></div></Reveal>
          <Reveal delay={0.07}><div className="stat"><b>{eligibleCount == null ? "—" : Math.round(lineAnim).toLocaleString()}</b><span>in line</span><Smiley /></div></Reveal>
          <Reveal delay={0.14}><div className="stat"><b>{payoutsTotal ? Math.round(payoutsAnim).toLocaleString() : "—"}</b><span>dollars dropped</span><Smiley /></div></Reveal>
          <Reveal delay={0.21}><div className="stat"><b>{paidUsd ? `$${fmtNum(paidAnim)}` : "—"}</b><span>paid to holders</span><Smiley /></div></Reveal>
        </section>

        {/* how it works — three pinned notes */}
        <section className="how" id="how">
          <Reveal><h2 className="h2">HOW THE DOLLARS GET DROPPED</h2></Reveal>
          <div className="steps">
            <Reveal><div className="step s1">
              <span className="step-pin"><Pin color="#ffd21f" /></span>
              <span className="step-n">01</span>
              <h3>FEES FILL THE DRAWER</h3>
              <p>Every trade of ${TICKER} sends creator fees (ETH) to the drawer wallet. It's public — watch it stack on-chain.</p>
            </div></Reveal>
            <Reveal delay={0.1}><div className="step s2">
              <span className="step-pin"><Pin color="#3b6fe0" /></span>
              <span className="step-n">02</span>
              <h3>WE COUNT THE DRAWER</h3>
              <p>Every 5 minutes: drawer ÷ <strong>$1</strong> = how many holders get paid this round. ETH price checked live, so a dollar is a dollar.</p>
            </div></Reveal>
            <Reveal delay={0.2}><div className="step s3">
              <span className="step-pin"><Pin color="#e8501f" /></span>
              <span className="step-n">03</span>
              <h3>$1 HITS YOUR WALLET</h3>
              <p>From the <strong>biggest bag down</strong>, every holder with <strong>≥0.1%</strong> of supply gets $1 of native ETH till it runs out. No claiming, ever.</p>
            </div></Reveal>
          </div>
          <Reveal className="math" delay={0.1}>your spot = your rank by bag · payout = $1 flat · every 5 minutes · till the drawer runs out</Reveal>
        </section>

        {/* paid feed */}
        <section className="paid" id="paid">
          <Reveal className="paid-head">
            <h2 className="h2">PAID SO FAR</h2>
            <div className="paid-total">
              <span className="pt-num">${fmtNum(paidAnim)}</span>
              <span className="pt-l">{payoutsTotal > 0 ? `${payoutsTotal.toLocaleString()} dollars dropped and counting` : "the counter starts at launch"}</span>
            </div>
          </Reveal>
          <Reveal delay={0.1} className="feed">
            {feed.length ? feed.map((p, i) => (
              <div className="f-row" key={`${p.sig}-${i}`}>
                <BandBall size={20} bare className="f-ball" />
                <span className="f-tag">PAID</span>
                <span className="f-amt">${fmtNum(p.usd ?? 1)}</span>
                <span className="f-dim">→</span>
                <a className="f-to" href={`${EXPLORER}/address/${p.to}`} target="_blank" rel="noreferrer">
                  {shortAddr(p.to)}
                </a>
                {p.rank != null && <span className="f-rank">#{p.rank}</span>}
                <span className="f-eth">{fmtQty(p.eth)} ETH</span>
                <span className="f-time">{fmtTime(p.ts)}</span>
                {String(p.sig).startsWith("demo") || String(p.sig).startsWith("sim") || String(p.sig).startsWith("0xSIM") || String(p.sig).startsWith("sent-") ? (
                  <span className="f-tx">sim</span>
                ) : (
                  <a className="f-tx" href={`${EXPLORER}/tx/${encodeURIComponent(p.sig)}`} target="_blank" rel="noreferrer">tx ↗</a>
                )}
              </div>
            )) : (
              <div className="f-empty">{connected ? "First dollar drops after launch…" : "Opening the drawer…"}</div>
            )}
          </Reveal>
        </section>

        {/* your spot */}
        <section className="spot" id="spot">
          <Reveal>
          <h2 className="h2">YOUR SPOT IN LINE</h2>
          <p className="spot-sub">Paste your wallet. The line is sorted by bag size — the drawer pays top-down.</p>
          <div className="checker">
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="0xYourWallet…"
              spellCheck={false}
            />
            {lookup && (
              <button className="checker-x" onClick={() => setLookup("")} aria-label="Clear">×</button>
            )}
          </div>
          {lookup.trim() && (
            <SpotResult holder={lookupResult} query={lookup.trim()} coverage={coverage} payoutUsd={payoutUsd} minPct={cycle?.minEligiblePct ?? 0.1} />
          )}
          </Reveal>
        </section>
      </main>

      <footer className="foot">
        <BandBall size={44} className="foot-ball" />
        <p>© 2026 Rubberbands &amp; More — office supplies, not financial advice. Bands snap; the risk is yours.</p>
      </footer>

      {/* toasts */}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div className={`toast ${t.big ? "big" : ""}`} key={t.id}>
            <BandBall size={34} bare className="toast-ball" />
            <div>
              <div className="toast-t">{t.title}</div>
              <div className="toast-b">{t.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ pieces --------------------------------- */
/* blur-fade reveal on scroll (Magic UI-style BlurFade, no deps) */
function Reveal({ className = "", delay = 0, children, ...rest }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -36px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`rev ${inView ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}s` }} {...rest}>
      {children}
    </div>
  );
}

/* the mascot — a ball of rubberbands with googly eyes */
function BandBall({ size = 32, bare = false, className = "" }) {
  const id = useId().replace(/[:]/g, "");
  return (
    <svg className={`ball ${className}`} width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <clipPath id={`bc-${id}`}><circle cx="60" cy="74" r="42" /></clipPath>
      </defs>
      <circle cx="60" cy="74" r="42" fill="#e2cb79" />
      <g clipPath={`url(#bc-${id})`} fill="none" strokeLinecap="round">
        <ellipse cx="60" cy="74" rx="41" ry="33" stroke="#efdf9b" strokeWidth="5" />
        <ellipse cx="60" cy="74" rx="41.5" ry="15.5" transform="rotate(-24 60 74)" stroke="#d8bc63" strokeWidth="5.5" />
        <ellipse cx="60" cy="74" rx="40.5" ry="24" transform="rotate(38 60 74)" stroke="#c7a94f" strokeWidth="5" />
        <ellipse cx="60" cy="74" rx="41.5" ry="9" transform="rotate(72 60 74)" stroke="#8e9d68" strokeWidth="4.6" />
        <ellipse cx="60" cy="74" rx="40.5" ry="28" transform="rotate(-58 60 74)" stroke="#cb854e" strokeWidth="5" />
        <ellipse cx="60" cy="74" rx="38" ry="20" transform="rotate(12 60 74)" stroke="#e5d48d" strokeWidth="4.6" />
        <ellipse cx="60" cy="74" rx="41" ry="30" transform="rotate(60 60 74)" stroke="#d9c06b" strokeWidth="4.2" />
        <ellipse cx="60" cy="74" rx="36" ry="12" transform="rotate(-40 60 74)" stroke="#b49f52" strokeWidth="4.2" />
        <path d="M28 55 Q35 40 50 36" stroke="#f7ecb6" strokeWidth="5" />
      </g>
      <circle cx="60" cy="74" r="42" fill="none" stroke="#b89a4e" strokeWidth="1.6" opacity="0.55" />
      {!bare && (
        <>
          <circle cx="44" cy="37" r="15" fill="#fff" />
          <circle cx="46.8" cy="39.8" r="7.1" fill="#141414" />
          <circle cx="77" cy="43" r="13.2" fill="#fff" />
          <circle cx="79" cy="45.8" r="6.3" fill="#141414" />
          <path d="M28 21 Q42 9 57 16" fill="none" stroke="#141414" strokeWidth="5.5" strokeLinecap="round" />
          <path d="M66 28 Q77 17 91 24" fill="none" stroke="#141414" strokeWidth="5" strokeLinecap="round" />
        </>
      )}
      {bare && (
        <>
          <circle cx="47" cy="60" r="9" fill="#fff" />
          <circle cx="48.6" cy="62" r="4.3" fill="#141414" />
          <circle cx="72" cy="63" r="8" fill="#fff" />
          <circle cx="73.2" cy="65" r="3.8" fill="#141414" />
        </>
      )}
    </svg>
  );
}

/* a loose rubberband — the ∞-ish squiggle from the banner */
function BandLoop({ size = 24, loose = false, className = "" }) {
  return (
    <svg className={`bandloop ${className}`} width={size} height={size * 0.5} viewBox="0 0 64 32" fill="none" aria-hidden="true">
      <path
        d="M6 16 C6 7 20 7 24 14 C28 21 36 21 40 14 C44 7 58 7 58 16 C58 25 44 25 40 18 C36 11 28 11 24 18 C20 25 6 25 6 16 Z"
        stroke={loose ? "#e2cb79" : "currentColor"}
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* a pushpin, claymation style */
function Pin({ color = "#ffd21f", size = 26 }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 26 33" fill="none" aria-hidden="true">
      <ellipse cx="13" cy="9" rx="9" ry="8" fill={color} />
      <ellipse cx="10" cy="6.4" rx="3.2" ry="2.6" fill="#fff" opacity="0.5" />
      <rect x="10.6" y="15" width="4.8" height="7" rx="2" fill={color} />
      <path d="M13 22 L13 31" stroke="#8b8b8b" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/* a tiny corner smiley, like the faces on the staplers */
function Smiley() {
  return (
    <svg className="smiley" width="18" height="10" viewBox="0 0 18 10" fill="none" aria-hidden="true">
      <circle cx="3" cy="2.4" r="1.9" fill="currentColor" />
      <circle cx="15" cy="2.4" r="1.9" fill="currentColor" />
      <path d="M5 6.2 Q9 10 13 6.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function SpotResult({ holder, query, coverage, payoutUsd, minPct }) {
  if (!holder) {
    return (
      <div className="spot-res miss">
        <b>{query.length > 16 ? shortAddr(query) : query}</b> isn't in the line yet — it holds less
        than {minPct}% of the supply. Top up and the drawer includes you automatically.
      </div>
    );
  }
  const covered = coverage != null && holder.rank <= coverage;
  return (
    <div className="spot-res">
      <div className="spot-grid">
        <div>
          <span className="sg-l">spot in line</span>
          <span className="sg-v">#{holder.rank}</span>
        </div>
        <div>
          <span className="sg-l">holds</span>
          <span className="sg-v">{holder.percentage?.toFixed(2)}%</span>
        </div>
        <div>
          <span className="sg-l">next round</span>
          <span className={`sg-v ${covered ? "hi" : ""}`}>
            {coverage == null ? "—" : covered ? `$${fmtNum(payoutUsd)} incoming` : "drawer's short"}
          </span>
        </div>
        <div>
          <span className="sg-l">collected so far</span>
          <span className="sg-v hi">${fmtNum(holder.paidUsd || 0)}</span>
        </div>
      </div>
      {!covered && coverage != null && (
        <p className="spot-note">
          The drawer covers {coverage.toLocaleString()} spot{coverage === 1 ? "" : "s"} right now — about{" "}
          <b>${fmtNum((holder.rank - coverage) * payoutUsd)}</b> more in fees and the line reaches you.
        </p>
      )}
    </div>
  );
}

/* ------------------------------- hooks --------------------------------- */
function useNow(ms) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}
function useCountUp(target, duration = 800) {
  const [val, setVal] = useState(typeof target === "number" ? target : 0);
  const fromRef = useRef(typeof target === "number" ? target : 0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (typeof target !== "number") return;
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      const e = 1 - Math.pow(1 - t, 3);
      setVal(from + (to - from) * e);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return val;
}

/* ------------------------------- utils --------------------------------- */
function shortAddr(s) {
  return s && s.length > 12 ? `${s.slice(0, 5)}…${s.slice(-4)}` : s || "—";
}
function fmtNum(n) {
  const v = Number(n || 0);
  if (!isFinite(v)) return "0";
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  if (Math.abs(v) >= 10) return v.toFixed(0);
  return v.toFixed(2);
}
function fmtQty(n) {
  const v = Number(n || 0);
  if (!isFinite(v) || v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (a >= 1000) return Math.round(v).toLocaleString();
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  return v.toFixed(5);
}
function fmtClock(t) {
  const s = Math.max(0, Math.floor(t));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
function fmtTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function makeDemoHolders() {
  const addr = () => "0x" + Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  const rows = [];
  const N = 20;
  for (let i = 0; i < N; i++) {
    const pct = Math.max(0.12, Number((8.5 * Math.pow(0.87, i) + Math.random() * 0.4).toFixed(2)));
    rows.push({ owner: addr(), percentage: pct });
  }
  rows.sort((a, b) => b.percentage - a.percentage);
  return rows.map((r, i) => ({ ...r, rank: i + 1, amount: r.percentage, paidUsd: Math.max(0, 400 - i * 21), paidCount: 0 }));
}
