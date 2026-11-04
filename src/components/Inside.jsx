import { useEffect, useMemo, useState } from 'react';
import { INSIDE, INTERNAL_FLOWS, STATION_PICKER, TECH_NOTES } from '../data/internals.js';
import { PICKERS, TECH_DEFAULTS } from '../sim/tech.js';
import { FLOW_TERMS, SeqDiagram } from './Networking.jsx';
import { TermChips } from './Glossary.jsx';

const LABEL = { users: 'Users', dns: 'DNS', cdn: 'CDN edge', gateway: 'API gateway', lb: 'Load balancer', proxy: 'Reverse proxy', app: 'App servers', cache: 'Cache', db: 'Database', queue: 'Queue', workers: 'Workers' };

const val = (x, ctx) => (typeof x === 'function' ? x(ctx) : x);
const fill = (s, tech) => (typeof s === 'string' ? s.replaceAll('{tech}', tech) : s);

// Pop-up: what happens inside one station, in software and hardware.
export default function InsideModal({ id, cfg, r, onClose }) {
  const key = STATION_PICKER[id];
  const current = key ? (cfg.tech?.[key] ?? TECH_DEFAULTS[key]) : null;
  const [techId, setTechId] = useState(current);
  useEffect(() => { setTechId(current); }, [id, current]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.gl-back')) return;
      e.stopImmediatePropagation(); // don't also leave simulator full screen
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const info = INSIDE[id];
  const options = key ? PICKERS[key].options : [];
  const opt = options.find((o) => o.id === techId);
  const tech = opt ? opt.name.replace(/\s*\(.*\)$/, '') : LABEL[id];
  const ctx = { cfg, r, techId, tech };

  const flowKey = info.flow(ctx);
  const flow = useMemo(() => {
    const fl = INTERNAL_FLOWS[flowKey];
    return {
      ...fl,
      id: `${id}-${flowKey}-${techId}`,
      title: fill(val(info.title, ctx), tech),
      actors: fl.actors.map((a) => ({ ...a, label: fill(a.label, tech), sub: fill(a.sub, tech) })),
      steps: fl.steps.map((s) => ({ ...s, msg: fill(s.msg, tech), text: fill(s.text, tech) })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowKey, techId, id]);

  const live = info.live(ctx);
  const notes = TECH_NOTES[techId];

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal inside-modal" role="dialog" aria-modal="true" aria-label={`Inside ${tech}`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="mono eyebrow"><span className="line-badge">⌕ INSIDE</span> {LABEL[id].toUpperCase()}{opt ? ` · ${opt.kind.toUpperCase()}` : ''}</div>
            <h2>{fill(val(info.title, ctx), tech)}</h2>
            <p className="lede">{fill(val(info.summary, ctx), tech)}</p>
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>

        <div className="inside-body">
          <section className="inside-flow">
            {options.length > 1 && (
              <div className="inside-tech">
                <span className="mono dim small">SEE IT IN</span>
                {options.map((o) => (
                  <button key={o.id} className={`chip ${o.id === techId ? 'on' : ''} ${o.id === current ? 'cur' : ''}`} onClick={() => setTechId(o.id)} title={o.note}>
                    {o.name.replace(/\s*\(.*\)$/, '')}
                  </button>
                ))}
              </div>
            )}
            <div className="panel-label mono">ONE REQUEST, STEP BY STEP</div>
            <SeqDiagram flow={flow} />
          </section>

          <aside className="inside-side">
            {live?.length > 0 && (
              <div className="inside-sec">
                <h3>Live in your simulation</h3>
                <div className="inside-live">
                  {live.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
                </div>
              </div>
            )}
            {notes && (
              <div className="inside-sec">
                <h3>How {tech} does it</h3>
                <ul className="inside-notes">{notes.map((n) => <li key={n}>{n}<TermChips text={n} only={FLOW_TERMS} max={3} /></li>)}</ul>
              </div>
            )}
            <div className="inside-sec">
              <h3>Software: what runs inside</h3>
              <ul className="inside-list" style={{ '--k': '#4da3ff' }}>
                {info.software.map(([k, v]) => <li key={k}><b>{k}</b>{fill(val(v, ctx), tech)}<TermChips text={`${k} ${fill(val(v, ctx), tech)}`} only={FLOW_TERMS} max={3} /></li>)}
              </ul>
            </div>
            <div className="inside-sec">
              <h3>Hardware: what the machine does</h3>
              <ul className="inside-list" style={{ '--k': '#f472b6' }}>
                {info.hardware.map(([k, v]) => <li key={k}><b>{k}</b>{fill(val(v, ctx), tech)}<TermChips text={`${k} ${fill(val(v, ctx), tech)}`} only={FLOW_TERMS} max={3} /></li>)}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
