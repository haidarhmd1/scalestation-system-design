// Capacity planning: how to know which server you need, and when to scale.
// The sizing maths is deliberately simple and shown to the reader:
//   requests/s  = peak users × requests per user per minute ÷ 60 × spike factor
//   CPU cores   = requests/s × CPU seconds per request ÷ target utilisation
//   in flight   = requests/s × response time            (Little's law)
//   RAM         = OS + processes × base memory + in-flight × memory per request

import { PRICES } from '../sim/model.js';

export const SIZES = [2, 4, 8, 16, 32]; // vCPU per server we compare
export const RAM_RATIOS = [
  { id: 'compute', label: 'Compute-optimised', gbPerVcpu: 2, aws: 'c7i / c7g (ARM)', note: 'CPU-heavy apps with small memory needs' },
  { id: 'general', label: 'General purpose', gbPerVcpu: 4, aws: 'm7i / m7g (ARM)', note: 'the safe default for web apps and APIs' },
  { id: 'memory', label: 'Memory-optimised', gbPerVcpu: 8, aws: 'r7i / r7g (ARM)', note: 'caches, JVM apps, databases' },
];
const AWS_SIZE = { 2: 'large', 4: 'xlarge', 8: '2xlarge', 16: '4xlarge', 32: '8xlarge' };
const HETZNER_CCX = { 2: 'CCX13 (2 vCPU / 8 GB)', 4: 'CCX23 (4 / 16 GB)', 8: 'CCX33 (8 / 32 GB)', 16: 'CCX43 (16 / 64 GB)', 32: 'CCX53 (32 / 128 GB)' }; // dedicated vCPU, 4 GB per vCPU

// How each runtime uses the cores of a server, and its typical memory.
export const RUNTIMES = [
  { id: 'node', label: 'Node.js', procs: (v) => v, baseMb: 120, perReqMb: 2, note: 'One JavaScript thread per process: run one process per vCPU (cluster, PM2 or one container per core).' },
  { id: 'go', label: 'Go', procs: () => 1, baseMb: 40, perReqMb: 0.5, note: 'One process uses every core (goroutines). Small memory per request.' },
  { id: 'python', label: 'Python', procs: (v) => 2 * v + 1, baseMb: 90, perReqMb: 3, note: 'The GIL limits each process to one core: Gunicorn/Uvicorn run about 2 × vCPU + 1 worker processes.' },
  { id: 'java', label: 'Java / .NET', procs: () => 1, baseMb: 450, perReqMb: 1.5, note: 'One process with a thread pool uses every core; the JVM / CLR needs a large heap up front.' },
];

export const CPU_PRESETS = [
  { ms: 2, label: 'Tiny JSON / cache hit' },
  { ms: 8, label: 'Typical API with a DB query' },
  { ms: 40, label: 'Server-rendered page' },
  { ms: 250, label: 'Heavy: PDF, images, ML' },
];

export const DEFAULT_INPUT = {
  users: 2000, // peak users online at the same time
  reqPerMin: 6, // requests each active user makes per minute
  spike: 1.5, // extra safety for unexpected peaks
  cpuMs: 8, // CPU time per request (measure it!)
  respMs: 60, // response time incl. waiting on DB, cache, APIs
  runtime: 'node',
  perReqMb: 2,
  targetUtil: 60, // % CPU you want at peak
  redundancy: true, // N+1: survive losing one server
};

const roundUpRam = (gb) => [1, 2, 4, 8, 16, 32, 64, 128, 256, 512].find((x) => x >= gb) || Math.ceil(gb);

