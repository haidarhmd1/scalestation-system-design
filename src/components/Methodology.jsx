import { useEffect, useState } from 'react';
import { ASSUMPTIONS as A, PRICES as P, PROXY_CPU_BOOST, PROXY_MEM_BOOST, PROXY_NODE_CAP, PROXY_STATIC_SHARE, fmt, ms, pct } from '../sim/model.js';
import { Info } from './Glossary.jsx';

const usd = (v) => (v >= 100 ? `$${fmt(v)}` : `$${v.toFixed(2)}`);

const PRICE_SOURCES = [
  ['App server', `$${P.vcpuHr}/vCPU·h + $${P.ramGbHr}/GB·h`, 'AWS EC2 m6i.xlarge (4 vCPU, 16 GB) is ≈ $0.19/h on-demand in us-east-1. The formula gives $0.21/h for the same size. Other clouds (GCP, Azure) are within ~10–20%.'],
  ['Reverse proxy', `$${P.proxyServerHr}/server·h`, 'NGINX, Caddy and Traefik are free, open-source software. The cost is the small share of each app server’s CPU and memory they use, roughly 1–2% of a typical instance.'],
  ['Load balancer', `$${P.lbNodeHr}/node·h + $${P.lbPerMReq}/M req`, 'AWS Application Load Balancer: ≈ $0.0225/h plus ≈ $0.008 per LCU-hour (a usage unit driven by requests and connections).'],
  ['API gateway', `$${P.gwHr}/h + $${P.gwPerMReq}/M req`, 'Sits between self-hosted (Kong or NGINX: you only pay for the server) and managed AWS API Gateway (HTTP APIs ≈ $1.00 per million requests, REST APIs ≈ $3.50).'],
  ['CDN', `$${P.cdnPerMReq}/M req`, 'Modelled like a flat-rate CDN plan (e.g. Cloudflare). Pay-as-you-go CloudFront charges ≈ $0.75–1.00 per million HTTPS requests plus ≈ $0.085/GB of bandwidth, so real bills can be noticeably higher.'],
  ['Cache', `$${P.cacheGbHr}/GB·h`, 'AWS ElastiCache cache.r7g.large (≈ 13 GB) is ≈ $0.22/h, which works out to ≈ $0.017 per GB-hour.'],
  ['Database', `$${P.dbVcpuHr}/vCPU·h + $${P.dbRamGbHr}/GB·h`, 'AWS RDS PostgreSQL db.r6g.xlarge (4 vCPU, 32 GB) is ≈ $0.45/h. The formula gives $0.60/h: the extra roughly covers storage and I/O, which RDS bills separately.'],
  ['Connection pooler', `$${P.poolerHr}/shard·h`, 'PgBouncer is a tiny process on a small VM. AWS RDS Proxy charges ≈ $0.015 per vCPU-hour of the database it fronts.'],
  ['Queue', `$${P.queueHr}/h + $${P.queuePerMMsg}/M msg`, 'Amazon SQS standard queues: $0.40 per million requests after the free tier. Redis-based BullMQ costs only the Redis server.'],
  ['Worker', `$${P.workerHr}/worker·h`, 'A small instance such as t3.medium (2 vCPU, 4 GB) is ≈ $0.042/h on-demand.'],
  ['Month', `${P.HOURS_PER_MONTH} hours`, '24 hours × 365 days ÷ 12 months ≈ 730. Cloud providers use the same number.'],
];

