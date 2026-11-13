import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import CodeBlock from './CodeBlock.jsx';
import { STUDIO } from '../studio.js';

// Flip to true once the scalestation CLI is published on npm.
export const CLI_PUBLISHED = false;

const STEPS = [
  {
    title: '0 · Try it on a demo first (optional)',
    text: 'A small but real shop (Express + Postgres) that starts with one server and one database. Load-test it, break it on the map, then follow the “How to add this” guides to grow it for real: a cache, a message queue, more servers, read replicas, sharding and more.',
    blocks: [
      { terminal: true, title: 'terminal', code: 'npx scalestation demo my-shop\ncd my-shop\ndocker compose up --build -d\nnpx scalestation' },
    ],
  },
  {
    title: '1 · Add it to your project',
    text: 'A dev dependency, like Prisma Studio or Storybook. Not a Node.js project (Python, Go, Java…)? Use npx: it needs only Node.js installed and adds nothing to your repo.',
    blocks: [
      { terminal: true, title: 'terminal', code: 'npm install -D scalestation\n# or, without installing:\nnpx scalestation --help' },
      { title: 'package.json', code: '{\n  "scripts": {\n    "scale": "scalestation",\n    "scale:init": "scalestation init",\n    "scale:test": "scalestation run"\n  }\n}' },
    ],
  },
  {
    title: '2 · Let it find your system',
    text: 'init reads what is already in your repo: docker-compose services (Postgres, Redis, NGINX, RabbitMQ…), replicas and CPU/RAM limits, dependencies in package.json, requirements.txt or go.mod, and your routes (OpenAPI, Express, Fastify, FastAPI, Flask, Go). It writes two files you can edit and commit.',
    blocks: [
      { terminal: true, title: 'terminal', code: 'npm run scale:init\n# → scalestation.config.yaml   your map: services, endpoints, targets\n# → load/scalestation.k6.js    a k6 load test for the endpoints it found' },
    ],
  },
  {
    title: '3 · Open your system in the simulator',
    text: 'Starts a local site (only on 127.0.0.1) with your own system on the map. From there you run the k6 test against your app, watch req/s, p95 and errors per endpoint live, and see where it breaks. One click calibrates the simulator with your measured numbers, so the what-ifs (more servers, a cache, a replica) describe your app, not a textbook one. Every change you make on the map gets a “How to add this” guide for your stack: compose file, package, code, and how to check it helped.',
    blocks: [
      { terminal: true, title: 'terminal', code: 'npm run scale\n# opens http://localhost:5190' },
    ],
  },
  {
    title: '4 · Keep it in CI (optional)',
    text: 'The same test without the UI. The pipeline fails when a change makes the app slower.',
    blocks: [
      { terminal: true, title: 'terminal', code: 'npx scalestation run --ci --fail-if "p95>300ms" --fail-if "errors>1%"' },
    ],
  },
];

function HowModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal own-modal" role="dialog" aria-modal="true" aria-label="Simulate your own project" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="eyebrow mono">ON YOUR OWN PROJECT · SCALESTATION CLI</div>
            <h2>Simulate the system you already have</h2>
            <p className="lede">No need to rebuild anything. Point the simulator at your existing repo, load-test your running app with k6, and see which part breaks first.</p>
          </div>
          <div className="modal-actions"><button className="btn ghost small" onClick={onClose} aria-label="Close">✕</button></div>
        </header>
        <div className="own-body">
          {!CLI_PUBLISHED && (
            <p className="own-status small"><b>Not on npm yet.</b> The commands below are how it will work once it is published. Until then they work from a local checkout of the CLI with <span className="mono">npm link</span>.</p>
          )}
          {STEPS.map((s) => (
            <section key={s.title} className="own-step">
              <h3>{s.title}</h3>
              <p className="dim">{s.text}</p>
              {s.blocks.map((b, i) => <CodeBlock key={i} {...b} />)}
            </section>
          ))}
          <section className="own-step">
            <h3>Good to know</h3>
            <ul className="own-notes dim">
              <li><b>Test staging or your laptop, not production.</b> The CLI only sends load to the targets listed in your config file.</li>
              <li><b>k6 sees your app from the outside</b> (req/s, latency, errors per endpoint). Add a <span className="mono">/metrics</span> endpoint (station 8 of the core line) and it also shows CPU per request, event-loop lag and memory growth while the test runs.</li>
              <li><b>k6 itself:</b> the CLI uses your installed k6, or the <span className="mono">grafana/k6</span> Docker image if you don’t have it.</li>
              <li><b>Load generator and app on one laptop</b> compete for the same CPU. Numbers are a lower bound; a staging server gives cleaner ones.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

// Small card: "you can do this on your own project".
export function OwnProjectHint({ compact = false }) {
  const [open, setOpen] = useState(false);
  if (STUDIO) return null; // already running on their project
  return (
    <>
      <div className={`own-hint ${compact ? 'compact' : ''}`}>
        <div className="own-hint-text">
          <span className="own-hint-tag mono">YOUR OWN PROJECT</span>
          <b>{compact ? 'Simulate the system you already have' : 'Already have a system? Simulate it instead of rebuilding it.'}</b>
          <span className="dim small">
            {compact
              ? 'One npm script draws your repo on this map and load-tests it with k6.'
              : 'One npm script scans your repo, draws your system on the simulator map, load-tests it with k6 and shows which part breaks first.'}
          </span>
        </div>
        <button className={`btn small ${compact ? 'full' : ''}`} onClick={() => setOpen(true)}>Show me how →</button>
      </div>
      {open && createPortal(<HowModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
