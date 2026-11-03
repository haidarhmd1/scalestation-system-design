// Explanations and real-world technology choices for each simulator station.
// Technology picks are labels for learning: the capacity model treats every
// option in a list the same, so compare them by the notes, not the numbers.

const o = (id, name, kind, note) => ({ id, name, kind, note });

export const TECH_DEFAULTS = {
  dns: 'route53',
  cdn: 'cloudflare',
  gateway: 'kong',
  lb: 'nginx',
  runtime: 'node',
  platform: 'k8s',
  sessions: 'redis',
  breaker: 'resilience4j',
  cache: 'redis',
  db: 'postgres',
  pooler: 'pgbouncer',
  queue: 'bullmq',
  workers: 'bullmq-worker',
};

export const PICKERS = {
  dns: {
    label: 'DNS provider',
    options: [
      o('route53', 'Amazon Route 53', 'Managed DNS', 'Latency-, geo- and weighted routing with health checks. Standard choice on AWS.'),
      o('cloudflare-dns', 'Cloudflare DNS', 'Anycast DNS', 'Very fast anycast DNS, free tier, pairs with Cloudflare CDN and proxy.'),
      o('gcp-dns', 'Google Cloud DNS', 'Managed DNS', '100% SLA anycast DNS on Google Cloud.'),
      o('ns1', 'NS1 / IBM', 'Traffic steering', 'Advanced traffic steering ("filter chains") for multi-CDN and multi-region setups.'),
    ],
  },
  cdn: {
    label: 'CDN',
    options: [
      o('cloudflare', 'Cloudflare', 'CDN + edge network', '300+ PoPs, DDoS protection, WAF and Workers (code at the edge). Generous free tier.'),
      o('cloudfront', 'AWS CloudFront', 'CDN', 'Integrates with S3, ALB and Lambda@Edge. Pay per GB and per request.'),
      o('fastly', 'Fastly', 'Programmable CDN', 'Instant purge (~150 ms) and VCL/Compute@Edge. Popular with news and e-commerce sites.'),
      o('akamai', 'Akamai', 'Enterprise CDN', 'The largest and oldest CDN. Common for huge media and enterprise traffic.'),
      o('bunny', 'Bunny CDN', 'Budget CDN', 'Simple and very cheap per GB. Good for side projects and video.'),
    ],
  },
  gateway: {
    label: 'API gateway / rate limiter',
    options: [
      o('kong', 'Kong Gateway', 'Self-hosted gateway', 'Built on NGINX. Plugins for auth, rate limiting (Redis-backed) and logging.'),
      o('nginx-rl', 'NGINX limit_req', 'Reverse-proxy module', 'Leaky-bucket rate limiting built into NGINX. Simple, local to each node.'),
      o('aws-apigw', 'AWS API Gateway', 'Managed gateway', 'Serverless: throttling, API keys and usage plans. Priced per million requests.'),
      o('envoy-gw', 'Envoy Gateway', 'Cloud-native gateway', 'Envoy proxy with a global rate-limit service. Common on Kubernetes.'),
      o('cf-waf', 'Cloudflare WAF + Rate Limiting', 'Edge security', 'Blocks bots and abusive IPs at the edge before they reach you.'),
    ],
  },
  lb: {
    label: 'Load balancer',
    options: [
      o('nginx', 'NGINX', 'L7 reverse proxy', 'The most common self-hosted web LB. Round robin, least_conn, ip_hash, TLS termination.'),
      o('haproxy', 'HAProxy', 'L4 / L7 balancer', 'Extremely fast and battle-tested. Rich health checks and stats page.'),
      o('alb', 'AWS ALB', 'Managed L7', 'Path- and host-based routing, auto-scales itself, integrates with Auto Scaling Groups.'),
      o('nlb', 'AWS NLB', 'Managed L4', 'TCP/UDP at millions of rps with static IPs. No HTTP awareness.'),
      o('envoy', 'Envoy', 'L7 service proxy', 'Dynamic config via API, retries, circuit breaking. The data plane of Istio.'),
      o('traefik', 'Traefik', 'Cloud-native L7', 'Auto-discovers Docker and Kubernetes services, automatic Let’s Encrypt TLS.'),
    ],
  },
  runtime: {
    label: 'App runtime / framework',
    options: [
      o('node', 'Node.js (Express / NestJS)', 'Event loop', 'Great for I/O-heavy APIs. Single-threaded per process: run one per core (cluster/PM2).'),
      o('go', 'Go (net/http, Gin)', 'Goroutines', 'Compiled, low memory, very high concurrency per server.'),
      o('java', 'Java (Spring Boot)', 'JVM threads', 'Mature ecosystem, high throughput once warm. Heavier memory footprint.'),
      o('python', 'Python (Django / FastAPI)', 'WSGI / ASGI workers', 'Fast to build. Scale with several Gunicorn/Uvicorn worker processes per box.'),
      o('rails', 'Ruby on Rails (Puma)', 'Threads + processes', 'Very productive monolith framework (Shopify, GitHub).'),
      o('dotnet', '.NET (ASP.NET Core)', 'Thread pool', 'Very fast in benchmarks, strong typing, common in enterprises.'),
    ],
  },
  platform: {
    label: 'Hosting / auto-scaling',
    options: [
      o('k8s', 'Kubernetes (HPA)', 'Container orchestration', 'Horizontal Pod Autoscaler adds pods on CPU or custom metrics. Karpenter adds nodes.'),
      o('asg', 'AWS Auto Scaling Groups', 'VM scaling', 'Launches EC2 instances from a template, registers them with the ALB.'),
      o('ecs', 'AWS ECS / Fargate', 'Managed containers', 'Containers without managing servers. Service auto-scaling on CPU or requests.'),
      o('cloudrun', 'Google Cloud Run', 'Serverless containers', 'Scales per request, down to zero. Pay only while handling requests.'),
      o('vm', 'Plain VMs (manual)', 'Fixed servers', 'You add servers by hand. Simple, but no reaction to spikes.'),
    ],
  },
  sessions: {
    label: 'Session store',
    options: [
      o('redis', 'Redis', 'In-memory key-value', 'The default session store. Sub-ms reads, TTLs for expiry.'),
      o('memcached', 'Memcached', 'In-memory cache', 'Simple and fast, but no persistence: a restart logs everyone out.'),
      o('dynamodb', 'Amazon DynamoDB', 'Managed key-value', 'Durable, serverless, single-digit-ms. Good when you don’t want to run Redis.'),
      o('jwt', 'JWT in a cookie', 'Stateless token', 'No store at all: the signed token carries the session. Hard to revoke early.'),
    ],
  },
  breaker: {
    label: 'Circuit breaker library',
    options: [
      o('resilience4j', 'Resilience4j', 'Java library', 'Circuit breaker, bulkhead, retry and rate limiter for JVM apps.'),
      o('opossum', 'opossum', 'Node.js library', 'Wraps any async function with a circuit breaker and fallback.'),
      o('polly', 'Polly', '.NET library', 'Resilience policies: retry, circuit breaker, timeout, bulkhead.'),
      o('istio', 'Envoy / Istio outlier detection', 'Service mesh', 'Ejects failing hosts at the proxy layer: no code changes.'),
    ],
  },
  cache: {
    label: 'Cache',
    options: [
      o('redis', 'Redis', 'In-memory data structures', 'Strings, hashes, sorted sets, pub/sub, TTLs, optional persistence. The usual first choice.'),
      o('valkey', 'Valkey', 'Open-source Redis fork', 'Linux Foundation fork of Redis, wire-compatible. Used by AWS and Google.'),
      o('memcached', 'Memcached', 'Simple key-value cache', 'Multi-threaded, very simple, no persistence. Used at huge scale by Facebook.'),
      o('elasticache', 'AWS ElastiCache', 'Managed Redis/Valkey/Memcached', 'Managed clusters with replicas and automatic failover.'),
      o('dragonfly', 'Dragonfly', 'Redis-compatible', 'Multi-threaded Redis replacement with higher throughput per machine.'),
    ],
  },
  db: {
    label: 'Database',
    options: [
      o('postgres', 'PostgreSQL', 'Relational (SQL)', 'Rich SQL, JSONB, strong consistency. Read replicas via streaming replication; sharding via Citus.'),
      o('mysql', 'MySQL / MariaDB', 'Relational (SQL)', 'Huge install base. Replicas via binlog; sharding at YouTube/Slack scale via Vitess.'),
      o('aurora', 'Amazon Aurora', 'Managed cloud SQL', 'Postgres/MySQL-compatible. Storage shared across up to 15 low-lag read replicas.'),
      o('mongodb', 'MongoDB', 'Document (NoSQL)', 'Flexible JSON documents, replica sets, built-in sharding by shard key.'),
      o('cockroach', 'CockroachDB', 'Distributed SQL', 'Postgres-compatible; shards and replicates automatically with Raft. Survives node and region loss.'),
      o('cassandra', 'Cassandra / ScyllaDB', 'Wide-column, leaderless', 'Massive write throughput, tunable quorum consistency, no single primary.'),
      o('dynamodb', 'Amazon DynamoDB', 'Managed key-value', 'Serverless, auto-partitions by key, single-digit-ms at any scale. Limited queries.'),
    ],
  },
  pooler: {
    label: 'Connection pooler',
    options: [
      o('pgbouncer', 'PgBouncer', 'Postgres pooler', 'Tiny, battle-tested. Transaction pooling lets 10k clients share ~100 connections.'),
      o('rdsproxy', 'Amazon RDS Proxy', 'Managed pooler', 'Managed pooling for RDS/Aurora, smooths failovers, great with Lambda.'),
      o('proxysql', 'ProxySQL', 'MySQL proxy', 'Pooling plus read/write splitting and query routing for MySQL.'),
      o('pgcat', 'PgCat / Supavisor', 'Modern Postgres poolers', 'Multi-threaded poolers with sharding and replica load balancing.'),
      o('hikari', 'HikariCP (in-app)', 'Client-side pool', 'Pool inside each app process. Helps, but N servers still means N pools.'),
    ],
  },
  queue: {
    label: 'Queue / message broker',
    options: [
      o('bullmq', 'BullMQ (on Redis)', 'Job queue', 'Node.js job queue on Redis: retries, delays, priorities, rate limits. Easy if you already run Redis.'),
      o('rabbitmq', 'RabbitMQ', 'Message broker (AMQP)', 'Flexible routing (exchanges, topics), acks, dead-letter queues. Classic work queue.'),
      o('sqs', 'Amazon SQS', 'Managed queue', 'Serverless, nearly unlimited throughput, visibility timeouts and DLQs. Zero ops.'),
      o('kafka', 'Apache Kafka', 'Distributed log', 'Partitioned, replayable event log at millions of msgs/s. Best for event streams.'),
      o('pubsub', 'Google Pub/Sub', 'Managed pub/sub', 'Global, auto-scaling topics and subscriptions with push or pull delivery.'),
      o('nats', 'NATS JetStream', 'Lightweight broker', 'Very fast, simple to run, persistence via JetStream.'),
    ],
  },
  workers: {
    label: 'Worker framework',
    options: [
      o('bullmq-worker', 'BullMQ Workers (Node.js)', 'Job processor', 'Processes BullMQ jobs with concurrency, retries and backoff.'),
      o('celery', 'Celery (Python)', 'Task queue', 'Python workers on RabbitMQ or Redis. Common with Django.'),
      o('sidekiq', 'Sidekiq (Ruby)', 'Job processor', 'Multithreaded Redis-backed workers for Rails.'),
      o('lambda', 'AWS Lambda consumers', 'Serverless', 'SQS or Kafka triggers Lambda functions that scale automatically.'),
      o('temporal', 'Temporal', 'Workflow engine', 'Durable, long-running workflows with automatic retries and state. Good for sagas.'),
      o('kafka-consumers', 'Kafka consumer group', 'Stream consumers', 'Each partition is read by one consumer in the group. Scale up to the partition count.'),
    ],
  },
};

