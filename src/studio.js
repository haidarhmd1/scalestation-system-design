// Studio mode: the same app, built with `vite build --mode studio` and served
// by the scalestation CLI from a user's own project. It talks to the CLI's
// local API; the public site never does.
export const STUDIO = import.meta.env.MODE === 'studio';

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  project: () => call('GET', '/api/project'),
  saveLayout: (cfg) => call('PUT', '/api/layout', cfg),
  saveCalibration: (calibration) => call('PUT', '/api/calibration', { calibration }),
  run: (target, profile) => call('POST', '/api/run', { target, profile }),
  stop: () => call('POST', '/api/stop'),
  // Live updates: tick (one per second), log, done, state.
  events(handlers) {
    const es = new EventSource('/api/events');
    for (const [name, fn] of Object.entries(handlers)) es.addEventListener(name, (e) => fn(JSON.parse(e.data)));
    return () => es.close();
  },
};

// The simulator layout from the config, with measured numbers when there are some.
export const layoutOf = (p) => ({ ...p.simulator, calib: p.calibration || null });

export const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.(localhost|test))(:\d+)?(\/|$)/.test(url);
