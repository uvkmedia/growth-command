import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { ChevronDown, TrendingDown, TrendingUp, Target, Zap, AlertTriangle } from "lucide-react";

/* ================================================================== */
/*  LIVE FEED — reads your n8n dashboard-data endpoint                 */
/* ================================================================== */
const FEED = "https://uvk.app.n8n.cloud/webhook/dashboard-data";

const TARGET = { cac: 1800 };
const todayStr = () => new Date().toISOString().slice(0, 10);
const agoStr = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);

/* ---- normalizers ------------------------------------------------- */
const NICHE_CANON = [
  [/chiro/i, "Chiropractic"],
  [/neurofeedback|nfb/i, "Neurofeedback"],
  [/function|fun ?med|\bfm\b/i, "Functional Medicine"],
  [/neuropath|npy/i, "Neuropathy"],
  [/shock/i, "Shockwave"],
  [/decomp/i, "Spinal Decompression"],
  [/retarget|warm/i, "Retargeting"],
];
function canonNiche(s) {
  s = String(s || "");
  for (const [re, n] of NICHE_CANON) if (re.test(s)) return n;
  const t = s.trim();
  return t || "Unmapped";
}
function num(v) {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? 0 : n;
}
function trimKeys(o) {
  const r = {};
  for (const k in o) r[String(k).trim()] = o[k];
  return r;
}
function tms(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.getTime();
}
// classify a GHL pipeline status string into funnel stages
function classify(status) {
  const s = String(status || "").toLowerCase();
  const noShow = /no[\s-]?show/.test(s);
  const closed = (/close/.test(s) && !/no close/.test(s)) || /\bwon\b/.test(s);
  const showed = closed || (!noShow && /show|open|demo|proposal/.test(s));
  return { noshow: noShow && !showed, show: showed, close: closed };
}

/* ---- format helpers ---------------------------------------------- */
const usd = (n, dec = 0) =>
  n === Infinity || isNaN(n) ? "—" :
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const nf = (n) => Number(n).toLocaleString("en-US");
const pctf = (n) => (isNaN(n) ? "—" : (n * 100).toFixed(0) + "%");

function useCountUp(target, ms = 600) {
  const [v, setV] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target); prev.current = target; return;
    }
    const from = prev.current, to = target, start = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/* ---- UI pieces --------------------------------------------------- */
