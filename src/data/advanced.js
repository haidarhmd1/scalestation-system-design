// Build Your Own · Advanced line. Picks up after the 12 core stations, with the
// full stack from station 9 running (docker compose: nginx :8080, 3 app
// replicas, worker, Postgres, Redis, Prometheus :9090, Grafana :3001).
// Same shape as STEPS in journey.js: files/run use the language tags
// 'any', 'ts' (Express + Fastify), 'python' and 'go'.

// ── Load testing ───────────────────────────────────────────────────────────
const K6_SUITE = `import http from 'k6/http';
import { check } from 'k6';

// One script, five kinds of test. Pick one with -e TEST=load (default: smoke).
// "arrival-rate" executors send a fixed number of requests per second, no
// matter how slow the server gets: that is how real users behave.
const BASE = __ENV.TARGET || 'http://localhost:8080';
const TEST = __ENV.TEST || 'smoke';

const SCENARIOS = {
  // A few requests: does it work at all?
  smoke: { executor: 'constant-vus', vus: 2, duration: '30s' },
  // Your expected peak, held for a few minutes.
  load: {
    executor: 'ramping-arrival-rate', startRate: 10, timeUnit: '1s',
    preAllocatedVUs: 50, maxVUs: 500,
    stages: [
      { target: 200, duration: '1m' },
      { target: 200, duration: '3m' },
      { target: 0, duration: '30s' },
    ],
  },
  // Beyond the peak, step by step, until something gives.
  stress: {
    executor: 'ramping-arrival-rate', startRate: 50, timeUnit: '1s',
    preAllocatedVUs: 100, maxVUs: 2000,
    stages: [
      { target: 200, duration: '1m' },
      { target: 500, duration: '2m' },
      { target: 1000, duration: '2m' },
      { target: 0, duration: '30s' },
    ],
  },
  // From quiet to 40x in ten seconds, and back.
  spike: {
    executor: 'ramping-arrival-rate', startRate: 20, timeUnit: '1s',
    preAllocatedVUs: 100, maxVUs: 2000,
    stages: [
      { target: 20, duration: '30s' },
      { target: 800, duration: '10s' },
      { target: 800, duration: '1m' },
      { target: 20, duration: '10s' },
      { target: 20, duration: '1m' },
    ],
  },
  // Normal load for a long time: finds memory leaks and slow drift.
  soak: {
    executor: 'constant-arrival-rate', rate: 100, timeUnit: '1s', duration: '30m',
    preAllocatedVUs: 50, maxVUs: 300,
  },
};

export const options = {
  scenarios: { [TEST]: SCENARIOS[TEST] },
  thresholds: {
    http_req_failed: ['rate<0.01'],                    // under 1% errors
    'http_req_duration{type:read}': ['p(95)<300'],     // reads: p95 under 300 ms
    'http_req_duration{type:write}': ['p(95)<500'],    // writes: p95 under 500 ms
  },
};

// Like a real shop: 90% product reads, 10% orders.
export default function () {
  const id = Math.floor(Math.random() * 10000) + 1;
  if (Math.random() < 0.9) {
    const res = http.get(BASE + '/products/' + id, { tags: { type: 'read' } });
    check(res, { 'read is 200': (r) => r.status === 200 });
  } else {
    const res = http.post(BASE + '/orders', JSON.stringify({ product_id: id, qty: 1 }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'write' },
    });
    check(res, { 'order is 202': (r) => r.status === 202 });
  }
}
`;

const K6_CONSTANT = `import http from 'k6/http';
import { check } from 'k6';

// A steady, known request rate: the basis for "CPU ms per request".
// Change it with -e RATE=100. Runs for 3 minutes.
const BASE = __ENV.TARGET || 'http://localhost:8080';
const RATE = Number(__ENV.RATE || 60);

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: '3m',
      preAllocatedVUs: 20, maxVUs: 400,
    },
  },
};

export default function () {
  const id = Math.floor(Math.random() * 10000) + 1;
  const res = http.get(BASE + '/products/' + id);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
`;

// PromQL via the Prometheus HTTP API, readable in a terminal.
const promQuery = (q) => `curl -s http://localhost:9090/api/v1/query --data-urlencode 'query=${q}' | python3 -m json.tool | grep -A2 '"value"'`;

// ── SLOs & alerts ──────────────────────────────────────────────────────────
const RULES_YML = `# Recording rules pre-compute the numbers; alerting rules decide when to wake someone.
# SLOs for this shop:
#   availability: 99.5% of requests succeed (error budget: 0.5%)
#   latency:      95% of requests finish in under 300 ms
groups:
  - name: slo-recordings
    rules:
      - record: job:http_requests:rate5m
        expr: sum(rate(http_request_duration_seconds_count[5m]))
      - record: job:http_error_ratio:rate5m
        expr: sum(rate(http_request_duration_seconds_count{status=~"5.."}[5m])) / sum(rate(http_request_duration_seconds_count[5m]))
      - record: job:http_error_ratio:rate1h
        expr: sum(rate(http_request_duration_seconds_count{status=~"5.."}[1h])) / sum(rate(http_request_duration_seconds_count[1h]))
      - record: job:http_latency_p95:5m
        expr: histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
      - record: instance:app_cpu_cores:rate5m
        expr: rate(process_cpu_seconds_total{job="app"}[5m])

  - name: slo-alerts
    rules:
      # Symptom: users get errors. Burning the budget 14.4x faster than allowed
      # would use 2% of a 30-day budget in one hour. Both windows must agree,
      # so a short blip doesn't page anyone.
      - alert: ErrorBudgetBurnFast
        expr: job:http_error_ratio:rate1h > (14.4 * 0.005) and job:http_error_ratio:rate5m > (14.4 * 0.005)
        labels:
          severity: page
        annotations:
          summary: "{{ $value | humanizePercentage }} of requests are failing"
          action: "Check the Grafana dashboard: which route, which server? Recent deploy?"

      # Symptom: users wait too long.
      - alert: LatencySLOBreached
        expr: job:http_latency_p95:5m > 0.3
        for: 5m
        labels:
          severity: page
        annotations:
          summary: "p95 latency is {{ $value | humanizeDuration }} (SLO: 300 ms)"

  - name: capacity
    rules:
      # Cause / early warning: a ticket, not a page.
      - alert: AppProcessSaturated
        expr: instance:app_cpu_cores:rate5m > 0.8
        for: 10m
        labels:
          severity: ticket
        annotations:
          summary: "{{ $labels.instance }} uses {{ $value | humanizePercentage }} of a CPU core"
          action: "Single-threaded runtimes (Node, Python workers) max out at 1 core: add replicas or profile."

      - alert: AppReplicaDown
        expr: up{job="app"} == 0
        for: 1m
        labels:
          severity: ticket
        annotations:
          summary: "{{ $labels.instance }} is not answering /metrics"
`;

const PROMETHEUS_WITH_RULES = `global:
  scrape_interval: 5s
  evaluation_interval: 15s     # how often rules are checked

rule_files:
  - /etc/prometheus/rules.yml

scrape_configs:
  - job_name: app
    dns_sd_configs:
      - names: ['app']
        type: A
        port: 3000
`;

const COMPOSE_PROM_RULES = `# In docker-compose.yml, give the prometheus service one more volume:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./observability/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./observability/rules.yml:/etc/prometheus/rules.yml:ro     # ← new
`;

