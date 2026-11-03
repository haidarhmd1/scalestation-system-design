import { useEffect, useMemo, useRef, useState } from 'react';
import { NODE_TYPES } from '../data/patterns.js';

const COLW = 170;
const ROWH = 96;
const NW = 138;
const NH = 50;
const PAD = 26;

const MOVE_MS = 950;
const HOLD_MS = 1500;

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export default function FlowDiagram({ pattern, accent }) {
  const { nodes, steps, links = [], groups = [] } = pattern;

  const layout = useMemo(() => {
    const pos = {};
    let maxX = 0;
    let maxY = 0;
    nodes.forEach((nd) => {
      const x = PAD + NW / 2 + nd.x * COLW;
      const y = PAD + 18 + NH / 2 + nd.y * ROWH;
      pos[nd.id] = { ...nd, x, y };
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    const edges = new Map();
    [...links, ...steps.map((s) => [s[0], s[1]])].forEach(([a, b]) => {
      if (a !== b && pos[a] && pos[b]) edges.set(key(a, b), [a, b]);
    });
    return { pos, edges: [...edges.values()], w: maxX + NW / 2 + PAD, h: maxY + NH / 2 + PAD + 6 };
  }, [nodes, steps, links]);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const raf = useRef(0);
  const start = useRef(performance.now());

  useEffect(() => {
    setStep(0);
    setPlaying(true);
    start.current = performance.now();
  }, [pattern.id]);

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

  const go = (i) => {
    setStep((i + steps.length) % steps.length);
    start.current = performance.now();
  };

  const [from, to] = steps[step];
  const A = layout.pos[from];
  const B = layout.pos[to];
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const px = A.x + (B.x - A.x) * ease;
  const py = A.y + (B.y - A.y) * ease;
  const activeKey = key(from, to);
  const pkColor = NODE_TYPES[B.type]?.color || accent;

  return (
    <div className="flow">
      <div className="flow-canvas">
        <svg viewBox={`0 0 ${layout.w} ${layout.h}`} className="flow-svg" role="img" aria-label={`${pattern.title} flow diagram`}>
          <defs>
            <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0H0V24" fill="none" stroke="var(--grid)" strokeWidth="1" />
            </pattern>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <rect width={layout.w} height={layout.h} fill="url(#grid)" />

          {groups.map((g) => {
            const ps = g.nodes.map((id) => layout.pos[id]).filter(Boolean);
            const x1 = Math.min(...ps.map((p) => p.x)) - NW / 2 - 12;
            const x2 = Math.max(...ps.map((p) => p.x)) + NW / 2 + 12;
            const y1 = Math.min(...ps.map((p) => p.y)) - NH / 2 - 22;
            const y2 = Math.max(...ps.map((p) => p.y)) + NH / 2 + 10;
            return (
              <g key={g.label}>
                <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} rx="10" className="flow-group" />
                <text x={x1 + 10} y={y1 + 14} className="flow-group-label">{g.label}</text>
              </g>
            );
          })}

          {layout.edges.map(([a, b]) => {
            const p = layout.pos[a];
            const q = layout.pos[b];
            const active = key(a, b) === activeKey;
            return (
              <g key={key(a, b)}>
                <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="track-bed" />
                <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="track-sleepers" />
                <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={active ? 'track-rail active' : 'track-rail'} style={active ? { stroke: pkColor } : undefined} />
              </g>
            );
          })}

          {/* the "train" */}
          <g filter="url(#glow)">
            <circle cx={px} cy={py} r="7" fill={pkColor} />
            <circle cx={px} cy={py} r="3" fill="#0b0f14" />
          </g>

          {nodes.map((nd) => {
            const p = layout.pos[nd.id];
            const ty = NODE_TYPES[nd.type] || NODE_TYPES.server;
            const active = nd.id === from || nd.id === to;
            const lines = nd.label.split('\n');
            return (
              <g key={nd.id} transform={`translate(${p.x - NW / 2},${p.y - NH / 2})`} className={active ? 'fnode active' : 'fnode'}>
                <rect width={NW} height={NH} rx="7" className="fnode-box" style={{ stroke: active ? ty.color : undefined }} />
                <rect width="4" height={NH - 12} y="6" x="6" rx="2" fill={ty.color} />
                <text x="16" y="15" className="fnode-tag" fill={ty.color}>{ty.tag.toUpperCase()}</text>
                {lines.map((l, i) => (
                  <text key={i} x="16" y={lines.length > 1 ? 29 + i * 13 : 35} className="fnode-label">{l}</text>
                ))}
                {active && <circle cx={NW - 10} cy="10" r="3.5" fill={nd.id === to && t >= 1 ? '#3ddc84' : '#ffb020'} />}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flow-controls">
        <button className="btn ghost" onClick={() => go(step - 1)} aria-label="Previous step">◀</button>
        <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
        <button className="btn ghost" onClick={() => go(step + 1)} aria-label="Next step">▶</button>
        <span className="mono dim">step {step + 1}/{steps.length}</span>
      </div>

      <ol className="timetable">
        {steps.map((s, i) => (
          <li key={i} className={i === step ? 'on' : i < step ? 'past' : ''} onClick={() => { go(i); setPlaying(false); }}>
            <span className="tt-idx mono">{String(i + 1).padStart(2, '0')}</span>
            <span className="tt-route mono">{layout.pos[s[0]].label.split('\n')[0]} → {layout.pos[s[1]].label.split('\n')[0]}</span>
            <span className="tt-text">{s[2]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
