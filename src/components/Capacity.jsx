import { useMemo, useState } from 'react';
import {
  CHECKLIST, CPU_PRESETS, CPU_TABLE, DECIDE, DEFAULT_INPUT, GOLDEN, LOOP, MACHINE_TIPS, METHODS,
  PROVIDERS, RAM_RATIOS, REFERENCES, RUNTIMES, SRE_POINTS, TRAFFIC_RULES, cpuMsFromTest, sizeIt,
} from '../data/capacity.js';
import { fmt } from '../sim/model.js';
import { Info, Term } from './Glossary.jsx';
import { FoldCtx, LINE_COLORS, SectionHead } from './Networking.jsx';
import { Segmented, Slider, Toggle } from './ui.jsx';

const SECTIONS = [
  ['cap-loop', 'The sizing loop'],
  ['cap-traffic', 'Estimate your traffic'],
  ['cap-measure', 'Measure one request'],
  ['cap-calc', 'Sizing calculator'],
  ['cap-knee', 'Why not 100% CPU'],
  ['cap-signals', 'Four golden signals'],
  ['cap-decide', 'Up, out or optimise?'],
  ['cap-machine', 'Choosing the machine'],
  ['cap-check', 'Checklist & reading'],
];

const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const pct = (x) => `${Math.round(x * 100)}%`;
const num = (x, d = 1) => (x >= 100 ? fmt(x) : x.toFixed(d).replace(/\.0$/, ''));

