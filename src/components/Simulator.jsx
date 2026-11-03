import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CONFIG, RAM_STEPS, SCENARIOS, VCPU_STEPS, advise, compute, findBreakingPoint, fmt, ms, pct, serverCapacity } from '../sim/model.js';
import SimMap, { STATUS_COLOR } from './SimMap.jsx';
import { Popover, Segmented, Slider, Sparkline, StepSlider, Toggle } from './ui.jsx';
import { PICKERS, STATION_INFO, TECH_DEFAULTS, shortTech } from '../sim/tech.js';
import { Info, NeedLists } from './Glossary.jsx';
import Methodology from './Methodology.jsx';
import { termsIn } from '../data/glossary.js';

const TICK_MS = 250;
const SPEEDS = [{ value: 2, label: '1×' }, { value: 10, label: '5×' }, { value: 40, label: '20×' }];
const HIST = 160;
const TIER_NAMES = { gateway: 'Gateway', lb: 'Load balancer', proxy: 'Reverse proxy', app: 'App tier', cache: 'Cache', db: 'Database', queue: 'Queue', workers: 'Workers' };
const SEV = { green: 0, amber: 1, red: 2, broken: 3, off: -1 };

function trafficMult(pattern, t, spikeUntil) {
  let m = 1;
  if (pattern === 'wave') m = 0.3 + 0.7 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 1800));
  if (pattern === 'ramp') m = Math.min(60, Math.exp(t / 420));
  if (pattern === 'spike') m = t % 600 > 420 && t % 600 < 540 ? 5 : 1;
  if (t < spikeUntil) m *= 5;
  return m;
}

