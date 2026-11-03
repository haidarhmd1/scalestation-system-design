// "Build Your Own" track: build a real system step by step, in the language
// of your choice. Each station adds one idea and ends with proof it works.
// Files tagged lang 'any' are shared; others show only for that language.

export const LANGS = [
  { id: 'express', label: 'Node.js', sub: 'TypeScript · Express 5', ext: 'ts', group: 'node', framework: 'Express 5' },
  { id: 'fastify', label: 'Node.js', sub: 'TypeScript · Fastify 5', ext: 'ts', group: 'node', framework: 'Fastify 5' },
  { id: 'python', label: 'Python', sub: 'FastAPI', ext: 'py' },
  { id: 'go', label: 'Go', sub: 'net/http · Go 1.25+', ext: 'go' },
];

// ── Docker Compose file, grown station by station ────────────────────────
function compose({ proxy = false, redis = false, worker = null, observability = false } = {}) {
  const env = [
    '    environment:',
    '      DATABASE_URL: postgres://postgres:dev@db:5432/shop',
    ...(redis ? ['      REDIS_URL: redis://redis:6379'] : []),
  ];
  const deps = [
    '    depends_on:',
    '      db:',
    '        condition: service_healthy',
    ...(redis ? ['      redis:', '        condition: service_started'] : []),
  ];
  const out = ['services:', '  app:', '    build: ./app', ...env];
  if (!proxy) out.push('    ports:', '      - "3000:3000"');
  out.push(...deps);
  if (worker) {
    out.push('', '  worker:                # same code, started in "worker" mode', '    build: ./app', `    command: ${worker}`, ...env, ...deps);
  }
  if (proxy) {
    out.push(
      '',
      '  nginx:                 # reverse proxy + load balancer in front of the app',
      '    image: nginx:1.27',
      '    ports:',
      '      - "8080:80"',
      '    volumes:',
      '      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro',
      '    depends_on:',
      '      - app',
    );
  }
  out.push(
    '',
    '  db:',
    '    image: postgres:16',
    '    environment:',
    '      POSTGRES_PASSWORD: dev',
    '      POSTGRES_DB: shop',
    '    volumes:',
    '      - ./schema.sql:/docker-entrypoint-initdb.d/schema.sql:ro   # runs on first start',
    '    healthcheck:',
    '      test: ["CMD-SHELL", "pg_isready -U postgres"]',
    '      interval: 2s',
    '      retries: 15',
  );
  if (redis) out.push('', '  redis:', '    image: redis:7');
  if (observability) {
    out.push(
      '',
      '  prometheus:            # collects metrics from every app replica',
      '    image: prom/prometheus:latest',
      '    ports:',
      '      - "9090:9090"',
      '    volumes:',
      '      - ./observability/prometheus.yml:/etc/prometheus/prometheus.yml:ro',
      '',
      '  grafana:               # dashboards on http://localhost:3001',
      '    image: grafana/grafana:latest',
      '    ports:',
      '      - "3001:3000"',
      '    environment:          # local learning setup only: no login',
      '      GF_AUTH_ANONYMOUS_ENABLED: "true"',
      '      GF_AUTH_ANONYMOUS_ORG_ROLE: Admin',
      '      GF_AUTH_DISABLE_LOGIN_FORM: "true"',
      '    volumes:',
      '      - ./observability/grafana/provisioning:/etc/grafana/provisioning:ro',
      '      - ./observability/grafana/dashboards:/var/lib/grafana/dashboards:ro',
      '    depends_on:',
      '      - prometheus',
    );
  }
  return out.join('\n') + '\n';
}

const NGINX_BASIC = `events {}

http {
  # Docker's DNS returns every replica of the "app" service,
  # so NGINX spreads requests across all of them (round robin).
  upstream app_servers {
    server app:3000 max_fails=3 fail_timeout=10s;
  }

  server {
    listen 80;
    gzip on;                          # compress responses
    gzip_types application/json;

    location / {
      proxy_pass http://app_servers;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
  }
}
`;

const NGINX_LIMITED = `events {}

http {
  # Rate limiting: each IP address may send 20 requests per second
  # (with short bursts up to 40). Extra requests get 429 Too Many Requests.
  limit_req_zone $binary_remote_addr zone=perip:10m rate=20r/s;

  upstream app_servers {
    # Passive health checks: after 3 failures a replica is skipped for 10 s.
    server app:3000 max_fails=3 fail_timeout=10s;
  }

  server {
    listen 80;
    gzip on;
    gzip_types application/json;

    location / {
      limit_req zone=perip burst=40 nodelay;
      limit_req_status 429;
      proxy_next_upstream error timeout http_502 http_503;   # retry on another replica
      proxy_pass http://app_servers;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
  }
}
`;

const SCHEMA = `CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  price_cents INT  NOT NULL
);

-- 10,000 sample products so there is something to read
INSERT INTO products (name, price_cents)
SELECT 'Product ' || g, (random() * 10000)::int
FROM generate_series(1, 10000) AS g;
`;

const SCHEMA_ORDERS = `CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,          -- the job id: makes saving idempotent
  product_id INT  NOT NULL,
  qty        INT  NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const K6_SMOKE = `import http from 'k6/http';
import { check } from 'k6';

// 50 virtual users hammering one URL for 20 seconds.
export const options = { vus: 50, duration: '20s' };

export default function () {
  const res = http.get(__ENV.TARGET || 'http://localhost:3000/');
  check(res, { 'status is 200': (r) => r.status === 200 });
}
`;

const K6_RAMP = `import http from 'k6/http';
import { check } from 'k6';

// Ramp up until something gives: 50 → 200 → 500 virtual users.
export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '30s', target: 200 },
    { duration: '30s', target: 500 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],     // fewer than 1% errors
    http_req_duration: ['p(95)<500'],   // 95% of requests under 500 ms
  },
};

const BASE = __ENV.TARGET || 'http://localhost:8080';

export default function () {
  const id = Math.floor(Math.random() * 10000) + 1;
  const res = http.get(BASE + '/products/' + id);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
`;

// ── Node.js + TypeScript versions of the app ─────────────────────────────
// Node 22.18+ / 24 runs .ts files directly ("type stripping"), so there is
// no build step: `node server.ts`. `npm run typecheck` checks the types.

const TS_DB = `// Connection pool: reuse at most 10 open connections to Postgres.
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:dev@localhost:5432/shop',
  max: 10,
});`;

const TS_REDIS = `const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
redis.on('error', (err) => console.error('redis error', err));
await redis.connect();`;

const TS_METRICS_DEF = `// Prometheus metrics: how long each request took, by method, route and status.
client.collectDefaultMetrics();
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});`;

const EXPRESS = {};
EXPRESS.s1 = `import express from 'express';
import os from 'node:os';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
  res.json({ hello: 'world', server: os.hostname() });
});

app.listen(3000, () => console.log('listening on http://localhost:3000'));
`;

EXPRESS.s2 = `import express from 'express';
import os from 'node:os';
import pg from 'pg';

type Product = { id: number; name: string; price_cents: number };

const app = express();

${TS_DB}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
  res.json({ hello: 'world', server: os.hostname() });
});

