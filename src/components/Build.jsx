import { useEffect, useMemo, useState } from 'react';
import { LANGS, STEPS } from '../data/journey.js';
import { GLOSSARY } from '../data/glossary.js';
import { PATTERNS } from '../data/patterns.js';
import { Info, useGlossary } from './Glossary.jsx';

const STORE_KEY = 'scalestation.build';

function loadProgress() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && typeof s === 'object') return { lang: s.lang || null, current: s.current || STEPS[0].id, done: s.done || {} };
  } catch { /* storage unavailable */ }
  return { lang: null, current: STEPS[0].id, done: {} };
}

export default function Build({ onTrySim, onOpenPattern }) {
  const [state, setState] = useState(loadProgress);
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }, [state]);

  const lang = state.lang;
  const idx = Math.max(0, STEPS.findIndex((s) => s.id === state.current));
  const step = STEPS[idx];
  const isDone = (s) => (state.done[s.id] || []).length >= s.tasks.length;
  const doneCount = STEPS.filter(isDone).length;

  const go = (id) => {
    setState((s) => ({ ...s, current: id }));
    document.querySelector('.build-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const toggleTask = (i) => setState((s) => {
    const cur = new Set(s.done[step.id] || []);
    if (cur.has(i)) cur.delete(i); else cur.add(i);
    return { ...s, done: { ...s.done, [step.id]: [...cur].sort((a, b) => a - b) } };
  });
  const setLang = (l) => setState((s) => ({ ...s, lang: l }));
  const reset = () => {
    if (window.confirm('Reset your progress on every station? Your chosen language stays.')) {
      setState((s) => ({ ...s, current: STEPS[0].id, done: {} }));
    }
  };

  return (
    <div className="build-page">
      <section className="hero build-hero">
        <div>
          <div className="eyebrow mono">BUILD YOUR OWN · {STEPS.length} STATIONS · ON YOUR OWN MACHINE</div>
          <h1>Build and grow your own system, step by step.</h1>
          <p className="lede">Write a real backend in the language you choose, run it with Docker, and grow it from one server to a load-balanced, cached, queue-backed system. Every station ends with commands that <b>prove</b> it works, and with what breaks next.</p>
        </div>
        <div className="build-progress">
          <div className="mono dim small">YOUR PROGRESS</div>
          <div className="build-progress-num mono">{doneCount}<span className="dim"> / {STEPS.length}</span></div>
          <div className="build-bar"><i style={{ width: `${(doneCount / STEPS.length) * 100}%` }} /></div>
          <button className="btn ghost small" onClick={reset}>Reset progress</button>
        </div>
      </section>

      <section className="lang-pick">
        <div className="panel-label mono">1 · CHOOSE YOUR LANGUAGE <span className="dim">(you can switch any time)</span></div>
        <div className="lang-cards">
          {LANGS.map((l) => (
            <button key={l.id} className={`lang-card ${lang === l.id ? 'on' : ''}`} onClick={() => setLang(l.id)} aria-pressed={lang === l.id}>
              <span className="lang-name">{l.label}</span>
              <span className="lang-sub mono">{l.sub}</span>
            </button>
          ))}
        </div>
        <p className="dim small lang-note">You also need <b>Docker</b> (from station 2) and <b>k6</b> for load tests. Prefer another language? The HTTP endpoints are the same in every version (<span className="mono">GET /products/:id</span>, <span className="mono">GET /visit/:user</span>, <span className="mono">POST /orders</span>), so you can follow along in any language and copy the Docker, NGINX and k6 files as they are.</p>
      </section>

      <SystemLine steps={STEPS} isDone={isDone} current={step.id} onGo={go} />

      <div className="build-grid">
        <nav className="build-route panel" aria-label="Stations">
          <div className="panel-label mono">2 · RIDE THE LINE</div>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button className={`route-stop ${s.id === step.id ? 'on' : ''} ${isDone(s) ? 'done' : ''}`} onClick={() => go(s.id)}>
                  <span className="route-dot">{isDone(s) ? '✓' : i + 1}</span>
                  <span className="route-text">
                    <span className="route-title">{s.title}</span>
                    <span className="route-sub mono">{(state.done[s.id] || []).length}/{s.tasks.length} tasks</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <main className="build-main">
          {!lang ? (
            <div className="panel build-empty">
              <h2>Pick a language to start</h2>
              <p className="dim">Choose Node.js, Python or Go above. All code and commands on every station switch to it.</p>
            </div>
          ) : (
            <Station step={step} index={idx} lang={lang} done={state.done[step.id] || []} onToggle={toggleTask}
              onPrev={idx > 0 ? () => go(STEPS[idx - 1].id) : null}
              onNext={idx < STEPS.length - 1 ? () => go(STEPS[idx + 1].id) : null}
              onTrySim={onTrySim} onOpenPattern={onOpenPattern} />
          )}
        </main>
      </div>
    </div>
  );
}