const clock = (t) => {
  const s = Math.floor(t);
  return `T+${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const freshSim = (cfg) => ({ t: 0, servers: cfg.autoscale ? Math.min(cfg.asMax, Math.max(cfg.asMin, cfg.servers)) : cfg.servers, booting: [], backlog: 0, lastScale: -999, spikeUntil: -1, history: [], log: [], prev: {} });

export default function Simulator({ preset }) {
  const [cfg, setCfg] = useState(() => ({ ...DEFAULT_CONFIG, ...(preset?.patch || {}) }));
  const [sim, setSim] = useState(() => freshSim({ ...DEFAULT_CONFIG, ...(preset?.patch || {}) }));
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [selected, setSelected] = useState('app');
  const [bp, setBp] = useState(null);
  const [fs, setFs] = useState(false);
  const [fsInsp, setFsInsp] = useState(true);
  const [meth, setMeth] = useState(null);
  const closeMeth = useCallback(() => setMeth(null), []);

  // Full screen: the whole page goes full screen (so glossary pop-ups still show)
  // and the map panel covers the viewport via CSS.
  const toggleFs = () => {
    if (!fs) {
      setFs(true);
      setFsInsp(true);
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      setFs(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  };
  useEffect(() => {
    if (!fs) return;
    const onChange = () => { if (!document.fullscreenElement) setFs(false); };
    const onKey = (e) => { if (e.key === 'Escape') setFs(false); };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [fs]);
  const selectStation = (id) => { setSelected(id); setFsInsp(true); };

  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const addLog = (s, kind, msg) => ({ ...s, log: [{ t: s.t, kind, msg, id: Math.random() }, ...s.log].slice(0, 120) });

  // apply a preset coming from the catalogue
  useEffect(() => {
    if (!preset) return;
    const next = { ...DEFAULT_CONFIG, ...preset.patch, tech: cfgRef.current.tech };
    setCfg(next);
    setSim(addLog(freshSim(next), 'info', `Loaded layout: ${preset.name}`));
    setBp(null);
  }, [preset]);

  const runtimeServers = cfg.autoscale ? sim.servers : cfg.servers;
  const users = cfg.users * trafficMult(cfg.pattern, sim.t, sim.spikeUntil);
  const r = useMemo(() => compute(cfg, { users, servers: runtimeServers, backlog: sim.backlog }), [cfg, users, runtimeServers, sim.backlog]);
  const advice = useMemo(() => advise(cfg, r), [cfg, r]);

  const update = useCallback((patch, note) => {
    setCfg((c) => {
      const next = { ...c, ...patch };
      if (patch.autoscale === true || (next.autoscale && (patch.asMin || patch.asMax))) {
        setSim((s) => ({ ...s, servers: Math.min(next.asMax, Math.max(next.asMin, s.servers || next.servers)) }));
      }
      if (patch.queue === false) setSim((s) => ({ ...s, backlog: 0 }));
      return next;
    });
    if (note) setSim((s) => addLog(s, 'build', note));
    setBp(null);
  }, []);

  // simulation clock
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSim((s) => {
        const c = cfgRef.current;
        const dt = speedRef.current;
        let n = { ...s, t: s.t + dt };
        const u = c.users * trafficMult(c.pattern, n.t, n.spikeUntil);
        const srv = c.autoscale ? n.servers : c.servers;
        const res = compute(c, { users: u, servers: srv, backlog: n.backlog });

        // boot completion
        if (c.autoscale && n.booting.length) {
          const ready = n.booting.filter((b) => b <= n.t).length;
          if (ready) {
            n = { ...n, servers: n.servers + ready, booting: n.booting.filter((b) => b > n.t) };
            n = addLog(n, 'good', `${ready} server${ready > 1 ? 's' : ''} passed health checks → in service (${n.servers} total)`);
          }
        }
        // auto-scaling decisions
        if (c.autoscale) {
          const util = res.tiers.app.work / Math.max(1, res.tiers.app.capBase);
          const desired = Math.min(c.asMax, Math.max(c.asMin, Math.ceil((n.servers * Math.min(util, 4) * 100) / c.asTarget)));
          const pending = n.servers + n.booting.length;
          if (desired > pending) {
            const add = desired - pending;
            n = { ...n, booting: [...n.booting, ...Array(add).fill(n.t + 60)], lastScale: n.t };
            n = addLog(n, 'warn', `Auto-scaler: CPU ${pct(util)} > target ${c.asTarget}% → launching ${add} server${add > 1 ? 's' : ''} (~60s boot)`);
          } else if (desired < n.servers && !n.booting.length && n.t - n.lastScale > 180) {
            const rm = Math.max(1, Math.floor((n.servers - desired) / 2));
            n = { ...n, servers: n.servers - rm, lastScale: n.t };
            n = addLog(n, 'info', `Auto-scaler: scale-in −${rm} (load ${pct(util)}) → ${n.servers} servers`);
          }
        } else if (n.servers !== c.servers || n.booting.length) {
          n = { ...n, servers: c.servers, booting: [] };
        }
        // queue backlog
        if (c.queue) {
          const backlog = Math.max(0, n.backlog + res.tiers.queue.growth * dt);
          if (backlog > 0 && n.backlog === 0) n = addLog(n, 'warn', 'Queue backlog building: writes arrive faster than workers drain');
          if (backlog === 0 && n.backlog > 0) n = addLog(n, 'good', 'Queue drained to zero');
          n = { ...n, backlog };
        }
        // signals
        const prev = { ...n.prev };
        for (const k of Object.keys(TIER_NAMES)) {
          const st = res.tiers[k].status;
          if (prev[k] && prev[k] !== st && st !== 'off' && prev[k] !== 'off') {
            const worse = SEV[st] > SEV[prev[k]];
            const lab = { green: 'GREEN', amber: 'AMBER', red: 'RED', broken: 'STOP: overloaded' }[st];
            n = addLog(n, worse ? (st === 'broken' ? 'bad' : 'warn') : 'good', `${TIER_NAMES[k]} signal → ${lab} (${pct(res.tiers[k].rho)})`);
          }
          prev[k] = st;
        }
        const errBand = res.errRate > 0.01 ? 'err' : 'ok';
        if (prev.err && prev.err !== errBand) n = addLog(n, errBand === 'err' ? 'bad' : 'good', errBand === 'err' ? `Error rate ${pct(res.errRate)}. Users are seeing failures` : 'Error rate back under 1%');
        prev.err = errBand;
        n.prev = prev;

        const h = { t: n.t, offered: res.raw, served: res.served, err: res.errRate * 100, p95: res.p95, servers: srv * c.regions, cost: res.costHr * 730 };
        n.history = [...n.history, h].slice(-HIST);
        return n;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const spike = () => setSim((s) => addLog({ ...s, spikeUntil: s.t + 90 }, 'bad', 'Traffic spike! 5× users for 90 s'));
  const resetClock = () => { setSim(addLog(freshSim(cfg), 'info', 'Clock reset')); };
  const loadScenario = (id) => {
    const sc = SCENARIOS.find((x) => x.id === id);
    if (!sc) return;
    setCfg({ ...sc.patch, tech: cfg.tech });
    setSim(addLog(freshSim(sc.patch), 'info', `Scenario: ${sc.name}. ${sc.desc}`));
    setBp(null);
  };
  const breaking = () => setBp(findBreakingPoint(cfg) || { none: true });

  const H = sim.history;
  const status = r.errRate > 0.05 ? 'broken' : r.errRate > 0.01 || r.maxRho >= 0.85 ? 'red' : r.maxRho >= 0.6 ? 'amber' : 'green';

  return (
    <div className="sim">
      <div className="sim-bar">
        <ClockControls status={status} r={r} t={sim.t} running={running} setRunning={setRunning} speed={speed} setSpeed={setSpeed} resetClock={resetClock} cfg={cfg} />
        <div className="kpis">
          <Kpi label="Users online" value={fmt(r.users)} />
          <Kpi label="Offered" info="rps" value={`${fmt(r.raw)}/s`} />
          <Kpi label="Served OK" info="rps" value={`${fmt(r.served)}/s`} />
          <Kpi label="Errors" info="errorrate" value={pct(r.errRate)} tone={r.errRate > 0.05 ? 'bad' : r.errRate > 0.01 ? 'warn' : 'good'} />
          <Kpi label="p95 latency" info="p95" value={ms(r.p95)} tone={r.p95 > 1000 ? 'bad' : r.p95 > 400 ? 'warn' : 'good'} />
          <Kpi label="Uptime est." info="availability" value={`${(r.avail * 100).toFixed(r.avail > 0.9999 ? 3 : 2)}%`} />
          <Kpi label="Cost / month" value={`$${fmt(r.costHr * 730)}`} />
          <button className="btn small how-btn" onClick={() => setMeth('cost')}><span className="info static">?</span>How is this calculated?</button>
        </div>
      </div>

      <div className="sim-grid">
        <aside className="panel sim-left">
          <div className="panel-label mono">SCENARIO</div>
          <select className="select" value="" onChange={(e) => loadScenario(e.target.value)}>
            <option value="">Load a scenario…</option>
            {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}: {s.desc}</option>)}
          </select>

          <div className="panel-label mono">TRAFFIC</div>
          <Slider label="Users online" min={100} max={800} value={Math.round(Math.log10(cfg.users) * 100)} display={fmt(cfg.users)}
            onChange={(v) => update({ users: Math.round(Math.pow(10, v / 100)) })} hint="Concurrent active users (log scale)" />
          <Slider label="Requests / user / min" info="rps" min={1} max={60} value={cfg.reqPerMin} onChange={(v) => update({ reqPerMin: v })} />
          <Slider label="Reads vs writes" info="readwrite" min={0} max={100} value={cfg.readPct} display={`${cfg.readPct}% R / ${100 - cfg.readPct}% W`} onChange={(v) => update({ readPct: v })} />
          <Slider label="Static assets" info="static" min={0} max={80} value={cfg.staticPct} display={`${cfg.staticPct}%`} onChange={(v) => update({ staticPct: v })} hint="Images / JS / CSS share of requests" />
          <Slider label="Bot / abusive traffic" info="bot" min={0} max={60} value={cfg.botPct} display={`${cfg.botPct}%`} onChange={(v) => update({ botPct: v })} />
          <Segmented label="Traffic pattern" value={cfg.pattern} onChange={(v) => update({ pattern: v }, `Timetable: ${v}`)}
            options={[{ value: 'steady', label: 'Steady' }, { value: 'wave', label: 'Daily wave' }, { value: 'ramp', label: 'Viral growth' }, { value: 'spike', label: 'Flash sales' }]} />
          <button className="btn danger full" onClick={spike}>⚡ Trigger 5× traffic spike</button>

          <div className="panel-label mono">BUILD · TOGGLE COMPONENTS</div>
          <div className="build">
            {[
              ['cdn', 'CDN', `${shortTech(cfg, 'cdn')}: static at the edge`, 'cdn'],
              ['gateway', 'Rate limiter', `${shortTech(cfg, 'gateway')}: blocks bots`, 'ratelimit'],
              ['proxy', 'Reverse proxy', `${shortTech(cfg, 'proxy')}: TLS, gzip, static`, 'reverse-proxy'],
              ['lb', 'Load balancer', `${shortTech(cfg, 'lb')}: spreads load`, 'lb'],
              ['cache', 'Cache', `${shortTech(cfg, 'cache')}: fast reads`, 'cache'],
              ['queue', 'Queue', `${shortTech(cfg, 'queue')} + workers`, 'queue'],
              ['pooler', 'Conn. pooler', `${shortTech(cfg, 'pooler')}`, 'pool'],
              ['breaker', 'Circuit breaker', `${shortTech(cfg, 'breaker')}: stops cascades`, 'breaker'],
              ['autoscale', 'Auto-scaling', `${shortTech(cfg, 'platform')}`, 'autoscale'],
            ].map(([k, l, h, term]) => (
              <div key={k} className="bld-wrap">
                <button className={cfg[k] ? 'bld on' : 'bld'} onClick={() => update({ [k]: !cfg[k], ...(k === 'lb' && !cfg.lb && cfg.servers < 2 ? { servers: 2 } : {}) }, `${cfg[k] ? 'Removed' : 'Built'}: ${l}`)} title={h}>
                  <span className="bld-dot" />
                  <span className="bld-l">{l}</span>
                  <span className="bld-h">{h}</span>
                </button>
                <Info term={term} label={l} />
              </div>
            ))}
          </div>
          <Segmented info="region" label="Regions (multi-region active-active)" value={cfg.regions} onChange={(v) => update({ regions: v }, `Regions → ${v}`)} options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }]} />
        </aside>

        <main className={`panel sim-center ${fs ? 'fs' : ''}`}>
          <div className="map-head">
            <span className="panel-label mono">LIVE LINE DIAGRAM · drag to move · ctrl/⌘ + scroll to zoom · click a station</span>
            <span className="map-legend mono">
              {['green', 'amber', 'red', 'broken'].map((s) => <span key={s}><i style={{ background: STATUS_COLOR[s] }} />{{ green: '<60%', amber: '60–85%', red: '85–100%', broken: 'overloaded / errors' }[s]}</span>)}
              <Info term="utilization" label="load colours" />
            </span>
            <button className="btn small fs-btn" onClick={toggleFs}>{fs ? '⤡ Exit full screen' : '⤢ Full screen'}</button>
          </div>
          {fs && (
            <div className="fs-bar">
              <ClockControls compact status={status} r={r} t={sim.t} running={running} setRunning={setRunning} speed={speed} setSpeed={setSpeed} resetClock={resetClock} cfg={cfg} />
              <button className="btn small danger" onClick={spike}>⚡ Spike</button>
              <div className="kpis">
                <Kpi label="Users" value={fmt(r.users)} />
                <Kpi label="Served OK" info="rps" value={`${fmt(r.served)}/s`} />
                <Kpi label="Errors" info="errorrate" value={pct(r.errRate)} tone={r.errRate > 0.05 ? 'bad' : r.errRate > 0.01 ? 'warn' : 'good'} />
                <Kpi label="p95" info="p95" value={ms(r.p95)} tone={r.p95 > 1000 ? 'bad' : r.p95 > 400 ? 'warn' : 'good'} />
                <Kpi label="Cost / mo" value={`$${fmt(r.costHr * 730)}`} onClick={() => setMeth('cost')} hint="See breakdown" />
              </div>
            </div>
          )}
          <div className="map-stage">
            <SimMap r={r} cfg={cfg} servers={runtimeServers} booting={cfg.autoscale ? sim.booting.length : 0} selected={selected} onSelect={selectStation} fullscreen={fs} />
            {fs && fsInsp && (
              <aside className="fs-insp panel">
                <button className="btn ghost small fs-insp-close" onClick={() => setFsInsp(false)} aria-label="Hide inspector">✕</button>
                <Inspector id={selected} cfg={cfg} r={r} update={update} sim={sim} />
              </aside>
            )}
            {fs && !fsInsp && <button className="btn small fs-insp-open" onClick={() => setFsInsp(true)}>☰ Inspector</button>}
          </div>

          <div className="charts">
            <Sparkline info="rps" label="THROUGHPUT req/s" value={fmt(r.served)} unit="/s" series={[{ name: 'offered', color: '#5c6a7a', data: H.map((h) => h.offered) }, { name: 'served', color: '#3ddc84', fill: true, data: H.map((h) => h.served) }]} />
            <Sparkline info="errorrate" label="ERROR RATE" value={pct(r.errRate)} max={Math.max(5, ...H.map((h) => h.err)) * 1.1} series={[{ name: 'errors', color: '#ff4d4f', fill: true, data: H.map((h) => h.err) }]} />
            <Sparkline info="p95" label="p95 LATENCY" value={ms(r.p95)} series={[{ name: 'p95', color: '#ffb020', fill: true, data: H.map((h) => h.p95) }]} />
            <Sparkline info="horizontal" label="APP SERVERS" value={runtimeServers * cfg.regions} series={[{ name: 'servers', color: '#4da3ff', fill: true, data: H.map((h) => h.servers) }]} />
          </div>
          {!H.length && <p className="dim small center">Press ▶ Run to start the clock and record history.</p>}
        </main>

        <aside className="panel sim-right">
          <Inspector id={selected} cfg={cfg} r={r} update={update} sim={sim} />
        </aside>
      </div>

      {meth && <Methodology r={r} cfg={cfg} tab={meth} onClose={closeMeth} />}

      <div className="sim-bottom">
        <section className="panel advisor">
          <div className="adv-head">
            <span className="panel-label mono">DISPATCHER · WHAT TO DO NEXT</span>
            <span className="adv-actions">
              <button className="btn" onClick={breaking}>🔎 Find breaking point</button>
              <Info term="bottleneck" label="breaking point" />
            </span>
          </div>
          {bp && (
            <div className="bp">
              {bp.none ? <p>This layout didn’t break below 2 billion users. Impressive.</p> : (
                <>
                  <p>This layout breaks at about <b>{fmt(bp.users)} users</b> (≈{fmt(bp.rps)} req/s). First to fail: <b>{bp.tier}</b>.</p>
                  <button className="btn small" onClick={() => update({ users: Math.round(bp.users * 1.1), pattern: 'steady' }, `Set load just past breaking point (${fmt(bp.users * 1.1)} users)`)}>Jump to that load →</button>
                </>
              )}
            </div>
          )}
          {advice.length === 0 && <p className="dim">All signals green. Push more users, trigger a spike, or switch to <i>Viral growth</i> to find the next limit.</p>}
          <ul className="adv-list">
            {advice.slice(0, 6).map((a, i) => (
              <li key={i} className={`adv sev-${a.severity}`}>
                <div>
                  <div className="adv-title"><span className="adv-sev mono">{a.severity}</span>{a.title}<Info term={termsIn(a.title)[0] || termsIn(`${a.detail} ${a.fix?.label || ''}`)[0]} label={a.title} /></div>
                  <div className="adv-detail">{a.detail}</div>
                </div>
                {a.fix && (
                  <span className="adv-fix">
                    <button className="btn small primary" onClick={() => update(a.fix.patch, `Dispatcher fix: ${a.fix.label}`)}>{a.fix.label}</button>
                    {/SPOF/.test(a.fix.label) && <Info term="spof" label="SPOF" />}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel log">
          <div className="panel-label mono">SIGNAL BOX LOG</div>
          <ul>
            {sim.log.map((l) => (
              <li key={l.id} className={`log-${l.kind}`}><span className="mono dim">{clock(l.t)}</span> {l.msg}</li>
            ))}
            {!sim.log.length && <li className="dim">Events appear here as signals change.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

const STATUS_TEXT = {
  green: ['All clear', 'Every component is under 60% load and errors are below 1%.'],
  amber: ['Getting busy', 'At least one component is at 60–85% load. Latency starts to rise. Plan the next scaling step.'],
  red: ['Near the limit', 'A component is above 85% load, or more than 1% of requests fail. Users notice slowness.'],
  broken: ['Failing', 'More than 5% of requests fail. Something is overloaded. Check the dispatcher for fixes.'],
};
const PATTERN_TEXT = {
  steady: 'Steady: traffic stays at the users slider value.',
  wave: 'Daily wave: one simulated “day” lasts 30 simulated minutes, from 30% to 100% of the users slider.',
  ramp: 'Viral growth: traffic multiplies over time (up to 60×) until something breaks.',
  spike: 'Flash sales: every 10 simulated minutes, a 2-minute 5× surge.',
};

function ClockControls({ compact, status, r, t, running, setRunning, speed, setSpeed, resetClock, cfg }) {
  const [label, desc] = STATUS_TEXT[status];
  const t2 = r.tiers;
  const busiest = [['App servers', t2.app.rho], ['Database (writes)', t2.db.primaryRho], ['Database (reads)', t2.db.readRho], ['Load balancer', t2.lb.on ? t2.lb.rho : 0], ['Cache', t2.cache.on ? t2.cache.rho : 0], ['Queue workers', t2.workers.on ? t2.workers.rho : 0]].sort((a, b) => b[1] - a[1])[0];
  const perSec = speed * (1000 / TICK_MS);
  const btn = compact ? 'btn small' : 'btn';
  return (
    <div className="clock">
      <Popover align="start" title="System signal" content={(
        <>
          <p><span className="pop-dot" style={{ background: STATUS_COLOR[status] }} /><b>{label}.</b> {desc}</p>
          <p>Like a railway signal, it sums up the whole system: green &lt; 60% load, amber 60–85%, red &gt; 85% or &gt; 1% errors, flashing red &gt; 5% errors.</p>
          <span className="pop-live">busiest: {busiest[0]} {pct(busiest[1])} · errors {pct(r.errRate)}</span>
        </>
      )}>
        <button type="button" className="clock-lamp-btn" aria-label={`System status: ${label}`}><span className={`clock-lamp st-${status}`} /></button>
      </Popover>

      <Popover align="start" title="Simulation clock" width={300} content={(
        <>
          <p><b>T+hours:minutes:seconds</b> of simulated time since the run started. Not real time: it runs faster so you can watch hours of traffic in minutes.</p>
          <p>Traffic patterns, auto-scaling (servers take 60 simulated seconds to boot) and queue backlogs all follow this clock.</p>
          <span className="pop-live">{PATTERN_TEXT[cfg.pattern]}</span>
        </>
      )}>
        <span className="mono clock-t" tabIndex={0}>{clock(t)}</span>
      </Popover>

      <Popover title={running ? 'Pause the clock' : 'Run the clock'} content={(
        <>
          <p>{running ? 'Freezes simulated time.' : 'Starts simulated time again.'} While paused, traffic patterns, auto-scaling and queue backlogs stop changing, and the charts stop recording.</p>
          <p>You can still change any setting: the map and numbers update instantly, showing the steady state for that moment.</p>
        </>
      )}>
        <button className={btn} onClick={() => setRunning((v) => !v)}>{running ? '❚❚ Pause' : '▶ Run'}</button>
      </Popover>

      <Popover title="Simulation speed" width={290} content={(
        <>
          <p>How fast simulated time runs compared with real time:</p>
          <ul>
            {SPEEDS.map((s) => {
              const ps = s.value * (1000 / TICK_MS);
              return <li key={s.value} className={s.value === speed ? 'on' : ''}><b>{s.label}</b>: 1 real second = {ps} simulated seconds{ps >= 60 ? ` (${(ps / 60).toFixed(1)} min)` : ''}</li>;
            })}
          </ul>
          <p>Use 20× to watch a whole daily wave or viral growth quickly, 1× to follow auto-scaling step by step.</p>
          <span className="pop-live">now: 1 real minute ≈ {Math.round(perSec)} simulated minutes</span>
        </>
      )}>
        <div className="seg small">
          {SPEEDS.map((s) => <button key={s.value} className={speed === s.value ? 'on' : ''} onClick={() => setSpeed(s.value)} aria-label={`Speed ${s.label}`}>{s.label}</button>)}
        </div>
      </Popover>

      <Popover title="Reset clock" width={260} content={(
        <>
          <p>Sets the clock back to <b>T+00:00:00</b> and clears the charts, the queue backlog and servers that are still booting.</p>
          <p>Your layout and settings stay exactly as they are.</p>
        </>
      )}>
        <button className={`${btn} ghost`} onClick={resetClock} aria-label="Reset clock">↺</button>
      </Popover>
    </div>
  );
}

function Kpi({ label, value, tone, info, onClick, hint }) {
  return (
    <div className={`kpi ${tone || ''} ${onClick ? 'clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      title={onClick ? 'How is this calculated?' : undefined} onKeyDown={(e) => onClick && (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <span className="kpi-l mono">{label}{info && <Info term={info} label={label} />}</span>
      <span className="kpi-v mono">{value}{hint && <span className="kpi-hint"> ⓘ</span>}</span>
    </div>
  );
}