export function sizeIt(inp) {
  const rt = RUNTIMES.find((r) => r.id === inp.runtime) || RUNTIMES[0];
  const rps = (inp.users * inp.reqPerMin / 60) * inp.spike;
  const cpuSec = inp.cpuMs / 1000;
  const util = inp.targetUtil / 100;
  const coresBusy = rps * cpuSec; // cores fully busy at peak
  const coresNeeded = coresBusy / util; // with headroom
  const inflight = rps * (inp.respMs / 1000); // Little's law

  const options = SIZES.map((v) => {
    const forCpu = Math.max(1, Math.ceil(coresNeeded / v));
    const servers = inp.redundancy ? Math.max(2, forCpu + 1) : forCpu;
    const serving = inp.redundancy ? servers - 1 : servers; // worst case: one is down
    const procs = rt.procs(v);
    const memGb = 0.5 + (procs * rt.baseMb) / 1024 + ((inflight / serving) * inp.perReqMb) / 1024;
    const memWithRoom = memGb / 0.75; // keep 25% free for spikes, GC and the OS cache
    const shape = RAM_RATIOS.find((s) => s.gbPerVcpu * v >= memWithRoom) || null;
    const ram = shape ? shape.gbPerVcpu * v : roundUpRam(memWithRoom);
    const utilAll = coresBusy / (servers * v);
    const utilDegraded = coresBusy / (serving * v);
    const hr = servers * (PRICES.vcpuHr * v + PRICES.ramGbHr * ram);
    return {
      v, servers, ram, procs, memGb, shape,
      utilAll, utilDegraded,
      monthly: hr * PRICES.HOURS_PER_MONTH,
      aws: shape ? `${shape.aws.split(' ')[0]}.${AWS_SIZE[v]}` : 'more RAM than 8 GB/vCPU: use more, smaller servers',
      hetzner: ram <= v * 4 ? HETZNER_CCX[v] : 'bigger CCX or a dedicated server (more RAM per vCPU)',
    };
  });
  // Cheapest option; on a tie prefer fewer servers. Skip single huge machines with no redundancy.
  const best = options.reduce((a, b) => (b.monthly < a.monthly - 0.5 || (Math.abs(b.monthly - a.monthly) <= 0.5 && b.servers < a.servers) ? b : a));
  return { rps, coresBusy, coresNeeded, inflight, rt, options, best };
}

// From a load test: CPU% of the app container(s) at a known request rate.
export function cpuMsFromTest({ cpuPct, rps }) {
  if (!rps) return 0;
  return ((cpuPct / 100) * 1000) / rps; // docker stats: 100% = one full core
}

// ── Page content ───────────────────────────────────────────────────────────
export const LOOP = [
  { n: 1, title: 'Estimate traffic', text: 'How many requests per second at the busiest minute, not per day.' },
  { n: 2, title: 'Measure one request', text: 'How much CPU time and memory one request really costs in your app.' },
  { n: 3, title: 'Calculate', text: 'Cores = requests/s × CPU per request ÷ target utilisation. RAM from processes + requests in flight.' },
  { n: 4, title: 'Load-test', text: 'Prove it on a real machine of that size, with realistic traffic, until it breaks.' },
  { n: 5, title: 'Buy with headroom', text: 'Plan for ~60% CPU at peak and for losing one server (N+1).' },
  { n: 6, title: 'Watch the golden signals', text: 'Latency, traffic, errors and saturation tell you when reality differs from the plan.' },
  { n: 7, title: 'Resize', text: 'Scale out, scale up or optimise, based on which signal moved. Then repeat.' },
];

export const TRAFFIC_RULES = [
  { k: 'Daily active users → peak online', v: '~5–15% of daily users are online in the busiest minute for typical apps; much more for live events.' },
  { k: 'Average → peak', v: 'Peak traffic is often 2–4× the daily average; launches, sales and TV mentions can be 10–50×.' },
  { k: 'Page views → requests', v: 'One page view is often 5–30 API requests; static files (JS, CSS, images) should come from a CDN, not your servers.' },
  { k: 'Reads vs writes', v: 'Most apps are 80–95% reads. Reads can be cached; writes always reach the database.' },
  { k: 'Background work', v: 'Count queue jobs, cron jobs and webhooks too: they use the same CPU.' },
];

export const CPU_TABLE = [
  ['Health check / cache hit', '0.1–1 ms', 'Mostly network and framework overhead'],
  ['JSON API with one DB query', '2–10 ms', 'Parsing, validation, ORM, serialising JSON, logging'],
  ['API with several queries + business logic', '10–40 ms', 'Each extra query and transformation adds up'],
  ['Server-side rendered page (React SSR, templates)', '20–100 ms', 'Rendering HTML is CPU work'],
  ['Image resize, PDF, encryption-heavy, ML inference', '100 ms – seconds', 'Move to a queue + workers'],
];