const ASSUMPTION_ROWS = [
  ['App throughput per vCPU', `${A.PER_CORE_RPS} req/s × vCPU^0.9`, 'A typical database-backed API endpoint uses about 5–10 ms of CPU, so one core handles ~100–200 requests per second. Trivial “hello world” benchmarks are much higher; real apps with JSON, auth and ORMs are lower. The ^0.9 adds diminishing returns: more cores mean more contention (locks, garbage collection), as described by Amdahl’s law.', 'cpu'],
  ['App throughput per GB of RAM', `${A.RPS_PER_GB} req/s per GB (minus 0.5 GB for the OS)`, 'From Little’s law: requests in flight = arrival rate × time each spends. With ~8 MB per in-flight request and ~0.15 s per request, 1 GB holds ~128 in-flight requests, which is ≈ 850 req/s.', 'ram'],
  ['Database reads per vCPU', '220 reads/s × vCPU^0.9', 'Mixed real-world queries (joins, indexes, ORMs), not single-row lookups. Drops up to 5× when the working set no longer fits in 70% of the DB’s RAM, because reads then hit disk.', 'database'],
  ['Database writes per vCPU', '70 writes/s × vCPU^0.9', 'Writes cost more than reads: every write updates indexes, appends to the write-ahead log (WAL) and is flushed to disk for durability.', 'readwrite'],
  ['Working set (hot data)', '1 GB + 30 KB per online user', 'Rough size of the data that is actively used. It decides cache hit rate and whether the DB is memory-bound.', 'workingset'],
  ['Cache hit rate', '1 − e^(−size ÷ (working set ÷ 3)), max 96%', 'Popularity is very uneven (the 80/20 rule, a Zipf distribution), so a cache much smaller than the data still catches most reads, with diminishing returns as it grows.', 'hitrate'],
  ['Cache node throughput', `${fmt(A.CACHE_CAP_PER_32GB)} ops/s per 32 GB`, 'A single Redis node commonly serves around 100k+ simple operations per second.', 'cache'],
  ['Reverse proxy', `×${PROXY_CPU_BOOST} CPU · ×${PROXY_MEM_BOOST} memory headroom · serves ${PROXY_STATIC_SHARE * 100}% of static · ${fmt(PROXY_NODE_CAP)} req/s per server`, 'HTTPS encryption and gzip/brotli compression can take 10–20% of an app server’s CPU; moving them to an optimised C proxy (NGINX) frees that. Buffering slow clients means app workers finish and release memory sooner. NGINX serves static files from disk at tens of thousands of requests per second.', 'reverse-proxy'],
  ['Load balancer node', `${fmt(A.LB_NODE_CAP)} req/s`, 'NGINX or HAProxy on a mid-size VM handles tens of thousands of HTTP requests per second. Managed LBs scale beyond this automatically.', 'lb'],
  ['API gateway', `${fmt(A.GW_CAP)} req/s per region`, 'A horizontally scaled gateway tier per region.', 'gateway'],
  ['DB connections', '25 per app server · max 100 + 15 per GB of DB RAM', 'Each app server keeps its own connection pool. Postgres uses a separate process (~5–10 MB) per connection, so limits are typically a few hundred. A pooler multiplexes them.', 'pool'],
  ['Worker throughput', `${A.WORKER_RPS} jobs/s per worker`, 'Small, fast jobs (one DB write each). Heavy jobs such as video encoding would be far slower.', 'worker'],
  ['CDN / rate limiter', 'CDN serves 95% of static · limiter blocks 95% of bots', 'Typical edge cache hit ratios for static assets are 90–99%.', 'cdn'],
  ['Static request cost', '30% of a dynamic request', 'Serving a file is cheaper than running business logic, but still uses CPU and bandwidth.', 'static'],
  ['Network round trip', '110 ms (1 region) · 70 ms (2) · 35 ms (3)', 'Assumes a global audience. Light in fibre travels ~200,000 km/s, so New York ↔ London is ~70 ms round trip and New York ↔ Sydney ~200 ms. More regions put servers closer to users.', 'latency'],
  ['Base latency per tier', 'app 18 ms · DB read 6 ms · DB write 10 ms · cache 0.5 ms · enqueue 4 ms', 'Typical unloaded timings within one data center. Under load each is multiplied by the queueing factor below.', 'latency'],
  ['In-memory sessions', '35% of requests need a logged-in session', 'With N servers and no sticky/shared sessions, (1 − 1/N) of those requests land on a server that doesn’t know the user.', 'session'],
  ['Cascading failure', 'app capacity ÷ ρ_DB^1.3 (max 6×) without circuit breakers', 'When the DB is overloaded, app threads wait on timeouts and stop serving other requests.', 'cascade'],
  ['Auto-scaling', '60 s boot · scale-in after 180 s cooldown', 'Typical VM/container boot plus health-check time. Kubernetes pods can be faster; VMs often slower.', 'autoscale'],
];