function Dropdown({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="dd" ref={ref}>
      <span className="dd-label">{label}</span>
      <button className="dd-btn" onClick={() => setOpen((o) => !o)}>
        <span>{value}</span><ChevronDown size={13} strokeWidth={2.5} style={{ opacity: 0.55 }} />
      </button>
      {open && (
        <div className="dd-menu">
          {options.map((o) => (
            <button key={o} className={"dd-item" + (o === value ? " active" : "")}
              onClick={() => { onChange(o); setOpen(false); }}>{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone, delta, money }) {
  const isNum = typeof value === "number";
  const animated = useCountUp(isNum ? value : 0);
  const display = isNum ? (money ? usd(animated) : nf(Math.round(animated))) : value;
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={"kpi-val " + (tone || "")}>{display}</div>
      <div className="kpi-foot">
        <span className="kpi-sub">{sub}</span>
        {delta != null && (
          <span className={"kpi-delta " + (delta <= 0 ? "good" : "bad")}>
            {delta <= 0 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}{Math.abs(delta)}%
          </span>
        )}
      </div>
    </div>
  );
}

function EffBar({ value, target }) {
  const ratio = Math.min(1.6, value / target);
  const over = value > target;
  const color = over ? "var(--coral)" : ratio > 0.8 ? "var(--gold)" : "var(--teal)";
  return (
    <div className="effbar">
      <div className="effbar-track">
        <div className="effbar-fill" style={{ width: `${Math.min(100, (ratio / 1.6) * 100)}%`, background: color }} />
        <div className="effbar-target" style={{ left: `${(1 / 1.6) * 100}%` }} />
      </div>
    </div>
  );
}

/* ================================================================== */
export default function GrowthCommand() {
  const [raw, setRaw] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const [niche, setNiche] = useState("All");
  const [offer, setOffer] = useState("All");
  const [closer, setCloser] = useState("All");
  const [from, setFrom] = useState(agoStr(30));
  const [to, setTo] = useState(todayStr());

  useEffect(() => {
    let alive = true;
    fetch(FEED)
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((d) => { if (alive) { setRaw(d); setLoading(false); } })
      .catch((e) => { if (alive) { setErr(String(e.message || e)); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  // normalize the four sources once
  const src = useMemo(() => {
    if (!raw) return null;
    return {
      meta:  (raw.meta || []).map(trimKeys),
      appts: (raw.appointments || []).map(trimKeys),
      leads: (raw.leads || []).map(trimKeys),
      cash:  (raw.cash || []).map(trimKeys),
    };
  }, [raw]);

  const fromMs = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
  const toMs = to ? new Date(to + "T23:59:59").getTime() : Infinity;

  // filter options from real data
  const opts = useMemo(() => {
    if (!src) return { niches: ["All"], offers: ["All"], closers: ["All"] };
    const niches = new Set(), offers = new Set(), closers = new Set();
    src.meta.forEach((r) => { niches.add(canonNiche(r.niche)); if (r.offer) offers.add(r.offer); });
    src.appts.forEach((r) => { if (r["Closer"]) closers.add(r["Closer"]); });
    src.cash.forEach((r) => { if (r["Owner"]) closers.add(r["Owner"]); });
    return {
      niches: ["All", ...[...niches].filter(Boolean).sort()],
      offers: ["All", ...[...offers].filter(Boolean).sort()],
      closers: ["All", ...[...closers].filter(Boolean).sort()],
    };
  }, [src]);

  const model = useMemo(() => {
    if (!src) return null;

    const nMatch = (v) => niche === "All" || canonNiche(v) === niche;
    const inWin = (v) => { const t = tms(v); return t !== null && t >= fromMs && t <= toMs; };

    // META (spend / impressions) — offer applies strictly, closer N/A
    const fMeta = src.meta.filter((r) =>
      nMatch(r.niche) &&
      (offer === "All" || r.offer === offer) &&
      inWin(r.date));

    // APPOINTMENTS (funnel) — niche + closer; offer lenient (sales rows rarely carry offer)
    const fAppts = src.appts.filter((r) =>
      nMatch(r["Niche/Offer"]) &&
      (closer === "All" || r["Closer"] === closer) &&
      inWin(r["Date"]));

    // LEADS
    const fLeads = src.leads.filter((r) =>
      nMatch(r["Niche/Offer"]) &&
      (closer === "All" || r["Closer/Owner"] === closer) &&
      inWin(r["Date"]));

    // CASH — Funnel Source = niche, Owner = closer
    const fCash = src.cash.filter((r) =>
      nMatch(r["Funnel Source"]) &&
      (closer === "All" || r["Owner"] === closer) &&
      inWin(r["Date Created"]));

    // aggregates
    let spend = 0, impressions = 0;
    fMeta.forEach((r) => { spend += num(r.spend); impressions += num(r.impressions); });

    let booked = fAppts.length, shows = 0, noshows = 0, closes = 0;
    fAppts.forEach((r) => {
      const c = classify(r["Status (GHL Pipeline)"]);
      if (c.show) shows++; if (c.noshow) noshows++; if (c.close) closes++;
    });

    const leadsCount = fLeads.length;
    let cash = 0;
    fCash.forEach((r) => { cash += num(r["Amount"]); });

    const agg = { spend, impressions, booked, shows, noshows, closes, leadsCount, cash };
    agg.cac = closes ? spend / closes : Infinity;
    agg.cpShow = shows ? spend / shows : Infinity;
    agg.cashPerCall = shows ? cash / shows : 0;
    agg.roas = spend ? cash / spend : 0;

    // trend (spend from meta, booked from appts) by date
    const tmap = {};
    const key = (v) => { const t = tms(v); return t ? new Date(t).toISOString().slice(5, 10) : null; };
    fMeta.forEach((r) => { const k = key(r.date); if (!k) return; (tmap[k] ??= { date: k, spend: 0, booked: 0 }).spend += num(r.spend); });
    fAppts.forEach((r) => { const k = key(r["Date"]); if (!k) return; (tmap[k] ??= { date: k, spend: 0, booked: 0 }).booked += 1; });
    const trend = Object.values(tmap).sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, spend: Math.round(d.spend) }));

    // breakdown by NICHE (shared dimension across all sources)
    const bmap = {};
    const B = (n) => (bmap[n] ??= { niche: n, spend: 0, booked: 0, shows: 0, closes: 0, cash: 0 });
    fMeta.forEach((r) => { B(canonNiche(r.niche)).spend += num(r.spend); });
    fAppts.forEach((r) => { const o = B(canonNiche(r["Niche/Offer"])); o.booked++; const c = classify(r["Status (GHL Pipeline)"]); if (c.show) o.shows++; if (c.close) o.closes++; });
    fCash.forEach((r) => { B(canonNiche(r["Funnel Source"])).cash += num(r["Amount"]); });
    const breakdown = Object.values(bmap).map((o) => ({
      ...o, spend: Math.round(o.spend),
      cac: o.closes ? o.spend / o.closes : Infinity,
      showRate: o.booked ? o.shows / o.booked : NaN,
      closeRate: o.shows ? o.closes / o.shows : NaN,
    })).sort((a, b) => b.spend - a.spend);

    // top ads (meta only — real ad-level spend + Meta schedules; CAC needs attribution, later)
    const amap = {};
    fMeta.forEach((r) => {
      const k = r.ad_name || "(unnamed)";
      const o = (amap[k] ??= { ad: k, niche: canonNiche(r.niche), spend: 0, sched: 0 });
      o.spend += num(r.spend); o.sched += num(r.schedules);
    });
    const ads = Object.values(amap).map((o) => ({ ...o, spend: Math.round(o.spend), cps: o.sched ? o.spend / o.sched : Infinity }))
      .sort((a, b) => b.spend - a.spend);

    // closer scoreboard
    const cmap = {};
    fAppts.forEach((r) => {
      const k = r["Closer"] || "(none)";
      const o = (cmap[k] ??= { closer: k, shows: 0, closes: 0, cash: 0 });
      const c = classify(r["Status (GHL Pipeline)"]); if (c.show) o.shows++; if (c.close) o.closes++;
    });
    fCash.forEach((r) => { const k = r["Owner"] || "(none)"; (cmap[k] ??= { closer: k, shows: 0, closes: 0, cash: 0 }).cash += num(r["Amount"]); });
    const closers = Object.values(cmap).map((o) => ({ ...o, closeRate: o.shows ? o.closes / o.shows : NaN }))
      .sort((a, b) => b.cash - a.cash);

    return { agg, trend, breakdown, ads, closers };
  }, [src, niche, offer, closer, fromMs, toMs]);

  /* ---- render states ---- */
  if (loading) return <Shell><div className="state">Loading your live data…</div></Shell>;
  if (err) return (
    <Shell>
      <div className="state err">
        <AlertTriangle size={20} />
        <div>
          <div className="state-title">Couldn’t reach the feed</div>
          <div className="state-sub">{err}</div>
          <div className="state-hint">If it says “Failed to fetch”, it’s a CORS block — we add one response header to the n8n Respond node.</div>
        </div>
      </div>
    </Shell>
  );

  const a = model.agg;
  const funnel = [
    { label: "Leads", v: a.leadsCount, color: "var(--violet)" },
    { label: "Booked", v: a.booked, color: "var(--gold)" },
    { label: "Showed", v: a.shows, color: "var(--teal)" },
    { label: "Closed", v: a.closes, color: "var(--teal-bright)" },
  ];
  const fMax = Math.max(...funnel.map((f) => f.v), 1);

  return (
    <Shell>
      <header className="gc-head">
        <div className="brand">
          <div className="brand-mark"><Zap size={15} strokeWidth={2.5} /></div>
          <div>
            <div className="brand-name">GROWTH COMMAND</div>
            <div className="brand-sub">Clinic Growth Accelerator · live</div>
          </div>
        </div>
        <div className="filters">
          <Dropdown label="Niche" value={niche} options={opts.niches} onChange={setNiche} />
          <Dropdown label="Offer" value={offer} options={opts.offers} onChange={setOffer} />
          <Dropdown label="Closer" value={closer} options={opts.closers} onChange={setCloser} />
          <div className="dd">
            <span className="dd-label">Range</span>
            <div className="dr-row">
              <input type="date" className="dr-input" value={from} max={to || todayStr()} onChange={(e) => setFrom(e.target.value)} />
              <span className="dr-sep">→</span>
              <input type="date" className="dr-input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="dr-presets">
              {[["Today", 0, 0], ["Yest", 1, 1], ["3d", 3, 0], ["7d", 7, 0], ["14d", 14, 0], ["30d", 30, 0], ["60d", 60, 0], ["90d", 90, 0]].map(([l, f, t]) => (
                <button key={l} className="dr-chip" onClick={() => { setFrom(agoStr(f)); setTo(agoStr(t)); }}>{l}</button>
              ))}
              <button className="dr-chip" onClick={() => { setFrom(""); setTo(todayStr()); }}>All</button>
            </div>
          </div>
        </div>
      </header>

      <section className="kpis">
        <Kpi label="AD SPEND" value={a.spend} money sub={`${model.trend.length} days`} />
        <Kpi label="BOOKED" value={a.booked} sub={`${a.shows} showed · ${a.noshows} no-show`} />
        <Kpi label="CAC" value={a.cac === Infinity ? "—" : Math.round(a.cac)} money tone={a.cac > TARGET.cac ? "warn" : "ok"} sub={`target ${usd(TARGET.cac)}`} />
        <Kpi label="COST / SHOW" value={a.cpShow === Infinity ? "—" : Math.round(a.cpShow)} money sub={`${a.closes} closed`} />
        <Kpi label="CASH / CALL" value={Math.round(a.cashPerCall)} money tone="gold" sub={`${a.roas.toFixed(1)}x ROAS · ${usd(a.cash)}`} />
      </section>

      <section className="mid">
        <div className="panel trend-panel">
          <div className="panel-head">
            <h3>Spend vs Booked calls</h3>
            <div className="legend"><span><i className="sw sw-gold" /> Spend</span><span><i className="sw sw-teal" /> Booked</span></div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={model.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F0B54A" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#F0B54A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1E2836" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#58657A", fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={{ stroke: "#263042" }} interval={Math.max(0, Math.ceil(model.trend.length / 8))} />
              <YAxis yAxisId="l" tick={{ fill: "#58657A", fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: "#58657A", fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={false} width={26} />
              <Tooltip contentStyle={TT} labelStyle={{ color: "#EAEEF6", fontFamily: "IBM Plex Mono", fontSize: 11 }} formatter={(v, n) => [n === "spend" ? usd(v) : v, n === "spend" ? "Spend" : "Booked"]} />
              <Area yAxisId="l" type="monotone" dataKey="spend" stroke="#F0B54A" strokeWidth={2} fill="url(#gSpend)" />
              <Line yAxisId="r" type="monotone" dataKey="booked" stroke="#46C7B8" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="panel funnel-panel">
          <div className="panel-head"><h3>Funnel</h3></div>
          <div className="funnel">
            {funnel.map((f, i) => (
              <div key={f.label} className="fn-row">
                <div className="fn-top"><span className="fn-label">{f.label}</span><span className="fn-val">{f.v}</span></div>
                <div className="fn-track"><div className="fn-fill" style={{ width: `${(f.v / fMax) * 100}%`, background: f.color }} /></div>
                {i < funnel.length - 1 && funnel[i].v > 0 && <span className="fn-conv">{pctf(funnel[i + 1].v / funnel[i].v)} →</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Niche breakdown</h3>
          <span className="hint"><Target size={12} /> CAC vs {usd(TARGET.cac)} · spend÷closes</span>
        </div>
        <table className="tbl">
          <thead><tr>
            <th>Niche</th><th className="r">Spend</th><th className="r">Booked</th>
            <th className="r">Show %</th><th className="r">Close %</th><th className="cac-col">CAC</th><th className="r">Cash</th>
          </tr></thead>
          <tbody>
            {model.breakdown.map((b) => (
              <tr key={b.niche}>
                <td className="strong">{b.niche}</td>
                <td className="r mono">{usd(b.spend)}</td>
                <td className="r mono">{b.booked || "—"}</td>
                <td className="r mono">{pctf(b.showRate)}</td>
                <td className="r mono">{pctf(b.closeRate)}</td>
                <td className="cac-col"><div className="cac-cell">
                  <span className={"mono " + (b.cac > TARGET.cac ? "coral" : b.cac === Infinity ? "faint" : "teal")}>{b.cac === Infinity ? "—" : usd(b.cac)}</span>
                  {b.cac !== Infinity && <EffBar value={b.cac} target={TARGET.cac} />}
                </div></td>
                <td className="r mono gold-txt">{usd(b.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mid">
        <div className="panel">
          <div className="panel-head"><h3>Top ads · spend</h3><span className="hint">ad-level CAC comes with attribution</span></div>
          <table className="tbl compact">
            <thead><tr><th>Ad</th><th className="r">Spend</th><th className="r">Meta sched</th><th className="r">Cost/sched</th></tr></thead>
            <tbody>
              {model.ads.slice(0, 7).map((ad) => (
                <tr key={ad.ad}>
                  <td><span className="ad-name">{ad.ad}</span><span className="ad-niche">{ad.niche}</span></td>
                  <td className="r mono">{usd(ad.spend)}</td>
                  <td className="r mono">{ad.sched || "—"}</td>
                  <td className="r mono">{ad.cps === Infinity ? "—" : usd(ad.cps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Closer scoreboard</h3></div>
          <table className="tbl compact">
            <thead><tr><th>Closer</th><th className="r">Shows</th><th className="r">Close %</th><th className="r">Cash</th></tr></thead>
            <tbody>
              {model.closers.slice(0, 7).map((c) => (
                <tr key={c.closer}>
                  <td className="strong">{c.closer}</td>
                  <td className="r mono">{c.shows}</td>
                  <td className="r mono">{pctf(c.closeRate)}</td>
                  <td className="r mono gold-txt">{usd(c.cash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="gc-foot">
        Live · reads your Google Sheet via n8n · sales joins on niche · ad-level CAC fills in as attribution matures
      </footer>
    </Shell>
  );
}

function Shell({ children }) {
  return <div className="gc-root"><style>{CSS}</style>{children}</div>;
}

const TT = { background: "#151C28", border: "1px solid #263042", borderRadius: 8, fontSize: 11 };

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.gc-root{
  --ink:#0C121B; --panel:#141B27; --panel2:#19212F; --line:#263042; --line-soft:#1E2836;
  --text:#EAEEF6; --dim:#8794A8; --faint:#556377;
  --gold:#F0B54A; --gold-soft:rgba(240,181,74,.12);
  --teal:#46C7B8; --teal-bright:#5FE0CF; --coral:#EB6A57; --violet:#7B8CF4;
  background:var(--ink); color:var(--text); font-family:'Inter',system-ui,sans-serif;
  min-height:100%; padding:22px; box-sizing:border-box;
  background-image:radial-gradient(1200px 500px at 78% -10%, rgba(240,181,74,.06), transparent 60%);
}
.gc-root *{box-sizing:border-box;}
.mono{font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums;}
.state{padding:60px 20px;text-align:center;color:var(--dim);font-size:14px;}
.state.err{display:flex;gap:14px;align-items:flex-start;justify-content:center;text-align:left;color:var(--coral);max-width:560px;margin:40px auto;}
.state-title{font-family:'Space Grotesk';font-weight:600;font-size:15px;color:var(--text);}
.state-sub{font-family:'IBM Plex Mono';font-size:12px;color:var(--coral);margin-top:4px;word-break:break-all;}
.state-hint{font-size:12px;color:var(--dim);margin-top:10px;}
.gc-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px;}
.brand{display:flex;align-items:center;gap:11px;}
.brand-mark{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:linear-gradient(135deg,var(--gold),#c98f2b);color:#1a1305;box-shadow:0 2px 12px rgba(240,181,74,.35);}
.brand-name{font-family:'Space Grotesk';font-weight:700;font-size:15px;letter-spacing:.14em;}
.brand-sub{font-size:11px;color:var(--dim);margin-top:1px;}
.filters{display:flex;gap:8px;flex-wrap:wrap;}
.dd{position:relative;}
.dd-label{display:block;font-size:9px;letter-spacing:.13em;color:var(--faint);text-transform:uppercase;margin-bottom:3px;padding-left:2px;}
.dd-btn{display:flex;align-items:center;gap:8px;justify-content:space-between;min-width:130px;background:var(--panel);border:1px solid var(--line);color:var(--text);padding:7px 10px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;}
.dd-btn:hover{border-color:#33415a;}
.dd-menu{position:absolute;z-index:30;top:100%;left:0;margin-top:4px;min-width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:4px;box-shadow:0 12px 34px rgba(0,0,0,.5);max-height:280px;overflow:auto;}
.dd-item{display:block;width:100%;text-align:left;background:none;border:none;color:var(--dim);padding:7px 9px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;}
.dd-item:hover{background:#222d3e;color:var(--text);}
.dd-item.active{color:var(--gold);background:var(--gold-soft);}
.dr-row{display:flex;align-items:center;gap:6px;}
.dr-input{background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:6px 8px;font-size:11.5px;font-family:'IBM Plex Mono',monospace;color-scheme:dark;}
.dr-input:hover{border-color:#33415a;}
.dr-sep{color:var(--faint);font-size:12px;}
.dr-presets{display:flex;gap:5px;margin-top:5px;}
.dr-chip{background:var(--panel);border:1px solid var(--line);color:var(--dim);border-radius:6px;padding:4px 9px;font-size:10.5px;cursor:pointer;font-family:inherit;}
.dr-chip:hover{border-color:#33415a;color:var(--text);}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px;}
.kpi{background:var(--panel);border:1px solid var(--line-soft);border-radius:12px;padding:15px 16px;position:relative;overflow:hidden;}
.kpi:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--line);}
.kpi-label{font-size:10px;letter-spacing:.14em;color:var(--faint);font-weight:600;}
.kpi-val{font-family:'IBM Plex Mono';font-weight:600;font-size:26px;margin-top:9px;letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1;}
.kpi-val.gold{color:var(--gold);}.kpi-val.ok{color:var(--teal);}.kpi-val.warn{color:var(--coral);}
.kpi-foot{display:flex;justify-content:space-between;align-items:center;margin-top:11px;gap:8px;}
.kpi-sub{font-size:10px;color:var(--dim);font-family:'IBM Plex Mono';}
.kpi-delta{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:600;font-family:'IBM Plex Mono';}
.kpi-delta.good{color:var(--teal);}.kpi-delta.bad{color:var(--coral);}
.mid{display:grid;grid-template-columns:1.9fr 1fr;gap:12px;margin-bottom:14px;}
.panel{background:var(--panel);border:1px solid var(--line-soft);border-radius:12px;padding:15px 16px;}
section.panel{margin-bottom:14px;}
.panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;}
.panel-head h3{margin:0;font-family:'Space Grotesk';font-weight:600;font-size:13px;letter-spacing:.02em;}
.hint{font-size:10px;color:var(--faint);display:inline-flex;align-items:center;gap:5px;text-align:right;}
.legend{display:flex;gap:14px;font-size:10.5px;color:var(--dim);}
.legend span{display:inline-flex;align-items:center;gap:6px;}
.sw{width:9px;height:9px;border-radius:2px;display:inline-block;}
.sw-gold{background:var(--gold);}.sw-teal{background:var(--teal);}
.funnel{display:flex;flex-direction:column;gap:14px;padding-top:2px;}
.fn-row{position:relative;}
.fn-top{display:flex;justify-content:space-between;margin-bottom:5px;}
.fn-label{font-size:11px;color:var(--dim);font-weight:500;}
.fn-val{font-family:'IBM Plex Mono';font-size:14px;font-weight:600;}
.fn-track{height:9px;background:#111826;border-radius:5px;overflow:hidden;}
.fn-fill{height:100%;border-radius:5px;transition:width .5s cubic-bezier(.4,0,.2,1);}
.fn-conv{position:absolute;right:0;top:-1px;font-size:9.5px;color:var(--faint);font-family:'IBM Plex Mono';}
.tbl{width:100%;border-collapse:collapse;font-size:12px;}
.tbl th{text-align:left;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);font-weight:600;padding:0 10px 9px;border-bottom:1px solid var(--line);}
.tbl th.r,.tbl td.r{text-align:right;}
.tbl td{padding:10px;border-bottom:1px solid var(--line-soft);}
.tbl tbody tr:last-child td{border-bottom:none;}
.tbl.compact td,.tbl.compact th{padding:8px 10px;}
.strong{font-weight:600;}.dim{color:var(--dim);}.faint{color:var(--faint);}
.gold-txt{color:var(--gold);}.teal{color:var(--teal);}.coral{color:var(--coral);}
.cac-col{width:150px;}
.cac-cell{display:flex;align-items:center;justify-content:flex-end;gap:9px;}
.effbar{width:64px;}
.effbar-track{position:relative;height:5px;background:#111826;border-radius:3px;}
.effbar-fill{position:absolute;left:0;top:0;bottom:0;border-radius:3px;transition:width .5s;}
.effbar-target{position:absolute;top:-2px;bottom:-2px;width:1.5px;background:var(--dim);opacity:.6;}
.ad-name{display:block;font-family:'IBM Plex Mono';font-size:11.5px;}
.ad-niche{display:block;font-size:9.5px;color:var(--faint);margin-top:1px;}
.gc-foot{margin-top:16px;text-align:center;font-size:10.5px;color:var(--faint);}
@media (max-width:820px){.kpis{grid-template-columns:repeat(2,1fr);}.mid{grid-template-columns:1fr;}.cac-col{width:auto;}.effbar{display:none;}}
`;
