// "Build Your Own" track: build a real system step by step, in the language
// of your choice. Each station adds one idea and ends with proof it works.
// Files tagged lang 'any' are shared; others show only for that language.

export const LANGS = [
  { id: 'node', label: 'Node.js', sub: 'Express 5', ext: 'js' },
  { id: 'python', label: 'Python', sub: 'FastAPI', ext: 'py' },
  { id: 'go', label: 'Go', sub: 'net/http · Go 1.25+', ext: 'go' },
];

// ── Docker Compose file, grown station by station ────────────────────────
function compose({ proxy = false, redis = false, worker = null } = {}) {
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
  return out.join('\n') + '\n';
}

const WORKER_CMD = { node: '["node", "worker.js"]', python: '["python", "worker.py"]', go: '["worker"]' };

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

// ── Node.js versions of the app ──────────────────────────────────────────
const NODE = {
  s1: `const express = require('express');
const os = require('os');

const app = express();

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  res.json({ hello: 'world', server: os.hostname() });
});

app.listen(3000, () => console.log('listening on http://localhost:3000'));
`,
  s2: `const express = require('express');
const os = require('os');
const { Pool } = require('pg');

const app = express();

// Connection pool: reuse at most 10 open connections to Postgres.
const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:dev@localhost:5432/shop',
  max: 10,
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  res.json({ hello: 'world', server: os.hostname() });
});

app.get('/products/:id', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, price_cents FROM products WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ...rows[0], server: os.hostname() });
});

app.listen(3000, () => console.log('listening on http://localhost:3000'));
`,
  s5bug: `// Add to server.js, above app.listen(...).
// STATEFUL on purpose: each server keeps its own counter in memory.
const visitsInMemory = new Map();

app.get('/visit/:user', (req, res) => {
  const visits = (visitsInMemory.get(req.params.user) || 0) + 1;
  visitsInMemory.set(req.params.user, visits);
  res.json({ user: req.params.user, visits, server: os.hostname() });
});
`,
  s5: `const express = require('express');
const os = require('os');
const { Pool } = require('pg');
const { createClient } = require('redis');

const app = express();

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:dev@localhost:5432/shop',
  max: 10,
});

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (err) => console.error('redis error', err));
redis.connect();

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  res.json({ hello: 'world', server: os.hostname() });
});

app.get('/products/:id', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, price_cents FROM products WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ...rows[0], server: os.hostname() });
});

// STATELESS: the counter lives in Redis, shared by every server.
app.get('/visit/:user', async (req, res) => {
  const visits = await redis.incr('visits:' + req.params.user);
  res.json({ user: req.params.user, visits, server: os.hostname() });
});

app.listen(3000, () => console.log('listening on http://localhost:3000'));
`,
  s6: `const express = require('express');
const os = require('os');
const { Pool } = require('pg');
const { createClient } = require('redis');

const app = express();

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:dev@localhost:5432/shop',
  max: 10,
});

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (err) => console.error('redis error', err));
redis.connect();

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  res.json({ hello: 'world', server: os.hostname() });
});

// Cache-aside: 1) look in Redis  2) on a miss ask Postgres  3) remember it.
app.get('/products/:id', async (req, res) => {
  const key = 'product:' + req.params.id;

  const cached = await redis.get(key);
  if (cached) return res.json({ ...JSON.parse(cached), cache: 'hit', server: os.hostname() });

  const { rows } = await db.query(
    'SELECT id, name, price_cents FROM products WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  await redis.set(key, JSON.stringify(rows[0]), { EX: 60 }); // expires after 60 s
  res.json({ ...rows[0], cache: 'miss', server: os.hostname() });
});

app.get('/visit/:user', async (req, res) => {
  const visits = await redis.incr('visits:' + req.params.user);
  res.json({ user: req.params.user, visits, server: os.hostname() });
});

app.listen(3000, () => console.log('listening on http://localhost:3000'));
`,
  s7: `const express = require('express');
const os = require('os');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createClient } = require('redis');

const app = express();
app.use(express.json());

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:dev@localhost:5432/shop',
  max: 10,
});

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (err) => console.error('redis error', err));
redis.connect();

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  res.json({ hello: 'world', server: os.hostname() });
});

app.get('/products/:id', async (req, res) => {
  const key = 'product:' + req.params.id;

  const cached = await redis.get(key);
  if (cached) return res.json({ ...JSON.parse(cached), cache: 'hit', server: os.hostname() });

  const { rows } = await db.query(
    'SELECT id, name, price_cents FROM products WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  await redis.set(key, JSON.stringify(rows[0]), { EX: 60 });
  res.json({ ...rows[0], cache: 'miss', server: os.hostname() });
});

app.get('/visit/:user', async (req, res) => {
  const visits = await redis.incr('visits:' + req.params.user);
  res.json({ user: req.params.user, visits, server: os.hostname() });
});

// Accept the order instantly and let a worker save it later.
app.post('/orders', async (req, res) => {
  const order = {
    id: crypto.randomUUID(),
    product_id: Number(req.body.product_id),
    qty: Number(req.body.qty || 1),
  };
  if (!order.product_id) return res.status(400).json({ error: 'product_id is required' });

  await redis.lPush('queue:orders', JSON.stringify(order));
  res.status(202).json({ accepted: order.id });
});

app.listen(3000, () => console.log('listening on http://localhost:3000'));
`,
  worker: `const { Pool } = require('pg');
const { createClient } = require('redis');

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:dev@localhost:5432/shop',
  max: 2,
});

async function main() {
  const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redis.connect();
  console.log('worker waiting for jobs');

  while (true) {
    const job = await redis.brPop('queue:orders', 0); // waits until a job arrives
    const order = JSON.parse(job.element);

    // ON CONFLICT DO NOTHING makes this idempotent: a repeated job is harmless.
    await db.query(
      'INSERT INTO orders (id, product_id, qty) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [order.id, order.product_id, order.qty],
    );
    console.log('saved order', order.id);
  }
}

main();
`,
  dockerfile: `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
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

const APP_FILE = { node: 'app/server.js', python: 'app/main.py', go: 'app/main.go' };
const appFiles = (versions, note) => [
  { path: APP_FILE.node, lang: 'node', code: NODE[versions], note },
  { path: APP_FILE.python, lang: 'python', code: PY[versions], note },
  { path: APP_FILE.go, lang: 'go', code: GO[versions], note },
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
      { path: 'app/requirements.txt', lang: 'python', code: PY.requirements1 },
      { path: 'loadtest/smoke.js', lang: 'any', code: K6_SMOKE, note: 'k6 load test, same for every language' },
    ],
    run: {
      any: ['mkdir -p my-system/app my-system/loadtest', 'cd my-system/app'],
      node: ['npm init -y', 'npm install express@5', 'node server.js'],
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
      node: ['npm install pg', 'node server.js'],
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
      'Add the Dockerfile to app/ and docker-compose.yml to my-system/',
      'Start everything with docker compose up --build',
      'Check that /products/42 still works',
    ],
    files: [
      { path: 'app/Dockerfile', lang: 'node', code: NODE.dockerfile },
      { path: 'app/Dockerfile', lang: 'python', code: PY.dockerfile },
      { path: 'app/Dockerfile', lang: 'go', code: GO.dockerfile },
      { path: 'app/.dockerignore', lang: 'node', code: 'node_modules\nnpm-debug.log\n', note: 'keeps your local node_modules out of the image' },
      { path: 'app/.dockerignore', lang: 'python', code: '.venv\n__pycache__\n', note: 'keeps your local virtualenv out of the image' },
      { path: 'docker-compose.yml', lang: 'any', code: compose(), note: 'in my-system/' },
    ],
    run: {
      any: ['docker rm -f pg', 'cd my-system', 'docker compose up --build'],
    },
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
      { path: APP_FILE.node, lang: 'node', code: NODE.s5bug, note: 'step 1: the stateful version (the bug)', tag: 'bug' },
      { path: APP_FILE.python, lang: 'python', code: PY.s5bug, note: 'step 1: the stateful version (the bug)', tag: 'bug' },
      { path: APP_FILE.go, lang: 'go', code: GO.s5bug, note: 'step 1: the stateful version (the bug)', tag: 'bug' },
      ...appFiles('s5', 'step 2: the stateless fix (full file)'),
      { path: 'docker-compose.yml', lang: 'any', code: compose({ proxy: true, redis: true }) },
    ],
    run: {
      node: ['# 1) the bug: after adding the snippet', 'docker compose up -d --build --scale app=3', 'docker compose restart nginx', '# 2) the fix: after replacing server.js and docker-compose.yml', 'cd app && npm install redis && cd ..', 'docker compose up -d --build --scale app=3', 'docker compose restart nginx'],
      python: ['# 1) the bug: after adding the snippet', 'docker compose up -d --build --scale app=3', 'docker compose restart nginx', '# 2) the fix: after replacing main.py and docker-compose.yml (redis is already in requirements.txt)', 'docker compose up -d --build --scale app=3', 'docker compose restart nginx'],
      go: ['# 1) the bug: after adding the snippet', 'docker compose up -d --build --scale app=3', 'docker compose restart nginx', '# 2) the fix: after replacing main.go and docker-compose.yml', 'cd app && go mod tidy && cd ..        # adds go-redis from the new imports', 'docker compose up -d --build --scale app=3', 'docker compose restart nginx'],
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
      { path: 'schema-orders.sql', lang: 'any', code: SCHEMA_ORDERS, note: 'also append it to schema.sql for fresh setups' },
      ...appFiles('s7'),
      { path: 'app/worker.js', lang: 'node', code: NODE.worker },
      { path: 'app/worker.py', lang: 'python', code: PY.worker },
      { path: 'docker-compose.yml', lang: 'node', code: compose({ proxy: true, redis: true, worker: WORKER_CMD.node }) },
      { path: 'docker-compose.yml', lang: 'python', code: compose({ proxy: true, redis: true, worker: WORKER_CMD.python }) },
      { path: 'docker-compose.yml', lang: 'go', code: compose({ proxy: true, redis: true, worker: WORKER_CMD.go }) },
    ],
    run: {
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
    breaks: 'You still don’t know the real limit of what you built. Next: load-test until it breaks.',
  },
  {
    id: 'breaking-point',
    title: 'Load-test to the breaking point',
    short: 'Breaking point',
    goal: 'Ramp traffic from 50 to 500 virtual users, watch CPU and memory, and find which part gives out first.',
    why: 'This is what engineers really do before a launch: measure, find the bottleneck, fix it, measure again. Compare your results with the Simulator.',
    concepts: ['bottleneck', 'utilization', 'p95', 'errorrate', 'rps'],
    patterns: ['observability', 'autoscaling'],
    sim: { users: 20000, lb: true, servers: 3, proxy: true, sessions: 'shared', cache: true, cacheGb: 8, queue: true, workers: 2, pattern: 'ramp' },
    tasks: [
      'Temporarily raise or remove the NGINX rate limit (otherwise you only test the limiter)',
      'Run the ramp test while watching docker stats in a second terminal',
      'Note the user count where errors or p95 latency jump',
      'Change one thing (replicas, cache TTL, pool size), run again and compare',
    ],
    files: [{ path: 'loadtest/ramp.js', lang: 'any', code: K6_RAMP }],
    run: { any: ['docker stats      # in a second terminal'] },
    verify: ['k6 run loadtest/ramp.js', 'docker compose up -d --scale app=5 && docker compose restart nginx', 'k6 run loadtest/ramp.js'],
    expect: 'At some point http_req_failed or p(95) crosses the thresholds and k6 marks them ✗. docker stats shows which container is at 100% CPU: that is your bottleneck.',
    breaks: 'One database still takes every write, and everything runs in one place. Next: the paths real systems take from here.',
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
    ],
    files: [],
    run: {},
    verify: [],
    expect: 'There is no single right order: measure first, then fix the biggest bottleneck. That loop is system design.',
    breaks: null,
  },
];
