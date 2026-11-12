import { useEffect, useMemo, useState } from 'react';
import { IAC_TOOLS, LANGS, STEPS, forLang, iacText } from '../data/journey.js';
import { ADV_STEPS } from '../data/advanced.js';
import { GLOSSARY } from '../data/glossary.js';
import { PATTERNS } from '../data/patterns.js';
import { Info, useGlossary } from './Glossary.jsx';
import { highlight, highlightCommand, langForPath } from './highlight.js';

const STORE_KEY = 'scalestation.build';

function loadProgress() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && typeof s === 'object') {
      const lang = s.lang === 'node' ? 'express' : s.lang; // older saves used plain "node"
      return {
        lang: LANGS.some((l) => l.id === lang) ? lang : null,
        current: STEPS.some((x) => x.id === s.current) ? s.current : STEPS[0].id,
        advCurrent: ADV_STEPS.some((x) => x.id === s.advCurrent) ? s.advCurrent : ADV_STEPS[0].id,
        track: s.track === 'advanced' ? 'advanced' : 'core',
        done: s.done || {},
        iac: s.iac || 'terraform',
      };
    }
  } catch { /* storage unavailable */ }
  return { lang: null, current: STEPS[0].id, advCurrent: ADV_STEPS[0].id, track: 'core', done: {}, iac: 'terraform' };
}

// The two lines of the Build track: the core system, then running it for real.
const TRACKS = {
  core: { list: STEPS, key: 'current', label: 'Core line', sub: 'build and grow the system', prefix: 'STATION ', num: (i) => i + 1 },
  advanced: { list: ADV_STEPS, key: 'advCurrent', label: 'Advanced line', sub: 'test, measure, harden and deploy it', prefix: 'ADVANCED A', num: (i) => `A${i + 1}` },
};

