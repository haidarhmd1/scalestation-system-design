import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ENCAP_STACKS, ENCAP_STEPS, FLOWS, FLOW_PATTERNS, HTTP_COMPARE, KINDS, LAYERS, LAYER_SHORT,
  NUMBERS, PORTS, PROTOCOLS, SEGMENTS, TCPIP, TRANSPORT_COMPARE,
} from '../data/networking.js';
import { PATTERNS } from '../data/patterns.js';
import { Info, Term } from './Glossary.jsx';

const SECTIONS = [
  ['net-layers', 'Layers'],
  ['net-encap', 'Encapsulation'],
  ['net-flows', 'Flows'],
  ['net-compare', 'TCP vs UDP vs QUIC'],
  ['net-protocols', 'Protocols'],
  ['net-numbers', 'Numbers'],
];

const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

// Which sections are open. All start collapsed so the page isn't overwhelming.
const FoldCtx = createContext({ isOpen: () => true, toggle: () => {} });

export default function Networking({ onOpenPattern }) {
  const [flowId, setFlowId] = useState(FLOWS[0].id);
  const [protoId, setProtoId] = useState('tcp');
  const [open, setOpen] = useState(() => new Set());
  const reveal = (id) => { setOpen((o) => new Set(o).add(id)); setTimeout(() => scrollTo(id), 0); };
  const fold = useMemo(() => ({
    isOpen: (id) => open.has(id),
    toggle: (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
  }), [open]);
  const allOpen = open.size === SECTIONS.length;
  const showFlow = (id) => { setFlowId(id); reveal('net-flows'); };
  const showProto = (id) => { setProtoId(id); reveal('net-protocols'); };

  return (
    <FoldCtx.Provider value={fold}>
    <div className="net-page">
      <section className="hero net-hero">
        <div>
          <div className="eyebrow mono">NETWORKING · 7 LAYERS · {FLOWS.length} FLOWS · {PROTOCOLS.length} PROTOCOLS</div>
          <h1>What actually happens on the wire.</h1>
          <p className="lede">Every arrow in a system design diagram is a network trip. Here you can see how a request is wrapped in layers, how <Term term="tcp">TCP</Term> makes an unreliable network reliable, when <Term term="udp">UDP</Term> is the better choice, and where all the <Term term="rtt">round trips</Term> go before the first byte of a page arrives.</p>
          <div className="hero-ctas">
            <button className="btn primary" onClick={() => showFlow('url')}>▶ Start with: what happens when you open a URL</button>
          </div>
        </div>
        <nav className="net-toc" aria-label="On this page">
          {SECTIONS.map(([id, label], i) => (
            <button key={id} className={`legend-row ${open.has(id) ? 'is-open' : ''}`} onClick={() => reveal(id)}>
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

      <LayersSection onProto={showProto} />
      <Encapsulation />
      <FlowsSection flowId={flowId} setFlowId={setFlowId} onOpenPattern={onOpenPattern} />
      <CompareSection />
      <ProtocolsSection protoId={protoId} setProtoId={setProtoId} onFlow={showFlow} />
      <NumbersSection />
    </div>
    </FoldCtx.Provider>
  );
}

// Section header doubles as the collapse toggle; the rest of the section
// is hidden by CSS while it is closed (kept mounted, so state survives).
function SectionHead({ id, n, title, children }) {
  const { isOpen, toggle } = useContext(FoldCtx);
  const open = isOpen(id);
  return (
    <header className={`net-sec-head ${open ? 'open' : 'closed'}`} id={id}>
      <button type="button" className="net-sec-toggle" onClick={() => toggle(id)} aria-expanded={open} aria-controls={`${id}-body`}>
        <span className="line-badge mono">{n}</span>
        <h2>{title}</h2>
        <span className="net-sec-chev mono">{open ? 'Hide' : 'Show'} <i aria-hidden="true">▾</i></span>
      </button>
      {children && <p>{children}</p>}
    </header>
  );
}

// ── 1 · Layers ─────────────────────────────────────────────────────────────
function LayersSection({ onProto }) {
  const [sel, setSel] = useState(4);
  const L = LAYERS.find((l) => l.n === sel);
  const tcpipOf = TCPIP.find((t) => t.covers.includes(sel));
  return (
    <section className="net-sec" style={{marginBottom: "25px", marginTop: "25px"}}>
      <SectionHead id="net-layers" n="01" title="The layers">
        Networking is split into layers. Each one does a single job and only talks to the layers directly above and below it. The <Term term="osi">OSI model</Term> has 7 layers and is how people talk about networks (“an L7 load balancer”); the TCP/IP model has 4 and is what the internet actually runs.
      </SectionHead>
      <div className="osi-wrap">
        <div className="osi-grid" role="tablist" aria-label="Network layers">
          <div className="osi-col-head mono">OSI · 7 LAYERS</div>
          <div className="osi-col-head mono">TCP/IP · 4</div>
          {LAYERS.map((l, i) => (
            <button
              key={l.n}
              role="tab"
              aria-selected={l.n === sel}
              className={`osi-layer ${l.n === sel ? 'on' : ''}`}
              style={{ '--c': l.color, gridRow: i + 2 }}
              onClick={() => setSel(l.n)}
            >
              <span className="osi-n mono">L{l.n}</span>
              <span className="osi-name">{l.name}</span>
              <span className="osi-pdu mono">{l.pdu.split(' ')[0]}</span>
            </button>
          ))}
          {TCPIP.map((t) => {
            const start = LAYERS.findIndex((l) => l.n === t.covers[0]) + 2;
            return (
              <div key={t.name} className={`tcpip-layer ${t.covers.includes(sel) ? 'on' : ''}`} style={{ '--c': t.color, gridRow: `${start} / span ${t.covers.length}` }}>
                <b>{t.name}</b>
                <span className="mono">{t.note}</span>
              </div>
            );
          })}
        </div>

        <article className="panel layer-detail" style={{ '--c': L.color }}>
          <div className="mono eyebrow">LAYER {L.n} · TCP/IP: {tcpipOf.name.toUpperCase()}</div>
          <h3>{L.name}</h3>
          <p className="layer-job">{L.job}</p>
          <dl className="layer-facts">
            <div><dt>Unit of data</dt><dd>{L.pdu}{L.n <= 4 && <Info term="packet" label="packet" />}</dd></div>
            <div><dt>Addresses</dt><dd>{L.address}</dd></div>
            <div>
              <dt>Protocols</dt>
              <dd className="proto-chips">
                {L.protocols.map((id) => {
                  const p = PROTOCOLS.find((x) => x.id === id);
                  return <button key={id} className="chip" style={{ '--k': KINDS[p.kind].color }} onClick={() => onProto(id)}>{p.name}</button>;
                })}
                {L.extra && <span className="dim">{L.protocols.length ? '· ' : ''}{L.extra}</span>}
              </dd>
            </div>
            <div><dt>Where it lives</dt><dd>{L.devices}</dd></div>
          </dl>
          <div className="layer-analogy"><b>Like:</b> {L.analogy}</div>
          <div className="layer-design"><b>In system design:</b> {L.design}</div>
          <div className="layer-breaks"><b>When it breaks:</b> {L.breaks}</div>
          <div className="layer-tools">
            <span className="mono dim small">TRY IT</span>
            {L.tools.map((t) => <code key={t}>{t}</code>)}
          </div>
        </article>
      </div>
    </section>
  );
}

// Shared controls: previous / play-pause / next, step count and clickable dots.
function StepControls({ i, n, playing, onToggle, onGo, titles = [] }) {
  return (
    <div className="flow-controls step-controls">
      <button className="btn ghost" onClick={() => onGo(i - 1)} aria-label="Previous step">◀</button>
      <button className="btn" onClick={onToggle}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
      <button className="btn ghost" onClick={() => onGo(i + 1)} aria-label="Next step">▶</button>
      <span className="mono dim">step {i + 1}/{n}</span>
      <div className="encap-dots">
        {Array.from({ length: n }, (_, k) => (
          <button key={k} className={k === i ? 'on' : k < i ? 'past' : ''} onClick={() => onGo(k)} aria-label={`Step ${k + 1}${titles[k] ? `: ${titles[k]}` : ''}`} />
        ))}
      </div>
    </div>
  );
}

// ── 2 · Encapsulation ──────────────────────────────────────────────────────
const ENC_MS = 3400;

function segFields(id, st) {
  if (id === 'data' && st.enc) return ['🔒 encrypted bytes', 'only the server can read this'];
  if (id === 'ip' && st.routed) return SEGMENTS.ip.fields.map((f) => (f.startsWith('TTL') ? (st.at[0] === 'router' ? 'TTL: 63 (−1 per hop)' : 'TTL: 52 (after 12 hops)') : f));
  if (id === 'eth' && st.routed) return ['dst MAC: next router (5c:…:02)', 'src MAC: this router (a4:91:…:7e)', 'type: IPv4'];
  return SEGMENTS[id].fields;
}

function Encapsulation() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false); // starts paused: the reader drives it
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % ENCAP_STEPS.length), ENC_MS);
    return () => clearInterval(t);
  }, [playing]);
  const st = ENCAP_STEPS[i];
  const go = (n) => { setI((n + ENCAP_STEPS.length) % ENCAP_STEPS.length); setPlaying(false); };
  const phase = st.at[0] === 'send' ? 'going down: wrap' : st.at[0] === 'router' ? 'in transit' : 'going up: unwrap';

  return (
    <section className="net-sec" style={{marginBottom: "25px", marginTop: "25px"}}>
      <SectionHead id="net-encap" n="02" title="Encapsulation: envelopes inside envelopes">
        On the way down, each layer puts the data from the layer above inside its own envelope (a header). Routers only open the outer envelopes they need. On the way up, the receiver opens them one by one. Follow one HTTPS request.
      </SectionHead>
      <div className="panel encap">
        <div style={{display: "flex", alignSelf: "end"}}>
        <StepControls i={i} n={ENCAP_STEPS.length} playing={playing} onToggle={() => setPlaying((p) => !p)} onGo={go} titles={ENCAP_STEPS.map((x) => x.title)} />
          </div>
        <div className="encap-stacks">
          
          {Object.entries(ENCAP_STACKS).map(([key, s], si) => (
            <div key={key} className={`encap-stack ${st.at[0] === key ? 'on' : ''}`}>
              <div className="encap-stack-title mono">{s.title}</div>
              {s.layers.map((l) => (
                <div key={l} className={`encap-cell ${st.at[0] === key && st.at[1] === l ? 'on' : ''}`}>
                  <span className="mono">{l}</span> {LAYER_SHORT[l]}
                </div>
              ))}
              {si < 2 && <div className="encap-wire" aria-hidden="true"><i className={st.at[0] === key && st.at[1] === 'L1' ? 'go' : ''} /></div>}
            </div>
          ))}
        </div>

        <div className="encap-step">
          <div className="mono eyebrow">STEP {i + 1}/{ENCAP_STEPS.length} · {phase.toUpperCase()}</div>
          <h3>{st.title}</h3>
          <p>{st.text}</p>
        </div>

        <div className="packet" aria-label="The packet at this step">
          {st.bits ? (
            <div className="packet-bits mono" aria-label="bits">{'0110100001110100011101000111000000101111 1100101011110000101001010010111 0101010001010011'.split('').map((c, k) => <span key={k} style={{ animationDelay: `${k * 12}ms` }}>{c}</span>)}</div>
          ) : st.segs.map((id) => {
            const g = SEGMENTS[id];
            const enc = st.enc && (id === 'data');
            return (
              <div key={id} className={`pseg ${st.hl === id ? 'hl' : ''} ${enc ? 'enc' : ''}`} style={{ '--c': g.color, flexGrow: id === 'data' ? 2.2 : 1 }}>
                <span className="pseg-short mono">{g.short}</span>
                <span className="pseg-label">{enc ? 'HTTP (encrypted)' : g.label}</span>
                <ul>{segFields(id, st).map((f) => <li key={f} className="mono">{f}</li>)}</ul>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}

// ── 3 · Flows ──────────────────────────────────────────────────────────────
function FlowsSection({ flowId, setFlowId, onOpenPattern }) {
  const flow = FLOWS.find((f) => f.id === flowId);
  const pats = (FLOW_PATTERNS[flow.id] || []).map((id) => PATTERNS.find((p) => p.id === id)).filter(Boolean);
  return (
    <section className="net-sec" style={{marginBottom: "25px", marginTop: "25px"}}>
      <SectionHead id="net-flows" n="03" title="Flows: watch the packets move">
        Each diagram is a timeline: time runs downwards, every arrow is one trip across the network. The clock adds up how long it takes, so you can see why round trips matter.
      </SectionHead>
      <div className="flows-grid">
        <nav className="panel flow-list" aria-label="Flows">
          <ol>
            {FLOWS.map((f, i) => (
              <li key={f.id}>
                <button className={`route-stop ${f.id === flowId ? 'on' : ''}`} onClick={() => setFlowId(f.id)}>
                  <span className="route-dot">{i + 1}</span>
                  <span className="route-text">
                    <span className="route-title">{f.short}</span>
                    <span className="route-sub mono">{f.level}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="flow-main">
          <div className="panel">
            <h3 className="flow-title">{flow.title}</h3>
            <p className="dim flow-sum">{flow.summary}</p>
            <SeqDiagram flow={flow} />
            <div className="takeaway"><b>Takeaway:</b> {flow.takeaway}</div>
            {pats.length > 0 && onOpenPattern && (
              <div className="flow-pats">
                <span className="mono dim small">ON THE NETWORK MAP</span>
                {pats.map((p) => <button key={p.id} className="chip" onClick={() => onOpenPattern(p.id)}>{p.title} ↗</button>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// Internal flows run in microseconds; network flows in milliseconds.
const fmtMs = (v, total) => (total < 2 ? `${Math.round(v * 1000)} µs` : total < 20 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`);

const S_ROW = 44;
const S_TOP = 74;
const S_PADX = 86;
const MOVE_MS = 900;
const HOLD_MS = 1800;

export function SeqDiagram({ flow, autoPlay = false }) {
  const { actors, steps } = flow;
  const n = actors.length;
  const W = Math.max(640, n * 172);
  const H = S_TOP + steps.length * S_ROW + 18;
  const xs = useMemo(() => Object.fromEntries(actors.map((a, i) => [a.id, S_PADX + (i * (W - 2 * S_PADX)) / Math.max(1, n - 1)])), [actors, W, n]);
  const last = actors[n - 1].id;
  const cost = (s) => s.ms ?? (s.from === s.to ? 0 : flow.oneWay);
  const total = steps.reduce((a, s) => a + cost(s), 0);
  const kindsUsed = [...new Set(steps.map((s) => s.kind))];

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [t, setT] = useState(autoPlay ? 0 : 1);
  // when paused, show the current step already drawn instead of animating it in
  const start = useRef(performance.now() - (autoPlay ? 0 : MOVE_MS));
  const raf = useRef(0);
  const box = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    setStep(0);
    setPlaying(autoPlay);
    start.current = performance.now() - (autoPlay ? 0 : MOVE_MS);
  }, [flow.id, autoPlay]);

  useEffect(() => {
    const loop = (now) => {
      const el = now - start.current;
      setT(Math.min(1, el / MOVE_MS));
      if (playing && el > MOVE_MS + HOLD_MS) {
        start.current = now;
        setStep((s) => (s + 1) % steps.length);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, steps.length]);

  // keep the current arrow and timetable row in view inside their own scroll boxes
  useEffect(() => {
    const el = box.current;
    if (el) {
      const scale = el.clientWidth / W;
      const y = (S_TOP + step * S_ROW) * scale;
      if (y < el.scrollTop + 40 || y > el.scrollTop + el.clientHeight - 60) el.scrollTo({ top: Math.max(0, y - el.clientHeight / 2), behavior: 'smooth' });
    }
    const row = list.current?.children[step];
    const ul = list.current;
    if (row && ul && (row.offsetTop < ul.scrollTop || row.offsetTop + row.offsetHeight > ul.scrollTop + ul.clientHeight)) {
      ul.scrollTo({ top: row.offsetTop - 8, behavior: 'smooth' });
    }
  }, [step, W]);

  const go = (i) => { setStep((i + steps.length) % steps.length); start.current = performance.now(); };
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const elapsed = steps.slice(0, step).reduce((a, s) => a + cost(s), 0) + cost(steps[step]) * ease;
  const label = (id) => actors.find((a) => a.id === id).label;

  return (
    <div className="seq">
      <div className="seq-bar">
        <div className="seq-legend">
          {kindsUsed.map((k) => <span key={k} className="seq-kind mono" style={{ '--k': KINDS[k].color }}>{KINDS[k].label}</span>)}
        </div>
        <div className="seq-clock mono" title="Estimated time since the first step">
          ⏱ {fmtMs(elapsed, total)} <span className="dim">/ ~{fmtMs(total, total)}</span>
        </div>
      </div>
      <div className="seq-canvas" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} className="seq-svg" role="img" aria-label={`${flow.title}: sequence diagram`}>
          <defs>
            {Object.entries(KINDS).map(([k, v]) => (
              <marker key={k} id={`ah-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill={v.color} />
              </marker>
            ))}
          </defs>

          {actors.map((a) => (
            <g key={a.id}>
              <line x1={xs[a.id]} y1={S_TOP - 14} x2={xs[a.id]} y2={H - 8} className="seq-life" />
              <rect x={xs[a.id] - 72} y={8} width={144} height={a.sub ? 46 : 36} rx="8" className="seq-actor" />
              <text x={xs[a.id]} y={a.sub ? 28 : 31} textAnchor="middle" className="seq-actor-label">{a.label}</text>
              {a.sub && <text x={xs[a.id]} y={44} textAnchor="middle" className="seq-actor-sub">{a.sub}</text>}
            </g>
          ))}

          {steps.map((s, i) => {
            const y = S_TOP + i * S_ROW + S_ROW / 2;
            const c = KINDS[s.kind].color;
            const state = i < step ? 'past' : i === step ? 'now' : 'future';
            const op = state === 'past' ? 0.5 : state === 'now' ? 1 : 0.1;
            const x1 = xs[s.from];
            if (s.from === s.to) {
              const left = s.from === last;
              const d = left ? -1 : 1;
              const shown = state === 'now' ? ease : 1;
              return (
                <g key={i} opacity={op} className={state === 'now' ? 'seq-now' : ''}>
                  <path d={`M${x1} ${y - 9} h${d * 24} v18 h${-d * 24}`} fill="none" stroke={c} strokeWidth="1.6" strokeDasharray="3 3" markerEnd={`url(#ah-${s.kind})`} />
                  <rect x={left ? x1 - 30 - 6 * s.msg.length - 8 : x1 + 30} y={y - 10} width={6 * s.msg.length + 16} height="20" rx="5" className="seq-self" style={{ opacity: shown }} />
                  <text x={left ? x1 - 38 : x1 + 38} y={y + 4} textAnchor={left ? 'end' : 'start'} className="seq-msg" fill={c} style={{ opacity: shown }}>{s.msg}</text>
                </g>
              );
            }
            const x2 = xs[s.to];
            const frac = s.lost ? 0.55 : 1;
            const reach = state === 'now' ? ease * frac : frac;
            const xe = x1 + (x2 - x1) * reach;
            const xLost = x1 + (x2 - x1) * 0.55;
            const lostShown = s.lost && (state !== 'now' || t >= 1);
            return (
              <g key={i} opacity={op} className={state === 'now' ? 'seq-now' : ''}>
                <line x1={x1} y1={y} x2={xe} y2={y} stroke={c} strokeWidth={state === 'now' ? 2.4 : 1.6} markerEnd={!s.lost && reach > 0.05 ? `url(#ah-${s.kind})` : undefined} strokeDasharray={s.lost ? '6 4' : undefined} />
                {state === 'now' && !lostShown && <circle cx={xe} cy={y} r="5" fill={c} className="seq-dot" />}
                {lostShown && (
                  <g className="seq-lost">
                    <line x1={xLost - 7} y1={y - 7} x2={xLost + 7} y2={y + 7} />
                    <line x1={xLost - 7} y1={y + 7} x2={xLost + 7} y2={y - 7} />
                    <text x={xLost} y={y + 19} textAnchor="middle">lost</text>
                  </g>
                )}
                <text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle" className="seq-msg" fill={c}>{s.msg}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <StepControls i={step} n={steps.length} playing={playing} onToggle={() => { if (!playing) start.current = performance.now(); setPlaying((p) => !p); }} onGo={go} titles={steps.map((x) => x.msg)} />

      <ol className="timetable seq-table" ref={list}>
        {steps.map((s, i) => (
          <li key={i} className={i === step ? 'on' : i < step ? 'past' : ''} style={{ '--line': KINDS[s.kind].color }} onClick={() => { go(i); setPlaying(false); }}>
            <span className="tt-idx mono">{String(i + 1).padStart(2, '0')}</span>
            <span className="tt-route mono">{s.from === s.to ? label(s.from) : `${label(s.from)} → ${label(s.to)}`}{s.lost && <span className="lost-tag"> ✕ lost</span>}</span>
            <span className="tt-text"><code className="tt-msg" style={{ color: KINDS[s.kind].color }}>{s.msg}</code> {s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── 4 · Compare ────────────────────────────────────────────────────────────
function CompareTable({ data, caption }) {
  return (
    <div className="table-scroll">
      <table className="meth-table net-table">
        <caption className="mono">{caption}</caption>
        <thead><tr><th />{data.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {data.rows.map(([k, ...v]) => <tr key={k}><td>{k}</td>{v.map((x, i) => <td key={i} data-label={data.cols[i]}>{x}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function CompareSection() {
  return (
    <section className="net-sec" style={{marginBottom: "25px", marginTop: "25px"}}>
      <SectionHead id="net-compare" n="04" title="TCP vs UDP vs QUIC, and the HTTP versions">
        The choice of transport decides how your app behaves when the network is slow or drops packets, which on the real internet is all the time.
      </SectionHead>
      <div className="compare-grid">
        <div className="panel">
          <CompareTable data={TRANSPORT_COMPARE} caption="TRANSPORT PROTOCOLS" />
          <div className="pick-grid">
            {TRANSPORT_COMPARE.pick.map((p) => (
              <div key={p.when} className="pick-card" style={{ '--k': KINDS[p.pick.toLowerCase()].color }}>
                <span className="dim small">{p.when}</span>
                <b className="mono">→ {p.pick}</b>
                <span className="small">{p.why}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <CompareTable data={HTTP_COMPARE} caption="HTTP VERSIONS" />
          <p className="dim small">Your API code looks the same for all three: methods, paths, headers and status codes don’t change. Only the way they are carried does. Usually the load balancer or CDN speaks HTTP/2 or HTTP/3 to users and plain HTTP/1.1 to your app servers. <Info term="http" label="HTTP" /></p>
        </div>
      </div>
    </section>
  );
}

// ── 5 · Protocols ──────────────────────────────────────────────────────────
function ProtocolsSection({ protoId, setProtoId, onFlow }) {
  const p = PROTOCOLS.find((x) => x.id === protoId);
  const layer = LAYERS.find((l) => l.n === p.layer);
  return (
    <section className="net-sec" style={{marginBottom: "25px", marginTop: "25px"}}>
      <SectionHead id="net-protocols" n="05" title="Protocols, one by one">
        A protocol is an agreed set of rules for a conversation: who speaks first, what each message looks like and what to do when something goes wrong. Pick one.
      </SectionHead>
      <div className="proto-grid">
        <div className="proto-cards">
          {[...PROTOCOLS].sort((a, b) => a.layer - b.layer).map((x) => (
            <button key={x.id} className={`proto-card ${x.id === protoId ? 'on' : ''}`} style={{ '--k': KINDS[x.kind].color }} onClick={() => setProtoId(x.id)}>
              <span className="proto-top"><b>{x.name}</b><span className="mono proto-layer">L{x.layer}</span></span>
              <span className="proto-one">{x.one}</span>
            </button>
          ))}
        </div>
        <article className="panel proto-detail" style={{ '--k': KINDS[p.kind].color }}>
          <div className="mono eyebrow">LAYER {p.layer} · {layer.name.toUpperCase()} · {p.year}</div>
          <h3>{p.name}{p.glossary && <Info term={p.glossary} label={p.name} />}</h3>
          <div className="dim">{p.full}</div>
          <p className="proto-lead">{p.one}</p>
          <div className="proto-port mono"><span className="dim">PORT</span> {p.port}</div>
          <h4 className="mono">How it works</h4>
          <p>{p.how}</p>
          <h4 className="mono">Used for</h4>
          <p>{p.use}</p>
          <h4 className="mono">Watch out for</h4>
          <p>{p.watch}</p>
          <h4 className="mono">What its header carries</h4>
          <div className="hdr-fields">{p.header.map((h) => <code key={h}>{h}</code>)}</div>
          {p.flow && <button className="btn primary full" onClick={() => onFlow(p.flow)}>▶ Watch the flow: {FLOWS.find((f) => f.id === p.flow).short}</button>}
        </article>
      </div>
    </section>
  );
}

// ── 6 · Numbers ────────────────────────────────────────────────────────────
function NumbersSection() {
  return (
    <section className="net-sec" style={{marginBottom: "25px", marginTop: "25px"}}>
      <SectionHead id="net-numbers" n="06" title="Numbers worth knowing">
        Rough orders of magnitude to sanity-check a design. A request that crosses an ocean 4 times can’t be fast, however fast the servers are. <Info term="latency" label="latency" />
      </SectionHead>
      <div className="numbers-grid">
        <div className="num-cards">
          {NUMBERS.map((x) => (
            <div key={x.k} className="num-card">
              <span className="num-v mono">{x.v}</span>
              <span className="num-k">{x.k}</span>
              <span className="dim small">{x.note}</span>
            </div>
          ))}
        </div>
        <div className="panel ports">
          <div className="panel-label mono">PORTS YOU’LL MEET <Info term="port" label="port" /></div>
          <table className="meth-table">
            <tbody>{PORTS.map((x) => <tr key={x.p}><td className="mono">{x.p}</td><td>{x.what}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
