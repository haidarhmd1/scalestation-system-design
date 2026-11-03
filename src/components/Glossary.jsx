import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { GLOSSARY, GLOSSARY_ORDER } from '../data/glossary.js';

const Ctx = createContext({ open: () => {} });
export const useGlossary = () => useContext(Ctx);

export function GlossaryProvider({ children }) {
  const [stack, setStack] = useState([]);
  const api = useMemo(() => ({
    open: (id) => setStack((s) => [...s, id]),
    openIndex: () => setStack(['__index']),
  }), []);
  return (
    <Ctx.Provider value={api}>
      {children}
      {stack.length > 0 && (
        <GlossaryModal
          id={stack[stack.length - 1]}
          canBack={stack.length > 1}
          onBack={() => setStack((s) => s.slice(0, -1))}
          onOpen={(id) => setStack((s) => [...s, id])}
          onClose={() => setStack([])}
        />
      )}
    </Ctx.Provider>
  );
}

// Small ⓘ button placed next to technical words.
export function Info({ term, label }) {
  const { open } = useGlossary();
  const g = GLOSSARY[term];
  if (!g) return null;
  return (
    <button
      type="button"
      className="info"
      aria-label={`What is ${label || g.title}?`}
      title={`What is ${g.title}?`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(term); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      i
    </button>
  );
}

// Text label followed by an info icon.
export function Term({ children, term }) {
  return <span className="term">{children}<Info term={term} label={typeof children === 'string' ? children : undefined} /></span>;
}

function GlossaryModal({ id, canBack, onBack, onOpen, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const [q, setQ] = useState('');
  const isIndex = id === '__index';
  const g = GLOSSARY[id];

  return (
    <div className="gl-back" onClick={onClose}>
      <div className="gl" role="dialog" aria-modal="true" aria-label={isIndex ? 'Glossary' : g.title} onClick={(e) => e.stopPropagation()}>
        <header className="gl-head">
          <div className="gl-nav">
            {canBack && <button className="btn ghost small" onClick={onBack}>← Back</button>}
            <span className="mono dim">GLOSSARY{isIndex ? '' : ' · EXPLANATION'}</span>
          </div>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {isIndex ? (
          <div className="gl-body">
            <h2>Glossary</h2>
            <p className="dim">{GLOSSARY_ORDER.length} terms, from CPU to circuit breakers. Each one explains where the word comes from, what it does, an everyday example and why it matters when scaling.</p>
            <input className="search" placeholder="Search terms…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <div className="gl-grid">
              {GLOSSARY_ORDER.filter((k) => `${GLOSSARY[k].title} ${GLOSSARY[k].aka}`.toLowerCase().includes(q.toLowerCase())).map((k) => (
                <button key={k} className="gl-item" onClick={() => onOpen(k)}>
                  <b>{GLOSSARY[k].title}</b>
                  <span className="dim">{GLOSSARY[k].what}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="gl-body">
            <h2>{g.title}</h2>
            <p className="gl-aka mono">{g.aka}</p>
            <Sec icon="📜" title="Where the word comes from">{g.origin}</Sec>
            <Sec icon="🔎" title="What it is">{g.what}</Sec>
            <Sec icon="⚙️" title="What it does">{g.does}</Sec>
            <Sec icon="🍽️" title="Beginner example" tone="ex">{g.example}</Sec>
            <Sec icon="📈" title="Why it matters & when to scale it" tone="why">{g.why}</Sec>
            <NeedLists term={id} />
            <div className="gl-related">
              <span className="mono dim">RELATED</span>
              {g.related.map((r) => GLOSSARY[r] && (
                <button key={r} className="chip" onClick={() => onOpen(r)}>{GLOSSARY[r].title}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// "When you DO / DO NOT need it" lists, for glossary terms that define them.
export function NeedLists({ term, compact }) {
  const g = GLOSSARY[term];
  if (!g?.need) return null;
  const name = g.title.toLowerCase();
  return (
    <div className={`need ${compact ? 'compact' : ''}`}>
      <section className="need-col yes">
        <h3 className="mono">✅ When you DO need a {name}</h3>
        <ul>{g.need.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>
      <section className="need-col no">
        <h3 className="mono">🚫 When you DO NOT need a {name}</h3>
        <ul>{g.noNeed.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>
    </div>
  );
}

function Sec({ icon, title, children, tone }) {
  return (
    <section className={`gl-sec ${tone || ''}`}>
      <h3 className="mono"><span aria-hidden="true">{icon}</span> {title}</h3>
      <p>{children}</p>
    </section>
  );
}
