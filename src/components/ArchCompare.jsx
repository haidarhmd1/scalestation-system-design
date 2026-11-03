import { useEffect, useState } from 'react';
import { ARCH_DIMENSIONS, ARCH_PATH, ARCH_STYLES } from '../data/architectures.js';
import { PATTERNS } from '../data/patterns.js';

const byId = (id) => ARCH_STYLES.find((s) => s.id === id);

function Score({ n }) {
  return (
    <span className="ops-score" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
      <span className="mono dim">{n}/5</span>
    </span>
  );
}

const cell = (style, dim) => (dim.score ? <Score n={style[dim.key]} /> : style[dim.key]);

// Pop-up: open it with a starting pair, e.g. { a: 'monolith', b: 'microservices' }.
export default function ArchCompare({ onOpenPattern, start, onClose }) {
  const [a, setA] = useState(start?.a || 'monolith');
  const [b, setB] = useState(start?.b || (start?.a === 'microservices' ? 'modular-monolith' : 'microservices'));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.gl-back')) return; // a glossary pop-up on top closes first
      onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const A = byId(a);
  const B = byId(b);
  const pa = PATTERNS.find((p) => p.id === a);
  const pb = PATTERNS.find((p) => p.id === b);

  return (
    <div className="modal-back" onClick={onClose}>
    <div className="modal compare-modal" role="dialog" aria-modal="true" aria-label="Architecture styles compared" onClick={(e) => e.stopPropagation()}>
      <header className="modal-head">
        <div>
          <div className="mono eyebrow"><span className="line-badge compare-badge">⇄ VS</span> ARCHITECTURE STYLES</div>
          <h2>Architecture styles compared</h2>
          <p className="lede">Monolith, modular monolith, SOA, microservices, serverless, and the anti-pattern to avoid. Pick any two.</p>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>
      <div className="compare-body">

      <div className="panel vs">
        <div className="vs-pick">
          <StylePick value={a} onChange={setA} other={b} />
          <button className="btn ghost small vs-swap" onClick={() => { setA(b); setB(a); }} aria-label="Swap the two styles">⇄</button>
          <StylePick value={b} onChange={setB} other={a} />
        </div>

        <div className="vs-head">
          <div />
          {[A, B].map((s) => (
            <div key={s.id} className={`vs-title ${s.antiPattern ? 'anti' : ''}`}>
              <h3>{s.name}{s.antiPattern && <span className="anti-tag mono">anti-pattern</span>}</h3>
              <p className="dim small">{s.tagline}</p>
              <button className="btn ghost small" onClick={() => onOpenPattern(s.id)}>See how it works ↗</button>
            </div>
          ))}
        </div>

        <div className="vs-rows">
          {ARCH_DIMENSIONS.map((d) => {
            const differs = String(A[d.key]) !== String(B[d.key]);
            return (
              <div key={d.key} className={`vs-row ${differs ? 'differs' : 'same'}`}>
                <div className="vs-dim mono">{d.label}</div>
                <div className="vs-cell">{cell(A, d)}</div>
                <div className="vs-cell">{cell(B, d)}</div>
              </div>
            );
          })}
        </div>

        <div className="vs-proscons">
          {[[A, pa], [B, pb]].map(([s, p]) => (
            <div key={s.id} className="vs-pc">
              <h4 className="mono">{s.short}</h4>
              <div className="pc-good"><b>Gains</b><ul>{p.pros.map((x) => <li key={x}>{x}</li>)}</ul></div>
              <div className="pc-bad"><b>Costs</b><ul>{p.cons.map((x) => <li key={x}>{x}</li>)}</ul></div>
            </div>
          ))}
        </div>
        <p className="dim small vs-legend">Rows where the two styles differ are highlighted.</p>
      </div>

      <div className="panel choose">
        <div className="panel-label mono">HOW TO CHOOSE · A TYPICAL PATH</div>
        <ol className="path">
          {ARCH_PATH.map((step, i) => (
            <li key={step.id}>
              <button className="path-stop" onClick={() => onOpenPattern(step.id)}>
                <span className="path-num mono">{i + 1}</span>
                <span><b>{byId(step.id).name}</b><span className="dim"> · {step.when}</span></span>
              </button>
            </li>
          ))}
        </ol>
        <p className="dim small">Most products never need to go past step 2. SOA is mainly something you inherit in large enterprises. If your services can only be released together and share one database, you have a <button className="linkish" onClick={() => onOpenPattern('distributed-monolith')}>distributed monolith</button>: merge them back or redraw the boundaries.</p>
      </div>

      <details className="panel all-styles">
        <summary className="mono">ALL SIX STYLES AT A GLANCE (TABLE)</summary>
        <div className="table-scroll">
          <table className="meth-table arch-table">
            <thead>
              <tr><th /> {ARCH_STYLES.map((s) => <th key={s.id} className={s.antiPattern ? 'anti' : ''}>{s.short}</th>)}</tr>
            </thead>
            <tbody>
              {ARCH_DIMENSIONS.map((d) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  {ARCH_STYLES.map((s) => <td key={s.id}>{cell(s, d)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      </div>
    </div>
    </div>
  );
}

function StylePick({ value, onChange, other }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Architecture style">
      {ARCH_STYLES.map((s) => <option key={s.id} value={s.id} disabled={s.id === other}>{s.name}</option>)}
    </select>
  );
}

// Small "how it compares" block for the pattern pop-up of a style.
export function CompareTeaser({ id, onCompare }) {
  const s = byId(id);
  if (!s) return null;
  return (
    <section className="msec compare-teaser">
      <h3 className="mono">How it compares</h3>
      <p><b>Best when:</b> {s.best}. <b>Watch out for:</b> {s.watch}.</p>
      <div className="teaser-grid">
        {ARCH_STYLES.filter((x) => x.id !== id).map((x) => (
          <button key={x.id} className="chip" onClick={() => onCompare(id, x.id)}>{s.short} vs {x.short}</button>
        ))}
      </div>
    </section>
  );
}