export const STATION_INFO = {
  users: {
    what: 'The people (and bots) using your product: browsers, mobile apps, other services.',
    why: 'All load starts here. Requests per second = online users × requests per minute ÷ 60.',
    model: 'Traffic is split into static files, reads, writes and bot traffic using the Traffic panel.',
    pickers: [],
  },
  dns: {
    what: 'The internet’s phonebook: turns your domain into an IP address.',
    why: 'With several regions, GeoDNS sends each user to the nearest healthy region.',
    model: 'More regions cut network latency (110 ms → 35 ms) and add a full copy of the stack per region.',
    pickers: ['dns'],
  },
  cdn: {
    what: 'Servers around the world that cache your images, JS and CSS close to users.',
    why: 'Static files make up a large share of requests. Serving them from the edge saves your servers and cuts latency.',
    model: '95% of static requests are answered at the edge and never reach your app servers.',
    pickers: ['cdn'],
  },
  gateway: {
    what: 'The front door for your API. Checks auth, enforces quotas and blocks abusive traffic with 429 Too Many Requests.',
    why: 'Bots and scrapers can eat your capacity. Rejecting them early is far cheaper than serving them.',
    model: 'Blocks 95% of bot traffic. Capacity ~250k rps per region.',
    pickers: ['gateway'],
  },
  lb: {
    what: 'Spreads incoming requests across many app servers and skips unhealthy ones.',
    why: 'Without one, DNS points at a single server and any extra servers sit idle.',
    model: 'Each LB node handles ~50k rps. Two or more nodes remove it as a single point of failure.',
    pickers: ['lb'],
  },
  app: {
    what: 'Your application code. Handles each request, talks to the cache, database and queue.',
    why: 'Scale vertically (bigger servers) for a quick win, horizontally (more servers + LB) for no ceiling and redundancy.',
    model: 'Per-server capacity = min(CPU limit ≈ 120 rps per core, RAM limit ≈ 850 rps per GB). Overload = queued then failed requests.',
    pickers: ['runtime', 'platform', 'sessions', 'breaker'],
  },
  cache: {
    what: 'An in-memory key-value store holding hot data so reads skip the database.',
    why: 'Memory reads take ~0.3 ms versus 5–50 ms for a DB query. The cheapest way to scale reads.',
    model: 'Cache-aside. Hit rate grows with cache size relative to the hot working set (which grows with users).',
    pickers: ['cache'],
  },
  db: {
    what: 'The source of truth for your data. Usually the hardest part to scale.',
    why: 'Scale up first, add read replicas for reads, then shard to scale writes. A pooler keeps connection counts sane.',
    model: 'Writes go to the primary of each shard; reads go to replicas if you have them. Data must fit in RAM to stay fast.',
    pickers: ['db', 'pooler'],
  },
  queue: {
    what: 'A buffer of jobs. The app drops a write or task on the queue and replies immediately; workers process it later.',
    why: 'Turns traffic spikes into a backlog instead of errors, and keeps slow work out of the request path.',
    model: 'Workers drain ~500 jobs/s each, but back off when the database is busy (backpressure).',
    pickers: ['queue', 'workers'],
  },
};
STATION_INFO.workers = STATION_INFO.queue;

export function techName(cfg, key) {
  const id = cfg.tech?.[key] ?? TECH_DEFAULTS[key];
  return PICKERS[key]?.options.find((x) => x.id === id)?.name ?? '';
}

export function shortTech(cfg, key) {
  return techName(cfg, key).replace(/\s*\(.*\)$/, '');
}