// ── Chaos ──────────────────────────────────────────────────────────────────
const CHAOS_MD = `# Game day log

Run each experiment while \`k6 run -e TEST=load loadtest/suite.js\` is running
and Grafana (http://localhost:3001) is open. Write down what you expected
BEFORE you start, then what really happened.

| # | Experiment | I expect | What happened | Fix / follow-up |
|---|------------|----------|---------------|-----------------|
| 1 | Kill one app replica | No errors: NGINX retries another replica | | |
| 2 | Pause Redis for 30 s | Slower, but reads still work from Postgres | | |
| 3 | Add 100 ms delay to Postgres | p95 rises by ~100 ms, no errors | | |
| 4 | Stop Postgres for 30 s | Reads from cache work, orders queue up, then drain | | |
| 5 | Kill the worker | Orders accepted (202), backlog grows, drains on restart | | |

Rules: one change at a time, have the "undo" command ready, stop if it
surprises you, and turn every surprise into a fix (timeout, retry, health
check, alert).
`;

// ── Profiling ──────────────────────────────────────────────────────────────
const COMPOSE_PROFILE_TS = `# docker-compose.profile.yml: used together with docker-compose.yml.
# Starts ONE app replica with the Node.js inspector open on port 9229,
# and Postgres with query statistics switched on.
services:
  app:
    command: ["node", "--inspect=0.0.0.0:9229", "server.ts"]
    ports:
      - "9229:9229"

  db:
    command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements", "-c", "track_io_timing=on"]
`;

const COMPOSE_PROFILE_ANY = `# docker-compose.profile.yml: used together with docker-compose.yml.
# Switches on query statistics in Postgres.
services:
  db:
    command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements", "-c", "track_io_timing=on"]
`;

const TOP_QUERIES_SQL = `-- The queries that used the most total time since statistics were reset.
SELECT calls,
       round(total_exec_time::numeric, 1) AS total_ms,
       round(mean_exec_time::numeric, 3)  AS avg_ms,
       left(query, 70)                    AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
`;

// ── CI ─────────────────────────────────────────────────────────────────────
const K6_CI = `import http from 'k6/http';
import { check } from 'k6';

// Short performance gate for every pull request. If a threshold fails,
// k6 exits with an error and the CI job fails.
// 15 req/s stays under the NGINX rate limit (20 req/s per IP).
const BASE = __ENV.TARGET || 'http://localhost:8080';

export const options = {
  scenarios: {
    ci: {
      executor: 'constant-arrival-rate', rate: 15, timeUnit: '1s', duration: '30s',
      preAllocatedVUs: 10, maxVUs: 50,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const id = Math.floor(Math.random() * 10000) + 1;
  const res = http.get(BASE + '/products/' + id);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
`;

const ciWorkflow = (checkSteps) => `name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
${checkSteps}
      - name: Start the whole stack
        run: docker compose up -d --build --scale app=3

      - name: Wait until it answers through NGINX
        run: |
          for i in $(seq 1 60); do
            curl -sf http://localhost:8080/health && exit 0
            sleep 2
          done
          echo "The app never became healthy"; exit 1

      - name: Performance gate (fails the build on slow or failing requests)
        run: docker run --rm -i --network host -e TARGET=http://localhost:8080 grafana/k6 run - < loadtest/ci.js

      - name: Logs if something failed
        if: failure()
        run: docker compose logs --tail=200

      - name: Stop everything
        if: always()
        run: docker compose down -v
`;

const CI_TS = ciWorkflow(`      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Type-check
        working-directory: app
        run: |
          npm ci
          npm run typecheck
`);

const CI_PY = ciWorkflow(`      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Check the code compiles and lint it
        run: |
          python -m compileall -q app
          pip install ruff
          ruff check app --select E9,F63,F7,F82   # real errors only, no style nits
`);

const CI_GO = ciWorkflow(`      - uses: actions/setup-go@v5
        with:
          go-version: stable

      - name: Vet and build
        working-directory: app
        run: |
          go vet ./...
          go build ./...
`);

// ── Backups ────────────────────────────────────────────────────────────────
const BACKUP_SH = `#!/usr/bin/env sh
# Nightly backup of the shop database, keeping the last 7 days.
# Schedule it with cron, e.g.:  15 3 * * *  cd /path/to/my-system && ./scripts/backup.sh
set -eu

mkdir -p backups
file="backups/shop-$(date +%Y-%m-%d-%H%M).dump"

# -Fc = custom format: compressed, and pg_restore can restore single tables.
docker compose exec -T db pg_dump -U postgres -Fc shop > "$file"
echo "wrote $file ($(du -h "$file" | cut -f1))"

# Delete backups older than 7 days.
find backups -name 'shop-*.dump' -mtime +7 -delete

# A copy on the same machine is not a backup. Also upload it somewhere else, e.g.:
#   aws s3 cp "$file" s3://my-backups/shop/
#   rclone copy "$file" remote:my-backups/shop/
`;

const RESTORE_SH = `#!/usr/bin/env sh
# Restore drill: restore the newest backup into a brand-new Postgres
# container and compare row counts with production. Nothing in the
# running stack is touched.
set -eu

latest=$(ls -t backups/shop-*.dump | head -n1)
echo "restoring $latest"

docker rm -f restore-drill >/dev/null 2>&1 || true
docker run -d --name restore-drill -e POSTGRES_PASSWORD=drill postgres:16 >/dev/null

# Wait until the new server accepts queries (initial setup restarts it once).
until docker exec restore-drill psql -U postgres -c 'select 1' >/dev/null 2>&1; do sleep 1; done
sleep 3
until docker exec restore-drill psql -U postgres -c 'select 1' >/dev/null 2>&1; do sleep 1; done

start=$(date +%s)
docker exec restore-drill createdb -U postgres shop
docker exec -i restore-drill pg_restore -U postgres -d shop --no-owner < "$latest"
echo "restore took $(( $(date +%s) - start )) s   ← your RTO for this data size"

echo "production:"
docker compose exec -T db psql -U postgres -d shop -tAc "select 'products', count(*) from products union all select 'orders', count(*) from orders"
echo "restored copy:"
docker exec restore-drill psql -U postgres -d shop -tAc "select 'products', count(*) from products union all select 'orders', count(*) from orders"

docker rm -f restore-drill >/dev/null
`;

// ── Deploy ─────────────────────────────────────────────────────────────────
const COMPOSE_PROD = `# docker-compose.prod.yml: production changes on top of docker-compose.yml.
# Start with:  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --scale app=3
# Needs Docker Compose 2.24+ for !reset / !override. Secrets come from the .env file.
services:
  caddy:                      # HTTPS in front of NGINX, certificates from Let's Encrypt
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: \${DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data      # keeps certificates across restarts
    depends_on:
      - nginx

  nginx:
    restart: unless-stopped
    ports: !reset []          # no longer public: only Caddy talks to it

  app:
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://postgres:\${DB_PASSWORD}@db:5432/shop

  worker:
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://postgres:\${DB_PASSWORD}@db:5432/shop

  db:
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data   # data survives container restarts

  redis:
    restart: unless-stopped

  prometheus:
    restart: unless-stopped
    ports: !override
      - "127.0.0.1:9090:9090" # only reachable through an SSH tunnel

  grafana:
    restart: unless-stopped
    ports: !override
      - "127.0.0.1:3001:3000"
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "false"
      GF_AUTH_DISABLE_LOGIN_FORM: "false"
      GF_SECURITY_ADMIN_PASSWORD: \${GRAFANA_PASSWORD}

volumes:
  pgdata:
  caddy_data:
`;

const CADDYFILE = `{$DOMAIN} {
	encode zstd gzip
	reverse_proxy nginx:80
}
`;

