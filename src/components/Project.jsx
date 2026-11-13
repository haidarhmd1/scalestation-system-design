// Studio mode only: the user's own project, as scanned by `scalestation init`,
// plus a live k6 load test and calibration of the simulator.
import { useEffect, useMemo, useState } from 'react';
import { api, isLocal, layoutOf } from '../studio.js';
import { Segmented, Sparkline } from './ui.jsx';
import { Info } from './Glossary.jsx';

const HIST = 240;
const fmtN = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
const fmtMs = (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
const fmtPct = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
const KIND_ORDER = ['proxy', 'gateway', 'app', 'worker', 'cache', 'db', 'pooler', 'queue', 'monitoring', 'other'];
const BASIS = {
  cpu: 'from CPU time per request, read from /metrics during the test.',
  knee: 'from the throughput where latency or errors crossed your limits, spread over the servers and vCPUs in the layout.',
  'lower-bound': 'from the highest throughput reached. The app never hit its limit, so the real capacity is higher. Run "Find the limit" for a better number.',
};

export default function Project({ project, setProject, onOpenSim }) {
  const p = project;
  const [target, setTarget] = useState(p.targets[0] || '');
  const [profile, setProfile] = useState(p.load?.profile || 'standard');
  const [running, setRunning] = useState(p.running);
  const [ticks, setTicks] = useState(p.liveTicks || []);
  const [summary, setSummary] = useState(p.lastSummary);
  const [logs, setLogs] = useState(p.logs || []);
  const [err, setErr] = useState(null);
  const [calibState, setCalibState] = useState(null);

  useEffect(() => api.events({
    tick: (t) => setTicks((x) => [...x, t].slice(-HIST)),
    log: (l) => setLogs((x) => [...x, l].slice(-60)),
    done: (s) => { setSummary(s); setRunning(false); },
    state: (s) => setRunning(s.running),
  }), []);

  const start = async () => {
    setErr(null);
    try {
      setTicks([]);
      setSummary(null);
      await api.run(target, profile);
      setRunning(true);
    } catch (e) { setErr(e.message); }
  };
  const stop = () => api.stop().catch((e) => setErr(e.message));

  const applyCalibration = async (c, open) => {
    setCalibState('saving');
    try {
      await api.saveCalibration(c);
      const next = { ...p, calibration: c };
      setProject(next);
      setCalibState(c ? 'ok' : null);
      if (open) onOpenSim(layoutOf(next), c ? `${p.name} (calibrated)` : p.name);
    } catch (e) { setErr(e.message); setCalibState(null); }
  };

  const last = ticks[ticks.length - 1];
  const services = useMemo(() => [...p.services].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)), [p.services]);
  const epResult = (e) => summary?.endpoints.find((x) => x.name === `${e.method} ${e.path}`) || (last && { live: true, ...last.endpoints?.[`${e.method} ${e.path}`] });
  const prof = p.profiles[profile];
  const k6ok = p.k6.mode !== 'none';

  return (
    <div className="net-page project-page">
      <section className="hero">
        <div>
          <div className="eyebrow mono">YOUR PROJECT · {p.configFile}</div>
          <h1>{p.name}</h1>
          <p className="lede">Your system as <span className="mono">scalestation init</span> found it. Load-test the running app with k6, see where it breaks, then calibrate the simulator with your own numbers and try what-ifs on the map.</p>
          <div className="hero-ctas">
            <button className="btn primary" onClick={() => onOpenSim(layoutOf(p), p.name)}>Open my system in the Simulator →</button>
            <a className="btn ghost" href="#run">Run a load test</a>
          </div>
        </div>
        <div className="proj-status">
          <div className="mono dim small">K6</div>
          <div className={k6ok ? 'good-text' : 'bad-text'}>{k6ok ? p.k6.detail : 'not found'}</div>
          {!k6ok && <div className="dim small">{p.k6.detail}</div>}
          <div className="mono dim small" style={{ marginTop: 10 }}>SIMULATOR NUMBERS</div>
          <div>{p.calibration ? <span className="good-text">Calibrated · {fmtN(p.calibration.perCoreRps)} req/s per core</span> : <span className="dim">Textbook (not calibrated yet)</span>}</div>
        </div>
      </section>

      <section className="proj-sec">
        <div className="panel-label mono">WHAT WE FOUND <span className="dim">· edit {p.configFile} if something is wrong</span></div>
        <div className="proj-services">
          {services.map((s) => (
            <div key={`${s.kind}-${s.name}`} className={`proj-svc k-${s.kind}`}>
              <span className="mono dim small">{s.label}</span>
              <b>{s.tech}{s.replicas > 1 && <span className="dim"> ×{s.replicas}</span>}</b>
              <span className="dim small">{s.name}{s.cpus ? ` · ${s.cpus} vCPU` : ''}{s.memoryGb ? ` · ${s.memoryGb >= 1 ? `${s.memoryGb} GB` : `${Math.round(s.memoryGb * 1024)} MB`}` : ''}</span>
              <span className="mono dim tiny">{s.note || s.source}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="proj-sec" id="run">
        <div className="panel-label mono">LOAD TEST <span className="dim">· k6 → your app</span></div>
        <div className="panel proj-run">
          <div className="proj-controls">
            <label className="field">
              <span className="field-label">Target</span>
              <select className="select" value={target} onChange={(e) => setTarget(e.target.value)} disabled={running}>
                {p.targets.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="field-hint">Only targets listed in {p.configFile}.</span>
            </label>
            <div>
              <Segmented label="Profile" value={profile} onChange={(v) => !running && setProfile(v)}
                options={Object.entries(p.profiles).map(([id, x]) => ({ value: id, label: x.label }))} />
              <span className="field-hint">{prof?.desc}</span>
            </div>
            <div className="proj-go">
              {running
                ? <button className="btn danger" onClick={stop}>■ Stop</button>
                : <button className="btn primary" onClick={start} disabled={!k6ok || !target}>▶ Run test</button>}
            </div>
          </div>
          {target && !isLocal(target) && (
            <p className="proj-warn small"><b>Not a local address.</b> Make sure this is a staging server you are allowed to load-test. Never run this against production.</p>
          )}
          {err && <p className="proj-warn small">{err}</p>}

          <div className="kpis proj-kpis">
            <Kpi label="Virtual users" value={last ? last.vus : '–'} />
            <Kpi label="req/s" info="rps" value={last ? fmtN(last.rps) : '–'} />
            <Kpi label="p95" info="p95" value={last ? fmtMs(last.p95) : '–'} tone={last && (last.p95 > 1000 ? 'bad' : last.p95 > 300 ? 'warn' : 'good')} />
            <Kpi label="Errors" info="errorrate" value={last ? fmtPct(last.errRate) : '–'} tone={last && (last.errRate > 0.05 ? 'bad' : last.errRate > 0.01 ? 'warn' : 'good')} />
            <Kpi label="CPU" value={last && Number.isFinite(last.cpuCores) ? `${last.cpuCores.toFixed(2)} cores` : '–'} />
            <Kpi label="Heap" value={last && Number.isFinite(last.heapMb) ? `${Math.round(last.heapMb)} MB` : '–'} />
            {running && <span className="proj-live mono"><i /> LIVE · t+{last ? last.t : 0}s</span>}
          </div>
          <div className="charts">
            <Sparkline info="rps" label="THROUGHPUT req/s" value={last ? fmtN(last.rps) : '–'} unit="" series={[{ name: 'req/s', color: '#3ddc84', fill: true, data: ticks.map((t) => t.rps) }, { name: 'virtual users', color: '#5c6a7a', data: ticks.map((t) => t.vus) }]} />
            <Sparkline info="p95" label="p95 LATENCY" value={last ? fmtMs(last.p95) : '–'} unit="" series={[{ name: 'p95', color: '#ffb020', fill: true, data: ticks.map((t) => t.p95) }]} />
            <Sparkline info="errorrate" label="ERROR RATE" value={last ? fmtPct(last.errRate) : '–'} unit="" max={Math.max(0.05, ...ticks.map((t) => t.errRate)) * 1.1} series={[{ name: 'errors', color: '#ff4d4f', fill: true, data: ticks.map((t) => t.errRate) }]} />
            <Sparkline label="CPU cores · /metrics" value={last && Number.isFinite(last.cpuCores) ? last.cpuCores.toFixed(2) : '–'} unit="" series={[{ name: 'cpu', color: '#4da3ff', fill: true, data: ticks.map((t) => t.cpuCores ?? 0) }]} />
          </div>
          {!ticks.length && !running && <p className="dim small center">Start your app, pick a target and press ▶ Run test. Results appear here every second.</p>}
          {logs.length > 0 && (
            <details className="proj-log">
              <summary className="mono dim small">LOG · {logs.length} lines</summary>
              <ul>{logs.slice().reverse().map((l, i) => <li key={i} className="mono small"><span className="dim">{new Date(l.at).toLocaleTimeString()}</span> {l.msg}</li>)}</ul>
            </details>
          )}
        </div>
      </section>

      <section className="proj-sec">
        <div className="panel-label mono">ENDPOINTS <span className="dim">· {p.endpoints.length} in load/scalestation.k6.js</span></div>
        <div className="panel proj-table-wrap">
          <table className="proj-table">
            <thead><tr><th>Endpoint</th><th>Weight</th><th>Requests</th><th>p50</th><th>p95</th><th>Errors</th><th>Found in</th></tr></thead>
            <tbody>
              {p.endpoints.map((e) => {
                const r = epResult(e);
                return (
                  <tr key={`${e.method} ${e.path}`}>
                    <td className="mono"><span className={`meth m-${e.method.toLowerCase()}`}>{e.method}</span> {e.path}</td>
                    <td className="mono dim">{e.weight}</td>
                    <td className="mono">{r?.count != null ? fmtN(r.count) : r?.n != null ? `${r.n}/s` : '–'}</td>
                    <td className="mono">{fmtMs(r?.p50)}</td>
                    <td className={`mono ${r?.p95 > 300 ? 'warn-text' : ''}`}>{fmtMs(r?.p95)}</td>
                    <td className={`mono ${(r?.errRate ?? r?.err) > 0.01 ? 'bad-text' : ''}`}>{r ? fmtPct(r.errRate ?? r.err ?? 0) : '–'}</td>
                    <td className="mono dim small">{e.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {summary && (
        <section className="proj-sec">
          <div className="panel-label mono">RESULT · {summary.requests.toLocaleString()} REQUESTS · {summary.durationS}s · {p.profiles[summary.profile]?.label?.toUpperCase()}</div>
          <div className="proj-result">
            <div className="panel">
              <div className="kpis">
                <Kpi label="p50" value={fmtMs(summary.p50)} />
                <Kpi label="p95" value={fmtMs(summary.p95)} tone={summary.p95 > 300 ? 'warn' : 'good'} />
                <Kpi label="p99" value={fmtMs(summary.p99)} />
                <Kpi label="Errors" value={fmtPct(summary.errRate)} tone={summary.errRate > 0.01 ? 'bad' : 'good'} />
                <Kpi label="Peak" value={`${fmtN(summary.peakRps)} req/s`} />
              </div>
              <ul className="adv-list">
                {summary.findings.map((f, i) => (
                  <li key={i} className={`adv sev-${f.severity}`}>
                    <div>
                      <div className="adv-title"><span className="adv-sev mono">{f.severity}</span>{f.title}</div>
                      <div className="adv-detail">{f.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel proj-calib">
              <div className="panel-label mono">CALIBRATE THE SIMULATOR</div>
              {summary.calibration ? (
                <>
                  <p className="small">The simulator normally assumes <b className="mono">120 req/s</b> per core and <b className="mono">18 ms</b> per request. Your app measured:</p>
                  <div className="proj-calib-nums">
                    <div><b className="mono">{fmtN(summary.calibration.perCoreRps)}</b><span className="dim small">req/s per core</span></div>
                    <div><b className="mono">{fmtMs(summary.calibration.appMs)}</b><span className="dim small">per request (quiet)</span></div>
                  </div>
                  <p className="dim small">Throughput {BASIS[summary.calibration.basis]} The time per request includes your database and other calls, so treat the map’s latency as a rough guide.</p>
                  <button className="btn primary full" onClick={() => applyCalibration(summary.calibration, true)} disabled={calibState === 'saving'}>
                    {calibState === 'saving' ? 'Saving…' : 'Calibrate and open in the Simulator →'}
                  </button>
                  {p.calibration && <button className="btn ghost small full" onClick={() => applyCalibration(null, false)}>Back to textbook numbers</button>}
                  {calibState === 'ok' && <p className="small good-text">Saved to {p.configFile}.</p>}
                </>
              ) : <p className="dim small">Not enough data to calibrate. Run a longer test.</p>}
            </div>
          </div>
        </section>
      )}

      <section className="proj-sec">
        <div className="panel-label mono">NEXT STEPS</div>
        <ul className="proj-next dim">
          <li><b>In CI:</b> <span className="mono">npx scalestation run --ci --fail-if "p95&gt;300ms"</span> fails the pipeline when a change makes the app slower.</li>
          <li><b>Not seeing CPU or memory?</b> Add a Prometheus <span className="mono">/metrics</span> endpoint and list it under <span className="mono">metrics:</span> in {p.configFile}.</li>
          <li><b>Realistic traffic:</b> edit <span className="mono">load/scalestation.k6.js</span>: request bodies, auth headers, the mix of endpoints (weights).</li>
        </ul>
      </section>
    </div>
  );
}

function Kpi({ label, value, tone, info }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <span className="kpi-l mono">{label}{info && <Info term={info} label={label} />}</span>
      <span className="kpi-v mono">{value}</span>
    </div>
  );
}