function SystemLine({ steps, isDone, current, onGo }) {
  return (
    <section className="sysline panel" aria-label="Your system so far">
      <div className="panel-label mono">YOUR SYSTEM SO FAR <Info term="horizontal" label="scaling" /></div>
      <div className="sysline-track">
        {steps.map((s, i) => (
          <button key={s.id} className={`sys-stop ${isDone(s) ? 'done' : ''} ${s.id === current ? 'on' : ''}`} onClick={() => onGo(s.id)} title={s.title}>
            <span className="sys-dot" />
            <span className="sys-label">{s.short}</span>
            <span className="sys-num mono">{i + 1}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Station({ step, index, lang, done, onToggle, onPrev, onNext, onTrySim, onOpenPattern }) {
  const { open } = useGlossary();
  const files = step.files.filter((f) => f.lang === 'any' || f.lang === lang);
  const runCmds = [...(step.run.any || []), ...(step.run[lang] || [])];
  const langLabel = LANGS.find((l) => l.id === lang)?.label;
  const allDone = done.length >= step.tasks.length;

  return (
    <article className="station-page">
      <header className="panel station-head">
        <div className="mono eyebrow">STATION {index + 1} OF {STEPS.length} · {langLabel}</div>
        <h2>{step.title}{allDone && <span className="station-done mono">✓ done</span>}</h2>
        <p className="lede">{step.goal}</p>
        <div className="why"><b>Why it matters:</b> {step.why}</div>
        <div className="station-links">
          <div>
            <span className="mono dim small">LEARN </span>
            {step.concepts.map((c) => GLOSSARY[c] && (
              <button key={c} className="chip term-chip" onClick={() => open(c)}><span className="info static">i</span>{GLOSSARY[c].title}</button>
            ))}
          </div>
          <div>
            <span className="mono dim small">PATTERNS </span>
            {step.patterns.map((p) => {
              const pat = PATTERNS.find((x) => x.id === p);
              return pat && <button key={p} className="chip" onClick={() => onOpenPattern(p)}>{pat.title} ↗</button>;
            })}
          </div>
          {step.sim && <button className="btn primary small" onClick={() => onTrySim(step.sim, `Build station ${index + 1}: ${step.title}`)}>Try this stage in the Simulator →</button>}
        </div>
      </header>

      <section className="panel">
        <div className="panel-label mono">CHECKLIST</div>
        <ul className="tasks">
          {step.tasks.map((t, i) => (
            <li key={i}>
              <label className={done.includes(i) ? 'checked' : ''}>
                <input type="checkbox" checked={done.includes(i)} onChange={() => onToggle(i)} />
                <span>{t}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {files.length > 0 && (
        <section className="panel">
          <div className="panel-label mono">FILES · inside your my-system/ folder</div>
          {files.map((f, i) => <CodeBlock key={f.path + i} title={f.path} note={f.note} code={f.code} tone={f.tag === 'bug' ? 'bug' : ''} />)}
        </section>
      )}

      {runCmds.length > 0 && (
        <section className="panel">
          <div className="panel-label mono">RUN IT · in a terminal</div>
          <CodeBlock title="terminal" code={runCmds.join('\n')} terminal />
        </section>
      )}

      {step.verify.length > 0 && (
        <section className="panel">
          <div className="panel-label mono">PROVE IT WORKS</div>
          <CodeBlock title="terminal" code={step.verify.join('\n')} terminal />
          <p className="expect"><b>What you should see:</b> {step.expect}</p>
        </section>
      )}
      {step.verify.length === 0 && <section className="panel"><p className="expect"><b>The loop:</b> {step.expect}</p></section>}

      {step.breaks && (
        <section className="breaks">
          <span className="mono">WHAT BREAKS NEXT</span>
          <p>{step.breaks}</p>
        </section>
      )}

      <footer className="station-nav">
        <button className="btn ghost" disabled={!onPrev} onClick={onPrev || undefined}>← Previous station</button>
        <button className="btn primary" disabled={!onNext} onClick={onNext || undefined}>{onNext ? 'Next station →' : 'End of the line 🎉'}</button>
      </footer>
    </article>
  );
}

function CodeBlock({ title, note, code, terminal, tone }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code]);
  const copy = async () => {
    const text = terminal ? lines.filter((l) => !l.trim().startsWith('#')).map((l) => l.replace(/\s+#.*$/, '')).join('\n') : code;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: user can still select the text */ }
  };
  return (
    <div className={`code ${terminal ? 'terminal' : ''} ${tone || ''}`}>
      <div className="code-head">
        <span className="code-title mono">{terminal ? '$ ' : ''}{title}</span>
        {note && <span className="code-note">{note}</span>}
        <button className="btn ghost small code-copy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
      <pre><code>{terminal ? lines.map((l, i) => <span key={i} className={l.trim().startsWith('#') ? 'cmt' : ''}>{l.trim().startsWith('#') ? l : `$ ${l}`}{'\n'}</span>) : code}</code></pre>
    </div>
  );
}