const ENV_EXAMPLE = `# Copy to .env on the server and fill in. Never commit the real .env.
DOMAIN=shop.example.com
DB_PASSWORD=change-me-to-a-long-random-string
GRAFANA_PASSWORD=change-me-too
`;

// ── Memory leaks & event-loop health ───────────────────────────────────────
const LEAK_EXPRESS = `// Paste next to your other routes, above app.listen(). Add this import at the top:
//   import { pbkdf2Sync, randomBytes } from 'node:crypto';

// ⚠ LEAK ON PURPOSE: every request keeps ~50 KB in a list that is never cleaned.
// This is how real leaks look: a "debug log", a cache without a size limit,
// an event listener added on every request. (Random data, so every entry is
// a new 50 KB string: V8 would share identical constant strings.)
const requestLog: { at: number; payload: string }[] = [];
app.get('/leaky/:id', (req, res) => {
  requestLog.push({ at: Date.now(), payload: randomBytes(25_000).toString('hex') });
  res.json({ id: req.params.id, kept: requestLog.length });
});

// ⚠ BLOCKS THE EVENT LOOP ON PURPOSE: ~100 ms of synchronous CPU work.
// While it runs, no other request in this process can be answered.
app.get('/slow-hash', (_req, res) => {
  pbkdf2Sync('password', 'salt', 200_000, 64, 'sha512');
  res.json({ ok: true });
});
`;

const LEAK_FASTIFY = `// Paste next to your other routes, above app.listen(). Add this import at the top:
//   import { pbkdf2Sync, randomBytes } from 'node:crypto';

// ⚠ LEAK ON PURPOSE: every request keeps ~50 KB in a list that is never cleaned.
const requestLog: { at: number; payload: string }[] = [];
app.get<{ Params: { id: string } }>('/leaky/:id', async (req) => {
  requestLog.push({ at: Date.now(), payload: randomBytes(25_000).toString('hex') });
  return { id: req.params.id, kept: requestLog.length };
});

// ⚠ BLOCKS THE EVENT LOOP ON PURPOSE: ~100 ms of synchronous CPU work.
app.get('/slow-hash', async () => {
  pbkdf2Sync('password', 'salt', 200_000, 64, 'sha512');
  return { ok: true };
});
`;

const FIX_EXPRESS = `// Replace the two routes with these. Imports at the top:
//   import { pbkdf2, randomBytes } from 'node:crypto';
//   import { promisify } from 'node:util';

// FIX 1: a bounded log keeps only the newest 100 entries.
// For a real cache use a size limit (e.g. the lru-cache package) or Redis with a TTL.
const MAX_LOG = 100;
const requestLog: { at: number; payload: string }[] = [];
app.get('/leaky/:id', (req, res) => {
  requestLog.push({ at: Date.now(), payload: randomBytes(25_000).toString('hex') });
  if (requestLog.length > MAX_LOG) requestLog.shift();
  res.json({ id: req.params.id, kept: requestLog.length });
});

// FIX 2: the async version runs on libuv's thread pool (4 threads by default,
// UV_THREADPOOL_SIZE), so the event loop stays free for other requests.
const pbkdf2Async = promisify(pbkdf2);
app.get('/slow-hash', async (_req, res) => {
  await pbkdf2Async('password', 'salt', 200_000, 64, 'sha512');
  res.json({ ok: true });
});
`;

const FIX_FASTIFY = `// Replace the two routes with these. Imports at the top:
//   import { pbkdf2, randomBytes } from 'node:crypto';
//   import { promisify } from 'node:util';

// FIX 1: a bounded log keeps only the newest 100 entries.
const MAX_LOG = 100;
const requestLog: { at: number; payload: string }[] = [];
app.get<{ Params: { id: string } }>('/leaky/:id', async (req) => {
  requestLog.push({ at: Date.now(), payload: randomBytes(25_000).toString('hex') });
  if (requestLog.length > MAX_LOG) requestLog.shift();
  return { id: req.params.id, kept: requestLog.length };
});

// FIX 2: the async version runs on libuv's thread pool, not the event loop.
const pbkdf2Async = promisify(pbkdf2);
app.get('/slow-hash', async () => {
  await pbkdf2Async('password', 'salt', 200_000, 64, 'sha512');
  return { ok: true };
});
`;

const LEAK_PY = `# Add near your other routes in main.py. Imports at the top:
#   import hashlib
#   import os
#   import tracemalloc

# ⚠ LEAK ON PURPOSE: every request keeps ~50 KB in a list that is never cleaned.
REQUEST_LOG = []


@app.get("/leaky/{item_id}")
def leaky(item_id: int):
    REQUEST_LOG.append({"id": item_id, "payload": os.urandom(25_000).hex()})
    return {"id": item_id, "kept": len(REQUEST_LOG)}


# ⚠ BLOCKS THE EVENT LOOP ON PURPOSE: CPU work inside "async def" runs on the
# event loop itself, so every other request waits until it finishes.
@app.get("/slow-hash")
async def slow_hash():
    hashlib.pbkdf2_hmac("sha512", b"password", b"salt", 200_000)
    return {"ok": True}


# Leak hunting: tracemalloc records where memory is allocated. The first call
# takes a baseline; later calls show which lines of code grew the most.
# It slows the app down a little, so only switch it on while hunting.
tracemalloc.start(10)
_baseline = None


@app.get("/debug/memory")
def debug_memory():
    global _baseline
    snapshot = tracemalloc.take_snapshot()
    if _baseline is None:
        _baseline = snapshot
        return {"baseline": "taken, call again after some load"}
    top = snapshot.compare_to(_baseline, "lineno")[:5]
    return {"top_growth": [str(stat) for stat in top]}
`;

const FIX_PY = `# Replace the two routes with these.
from collections import deque

# FIX 1: a deque with maxlen drops the oldest entry automatically.
REQUEST_LOG = deque(maxlen=100)


@app.get("/leaky/{item_id}")
def leaky(item_id: int):
    REQUEST_LOG.append({"id": item_id, "payload": os.urandom(25_000).hex()})
    return {"id": item_id, "kept": len(REQUEST_LOG)}


# FIX 2: a plain "def" endpoint runs in FastAPI's thread pool, so the event
# loop stays free. (pbkdf2_hmac releases the GIL while it hashes.)
@app.get("/slow-hash")
def slow_hash():
    hashlib.pbkdf2_hmac("sha512", b"password", b"salt", 200_000)
    return {"ok": True}
`;

const LEAK_GO = `// Add above func main(). Make sure "strings" and "sync" are in your imports.

// ⚠ LEAK ON PURPOSE: every request keeps ~50 KB in a slice that never shrinks…
var (
	leakMu  sync.Mutex
	leakLog []string
)

// …and starts a goroutine that waits forever on a channel nobody sends to.
// Goroutine leaks are the most common Go leak: each one keeps its stack alive.
func leakyHandler(w http.ResponseWriter, r *http.Request) {
	leakMu.Lock()
	leakLog = append(leakLog, strings.Repeat("x", 50_000)+r.PathValue("id"))
	kept := len(leakLog)
	leakMu.Unlock()

	done := make(chan struct{})
	go func() { <-done }() // never receives: this goroutine lives forever

	writeJSON(w, 200, map[string]any{"id": r.PathValue("id"), "kept": kept})
}

// Inside func main(), next to the other routes:
//   http.HandleFunc("GET /leaky/{id}", leakyHandler)
`;