app.get('/products/:id', async (req, res) => {
  const { rows } = await db.query<Product>(
    'SELECT id, name, price_cents FROM products WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ...rows[0], server: os.hostname() });
});

app.listen(3000, () => console.log('listening on http://localhost:3000'));
`;

EXPRESS.s5bug = `// Add to server.ts, above app.listen(...).
// STATEFUL on purpose: each server keeps its own counter in memory.
const visitsInMemory = new Map<string, number>();

app.get('/visit/:user', (req, res) => {
  const visits = (visitsInMemory.get(req.params.user) ?? 0) + 1;
  visitsInMemory.set(req.params.user, visits);
  res.json({ user: req.params.user, visits, server: os.hostname() });
});
`;

const EXPRESS_VISIT = `// STATELESS: the counter lives in Redis, shared by every server.
app.get('/visit/:user', async (req, res) => {
  const visits = await redis.incr('visits:' + req.params.user);
  res.json({ user: req.params.user, visits, server: os.hostname() });
});`;

const EXPRESS_PRODUCT_PLAIN = `app.get('/products/:id', async (req, res) => {
  const { rows } = await db.query<Product>(
    'SELECT id, name, price_cents FROM products WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ...rows[0], server: os.hostname() });
});`;

const EXPRESS_PRODUCT_CACHED = `// Cache-aside: 1) look in Redis  2) on a miss ask Postgres  3) remember it.
app.get('/products/:id', async (req, res) => {
  const key = 'product:' + req.params.id;

  const cached = await redis.get(key);
  if (cached) {
    res.json({ ...JSON.parse(cached), cache: 'hit', server: os.hostname() });
    return;
  }

  const { rows } = await db.query<Product>(
    'SELECT id, name, price_cents FROM products WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  await redis.set(key, JSON.stringify(rows[0]), { EX: 60 }); // expires after 60 s
  res.json({ ...rows[0], cache: 'miss', server: os.hostname() });
});`;

const EXPRESS_ORDERS = `// Accept the order instantly and let a worker save it later.
app.post('/orders', async (req, res) => {
  const productId = Number(req.body?.product_id);
  if (!productId) {
    res.status(400).json({ error: 'product_id is required' });
    return;
  }
  const order = { id: randomUUID(), product_id: productId, qty: Number(req.body.qty ?? 1) };
  await redis.lPush('queue:orders', JSON.stringify(order));
  res.status(202).json({ accepted: order.id });
});`;

const EXPRESS_BASE_ROUTES = `app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
  res.json({ hello: 'world', server: os.hostname() });
});`;

const expressApp = ({ cache = false, orders = false, metrics = false }) => `import express from 'express';
import os from 'node:os';
${orders ? "import { randomUUID } from 'node:crypto';\n" : ''}import pg from 'pg';
${metrics ? "import client from 'prom-client';\n" : ''}import { createClient } from 'redis';

type Product = { id: number; name: string; price_cents: number };

const app = express();
${orders ? 'app.use(express.json());\n' : ''}
${TS_DB}

${TS_REDIS}
${metrics ? `
${TS_METRICS_DEF}

// Measure every request once its response has been sent.
app.use((req, res, next) => {
  const stop = httpDuration.startTimer();
  res.on('finish', () => {
    stop({ method: req.method, route: req.route?.path ?? 'unmatched', status: String(res.statusCode) });
  });
  next();
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
});
` : ''}
${EXPRESS_BASE_ROUTES}

${cache ? EXPRESS_PRODUCT_CACHED : EXPRESS_PRODUCT_PLAIN}

${EXPRESS_VISIT}
${orders ? `\n${EXPRESS_ORDERS}\n` : ''}
app.listen(3000, () => console.log('listening on http://localhost:3000'));
`;

EXPRESS.s5 = expressApp({});
EXPRESS.s6 = expressApp({ cache: true });
EXPRESS.s7 = expressApp({ cache: true, orders: true });
EXPRESS.s8 = expressApp({ cache: true, orders: true, metrics: true });

const FASTIFY = {};
FASTIFY.s1 = `import Fastify from 'fastify';
import os from 'node:os';

const app = Fastify();

app.get('/health', async () => ({ ok: true }));

app.get('/', async () => ({ hello: 'world', server: os.hostname() }));

await app.listen({ port: 3000, host: '0.0.0.0' });
console.log('listening on http://localhost:3000');
`;

const FASTIFY_BASE_ROUTES = `app.get('/health', async () => ({ ok: true }));

app.get('/', async () => ({ hello: 'world', server: os.hostname() }));`;

const FASTIFY_PRODUCT_PLAIN = `app.get<{ Params: { id: string } }>('/products/:id', async (req, reply) => {
  const { rows } = await db.query<Product>(
    'SELECT id, name, price_cents FROM products WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) return reply.code(404).send({ error: 'not found' });
  return { ...rows[0], server: os.hostname() };
});`;

const FASTIFY_PRODUCT_CACHED = `// Cache-aside: 1) look in Redis  2) on a miss ask Postgres  3) remember it.
app.get<{ Params: { id: string } }>('/products/:id', async (req, reply) => {
  const key = 'product:' + req.params.id;

  const cached = await redis.get(key);
  if (cached) return { ...JSON.parse(cached), cache: 'hit', server: os.hostname() };

  const { rows } = await db.query<Product>(
    'SELECT id, name, price_cents FROM products WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) return reply.code(404).send({ error: 'not found' });

  await redis.set(key, JSON.stringify(rows[0]), { EX: 60 }); // expires after 60 s
  return { ...rows[0], cache: 'miss', server: os.hostname() };
});`;

const FASTIFY_VISIT = `// STATELESS: the counter lives in Redis, shared by every server.
app.get<{ Params: { user: string } }>('/visit/:user', async (req) => {
  const visits = await redis.incr('visits:' + req.params.user);
  return { user: req.params.user, visits, server: os.hostname() };
});`;

const FASTIFY_ORDERS = `// Accept the order instantly and let a worker save it later.
app.post<{ Body: { product_id?: number; qty?: number } }>('/orders', async (req, reply) => {
  const productId = Number(req.body?.product_id);
  if (!productId) return reply.code(400).send({ error: 'product_id is required' });

  const order = { id: randomUUID(), product_id: productId, qty: Number(req.body.qty ?? 1) };
  await redis.lPush('queue:orders', JSON.stringify(order));
  return reply.code(202).send({ accepted: order.id });
});`;

FASTIFY.s2 = `import Fastify from 'fastify';
import os from 'node:os';
import pg from 'pg';

type Product = { id: number; name: string; price_cents: number };

const app = Fastify();

${TS_DB}

${FASTIFY_BASE_ROUTES}

${FASTIFY_PRODUCT_PLAIN}

await app.listen({ port: 3000, host: '0.0.0.0' });
console.log('listening on http://localhost:3000');
`;

FASTIFY.s5bug = `// Add to server.ts, above await app.listen(...).
// STATEFUL on purpose: each server keeps its own counter in memory.
const visitsInMemory = new Map<string, number>();

app.get<{ Params: { user: string } }>('/visit/:user', async (req) => {
  const visits = (visitsInMemory.get(req.params.user) ?? 0) + 1;
  visitsInMemory.set(req.params.user, visits);
  return { user: req.params.user, visits, server: os.hostname() };
});
`;

const fastifyApp = ({ cache = false, orders = false, metrics = false }) => `import Fastify from 'fastify';
import os from 'node:os';
${orders ? "import { randomUUID } from 'node:crypto';\n" : ''}import pg from 'pg';
${metrics ? "import client from 'prom-client';\n" : ''}import { createClient } from 'redis';

type Product = { id: number; name: string; price_cents: number };

const app = Fastify();

${TS_DB}

${TS_REDIS}
${metrics ? `
${TS_METRICS_DEF}

// Measure every request once its response has been sent.
app.addHook('onResponse', async (req, reply) => {
  httpDuration.observe(
    { method: req.method, route: req.routeOptions.url ?? 'unmatched', status: String(reply.statusCode) },
    reply.elapsedTime / 1000,
  );
});

app.get('/metrics', async (_req, reply) => {
  reply.header('Content-Type', client.register.contentType);
  return client.register.metrics();
});
` : ''}
${FASTIFY_BASE_ROUTES}

${cache ? FASTIFY_PRODUCT_CACHED : FASTIFY_PRODUCT_PLAIN}

${FASTIFY_VISIT}
${orders ? `\n${FASTIFY_ORDERS}\n` : ''}
await app.listen({ port: 3000, host: '0.0.0.0' });
console.log('listening on http://localhost:3000');
`;

FASTIFY.s5 = fastifyApp({});
FASTIFY.s6 = fastifyApp({ cache: true });
FASTIFY.s7 = fastifyApp({ cache: true, orders: true });
FASTIFY.s8 = fastifyApp({ cache: true, orders: true, metrics: true });

const TS = {
  worker: `import pg from 'pg';
import { createClient } from 'redis';

type Order = { id: string; product_id: number; qty: number };

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:dev@localhost:5432/shop',
  max: 2,
});

const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
redis.on('error', (err) => console.error('redis error', err));
await redis.connect();
console.log('worker waiting for jobs');

while (true) {
  const job = await redis.brPop('queue:orders', 0); // waits until a job arrives
  if (!job) continue;
  const order = JSON.parse(job.element) as Order;

  // ON CONFLICT DO NOTHING makes this idempotent: a repeated job is harmless.
  await db.query(
    'INSERT INTO orders (id, product_id, qty) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    [order.id, order.product_id, order.qty],
  );
  console.log('saved order', order.id);
}
`,
  tsconfig: `{
  // Type-check only: Node runs the .ts files directly (type stripping).
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
`,
  dockerfile: `FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
# Node 24 runs TypeScript directly: no build step needed.
CMD ["node", "server.ts"]
`,
};

// ── Python versions of the app ───────────────────────────────────────────
const PY_HEAD = `import json
import os
import socket
import uuid

import redis
from fastapi import FastAPI, HTTPException
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

app = FastAPI()
HOST = socket.gethostname()

# Connection pool: reuse at most 10 open connections to Postgres.
db = ConnectionPool(
    os.getenv("DATABASE_URL", "postgresql://postgres:dev@localhost:5432/shop"),
    max_size=10,
    open=True,
)
cache = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"), decode_responses=True)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/")
def root():
    return {"hello": "world", "server": HOST}
`;

const PY = {
  s1: `import socket

from fastapi import FastAPI

app = FastAPI()
HOST = socket.gethostname()


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/")
def root():
    return {"hello": "world", "server": HOST}
`,
  s2: `import os
import socket

from fastapi import FastAPI, HTTPException
from psycopg_pool import ConnectionPool

app = FastAPI()
HOST = socket.gethostname()

# Connection pool: reuse at most 10 open connections to Postgres.
db = ConnectionPool(
    os.getenv("DATABASE_URL", "postgresql://postgres:dev@localhost:5432/shop"),
    max_size=10,
    open=True,
)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/")
def root():
    return {"hello": "world", "server": HOST}


@app.get("/products/{product_id}")
def product(product_id: int):
    with db.connection() as conn:
        row = conn.execute(
            "SELECT id, name, price_cents FROM products WHERE id = %s", (product_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return {"id": row[0], "name": row[1], "price_cents": row[2], "server": HOST}
`,
  s5bug: `# Add to main.py.
# STATEFUL on purpose: each server keeps its own counter in memory.
visits_in_memory = {}


@app.get("/visit/{user}")
def visit(user: str):
    visits_in_memory[user] = visits_in_memory.get(user, 0) + 1
    return {"user": user, "visits": visits_in_memory[user], "server": HOST}
`,
  s5: `${PY_HEAD}

@app.get("/products/{product_id}")
def product(product_id: int):
    with db.connection() as conn:
        row = conn.execute(
            "SELECT id, name, price_cents FROM products WHERE id = %s", (product_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return {"id": row[0], "name": row[1], "price_cents": row[2], "server": HOST}


# STATELESS: the counter lives in Redis, shared by every server.
@app.get("/visit/{user}")
def visit(user: str):
    visits = cache.incr(f"visits:{user}")
    return {"user": user, "visits": visits, "server": HOST}
`,
  s6: `${PY_HEAD}

# Cache-aside: 1) look in Redis  2) on a miss ask Postgres  3) remember it.
@app.get("/products/{product_id}")
def product(product_id: int):
    key = f"product:{product_id}"

    cached = cache.get(key)
    if cached:
        return {**json.loads(cached), "cache": "hit", "server": HOST}

    with db.connection() as conn:
        row = conn.execute(
            "SELECT id, name, price_cents FROM products WHERE id = %s", (product_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")

    item = {"id": row[0], "name": row[1], "price_cents": row[2]}
    cache.set(key, json.dumps(item), ex=60)  # expires after 60 s
    return {**item, "cache": "miss", "server": HOST}


@app.get("/visit/{user}")
def visit(user: str):
    visits = cache.incr(f"visits:{user}")
    return {"user": user, "visits": visits, "server": HOST}
`,
  s7: `${PY_HEAD}

@app.get("/products/{product_id}")
def product(product_id: int):
    key = f"product:{product_id}"

    cached = cache.get(key)
    if cached:
        return {**json.loads(cached), "cache": "hit", "server": HOST}

    with db.connection() as conn:
        row = conn.execute(
            "SELECT id, name, price_cents FROM products WHERE id = %s", (product_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")

    item = {"id": row[0], "name": row[1], "price_cents": row[2]}
    cache.set(key, json.dumps(item), ex=60)
    return {**item, "cache": "miss", "server": HOST}


@app.get("/visit/{user}")
def visit(user: str):
    visits = cache.incr(f"visits:{user}")
    return {"user": user, "visits": visits, "server": HOST}


class OrderIn(BaseModel):
    product_id: int
    qty: int = 1


# Accept the order instantly and let a worker save it later.
@app.post("/orders", status_code=202)
def create_order(order: OrderIn):
    job = {"id": str(uuid.uuid4()), "product_id": order.product_id, "qty": order.qty}
    cache.lpush("queue:orders", json.dumps(job))
    return {"accepted": job["id"]}
`,
  worker: `import json
import os

import redis
from psycopg_pool import ConnectionPool

queue = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"), decode_responses=True)
db = ConnectionPool(
    os.getenv("DATABASE_URL", "postgresql://postgres:dev@localhost:5432/shop"),
    min_size=1,  # psycopg's default min_size is 4, which must not exceed max_size
    max_size=2,
    open=True,
)

print("worker waiting for jobs", flush=True)

while True:
    _, raw = queue.brpop("queue:orders")  # waits until a job arrives
    order = json.loads(raw)

    # ON CONFLICT DO NOTHING makes this idempotent: a repeated job is harmless.
    with db.connection() as conn:  # commits when the block ends
        conn.execute(
            "INSERT INTO orders (id, product_id, qty) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",
            (order["id"], order["product_id"], order["qty"]),
        )
    print("saved order", order["id"], flush=True)
`,
  requirements1: `fastapi
uvicorn[standard]
`,
  requirements: `fastapi
uvicorn[standard]
psycopg[binary,pool]
redis
`,
  dockerfile: `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 3000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]
`,
};

// ── Go versions of the app ───────────────────────────────────────────────
const GO_HELPERS = `var host, _ = os.Hostname()

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}`;

const GO_PRODUCT_TYPE = `type Product struct {
	ID         int    \`json:"id"\`
	Name       string \`json:"name"\`
	PriceCents int    \`json:"price_cents"\`
}`;

const GO_DB_OPEN = `	// Connection pool: pgxpool reuses open connections to Postgres.
	db, err := pgxpool.New(context.Background(), env("DATABASE_URL", "postgres://postgres:dev@localhost:5432/shop"))
	if err != nil {
		log.Fatal(err)
	}`;

const GO_REDIS_OPEN = `	opt, err := redis.ParseURL(env("REDIS_URL", "redis://localhost:6379"))
	if err != nil {
		log.Fatal(err)
	}
	rdb := redis.NewClient(opt)`;

const GO_ROOT = `	http.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true})
	})

	http.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"hello": "world", "server": host})
	})`;

const GO_PRODUCT_PLAIN = `	http.HandleFunc("GET /products/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "id must be a number"})
			return
		}
		var p Product
		err = db.QueryRow(r.Context(),
			"SELECT id, name, price_cents FROM products WHERE id = $1", id,
		).Scan(&p.ID, &p.Name, &p.PriceCents)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"id": p.ID, "name": p.Name, "price_cents": p.PriceCents, "server": host})
	})`;

const GO_PRODUCT_CACHED = `	// Cache-aside: 1) look in Redis  2) on a miss ask Postgres  3) remember it.
	http.HandleFunc("GET /products/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "id must be a number"})
			return
		}
		key := "product:" + strconv.Itoa(id)
		var p Product

		if cached, err := rdb.Get(r.Context(), key).Result(); err == nil {
			json.Unmarshal([]byte(cached), &p)
			writeJSON(w, 200, map[string]any{"id": p.ID, "name": p.Name, "price_cents": p.PriceCents, "cache": "hit", "server": host})
			return
		}

		err = db.QueryRow(r.Context(),
			"SELECT id, name, price_cents FROM products WHERE id = $1", id,
		).Scan(&p.ID, &p.Name, &p.PriceCents)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}

		b, _ := json.Marshal(p)
		rdb.Set(r.Context(), key, b, 60*time.Second) // expires after 60 s
		writeJSON(w, 200, map[string]any{"id": p.ID, "name": p.Name, "price_cents": p.PriceCents, "cache": "miss", "server": host})
	})`;

const GO_VISIT = `	// STATELESS: the counter lives in Redis, shared by every server.
	http.HandleFunc("GET /visit/{user}", func(w http.ResponseWriter, r *http.Request) {
		user := r.PathValue("user")
		visits, err := rdb.Incr(r.Context(), "visits:"+user).Result()
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"user": user, "visits": visits, "server": host})
	})`;

const GO_LISTEN = `	log.Println("listening on http://localhost:3000")
	log.Fatal(http.ListenAndServe(":3000", nil))`;

const GO = {
  s1: `package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

var host, _ = os.Hostname()

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func main() {
${GO_ROOT}

${GO_LISTEN}
}
`,
  s2: `package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

${GO_HELPERS}

${GO_PRODUCT_TYPE}

func main() {
${GO_DB_OPEN}

${GO_ROOT}

${GO_PRODUCT_PLAIN}

${GO_LISTEN}
}
`,
  s5bug: `// Add inside main(), before ListenAndServe, plus "sync" to the imports.
// STATEFUL on purpose: each server keeps its own counter in memory.
	var mu sync.Mutex
	visitsInMemory := map[string]int{}

	http.HandleFunc("GET /visit/{user}", func(w http.ResponseWriter, r *http.Request) {
		user := r.PathValue("user")
		mu.Lock()
		visitsInMemory[user]++
		visits := visitsInMemory[user]
		mu.Unlock()
		writeJSON(w, 200, map[string]any{"user": user, "visits": visits, "server": host})
	})
`,
  s5: `package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

${GO_HELPERS}

${GO_PRODUCT_TYPE}

func main() {
${GO_DB_OPEN}
${GO_REDIS_OPEN}

${GO_ROOT}

${GO_PRODUCT_PLAIN}

${GO_VISIT}

${GO_LISTEN}
}
`,
  s6: `package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

${GO_HELPERS}

${GO_PRODUCT_TYPE}

func main() {
${GO_DB_OPEN}
${GO_REDIS_OPEN}

${GO_ROOT}

${GO_PRODUCT_CACHED}

${GO_VISIT}

${GO_LISTEN}
}
`,
  s7: `package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

${GO_HELPERS}

${GO_PRODUCT_TYPE}

type Order struct {
	ID        string \`json:"id"\`
	ProductID int    \`json:"product_id"\`
	Qty       int    \`json:"qty"\`
}

func newID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func main() {
${GO_DB_OPEN}
${GO_REDIS_OPEN}

	// "server worker" starts the background worker instead of the web server.
	if len(os.Args) > 1 && os.Args[1] == "worker" {
		runWorker(db, rdb)
		return
	}

${GO_ROOT}

${GO_PRODUCT_CACHED}

${GO_VISIT}

	// Accept the order instantly and let a worker save it later.
	http.HandleFunc("POST /orders", func(w http.ResponseWriter, r *http.Request) {
		var o Order
		if err := json.NewDecoder(r.Body).Decode(&o); err != nil || o.ProductID == 0 {
			writeJSON(w, 400, map[string]string{"error": "product_id is required"})
			return
		}
		if o.Qty == 0 {
			o.Qty = 1
		}
		o.ID = newID()
		b, _ := json.Marshal(o)
		if err := rdb.LPush(r.Context(), "queue:orders", b).Err(); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 202, map[string]string{"accepted": o.ID})
	})

${GO_LISTEN}
}

func runWorker(db *pgxpool.Pool, rdb *redis.Client) {
	ctx := context.Background()
	log.Println("worker waiting for jobs")
	for {
		res, err := rdb.BRPop(ctx, 0, "queue:orders").Result() // waits until a job arrives
		if err != nil {
			log.Println("redis:", err)
			time.Sleep(time.Second)
			continue
		}
		var o Order
		if err := json.Unmarshal([]byte(res[1]), &o); err != nil {
			log.Println("bad job:", err)
			continue
		}
		// ON CONFLICT DO NOTHING makes this idempotent: a repeated job is harmless.
		_, err = db.Exec(ctx,
			"INSERT INTO orders (id, product_id, qty) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
			o.ID, o.ProductID, o.Qty)
		if err != nil {
			log.Println("db:", err)
			continue
		}
		log.Println("saved order", o.ID)
	}
}
`,
  dockerfile: `# golang:1 = the latest Go 1.x, so it always matches the "go" line in your go.mod
FROM golang:1 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /server .

# Tiny runtime image: just the compiled binary.
FROM gcr.io/distroless/static-debian12
COPY --from=build /server /server
EXPOSE 3000
ENTRYPOINT ["/server"]
`,
};

// ── Metrics-enabled versions (station "See inside") ──────────────────────
PY.s8 = PY.s7
  .replace('import socket\n', 'import socket\nimport time\n')
  .replace('from fastapi import FastAPI, HTTPException\n', 'from fastapi import FastAPI, HTTPException, Request, Response\n')
  .replace('from pydantic import BaseModel\n', 'from prometheus_client import CONTENT_TYPE_LATEST, Histogram, generate_latest\nfrom pydantic import BaseModel\n')
  .replace('HOST = socket.gethostname()\n', `HOST = socket.gethostname()

# Prometheus metrics: how long each request took, by method, route and status.
REQUEST_SECONDS = Histogram(
    "http_request_duration_seconds", "HTTP request duration in seconds", ["method", "route", "status"]
)


@app.middleware("http")
async def measure(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    route = getattr(request.scope.get("route"), "path", "unmatched")
    REQUEST_SECONDS.labels(request.method, route, str(response.status_code)).observe(time.perf_counter() - start)
    return response


@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
`);

PY.requirements8 = `fastapi
uvicorn[standard]
psycopg[binary,pool]
redis
prometheus_client
`;

GO.s8 = GO.s7
  .replace('\t"github.com/redis/go-redis/v9"\n', '\t"github.com/prometheus/client_golang/prometheus"\n\t"github.com/prometheus/client_golang/prometheus/promhttp"\n\t"github.com/redis/go-redis/v9"\n')
  .replace('func main() {', `// Prometheus metrics: how long each request took, by method, route and status.
var httpDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
	Name:    "http_request_duration_seconds",
	Help:    "HTTP request duration in seconds",
	Buckets: prometheus.DefBuckets,
}, []string{"method", "route", "status"})

func init() { prometheus.MustRegister(httpDuration) }

// statusRecorder remembers the status code a handler wrote.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// instrument wraps the router and measures every request.
func instrument(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		route := r.Pattern // e.g. "GET /products/{id}", set by the router
		if route == "" {
			route = "unmatched"
		}
		httpDuration.WithLabelValues(r.Method, route, strconv.Itoa(rec.status)).Observe(time.Since(start).Seconds())
	})
}

func main() {`)
  .replace('\tlog.Println("listening on http://localhost:3000")\n\tlog.Fatal(http.ListenAndServe(":3000", nil))', '\thttp.Handle("GET /metrics", promhttp.Handler())\n\n\tlog.Println("listening on http://localhost:3000")\n\tlog.Fatal(http.ListenAndServe(":3000", instrument(http.DefaultServeMux)))');

// ── Prometheus + Grafana files ───────────────────────────────────────────
const PROMETHEUS_YML = `global:
  scrape_interval: 5s          # collect metrics every 5 seconds

scrape_configs:
  - job_name: app
    # Docker's DNS returns one address per app replica,
    # so Prometheus scrapes every server automatically.
    dns_sd_configs:
      - names: ['app']
        type: A
        port: 3000
`;

const GRAFANA_DATASOURCE = `apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
`;

const GRAFANA_PROVIDER = `apiVersion: 1
providers:
  - name: my-system
    folder: My system
    type: file
    options:
      path: /var/lib/grafana/dashboards
`;

const panel = (id, title, x, y, expr, legend, unit) => ({
  id, type: 'timeseries', title,
  gridPos: { x, y, w: 12, h: 8 },
  datasource: { type: 'prometheus', uid: 'prometheus' },
  fieldConfig: { defaults: { unit }, overrides: [] },
  targets: [{ refId: 'A', expr, legendFormat: legend }],
});

const GRAFANA_DASHBOARD = JSON.stringify({
  uid: 'my-system',
  title: 'My system',
  schemaVersion: 39,
  refresh: '5s',
  time: { from: 'now-15m', to: 'now' },
  panels: [
    panel(1, 'Requests per second by route', 0, 0, 'sum by (route) (rate(http_request_duration_seconds_count[1m]))', '{{route}}', 'reqps'),
    panel(2, 'p95 latency', 12, 0, 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[1m])))', 'p95', 's'),
    panel(3, 'Requests per second by server', 0, 8, 'sum by (instance) (rate(http_request_duration_seconds_count[1m]))', '{{instance}}', 'reqps'),
    panel(4, 'Error responses per second (4xx / 5xx)', 12, 8, 'sum by (status) (rate(http_request_duration_seconds_count{status=~"4..|5.."}[1m]))', '{{status}}', 'reqps'),
  ],
}, null, 2) + '\n';

// ── Terraform / OpenTofu files ({{tf}} becomes terraform or tofu) ────────
const IAC_MAIN = `# The same system as docker-compose.yml, described as code.
# Works with Terraform and OpenTofu: the language (HCL) is the same.

terraform {
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"   # manages containers on your local Docker
      version = "~> 3.0"
    }
  }
}

provider "docker" {}

# ── Inputs you can change without touching the rest ──
variable "app_replicas" {
  description = "How many app servers to run behind NGINX"
  type        = number
  default     = 3
}

variable "worker_command" {
  description = "Command that starts the queue worker"
  type        = list(string)
}

variable "db_password" {
  type      = string
  default   = "dev"
  sensitive = true
}

variable "public_port" {
  type    = number
  default = 8081
}

locals {
  app_dir = abspath("\${path.module}/../app")
  env = [
    "DATABASE_URL=postgres://postgres:\${var.db_password}@iac-db:5432/shop",
    "REDIS_URL=redis://iac-redis:6379",
  ]
}

resource "docker_network" "shop" {
  name = "shop-iac"
}

# ── Images ──
resource "docker_image" "app" {
  name = "my-system-app:iac"
  build {
    context = local.app_dir
  }
  # Rebuild when any source file in app/ changes.
  triggers = {
    code = sha1(join("", [for f in fileset(local.app_dir, "*.{ts,js,py,go,json,mod,sum,txt}") : filesha1("\${local.app_dir}/\${f}")]))
  }
}

resource "docker_image" "postgres" {
  name         = "postgres:16"
  keep_locally = true
}

resource "docker_image" "redis" {
  name         = "redis:7"
  keep_locally = true
}

resource "docker_image" "nginx" {
  name         = "nginx:1.27"
  keep_locally = true
}

# ── Database and Redis ──
resource "docker_container" "db" {
  name  = "iac-db"
  image = docker_image.postgres.image_id
  env   = ["POSTGRES_PASSWORD=\${var.db_password}", "POSTGRES_DB=shop"]

  networks_advanced {
    name = docker_network.shop.name
  }
  volumes {
    host_path      = abspath("\${path.module}/../schema.sql")
    container_path = "/docker-entrypoint-initdb.d/01-schema.sql"
    read_only      = true
  }
  volumes {
    host_path      = abspath("\${path.module}/../schema-orders.sql")
    container_path = "/docker-entrypoint-initdb.d/02-orders.sql"
    read_only      = true
  }
  healthcheck {
    test     = ["CMD-SHELL", "pg_isready -U postgres"]
    interval = "2s"
    retries  = 15
  }
  wait = true   # apply waits until the healthcheck passes
}

resource "docker_container" "redis" {
  name  = "iac-redis"
  image = docker_image.redis.image_id
  networks_advanced {
    name = docker_network.shop.name
  }
}

# ── App servers: count = var.app_replicas ──
resource "docker_container" "app" {
  count = var.app_replicas
  name  = "iac-app-\${count.index}"
  image = docker_image.app.image_id
  env   = local.env

  networks_advanced {
    name = docker_network.shop.name
  }
  depends_on = [docker_container.db, docker_container.redis]
}

resource "docker_container" "worker" {
  name    = "iac-worker"
  image   = docker_image.app.image_id
  command = var.worker_command
  env     = local.env

  networks_advanced {
    name = docker_network.shop.name
  }
  depends_on = [docker_container.db, docker_container.redis]
}

# ── NGINX, configured from a template that lists every app server ──
resource "docker_container" "nginx" {
  name  = "iac-nginx"
  image = docker_image.nginx.image_id

  ports {
    internal = 80
    external = var.public_port
  }
  networks_advanced {
    name = docker_network.shop.name
  }
  upload {
    file    = "/etc/nginx/nginx.conf"
    content = templatefile("\${path.module}/nginx.conf.tftpl", { servers = docker_container.app[*].name })
  }
}

output "url" {
  value = "http://localhost:\${var.public_port}"
}

output "app_servers" {
  value = docker_container.app[*].name
}
`;

const IAC_NGINX_TPL = `events {}

http {
  upstream app_servers {
%{ for s in servers ~}
    server \${s}:3000 max_fails=3 fail_timeout=10s;
%{ endfor ~}
  }

  server {
    listen 80;
    location / {
      proxy_pass http://app_servers;
      proxy_set_header Host $host;
    }
  }
}
`;

const tfvars = (cmd) => `# Values for the variables in main.tf
app_replicas   = 3
worker_command = ${cmd}
`;

// ── Which file belongs to which language ─────────────────────────────────
const APP_FILE = { express: 'app/server.ts', fastify: 'app/server.ts', python: 'app/main.py', go: 'app/main.go' };
const CODE = { express: EXPRESS, fastify: FASTIFY, python: PY, go: GO };
const appFiles = (version, note) => Object.keys(APP_FILE).map((lang) => ({ path: APP_FILE[lang], lang, code: CODE[lang][version], note }));
const bugFiles = () => Object.keys(APP_FILE).map((lang) => ({ path: APP_FILE[lang], lang, code: CODE[lang].s5bug, note: 'step 1: the stateful version (the bug)', tag: 'bug' }));
const WORKER_CMD = { ts: '["node", "worker.ts"]', python: '["python", "worker.py"]', go: '["worker"]' };
const perLangCompose = (opts) => [
  { path: 'docker-compose.yml', lang: 'ts', code: compose({ ...opts, worker: opts.worker && WORKER_CMD.ts }) },
  { path: 'docker-compose.yml', lang: 'python', code: compose({ ...opts, worker: opts.worker && WORKER_CMD.python }) },
  { path: 'docker-compose.yml', lang: 'go', code: compose({ ...opts, worker: opts.worker && WORKER_CMD.go }) },
];

// ── The stations ─────────────────────────────────────────────────────────
export const STEPS = [
  {
    id: 'hello',
    title: 'Your first server',
    short: 'Server',
    goal: 'Run one web server on your laptop that answers HTTP requests, then measure how many requests per second it handles.',
    why: 'Every system starts here: one process, one port, one machine. Knowing its baseline speed tells you when you will need to scale.',
    concepts: ['server', 'api', 'cpu', 'rps', 'latency', 'p95'],
    patterns: ['client-server', 'single-server'],
    sim: { users: 200 },
    tasks: [
      'Create the folder my-system/app and the server file',
      'Start the server and open http://localhost:3000',
      'Install k6 and run the smoke load test',
      'Write down the requests/s and p95 latency you got',
    ],
    files: [
      ...appFiles('s1'),
      { path: 'app/tsconfig.json', lang: 'ts', code: TS.tsconfig, note: 'only for type checking' },
      { path: 'app/requirements.txt', lang: 'python', code: PY.requirements1 },
      { path: 'loadtest/smoke.js', lang: 'any', code: K6_SMOKE, note: 'k6 load test, same for every language' },
    ],
    run: {
      any: ['mkdir -p my-system/app my-system/loadtest', 'cd my-system/app'],
      ts: ['node -v        # needs Node 22.18+ or 24 (runs .ts files directly)', 'npm init -y', 'npm pkg set type=module scripts.start="node server.ts" scripts.typecheck="tsc --noEmit"'],
      express: ['npm install express@5', 'npm install -D typescript @types/node @types/express', 'npm run typecheck', 'npm start'],
      fastify: ['npm install fastify@5', 'npm install -D typescript @types/node', 'npm run typecheck', 'npm start'],
      python: ['python3 -m venv .venv && source .venv/bin/activate', 'pip install -r requirements.txt', 'uvicorn main:app --reload --port 3000'],
      go: ['go version        # needs Go 1.25 or newer (the Postgres driver requires it)', 'go mod init mysystem', 'go run .'],
    },
    verify: [
      'curl http://localhost:3000/',
      'brew install k6        # or: winget install k6, or see k6.io/docs',
      'k6 run ../loadtest/smoke.js',
    ],
    expect: 'You see {"hello":"world", …}. k6 prints http_reqs (requests per second) and http_req_duration p(95).',
    breaks: 'Data disappears when the process stops, and there is nowhere to store products or users. Next: a real database.',
  },
  {
    id: 'database',
    title: 'Add a database',
    short: 'Database',
    goal: 'Run PostgreSQL in Docker, load 10,000 products, and read them through a connection pool.',
    why: 'Data must outlive the app process. A database stores it safely, and a connection pool avoids opening a new DB connection for every request.',
    concepts: ['database', 'pool', 'readwrite', 'latency'],
    patterns: ['two-tier', 'connection-pooling'],
    sim: { users: 1500 },
    tasks: [
      'Install Docker Desktop (or Docker Engine) if you do not have it',
      'Start Postgres and load schema.sql',
      'Update the server to read /products/:id from the database',
      'Fetch a product and load-test /products/42',
    ],
    files: [
      { path: 'schema.sql', lang: 'any', code: SCHEMA, note: 'in my-system/, used by Docker from the next station on' },
      ...appFiles('s2'),
      { path: 'app/requirements.txt', lang: 'python', code: PY.requirements },
    ],
    run: {
      any: [
        'cd my-system',
        'docker run --name pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=shop -p 5432:5432 -d postgres:16',
        'docker exec -i pg psql -U postgres -d shop < schema.sql',
        'cd app',
      ],
      ts: ['npm install pg', 'npm install -D @types/pg', 'npm run typecheck', 'npm start'],
      python: ['pip install -r requirements.txt', 'uvicorn main:app --reload --port 3000'],
      go: ['go mod tidy        # reads the imports in main.go and downloads pgx + everything it needs', 'go run .'],
    },
    verify: [
      'curl http://localhost:3000/products/42',
      'k6 run -e TARGET=http://localhost:3000/products/42 ../loadtest/smoke.js',
    ],
    expect: 'Product 42 comes back as JSON. Compare requests/s with station 1: every request now also waits for the database.',
    breaks: '“Works on my machine”: the app and database are set up by hand and can’t easily be copied or scaled. Next: containers.',
  },
  {
    id: 'containers',
    title: 'Package it with Docker Compose',
    short: 'Containers',
    goal: 'Put the app in a container and start app + database together with one command.',
    why: 'Containers make every copy of your server identical. That is the foundation for running many copies later (horizontal scaling) and for deploying anywhere.',
    concepts: ['server', 'database', 'horizontal'],
    patterns: ['two-tier', 'n-tier'],
    sim: { users: 1500 },
    tasks: [
      'Stop the hand-started Postgres: docker rm -f pg',
      'Add the Dockerfile and .dockerignore to app/, and docker-compose.yml to my-system/',
      'Start everything with docker compose up --build',
      'Check that /products/42 still works',
    ],
    files: [
      { path: 'app/Dockerfile', lang: 'ts', code: TS.dockerfile },
      { path: 'app/Dockerfile', lang: 'python', code: PY.dockerfile },
      { path: 'app/Dockerfile', lang: 'go', code: GO.dockerfile },
      { path: 'app/.dockerignore', lang: 'ts', code: 'node_modules\nnpm-debug.log\n', note: 'keeps your local node_modules out of the image' },
      { path: 'app/.dockerignore', lang: 'python', code: '.venv\n__pycache__\n', note: 'keeps your local virtualenv out of the image' },
      { path: 'docker-compose.yml', lang: 'any', code: compose(), note: 'in my-system/' },
    ],
    run: { any: ['docker rm -f pg', 'cd my-system', 'docker compose up --build'] },
    verify: ['curl http://localhost:3000/products/42', 'docker compose ps'],
    expect: 'Two containers are running: app and db. The database is created and filled automatically from schema.sql.',
    breaks: 'Still one app server: if it is busy or crashes, everyone waits or sees errors. Next: many servers behind a load balancer.',
  },
  {
    id: 'scale-out',
    title: 'Reverse proxy + load balancer',
    short: 'Load balancer',
    goal: 'Put NGINX in front, run 3 copies of the app, and watch requests spread across them.',
    why: 'Horizontal scaling: instead of one bigger server, run several identical ones. The reverse proxy is the single front door that balances traffic and compresses responses.',
    concepts: ['reverse-proxy', 'lb', 'roundrobin', 'horizontal', 'healthcheck'],
    patterns: ['reverse-proxy', 'load-balancer', 'horizontal-scaling'],
    sim: { users: 4000, lb: true, servers: 3, proxy: true, sessions: 'shared' },
    tasks: [
      'Add nginx/nginx.conf',
      'Replace docker-compose.yml (the app no longer publishes port 3000; NGINX listens on 8080)',
      'Start 3 replicas with --scale app=3',
      'Call the API several times and see different "server" names',
    ],
    files: [
      { path: 'nginx/nginx.conf', lang: 'any', code: NGINX_BASIC },
      { path: 'docker-compose.yml', lang: 'any', code: compose({ proxy: true }) },
    ],
    run: { any: ['docker compose down', 'docker compose up -d --build --scale app=3'] },
    verify: [
      'for i in 1 2 3 4 5 6; do curl -s http://localhost:8080/; echo; done',
      'k6 run -e TARGET=http://localhost:8080/products/42 loadtest/smoke.js',
    ],
    expect: 'The "server" value changes between requests: NGINX takes turns (round robin). If you scale later, run docker compose restart nginx so it sees the new replicas.',
    breaks: 'Anything a server keeps in its own memory now differs per replica. Next: see that bug with your own eyes, then fix it.',
  },
  {
    id: 'stateless',
    title: 'Find the state bug, then go stateless',
    short: 'Stateless',
    goal: 'Add a visit counter kept in memory and watch it break across 3 servers. Then move it to Redis so every server shares it.',
    why: 'This is the classic scaling bug behind “users randomly get logged out”. Stateless servers keep shared data (sessions, counters, carts) in a shared store.',
    concepts: ['state', 'stateful', 'stateless', 'session', 'session-shared', 'session-memory'],
    patterns: ['stateless'],
    sim: { users: 4000, lb: true, servers: 3, proxy: true, sessions: 'memory' },
    tasks: [
      'Add the in-memory /visit endpoint (the “bug” snippet), rebuild, call it 6 times',
      'Notice the count jumps around: each server counts on its own',
      'Replace the server file with the Redis version and the new docker-compose.yml',
      'Rebuild: the count now goes 1, 2, 3, 4… whichever server answers',
    ],
    files: [
      ...bugFiles(),
      ...appFiles('s5', 'step 2: the stateless fix (full file)'),
      { path: 'docker-compose.yml', lang: 'any', code: compose({ proxy: true, redis: true }) },
    ],
    run: {
      any: ['# 1) the bug: after adding the snippet', 'docker compose up -d --build --scale app=3', 'docker compose restart nginx'],
      ts: ['# 2) the fix: after replacing server.ts and docker-compose.yml', 'cd app && npm install redis && npm run typecheck && cd ..'],
      python: ['# 2) the fix: after replacing main.py and docker-compose.yml (redis is already in requirements.txt)'],
      go: ['# 2) the fix: after replacing main.go and docker-compose.yml', 'cd app && go mod tidy && cd ..        # adds go-redis from the new imports'],
      after: ['docker compose up -d --build --scale app=3', 'docker compose restart nginx'],
    },
    verify: ['for i in 1 2 3 4 5 6; do curl -s http://localhost:8080/visit/alice; echo; done'],
    expect: 'Bug: visits go 1, 1, 1, 2, 2, 2 as requests rotate. Fixed: 1, 2, 3, 4, 5, 6 no matter which server answers.',
    breaks: 'Every product request still hits Postgres, even for the same popular products. Next: a cache.',
  },
  {
    id: 'cache',
    title: 'Cache hot reads in Redis',
    short: 'Cache',
    goal: 'Use the cache-aside pattern so repeated product reads come from memory instead of the database.',
    why: 'Most traffic is reads of the same data. A cache answers in under a millisecond and protects the database, which is the hardest part to scale.',
    concepts: ['cache', 'hitrate', 'workingset', 'readwrite'],
    patterns: ['cache-aside', 'cache-write'],
    sim: { users: 12000, lb: true, servers: 3, proxy: true, sessions: 'shared', cache: true, cacheGb: 8 },
    tasks: [
      'Replace the server file with the cached version',
      'Rebuild and call /products/42 twice: first “miss”, then “hit”',
      'Load-test again and compare with station 4',
      'Watch the database go quiet: docker compose stats (or docker stats)',
    ],
    files: appFiles('s6'),
    run: { any: ['docker compose up -d --build --scale app=3', 'docker compose restart nginx'] },
    verify: [
      'curl -s http://localhost:8080/products/42; echo',
      'curl -s http://localhost:8080/products/42; echo',
      'k6 run -e TARGET=http://localhost:8080/products/42 loadtest/smoke.js',
    ],
    expect: 'The first call says "cache":"miss", the second "cache":"hit". Throughput rises and latency drops compared with station 4.',
    breaks: 'Writes are still done while the user waits; a burst of orders would hit the database all at once. Next: a queue and a worker.',
  },
  {
    id: 'queue',
    title: 'Go async with a queue and a worker',
    short: 'Queue',
    goal: 'Accept orders instantly (202 Accepted), put them on a Redis queue, and save them with a separate worker.',
    why: 'Queues turn traffic spikes into a backlog instead of errors, keep slow work out of the request, and let you scale workers separately. Idempotent saving makes retries safe.',
    concepts: ['queue', 'worker', 'backlog', 'idempotency', 'backpressure'],
    patterns: ['message-queue', 'outbox'],
    sim: { users: 12000, lb: true, servers: 3, proxy: true, sessions: 'shared', cache: true, cacheGb: 8, queue: true, workers: 2, readPct: 60 },
    tasks: [
      'Create the orders table (command below)',
      'Replace the server file and add the worker file',
      'Replace docker-compose.yml (it adds a worker service) and rebuild',
      'Place orders, watch the worker log, then stop the worker and see the backlog grow',
    ],
    files: [
      { path: 'schema-orders.sql', lang: 'any', code: SCHEMA_ORDERS, note: 'keep this file: the Terraform station uses it too' },
      ...appFiles('s7'),
      { path: 'app/worker.ts', lang: 'ts', code: TS.worker },
      { path: 'app/worker.py', lang: 'python', code: PY.worker },
      ...perLangCompose({ proxy: true, redis: true, worker: true }),
    ],
    run: {
      ts: ['cd app && npm run typecheck && cd ..'],
      any: [
        'docker compose exec -T db psql -U postgres -d shop < schema-orders.sql',
        'docker compose up -d --build --scale app=3',
        'docker compose restart nginx',
      ],
    },
    verify: [
      'curl -s -X POST http://localhost:8080/orders -H "Content-Type: application/json" -d \'{"product_id": 42, "qty": 2}\'; echo',
      'docker compose logs -f worker',
      'docker compose stop worker      # orders keep being accepted…',
      'docker compose exec redis redis-cli LLEN queue:orders      # …and pile up',
      'docker compose start worker     # the backlog drains',
      'docker compose exec db psql -U postgres -d shop -c "SELECT count(*) FROM orders;"',
    ],
    expect: 'POST returns 202 immediately. With the worker stopped, LLEN grows; after starting it, the queue drains and the orders appear in Postgres.',
    breaks: 'Anyone can flood your API, and you have not yet seen what happens when a server dies mid-traffic. Next: rate limiting and failover.',
  },
  {
    id: 'protect',
    title: 'Rate limiting and failover',
    short: 'Protection',
    goal: 'Make NGINX reject floods with 429, skip dead servers automatically, and prove the site survives a crash.',
    why: 'Real traffic includes bots and buggy clients, and servers die. Limits protect capacity for real users, and health checks plus retries remove single points of failure.',
    concepts: ['ratelimit', 'bot', 'healthcheck', 'spof', 'availability'],
    patterns: ['rate-limiting', 'health-failover'],
    sim: { users: 12000, botPct: 25, lb: true, servers: 3, proxy: true, sessions: 'shared', cache: true, cacheGb: 8, queue: true, workers: 2, gateway: true },
    tasks: [
      'Replace nginx/nginx.conf with the rate-limited version and restart NGINX',
      'Hammer it with k6 and see some 429 responses',
      'Kill one app replica while k6 runs',
      'Confirm the site keeps answering',
    ],
    files: [{ path: 'nginx/nginx.conf', lang: 'any', code: NGINX_LIMITED }],
    run: { any: ['docker compose restart nginx'] },
    verify: [
      'k6 run -e TARGET=http://localhost:8080/products/42 loadtest/smoke.js     # look for non-200 checks',
      'docker compose ps app      # pick one replica name, e.g. my-system-app-2',
      'docker kill my-system-app-2',
      'for i in 1 2 3 4 5 6; do curl -s http://localhost:8080/; echo; done',
      'docker compose up -d --scale app=3      # bring it back',
    ],
    expect: 'k6 shows failed checks: those are 429s from the limiter, protecting the servers. With one replica killed, requests still succeed on the others.',
    breaks: 'You only see numbers when you run k6 yourself, and you cannot tell which part of the system is struggling. Next: metrics and dashboards.',
  },
  {
    id: 'observe',
    title: 'See inside: Prometheus + Grafana',
    short: 'Observability',
    goal: 'Give every server a /metrics endpoint, collect it with Prometheus, and watch live dashboards in Grafana.',
    why: 'You cannot fix what you cannot see. Metrics show requests per second, latency and errors for every server over time. Engineers look at dashboards like this before, during and after every launch.',
    concepts: ['monitoring', 'p95', 'rps', 'errorrate', 'utilization'],
    patterns: ['observability'],
    sim: { users: 12000, lb: true, servers: 3, proxy: true, sessions: 'shared', cache: true, cacheGb: 8, queue: true, workers: 2, gateway: true },
    tasks: [
      'Install the metrics library and replace the server file (it adds /metrics)',
      'Add the Prometheus and Grafana files and the new docker-compose.yml',
      'Start everything and open Grafana at http://localhost:3001',
      'Run a load test and watch the "My system" dashboard move',
    ],
    files: [
      ...appFiles('s8', 'adds request timing + a /metrics endpoint'),
      { path: 'app/requirements.txt', lang: 'python', code: PY.requirements8 },
      { path: 'observability/prometheus.yml', lang: 'any', code: PROMETHEUS_YML },
      { path: 'observability/grafana/provisioning/datasources/prometheus.yml', lang: 'any', code: GRAFANA_DATASOURCE, note: 'connects Grafana to Prometheus automatically' },
      { path: 'observability/grafana/provisioning/dashboards/dashboards.yml', lang: 'any', code: GRAFANA_PROVIDER, note: 'tells Grafana where dashboards live' },
      { path: 'observability/grafana/dashboards/my-system.json', lang: 'any', code: GRAFANA_DASHBOARD, note: 'the ready-made dashboard' },
      ...perLangCompose({ proxy: true, redis: true, worker: true, observability: true }),
    ],
    run: {
      ts: ['cd app && npm install prom-client && npm run typecheck && cd ..'],
      go: ['cd app && go mod tidy && cd ..        # adds the Prometheus client library'],
      any: ['docker compose up -d --build --scale app=3', 'docker compose restart nginx'],
    },
    verify: [
      'curl -s http://localhost:8080/metrics | grep http_request_duration_seconds_count',
      'open http://localhost:9090/targets      # Prometheus: 3 app targets, all UP',
      'open http://localhost:3001              # Grafana → Dashboards → My system → My system',
      'k6 run -e TARGET=http://localhost:8080/products/42 loadtest/smoke.js',
    ],
    expect: 'Prometheus lists one target per app replica. In Grafana the dashboard shows requests per second by route and by server, p95 latency and error responses, updating every 5 seconds. (Grafana has login disabled here: fine on your laptop, never in production.)',
    breaks: 'You can see the system now, but you still do not know its limit. Next: push it until it breaks, with Grafana open.',
  },
  {
    id: 'breaking-point',
    title: 'Load-test to the breaking point',
    short: 'Breaking point',
    goal: 'Ramp traffic from 50 to 500 virtual users while watching Grafana and docker stats, and find which part gives out first.',
    why: 'This is what engineers really do before a launch: measure, find the bottleneck, fix it, measure again. Compare your results with the Simulator.',
    concepts: ['bottleneck', 'utilization', 'p95', 'errorrate', 'rps'],
    patterns: ['observability', 'autoscaling'],
    sim: { users: 20000, lb: true, servers: 3, proxy: true, sessions: 'shared', cache: true, cacheGb: 8, queue: true, workers: 2, pattern: 'ramp' },
    tasks: [
      'Temporarily raise or remove the NGINX rate limit (otherwise you only test the limiter)',
      'Run the ramp test with Grafana and docker stats open',
      'Note the user count where errors or p95 latency jump',
      'Change one thing (replicas, cache TTL, pool size), run again and compare',
    ],
    files: [{ path: 'loadtest/ramp.js', lang: 'any', code: K6_RAMP }],
    run: { any: ['docker stats      # in a second terminal'] },
    verify: ['k6 run loadtest/ramp.js', 'docker compose up -d --scale app=5 && docker compose restart nginx', 'k6 run loadtest/ramp.js'],
    expect: 'At some point http_req_failed or p(95) crosses the thresholds and k6 marks them ✗. Grafana shows exactly when latency climbed, and docker stats shows which container sat at 100% CPU: that is your bottleneck.',
    breaks: 'Your whole setup lives in hand-edited files and commands. Recreating it, or changing its size, means repeating steps by hand. Next: describe the infrastructure as code.',
  },
  {
    id: 'iac',
    title: 'Infrastructure as code: Terraform or OpenTofu',
    short: 'Infra as code',
    iac: true,
    goal: 'Describe the whole stack (network, Postgres, Redis, N app servers, worker, NGINX) in code, then create, resize and destroy it with plan and apply.',
    why: 'In real companies infrastructure is never clicked together by hand. It lives in reviewed, versioned code. You change a number, preview the change with plan, and apply it. This station uses your local Docker, so no cloud account is needed; the same workflow drives AWS, GCP or Azure.',
    concepts: ['iac', 'horizontal', 'spof'],
    patterns: ['horizontal-scaling', 'cell-based'],
    sim: { users: 20000, lb: true, servers: 3, proxy: true, sessions: 'shared', cache: true, cacheGb: 8, queue: true, workers: 2 },
    tasks: [
      'Install {{TOOL}} and stop the Compose stack (docker compose down)',
      'Add the infra/ files, then run {{tf}} init and {{tf}} plan',
      'Run {{tf}} apply and call http://localhost:8081',
      'Change app_replicas to 5, plan and apply again; then delete a container by hand and watch plan detect the drift',
      'Finish with {{tf}} destroy',
    ],
    files: [
      { path: 'infra/main.tf', lang: 'any', code: IAC_MAIN, note: 'identical for Terraform and OpenTofu' },
      { path: 'infra/nginx.conf.tftpl', lang: 'any', code: IAC_NGINX_TPL, note: 'NGINX config generated from the list of app servers' },
      { path: 'infra/terraform.tfvars', lang: 'ts', code: tfvars(WORKER_CMD.ts) },
      { path: 'infra/terraform.tfvars', lang: 'python', code: tfvars(WORKER_CMD.python) },
      { path: 'infra/terraform.tfvars', lang: 'go', code: tfvars(WORKER_CMD.go) },
    ],
    run: {
      any: [
        '{{INSTALL}}',
        'docker compose down',
        'cd infra',
        '{{tf}} init        # downloads the Docker provider',
        '{{tf}} plan        # preview: what will be created?',
        '{{tf}} apply       # type "yes" to create it',
      ],
    },
    verify: [
      'for i in 1 2 3 4 5 6; do curl -s http://localhost:8081/; echo; done',
      '{{tf}} apply -var app_replicas=5      # plan shows 2 servers to add, NGINX to update',
      'docker rm -f iac-app-1                 # someone deletes a server by hand…',
      '{{tf}} plan                            # …and plan detects the drift',
      '{{tf}} apply                           # put it back',
      '{{tf}} destroy                         # remove everything',
    ],
    expect: 'apply creates the containers and prints the url output; requests rotate across iac-app-0, 1, 2. Changing app_replicas only adds or removes what is needed. plan always shows exactly what will change before anything happens. The state file (terraform.tfstate) is how the tool remembers what it created.',
    breaks: null,
  },
  {
    id: 'next',
    title: 'Next stops: grow it further',
    short: 'Next stops',
    goal: 'Pick the next bottleneck you found and explore the pattern that removes it.',
    why: 'From here, growth is about the data layer and geography. Each idea below is a pattern on the Network Map, and most can be tried in the Simulator first.',
    concepts: ['replica', 'shard', 'cdn', 'autoscale', 'region', 'breaker'],
    patterns: ['read-replicas', 'connection-pooling', 'sharding', 'cdn', 'circuit-breaker', 'autoscaling', 'multi-region'],
    sim: { users: 300000, regions: 2, lb: true, lbNodes: 2, servers: 10, vcpu: 8, ram: 16, proxy: true, sessions: 'shared', cache: true, cacheGb: 64, queue: true, workers: 16, replicas: 2, pooler: true, cdn: true, gateway: true, breaker: true, dbVcpu: 16, dbRam: 64 },
    tasks: [
      'Database too busy with reads? Add a Postgres read replica and send SELECTs to it',
      'Too many DB connections? Put PgBouncer between the app and Postgres',
      'Static files and far-away users? Put a CDN (e.g. Cloudflare) in front',
      'Writes outgrow one database? Read about sharding, then try it in the Simulator',
      'Ready for the cloud? Point your Terraform/OpenTofu code at a real provider (AWS, GCP, Azure)',
    ],
    files: [],
    run: {},
    verify: [],
    expect: 'There is no single right order: measure first, then fix the biggest bottleneck. That loop is system design.',
    breaks: null,
  },
];

// Terraform vs OpenTofu wording used in the IaC station.
export const IAC_TOOLS = [
  { id: 'terraform', label: 'Terraform', cmd: 'terraform', install: 'brew tap hashicorp/tap && brew install hashicorp/tap/terraform     # or see developer.hashicorp.com/terraform/install', note: 'By HashiCorp (now part of IBM). The original and most widely used IaC tool; licensed under the Business Source License (BSL) since 2023.' },
  { id: 'opentofu', label: 'OpenTofu', cmd: 'tofu', install: 'brew install opentofu     # or see opentofu.org/docs/intro/install', note: 'An open-source fork of Terraform, created in 2023 and run by the Linux Foundation (MPL-2.0 licence). Same HCL language and providers; the command is tofu.' },
];

// Fills {{tf}}, {{TOOL}} and {{INSTALL}} for the chosen IaC tool.
export function iacText(text, toolId) {
  const t = IAC_TOOLS.find((x) => x.id === toolId) || IAC_TOOLS[0];
  return text.replaceAll('{{tf}}', t.cmd).replaceAll('{{TOOL}}', t.label).replaceAll('{{INSTALL}}', t.install);
}

// Is a file / command group meant for this language?
export function forLang(tag, lang) {
  return tag === 'any' || tag === lang || (tag === 'ts' && (lang === 'express' || lang === 'fastify'));
}
