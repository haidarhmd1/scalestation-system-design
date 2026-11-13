// "How to add this to your project": the changes made on the map since the
// layout was loaded, each with a step-by-step guide in Node.js, Python or Go.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import CodeBlock from './CodeBlock.jsx';
import { GUIDE_RUNTIMES, changesBetween, guideFor, removalsBetween, runtimeFor } from '../data/howto.js';

export function ChangesBox({ base, cfg, studio, onReset }) {
  const changes = useMemo(() => changesBetween(base, cfg), [base, cfg]);
  const removed = useMemo(() => removalsBetween(base, cfg), [base, cfg]);
  const [open, setOpen] = useState(null); // index into changes
  if (!changes.length && !removed.length) return null;
  return (
    <div className="changes-box">
      <div className="panel-label mono">{studio ? 'CHANGES VS YOUR PROJECT' : 'WHAT YOU CHANGED'}</div>
      <p className="dim small">{studio ? 'Each one has a step-by-step guide for your stack.' : 'How would you build this for real? Each change has a step-by-step guide.'}</p>
      <ul>
        {changes.map((c, i) => (
          <li key={c.id}>
            <span className="changes-label">{c.label}</span>
            <button className="btn small" onClick={() => setOpen(i)}>How to add →</button>
          </li>
        ))}
        {removed.map((r) => <li key={r} className="dim small">Removed: {r}</li>)}
      </ul>
      {changes.length > 1 && <button className="btn ghost small full" onClick={() => setOpen(0)}>Open all {changes.length} guides</button>}
      <button className="btn ghost small full" onClick={onReset} title="Forget these changes as the starting point">{studio ? 'Back to my project’s layout' : 'Back to the starting layout'}</button>
      {/* Portal: the sidebar is its own stacking layer, so the map would draw over the modal. */}
      {open !== null && createPortal(<HowToModal changes={changes} start={open} cfg={cfg} base={base} studio={studio} onClose={() => setOpen(null)} />, document.body)}
    </div>
  );
}

function HowToModal({ changes, start, cfg, base, studio, onClose }) {
  const [idx, setIdx] = useState(start);
  const [runtime, setRuntime] = useState(runtimeFor(cfg.tech?.runtime));
  const change = changes[Math.min(idx, changes.length - 1)];
  const guide = useMemo(() => guideFor(change, { cfg, base, runtime }), [change, cfg, base, runtime]);
  const otherRuntime = !GUIDE_RUNTIMES.some((r) => r.id === cfg.tech?.runtime);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  useEffect(() => { document.querySelector('.howto-body')?.scrollTo(0, 0); }, [idx, runtime]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal howto-modal" role="dialog" aria-modal="true" aria-label={`How to add: ${change.label}`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="eyebrow mono">HOW TO ADD THIS TO {studio ? 'YOUR PROJECT' : 'A REAL PROJECT'} · {idx + 1} / {changes.length}</div>
            <h2>{change.label}</h2>
            <p className="lede">{change.detail}</p>
          </div>
          <div className="modal-actions"><button className="btn ghost small" onClick={onClose} aria-label="Close">✕</button></div>
        </header>
        <div className="howto-layout">
          {changes.length > 1 && (
            <nav className="howto-nav" aria-label="Changes">
              {changes.map((c, i) => (
                <button key={c.id} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)}>
                  <span className="mono dim">{String(i + 1).padStart(2, '0')}</span> {c.label}
                </button>
              ))}
            </nav>
          )}
          <div className="howto-body">
            <div className="howto-runtime">
              <span className="mono dim small">CODE IN</span>
              <div className="seg small">
                {GUIDE_RUNTIMES.map((r) => <button key={r.id} className={runtime === r.id ? 'on' : ''} onClick={() => setRuntime(r.id)}>{r.label}</button>)}
              </div>
              {otherRuntime && <span className="dim small">Examples in Node.js, Python and Go; the steps are the same for other languages.</span>}
            </div>
            {guide ? (
              <>
                <p className="howto-intro">{guide.intro}</p>
                <ol className="howto-steps">
                  {guide.steps.map((s, i) => (
                    <li key={i}>
                      <h3><span className="howto-num mono">{i + 1}</span>{s.title}</h3>
                      {s.text && <p className="dim">{s.text}</p>}
                      {s.blocks?.map((b, j) => <CodeBlock key={j} {...b} />)}
                    </li>
                  ))}
                </ol>
                {guide.pitfalls && (
                  <div className="howto-pitfalls">
                    <div className="panel-label mono">WATCH OUT FOR</div>
                    <ul>{guide.pitfalls.map((p) => <li key={p}>{p}</li>)}</ul>
                  </div>
                )}
              </>
            ) : <p className="dim">No guide for this change yet.</p>}
            <div className="howto-foot">
              {studio
                ? <p className="small dim">Built it? Run the load test again on the <b>Your Project</b> tab, compare with the last result, then <b>Calibrate</b> so the map matches the new system.</p>
                : <p className="small dim">Want to try it for real? <span className="mono">npx scalestation demo</span> gives you a small shop app to follow these guides on.</p>}
              <div className="howto-pager">
                <button className="btn ghost small" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Previous</button>
                <button className="btn small" disabled={idx === changes.length - 1} onClick={() => setIdx(idx + 1)}>Next →</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
