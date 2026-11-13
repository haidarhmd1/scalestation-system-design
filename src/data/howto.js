// "How to add this to your project": a step-by-step guide for every change
// made on the Simulator map, in Node.js (Express), Python (FastAPI) or Go.
// The examples use the demo shop's routes (products, orders); adapt the names.

export const GUIDE_RUNTIMES = [
  { id: 'node', label: 'Node.js', file: 'app.js', worker: 'worker.js', install: (p) => `npm install ${p}` },
  { id: 'python', label: 'Python', file: 'main.py', worker: 'worker.py', install: (p) => `pip install ${p}` },
  { id: 'go', label: 'Go', file: 'main.go', worker: 'worker/main.go', install: (p) => `go get ${p}` },
];
export const runtimeFor = (r) => (GUIDE_RUNTIMES.some((x) => x.id === r) ? r : 'node');

// ── What changed on the map ────────────────────────────────────────────────
const TECH_LABEL = {
  redis: 'Redis', valkey: 'Valkey', memcached: 'Memcached', elasticache: 'ElastiCache', dragonfly: 'Dragonfly',
  bullmq: 'BullMQ', rabbitmq: 'RabbitMQ', kafka: 'Kafka', sqs: 'Amazon SQS', pubsub: 'Google Pub/Sub', nats: 'NATS JetStream',
};
const tl = (id) => TECH_LABEL[id] || id;

export function changesBetween(base, cfg) {
  if (!base) return [];
  const out = [];
  const add = (id, label, detail) => out.push({ id, label, detail });
  const bt = base.tech || {};
  const ct = cfg.tech || {};
  if (cfg.cache && !base.cache) add('cache', `Cache (${tl(ct.cache)})`, 'Keep hot reads in memory so most of them skip the database.');
  if (cfg.queue && (!base.queue || bt.queue !== ct.queue)) add('queue', base.queue ? `Queue: ${tl(bt.queue)} → ${tl(ct.queue)}` : `Queue (${tl(ct.queue)}) + workers`, 'Answer writes right away and let workers do the slow part.');
  else if (cfg.queue && base.queue && cfg.workers > base.workers) add('workers', `Workers: ${base.workers} → ${cfg.workers}`, 'More consumers drain the queue faster.');
  if (cfg.servers > base.servers || (cfg.lb && !base.lb)) add('scale-out', `App servers: ${base.servers} → ${cfg.servers}${cfg.lb && !base.lb ? ' + load balancer' : ''}`, 'Run several copies of the app and spread requests over them.');
  if (cfg.proxy && !base.proxy) add('proxy', 'Reverse proxy', 'NGINX in front of the app: compression, timeouts, static files.');
  if (cfg.pooler && !base.pooler) add('pooler', 'Connection pooler', 'PgBouncer shares a few database connections between many app connections.');
  if (cfg.replicas > base.replicas) add('replicas', `Database read replicas: ${base.replicas} → ${cfg.replicas}`, 'Send reads to copies of the database, writes to the primary.');
  if (cfg.shards > base.shards) add('shards', `Database shards: ${base.shards} → ${cfg.shards}`, 'Split the data over several databases by a key.');
  if (cfg.cdn && !base.cdn) add('cdn', 'CDN', 'Serve static files (and cacheable GETs) from edge servers near users.');
  if (cfg.gateway && !base.gateway) add('gateway', 'Rate limiter / API gateway', 'Cap requests per client so bots and bursts cannot take you down.');
  if (cfg.sessions !== base.sessions && cfg.sessions === 'shared') add('sessions', 'Shared sessions', 'Store sessions in Redis (or use tokens) so any server can handle any user.');
  if (cfg.autoscale && !base.autoscale) add('autoscale', 'Auto-scaling', 'Add and remove app servers automatically based on CPU.');
  if (cfg.breaker && !base.breaker) add('breaker', 'Circuit breaker', 'Fail fast when a dependency is down instead of piling up requests.');
  if (cfg.regions > base.regions) add('regions', `Regions: ${base.regions} → ${cfg.regions}`, 'Run the system in more than one region.');
  if (cfg.vcpu !== base.vcpu || cfg.ram !== base.ram) add('resize', `App servers: ${base.vcpu} vCPU / ${base.ram} GB → ${cfg.vcpu} vCPU / ${cfg.ram} GB`, 'Bigger (or smaller) machines for the app.');
  if (cfg.dbVcpu !== base.dbVcpu || cfg.dbRam !== base.dbRam) add('db-size', `Database: ${base.dbVcpu} vCPU / ${base.dbRam} GB → ${cfg.dbVcpu} vCPU / ${cfg.dbRam} GB`, 'A bigger (or smaller) database machine.');
  return out;
}

// Removals have no guide; listing them is enough.
export function removalsBetween(base, cfg) {
  if (!base) return [];
  const names = { cache: 'Cache', queue: 'Queue', lb: 'Load balancer', proxy: 'Reverse proxy', pooler: 'Connection pooler', cdn: 'CDN', gateway: 'Rate limiter', autoscale: 'Auto-scaling', breaker: 'Circuit breaker' };
  return Object.entries(names).filter(([k]) => base[k] && !cfg[k]).map(([, v]) => v);
}

// ── Shared snippets ────────────────────────────────────────────────────────
const sh = (code) => ({ terminal: true, title: 'terminal', code });
const file = (title, code) => ({ title, code });
const pick = (rt, m) => m[rt] ?? m.node;