export default function Methodology({ r, cfg, tab: initialTab = 'cost', onClose }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelectorAll('.gl-back').length > 1) return; // a glossary pop-up on top closes first
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const H = P.HOURS_PER_MONTH;
  const total = r.costHr * H;
  const items = [...r.costItems].sort((a, b) => b.hr - a.hr);
  const t = r.tiers;
  const tiersRho = [['App', t.app.rho], ['DB primary', t.db.primaryRho], ['DB reads', t.db.readRho], ['Load balancer', t.lb.on ? t.lb.rho : 0], ['Cache', t.cache.on ? t.cache.rho : 0]].sort((a, b) => b[1] - a[1]);

  return (
    <div className="gl-back" onClick={onClose}>
      <div className="gl meth" role="dialog" aria-modal="true" aria-label="How these numbers are calculated" onClick={(e) => e.stopPropagation()}>
        <header className="gl-head">
          <div className="seg small meth-tabs">
            {[['cost', 'Cost breakdown'], ['stats', 'How each stat works'], ['assumptions', 'Assumptions & sources']].map(([id, l]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
            ))}
          </div>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="gl-body">
          {tab === 'cost' && (
            <>
              <h2>Cost: ${fmt(total)} / month</h2>
              <p className="dim">Each component’s hourly price × {H} hours. Prices update live with your layout and traffic; the formulas below show the exact numbers used right now.</p>
              <div className="cost-list">
                {items.map((c) => (
                  <div key={c.id} className={`cost-row ${c.on ? '' : 'off'}`}>
                    <div className="cost-top">
                      <span>{c.label}</span>
                      <b className="mono">{c.on ? `${usd(c.hr * H)}/mo` : 'not built'}</b>
                    </div>
                    {c.on && (
                      <>
                        <div className="cost-bar"><i style={{ width: `${total ? (c.hr * H / total) * 100 : 0}%` }} /></div>
                        <div className="cost-calc mono">{c.calc} → {usd(c.hr)}/h × {H} h</div>
                      </>
                    )}
                  </div>
                ))}
                <div className="cost-row total">
                  <div className="cost-top"><span>Total</span><b className="mono">{usd(total)}/mo · {usd(r.costHr)}/h</b></div>
                  <div className="cost-calc mono">≈ {usd(r.raw > 0 ? (r.costHr / (r.raw * 3600)) * 1e6 : 0)} per million requests · {usd(r.users > 0 ? total / r.users : 0)} per online user per month</div>
                </div>
              </div>

              <h3 className="meth-h mono">Where the prices come from</h3>
              <table className="meth-table">
                <thead><tr><th>Item</th><th>Unit price used</th><th>Real-world reference</th></tr></thead>
                <tbody>{PRICE_SOURCES.map(([a, b, c]) => <tr key={a}><td>{a}</td><td className="mono">{b}</td><td>{c}</td></tr>)}</tbody>
              </table>

              <h3 className="meth-h mono">Not included</h3>
              <ul className="meth-list">
                <li>Data transfer / bandwidth (egress), often a big line item at scale, especially for video and images.</li>
                <li>Disk storage, backups, snapshots, logs and monitoring tools.</li>
                <li>Discounts: reserved instances and savings plans (≈ 30–60% cheaper), spot instances (up to ≈ 70–90% cheaper), free tiers.</li>
                <li>Engineering and on-call time, which for small teams usually costs far more than the servers.</li>
              </ul>
              <p className="note">Why it’s shown: every scaling decision is a trade-off. More replicas, regions and headroom buy reliability and speed but multiply the bill. Try removing a component and compare cost per million requests.</p>
            </>
          )}

          {tab === 'stats' && (
            <>
              <h2>How each stat is estimated</h2>
              <p className="dim">The simulator is a capacity model: every component has a capacity, and the traffic offered to it is compared against that capacity. All numbers below are live.</p>
              <Stat title="Users online" term="rps" value={fmt(r.users)}
                formula="Users slider × traffic pattern multiplier (daily wave, viral growth, flash sale, spike)">
                The number of people actively using the product at this moment, not total signups.
              </Stat>
              <Stat title="Offered load" term="rps" value={`${fmt(r.raw)} req/s`}
                formula={`users × requests per user per minute ÷ 60 = ${fmt(r.users)} × ${cfg.reqPerMin} ÷ 60`}>
                Everything users and bots try to send. It is then split into static files ({cfg.staticPct}%), reads ({cfg.readPct}% of the rest), writes and bot traffic ({cfg.botPct}%).
              </Stat>
              <Stat title="Utilisation (ρ) per component" term="utilization" value={`highest: ${tiersRho[0][0]} ${pct(tiersRho[0][1])}`}
                formula="ρ = load arriving at the component ÷ its capacity">
                Capacity comes from the assumptions tab (e.g. per-vCPU throughput × servers). This drives the green / amber / red signals: below 60%, 60–85%, 85–100%, overloaded.
              </Stat>
              <Stat title="Served OK" term="rps" value={`${fmt(r.served)} req/s`}
                formula="CDN-served + app-served − failures (overloaded DB, connection limit, lost sessions, full queue)">
                Requests that actually got a correct answer. When a component is over 100%, only its capacity gets through; the rest fail.
              </Stat>
              <Stat title="Error rate" term="errorrate" value={pct(r.errRate)}
                formula="failed requests ÷ attempted requests (requests blocked by the rate limiter are not counted as errors)">
                Failures come from overflow at any component plus specific problems: DB connection limit, in-memory sessions across servers, cascading failure without circuit breakers.
              </Stat>
              <Stat title="Latency: p50 and p95" term="p95" value={`p50 ${ms(r.p50)} · p95 ${ms(r.p95)}`}
                formula="each component: base time × 1 ÷ (1 − ρ)   ·   p50 = network + gateway + LB + app + (read or write path)   ·   p95 = p50 × (1.7 + 3·ρmax⁴)">
                The 1 ÷ (1 − ρ) factor is the classic M/M/1 queueing result from queueing theory: at 50% busy you wait 2× the base time, at 90% 10×. p95 is estimated from the median and the busiest component; anything overloaded pushes p95 to 2 s or more (timeouts).
              </Stat>
              <Stat title="Uptime estimate" term="availability" value={`${(r.avail * 100).toFixed(3)}%`}
                formula="product of component availabilities; multiple regions: 1 − 3 × (1 − A)^regions">
                Based on typical cloud SLAs: a single VM ≈ 99.5% (AWS single-instance SLA), a redundant fleet ≈ 99.99%, a single LB node 99.95% vs redundant 99.999%, a single DB 99.9% vs with replica/standby 99.95% (RDS Multi-AZ SLA). Regions fail mostly independently, so the chance of all being down at once is tiny.
              </Stat>
              <Stat title="Cost / month" term="server" value={`$${fmt(r.costHr * H)}`}
                formula="Σ (component hourly price) × 730 hours">
                See the Cost breakdown tab for the live per-component calculation.
              </Stat>
              <Stat title="Breaking point" term="bottleneck" value="Dispatcher button"
                formula="keep the layout, raise users by 12% steps until errors > 1%, p95 > 1.5 s, or the queue backlog keeps growing">
                The component with the highest utilisation at that moment is reported as the first to fail.
              </Stat>
            </>
          )}

          {tab === 'assumptions' && (
            <>
              <h2>Assumptions & where they come from</h2>
              <p className="dim">These are teaching estimates: plausible orders of magnitude drawn from public benchmarks, cloud documentation and queueing theory. Real systems vary 10× either way depending on language, query design and hardware, so always load-test your own system before trusting any number.</p>
              <table className="meth-table">
                <thead><tr><th>Assumption</th><th>Value</th><th>Reasoning / source</th></tr></thead>
                <tbody>
                  {ASSUMPTION_ROWS.map(([a, b, c, term]) => (
                    <tr key={a}><td>{a}<Info term={term} label={a} /></td><td className="mono">{b}</td><td>{c}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="note">The full model is about 300 lines in <span className="mono">src/sim/model.js</span>. Prices live in the <span className="mono">PRICES</span> table there, so you can plug in your own provider’s rates.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ title, term, value, formula, children }) {
  return (
    <section className="meth-stat">
      <div className="meth-stat-top">
        <h3>{title}<Info term={term} label={title} /></h3>
        <b className="mono">{value}</b>
      </div>
      <div className="meth-formula mono">{formula}</div>
      <p>{children}</p>
    </section>
  );
}
