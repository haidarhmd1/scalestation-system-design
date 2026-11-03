import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, LEVELS, PATTERNS } from '../data/patterns.js';
import FlowDiagram from './FlowDiagram.jsx';
import { NeedLists, useGlossary } from './Glossary.jsx';
import { GLOSSARY, termsIn } from '../data/glossary.js';

export default function Catalogue({ onTrySim }) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [openId, setOpenId] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PATTERNS.filter((p) => (cat === 'All' || p.cat === cat) && (!q || `${p.title} ${p.summary} ${p.cat}`.toLowerCase().includes(q)));
  }, [query, cat]);

  const open = PATTERNS.find((p) => p.id === openId);

  return (
    <div className="catalogue">
      <section className="hero">
        <div>
          <div className="eyebrow mono">NETWORK MAP · {PATTERNS.length} STATIONS · 5 LINES</div>
          <h1>Learn system design by building, scaling and breaking it.</h1>
          <p className="lede">Ride from a single server to planet-scale databases. Each station is a pattern: click it to watch a request travel through the system step by step, then try it in the <b>Simulator</b>.</p>
        </div>
        <div className="legend">
          {LEVELS.map((l) => (
            <a key={l.id} href={`#line-${l.id}`} className="legend-row">
              <span className="legend-line" style={{ background: l.color }} />
              <span className="mono">{l.line}</span>
              <span>{l.name}</span>
            </a>
          ))}
        </div>
      </section>

      <div className="filters">
        <input className="search" placeholder="Search patterns… (cache, shard, queue)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips">
          {['All', ...CATEGORIES].map((c) => (
            <button key={c} className={c === cat ? 'chip on' : 'chip'} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>

      {LEVELS.map((lv) => {
        const items = filtered.filter((p) => p.level === lv.id);
        if (!items.length) return null;
        return (
          <section key={lv.id} id={`line-${lv.id}`} className="line" style={{ '--line': lv.color }}>
            <header className="line-head">
              <span className="line-badge mono">{lv.line}</span>
              <h2>{lv.name}</h2>
              <p>{lv.blurb}</p>
            </header>
            <div className="tiles">
              <div className="line-track" />
              {items.map((p) => (
                <button key={p.id} className="tile" onClick={() => setOpenId(p.id)}>
                  <span className="tile-station" />
                  <span className="tile-code mono">{p.code}</span>
                  <span className="tile-title">{p.title}</span>
                  <span className="tile-sum">{p.summary}</span>
                  <span className="tile-foot">
                    <span className="tag">{p.cat}</span>
                    <span className="pips" aria-label={`complexity ${p.level} of 5`}>
                      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= p.level ? 'on' : ''} />)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {!filtered.length && <p className="dim empty">No stations match “{query}”.</p>}

      {open && <PatternModal pattern={open} onClose={() => setOpenId(null)} onNav={setOpenId} onTrySim={onTrySim} />}
    </div>
  );
}

function PatternModal({ pattern: p, onClose, onNav, onTrySim }) {
  const lv = LEVELS.find((l) => l.id === p.level);
  const idx = PATTERNS.indexOf(p);
  const prev = PATTERNS[idx - 1];
  const next = PATTERNS[idx + 1];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && next) onNav(next.id);
      if (e.key === 'ArrowLeft' && prev) onNav(prev.id);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [next, prev, onClose, onNav]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ '--line': lv.color }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={p.title}>
        <header className="modal-head">
          <div>
            <div className="mono eyebrow"><span className="line-badge">{lv.line}</span> {p.code} · {p.cat}</div>
            <h2>{p.title}</h2>
            <p className="lede">{p.summary}</p>
          </div>
          <div className="modal-actions">
            {p.sim && <button className="btn primary" onClick={() => onTrySim(p.sim, p.title)}>Try in Simulator →</button>}
            <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>

        <div className="modal-body">
          <div className="modal-diagram">
            <div className="panel-label mono">LINE DIAGRAM · REQUEST JOURNEY</div>
            <FlowDiagram pattern={p} accent={lv.color} />
          </div>
          <div className="modal-text">
            <Section title="What it is"><p>{p.what}</p></Section>
            <Section title="Why it’s used"><p>{p.why}</p></Section>
            <Section title="Use it when">
              <ul>{p.useWhen.map((u) => <li key={u}>{u}</li>)}</ul>
            </Section>
            <div className="proscons">
              <Section title="Gains" tone="good"><ul>{p.pros.map((u) => <li key={u}>{u}</li>)}</ul></Section>
              <Section title="Costs" tone="bad"><ul>{p.cons.map((u) => <li key={u}>{u}</li>)}</ul></Section>
            </div>
            {p.glossary && <NeedLists term={p.glossary} />}
            <Section title="Seen in the wild"><p className="dim">{p.examples}</p></Section>
            <KeyTerms text={`${p.title} ${p.summary} ${p.what} ${p.why} ${p.useWhen.join(' ')} ${p.pros.join(' ')} ${p.cons.join(' ')}`} />
          </div>
        </div>

        <footer className="modal-foot">
          <button className="btn ghost" disabled={!prev} onClick={() => prev && onNav(prev.id)}>← {prev ? prev.title : 'Start of line'}</button>
          <span className="mono dim">← → to travel · Esc to close</span>
          <button className="btn ghost" disabled={!next} onClick={() => next && onNav(next.id)}>{next ? next.title : 'End of line'} →</button>
        </footer>
      </div>
    </div>
  );
}

function KeyTerms({ text }) {
  const { open } = useGlossary();
  const ids = termsIn(text);
  if (!ids.length) return null;
  return (
    <section className="msec">
      <h3 className="mono">Key terms explained</h3>
      <div className="chips">
        {ids.map((id) => (
          <button key={id} className="chip term-chip" onClick={() => open(id)}><span className="info static">i</span>{GLOSSARY[id].title}</button>
        ))}
      </div>
    </section>
  );
}

function Section({ title, children, tone }) {
  return (
    <section className={`msec ${tone || ''}`}>
      <h3 className="mono">{title}</h3>
      {children}
    </section>
  );
}