const FIX_GO = `// FIX: keep only the newest 100 entries, and give every goroutine a way to end.
// Replace leakyHandler with this version; keep the leakMu / leakLog variables.
const maxLog = 100

func leakyHandler(w http.ResponseWriter, r *http.Request) {
	leakMu.Lock()
	leakLog = append(leakLog, strings.Repeat("x", 50_000)+r.PathValue("id"))
	if len(leakLog) > maxLog {
		leakLog = leakLog[len(leakLog)-maxLog:]
	}
	kept := len(leakLog)
	leakMu.Unlock()

	// A goroutine tied to the request context ends when the request ends.
	go func() { <-r.Context().Done() }()

	writeJSON(w, 200, map[string]any{"id": r.PathValue("id"), "kept": kept})
}

// (Go has no single event loop: a slow handler only blocks its own goroutine,
// so there is no /slow-hash problem to fix here.)
`;

const K6_LEAK = `import http from 'k6/http';
import { check } from 'k6';

// A small soak test: steady traffic to the leaky endpoint, a few slow-hash
// calls, and /health to measure how long a trivial request waits.
// Change the length with -e DURATION=10m.
const BASE = __ENV.TARGET || 'http://localhost:8080';
const DURATION = __ENV.DURATION || '5m';

export const options = {
  scenarios: {
    leak: { executor: 'constant-arrival-rate', exec: 'leak', rate: 50, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 20, maxVUs: 200 },
    slow: { executor: 'constant-arrival-rate', exec: 'slow', rate: 5, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 10, maxVUs: 100 },
    health: { executor: 'constant-arrival-rate', exec: 'health', rate: 10, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 5, maxVUs: 50 },
  },
  thresholds: {
    // A health check should be instant. If it isn't, something blocks the process.
    'http_req_duration{scenario:health}': ['p(95)<50'],
  },
};

export function leak() {
  const res = http.get(BASE + '/leaky/' + (Math.floor(Math.random() * 1000) + 1));
  check(res, { 'leaky is 200': (r) => r.status === 200 });
}

export function slow() {
  http.get(BASE + '/slow-hash');
}

export function health() {
  const res = http.get(BASE + '/health');
  check(res, { 'health is 200': (r) => r.status === 200 });
}
`;

// Grafana "Runtime" dashboard, one per language (different runtime metrics).
const rtPanel = (id, title, x, y, expr, legend, unit) => ({
  id, type: 'timeseries', title,
  gridPos: { x, y, w: 12, h: 8 },
  datasource: { type: 'prometheus', uid: 'prometheus' },
  fieldConfig: { defaults: { unit }, overrides: [] },
  targets: [{ refId: 'A', expr, legendFormat: legend }],
});
const HEALTH_P95 = 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{route="/health"}[1m])))';
const runtimeDashboard = (panels) => JSON.stringify({
  uid: 'runtime', title: 'Runtime health', schemaVersion: 39, refresh: '5s',
  time: { from: 'now-15m', to: 'now' }, panels,
}, null, 2) + '\n';
const RUNTIME_TS = runtimeDashboard([
  rtPanel(1, 'Memory per replica (RSS)', 0, 0, 'process_resident_memory_bytes{job="app"}', '{{instance}}', 'bytes'),
  rtPanel(2, 'JavaScript heap used', 12, 0, 'nodejs_heap_size_used_bytes{job="app"}', '{{instance}}', 'bytes'),
  rtPanel(3, 'Event loop lag p99', 0, 8, 'nodejs_eventloop_lag_p99_seconds{job="app"}', '{{instance}}', 's'),
  rtPanel(4, 'Time spent in garbage collection', 12, 8, 'sum by (instance) (rate(nodejs_gc_duration_seconds_sum{job="app"}[1m]))', '{{instance}}', 'percentunit'),
]);
const RUNTIME_PY = runtimeDashboard([
  rtPanel(1, 'Memory per replica (RSS)', 0, 0, 'process_resident_memory_bytes{job="app"}', '{{instance}}', 'bytes'),
  rtPanel(2, 'Garbage collections per second', 12, 0, 'sum by (generation) (rate(python_gc_collections_total{job="app"}[1m]))', 'generation {{generation}}', 'short'),
  rtPanel(3, '/health p95 (blocked event loop shows here)', 0, 8, HEALTH_P95, 'p95', 's'),
  rtPanel(4, 'CPU per process (cores)', 12, 8, 'rate(process_cpu_seconds_total{job="app"}[1m])', '{{instance}}', 'short'),
]);
const RUNTIME_GO = runtimeDashboard([
  rtPanel(1, 'Memory per replica (RSS)', 0, 0, 'process_resident_memory_bytes{job="app"}', '{{instance}}', 'bytes'),
  rtPanel(2, 'Go heap in use', 12, 0, 'go_memstats_heap_inuse_bytes{job="app"}', '{{instance}}', 'bytes'),
  rtPanel(3, 'Goroutines (should stay flat)', 0, 8, 'go_goroutines{job="app"}', '{{instance}}', 'short'),
  rtPanel(4, 'Time spent in garbage collection', 12, 8, 'sum by (instance) (rate(go_gc_duration_seconds_sum{job="app"}[1m]))', '{{instance}}', 'percentunit'),
]);

const RULES_RUNTIME = `  # Append this group at the end of observability/rules.yml (same indentation as the others).
  - name: runtime
    rules:
      # Leak warning: the trend of the last 30 minutes reaches 1 GB within 4 hours.
      - alert: MemoryWillRunOut
        expr: predict_linear(process_resident_memory_bytes{job="app"}[30m], 4 * 3600) > 1e9
        for: 15m
        labels:
          severity: ticket
        annotations:
          summary: "{{ $labels.instance }} is on track to use 1 GB within 4 hours: possible memory leak"

      # Node.js only: something keeps the event loop busy.
      - alert: EventLoopBlocked
        expr: nodejs_eventloop_lag_p99_seconds{job="app"} > 0.1
        for: 5m
        labels:
          severity: ticket
        annotations:
          summary: "{{ $labels.instance }}: event loop lag p99 is {{ $value | humanizeDuration }}"

      # Go only: goroutines keep piling up.
      - alert: GoroutinesGrowing
        expr: delta(go_goroutines{job="app"}[30m]) > 1000
        for: 15m
        labels:
          severity: ticket
        annotations:
          summary: "{{ $labels.instance }} gained {{ $value }} goroutines in 30 minutes: possible goroutine leak"
`;

