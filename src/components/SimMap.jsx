import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fmt, pct } from '../sim/model.js';
import { shortTech } from '../sim/tech.js';

const InsideCtx = createContext(null);

export const STATUS_COLOR = { green: '#3ddc84', amber: '#ffb020', red: '#ff7a45', broken: '#ff4d4f', off: '#3a4552' };

const ST = {
  users: { x: 65, y: 300, w: 110, h: 76 },
  dns: { x: 220, y: 104, w: 120, h: 64 },
  cdn: { x: 220, y: 496, w: 120, h: 70 },
  gateway: { x: 320, y: 300, w: 112, h: 80 },
  lb: { x: 468, y: 300, w: 112, h: 80 },
  proxy: { x: 620, y: 300, w: 124, h: 80 },
  app: { x: 815, y: 300, w: 200, h: 180 },
  cache: { x: 1000, y: 104, w: 130, h: 76 },
  db: { x: 1150, y: 300, w: 156, h: 180 },
  queue: { x: 1000, y: 496, w: 120, h: 70 },
  workers: { x: 1155, y: 496, w: 120, h: 70 },
};

const EDGES = {
  'users-dns': [[65, 300], [65, 104], [220, 104]],
  'users-cdn': [[65, 300], [65, 496], [220, 496]],
  'users-gateway': [[65, 300], [320, 300]],
  'gateway-lb': [[320, 300], [468, 300]],
  'lb-proxy': [[468, 300], [620, 300]],
  'proxy-app': [[620, 300], [815, 300]],
  'app-cache': [[815, 250], [928, 250], [928, 104], [1000, 104]],
  'app-db': [[815, 300], [1150, 300]],
  'app-queue': [[815, 350], [928, 350], [928, 496], [1000, 496]],
  'queue-workers': [[1000, 496], [1155, 496]],
  'workers-db': [[1155, 496], [1155, 300]],
};
const EDGE_TARGET = { 'users-dns': 'dns', 'users-cdn': 'cdn', 'users-gateway': 'gateway', 'gateway-lb': 'lb', 'lb-proxy': 'proxy', 'proxy-app': 'app', 'app-cache': 'cache', 'app-db': 'db', 'app-queue': 'queue', 'queue-workers': 'workers', 'workers-db': 'db' };

function geom(points) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, len, at: total });
    total += len;
  }
  return { segs, total };
}
function pointAt(g, s) {
  for (const sg of g.segs) {
    if (s <= sg.at + sg.len) {
      const f = (s - sg.at) / sg.len;
      return [sg.x1 + (sg.x2 - sg.x1) * f, sg.y1 + (sg.y2 - sg.y1) * f];
    }
  }
  const l = g.segs[g.segs.length - 1];
  return [l.x2, l.y2];
}

const VW = 1240;
const VH = 590;