export default function Capacity({ onTrySim, onOpenBuild }) {
  const [open, setOpen] = useState(() => new Set());
  const [inp, setInp] = useState(DEFAULT_INPUT);
  const set = (patch) => setInp((x) => ({ ...x, ...patch }));
  const reveal = (id) => { setOpen((o) => new Set(o).add(id)); setTimeout(() => scrollTo(id), 0); };
  const fold = useMemo(() => ({
    isOpen: (id) => open.has(id),
    toggle: (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
  }), [open]);
  const allOpen = open.size === SECTIONS.length;

  return (
    <FoldCtx.Provider value={fold}>
    <div className="net-page cap-page calm">
      <section className="hero net-hero">
        <div>
          <div className="eyebrow mono">CAPACITY · HOW BIG A SERVER DO I NEED?</div>
          <h1>Will my server be enough?</h1>
          <p className="lede">Picking a machine on AWS, Hetzner or anywhere else usually starts with a guess. This page replaces the guess with a short loop: estimate the traffic, <b>measure</b> what one request costs, calculate, load-test, then watch the <Term term="golden-signals">four golden signals</Term> to know when to scale.</p>
          <div className="hero-ctas">
            <button className="btn primary" onClick={() => reveal('cap-calc')}>▶ Open the sizing calculator</button>
            <button className="btn" onClick={() => reveal('cap-loop')}>Start with the method</button>
          </div>
        </div>
        <nav className="net-toc" aria-label="On this page">
          {SECTIONS.map(([id, label], i) => (
            <button key={id} className={`legend-row ${open.has(id) ? 'is-open' : ''}`} onClick={() => reveal(id)} style={{ '--c': LINE_COLORS[i % LINE_COLORS.length] }}>
              <span className="legend-line" />
              <span className="mono">{String(i + 1).padStart(2, '0')}</span>
              <span>{label}</span>
            </button>
          ))}
          <button className="btn ghost small net-fold-all" onClick={() => setOpen(allOpen ? new Set() : new Set(SECTIONS.map(([id]) => id)))}>
            {allOpen ? '▴ Collapse all' : '▾ Expand all'}
          </button>
        </nav>
      </section>

      <div className="cap-sections">
      <LoopSection />
      <TrafficSection inp={inp} set={set} />
      <MeasureSection onUse={(ms) => { set({ cpuMs: Math.max(0.5, Math.round(ms * 10) / 10) }); reveal('cap-calc'); }} onOpenBuild={onOpenBuild} />
      <CalcSection inp={inp} set={set} onTrySim={onTrySim} />
      <KneeSection />
      <SignalsSection onOpenBuild={onOpenBuild} />
      <DecideSection />
      <MachineSection />
      <CheckSection />
      </div>
    </div>
    </FoldCtx.Provider>
  );
}

// ── 01 ─────────────────────────────────────────────────────────────────────
function LoopSection() {
  return (
    <section className="net-sec">
      <SectionHead id="cap-loop" n="01" title="The sizing loop">
        You can’t read the right server size off a price list. You size it from your own numbers, then let monitoring tell you when the plan was wrong.
      </SectionHead>
      <ol className="cap-loop">
        {LOOP.map((s) => (
          <li key={s.n} className="cap-loop-step">
            <span className="cap-loop-n mono">{s.n}</span>
            <b>{s.title}</b>
            <span className="dim small">{s.text}</span>
          </li>
        ))}
      </ol>
      <div className="takeaway"><b>The classic mistake:</b> sizing from the number of users (“we have 50,000 users, so we need 8 cores”). What matters is requests per second at peak × how much CPU each request costs. 50,000 users can fit on one small server, or need twenty, depending on what each request does.</div>
    </section>
  );
}

// ── 02 ─────────────────────────────────────────────────────────────────────
function TrafficSection({ inp, set }) {
  const rpsAvg = (inp.users * inp.reqPerMin) / 60;
  return (
    <section className="net-sec">
      <SectionHead id="cap-traffic" n="02" title="Estimate your traffic">
        Capacity is about the busiest minute, not the daily total. Turn what you know about users into <Term term="rps">requests per second</Term> at peak.
      </SectionHead>
      <div className="cap-grid">
        <div className="panel">
          <div className="panel-label">Rules of thumb</div>
          <dl className="cap-rules">
            {TRAFFIC_RULES.map((r) => <div key={r.k}><dt>{r.k}</dt><dd>{r.v}</dd></div>)}
          </dl>
        </div>
        <div className="panel">
          <div className="panel-label">Quick estimate</div>
          <Slider label="Peak users online at once" min={10} max={200000} step={10} value={inp.users} display={fmt(inp.users)} onChange={(v) => set({ users: v })} hint="Don’t know? Daily active users × ~10%." />
          <Slider label="Requests per user per minute" info="rps" min={1} max={60} value={inp.reqPerMin} onChange={(v) => set({ reqPerMin: v })} hint="API calls while someone actively uses the app." />
          <div className="cap-formula mono">
            {fmt(inp.users)} users × {inp.reqPerMin} req/min ÷ 60 = <b>{num(rpsAvg)} req/s</b> at peak
          </div>
          <p className="dim small">These sliders are shared with the calculator in section 04.</p>
        </div>
      </div>
    </section>
  );
}

// ── 03 ─────────────────────────────────────────────────────────────────────
function MeasureSection({ onUse, onOpenBuild }) {
  const [cpuPct, setCpuPct] = useState(45);
  const [rps, setRps] = useState(60);
  const ms = cpuMsFromTest({ cpuPct, rps });
  return (
    <section className="net-sec">
      <SectionHead id="cap-measure" n="03" title="Measure what one request costs">
        The one number you can’t guess: how many milliseconds of CPU a request uses in <i>your</i> code. Measure it once with a steady load test, then everything else is arithmetic.
      </SectionHead>
      <div className="cap-grid">
        <div className="panel">
          <div className="panel-label">How to measure</div>
          <ol className="cap-steps">
            <li>Run your app in a container with a fixed size, and a load test at a <b>constant rate</b> (e.g. 60 req/s), not “as fast as possible”. <Info term="load-test" label="load test" /></li>
            <li>Read the app’s CPU while the test runs: <code>docker stats</code> (100% = one full core) or Prometheus: <code>rate(process_cpu_seconds_total[1m])</code>.</li>
            <li>CPU ms per request = CPU used (in cores) × 1000 ÷ requests per second.</li>
            <li>Note the memory too (<code>process_resident_memory_bytes</code>), with and without load: the difference is the memory per request in flight.</li>
            <li>Repeat for your heaviest endpoints. Use a realistic mix of reads and writes.</li>
          </ol>
          {onOpenBuild && <button className="btn small" onClick={() => onOpenBuild('adv-measure')}>Do it hands-on: Build Your Own → Advanced A2 →</button>}
        </div>
        <div className="panel">
          <div className="panel-label">From your test to CPU per request</div>
          <Slider label="App CPU during the test (docker stats)" min={1} max={400} value={cpuPct} display={`${cpuPct}%`} onChange={setCpuPct} hint="400% = four full cores busy" />
          <Slider label="Constant request rate of the test" min={1} max={2000} value={rps} display={`${rps} req/s`} onChange={setRps} />
          <div className="cap-formula mono">{cpuPct / 100} cores × 1000 ÷ {rps} req/s = <b>{num(ms, 2)} ms CPU per request</b></div>
          <button className="btn primary small" onClick={() => onUse(ms)}>Use {num(ms, 1)} ms in the calculator →</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-label">Typical CPU time per request <span className="dim small">· orders of magnitude, not promises</span></div>
        <div className="table-scroll"><table className="meth-table">
          <thead><tr><th>Kind of request</th><th>CPU per request</th><th>Where it goes</th></tr></thead>
          <tbody>{CPU_TABLE.map(([a, b, c]) => <tr key={a}><td>{a}</td><td className="mono">{b}</td><td>{c}</td></tr>)}</tbody>
        </table></div>
        <p className="dim small">Time spent <b>waiting</b> (for the database, Redis or another API) doesn’t use CPU. It costs memory and connections instead, because the request stays “in flight” longer. That is what <Term term="littles-law">Little’s law</Term> captures in the calculator.</p>
      </div>
    </section>
  );
}

// ── 04 ─────────────────────────────────────────────────────────────────────
function CalcSection({ inp, set, onTrySim }) {
  const r = useMemo(() => sizeIt(inp), [inp]);
  const b = r.best;
  const tryIt = () => onTrySim?.({
    users: inp.users, reqPerMin: inp.reqPerMin, vcpu: b.v, ram: b.ram, servers: b.servers,
    lb: b.servers > 1, sessions: 'shared', autoscale: false,
  }, `Capacity: ${b.servers} × ${b.v} vCPU / ${b.ram} GB`);

  return (
    <section className="net-sec">
      <SectionHead id="cap-calc" n="04" title="Sizing calculator">
        Put in your numbers and compare server sizes side by side. Every result shows its formula, so you can check it and explain it to your team.
      </SectionHead>
      <div className="cap-calc">
        <div className="panel cap-inputs">
          <div className="panel-label">Your numbers</div>
          <Slider label="Peak users online" min={10} max={200000} step={10} value={inp.users} display={fmt(inp.users)} onChange={(v) => set({ users: v })} />
          <Slider label="Requests per user per minute" info="rps" min={1} max={60} value={inp.reqPerMin} onChange={(v) => set({ reqPerMin: v })} />
          <Slider label="Spike safety factor" min={1} max={5} step={0.1} value={inp.spike} display={`× ${inp.spike}`} onChange={(v) => set({ spike: v })} hint="Extra for launches, sales and surprises." />
          <Slider label="CPU time per request" info="cpu" min={0.5} max={500} step={0.5} value={inp.cpuMs} display={`${inp.cpuMs} ms`} onChange={(v) => set({ cpuMs: v })} hint="Measured in section 03, or start from a preset:" />
          <div className="chips cap-presets">
            {CPU_PRESETS.map((p) => <button key={p.ms} className={`chip ${inp.cpuMs === p.ms ? 'on' : ''}`} onClick={() => set({ cpuMs: p.ms })}>{p.label} · {p.ms} ms</button>)}
          </div>
          <Slider label="Response time (incl. DB and APIs)" info="latency" min={5} max={2000} step={5} value={inp.respMs} display={`${inp.respMs} ms`} onChange={(v) => set({ respMs: v })} hint="Waiting time: costs memory, not CPU." />
          <Segmented label="Runtime" value={inp.runtime} onChange={(v) => set({ runtime: v, perReqMb: RUNTIMES.find((x) => x.id === v).perReqMb })}
            options={RUNTIMES.map((x) => ({ value: x.id, label: x.label }))} />
          <p className="field-hint">{r.rt.note}</p>
          <Slider label="Memory per request in flight" info="ram" min={0.5} max={50} step={0.5} value={inp.perReqMb} display={`${inp.perReqMb} MB`} onChange={(v) => set({ perReqMb: v })} />
          <Slider label="Target CPU at peak" info="utilization" min={30} max={85} value={inp.targetUtil} display={`${inp.targetUtil}%`} onChange={(v) => set({ targetUtil: v })} hint="60% leaves room for spikes and keeps latency low (section 05)." />
          <Toggle label="Survive losing one server (N+1)" info="spof" checked={inp.redundancy} onChange={(v) => set({ redundancy: v })} hint="Always add one spare server beyond what the load needs." />
        </div>

        <div className="cap-results">
          <div className="cap-kpis">
            <Kpi label="Peak requests / s" value={num(r.rps)} sub={`${fmt(inp.users)} × ${inp.reqPerMin} ÷ 60 × ${inp.spike}`} />
            <Kpi label="CPU cores busy" value={num(r.coresBusy, 2)} sub={`${num(r.rps)} req/s × ${inp.cpuMs} ms`} />
            <Kpi label="Cores to buy" value={num(r.coresNeeded, 1)} sub={`÷ ${inp.targetUtil}% target`} tone="good" />
            <Kpi label="Requests in flight" value={num(r.inflight, 1)} sub={`${num(r.rps)} req/s × ${inp.respMs} ms (Little’s law)`} />
          </div>

          <div className="panel cap-best">
            <div className="panel-label">Cheapest option that fits</div>
            <div className="cap-best-main">
              <span className="cap-best-n mono">{b.servers} ×</span>
              <span><b>{b.v} vCPU / {b.ram} GB</b><span className="dim"> · {b.shape ? b.shape.label : 'needs more RAM per vCPU'}</span></span>
            </div>
            <div className="cap-best-grid small">
              <span className="dim">AWS example</span><span className="mono">{b.aws}</span>
              <span className="dim">Hetzner example</span><span className="mono">{b.hetzner}</span>
              <span className="dim">Peak CPU, all servers up</span><span className="mono">{pct(b.utilAll)}</span>
              {inp.redundancy && <><span className="dim">Peak CPU, one server down</span><span className={`mono ${b.utilDegraded > 0.85 ? 'bad' : ''}`}>{pct(b.utilDegraded)}</span></>}
              <span className="dim">Processes per server</span><span className="mono">{b.procs} ({r.rt.label})</span>
              <span className="dim">≈ AWS on-demand / month</span><span className="mono">${fmt(b.monthly)}</span>
            </div>
            <div className="hero-ctas">
              {onTrySim && <button className="btn primary small" onClick={tryIt}>Try this setup in the Simulator →</button>}
            </div>
            <p className="dim small">Prices use the Simulator’s AWS-style on-demand rates. Hetzner and other European providers are usually several times cheaper for the same specs, and AWS savings plans cut 30–70%. Always check current prices.</p>
          </div>

          <div className="panel">
            <div className="panel-label">Compare server sizes</div>
            <div className="table-scroll"><table className="meth-table cap-table">
              <thead><tr><th>Size</th><th>Servers</th><th>Shape</th><th>CPU at peak</th>{inp.redundancy && <th>1 down</th>}<th>RAM need</th><th>≈ / month</th></tr></thead>
              <tbody>
                {r.options.map((o) => (
                  <tr key={o.v} className={o === b ? 'best' : ''}>
                    <td className="mono">{o.v} vCPU / {o.ram} GB{o === b && <span className="cap-tag mono">best</span>}</td>
                    <td className="mono">{o.servers}</td>
                    <td>{o.shape ? o.shape.label : 'high-memory'}</td>
                    <td className="mono">{pct(o.utilAll)}</td>
                    {inp.redundancy && <td className={`mono ${o.utilDegraded > 0.85 ? 'bad' : ''}`}>{pct(o.utilDegraded)}</td>}
                    <td className="mono">{num(o.memGb, 1)} GB</td>
                    <td className="mono">${fmt(o.monthly)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="dim small">“RAM need” = 0.5 GB for the OS + {r.rt.label} processes × {r.rt.baseMb} MB + requests in flight per server × {inp.perReqMb} MB, then 25% kept free. The shape is the smallest of compute (2 GB/vCPU), general (4) or memory-optimised (8) that fits.</p>
          </div>
          <div className="takeaway"><b>Then prove it:</b> rent one server of the chosen size for an hour, deploy, and load-test it at the peak rate. If p95 latency and errors stay within your target at {inp.targetUtil}% CPU, you’re done. If not, your CPU-per-request number was wrong; measure again.</div>
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`cap-kpi ${tone || ''}`}>
      <span className="dim small">{label}</span>
      <b className="mono">{value}</b>
      <span className="mono dim cap-kpi-sub">{sub}</span>
    </div>
  );
}

// ── 05 ─────────────────────────────────────────────────────────────────────
function KneeSection() {
  const [u, setU] = useState(60);
  const W = 640, H = 240, P = 36;
  const x = (r) => P + (r / 0.97) * (W - 2 * P);
  const y = (m) => H - P - (Math.min(m, 20) / 20) * (H - 2 * P);
  const pts = [];
  for (let r = 0; r <= 0.97; r += 0.01) pts.push(`${x(r).toFixed(1)},${y(1 / (1 - r)).toFixed(1)}`);
  const m = 1 / (1 - u / 100);
  return (
    <section className="net-sec">
      <SectionHead id="cap-knee" n="05" title="Why not run at 100% CPU: the knee">
        Requests don’t arrive evenly; they come in bursts. The busier a server is, the more often a new request has to wait for others to finish. Waiting grows slowly at first, then explodes.
      </SectionHead>
      <div className="cap-grid">
        <div className="panel">
          <svg viewBox={`0 0 ${W} ${H}`} className="cap-knee" role="img" aria-label="Response time multiplier against CPU utilisation">
            <rect x={x(0)} y={P} width={x(0.6) - x(0)} height={H - 2 * P} className="zone ok" />
            <rect x={x(0.6)} y={P} width={x(0.85) - x(0.6)} height={H - 2 * P} className="zone warn" />
            <rect x={x(0.85)} y={P} width={x(0.97) - x(0.85)} height={H - 2 * P} className="zone bad" />
            {[0, 0.2, 0.4, 0.6, 0.8, 0.95].map((t) => <text key={t} x={x(t)} y={H - 12} textAnchor="middle" className="axis">{Math.round(t * 100)}%</text>)}
            {[1, 5, 10, 20].map((t) => <text key={t} x={P - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}×</text>)}
            <polyline points={pts.join(' ')} className="curve" />
            <line x1={x(u / 100)} x2={x(u / 100)} y1={P} y2={H - P} className="marker" />
            <circle cx={x(u / 100)} cy={y(m)} r="5" className="dot" />
            <text x={W / 2} y={18} textAnchor="middle" className="axis title">response time ÷ time with an idle server, by CPU utilisation</text>
          </svg>
          <Slider label="Utilisation" info="utilization" min={10} max={97} value={u} display={`${u}%`} onChange={setU} />
          <div className="cap-formula mono">at {u}% busy → requests take about <b>{m.toFixed(1)}×</b> as long as on an idle server</div>
        </div>
        <div className="panel">
          <div className="panel-label">What this means for sizing</div>
          <ul className="cap-bullets">
            <li><b>Below ~60%</b>: waiting is small. A good target at your normal daily peak.</li>
            <li><b>60–85%</b>: latency starts to climb, and a spike pushes you over. Time to plan the next server.</li>
            <li><b>Above ~85%</b>: small increases in traffic cause large increases in latency, then timeouts and errors.</li>
            <li><b>N+1:</b> with 3 servers at 60%, losing one puts the other two at 90%. Size so the <i>degraded</i> case stays under ~85%.</li>
            <li>This curve is the classic single-queue result (M/M/1: time × 1 ÷ (1 − utilisation)). Real systems differ, but the shape holds, and the Simulator uses the same formula.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── 06 ─────────────────────────────────────────────────────────────────────
function SignalsSection({ onOpenBuild }) {
  return (
    <section className="net-sec">
      <SectionHead id="cap-signals" n="06" title="Watch the four golden signals">
        After launch, monitoring tells you whether the plan holds. Google’s SRE book names four signals to measure for every user-facing system. If you can only watch four things, watch these.
      </SectionHead>
      <div className="cap-signals">
        {GOLDEN.map((g) => (
          <article key={g.id} className="panel cap-signal" style={{ '--k': g.color }}>
            <h3>{g.name}</h3>
            <p>{g.what}</p>
            <p><b>For scaling:</b> {g.scale}</p>
            <p className="dim small"><b>Tip:</b> {g.tip}</p>
            <code className="cap-promql">{g.promql}</code>
          </article>
        ))}
      </div>
      <p className="dim small">The PromQL uses the metrics from the Build Your Own track (station 9), so you can paste it straight into your own Prometheus at http://localhost:9090.</p>
      <div className="cap-grid">
        <div className="panel">
          <div className="panel-label">Ideas from the SRE chapter, in short</div>
          <dl className="cap-rules">{SRE_POINTS.map((r) => <div key={r.k}><dt>{r.k}</dt><dd>{r.v}</dd></div>)}</dl>
          <a className="btn small" href={REFERENCES[0].url} target="_blank" rel="noopener noreferrer">Read the full chapter on sre.google ↗</a>
        </div>
        <div className="panel">
          <div className="panel-label">Three checklists, same idea <Info term="monitoring" label="monitoring" /></div>
          <div className="table-scroll"><table className="meth-table">
            <thead><tr><th>Method</th><th>For</th><th>Measure</th></tr></thead>
            <tbody>{METHODS.map((m) => <tr key={m.name}><td>{m.name}<div className="dim small">{m.by}</div></td><td>{m.use}</td><td>{m.items}</td></tr>)}</tbody>
          </table></div>
          <p className="dim small">Turn the signals into promises with <Term term="slo">SLOs</Term> (“99.5% of requests succeed”, “95% faster than 300 ms”) and alert when you burn through the error budget too fast.</p>
          {onOpenBuild && <button className="btn small" onClick={() => onOpenBuild('adv-slo')}>Set up SLO alerts: Build Your Own → Advanced A3 →</button>}
        </div>
      </div>
    </section>
  );
}

// ── 07 ─────────────────────────────────────────────────────────────────────
function DecideSection() {
  return (
    <section className="net-sec">
      <SectionHead id="cap-decide" n="07" title="Scale up, scale out, or optimise?">
        Which signal moved tells you what to do. Adding servers only helps when the app servers themselves are the <Term term="bottleneck">bottleneck</Term>.
      </SectionHead>
      <div className="panel">
        <div className="table-scroll"><table className="meth-table cap-decide">
          <thead><tr><th>You see</th><th>It means</th><th>Do this</th></tr></thead>
          <tbody>{DECIDE.map((d) => <tr key={d.signal}><td>{d.signal}</td><td><span className="cap-tag mono">{d.means}</span></td><td>{d.action}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="cap-grid">
        <div className="panel"><b>Scale up (<Term term="vertical">vertical</Term>)</b><p className="dim small">Same number of servers, bigger ones. Simplest; great for databases. Has a ceiling and usually a restart.</p></div>
        <div className="panel"><b>Scale out (<Term term="horizontal">horizontal</Term>)</b><p className="dim small">More servers behind a load balancer. No ceiling and adds redundancy, but the app must be stateless and the database takes more connections.</p></div>
      </div>
    </section>
  );
}

// ── 08 ─────────────────────────────────────────────────────────────────────
function MachineSection() {
  return (
    <section className="net-sec">
      <SectionHead id="cap-machine" n="08" title="Choosing the machine">
        Once you know vCPU and RAM, pick the shape and the kind of CPU. These choices matter as much as the size.
      </SectionHead>
      <div className="cap-grid">
        <div className="panel">
          <div className="panel-label">Shapes: RAM per vCPU</div>
          <div className="table-scroll"><table className="meth-table">
            <thead><tr><th>Shape</th><th>GB / vCPU</th><th>AWS</th><th>Good for</th></tr></thead>
            <tbody>{RAM_RATIOS.map((s) => <tr key={s.id}><td>{s.label}</td><td className="mono">{s.gbPerVcpu}</td><td className="mono">{s.aws}</td><td>{s.note}</td></tr>)}</tbody>
          </table></div>
        </div>
        <div className="panel">
          <div className="panel-label">Things that bite</div>
          <dl className="cap-rules">{MACHINE_TIPS.map((r) => <div key={r.k}><dt>{r.k}</dt><dd>{r.v}</dd></div>)}</dl>
        </div>
      </div>
      <div className="panel">
        <div className="panel-label">Where to find them</div>
        <div className="table-scroll"><table className="meth-table">
          <thead><tr><th>Provider</th><th>Shared / burstable</th><th>Dedicated / steady</th><th>Notes</th></tr></thead>
          <tbody>{PROVIDERS.map((p) => <tr key={p.name}><td><a href={p.pricing} target="_blank" rel="noopener noreferrer">{p.name} ↗</a></td><td>{p.shared}</td><td>{p.dedicated}</td><td>{p.note}</td></tr>)}</tbody>
        </table></div>
        <p className="dim small">Instance names and prices change often; the links go to each provider’s current price list.</p>
      </div>
    </section>
  );
}

// ── 09 ─────────────────────────────────────────────────────────────────────
function CheckSection() {
  const [done, setDone] = useState(() => new Set());
  return (
    <section className="net-sec">
      <SectionHead id="cap-check" n="09" title="Before you buy: checklist and further reading" />
      <div className="cap-grid">
        <div className="panel">
          <ul className="tasks">
            {CHECKLIST.map((c, i) => (
              <li key={i}><label className={done.has(i) ? 'checked' : ''}>
                <input type="checkbox" checked={done.has(i)} onChange={() => setDone((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                <span>{c}</span>
              </label></li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-label">Further reading</div>
          <ul className="cap-bullets">{REFERENCES.map((r) => <li key={r.url}><a href={r.url} target="_blank" rel="noopener noreferrer">{r.label} ↗</a></li>)}</ul>
        </div>
      </div>
    </section>
  );
}