const verify = (what, expect) => ({
  title: 'Check that it helped',
  text: `Rebuild, run the same load test again and compare with the last result. ${expect}`,
  blocks: [sh(`docker compose up --build -d\nnpx scalestation run --profile standard   # or ▶ Run test in the studio\n${what ? `# ${what}` : ''}`.trim())],
});

// The api service gets new environment variables and waits for the new service.
const composeEnv = (vars, dep) => `  api:   # add these lines to your existing api service\n    environment:\n${vars.map((v) => `      ${v}`).join('\n')}\n    depends_on:\n      ${dep}: { condition: service_started }`;

// ── Guides ─────────────────────────────────────────────────────────────────
const GUIDES = {
  cache: ({ rt, tech }) => {
    const memcached = tech.cache === 'memcached';
    const image = { valkey: 'valkey/valkey:8-alpine', dragonfly: 'docker.dragonflydb.io/dragonflydb/dragonfly' }[tech.cache] || 'redis:7-alpine';
    return {
      intro: `Cache-aside: look in ${memcached ? 'Redis (the code below; Memcached works the same way with a memcached client)' : tl(tech.cache)} first; on a miss, read the database and keep the answer for a short time. Start with the read that is called most and changes least (here: one product).`,
      steps: [
        { title: 'Run the cache next to the app', text: `Add a cache service and tell the app where it is.${tech.cache === 'elasticache' ? ' In production this is your ElastiCache endpoint; locally a Redis container behaves the same.' : ''}`,
          blocks: [file('docker-compose.yml (add)', `services:\n  redis:\n    image: ${image}\n    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]\n${composeEnv(['REDIS_URL: redis://redis:6379'], 'redis')}`)] },
        { title: 'Install the client', blocks: [sh(pick(rt, { node: 'npm install ioredis', python: 'pip install redis', go: 'go get github.com/redis/go-redis/v9' }))] },
        { title: 'Read through the cache', text: 'Hit: answer from memory, no database. Miss: read the database, store the result with a time-to-live (TTL), answer.',
          blocks: [pick(rt, {
            node: file('app.js', `import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

app.get('/api/products/:id', async (req, res) => {
  const key = \`product:\${req.params.id}\`;
  const cached = await redis.get(key);
  if (cached) return res.type('json').send(cached); // hit: no database

  const { rows } = await db.query('SELECT id, name, description, price_cents, stock FROM products WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  await redis.set(key, JSON.stringify(rows[0]), 'EX', 60); // keep it for 60 s
  res.json(rows[0]);
});`),
            python: file('main.py', `import json, os
import redis.asyncio as redis

cache = redis.from_url(os.environ["REDIS_URL"])

@app.get("/api/products/{product_id}")
async def get_product(product_id: int):
    key = f"product:{product_id}"
    if (hit := await cache.get(key)) is not None:
        return json.loads(hit)  # hit: no database

    row = await db.fetchrow("SELECT id, name, description, price_cents, stock FROM products WHERE id = $1", product_id)
    if row is None:
        raise HTTPException(status_code=404)
    product = dict(row)
    await cache.set(key, json.dumps(product), ex=60)  # keep it for 60 s
    return product`),
            go: file('main.go', `import "github.com/redis/go-redis/v9"

var rdb = redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")}) // "redis:6379"

func getProduct(w http.ResponseWriter, r *http.Request) {
	key := "product:" + r.PathValue("id")
	w.Header().Set("Content-Type", "application/json")
	if b, err := rdb.Get(r.Context(), key).Bytes(); err == nil {
		w.Write(b) // hit: no database
		return
	}
	var p Product
	err := db.QueryRow(r.Context(), "SELECT id, name, price_cents FROM products WHERE id = $1", r.PathValue("id")).
		Scan(&p.ID, &p.Name, &p.PriceCents)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	} else if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	b, _ := json.Marshal(p)
	rdb.Set(r.Context(), key, b, time.Minute) // keep it for 60 s
	w.Write(b)
}`),
          })] },
        { title: 'Forget it when the data changes', text: 'Whenever a product is updated, delete its key so the next read loads the new version. The TTL is the safety net if you miss one.',
          blocks: [pick(rt, {
            node: file('app.js', `await db.query('UPDATE products SET price_cents = $1 WHERE id = $2', [price, id]);\nawait redis.del(\`product:\${id}\`);`),
            python: file('main.py', `await db.execute("UPDATE products SET price_cents = $1 WHERE id = $2", price, product_id)\nawait cache.delete(f"product:{product_id}")`),
            go: file('main.go', `db.Exec(ctx, "UPDATE products SET price_cents = $1 WHERE id = $2", price, id)\nrdb.Del(ctx, "product:"+id)`),
          })] },
        verify('hits vs misses: docker compose exec redis redis-cli info stats | grep keyspace', 'The cached endpoint’s p95 should drop to a few ms, and the database does less work. A hit rate under ~80% means the TTL is too short or the keys too specific.'),
      ],
      pitfalls: ['Never cache per-user or secret data under a shared key.', 'A popular key expiring under heavy load sends every request to the database at once (stampede). Add a little random jitter to the TTL.', 'Set maxmemory and an eviction policy, or the cache grows until it is killed.'],
    };
  },

  queue: ({ rt, tech }) => {
    let q = tech.queue;
    let note = '';
    if (q === 'bullmq' && rt !== 'node') { note = `BullMQ is a Node.js library. For ${rt === 'python' ? 'Python' : 'Go'} the closest equivalent is ${rt === 'python' ? 'Celery or RQ on Redis' : 'asynq on Redis'}; the code below uses RabbitMQ, which works the same way.`; q = 'rabbitmq'; }
    if (['sqs', 'pubsub', 'nats'].includes(q)) { note = `${tl(q)} follows the same pattern: the API publishes a message, a worker consumes it and acknowledges it after the write. The code below uses RabbitMQ; swap in the ${tl(q)} client.`; q = 'rabbitmq'; }
    const svc = {
      bullmq: `services:\n  redis:\n    image: redis:7-alpine\n  worker:\n    build: .\n    command: ${pick(rt, { node: '["node", "worker.js"]' })}\n    environment:\n      DATABASE_URL: postgres://shop:shop@postgres:5432/shop\n      REDIS_URL: redis://redis:6379\n    depends_on: [redis, postgres]\n${composeEnv(['REDIS_URL: redis://redis:6379'], 'redis')}`,
      rabbitmq: `services:\n  rabbitmq:\n    image: rabbitmq:4-management   # UI on http://localhost:15672 (guest / guest)\n    ports: ["15672:15672"]\n    healthcheck:\n      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]\n      interval: 5s\n      retries: 20\n  worker:\n    build: .\n    command: ${pick(rt, { node: '["node", "worker.js"]', python: '["python", "worker.py"]', go: '["/app/worker"]' })}\n    environment:\n      DATABASE_URL: postgres://shop:shop@postgres:5432/shop\n      AMQP_URL: amqp://guest:guest@rabbitmq:5672\n    depends_on:\n      rabbitmq: { condition: service_healthy }\n  api:   # add these lines to your existing api service\n    environment:\n      AMQP_URL: amqp://guest:guest@rabbitmq:5672\n    depends_on:\n      rabbitmq: { condition: service_healthy }`,
      kafka: `services:\n  kafka:\n    image: apache/kafka:3.9.1   # one broker, KRaft mode (no ZooKeeper)\n    environment:\n      KAFKA_NODE_ID: 1\n      KAFKA_PROCESS_ROLES: broker,controller\n      KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093\n      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092\n      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER\n      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT\n      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093\n      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1\n      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1\n      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1\n      KAFKA_NUM_PARTITIONS: 3\n  worker:\n    build: .\n    command: ${pick(rt, { node: '["node", "worker.js"]', python: '["python", "worker.py"]', go: '["/app/worker"]' })}\n    restart: on-failure   # retries until Kafka is ready\n    environment:\n      DATABASE_URL: postgres://shop:shop@postgres:5432/shop\n      KAFKA_BROKER: kafka:9092\n    depends_on: [kafka, postgres]\n  api:   # add these lines to your existing api service\n    environment:\n      KAFKA_BROKER: kafka:9092\n    depends_on:\n      kafka: { condition: service_started }`,
    }[q];
    const install = {
      bullmq: { node: 'npm install bullmq ioredis' },
      rabbitmq: { node: 'npm install amqplib', python: 'pip install aio-pika asyncpg', go: 'go get github.com/rabbitmq/amqp091-go' },
      kafka: { node: 'npm install kafkajs', python: 'pip install aiokafka asyncpg', go: 'go get github.com/segmentio/kafka-go' },
    }[q];
    const producer = {
      bullmq: { node: `import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const orders = new Queue('orders', { connection });

app.post('/api/orders', async (req, res) => {
  const order = { productId: Number(req.body?.productId) || 1, qty: Number(req.body?.qty) || 1 };
  const job = await orders.add('create', order, { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
  res.status(202).json({ status: 'queued', jobId: job.id }); // 202 = accepted, not done yet
});` },
      rabbitmq: {
        node: `import amqp from 'amqplib';

const mq = await amqp.connect(process.env.AMQP_URL);
const channel = await mq.createConfirmChannel(); // the broker confirms each message
await channel.assertQueue('orders', { durable: true });

app.post('/api/orders', async (req, res) => {
  const order = { productId: Number(req.body?.productId) || 1, qty: Number(req.body?.qty) || 1 };
  channel.sendToQueue('orders', Buffer.from(JSON.stringify(order)), { persistent: true });
  await channel.waitForConfirms();
  res.status(202).json({ status: 'queued' }); // 202 = accepted, not done yet
});`,
        python: `import json, os
from contextlib import asynccontextmanager
import aio_pika
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app):
    app.state.mq = await aio_pika.connect_robust(os.environ["AMQP_URL"])
    app.state.channel = await app.state.mq.channel()
    await app.state.channel.declare_queue("orders", durable=True)
    yield
    await app.state.mq.close()

app = FastAPI(lifespan=lifespan)

@app.post("/api/orders", status_code=202)
async def create_order(order: dict):
    message = aio_pika.Message(json.dumps(order).encode(), delivery_mode=aio_pika.DeliveryMode.PERSISTENT)
    await app.state.channel.default_exchange.publish(message, routing_key="orders")
    return {"status": "queued"}  # 202 = accepted, not done yet`,
        go: `import amqp "github.com/rabbitmq/amqp091-go"

conn, err := amqp.Dial(os.Getenv("AMQP_URL"))
if err != nil { log.Fatal(err) }
ch, _ := conn.Channel()
ch.QueueDeclare("orders", true, false, false, false, nil) // durable

http.HandleFunc("POST /api/orders", func(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	err := ch.PublishWithContext(r.Context(), "", "orders", false, false, amqp.Publishing{
		ContentType: "application/json", DeliveryMode: amqp.Persistent, Body: body,
	})
	if err != nil { http.Error(w, err.Error(), http.StatusServiceUnavailable); return }
	w.WriteHeader(http.StatusAccepted) // 202 = accepted, not done yet
})`,
      },
      kafka: {
        node: `import { Kafka } from 'kafkajs';

const kafka = new Kafka({ clientId: 'shop-api', brokers: [process.env.KAFKA_BROKER] });
const producer = kafka.producer();
await producer.connect();

app.post('/api/orders', async (req, res) => {
  const order = { productId: Number(req.body?.productId) || 1, qty: Number(req.body?.qty) || 1 };
  // The key decides the partition: orders for one product stay in order.
  await producer.send({ topic: 'orders', messages: [{ key: String(order.productId), value: JSON.stringify(order) }] });
  res.status(202).json({ status: 'queued' }); // 202 = accepted, not done yet
});`,
        python: `import json, os
from contextlib import asynccontextmanager
from aiokafka import AIOKafkaProducer
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app):
    app.state.producer = AIOKafkaProducer(bootstrap_servers=os.environ["KAFKA_BROKER"])
    await app.state.producer.start()
    yield
    await app.state.producer.stop()

app = FastAPI(lifespan=lifespan)

@app.post("/api/orders", status_code=202)
async def create_order(order: dict):
    # The key decides the partition: orders for one product stay in order.
    await app.state.producer.send_and_wait("orders", json.dumps(order).encode(), key=str(order["productId"]).encode())
    return {"status": "queued"}`,
        go: `import "github.com/segmentio/kafka-go"

var orders = &kafka.Writer{
	Addr:                   kafka.TCP(os.Getenv("KAFKA_BROKER")),
	Topic:                  "orders",
	Balancer:               &kafka.Hash{}, // same key → same partition
	AllowAutoTopicCreation: true,
}

http.HandleFunc("POST /api/orders", func(w http.ResponseWriter, r *http.Request) {
	var o Order
	if err := json.NewDecoder(r.Body).Decode(&o); err != nil { http.Error(w, err.Error(), 400); return }
	body, _ := json.Marshal(o)
	err := orders.WriteMessages(r.Context(), kafka.Message{Key: []byte(strconv.Itoa(o.ProductID)), Value: body})
	if err != nil { http.Error(w, err.Error(), http.StatusServiceUnavailable); return }
	w.WriteHeader(http.StatusAccepted)
})`,
      },
    }[q];
    const worker = {
      bullmq: { node: `import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pg from 'pg';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

new Worker('orders', async (job) => {
  await db.query('INSERT INTO orders (product_id, qty) VALUES ($1, $2)', [job.data.productId, job.data.qty]);
}, { connection, concurrency: 10 }); // a failed job is retried (attempts: 5)` },
      rabbitmq: {
        node: `import amqp from 'amqplib';
import pg from 'pg';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const mq = await amqp.connect(process.env.AMQP_URL);
const channel = await mq.createChannel();
await channel.assertQueue('orders', { durable: true });
channel.prefetch(10); // at most 10 unacknowledged messages at a time

channel.consume('orders', async (msg) => {
  const order = JSON.parse(msg.content.toString());
  try {
    await db.query('INSERT INTO orders (product_id, qty) VALUES ($1, $2)', [order.productId, order.qty]);
    channel.ack(msg); // only now is the message removed
  } catch (err) {
    console.error(err.message);
    channel.nack(msg, false, true); // put it back and retry
  }
});`,
        python: `import asyncio, json, os
import aio_pika, asyncpg

async def main():
    db = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    mq = await aio_pika.connect_robust(os.environ["AMQP_URL"])
    channel = await mq.channel()
    await channel.set_qos(prefetch_count=10)
    queue = await channel.declare_queue("orders", durable=True)
    async with queue.iterator() as messages:
        async for message in messages:
            async with message.process(requeue=True):  # ack on success, requeue on error
                order = json.loads(message.body)
                await db.execute("INSERT INTO orders (product_id, qty) VALUES ($1, $2)", order["productId"], order["qty"])

asyncio.run(main())`,
        go: `func main() {
	ctx := context.Background()
	db, _ := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	conn, err := amqp.Dial(os.Getenv("AMQP_URL"))
	if err != nil { log.Fatal(err) }
	ch, _ := conn.Channel()
	ch.QueueDeclare("orders", true, false, false, false, nil)
	ch.Qos(10, 0, false)
	msgs, _ := ch.Consume("orders", "", false, false, false, false, nil) // manual ack

	for d := range msgs {
		var o Order
		json.Unmarshal(d.Body, &o)
		if _, err := db.Exec(ctx, "INSERT INTO orders (product_id, qty) VALUES ($1, $2)", o.ProductID, o.Qty); err != nil {
			log.Println(err)
			d.Nack(false, true) // put it back and retry
			continue
		}
		d.Ack(false)
	}
}`,
      },
      kafka: {
        node: `import { Kafka } from 'kafkajs';
import pg from 'pg';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const kafka = new Kafka({ clientId: 'order-writer', brokers: [process.env.KAFKA_BROKER] });

const admin = kafka.admin();
await admin.connect();
await admin.createTopics({ topics: [{ topic: 'orders', numPartitions: 3 }] }); // no-op if it exists
await admin.disconnect();

// Every worker in the same group gets its own share of the partitions.
const consumer = kafka.consumer({ groupId: 'order-writers' });
await consumer.connect();
await consumer.subscribe({ topic: 'orders', fromBeginning: true });
await consumer.run({
  eachMessage: async ({ message }) => {
    const order = JSON.parse(message.value.toString());
    await db.query('INSERT INTO orders (product_id, qty) VALUES ($1, $2)', [order.productId, order.qty]);
  }, // the offset is committed after this returns; a throw means it is retried
});`,
        python: `import asyncio, json, os
import asyncpg
from aiokafka import AIOKafkaConsumer

async def main():
    db = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    consumer = AIOKafkaConsumer(
        "orders", bootstrap_servers=os.environ["KAFKA_BROKER"],
        group_id="order-writers", enable_auto_commit=False, auto_offset_reset="earliest",
    )
    await consumer.start()
    try:
        async for msg in consumer:
            order = json.loads(msg.value)
            await db.execute("INSERT INTO orders (product_id, qty) VALUES ($1, $2)", order["productId"], order["qty"])
            await consumer.commit()  # only after the write
    finally:
        await consumer.stop()

asyncio.run(main())`,
        go: `func main() {
	ctx := context.Background()
	db, _ := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	rd := kafka.NewReader(kafka.ReaderConfig{
		Brokers: []string{os.Getenv("KAFKA_BROKER")},
		GroupID: "order-writers", // workers in one group share the partitions
		Topic:   "orders",
	})
	for {
		m, err := rd.FetchMessage(ctx)
		if err != nil { log.Fatal(err) }
		var o Order
		json.Unmarshal(m.Value, &o)
		if _, err := db.Exec(ctx, "INSERT INTO orders (product_id, qty) VALUES ($1, $2)", o.ProductID, o.Qty); err != nil {
			log.Println(err) // not committed: read again after a restart
			continue
		}
		rd.CommitMessages(ctx, m)
	}
}`,
      },
    }[q];
    const R = GUIDE_RUNTIMES.find((x) => x.id === rt);
    return {
      intro: `${note ? `${note} ` : ''}The API stops writing orders itself. It puts each order on ${tl(q)} and answers 202 Accepted right away; a separate worker process reads the messages and writes them to the database at its own pace. Spikes fill the queue instead of the database.`,
      steps: [
        { title: `Run ${tl(q)} and a worker`, text: `The worker is the same image as the app with another start command. ${pick(rt, { node: 'Make sure the Dockerfile copies worker.js too (COPY . .).', python: 'Make sure the Dockerfile copies worker.py too (COPY . .).', go: 'Build the worker as a second binary in the Dockerfile: RUN go build -o /app/worker ./worker.' })}`, blocks: [file('docker-compose.yml (add)', svc)] },
        { title: 'Install the client', blocks: [sh(pick(rt, install))] },
        { title: 'Publish instead of writing', text: 'Validate the request first; only valid orders go on the queue.', blocks: [file(R.file, pick(rt, producer))] },
        { title: 'Write the worker', text: 'Acknowledge (or commit) a message only after the database write succeeded, so nothing is lost if the worker crashes. That also means a message can arrive twice: make the write idempotent (for example a unique order id).', blocks: [file(R.worker, pick(rt, worker))] },
        verify(q === 'rabbitmq' ? 'queue depth: http://localhost:15672 → Queues' : q === 'kafka' ? 'consumer lag: docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group order-writers' : 'waiting jobs: docker compose exec redis redis-cli llen bull:orders:wait', 'POST /api/orders should answer in a few ms even under load. Watch the backlog: if it keeps growing during the test, add workers (or partitions, for Kafka).'),
      ],
      pitfalls: ['The client now gets “accepted”, not “done”. If it needs the result, give it an id to poll or send a notification.', 'Messages can arrive twice or (with several partitions/consumers) out of order. Design for both.', q === 'kafka' ? 'Parallelism is capped by the partition count: 3 partitions = at most 3 busy workers in one group.' : 'A message that always fails blocks or loops forever. Add a retry limit and a dead-letter queue.'],
    };
  },

  workers: ({ rt }) => ({
    intro: 'More workers drain the queue faster, as long as the database can take the extra writes.',
    steps: [
      { title: 'Run more worker copies', blocks: [file('docker-compose.yml', `services:\n  worker:\n    deploy:\n      replicas: 4`), sh('docker compose up -d --scale worker=4')] },
      { title: 'Or more work per worker', text: pick(rt, { node: 'BullMQ: raise concurrency. RabbitMQ: raise prefetch. Kafka: one worker per partition at most, so add partitions first.', python: 'Raise prefetch_count (RabbitMQ) or run more processes. For Kafka, add partitions first.', go: 'Start several goroutines that read from the same channel/reader. For Kafka, add partitions first.' }) },
      verify('', 'The backlog should shrink faster. If database CPU hits its limit, more workers will not help.'),
    ],
  }),

  'scale-out': ({ cfg, rt }) => ({
    intro: `Run ${cfg.servers} copies of the app behind a load balancer. This only works if the app keeps no state in memory between requests (sessions, uploads, caches): every request must work on any copy.${rt === 'node' ? ' For Node.js this is also how you use more than one CPU core: one process uses one core.' : ''}`,
    steps: [
      { title: 'Several copies of the app, NGINX in front', text: 'The app no longer publishes a port; NGINX does. Docker’s DNS returns every copy’s address for “api”.',
        blocks: [file('docker-compose.yml', `services:\n  api:\n    build: .\n    # ports: ["3000:3000"]   ← remove: only NGINX is reachable from outside\n    deploy:\n      replicas: ${cfg.servers}\n  nginx:\n    image: nginx:1.27-alpine\n    ports: ["8080:80"]\n    volumes:\n      - ./nginx.conf:/etc/nginx/nginx.conf:ro\n    depends_on: [api]`),
          file('nginx.conf', `events {}
http {
  upstream api {
    server api:3000;   # resolves to all ${cfg.servers} copies
    keepalive 32;      # reuse connections to the app
  }
  server {
    listen 80;
    location / {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_next_upstream error timeout;   # try another copy if one fails
    }
  }
}`)] },
      { title: 'Point ScaleStation at the load balancer', text: 'Load tests should now go through NGINX like real users. The app no longer publishes a port, so its /metrics is not reachable from your machine either: publish a metrics port per copy, scrape it inside the network (Prometheus), or leave metrics empty and go by k6’s numbers.', blocks: [file('scalestation.config.yaml', `targets:\n  - http://localhost:8080   # through the load balancer\nmetrics: []               # :3000 is gone; see the note above`)] },
      { title: 'In the cloud', text: 'Same idea, managed: an AWS Application Load Balancer or Hetzner Load Balancer in front of several servers or containers, with a health check on /health so broken copies get no traffic.' },
      verify('', `Throughput should grow close to ${cfg.servers}× until the database becomes the limit. If errors appear, look for state kept in memory.`),
    ],
    pitfalls: ['In-memory sessions break: users get logged out when they land on another copy (see “Shared sessions”).', 'Each copy opens its own database connections: copies × pool size must stay under the database’s max_connections (or add a pooler).'],
  }),

  proxy: () => ({
    intro: 'A reverse proxy (NGINX here) sits in front of the app: it handles slow clients, compression, timeouts and static files, so the app only does app work.',
    steps: [
      { title: 'Add NGINX', blocks: [file('docker-compose.yml (add)', `services:\n  nginx:\n    image: nginx:1.27-alpine\n    ports: ["8080:80"]\n    volumes:\n      - ./nginx.conf:/etc/nginx/nginx.conf:ro\n      - ./public:/usr/share/nginx/html:ro   # static files, if you have any\n    depends_on: [api]`)] },
      { title: 'Configure it', blocks: [file('nginx.conf', `events {}
http {
  gzip on;
  gzip_types application/json text/css application/javascript;
  client_max_body_size 2m;

  server {
    listen 80;
    location /static/ {
      root /usr/share/nginx/html;
      expires 7d;                       # browsers and CDNs may cache it
    }
    location / {
      proxy_pass http://api:3000;
      proxy_read_timeout 10s;           # do not wait forever on the app
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
}`)] },
      { title: 'TLS', text: 'In production, terminate HTTPS here: Caddy does it automatically with Let’s Encrypt; with NGINX use certbot. The app keeps speaking plain HTTP inside the private network.' },
      verify('', 'Responses should be gzip-compressed (curl -H "Accept-Encoding: gzip" -I localhost:8080/api/products) and static files never reach the app.'),
    ],
  }),

  pooler: ({ rt }) => ({
    intro: 'Postgres starts a process per connection, so thousands of connections hurt. PgBouncer keeps a small pool of real connections and hands them out per transaction to many app connections.',
    steps: [
      { title: 'Run PgBouncer between the app and Postgres', blocks: [file('docker-compose.yml (add)', `services:\n  pgbouncer:\n    image: edoburu/pgbouncer:latest\n    environment:\n      DB_HOST: postgres\n      DB_USER: shop\n      DB_PASSWORD: shop\n      DB_NAME: shop\n      AUTH_TYPE: scram-sha-256\n      POOL_MODE: transaction\n      MAX_CLIENT_CONN: 1000      # app connections it accepts\n      DEFAULT_POOL_SIZE: 20      # real connections to Postgres\n    depends_on: [postgres]\n  api:\n    environment:\n      DATABASE_URL: postgres://shop:shop@pgbouncer:5432/shop   # was @postgres`)] },
      { title: 'Make the driver pooler-friendly', text: 'In transaction mode one app connection can land on different server connections, so session features (SET, advisory locks, LISTEN, named prepared statements) do not carry over.',
        blocks: [pick(rt, {
          node: file('app.js', `// node-postgres only uses named prepared statements if you pass { name }, so plain\n// db.query(text, values) works as it is. Keep the app-side pool small:\nconst db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });`),
          python: file('main.py', `# asyncpg caches prepared statements per connection: turn that off behind PgBouncer.\ndb = await asyncpg.create_pool(os.environ["DATABASE_URL"], statement_cache_size=0)`),
          go: file('main.go', `// pgx prepares statements by default: use the simple protocol behind PgBouncer.\ncfg, _ := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))\ncfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol\ndb, _ := pgxpool.NewWithConfig(ctx, cfg)`),
        })] },
      verify('connections on Postgres: docker compose exec postgres psql -U shop -c "select count(*) from pg_stat_activity"', 'Postgres should show about 20 connections however many app copies you run, and no “too many connections” errors.'),
    ],
  }),

  replicas: ({ rt, cfg }) => ({
    intro: `A read replica is a copy of the database that follows the primary. Writes go to the primary; reads that can be a little behind go to the ${cfg.replicas > 1 ? `${cfg.replicas} replicas` : 'replica'}.`,
    steps: [
      { title: 'In the cloud: one click', text: 'Managed databases create replicas for you: AWS RDS “Create read replica”, Hetzner, DigitalOcean or Supabase “read-only node”. You get a second connection string; skip to step 3.' },
      { title: 'Locally: a streaming replica in Compose', text: 'The replica copies the primary once (pg_basebackup) and then follows its write-ahead log. The primary must allow replication connections, which needs a fresh database volume (docker compose down -v) so the init script runs.',
        blocks: [file('replication-hba.sh', `#!/bin/sh\n# Runs once when the primary is created: allow replication connections from the network.\necho "host replication all all scram-sha-256" >> "$PGDATA/pg_hba.conf"`),
          file('docker-compose.yml (add)', `services:\n  postgres:   # add the script to your existing primary\n    volumes:\n      - ./replication-hba.sh:/docker-entrypoint-initdb.d/replication-hba.sh:ro\n  postgres-replica:\n    image: postgres:17-alpine   # same major version as the primary\n    user: postgres\n    environment:\n      PGPASSWORD: shop\n    command:\n      - sh\n      - -c\n      - |\n        if [ ! -s "$$PGDATA/PG_VERSION" ]; then\n          until pg_basebackup -h postgres -U shop -D "$$PGDATA" -R -X stream; do sleep 2; done\n          chmod 0700 "$$PGDATA"   # Docker creates the volume 0755; Postgres refuses to start on that\n        fi\n        exec postgres\n    volumes:\n      - pgreplica:/var/lib/postgresql/data\n    depends_on:\n      postgres: { condition: service_healthy }\n  api:   # add these lines to your existing api service\n    environment:\n      REPLICA_URL: postgres://shop:shop@postgres-replica:5432/shop   # reads\n      # DATABASE_URL stays as it is (primary, or PgBouncer if you added one): writes\n    depends_on:\n      postgres-replica: { condition: service_started }\nvolumes:\n  pgreplica:`),
          sh('docker compose down -v      # deletes the local data: the primary is re-created with the script\ndocker compose up --build -d')] },
      { title: 'Two pools: reads and writes', blocks: [pick(rt, {
        node: file('app.js', `const primary = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const replica = new pg.Pool({ connectionString: process.env.REPLICA_URL || process.env.DATABASE_URL });

app.get('/api/products', async (req, res) => {
  const { rows } = await replica.query('SELECT id, name, price_cents FROM products ORDER BY id LIMIT 20');
  res.json(rows);
});
app.post('/api/orders', async (req, res) => {
  const { rows } = await primary.query('INSERT INTO orders (product_id, qty) VALUES ($1, $2) RETURNING id', [Number(req.body?.productId) || 1, Number(req.body?.qty) || 1]);
  res.status(201).json({ id: rows[0].id });
});`),
        python: file('main.py', `primary = await asyncpg.create_pool(os.environ["DATABASE_URL"])
replica = await asyncpg.create_pool(os.environ.get("REPLICA_URL", os.environ["DATABASE_URL"]))

@app.get("/api/products")
async def list_products():
    return [dict(r) for r in await replica.fetch("SELECT id, name, price_cents FROM products ORDER BY id LIMIT 20")]

@app.post("/api/orders", status_code=201)
async def create_order(order: dict):
    oid = await primary.fetchval("INSERT INTO orders (product_id, qty) VALUES ($1, $2) RETURNING id", order.get("productId", 1), order.get("qty", 1))
    return {"id": oid}`),
        go: file('main.go', `primary, _ := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
replicaURL := os.Getenv("REPLICA_URL")
if replicaURL == "" { replicaURL = os.Getenv("DATABASE_URL") }
replica, _ := pgxpool.New(ctx, replicaURL)

// reads:  replica.Query(ctx, "SELECT id, name, price_cents FROM products ORDER BY id LIMIT 20")
// writes: primary.QueryRow(ctx, "INSERT INTO orders (product_id, qty) VALUES ($1, $2) RETURNING id", pid, qty)`),
      })] },
      { title: 'Read your own writes from the primary', text: 'Replicas are usually milliseconds behind, sometimes seconds. Right after a user changes something, read it back from the primary (for example for a few seconds after a write, or for that user’s own data), or they will see the old value.' },
      verify('is it streaming? docker compose exec postgres psql -U shop -c "select client_addr, state, replay_lag from pg_stat_replication"', 'Read-heavy endpoints should get faster and the primary’s CPU should drop. Writes do not get faster: replicas only help reads.'),
    ],
  }),

  shards: ({ rt, cfg }) => ({
    intro: `Sharding splits the rows over ${cfg.shards} databases by a shard key, so each one holds and serves only part of the data. It is the last step, after caching, replicas and a bigger primary, because every query must now know where its data lives.`,
    steps: [
      { title: 'Pick the shard key', text: 'Choose the key most queries filter by and that spreads evenly: a customer or tenant id is typical. Data that is queried together must share the key (a customer’s orders live on the customer’s shard). Queries across all shards become fan-outs and joins across shards are gone.' },
      { title: 'Easiest: let Postgres do it (Citus)', text: 'Citus is a Postgres extension that shards tables for you; the app keeps one connection string.', blocks: [file('docker-compose.yml', `services:\n  postgres:\n    image: citusdata/citus:13.0   # single node to practise; add workers later`), sh(`docker compose exec postgres psql -U shop -c "SELECT create_distributed_table('orders', 'product_id');"`)] },
      { title: 'Or route in the app', text: `One connection pool per shard and a function that picks the shard from the key. Start with more logical shards than databases (for example 64 → ${cfg.shards}), so you can move whole shards later without rehashing every row.`,
        blocks: [pick(rt, {
          node: file('shards.js', `import crypto from 'node:crypto';
import pg from 'pg';

// SHARD_URLS="postgres://…/shop0,postgres://…/shop1"
const shards = process.env.SHARD_URLS.split(',').map((url) => new pg.Pool({ connectionString: url }));
const LOGICAL = 64; // fixed forever; map logical → physical in one place

export function dbFor(key) {
  const h = crypto.createHash('md5').update(String(key)).digest().readUInt32BE(0);
  return shards[(h % LOGICAL) % shards.length];
}

// usage: await dbFor(order.customerId).query('INSERT INTO orders …', [...])`),
          python: file('shards.py', `import hashlib, os
import asyncpg

LOGICAL = 64  # fixed forever; map logical → physical in one place
shards = []

async def connect():
    for url in os.environ["SHARD_URLS"].split(","):
        shards.append(await asyncpg.create_pool(url))

def db_for(key) -> asyncpg.Pool:
    h = int.from_bytes(hashlib.md5(str(key).encode()).digest()[:4], "big")
    return shards[(h % LOGICAL) % len(shards)]

# usage: await db_for(order["customerId"]).execute("INSERT INTO orders …", ...)`),
          go: file('shards.go', `const logical = 64 // fixed forever; map logical → physical in one place

var shards []*pgxpool.Pool // one pool per URL in SHARD_URLS

func dbFor(key string) *pgxpool.Pool {
	sum := md5.Sum([]byte(key))
	h := binary.BigEndian.Uint32(sum[:4])
	return shards[int(h%logical)%len(shards)]
}

// usage: dbFor(strconv.Itoa(o.CustomerID)).Exec(ctx, "INSERT INTO orders …", ...)`),
        })] },
      verify('', 'Each shard should get about 1/N of the writes. Watch for a “hot” shard: one big customer can still overload one database.'),
    ],
    pitfalls: ['Unique ids across shards: use UUIDs or ids that include the shard number, not one serial per database.', 'Schema migrations now run on every shard.', 'Moving data between shards (rebalancing) is the hard part: plan it before you need it.'],
  }),

  cdn: ({ rt }) => ({
    intro: 'A CDN keeps copies of your static files (and, if you allow it, some GET responses) on servers near your users. Requests it can answer never reach you.',
    steps: [
      { title: 'Put the CDN in front', text: 'Cloudflare: add your domain, switch the DNS record to “Proxied” (orange cloud). AWS: a CloudFront distribution with your load balancer as origin. Both keep forwarding what they cannot answer.' },
      { title: 'Tell it what may be cached', text: 'The CDN follows your Cache-Control headers. Static files with a hash in the name can be cached for a year; public, rarely changing API answers for a short time; anything personal never.',
        blocks: [pick(rt, {
          node: file('app.js', `app.use('/static', express.static('public', { maxAge: '365d', immutable: true }));

app.get('/api/products', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=30, s-maxage=60'); // browsers 30 s, CDN 60 s
  /* … */
});
app.get('/api/me', (req, res) => {
  res.set('Cache-Control', 'private, no-store'); // personal: never on the CDN
  /* … */
});`),
          python: file('main.py', `app.mount("/static", StaticFiles(directory="public"), name="static")  # + Cache-Control via your proxy/CDN rules

@app.get("/api/products")
async def list_products(response: Response):
    response.headers["Cache-Control"] = "public, max-age=30, s-maxage=60"  # browsers 30 s, CDN 60 s
    ...`),
          go: file('main.go', `http.Handle("/static/", http.StripPrefix("/static/", cacheFor(365*24*time.Hour, http.FileServer(http.Dir("public")))))

http.HandleFunc("GET /api/products", func(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=30, s-maxage=60") // browsers 30 s, CDN 60 s
	// …
})`),
        })] },
      verify('curl -sI https://your-domain/api/products | grep -i -E "cf-cache-status|x-cache|age"', 'Repeat requests should show HIT. Load tests should go through the CDN URL to see the effect.'),
    ],
  }),

  gateway: ({ rt }) => ({
    intro: 'A rate limiter caps how many requests one client may send, so a bot or a buggy script cannot use up the capacity meant for everyone. Put it as far in front as possible.',
    steps: [
      { title: 'In NGINX (in front of every copy)', blocks: [file('nginx.conf', `http {
  # 10 requests/second per IP, bursts of 20 allowed
  limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;
  limit_req_status 429;

  server {
    location /api/ {
      limit_req zone=per_ip burst=20 nodelay;
      proxy_pass http://api;
    }
  }
}`)] },
      { title: 'Or in the app (per user or API key)', text: 'Several app copies must share the counters, so keep them in Redis.', blocks: [pick(rt, {
        node: file('app.js', `// npm install express-rate-limit rate-limit-redis
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

app.use('/api', rateLimit({
  windowMs: 60_000, limit: 300,                 // 300 requests per minute
  keyGenerator: (req) => req.get('x-api-key') ?? req.ip,
  store: new RedisStore({ sendCommand: (command, ...args) => redis.call(command, ...args) }), // redis = an ioredis client
}));`),
        python: file('main.py', `# pip install slowapi   (limits stored in Redis via storage_uri)
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, storage_uri=os.environ["REDIS_URL"])
app.state.limiter = limiter

@app.get("/api/products")
@limiter.limit("300/minute")
async def list_products(request: Request): ...`),
        go: file('main.go', `// Per-process limit (golang.org/x/time/rate). For several copies, keep counters in Redis
// (for example github.com/go-redis/redis_rate).
var limiter = rate.NewLimiter(rate.Limit(100), 200) // 100 req/s, bursts of 200

func limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !limiter.Allow() { http.Error(w, "slow down", http.StatusTooManyRequests); return }
		next.ServeHTTP(w, r)
	})
}`),
      })] },
      verify('', 'A single k6 client is one IP: with a low limit you will see 429s, which is the point. Raise the limit for the test or test from several IPs.'),
    ],
  }),

  sessions: ({ rt }) => ({
    intro: 'With several app copies, a session kept in one copy’s memory is gone when the next request lands on another copy. Store sessions in Redis, or make them stateless with signed tokens.',
    steps: [
      { title: 'Store sessions in Redis', blocks: [pick(rt, {
        node: file('app.js', `// npm install express-session connect-redis redis
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';

const sessionRedis = createClient({ url: process.env.REDIS_URL });
await sessionRedis.connect();

app.set('trust proxy', 1); // behind NGINX / a load balancer
app.use(session({
  store: new RedisStore({ client: sessionRedis, prefix: 'sess:' }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 },
}));`),
        python: file('main.py', `# FastAPI has no server-side sessions built in. Common choices:
# - stateless: a signed JWT in an HttpOnly cookie (pip install pyjwt)
# - server-side: store {session_id: data} in Redis with a TTL and keep only the id in the cookie
session_id = secrets.token_urlsafe(32)
await cache.set(f"sess:{session_id}", json.dumps({"user_id": user.id}), ex=7 * 24 * 3600)
response.set_cookie("sid", session_id, httponly=True, secure=True, samesite="lax")`),
        go: file('main.go', `// go get github.com/alexedwards/scs/v2 github.com/alexedwards/scs/redisstore github.com/gomodule/redigo/redis
pool := &redis.Pool{Dial: func() (redis.Conn, error) { return redis.Dial("tcp", os.Getenv("REDIS_ADDR")) }}
sessions := scs.New()
sessions.Store = redisstore.New(pool)
sessions.Lifetime = 7 * 24 * time.Hour
http.ListenAndServe(":3000", sessions.LoadAndSave(mux))`),
      })] },
      verify('', 'Log in, then send many requests through the load balancer: you should stay logged in on every copy.'),
    ],
  }),

  autoscale: ({ cfg }) => ({
    intro: `Auto-scaling adds app copies when CPU goes above a target (${cfg.asTarget}% here) and removes them when it drops, between ${cfg.asMin} and ${cfg.asMax}. Docker Compose cannot do this; it is a platform feature.`,
    steps: [
      { title: 'Kubernetes: a HorizontalPodAutoscaler', text: 'The deployment needs CPU requests, or the autoscaler has nothing to compare against.', blocks: [file('hpa.yaml', `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: api }
  minReplicas: ${cfg.asMin}
  maxReplicas: ${cfg.asMax}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: ${cfg.asTarget} }
  behavior:
    scaleDown: { stabilizationWindowSeconds: 300 }   # do not flap`)] },
      { title: 'Without Kubernetes', text: `AWS ECS: Service Auto Scaling with target tracking on ECSServiceAverageCPUUtilization = ${cfg.asTarget}. EC2: an Auto Scaling Group with the same policy. Google Cloud Run / AWS App Runner scale on requests automatically.` },
      { title: 'Make new copies ready fast', text: 'Scaling only helps if a new copy starts quickly: small images, no long migrations at startup, and a readiness check (/health) so traffic waits until the copy can serve.' },
      verify('', 'Run the “Find the limit” profile: copies should be added as CPU rises. Expect a minute or two of slower answers while new copies boot; that is why you keep headroom.'),
    ],
  }),

  breaker: ({ rt }) => ({
    intro: 'A circuit breaker wraps calls to a dependency. When too many fail or time out, it “opens” and fails fast for a while instead of letting requests pile up waiting, then lets a few through to test whether the dependency recovered.',
    steps: [
      { title: 'Wrap the risky call', blocks: [pick(rt, {
        node: file('app.js', `// npm install opossum
import CircuitBreaker from 'opossum';

const getProduct = (id) => db.query('SELECT id, name, price_cents FROM products WHERE id = $1', [id]);
const breaker = new CircuitBreaker(getProduct, {
  timeout: 2000,                 // slower than 2 s counts as a failure
  errorThresholdPercentage: 50,  // open when half the calls fail…
  resetTimeout: 10_000,          // …and try again after 10 s
});
breaker.fallback(() => ({ rows: [] }));

app.get('/api/products/:id', async (req, res) => {
  const { rows } = await breaker.fire(req.params.id);
  if (!rows.length) return res.status(503).json({ error: 'temporarily unavailable' });
  res.json(rows[0]);
});`),
        python: file('main.py', `# pip install aiobreaker
from datetime import timedelta
from aiobreaker import CircuitBreaker, CircuitBreakerError

db_breaker = CircuitBreaker(fail_max=5, timeout_duration=timedelta(seconds=10))  # open after 5 failures, for 10 s

@db_breaker
async def load_product(product_id: int):
    return await db.fetchrow("SELECT * FROM products WHERE id = $1", product_id, timeout=2)

@app.get("/api/products/{product_id}")
async def get_product(product_id: int):
    try:
        row = await load_product(product_id)
    except CircuitBreakerError:
        raise HTTPException(status_code=503, detail="temporarily unavailable")
    ...`),
        go: file('main.go', `// go get github.com/sony/gobreaker/v2
var cb = gobreaker.NewCircuitBreaker[Product](gobreaker.Settings{
	Name:    "products-db",
	Timeout: 10 * time.Second, // how long it stays open
	ReadyToTrip: func(c gobreaker.Counts) bool { return c.ConsecutiveFailures >= 5 },
})

p, err := cb.Execute(func() (Product, error) { return loadProduct(ctx, id) })
if errors.Is(err, gobreaker.ErrOpenState) { http.Error(w, "temporarily unavailable", 503); return }`),
      })] },
      { title: 'Also set timeouts everywhere', text: 'A breaker needs failures to notice. Without timeouts (database statement_timeout, HTTP client timeouts) a hanging dependency never fails, it just holds every request.' },
      verify('stop the database during a test: docker compose stop postgres', 'With the breaker, errors come back instantly (503) and recover by themselves after restarting it; without it, requests hang until they time out and the app runs out of connections.'),
    ],
  }),

  regions: ({ cfg }) => ({
    intro: `Running in ${cfg.regions} regions lowers latency for far-away users and survives a whole region going down. It is mostly an infrastructure and data problem, not app code.`,
    steps: [
      { title: 'Route users to the nearest region', text: 'DNS with latency or geo routing (AWS Route 53, Cloudflare Load Balancing) and health checks, so a failed region is taken out of DNS.' },
      { title: 'Decide where the data lives', text: 'Simplest: one primary database region, read replicas elsewhere; writes travel to the primary. Harder: each region owns some users’ data. Hardest: multi-primary (CockroachDB, Spanner, Aurora Global). Pick the simplest one your latency allows.' },
      { title: 'Deploy everything twice', text: 'Infrastructure as code (Terraform / OpenTofu) with the region as a variable, the same images in both, and a deploy pipeline that rolls out one region at a time.' },
      verify('', 'Run the load test against each region’s endpoint, then switch one region off and check the other takes the traffic.'),
    ],
  }),

  resize: ({ cfg, base, rt }) => ({
    intro: `Change the app machines from ${base.vcpu} vCPU / ${base.ram} GB to ${cfg.vcpu} vCPU / ${cfg.ram} GB.${rt === 'node' && cfg.vcpu > base.vcpu ? ' Careful: one Node.js process uses one CPU core. More vCPUs only help if you run more processes.' : ''}`,
    steps: [
      { title: 'Locally: the container limits', blocks: [file('docker-compose.yml', `services:\n  api:\n    deploy:\n      resources:\n        limits: { cpus: "${cfg.vcpu}", memory: ${cfg.ram}G }`)] },
      { title: 'In the cloud: the machine type', text: `For example AWS ${cfg.vcpu <= 2 ? 't4g/m7g.large' : cfg.vcpu <= 4 ? 'm7g.xlarge' : cfg.vcpu <= 8 ? 'm7g.2xlarge' : 'm7g.4xlarge or bigger'} or Hetzner CCX${cfg.vcpu <= 2 ? '13' : cfg.vcpu <= 4 ? '23' : cfg.vcpu <= 8 ? '33' : '43+'}. See the Capacity page for the sizing maths.` },
      { title: 'Let the runtime use it', text: pick(rt, { node: `Run one process per core: node:cluster, PM2 (pm2 start app.js -i ${cfg.vcpu}) or ${cfg.vcpu} container replicas. Raise --max-old-space-size if memory grew a lot.`, python: `Run more worker processes: gunicorn -k uvicorn.workers.UvicornWorker -w ${cfg.vcpu * 2 + 1} main:app (about 2 × cores + 1).`, go: 'Nothing to do: Go uses all cores (GOMAXPROCS follows the container’s CPU limit since Go 1.25).' }) },
      verify('', 'Throughput should rise roughly with the cores you can actually use. If it does not, the bottleneck is elsewhere (database, locks, a single process).'),
    ],
  }),

  'db-size': ({ cfg }) => ({
    intro: `Give the database ${cfg.dbVcpu} vCPU and ${cfg.dbRam} GB. More RAM matters most: the more of the working set fits in memory, the fewer disk reads.`,
    steps: [
      { title: 'Resize', text: 'Managed: change the instance class (RDS: “Modify”, usually a few minutes of downtime or a failover). Self-hosted: a bigger VM, then tune Postgres to it.' },
      { title: 'Tune Postgres to the new size', blocks: [file('postgresql.conf', `shared_buffers = ${Math.max(1, Math.round(cfg.dbRam / 4))}GB          # ~25% of RAM
effective_cache_size = ${Math.max(1, Math.round(cfg.dbRam * 0.75))}GB    # ~75% of RAM
work_mem = 32MB                # per sort/hash, per query: keep modest
max_worker_processes = ${cfg.dbVcpu}
max_parallel_workers = ${cfg.dbVcpu}`)] },
      verify('the cache hit ratio: select sum(blks_hit)*100/sum(blks_hit+blks_read) from pg_stat_database', 'The hit ratio should be above ~99% on a read-heavy app. If CPU is the limit, look at the slowest queries (pg_stat_statements) before buying more.'),
    ],
  }),
};

export function guideFor(change, { cfg, base, runtime }) {
  const g = GUIDES[change.id];
  if (!g) return null;
  return { ...change, ...g({ cfg, base, rt: runtimeFor(runtime), tech: cfg.tech || {} }) };
}