export default function SimMap({ r, cfg, servers, booting, selected, onSelect, fullscreen, onInside }) {
  // ── pan & zoom ──
  const svgRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef(null);
  const moved = useRef(false);

  const zoomAt = useCallback((factor, cx, cy) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = cx ?? rect.left + rect.width / 2;
    const py = cy ?? rect.top + rect.height / 2;
    const p = new DOMPoint(px, py).matrixTransform(svg.getScreenCTM().inverse());
    setView((v) => {
      const k = Math.min(5, Math.max(0.5, v.k * factor));
      return { k, x: p.x - ((p.x - v.x) * v.k) / k, y: p.y - ((p.y - v.y) * v.k) / k };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    const onWheel = (e) => {
      if (!(fullscreen || e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [fullscreen, zoomAt]);

  // fit again when entering / leaving full screen
  useEffect(() => { setView({ x: 0, y: 0, k: 1 }); }, [fullscreen]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, active: false };
    moved.current = false;
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.active && Math.hypot(dx, dy) > 4) {
      d.active = true;
      moved.current = true;
      svgRef.current.setPointerCapture(e.pointerId);
    }
    if (d.active) {
      const m = svgRef.current.getScreenCTM();
      setView((v) => ({ ...v, x: d.vx - dx / m.a, y: d.vy - dy / m.d }));
    }
  };
  const endDrag = () => { drag.current = null; };
  const onClickCapture = (e) => {
    if (moved.current) {
      e.stopPropagation();
      e.preventDefault();
      moved.current = false;
    }
  };
  const t = r.tiers;
  const layer = useRef(null);
  const live = useRef({ r, cfg });
  live.current = { r, cfg };
  const geoms = useMemo(() => Object.fromEntries(Object.entries(EDGES).map(([k, p]) => [k, geom(p)])), []);

  // particle "trains"
  useEffect(() => {
    const ns = 'http://www.w3.org/2000/svg';
    const g = layer.current;
    const parts = [];
    const pool = [];
    const acc = {};
    let last = performance.now();
    let raf;
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { r: rr } = live.current;
      for (const k in EDGES) {
        const flow = rr.flows[k] || 0;
        if (flow <= 0.01) continue;
        const rate = Math.min(11, Math.max(0.6, 1.6 * Math.log10(flow + 1)));
        acc[k] = (acc[k] || Math.random()) + rate * dt;
        while (acc[k] >= 1) {
          acc[k] -= 1;
          const target = rr.tiers[EDGE_TARGET[k]];
          const err = Math.random() < Math.min(0.95, rr.edgeErr[k] || 0);
          const st = target?.status || 'green';
          const color = err ? STATUS_COLOR.broken : STATUS_COLOR[st === 'off' ? 'green' : st];
          const slow = st === 'broken' ? 0.45 : st === 'red' ? 0.65 : st === 'amber' ? 0.85 : 1;
          let el = pool.pop();
          if (!el) {
            el = document.createElementNS(ns, 'rect');
            el.setAttribute('width', '10');
            el.setAttribute('height', '4');
            el.setAttribute('rx', '2');
            g.appendChild(el);
          }
          el.setAttribute('fill', color);
          el.style.display = '';
          parts.push({ el, k, s: 0, v: (150 + Math.random() * 40) * slow, err, life: 1 });
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        const gm = geoms[p.k];
        p.s += p.v * dt;
        const end = p.err ? gm.total * 0.82 : gm.total;
        if (p.s >= end) {
          p.el.style.display = 'none';
          pool.push(p.el);
          parts.splice(i, 1);
          continue;
        }
        const [x, y] = pointAt(gm, p.s);
        const [x2, y2] = pointAt(gm, Math.min(gm.total, p.s + 1));
        const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
        p.el.setAttribute('transform', `translate(${x},${y}) rotate(${ang}) translate(-5,-2)`);
        if (p.err) p.el.setAttribute('opacity', String(Math.max(0, 1 - Math.max(0, p.s / end - 0.6) * 2.5)));
        else p.el.setAttribute('opacity', '1');
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      while (g.firstChild) g.removeChild(g.firstChild);
    };
  }, [geoms]);

  const edgeOn = (k) => (r.flows[k] || 0) > 0.01;

  return (
    <div className="mapview">
    <div className="map-tools" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in">+</button>
      <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out">−</button>
      <button type="button" onClick={() => setView({ x: 0, y: 0, k: 1 })} aria-label="Reset view" title="Reset view">⟲</button>
      <span className="mono">{Math.round(view.k * 100)}%</span>
    </div>
    <InsideCtx.Provider value={onInside}>
    <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${VW / view.k} ${VH / view.k}`} className={`simmap ${drag.current?.active ? 'dragging' : ''}`} role="img" aria-label="Live system line diagram"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onClickCapture={onClickCapture}>
      <defs>
        <pattern id="sgrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="var(--grid)" strokeWidth="1" />
        </pattern>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#4da3ff" strokeWidth="2" />
        </pattern>
      </defs>
      <rect x="-4000" y="-4000" width="9240" height="8590" fill="url(#sgrid)" />

      {Object.entries(EDGES).map(([k, pts]) => {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
        const on = edgeOn(k);
        return (
          <g key={k} className={on ? 'trk on' : 'trk'}>
            <path d={d} className="trk-bed" />
            <path d={d} className="trk-sleep" />
            <path d={d} className="trk-rail" />
            {on && (
              <text className="trk-label" x={(pts[0][0] + pts[pts.length - 1][0]) / 2 + (pts.length > 2 ? 0 : 0)} y={pts.length > 2 ? pts[pts.length - 1][1] - 10 : pts[0][1] - 12} textAnchor="middle">
                {fmt(r.flows[k])}/s
              </text>
            )}
          </g>
        );
      })}

      <g ref={layer} className="trains" />

      <Station id="users" s={ST.users} title="USERS" status="green" sel={selected} onSelect={onSelect}
        lines={[`${fmt(r.users)} online`, `${fmt(r.raw)} req/s`]} />
      <Station id="dns" s={ST.dns} title={cfg.regions > 1 ? 'GEO DNS' : 'DNS'} status="green" sel={selected} onSelect={onSelect}
        lines={[cfg.regions > 1 ? `${cfg.regions} regions` : '1 region', `cached · TTL 300s`]} />
      <Station id="cdn" s={ST.cdn} title="CDN EDGE" tier={t.cdn} sel={selected} onSelect={onSelect}
        lines={t.cdn.on ? [`${fmt(t.cdn.in)}/s static`, '95% edge hits'] : ['not built', '+ add CDN']} />
      <Station id="gateway" s={ST.gateway} title="GATEWAY" tier={t.gateway} sel={selected} onSelect={onSelect}
        lines={t.gateway.on ? [`${pct(t.gateway.rho)} load`, `${fmt(t.gateway.blocked)}/s blocked`] : ['not built', 'pass-through']} />
      <Station id="lb" s={ST.lb} title={`LOAD BAL.${cfg.lbNodes > 1 && t.lb.on ? ` ×${cfg.lbNodes}` : ''}`} tier={t.lb} sel={selected} onSelect={onSelect}
        lines={t.lb.on ? [`${pct(t.lb.rho)} load`, cfg.lbAlgo] : ['not built', 'DNS → 1 box']} />
      <Station id="proxy" s={ST.proxy} title="REVERSE PROXY" tier={t.proxy} sel={selected} onSelect={onSelect}
        lines={t.proxy.on ? [`${pct(t.proxy.rho)} load`, `${fmt(t.proxy.staticServed)}/s static`] : ['not built', 'pass-through']} />

      <AppStation s={ST.app} t={t.app} cfg={cfg} servers={servers} booting={booting} sel={selected} onSelect={onSelect} />
      <Station id="cache" s={ST.cache} title="CACHE" tier={t.cache} sel={selected} onSelect={onSelect}
        lines={t.cache.on ? [`${cfg.cacheGb} GB · hit ${pct(t.cache.hit)}`, `${fmt(t.cache.in)}/s reads`] : ['not built', 'reads hit DB']} />
      <DbStation s={ST.db} t={t.db} cfg={cfg} sel={selected} onSelect={onSelect} />
      <Station id="queue" s={ST.queue} title="QUEUE" tier={t.queue} sel={selected} onSelect={onSelect}
        lines={t.queue.on ? [`backlog ${fmt(t.queue.backlog)}`, `${t.queue.growth > 0 ? '▲ +' + fmt(t.queue.growth) + '/s' : '▼ draining'}`] : ['not built', 'writes sync']} />
      <Station id="workers" s={ST.workers} title={`WORKERS ×${cfg.workers}`} tier={t.workers} sel={selected} onSelect={onSelect}
        lines={t.workers.on ? [`${pct(t.workers.rho)} busy`, `${fmt(t.workers.in)}/s drained`] : ['not built', '']} />

      {/* technology nameplates */}
      {[
        ['dns', true, shortTech(cfg, 'dns')],
        ['cdn', cfg.cdn, shortTech(cfg, 'cdn')],
        ['gateway', cfg.gateway, shortTech(cfg, 'gateway')],
        ['lb', cfg.lb, shortTech(cfg, 'lb')],
        ['proxy', cfg.proxy, shortTech(cfg, 'proxy')],
        ['app', true, shortTech(cfg, 'runtime') + (cfg.autoscale ? ` · ${shortTech(cfg, 'platform')}` : '')],
        ['cache', cfg.cache, shortTech(cfg, 'cache')],
        ['db', true, shortTech(cfg, 'db') + (cfg.pooler ? ` + ${shortTech(cfg, 'pooler')}` : '')],
        ['queue', cfg.queue, shortTech(cfg, 'queue')],
        ['workers', cfg.queue, shortTech(cfg, 'workers')],
      ].filter(([, on, name]) => on && name).map(([id, , name]) => {
        const s = ST[id];
        const w = name.length * 6.2 + 16;
        const y = s.y + s.h / 2 + 6;
        return (
          <g key={id} className="plate" onClick={() => onSelect(id)}>
            <rect x={s.x - w / 2} y={y} width={w} height="17" rx="3" />
            <text x={s.x} y={y + 12} textAnchor="middle">{name}</text>
          </g>
        );
      })}
    </svg>
    </InsideCtx.Provider>
    </div>
  );
}

// Approximate glyph widths per text style, used to keep text inside cards.
const CHAR_W = { 'st-line': 6.7, 'st-sub': 6.35, 'st-warn': 6.35, 'st-title': 7.1 };
const PAD = 9;

// Text that never overflows: if the estimated width is larger than `w`,
// SVG squeezes it to fit exactly.
function FitText({ x, y, w, className, children }) {
  const s = String(children ?? '');
  const est = s.length * (CHAR_W[className] || 6.4);
  const fit = est > w ? { textLength: w, lengthAdjust: 'spacingAndGlyphs' } : {};
  return <text x={x} y={y} className={className} {...fit}>{s}</text>;
}

// Small magnifier in the card header: opens the "look inside" pop-up.
function InsideButton({ id, x, y, title }) {
  const onInside = useContext(InsideCtx);
  if (!onInside) return null;
  const open = (e) => { e.stopPropagation(); onInside(id); };
  return (
    <g className="st-inside" transform={`translate(${x},${y})`} role="button" tabIndex={0} aria-label={`Look inside ${title}`}
      onClick={open} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } }}>
      <title>Look inside: how it works</title>
      <rect width="22" height="16" rx="4" />
      <circle cx="10" cy="7.3" r="3.6" />
      <line x1="12.7" y1="10" x2="15.6" y2="12.8" />
    </g>
  );
}

// Single signal light in the card header (no traffic-light housing).
function SignalDot({ x, y, status }) {
  const c = STATUS_COLOR[status];
  return (
    <g className={`sig ${status === 'broken' ? 'blink' : ''}`} aria-hidden="true">
      <circle cx={x} cy={y} r="7" fill={c} opacity="0.2" />
      <circle cx={x} cy={y} r="4" fill={c} />
    </g>
  );
}

function Frame({ id, s, title, status, sel, onSelect, children, off }) {
  const x = s.x - s.w / 2;
  const y = s.y - s.h / 2;
  return (
    <g className={`station ${off ? 'off' : ''} ${sel === id ? 'sel' : ''} st-${status}`} onClick={() => onSelect(id)} tabIndex={0} role="button" aria-label={title}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(id)}>
      <rect x={x} y={y} width={s.w} height={s.h} rx="8" className="st-box" />
      <rect x={x} y={y} width={s.w} height="20" rx="8" className="st-head" />
      <rect x={x} y={y + 12} width={s.w} height="8" className="st-head" />
      <FitText x={x + PAD} y={y + 14} w={s.w - PAD - (off ? 24 : 52)} className="st-title">{title}</FitText>
      {!off && <SignalDot x={x + s.w - 12} y={y + 10} status={status} />}
      {!off && <InsideButton id={id} x={x + s.w - 46} y={y + 2} title={title} />}
      {children(x, y)}
    </g>
  );
}

function Station({ id, s, title, tier, status, lines, sel, onSelect }) {
  const off = tier && tier.on === false;
  const st = status || tier?.status || 'green';
  const inner = s.w - PAD * 2;
  return (
    <Frame id={id} s={s} title={title} status={st} sel={sel} onSelect={onSelect} off={off}>
      {(x, y) => (
        <>
          {lines.map((l, i) => <FitText key={i} x={x + PAD} y={y + 38 + i * 15} w={inner} className={i === 0 ? 'st-line' : 'st-sub'}>{l}</FitText>)}
          {tier && !off && isFinite(tier.rho) && tier.rho > 0 && <UtilBar x={x + PAD} y={y + s.h - 11} w={inner} rho={tier.rho} />}
        </>
      )}
    </Frame>
  );
}

function UtilBar({ x, y, w, rho }) {
  const c = STATUS_COLOR[rho >= 1 ? 'broken' : rho >= 0.85 ? 'red' : rho >= 0.6 ? 'amber' : 'green'];
  return (
    <g>
      <rect x={x} y={y} width={w} height="4" rx="2" fill="#1b232d" />
      <rect x={x} y={y} width={Math.min(1, rho) * w} height="4" rx="2" fill={c} />
    </g>
  );
}

function AppStation({ s, t, cfg, servers, booting, sel, onSelect }) {
  const shown = Math.min(servers, 24);
  const bootShown = Math.min(booting, 24 - shown);
  const cols = 6;
  const perRho = t.rho;
  const c = STATUS_COLOR[t.status];
  const inner = s.w - PAD * 2;
  const warn = t.sessErr > 0 ? '⚠ sessions lost between servers'
    : t.cascade > 1.05 ? '⚠ threads blocked on DB'
    : !cfg.lb && servers > 1 ? `⚠ ${servers - 1} idle: no load balancer` : null;
  return (
    <Frame id="app" s={s} title={`APP SERVERS${cfg.regions > 1 ? ` ×${cfg.regions} regions` : ''}`} status={t.status} sel={sel} onSelect={onSelect}>
      {(x, y) => (
        <>
          <FitText x={x + PAD} y={y + 37} w={inner} className="st-line">{`${servers}${booting ? ` (+${booting} booting)` : ''} × ${cfg.vcpu} vCPU / ${cfg.ram} GB`}</FitText>
          <FitText x={x + PAD} y={y + 52} w={inner} className="st-sub">{`${pct(perRho)} load · ${t.perServer.bound}-bound · ${fmt(t.perServer.cap)}/server`}</FitText>
          {Array.from({ length: shown + bootShown }).map((_, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const idle = !cfg.lb && i > 0;
            const isBoot = i >= shown;
            return (
              <g key={i} transform={`translate(${x + 10 + col * 25},${y + 62 + row * 21})`}>
                <rect width="20" height="16" rx="3" fill={isBoot ? 'url(#hatch)' : idle ? '#1b232d' : '#0f1720'} stroke={isBoot ? '#4da3ff' : idle ? '#33404f' : c} strokeWidth="1.2" className={isBoot ? 'blink-slow' : ''} />
                {!isBoot && !idle && <rect x="3" y="11" width={Math.min(1, perRho) * 14} height="2.5" fill={c} />}
                {!isBoot && !idle && <rect x="3" y="4" width="3" height="3" fill={c} opacity="0.8" />}
              </g>
            );
          })}
          {servers + booting > 24 && <text x={x + s.w - PAD} y={y + s.h - 22} textAnchor="end" className="st-sub">+{servers + booting - 24} more</text>}
          {warn && <FitText x={x + PAD} y={y + s.h - 8} w={inner} className="st-warn">{warn}</FitText>}
        </>
      )}
    </Frame>
  );
}

function DbStation({ s, t, cfg, sel, onSelect }) {
  const shards = Math.min(cfg.shards, 8);
  const inner = s.w - PAD * 2;
  const pc = STATUS_COLOR[t.primaryRho >= 1 ? 'broken' : t.primaryRho >= 0.85 ? 'red' : t.primaryRho >= 0.6 ? 'amber' : 'green'];
  const reads = cfg.replicas > 0
    ? `${cfg.replicas}× replica ${pct(t.replicaRho)} · R ${fmt(t.reads)}/s`
    : `reads on primary · R ${fmt(t.reads)}/s`;
  return (
    <Frame id="db" s={s} title={`DATABASE${cfg.shards > 1 ? ` ×${cfg.shards}` : ''}`} status={t.status} sel={sel} onSelect={onSelect}>
      {(x, y) => (
        <>
          <FitText x={x + PAD} y={y + 37} w={inner} className="st-line">{`${cfg.dbVcpu} vCPU / ${cfg.dbRam} GB${cfg.pooler ? ' · pooled' : ''}`}</FitText>
          {Array.from({ length: shards }).map((_, i) => (
            <g key={i} transform={`translate(${x + 10 + (i % 4) * 30},${y + 48 + Math.floor(i / 4) * 30})`}>
              <ellipse cx="11" cy="4" rx="11" ry="4" fill="#0f1720" stroke={pc} />
              <path d="M0 4 V18 A11 4 0 0 0 22 18 V4" fill="#0f1720" stroke={pc} />
              <text x="11" y="17" textAnchor="middle" className="st-tiny">P</text>
            </g>
          ))}
          <FitText x={x + PAD} y={y + 118} w={inner} className="st-sub">{`primary ${pct(t.primaryRho)} · W ${fmt(t.writes)}/s`}</FitText>
          <FitText x={x + PAD} y={y + 133} w={inner} className="st-sub">{reads}</FitText>
          <FitText x={x + PAD} y={y + 148} w={inner} className={t.connErrFrac > 0 ? 'st-warn' : 'st-sub'}>{`conns ${fmt(t.connNeeded)} / ${fmt(t.connMax)}`}</FitText>
          <UtilBar x={x + PAD} y={y + s.h - 11} w={inner} rho={t.rho} />
        </>
      )}
    </Frame>
  );
}