function Stat({ k, v, tone, info }) {
  return <div className={`stat ${tone || ''}`}><span>{k}{info && <Info term={info} label={k} />}</span><b className="mono">{v}</b></div>;
}

function StationGuide({ id, cfg, update }) {
  const info = STATION_INFO[id];
  if (!info) return null;
  return (
    <div className="guide">
      <details className="guide-explain" open>
        <summary className="mono">WHAT IS THIS?</summary>
        <p><b>What:</b> {info.what}</p>
        <p><b>Why:</b> {info.why}</p>
        <p className="dim"><b>In this simulator:</b> {info.model}</p>
      </details>
      {info.pickers.map((key) => {
        const pk = PICKERS[key];
        const cur = cfg.tech?.[key] ?? TECH_DEFAULTS[key];
        const opt = pk.options.find((x) => x.id === cur) || pk.options[0];
        return (
          <div key={key} className="tech">
            <label className="field-label" htmlFor={`tech-${key}`}>{pk.label}</label>
            <select id={`tech-${key}`} className="select" value={opt.id}
              onChange={(e) => {
                const next = pk.options.find((x) => x.id === e.target.value);
                update({ tech: { ...cfg.tech, [key]: next.id } }, `Technology: ${pk.label} → ${next.name}`);
              }}>
              {pk.options.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <div className="tech-card">
              <span className="tech-kind mono">{opt.kind}</span>
              <span>{opt.note}</span>
            </div>
            <details className="tech-compare">
              <summary>Compare all {pk.options.length} options</summary>
              <ul>
                {pk.options.map((x) => (
                  <li key={x.id} className={x.id === opt.id ? 'on' : ''}>
                    <b>{x.name}</b> <span className="mono dim">{x.kind}</span>
                    <div className="dim">{x.note}</div>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        );
      })}
      {info.pickers.length > 0 && <p className="tech-foot dim">Names are labels for learning. The capacity model is the same for every option.</p>}
    </div>
  );
}

function Inspector({ id, cfg, r, update, sim }) {
  const t = r.tiers;
  const sc = serverCapacity(cfg.vcpu, cfg.ram, cfg.proxy);
  const tone = (rho) => (rho >= 1 ? 'bad' : rho >= 0.85 ? 'warn' : '');
  const TERM = { users: 'rps', dns: 'dns', cdn: 'cdn', gateway: 'gateway', lb: 'lb', proxy: 'reverse-proxy', app: 'server', cache: 'cache', db: 'database', queue: 'queue', workers: 'worker' };
  const head = (title, sub) => (
    <>
      <header className="insp-head">
        <div className="panel-label mono">STATION INSPECTOR</div>
        <h3>{title}<Info term={TERM[id]} label={title} /></h3>
        <p className="dim small">{sub}</p>
      </header>
      <StationGuide id={id} cfg={cfg} update={update} />
      <div className="sub-label mono">SETTINGS &amp; LIVE STATS</div>
    </>
  );

  switch (id) {
    case 'users':
      return (<div>{head('Users', 'Where traffic starts. Change load in the Traffic panel.')}
        <Stat k="Online users" v={fmt(r.users)} />
        <Stat k="Total requests" v={`${fmt(r.raw)}/s`} />
        <Stat k="Of which bots" info="bot" v={`${fmt(r.bot)}/s`} />
        <Stat k="Blocked by limiter" info="ratelimit" v={`${fmt(r.blocked)}/s`} />
        <Stat k="p50 / p95" info="p95" v={`${ms(r.p50)} / ${ms(r.p95)}`} />
        <p className="note">Requests/s = users × requests per minute ÷ 60. 100k users at 6 req/min is 10k req/s.</p>
      </div>);
    case 'dns':
      return (<div>{head('DNS / Global routing', 'Maps your domain to an entry point. With several regions, GeoDNS sends users to the nearest one.')}
        <Segmented label="Regions" info="region" value={cfg.regions} onChange={(v) => update({ regions: v }, `Regions → ${v}`)} options={[1, 2, 3]} />
        <Stat k="Network round trip" info="latency" v={ms(t.users.lat)} />
        <p className="note">Each region runs a full copy of the stack (servers, cache, read replicas). Writes still go to the primary. More regions mean lower latency and higher availability, at higher cost.</p>
      </div>);
    case 'cdn':
      return (<div>{head('CDN edge', 'Serves static assets from PoPs near users.')}
        <Toggle label="CDN enabled" checked={cfg.cdn} onChange={(v) => update({ cdn: v }, `${v ? 'Built' : 'Removed'}: CDN`)} />
        <Slider label="Static share of traffic" info="static" min={0} max={80} value={cfg.staticPct} display={`${cfg.staticPct}%`} onChange={(v) => update({ staticPct: v })} />
        <Stat k="Edge traffic" v={`${fmt(t.cdn.in)}/s`} />
        <Stat k="Origin offload" v={cfg.cdn ? `${fmt(t.cdn.in * 0.95)}/s` : '0'} />
        <p className="note">Without a CDN, every image and JS file is handled by your app servers and travels the full distance to the user.</p>
      </div>);
    case 'gateway':
      return (<div>{head('API Gateway / Rate limiter', 'Front door: auth, quotas, and blocking abusive traffic with 429s.')}
        <Toggle label="Gateway + rate limiter" info="ratelimit" checked={cfg.gateway} onChange={(v) => update({ gateway: v }, `${v ? 'Built' : 'Removed'}: rate limiter`)} />
        <Slider label="Bot / abusive traffic" info="bot" min={0} max={60} value={cfg.botPct} display={`${cfg.botPct}%`} onChange={(v) => update({ botPct: v })} />
        <Stat k="Incoming" v={`${fmt(t.gateway.in)}/s`} />
        <Stat k="Blocked (429)" v={`${fmt(t.gateway.blocked)}/s`} />
        <Stat k="Utilisation" info="utilization" v={cfg.gateway ? pct(t.gateway.rho) : '—'} tone={tone(t.gateway.rho)} />
      </div>);
    case 'lb':
      return (<div>{head('Load balancer', 'Spreads requests across app servers and removes unhealthy ones.')}
        <Toggle label="Load balancer" checked={cfg.lb} onChange={(v) => update({ lb: v, ...(v && cfg.servers < 2 ? { servers: 2 } : {}) }, `${v ? 'Built' : 'Removed'}: load balancer`)} />
        <Slider label="LB nodes" info="spof" min={1} max={8} value={cfg.lbNodes} onChange={(v) => update({ lbNodes: v })} hint="≥2 removes the LB as a single point of failure. ~50k rps each." />
        <Segmented label="Algorithm" info="roundrobin" value={cfg.lbAlgo} onChange={(v) => update({ lbAlgo: v }, `LB algorithm → ${v}`)}
          options={[{ value: 'round-robin', label: 'Round robin' }, { value: 'least-conn', label: 'Least conn' }, { value: 'ip-hash', label: 'IP hash' }]} />
        <Stat k="Throughput" info="rps" v={`${fmt(t.lb.in)}/s`} />
        <Stat k="Utilisation" info="utilization" v={cfg.lb ? pct(t.lb.rho) : '—'} tone={tone(t.lb.rho)} />
        <p className="note">IP hash pins each user to one server (sticky): sessions survive, but load spreads less evenly.</p>
      </div>);
    case 'proxy': {
      const plain = serverCapacity(cfg.vcpu, cfg.ram, false);
      const boosted = serverCapacity(cfg.vcpu, cfg.ram, true);
      return (<div>{head('Reverse proxy', 'A proxy on your side that receives every request first, does the generic work, and hands real requests to the app.')}
        <Toggle label="Reverse proxy in front of the app" info="reverse-proxy" checked={cfg.proxy} onChange={(v) => update({ proxy: v }, `${v ? 'Built' : 'Removed'}: reverse proxy`)} hint="Runs on every app server, e.g. NGINX → localhost:3000" />
        <Stat k="Requests through proxy" info="rps" v={`${fmt(t.proxy.in)}/s`} />
        <Stat k="Static files served by proxy" info="static" v={cfg.proxy ? `${fmt(t.proxy.staticServed)}/s` : '—'} />
        <Stat k="Utilisation" info="utilization" v={cfg.proxy ? pct(t.proxy.rho) : '—'} tone={tone(t.proxy.rho)} />
        <Stat k="Per-server capacity without" info="cpu" v={`${fmt(plain.cap)} rps (${plain.bound})`} />
        <Stat k="Per-server capacity with" info="cpu" v={`${fmt(boosted.cap)} rps (${boosted.bound})`} tone="" />
        <p className="note">Reverse vs forward proxy: this one works for <b>your servers</b> (incoming traffic). A forward proxy works for <b>clients</b> (outgoing traffic), e.g. an office web filter. It doesn’t add capacity, so it isn’t in the simulator. See the Forward Proxy tile on the Network Map.<span className="note-links"><Info term="forward-proxy" label="forward proxy" /></span></p>
        <div className="sub-label mono">DO YOU NEED ONE?</div>
        <NeedLists term="reverse-proxy" compact />
        <Toggle label={cfg.proxy ? 'Reverse proxy is ON. Turn it off' : 'Reverse proxy is OFF. Turn it on'} checked={cfg.proxy} onChange={(v) => update({ proxy: v }, `${v ? 'Built' : 'Removed'}: reverse proxy`)} hint="Flip it and compare the app load, latency and cost." />
      </div>);
    }
    case 'app':
      return (<div>{head('App servers', 'Vertical scaling = bigger servers. Horizontal scaling = more servers.')}
        <div className="sub-label mono">VERTICAL · per server<Info term="vertical" label="vertical scaling" /></div>
        <StepSlider label="vCPU" info="cpu" steps={VCPU_STEPS} value={cfg.vcpu} onChange={(v) => update({ vcpu: v })} hint={`CPU limit ≈ ${fmt(sc.cpu)} rps/server`} />
        <StepSlider label="RAM" info="ram" steps={RAM_STEPS} value={cfg.ram} unit=" GB" onChange={(v) => update({ ram: v })} hint={`Memory limit ≈ ${fmt(sc.mem)} rps/server (in-flight requests)`} />
        <div className="sub-label mono">HORIZONTAL · fleet<Info term="horizontal" label="horizontal scaling" /></div>
        <Slider label="Servers" info="server" min={1} max={200} value={cfg.servers} disabled={cfg.autoscale} onChange={(v) => update({ servers: v })} display={cfg.autoscale ? `auto (${sim.servers})` : cfg.servers} hint={!cfg.lb && cfg.servers > 1 ? '⚠ needs a load balancer to be used' : undefined} />
        <Toggle label="Auto-scaling" info="autoscale" checked={cfg.autoscale} onChange={(v) => update({ autoscale: v }, `${v ? 'Enabled' : 'Disabled'}: auto-scaling`)} hint="Adds servers when CPU passes target (60 s boot)" />
        {cfg.autoscale && (<>
          <Slider label="Min servers" min={1} max={100} value={cfg.asMin} onChange={(v) => update({ asMin: Math.min(v, cfg.asMax) })} />
          <Slider label="Max servers" min={2} max={200} value={cfg.asMax} onChange={(v) => update({ asMax: Math.max(v, cfg.asMin) })} />
          <Slider label="Target CPU" info="utilization" min={30} max={90} value={cfg.asTarget} display={`${cfg.asTarget}%`} onChange={(v) => update({ asTarget: v })} />
        </>)}
        <Segmented label="Session storage" info="session" value={cfg.sessions} onChange={(v) => update({ sessions: v }, `Sessions → ${v}`)}
          options={[{ value: 'memory', label: 'In memory', info: 'session-memory' }, { value: 'sticky', label: 'Sticky LB', info: 'sticky' }, { value: 'shared', label: 'Shared Redis', info: 'session-shared' }]} />
        <Toggle label="Circuit breakers" info="breaker" checked={cfg.breaker} onChange={(v) => update({ breaker: v }, `${v ? 'Built' : 'Removed'}: circuit breakers`)} hint="Fail fast when the DB is overloaded" />
        <Stat k="Per-server capacity" info="bottleneck" v={`${fmt(sc.cap)} rps (${sc.bound}-bound)`} />
        <Stat k="Fleet capacity" v={`${fmt(t.app.cap)} rps`} />
        <Stat k="Load" v={`${fmt(t.app.work)} rps-eq`} />
        <Stat k="Utilisation" info="utilization" v={pct(t.app.rho)} tone={tone(t.app.rho)} />
        <Stat k="Latency in tier" info="latency" v={ms(t.app.lat)} />
      </div>);
    case 'cache':
      return (<div>{head('Cache (Redis)', 'Cache-aside: check memory first, fall back to the DB on a miss.')}
        <Toggle label="Cache enabled" checked={cfg.cache} onChange={(v) => update({ cache: v }, `${v ? 'Built' : 'Removed'}: cache`)} />
        <StepSlider label="Cache size" info="workingset" steps={[1, 2, 4, 8, 16, 32, 64, 128, 256, 512]} value={cfg.cacheGb} unit=" GB" onChange={(v) => update({ cacheGb: v })} />
        <Stat k="Hit rate" info="hitrate" v={pct(t.cache.hit)} />
        <Stat k="Hot working set" info="workingset" v={`${fmt(t.db.node.ws)} GB`} />
        <Stat k="Reads served from memory" v={`${fmt(t.cache.in * t.cache.hit)}/s`} />
        <p className="note">Hit rate depends on cache size relative to the working set. Bigger user bases need bigger caches.</p>
      </div>);
    case 'db':
      return (<div>{head('Database', 'Usually the hardest tier to scale. Scale up first, then replicas for reads, then shards for writes.')}
        <div className="sub-label mono">VERTICAL · per node<Info term="vertical" label="vertical scaling" /></div>
        <StepSlider label="DB vCPU" info="cpu" steps={VCPU_STEPS} value={cfg.dbVcpu} onChange={(v) => update({ dbVcpu: v })} />
        <StepSlider label="DB RAM" info="ram" steps={RAM_STEPS} value={cfg.dbRam} unit=" GB" onChange={(v) => update({ dbRam: v })} hint="Working set should fit in memory" />
        <div className="sub-label mono">HORIZONTAL<Info term="horizontal" label="horizontal scaling" /></div>
        <Slider label="Read replicas / shard" info="replica" min={0} max={8} value={cfg.replicas} onChange={(v) => update({ replicas: v }, `Read replicas → ${v}`)} />
        <Slider label="Shards" info="shard" min={1} max={64} value={cfg.shards} onChange={(v) => update({ shards: v }, `Shards → ${v}`)} />
        <Toggle label="Connection pooler" info="pool" checked={cfg.pooler} onChange={(v) => update({ pooler: v }, `${v ? 'Built' : 'Removed'}: connection pooler`)} hint="Multiplexes app connections" />
        <Stat k="Writes" info="readwrite" v={`${fmt(t.db.writes)}/s of ${fmt(t.db.writeCap)}`} tone={tone(t.db.primaryRho)} />
        <Stat k="Reads" v={`${fmt(t.db.reads)}/s`} />
        <Stat k="Primary load" info="utilization" v={pct(t.db.primaryRho)} tone={tone(t.db.primaryRho)} />
        {cfg.replicas > 0 && <Stat k="Replica load" info="replica" v={pct(t.db.replicaRho)} tone={tone(t.db.replicaRho)} />}
        <Stat k="Connections" info="pool" v={`${fmt(t.db.connNeeded)} / ${fmt(t.db.connMax)}`} tone={t.db.connErrFrac > 0 ? 'bad' : ''} />
        <Stat k="Working set / RAM per node" info="workingset" v={`${fmt(t.db.node.wsShard)} / ${cfg.dbRam} GB`} tone={t.db.node.ramFactor < 1 ? 'warn' : ''} />
        <Stat k="Read / write latency" info="latency" v={`${ms(t.db.readLat)} / ${ms(t.db.writeLat)}`} />
      </div>);
    case 'queue':
    case 'workers':
      return (<div>{head('Queue + workers', 'Writes are acknowledged instantly and processed asynchronously. Spikes become backlog instead of errors.')}
        <Toggle label="Queue writes" info="queue" checked={cfg.queue} onChange={(v) => update({ queue: v }, `${v ? 'Built' : 'Removed'}: queue`)} />
        <Slider label="Workers" info="worker" min={1} max={256} value={cfg.workers} onChange={(v) => update({ workers: v })} hint="~500 jobs/s each" />
        <Stat k="Incoming writes" v={`${fmt(t.queue.in)}/s`} />
        <Stat k="Drain rate" info="backpressure" v={`${fmt(t.queue.drain)}/s`} />
        <Stat k="Backlog" info="backlog" v={fmt(t.queue.backlog)} tone={t.queue.growth > 0 ? 'warn' : ''} />
        <Stat k="Trend" v={t.queue.growth > 0 ? `+${fmt(t.queue.growth)}/s` : 'stable / draining'} />
        <p className="note">If the backlog keeps growing, either workers are too few or the DB can’t absorb the writes. In that case, shard.</p>
      </div>);
    default:
      return null;
  }
}