export const ADV_STEPS = [
  {
    id: 'adv-loadtest',
    title: 'Load-test like a pro: smoke, load, stress, spike, soak',
    short: 'Test types',
    goal: 'Replace the single ramp test with a suite of five test types, a realistic read/write mix and pass/fail thresholds.',
    why: 'Each test answers a different question. Smoke: does it work? Load: does it handle the expected peak? Stress: where does it break? Spike: does it survive a sudden rush? Soak: does it stay healthy for hours (memory leaks, full disks)?',
    concepts: ['load-test', 'p95', 'errorrate', 'rps', 'bottleneck'],
    patterns: ['rate-limiting', 'autoscaling'],
    tasks: [
      'Raise the NGINX rate limit while testing (k6 sends everything from one IP)',
      'Add loadtest/suite.js and run the smoke test',
      'Run the load test with Grafana open and note p95 and errors',
      'Run the stress test and write down the request rate where thresholds fail',
      'Run the spike test, then (when you have 30 minutes) the soak test',
      'Put the NGINX rate limit back',
    ],
    files: [{ path: 'loadtest/suite.js', lang: 'any', code: K6_SUITE, note: 'one script, five test types' }],
    run: {
      any: [
        "sed -i.bak 's/rate=20r\\/s/rate=5000r\\/s/' nginx/nginx.conf && docker compose restart nginx",
        'k6 run -e TEST=smoke loadtest/suite.js',
        'k6 run -e TEST=load loadtest/suite.js',
        'k6 run -e TEST=stress loadtest/suite.js',
        'k6 run -e TEST=spike loadtest/suite.js',
        'k6 run -e TEST=soak loadtest/suite.js     # 30 minutes',
      ],
      after: ['mv nginx/nginx.conf.bak nginx/nginx.conf && docker compose restart nginx     # rate limit back to 20 r/s'],
    },
    verify: ['k6 run -e TEST=load loadtest/suite.js | tee results-load.txt', 'grep -E "http_req_duration|http_req_failed|iterations" results-load.txt'],
    expect: 'Smoke and load pass with ✓ next to every threshold. Stress fails at some rate: that number is your measured capacity. Spike shows whether latency recovers after the rush; soak shows whether memory in Grafana stays flat. "dropped_iterations" in the output means k6 itself couldn’t keep up the rate: the server was too slow to free virtual users.',
    breaks: 'You know where it breaks, but not what one request costs. Next: measure CPU per request and turn it into a server size.',
  },
  {
    id: 'adv-measure',
    title: 'Measure the cost of one request and size a real server',
    short: 'Measure & size',
    goal: 'Hold a steady request rate, read CPU and memory from Prometheus and docker stats, and calculate CPU ms per request and memory per replica. Then size a production server with the Capacity calculator.',
    why: 'This number is what makes server sizing honest. With it you can answer “will a 4 vCPU server be enough for 5,000 users?” with arithmetic instead of hope.',
    concepts: ['cpu', 'ram', 'utilization', 'littles-law', 'golden-signals'],
    patterns: ['vertical-scaling', 'horizontal-scaling'],
    tasks: [
      'Raise the NGINX rate limit (as in A1) and scale to 3 app replicas',
      'Run the constant-rate test at 60 req/s and leave it running',
      'Read CPU per request and memory per replica with the Prometheus queries',
      'Cross-check with docker stats',
      'Repeat at 120 req/s: CPU ms per request should stay about the same',
      'Put the numbers into the Capacity calculator and pick a server',
    ],
    files: [{ path: 'loadtest/constant.js', lang: 'any', code: K6_CONSTANT, note: 'a steady, known request rate' }],
    run: {
      any: [
        "sed -i.bak 's/rate=20r\\/s/rate=5000r\\/s/' nginx/nginx.conf",
        'docker compose up -d --scale app=3 && docker compose restart nginx',
        'k6 run -e RATE=60 loadtest/constant.js     # keep it running; use a second terminal below',
      ],
      after: ['mv nginx/nginx.conf.bak nginx/nginx.conf && docker compose restart nginx'],
    },
    verify: [
      '# CPU milliseconds per request, across all app replicas:',
      promQuery('1000 * sum(rate(process_cpu_seconds_total{job="app"}[1m])) / sum(rate(http_request_duration_seconds_count[1m]))'),
      '# Memory per replica in MB:',
      promQuery('process_resident_memory_bytes{job="app"} / 1e6'),
      '# Requests in flight (Little’s law: rate × average duration):',
      promQuery('sum(rate(http_request_duration_seconds_sum[1m]))'),
      'docker stats --no-stream     # CPU % per container: 100% = one core',
    ],
    expect: 'A small number of milliseconds per request (often 1–10 ms for this app, more for Python), memory per replica that barely moves with load, and requests in flight well under 1. At 120 req/s the CPU ms per request stays close to the 60 req/s value; if it climbs, something is contending (locks, GC, the database). Open Capacity → section 03 to turn these numbers into a server size.',
    breaks: 'Now you know the size, but nobody would notice if it stopped being enough. Next: SLOs and alerts.',
  },
  {
    id: 'adv-slo',
    title: 'SLOs and alerts: get paged for the right things',
    short: 'SLOs & alerts',
    goal: 'Define an availability and a latency SLO, pre-compute them with recording rules, and add alerts on fast error-budget burn, slow requests, saturated processes and dead replicas.',
    why: 'Alerts on symptoms (users get errors, users wait) wake you for things that matter. Alerts on causes (CPU 80%) become tickets. This is the approach from the Google SRE book and workbook.',
    concepts: ['slo', 'golden-signals', 'availability', 'p95', 'monitoring'],
    patterns: ['observability', 'health-failover'],
    tasks: [
      'Add observability/rules.yml and replace observability/prometheus.yml',
      'Mount rules.yml into the prometheus service and restart it',
      'Open http://localhost:9090/rules and check every rule is OK',
      'Trigger AppReplicaDown by pausing one app replica',
      'Trigger the error alerts by stopping Postgres during a load test',
    ],
    files: [
      { path: 'observability/rules.yml', lang: 'any', code: RULES_YML, note: 'recording rules + alerts' },
      { path: 'observability/prometheus.yml', lang: 'any', code: PROMETHEUS_WITH_RULES, note: 'now loads the rules' },
      { path: 'docker-compose.yml (prometheus service only)', lang: 'any', code: COMPOSE_PROM_RULES, note: 'add the second volume line' },
    ],
    run: {
      any: [
        'docker run --rm -v "$PWD/observability:/w" --entrypoint promtool prom/prometheus check rules /w/rules.yml',
        'docker compose up -d prometheus',
      ],
    },
    verify: [
      'open http://localhost:9090/rules      # all groups listed, health OK',
      'docker pause $(docker compose ps -q app | head -n1)',
      'open http://localhost:9090/alerts     # AppReplicaDown: pending, then firing after 1 min',
      'docker unpause $(docker compose ps -q app | head -n1)',
      'docker compose stop db && k6 run -e TEST=load loadtest/suite.js; docker compose start db',
    ],
    expect: 'promtool prints SUCCESS. The Rules page lists slo-recordings, slo-alerts and capacity. Pausing a replica makes AppReplicaDown go pending, then firing. Stopping Postgres during load makes product requests fail (cache misses) and ErrorBudgetBurnFast fires within a few minutes. To get notified on Slack, email or PagerDuty, the next step is adding Alertmanager.',
    breaks: 'You can detect failures now. But do the retries, health checks and caches actually save you when something dies? Next: break it on purpose.',
  },
  {
    id: 'adv-chaos',
    title: 'Break it on purpose: chaos experiments',
    short: 'Chaos',
    goal: 'Run five controlled failure experiments under load, compare what happened with what you expected, and fix every surprise.',
    why: 'Redundancy you never tested is redundancy you don’t have. Teams run “game days” like this before big launches to find missing timeouts, retries and alerts.',
    concepts: ['chaos', 'spof', 'healthcheck', 'cascade', 'breaker'],
    patterns: ['health-failover', 'circuit-breaker', 'bulkhead'],
    tasks: [
      'Copy the game day table and fill in “I expect” for every row before starting',
      'Start the load test and open Grafana',
      'Experiment 1: kill one app replica',
      'Experiment 2: pause Redis for 30 seconds',
      'Experiment 3: add 100 ms network delay to Postgres',
      'Experiments 4 and 5: stop Postgres, then the worker',
      'Turn each surprise into a fix (timeout, retry, alert)',
    ],
    files: [{ path: 'chaos/game-day.md', lang: 'any', code: CHAOS_MD, note: 'your experiment log' }],
    run: {
      any: [
        "sed -i.bak 's/rate=20r\\/s/rate=5000r\\/s/' nginx/nginx.conf && docker compose restart nginx",
        'k6 run -e TEST=load loadtest/suite.js     # keep running; experiments in a second terminal',
        '# 1 · kill one replica (Docker does not restart it)',
        'docker kill $(docker compose ps -q app | head -n1)',
        '# 2 · freeze Redis for 30 seconds',
        'docker compose pause redis; sleep 30; docker compose unpause redis',
        '# 3 · add 100 ms latency to every packet Postgres sends',
        'docker run --rm --net container:$(docker compose ps -q db) --cap-add NET_ADMIN nicolaka/netshoot tc qdisc add dev eth0 root netem delay 100ms',
        'docker run --rm --net container:$(docker compose ps -q db) --cap-add NET_ADMIN nicolaka/netshoot tc qdisc del dev eth0 root     # undo',
        '# 4 · database down for 30 seconds',
        'docker compose stop db; sleep 30; docker compose start db',
        '# 5 · worker down: orders pile up in the queue',
        'docker compose stop worker; sleep 30; docker compose start worker',
      ],
      after: ['docker compose up -d --scale app=3     # bring back the killed replica', 'mv nginx/nginx.conf.bak nginx/nginx.conf && docker compose restart nginx'],
    },
    verify: ['docker compose ps     # everything Up again', 'open http://localhost:3001     # the dashboard shows each experiment as a bump'],
    expect: 'Killing a replica causes a few errors at most (NGINX retries another one). Pausing Redis is the classic surprise: requests hang (Node and Python clients have no timeout by default; go-redis waits 3 s) instead of falling back to Postgres quickly. That is a real bug: give the cache client a short timeout (e.g. 50 ms) and treat a timeout like a cache miss. The DB delay raises p95 by roughly the delay times the number of queries per request. Stopping the worker returns 202 for every order while the queue grows, and it drains when the worker returns.',
    breaks: 'Some endpoints are slower than they should be, and you don’t know which code is responsible. Next: profile it.',
  },
  {
    id: 'adv-profile',
    title: 'Profile it: find what is slow, in code and in SQL',
    short: 'Profiling',
    goal: 'Record a CPU profile of your app under load, read it as a flame graph, and find the slowest database queries with pg_stat_statements and EXPLAIN ANALYZE.',
    why: 'Making the hottest function 2× faster halves the servers you need. Profiling shows where time really goes, which is rarely where you would guess.',
    concepts: ['profiling', 'cpu', 'bottleneck', 'database'],
    patterns: ['cache-aside', 'read-replicas'],
    tasks: [
      'Add docker-compose.profile.yml and restart with it',
      'Enable pg_stat_statements in Postgres',
      'Record a CPU profile while the load test runs',
      'Open the flame graph and find the widest box under your handlers',
      'List the top SQL queries and EXPLAIN ANALYZE the slowest one',
    ],
    files: [
      { path: 'docker-compose.profile.yml', lang: 'ts', code: COMPOSE_PROFILE_TS, note: 'Node inspector + Postgres query stats' },
      { path: 'docker-compose.profile.yml', lang: 'python', code: COMPOSE_PROFILE_ANY, note: 'Postgres query stats' },
      { path: 'docker-compose.profile.yml', lang: 'go', code: COMPOSE_PROFILE_ANY, note: 'Postgres query stats' },
      { path: 'app/main.go (imports)', lang: 'go', code: `import (
	// …your existing imports…
	_ "net/http/pprof" // adds /debug/pprof/* to the default mux. Never expose it publicly.
)
`, note: 'one extra import' },
      { path: 'sql/top-queries.sql', lang: 'any', code: TOP_QUERIES_SQL },
    ],
    run: {
      any: ["sed -i.bak 's/rate=20r\\/s/rate=5000r\\/s/' nginx/nginx.conf     # load tests need more than 20 req/s"],
      ts: [
        'docker compose -f docker-compose.yml -f docker-compose.profile.yml up -d --build --scale app=1',
        'docker compose restart nginx',
        '# Chrome → chrome://inspect → Configure… add localhost:9229 → inspect → Performance tab → record',
        '# While recording, run the load test below in a terminal; stop recording after ~20 s.',
        'k6 run -e TEST=load loadtest/suite.js',
      ],
      python: [
        'docker compose -f docker-compose.yml -f docker-compose.profile.yml up -d --build --scale app=1',
        'docker compose restart nginx',
        'mkdir -p profiles',
        'k6 run -e TEST=load loadtest/suite.js > /dev/null &     # load in the background',
        '# py-spy samples the running Python process from a helper container that shares its process list',
        'docker run --rm --pid=container:$(docker compose ps -q app) --cap-add SYS_PTRACE -v "$PWD/profiles:/out" python:3.12-slim sh -c "pip install -q py-spy && py-spy record -o /out/flame.svg --pid 1 --duration 30"',
        'open profiles/flame.svg',
      ],
      go: [
        'cd app && go mod tidy && cd ..',
        'docker compose -f docker-compose.yml -f docker-compose.profile.yml up -d --build --scale app=1',
        'docker compose restart nginx',
        'k6 run -e TEST=load loadtest/suite.js > /dev/null &     # load in the background',
        'go tool pprof -http=:7070 "http://localhost:8080/debug/pprof/profile?seconds=20"     # opens a flame graph in the browser',
      ],
      after: [
        '# The database side:',
        'docker compose exec db psql -U postgres -d shop -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"',
        'k6 run -e TEST=smoke loadtest/suite.js',
        'docker compose exec -T db psql -U postgres -d shop < sql/top-queries.sql',
        'docker compose exec db psql -U postgres -d shop -c "EXPLAIN ANALYZE SELECT id, name, price_cents FROM products WHERE id = 42;"',
        '# Back to normal:',
        'mv nginx/nginx.conf.bak nginx/nginx.conf',
        'docker compose -f docker-compose.yml up -d --scale app=3 && docker compose restart nginx',
      ],
    },
    verify: ['docker compose exec db psql -U postgres -d shop -c "EXPLAIN ANALYZE SELECT * FROM orders WHERE product_id = 42;"'],
    expect: 'The flame graph is wide at the bottom (the event loop or HTTP server) and narrows into your handlers; look for wide boxes in your own code, JSON serialisation or the database driver. The products lookup shows “Index Scan using products_pkey” in well under a millisecond. The orders query shows “Seq Scan on orders”: there is no index on product_id, so it reads every row. Add one with CREATE INDEX ON orders (product_id); and run EXPLAIN ANALYZE again.',
    breaks: 'A CPU profile only shows half the story: memory that never comes back and code that freezes the event loop don’t show up in it. Next: memory leaks and event-loop health.',
  },
  {
    id: 'adv-memory',
    title: 'Memory leaks and event-loop health',
    short: 'Memory & event loop',
    goal: 'Add one endpoint that leaks memory and one that blocks the event loop, expose both with a soak test and a Runtime dashboard, find the leaking line with your language’s tools, watch an out-of-memory kill, then fix both.',
    why: 'A leak isn’t a sizing problem: memory grows with every request served, not with traffic, so any server runs out eventually; more RAM only delays the crash. Blocking code is invisible in averages but makes every request in the process wait. Neither shows up in a short load test.',
    concepts: ['memory-leak', 'gc', 'event-loop', 'ram', 'load-test'],
    patterns: ['observability', 'health-failover'],
    tasks: [
      'Add the two “bad on purpose” endpoints and the Runtime dashboard',
      'Restart with one replica and open Grafana → Runtime health',
      'Run the leak test: memory climbs in a sawtooth that never comes back down',
      'Find the leak with heap snapshots (Node), tracemalloc (Python) or a pprof heap diff (Go)',
      'Cap the container at 300 MB and watch the process get killed',
      'Node and Python: see /health latency jump while /slow-hash runs',
      'Apply the fixes, run the test again: flat memory and a fast /health',
      'Add the runtime alerts to rules.yml',
    ],
    files: [
      { path: 'app/server.ts (add these routes)', lang: 'express', code: LEAK_EXPRESS, note: 'bad on purpose', tag: 'bug' },
      { path: 'app/server.ts (add these routes)', lang: 'fastify', code: LEAK_FASTIFY, note: 'bad on purpose', tag: 'bug' },
      { path: 'app/main.py (add these routes)', lang: 'python', code: LEAK_PY, note: 'bad on purpose + a leak finder', tag: 'bug' },
      { path: 'app/main.go (add this handler)', lang: 'go', code: LEAK_GO, note: 'bad on purpose', tag: 'bug' },
      { path: 'loadtest/leak.js', lang: 'any', code: K6_LEAK, note: 'a short soak test' },
      { path: 'observability/grafana/dashboards/runtime.json', lang: 'ts', code: RUNTIME_TS, note: 'Grafana picks it up within 10 s' },
      { path: 'observability/grafana/dashboards/runtime.json', lang: 'python', code: RUNTIME_PY, note: 'Grafana picks it up within 10 s' },
      { path: 'observability/grafana/dashboards/runtime.json', lang: 'go', code: RUNTIME_GO, note: 'Grafana picks it up within 10 s' },
      { path: 'app/server.ts (the fix)', lang: 'express', code: FIX_EXPRESS, note: 'after you found the problems' },
      { path: 'app/server.ts (the fix)', lang: 'fastify', code: FIX_FASTIFY, note: 'after you found the problems' },
      { path: 'app/main.py (the fix)', lang: 'python', code: FIX_PY, note: 'after you found the problems' },
      { path: 'app/main.go (the fix)', lang: 'go', code: FIX_GO, note: 'after you found the problems' },
      { path: 'observability/rules.yml (add this group)', lang: 'any', code: RULES_RUNTIME, note: 'leak and blocking alerts' },
    ],
    run: {
      any: ["sed -i.bak 's/rate=20r\\/s/rate=5000r\\/s/' nginx/nginx.conf     # the test sends more than 20 req/s"],
      ts: [
        '# One replica with the Node inspector open (docker-compose.profile.yml from A5):',
        'docker compose -f docker-compose.yml -f docker-compose.profile.yml up -d --build --scale app=1 && docker compose restart nginx',
        'open http://localhost:3001/d/runtime',
        '# Chrome → chrome://inspect → inspect → Memory tab → “Take heap snapshot” (#1)',
        'k6 run loadtest/leak.js',
        '# During the test take snapshot #2, switch the view to “Comparison” and sort by “# Delta”:',
        '# thousands of new strings, all retained by requestLog. That is the leak.',
      ],
      python: [
        'docker compose up -d --build --scale app=1 && docker compose restart nginx',
        'open http://localhost:3001/d/runtime',
        'curl -s localhost:8080/debug/memory     # first call takes the baseline',
        'k6 run -e DURATION=1m loadtest/leak.js',
        'curl -s localhost:8080/debug/memory | python3 -m json.tool     # the line that grew the most is the leak',
      ],
      go: [
        '# One replica, pprof enabled (the net/http/pprof import from A5):',
        'docker compose -f docker-compose.yml -f docker-compose.profile.yml up -d --build --scale app=1 && docker compose restart nginx',
        'open http://localhost:3001/d/runtime',
        'curl -s -o heap1.pb.gz localhost:8080/debug/pprof/heap',
        'k6 run -e DURATION=1m loadtest/leak.js',
        'curl -s -o heap2.pb.gz localhost:8080/debug/pprof/heap',
        'go tool pprof -http=:7070 -diff_base heap1.pb.gz heap2.pb.gz     # what grew between the two',
        'curl -s "localhost:8080/debug/pprof/goroutine?debug=1" | head -15     # thousands stuck on the same line',
      ],
      after: [
        '# Out of memory: cap the app container at 300 MB and run the leak again',
        'docker update --memory 300m --memory-swap 300m $(docker compose ps -q app)',
        'k6 run loadtest/leak.js',
        "docker inspect -f '{{.State.Status}} OOMKilled={{.State.OOMKilled}} exit={{.State.ExitCode}}' $(docker compose ps -aq app)",
        '# Now apply “the fix” files, then rebuild and test again:',
        'docker compose up -d --build --scale app=1 && docker compose restart nginx',
        'k6 run loadtest/leak.js',
        '# Back to normal:',
        'mv nginx/nginx.conf.bak nginx/nginx.conf',
        'docker compose -f docker-compose.yml up -d --scale app=3 && docker compose restart nginx',
      ],
    },
    verify: [
      'curl -s localhost:8080/leaky/1     # after the fix: "kept" never goes above 100',
      'docker stats --no-stream     # memory stays flat while k6 runs',
      'docker run --rm -v "$PWD/observability:/w" --entrypoint promtool prom/prometheus check rules /w/rules.yml',
    ],
    expect: 'Before the fix: memory climbs by ~2.5 MB per second (50 requests × 50 KB). It still has the garbage collector’s sawtooth, but every low point is higher than the last. At 300 MB the process dies within about two minutes. Node usually stops itself first, with “FATAL ERROR: Reached heap limit … JavaScript heap out of memory” in docker logs (exit 134 or 139); Python and Go are killed by the kernel instead (OOMKilled=true, exit 137). The leak finders point at the exact line: the Comparison view shows thousands of new strings retained by requestLog, tracemalloc lists main.py’s append line with +100 MB or more, and Go’s goroutine dump shows thousands stuck in leakyHandler. Node and Python fail the /health threshold, because /slow-hash freezes the event loop for ~100 ms at a time; Go passes, since each request runs in its own goroutine. After the fix memory stays flat, /health p95 stays in single-digit milliseconds, and promtool finds the new runtime rules.',
    breaks: 'Leaks and blocking code slip back in with new features unless something checks every change. Next: a CI quality gate.',
  },
  {
    id: 'adv-ci',
    title: 'CI quality gate: test every change automatically',
    short: 'CI gate',
    goal: 'Add a GitHub Actions workflow that type-checks or lints, starts the whole stack, waits for it, and runs a short k6 performance gate on every push and pull request.',
    why: 'Performance regressions are cheapest when caught in the pull request that caused them. A failing threshold blocks the merge instead of paging someone at night.',
    concepts: ['ci', 'load-test', 'p95', 'healthcheck'],
    patterns: ['observability'],
    tasks: [
      'Make my-system/ a Git repository and push it to GitHub',
      'Add .github/workflows/ci.yml and loadtest/ci.js',
      'Push and watch the run in the Actions tab',
      'Make a change that slows a route down and see the gate fail',
      'In GitHub: Settings → Branches, require the ci check before merging into main',
    ],
    files: [
      { path: '.github/workflows/ci.yml', lang: 'ts', code: CI_TS },
      { path: '.github/workflows/ci.yml', lang: 'python', code: CI_PY },
      { path: '.github/workflows/ci.yml', lang: 'go', code: CI_GO },
      { path: 'loadtest/ci.js', lang: 'any', code: K6_CI, note: 'the performance gate' },
    ],
    run: {
      any: [
        'git init && git add . && git commit -m "My system"',
        'gh repo create my-system --private --source . --push     # or create it on github.com and push',
      ],
    },
    verify: [
      'gh run watch     # follow the workflow run',
      '# Locally, the same gate:',
      'k6 run loadtest/ci.js',
    ],
    expect: 'The workflow builds the images, starts the stack, waits for /health, runs k6 for 30 seconds and shows ✓ for every threshold. If you add something slow (e.g. a 400 ms sleep in the products route), the p95 threshold fails, k6 exits with an error and the run turns red.',
    breaks: 'CI proves the code works. But the data lives in one Postgres container. Delete it and everything is gone. Next: backups, and proving they restore.',
  },
  {
    id: 'adv-backup',
    title: 'Backups and a restore drill',
    short: 'Backups',
    goal: 'Back up Postgres with pg_dump on a schedule, keep 7 days, and run a restore drill into a fresh database to measure how long recovery takes.',
    why: 'Replicas are not backups: a bad DELETE replicates in milliseconds. A backup only counts once you have restored it. The drill also tells you your real RTO (how long recovery takes).',
    concepts: ['backup', 'database', 'wal', 'replica'],
    patterns: ['read-replicas', 'multi-region'],
    tasks: [
      'Add scripts/backup.sh and scripts/restore-drill.sh',
      'Run a backup and check the file size',
      'Run the restore drill and compare row counts',
      'Schedule the backup with cron and copy backups off the machine',
      'Write down your RPO (how much data you may lose) and RTO',
    ],
    files: [
      { path: 'scripts/backup.sh', lang: 'any', code: BACKUP_SH },
      { path: 'scripts/restore-drill.sh', lang: 'any', code: RESTORE_SH, note: 'restores into a separate container' },
    ],
    run: {
      any: [
        'chmod +x scripts/*.sh',
        './scripts/backup.sh',
        './scripts/restore-drill.sh',
        'crontab -e     # add: 15 3 * * * cd /path/to/my-system && ./scripts/backup.sh >> backups/backup.log 2>&1',
      ],
    },
    verify: ['ls -lh backups/', './scripts/restore-drill.sh'],
    expect: 'A .dump file of a few hundred KB, and the restored copy has exactly the same row counts as production. The drill prints how many seconds the restore took. With nightly dumps your RPO is up to 24 hours of lost orders; to get to minutes you would archive the write-ahead log continuously (pgBackRest, WAL-G, or a managed database’s point-in-time recovery).',
    breaks: 'Everything is tested, measured and backed up, but it still only runs on your laptop. Next: a real server.',
  },
  {
    id: 'adv-deploy',
    title: 'Deploy to a real server with HTTPS',
    short: 'Deploy',
    goal: 'Rent one VM (Hetzner, AWS or any provider), lock it down, and run the stack with HTTPS from Caddy, real secrets, persistent database storage and private dashboards.',
    why: 'Production adds the parts a laptop hides: TLS certificates, secrets, firewalls, data that must survive restarts, and dashboards that must not be public. This costs a few euros/dollars; destroy the server when you are done.',
    concepts: ['tls', 'reverse-proxy', 'spof', 'availability', 'iac'],
    patterns: ['reverse-proxy', 'single-server', 'health-failover'],
    tasks: [
      'Create a VM: Ubuntu 24.04, 2 vCPU / 4 GB, with your SSH key (size it with the Capacity page)',
      'Point a domain (A record) at the server’s IP',
      'Firewall: allow only ports 22, 80 and 443',
      'Install Docker and copy my-system/ to the server',
      'Add docker-compose.prod.yml, Caddyfile and .env, then start it',
      'Open https://your-domain/health and Grafana through an SSH tunnel',
      'Run the A1 load test against the server, then destroy it if you don’t need it',
    ],
    files: [
      { path: 'docker-compose.prod.yml', lang: 'any', code: COMPOSE_PROD, note: 'production overrides' },
      { path: 'Caddyfile', lang: 'any', code: CADDYFILE, note: 'automatic HTTPS' },
      { path: '.env.example', lang: 'any', code: ENV_EXAMPLE, note: 'copy to .env on the server' },
    ],
    run: {
      any: [
        '# On your laptop:',
        'rsync -az --exclude node_modules --exclude .git --exclude backups ./ root@SERVER_IP:/opt/my-system/',
        'ssh root@SERVER_IP',
        '# On the server:',
        'ufw allow OpenSSH && ufw allow 80,443/tcp && ufw --force enable',
        'curl -fsSL https://get.docker.com | sh',
        'cd /opt/my-system && cp .env.example .env && nano .env     # set DOMAIN and passwords',
        'docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --scale app=3',
      ],
    },
    verify: [
      'curl -s https://shop.example.com/health     # {"ok":true} over HTTPS',
      'curl -sv https://shop.example.com/health 2>&1 | grep -E "issuer:|expire date:|HTTP/"     # Let’s Encrypt certificate',
      'ssh -L 3001:127.0.0.1:3001 -L 9090:127.0.0.1:9090 root@SERVER_IP     # then open http://localhost:3001',
      'k6 run -e TEST=load -e TARGET=https://shop.example.com loadtest/suite.js     # from your laptop',
    ],
    expect: 'Caddy fetches a Let’s Encrypt certificate within a minute and https:// works; http:// redirects to it. Ports 8080, 9090 and 3001 are not reachable from the internet; Grafana asks for a login. Note: Docker publishes ports by editing iptables directly, so a port mapping can bypass ufw. That is why the dashboards are bound to 127.0.0.1. Updating with "up -d --build" recreates containers and causes a few seconds of errors; tools like Kamal, Docker Swarm or Kubernetes do rolling updates without that gap.',
    breaks: 'One server is still a single point of failure, and updates cause brief downtime. Next stops lead to multiple servers, managed services and orchestration.',
  },
  {
    id: 'adv-next',
    title: 'Where to go from here',
    short: 'Next stops',
    goal: 'Choose the next skill by what your system needs most: resilience, scale, speed of delivery or insight.',
    why: 'You now have the loop real teams use: measure, test, alert, break, profile, gate, back up and deploy. Everything else builds on it.',
    concepts: ['golden-signals', 'slo', 'autoscale', 'region', 'iac'],
    patterns: ['service-mesh', 'multi-region', 'autoscaling', 'cell-based', 'observability'],
    sim: { users: 300000, regions: 2, lb: true, lbNodes: 2, servers: 10, vcpu: 8, ram: 16, proxy: true, sessions: 'shared', cache: true, cacheGb: 64, queue: true, workers: 16, replicas: 2, pooler: true, cdn: true, gateway: true, breaker: true, autoscale: true, dbVcpu: 16, dbRam: 64 },
    tasks: [
      'Tracing: add OpenTelemetry to the app and view request traces in Grafana Tempo or Jaeger',
      'Logs: structured JSON logs collected with Loki, linked to traces by request ID',
      'Notifications: add Alertmanager and route “page” alerts to Slack, email or PagerDuty',
      'Orchestration: run the stack on Kubernetes (kind or k3d locally) with a Horizontal Pod Autoscaler',
      'Zero-downtime deploys: rolling updates, plus expand-and-contract database migrations',
      'Security: dependency scanning, secrets in a vault, least-privilege database users',
      'Two servers or two regions: a managed load balancer, a managed database with a standby',
    ],
    files: [],
    run: {},
    verify: [],
    expect: 'There is no fixed order. Pick the item that removes your biggest current risk, measure before and after, and keep the Capacity page’s loop going: estimate, measure, size, test, watch, resize.',
    breaks: null,
  },
];