export const GOLDEN = [
  {
    id: 'latency', name: 'Latency', color: '#4da3ff',
    what: 'How long requests take. Track percentiles (p50, p95, p99), not averages: an average hides the slow requests that users actually notice.',
    scale: 'p95 climbing while traffic rises means something is queueing: CPU, a thread or connection pool, or the database.',
    tip: 'Measure the latency of failed requests separately. A fast 500 error can make the average look great.',
    promql: 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))',
  },
  {
    id: 'traffic', name: 'Traffic', color: '#3ddc84',
    what: 'How much demand hits the system: requests per second for an API, jobs per second for workers, sessions for streaming.',
    scale: 'Compare it with the requests/s you sized for. At 60–70% of tested capacity, plan the next step.',
    tip: 'Break it down by route: one heavy endpoint can need more capacity than all the others together.',
    promql: 'sum by (route) (rate(http_request_duration_seconds_count[5m]))',
  },
  {
    id: 'errors', name: 'Errors', color: '#ff4d4f',
    what: 'The rate of failed requests: explicit (HTTP 5xx), implicit (a 200 with the wrong content) or by policy (slower than your promise).',
    scale: 'Errors that rise with load are a capacity problem (timeouts, pool exhaustion). Errors at low load are bugs.',
    tip: 'Alert on the error ratio users feel, not on every single error in the logs.',
    promql: 'sum(rate(http_request_duration_seconds_count{status=~"5.."}[5m])) / sum(rate(http_request_duration_seconds_count[5m]))',
  },
  {
    id: 'saturation', name: 'Saturation', color: '#ffb020',
    what: 'How full the system is: the resource that runs out first (CPU, memory, connections, disk I/O, queue length).',
    scale: 'This is your leading signal: latency often degrades well before 100%, so act at 70–80%. Also watch trends (“the disk is full in 4 hours”).',
    tip: 'A single-threaded process (Node, a Python worker) is saturated at 1 core, even if the machine shows 25% CPU.',
    promql: 'rate(process_cpu_seconds_total{job="app"}[5m])   # cores used per app process',
  },
];

export const METHODS = [
  { name: 'Four golden signals', by: 'Google SRE book', use: 'Every user-facing service', items: 'Latency · Traffic · Errors · Saturation' },
  { name: 'RED method', by: 'Tom Wilkie', use: 'Request-driven services', items: 'Rate · Errors · Duration' },
  { name: 'USE method', by: 'Brendan Gregg', use: 'Every resource (CPU, RAM, disk, network)', items: 'Utilisation · Saturation · Errors' },
];

export const SRE_POINTS = [
  { k: 'Symptoms vs causes', v: '“What is broken” (users see errors) vs “why” (the database is out of connections). Alert on symptoms; use dashboards to find causes.' },
  { k: 'Black-box vs white-box', v: 'Black-box checks test from the outside like a user and catch what is broken now. White-box metrics come from inside the app and show what is about to break.' },
  { k: 'Watch the tail', v: 'Use histograms so you can see p99, not only the average. The slowest 1% is often your most active users.' },
  { k: 'Pick the right resolution', v: 'Check CPU every few seconds when debugging, but an availability target over weeks. Very fine data costs money; collect it where it matters.' },
  { k: 'As simple as possible', v: 'Every alert must be urgent, actionable and need a human. Rules that rarely fire, or always get ignored, should be deleted.' },
];

export const DECIDE = [
  { signal: 'CPU 70%+ at peak, p95 rising with traffic', means: 'CPU-bound', action: 'Scale out (more servers) or up (more vCPU). Profile the hottest endpoints: a 2× faster endpoint is 2× fewer servers.' },
  { signal: 'Memory 80%+, out-of-memory kills, long GC pauses', means: 'Memory-bound', action: 'Move to a memory-heavier shape (general → memory-optimised), fewer processes per box, or fix a leak.' },
  { signal: 'Memory climbs for hours at steady traffic, then a crash or restart', means: 'Memory leak', action: 'Not a sizing problem: more RAM only delays the crash. Run a soak test, compare heap snapshots, fix the code. Hands-on: Build Your Own → Advanced A6.' },
  { signal: 'p95 high but app CPU low', means: 'Waiting on something', action: 'Don’t add servers! Look at the database, external APIs, locks or the connection pool. Add a cache, an index or a timeout.' },
  { signal: 'Database CPU high or slow queries', means: 'Database-bound', action: 'Indexes and query fixes first, then a cache, read replicas, a bigger DB; sharding last.' },
  { signal: '“Too many connections”, pool wait time', means: 'Connection-bound', action: 'Add a pooler (PgBouncer), lower the pool size per process, or fewer, bigger app servers.' },
  { signal: 'Queue backlog keeps growing', means: 'Workers too slow', action: 'More workers, if the database can take the writes; otherwise batch or shard.' },
  { signal: 'Errors at low traffic', means: 'A bug, not capacity', action: 'Roll back or fix. More servers only multiply the problem.' },
  { signal: 'Network or disk throughput at the instance limit', means: 'Instance-bound', action: 'Bigger instance (network scales with size), a CDN for static files, or faster disks (IOPS).' },
];