export default function Build({ onTrySim, onOpenPattern, openRequest, onCapacity }) {
  const [state, setState] = useState(loadProgress);
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }, [state]);

  // Another page asked for a specific station (e.g. Capacity → "Advanced A2").
  useEffect(() => {
    if (!openRequest?.id) return;
    const track = ADV_STEPS.some((x) => x.id === openRequest.id) ? 'advanced' : 'core';
    setState((s) => ({ ...s, track, [TRACKS[track].key]: openRequest.id }));
    setTimeout(() => document.querySelector('.track-pick')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [openRequest]);

  const lang = state.lang;
  const T = TRACKS[state.track] || TRACKS.core;
  const LIST = T.list;
  const idx = Math.max(0, LIST.findIndex((s) => s.id === state[T.key]));
  const step = LIST[idx];
  const isDone = (s) => (state.done[s.id] || []).length >= s.tasks.length;
  const doneCount = LIST.filter(isDone).length;
  const setTrack = (track) => setState((s) => ({ ...s, track }));

  const go = (id) => {
    setState((s) => ({ ...s, [T.key]: id }));
    document.querySelector('.build-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const toggleTask = (i) => setState((s) => {
    const cur = new Set(s.done[step.id] || []);
    if (cur.has(i)) cur.delete(i); else cur.add(i);
    return { ...s, done: { ...s.done, [step.id]: [...cur].sort((a, b) => a - b) } };
  });
  const setLang = (l) => setState((s) => ({ ...s, lang: l }));
  const setIac = (t) => setState((s) => ({ ...s, iac: t }));
  const isNode = lang === 'express' || lang === 'fastify';
  const [lastNode, setLastNode] = useState(isNode ? lang : 'express');
  useEffect(() => { if (isNode) setLastNode(lang); }, [lang, isNode]);
  const reset = () => {
    if (window.confirm('Reset your progress on every station? Your chosen language stays.')) {
      setState((s) => ({ ...s, current: STEPS[0].id, advCurrent: ADV_STEPS[0].id, done: {} }));
    }
  };

  return (
    <div className="build-page">
      <section className="hero build-hero">
        <div>
          <div className="eyebrow mono">BUILD YOUR OWN · {STEPS.length} + {ADV_STEPS.length} STATIONS · ON YOUR OWN MACHINE</div>
          <h1>Build and grow your own system, step by step.</h1>
          <p className="lede">Write a real backend in the language you choose, run it with Docker, and grow it from one server to a load-balanced, cached, queue-backed system. Every station ends with commands that <b>prove</b> it works, and with what breaks next.</p>
        </div>
        <div className="build-progress">
          <div className="mono dim small">YOUR PROGRESS · {T.label.toUpperCase()}</div>
          <div className="build-progress-num mono">{doneCount}<span className="dim"> / {LIST.length}</span></div>
          <div className="build-bar"><i style={{ width: `${(doneCount / LIST.length) * 100}%` }} /></div>
          <button className="btn ghost small" onClick={reset}>Reset progress</button>
        </div>
      </section>

      <section className="lang-pick">
        <div className="panel-label mono">1 · CHOOSE YOUR LANGUAGE <span className="dim">(you can switch any time)</span></div>
        <div className="lang-cards">
          <div className={`lang-card ${isNode ? 'on' : ''}`} role="button" tabIndex={0} aria-pressed={isNode}
            onClick={() => !isNode && setLang(lastNode)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !isNode && setLang(lastNode)}>
            <span className="lang-name">Node.js</span>
            <span className="lang-sub mono">TypeScript · Node 22.18+</span>
            <div className="fw-pick" onClick={(e) => e.stopPropagation()}>
              {LANGS.filter((l) => l.group === 'node').map((l) => (
                <button key={l.id} className={lang === l.id ? 'on' : ''} onClick={() => setLang(l.id)} aria-pressed={lang === l.id}>{l.framework}</button>
              ))}
            </div>
          </div>
          {LANGS.filter((l) => !l.group).map((l) => (
            <button key={l.id} className={`lang-card ${lang === l.id ? 'on' : ''}`} onClick={() => setLang(l.id)} aria-pressed={lang === l.id}>
              <span className="lang-name">{l.label}</span>
              <span className="lang-sub mono">{l.sub}</span>
            </button>
          ))}
        </div>
        <p className="dim small lang-note">You also need <b>Docker</b> (from station 2) and <b>k6</b> for load tests. For Node.js, pick <b>Express</b> (the classic, most tutorials use it) or <b>Fastify</b> (faster, schema-first). Prefer another language? The HTTP endpoints are the same in every version (<span className="mono">GET /products/:id</span>, <span className="mono">GET /visit/:user</span>, <span className="mono">POST /orders</span>, <span className="mono">GET /metrics</span>), so you can follow along in any language and copy the Docker, NGINX, Grafana, Terraform and k6 files as they are.</p>
      </section>

      <section className="track-pick" aria-label="Choose a line">
        {Object.entries(TRACKS).map(([id, tr]) => {
          const n = tr.list.filter(isDone).length;
          return (
            <button key={id} className={`track-card ${state.track === id ? 'on' : ''}`} onClick={() => setTrack(id)} aria-pressed={state.track === id}>
              <span className="track-top"><b>{tr.label}</b><span className="mono dim">{n}/{tr.list.length} done</span></span>
              <span className="dim small">{tr.list.length} stations · {tr.sub}</span>
            </button>
          );
        })}
      </section>
      {state.track === 'advanced' && (
        <p className="dim small track-note">The advanced line starts from the finished core system: the Compose stack from station 9 (NGINX on :8080, 3 app replicas, worker, Postgres, Redis, Prometheus and Grafana) running in <span className="mono">my-system/</span>, plus k6. Stations can be done in any order.</p>
      )}

      <SystemLine steps={LIST} num={T.num} isDone={isDone} current={step.id} onGo={go} />

      <div className="build-grid">
        <nav className="build-route panel" aria-label="Stations">
          <div className="panel-label mono">2 · RIDE THE {T.label.toUpperCase()}</div>
          <ol>
            {LIST.map((s, i) => (
              <li key={s.id}>
                <button className={`route-stop ${s.id === step.id ? 'on' : ''} ${isDone(s) ? 'done' : ''}`} onClick={() => go(s.id)}>
                  <span className="route-dot">{isDone(s) ? '✓' : T.num(i)}</span>
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
            <Station step={step} index={idx} total={LIST.length} prefix={T.prefix} label={T.num(idx)} lang={lang} iac={state.iac} onIac={setIac} done={state.done[step.id] || []} onToggle={toggleTask}
              onPrev={idx > 0 ? () => go(LIST[idx - 1].id) : null}
              onNext={idx < LIST.length - 1 ? () => go(LIST[idx + 1].id) : null}
              onAdvanced={state.track === 'core' && idx === LIST.length - 1 ? () => { setTrack('advanced'); document.querySelector('.track-pick')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } : null}
              onCapacity={onCapacity}
              onTrySim={onTrySim} onOpenPattern={onOpenPattern} />
          )}
        </main>
      </div>
    </div>
  );
}

function SystemLine({ steps, num = (i) => i + 1, isDone, current, onGo }) {
  return (
    <section className="sysline panel" aria-label="Your system so far">
      <div className="panel-label mono">YOUR SYSTEM SO FAR <Info term="horizontal" label="scaling" /></div>
      <div className="sysline-track" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <button key={s.id} className={`sys-stop ${isDone(s) ? 'done' : ''} ${s.id === current ? 'on' : ''}`} onClick={() => onGo(s.id)} title={s.title}>
            <span className="sys-dot" />
            <span className="sys-label">{s.short}</span>
            <span className="sys-num mono">{num(i)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const CAPACITY_LINKS = new Set(['adv-measure', 'adv-deploy']);

function Station({ step, index, total, prefix, label, lang, iac, onIac, done, onToggle, onPrev, onNext, onAdvanced, onCapacity, onTrySim, onOpenPattern }) {
  const { open } = useGlossary();
  const t = (text) => iacText(text, iac);
  const files = step.files.filter((f) => forLang(f.lang, lang));
  // Command groups run in the order they are written; keep the ones for this language.
  const runCmds = Object.entries(step.run).filter(([k]) => k === 'after' || forLang(k, lang)).flatMap(([, v]) => v).map(t);
  const L = LANGS.find((l) => l.id === lang);
  const langLabel = L?.group === 'node' ? `Node.js · TypeScript · ${L.framework}` : `${L?.label} · ${L?.sub}`;
  const allDone = done.length >= step.tasks.length;
  const tool = IAC_TOOLS.find((x) => x.id === iac) || IAC_TOOLS[0];

  return (
    <article className="station-page">
      <header className="panel station-head">
        <div className="mono eyebrow">{prefix}{prefix.endsWith('A') ? index + 1 : label} OF {total} · {langLabel}</div>
        <h2>{step.title}{allDone && <span className="station-done mono">✓ done</span>}</h2>
        <p className="lede">{step.goal}</p>
        <div className="why"><b>Why it matters:</b> {step.why}</div>
        {step.iac && (
          <div className="iac-pick">
            <span className="mono dim small">CHOOSE YOUR TOOL</span>
            <div className="seg">
              {IAC_TOOLS.map((x) => <button key={x.id} className={iac === x.id ? 'on' : ''} onClick={() => onIac(x.id)}>{x.label}</button>)}
            </div>
            <p className="dim small">{tool.note} The files below work with both; only the command changes (<span className="mono">{tool.cmd}</span>).</p>
          </div>
        )}
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
          {step.sim && <button className="btn primary small" onClick={() => onTrySim(step.sim, `Build station ${label}: ${step.title}`)}>Try this stage in the Simulator →</button>}
          {onCapacity && CAPACITY_LINKS.has(step.id) && <button className="btn small" onClick={onCapacity}>Open the Capacity calculator →</button>}
        </div>
      </header>

      <section className="panel">
        <div className="panel-label mono">CHECKLIST</div>
        <ul className="tasks">
          {step.tasks.map((task, i) => (
            <li key={i}>
              <label className={done.includes(i) ? 'checked' : ''}>
                <input type="checkbox" checked={done.includes(i)} onChange={() => onToggle(i)} />
                <span>{t(task)}</span>
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
          <CodeBlock title="terminal" code={step.verify.map(t).join('\n')} terminal />
          <p className="expect"><b>What you should see:</b> {t(step.expect)}</p>
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
        {onNext || !onAdvanced
          ? <button className="btn primary" disabled={!onNext} onClick={onNext || undefined}>{onNext ? 'Next station →' : 'End of the line 🎉'}</button>
          : <button className="btn primary" onClick={onAdvanced}>Continue on the Advanced line →</button>}
      </footer>
    </article>
  );
}

function CodeBlock({ title, note, code, terminal, tone }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code]);
  // Highlighted HTML for files (Prism escapes the source, so this is safe).
  const lang = terminal ? 'bash' : langForPath(title);
  const html = useMemo(() => (terminal ? null : highlight(code, lang)), [code, lang, terminal]);
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
      {terminal ? (
        <pre className="language-bash"><code>{lines.map((l, i) => (l.trim().startsWith('#')
          ? <span key={i} className="cmt">{l}{'\n'}</span>
          : <span key={i}><span className="prompt">$ </span><span dangerouslySetInnerHTML={{ __html: highlightCommand(l) }} />{'\n'}</span>))}</code></pre>
      ) : html ? (
        <pre className={`language-${lang}`}><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
      ) : (
        <pre><code>{code}</code></pre>
      )}
    </div>
  );
}