export const MACHINE_TIPS = [
  { k: 'Shared vs dedicated vCPU', v: 'Shared (cheap) vCPUs are slices of cores used by other customers too; under load you may see “steal time” and uneven latency. Use dedicated vCPUs for steady production load and for databases.' },
  { k: 'Burstable instances', v: 'AWS t3/t4g and similar earn CPU credits while idle and spend them under load. Great for low-traffic apps, terrible for sustained load: when credits run out the CPU is throttled.' },
  { k: 'ARM vs x86', v: 'ARM servers (AWS Graviton, Hetzner Ampere) are often ~20% cheaper for the same work. Most Node, Python, Go and Java apps run unchanged; check native dependencies and build multi-arch images.' },
  { k: 'One big or several small', v: 'Several smaller servers give redundancy and rolling deploys (N+1). One big server is simpler and fine to start, but it is a single point of failure.' },
  { k: 'vCPU ≠ core', v: 'On most clouds one vCPU is one hyper-thread, about half a physical core. Benchmarks on your laptop’s cores will look better than the server.' },
  { k: 'Disk and network', v: 'Network bandwidth and disk IOPS usually scale with instance size. Databases often hit disk IOPS limits before CPU.' },
  { k: 'Managed vs self-hosted DB', v: 'A managed database (RDS, Cloud SQL, managed Postgres) costs more but handles backups, failover and upgrades. Size it separately from your app servers.' },
];

export const PROVIDERS = [
  { name: 'AWS EC2', shared: 't3 / t4g (burstable)', dedicated: 'c7i, m7i, r7i (x86) · c7g, m7g, r7g (ARM)', pricing: 'https://aws.amazon.com/ec2/pricing/on-demand/', note: 'Every size and shape; pay per second; savings plans cut 30–70% for 1–3 year commitments.' },
  { name: 'Hetzner Cloud', shared: 'shared-vCPU lines (x86 and ARM)', dedicated: 'CCX line (dedicated vCPU, 4 GB per vCPU)', pricing: 'https://www.hetzner.com/cloud/', note: 'Much cheaper per vCPU, EU and US locations, fewer managed services. Dedicated root servers for big steady loads.' },
  { name: 'Google Cloud', shared: 'e2 (shared core)', dedicated: 'c3/c4, n2/n4, m3 (memory)', pricing: 'https://cloud.google.com/compute/vm-instance-pricing', note: 'Custom machine types: pick exact vCPU and RAM.' },
  { name: 'DigitalOcean', shared: 'Basic droplets', dedicated: 'CPU-optimized, General, Memory droplets', pricing: 'https://www.digitalocean.com/pricing/droplets', note: 'Simple pricing, good managed Postgres and Kubernetes.' },
];

export const CHECKLIST = [
  'I know my peak requests per second (not per day), including a spike factor.',
  'I measured CPU ms per request with a load test, not a guess.',
  'I know my runtime’s process model (one process per core for Node/Python).',
  'At peak, CPU is ≤ 60–70% with all servers, and ≤ 85% if one server is down.',
  'Memory has 25%+ free at peak; the database working set fits in its RAM.',
  'I load-tested a machine of the chosen size, and p95 met my target.',
  'Dashboards show latency, traffic, errors and saturation, with alerts on symptoms.',
  'I wrote down the trigger for the next step (e.g. “add a server at 65% CPU at peak”).',
];

export const REFERENCES = [
  { label: 'Google SRE book: Monitoring Distributed Systems', url: 'https://sre.google/sre-book/monitoring-distributed-systems/' },
  { label: 'Google SRE workbook: Alerting on SLOs', url: 'https://sre.google/workbook/alerting-on-slos/' },
  { label: 'Brendan Gregg: The USE Method', url: 'https://www.brendangregg.com/usemethod.html' },
  { label: 'Grafana: The RED method', url: 'https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/' },
  { label: 'k6 docs: load test types', url: 'https://grafana.com/docs/k6/latest/testing-guides/test-types/' },
];
