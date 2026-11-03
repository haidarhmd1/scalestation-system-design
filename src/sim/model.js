import { TECH_DEFAULTS } from './tech.js';

// A deliberately simple capacity model for teaching. Numbers are plausible
// orders of magnitude, not benchmarks. Each tier: offered load vs capacity,
// queueing latency ~ 1/(1-ρ), overflow becomes errors.

export const VCPU_STEPS = [1, 2, 4, 8, 16, 32, 64, 96];
export const RAM_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

export const DEFAULT_CONFIG = {
  users: 200,
  reqPerMin: 6,
  readPct: 80,
  staticPct: 40,
  botPct: 5,
  pattern: 'steady',
  regions: 1,
  cdn: false,
  gateway: false,
  lb: false,
  lbNodes: 1,
  lbAlgo: 'round-robin',
  servers: 1,
  vcpu: 2,
  ram: 4,
  autoscale: false,
  asMin: 2,
  asMax: 30,
  asTarget: 65,
  sessions: 'memory',
  cache: false,
  cacheGb: 4,
  dbVcpu: 2,
  dbRam: 8,
  replicas: 0,
  shards: 1,
  pooler: false,
  queue: false,
  workers: 2,
  breaker: false,
  tech: { ...TECH_DEFAULTS },
};

const q = (rho) => 1 / (1 - Math.min(rho, 0.97));
const PER_CORE_RPS = 120;
const RPS_PER_GB = 850;
const LB_NODE_CAP = 50000;
const GW_CAP = 250000;
const CACHE_CAP_PER_32GB = 120000;
const WORKER_RPS = 500;

// Unit prices in USD, approximating public cloud on-demand list prices
// (AWS us-east-1 style, 2024–2025). Shown in the "How is this calculated?" panel.
export const PRICES = {
  HOURS_PER_MONTH: 730,
  vcpuHr: 0.034, // app server per vCPU-hour
  ramGbHr: 0.0045, // app server per GB-RAM-hour
  lbNodeHr: 0.025, // per load balancer node-hour
  lbPerMReq: 0.008, // per million requests through the LB
  gwHr: 0.03, // gateway fixed per region-hour
  gwPerMReq: 0.1, // per million requests through the gateway
  cdnPerMReq: 0.08, // per million CDN requests (flat-rate-plan style)
  cacheGbHr: 0.017, // per GB of managed cache per hour
  dbVcpuHr: 0.07, // managed DB per vCPU-hour
  dbRamGbHr: 0.01, // managed DB per GB-RAM-hour
  poolerHr: 0.05, // connection pooler per shard-hour
  queueHr: 0.05, // queue base per hour
  queuePerMMsg: 0.4, // per million messages
  workerHr: 0.05, // per worker-hour
};

// Capacity & latency assumptions, also shown in the panel.
export const ASSUMPTIONS = { PER_CORE_RPS, RPS_PER_GB, LB_NODE_CAP, GW_CAP, CACHE_CAP_PER_32GB, WORKER_RPS };

export function serverCapacity(vcpu, ram) {
  const cpu = Math.pow(vcpu, 0.9) * PER_CORE_RPS;
  const mem = Math.max(0, ram - 0.5) * RPS_PER_GB;
  return { cap: Math.min(cpu, mem), cpu, mem, bound: cpu <= mem ? 'CPU' : 'RAM' };
}

export function dbNode(cfg, users) {
  const eff = Math.pow(cfg.dbVcpu, 0.9);
  const ws = 1 + users * 0.00003; // working set GB
  const wsShard = ws / cfg.shards;
  const ramFactor = Math.min(1, Math.max(0.2, (cfg.dbRam * 0.7) / wsShard));
  return {
    readCap: eff * 220 * ramFactor,
    writeCap: eff * 70 * (0.5 + 0.5 * ramFactor),
    ramFactor,
    ws,
    wsShard,
    maxConn: Math.round(100 + cfg.dbRam * 15),
  };
}

export function status(rho) {
  if (!isFinite(rho)) return 'off';
  if (rho >= 1) return 'broken';
  if (rho >= 0.85) return 'red';
  if (rho >= 0.6) return 'amber';
  return 'green';
}

export function compute(cfg, rt = {}) {
  const users = rt.users ?? cfg.users;
  const R = cfg.regions;
  const activeServers = rt.servers ?? cfg.servers;
  const raw = (users * cfg.reqPerMin) / 60;
  const bot = (raw * cfg.botPct) / 100;
  const legit = raw - bot;
  const sPct = cfg.staticPct / 100;
  const rPct = cfg.readPct / 100;

  // CDN
  const legitStatic = legit * sPct;
  const legitDyn = legit - legitStatic;
  const cdnIn = cfg.cdn ? legitStatic : 0;
  const cdnServed = cdnIn * 0.95;
  const originStatic = legitStatic - cdnServed;

  // Gateway / rate limiter
  const gwIn = originStatic + legitDyn + bot;
  const blocked = cfg.gateway ? bot * 0.95 : 0;
  const gwCap = cfg.gateway ? GW_CAP * R : Infinity;
  const gwErr = Math.max(0, gwIn - gwCap);
  const gwOut = gwIn - blocked - gwErr * ((gwIn - blocked) / gwIn || 0);
  const botPass = bot - blocked;

  // Load balancer
  const lbCap = cfg.lb ? LB_NODE_CAP * cfg.lbNodes * R : Infinity;
  const lbErr = Math.max(0, gwOut - lbCap);
  const appIn = gwOut - lbErr;
  const effServers = (cfg.lb ? activeServers : 1) * R;
  const idleServers = cfg.lb ? 0 : activeServers - 1;
  const staticShare = gwIn ? originStatic / gwIn : 0;
  const appStatic = appIn * staticShare;
  const appDyn = appIn - appStatic;
  const appWork = appDyn + appStatic * 0.3;

  // App tier
  const sc = serverCapacity(cfg.vcpu, cfg.ram);
  const sticky = cfg.sessions === 'sticky' || (cfg.lb && cfg.lbAlgo === 'ip-hash');
  const balance = effServers > 1 ? (sticky ? 0.85 : cfg.lbAlgo === 'least-conn' ? 1.04 : 1) : 1;
  const appCapBase = effServers * sc.cap * balance;

  // DB
  const db = dbNode(cfg, users);
  const S = cfg.shards;
  const Rp = cfg.replicas;
  const ws = db.ws;
  const hit = cfg.cache ? Math.min(0.96, 1 - Math.exp(-cfg.cacheGb / (ws / 3))) : 0;
  const cacheCap = cfg.cache ? CACHE_CAP_PER_32GB * Math.max(1, cfg.cacheGb / 32) * R : Infinity;

  const dataFlows = (appServedFrac) => {
    const dynServed = appDyn * appServedFrac;
    const reads = dynServed * rPct;
    const writes = dynServed - reads;
    const cacheIn = cfg.cache ? reads : 0;
    const cacheOverflow = Math.max(0, cacheIn - cacheCap);
    const dbReads = reads * (1 - hit) + cacheOverflow * hit;
    const workersCap = cfg.queue ? cfg.workers * WORKER_RPS : 0;
    const writeCap = S * db.writeCap;
    const replicaCap = Rp > 0 ? S * Rp * R * db.readCap : 0;
    const primaryReadCap = S * db.readCap;
    let dbWrites;
    if (cfg.queue) {
      dbWrites = (rt.backlog || 0) > 0 ? workersCap : Math.min(workersCap, writes);
      // workers back off when the primary is busy (backpressure), keeping ~5% headroom
      const readShare = Rp > 0 ? 0 : dbReads / primaryReadCap;
      dbWrites = Math.min(dbWrites, Math.max(0, 0.95 - readShare) * writeCap);
    } else dbWrites = writes;
    const primaryRho = dbWrites / writeCap + (Rp > 0 ? 0 : dbReads / primaryReadCap);
    const replicaRho = Rp > 0 ? dbReads / replicaCap : 0;
    const readRho = Rp > 0 ? replicaRho : primaryRho;
    return { dynServed, reads, writes, cacheIn, dbReads, dbWrites, workersCap, writeCap, replicaCap, primaryReadCap, primaryRho, replicaRho, readRho };
  };

  let appFrac = appWork > 0 ? Math.min(1, appCapBase / appWork) : 1;
  let d = dataFlows(appFrac);
  const dbRhoMax = Math.max(d.primaryRho, d.replicaRho);
  let cascade = 1;
  if (!cfg.breaker && dbRhoMax > 1) {
    cascade = Math.min(6, Math.pow(dbRhoMax, 1.3));
    appFrac = appWork > 0 ? Math.min(1, appCapBase / cascade / appWork) : 1;
    d = dataFlows(appFrac);
  }
  const appCap = appCapBase / cascade;
  const appRho = appCap > 0 ? appWork / appCap : Infinity;
  const appErr = appIn * (1 - appFrac);

  // Connections
  const perServer = 25;
  const connNeeded = cfg.pooler ? Math.min(60 * S, effServers * perServer) : effServers * perServer + (cfg.queue ? cfg.workers * 4 : 0);
  const connMax = db.maxConn * S;
  const connErrFrac = connNeeded > connMax ? (connNeeded - connMax) / connNeeded : 0;

  // Data errors
  const readErrFrac = d.readRho > 1 ? 1 - 1 / d.readRho : 0;
  const writeErrFrac = !cfg.queue && d.primaryRho > 1 ? 1 - 1 / d.primaryRho : 0;
  const dbBoundReads = d.dbReads;
  const dbBoundWrites = cfg.queue ? 0 : d.dbWrites;
  const dataErr =
    dbBoundReads * Math.min(1, readErrFrac + connErrFrac) +
    dbBoundWrites * Math.min(1, Math.max(writeErrFrac, d.primaryRho > 1 ? 1 - 1 / d.primaryRho : 0) + connErrFrac);

  // Queue
  const actualDrain = cfg.queue ? Math.min(d.dbWrites, d.writeCap * (d.primaryRho > 1 ? 1 / d.primaryRho : 1)) : 0;
  const queueGrowth = cfg.queue ? d.writes - actualDrain : 0;
  const backlog = rt.backlog || 0;
  const queueFull = backlog > 5_000_000;
  const queueErr = queueFull ? Math.max(0, queueGrowth) : 0;

  // Sessions
  const sessErr = cfg.sessions === 'memory' && effServers > 1 && !(cfg.lb && cfg.lbAlgo === 'ip-hash')
    ? d.dynServed * 0.35 * (1 - 1 / effServers)
    : 0;

  const served = Math.max(0, cdnServed + appIn * appFrac - dataErr - sessErr - queueErr);
  const errors = gwErr + lbErr + appErr + dataErr + queueErr + sessErr;
  const attempted = raw - blocked;
  const errRate = attempted > 0 ? Math.min(1, errors / attempted) : 0;

  // Latency
  const net = R >= 3 ? 35 : R === 2 ? 70 : 110;
  const appLat = 18 * q(appRho);
  const dbReadLat = (6 / db.ramFactor) * q(d.readRho);
  const readLat = cfg.cache ? 0.5 + (1 - hit) * dbReadLat : dbReadLat;
  const writeLat = cfg.queue ? 4 : 10 * q(d.primaryRho);
  const dynLat = net + (cfg.gateway ? 2 : 0) + (cfg.lb ? 1 : 0) + appLat + rPct * readLat + (1 - rPct) * writeLat + (cfg.sessions === 'shared' ? 1 : 0);
  const staticLat = cfg.cdn ? 22 : net + appLat * 0.4;
  const p50 = sPct * staticLat + (1 - sPct) * dynLat;
  const maxRho = Math.max(appRho, d.readRho, d.primaryRho, isFinite(lbCap) ? gwOut / lbCap : 0);
  let p95 = p50 * (1.7 + 3 * Math.pow(Math.min(maxRho, 1), 4));
  if (maxRho >= 1) p95 = Math.max(p95, 2000 + 4000 * Math.min(3, maxRho - 1));
  p95 = Math.min(p95, 30000);

  // Availability (rough)
  const singleServer = effServers <= 1;
  let avail = singleServer ? 0.995 : 0.9999;
  if (cfg.lb) avail *= cfg.lbNodes > 1 ? 0.99999 : 0.9995;
  avail *= Rp > 0 ? 0.9995 : 0.999;
  if (cfg.cache) avail *= 0.99995;
  if (R > 1) avail = 1 - Math.pow(1 - avail, R) * 3;
  avail = Math.min(0.999999, avail);

  const spofs = [];
  if (singleServer) spofs.push('Only one app server');
  if (cfg.lb && cfg.lbNodes < 2) spofs.push('Single load balancer node');
  if (Rp === 0) spofs.push('Database has no replica / standby');
  if (R === 1) spofs.push('Single region');

  // Cost ($/hr)
  const P = PRICES;
  const totalServers = activeServers * R;
  const mPerHr = (rps) => (rps * 3600) / 1e6; // millions of requests per hour
  const serverHr = P.vcpuHr * cfg.vcpu + P.ramGbHr * cfg.ram;
  const dbNodeHr = P.dbVcpuHr * cfg.dbVcpu + P.dbRamGbHr * cfg.dbRam;
  const dbNodes = S * (1 + Rp * R);
  const costItems = [
    { id: 'servers', label: 'App servers', on: true, hr: serverHr * totalServers,
      calc: `${totalServers} server${totalServers > 1 ? 's' : ''} × ($${P.vcpuHr}/vCPU·h × ${cfg.vcpu} vCPU + $${P.ramGbHr}/GB·h × ${cfg.ram} GB) = $${serverHr.toFixed(3)}/h each` },
    { id: 'lb', label: 'Load balancer', on: cfg.lb, hr: cfg.lb ? P.lbNodeHr * cfg.lbNodes * R + mPerHr(appIn) * P.lbPerMReq : 0,
      calc: `${cfg.lbNodes * R} node${cfg.lbNodes * R > 1 ? 's' : ''} × $${P.lbNodeHr}/h + ${fmt(mPerHr(appIn))}M req/h × $${P.lbPerMReq}/M` },
    { id: 'gateway', label: 'API gateway / rate limiter', on: cfg.gateway, hr: cfg.gateway ? P.gwHr * R + mPerHr(gwIn) * P.gwPerMReq : 0,
      calc: `${R} region${R > 1 ? 's' : ''} × $${P.gwHr}/h + ${fmt(mPerHr(gwIn))}M req/h × $${P.gwPerMReq}/M` },
    { id: 'cdn', label: 'CDN', on: cfg.cdn, hr: cfg.cdn ? mPerHr(cdnIn) * P.cdnPerMReq : 0,
      calc: `${fmt(mPerHr(cdnIn))}M req/h × $${P.cdnPerMReq}/M` },
    { id: 'cache', label: 'Cache', on: cfg.cache, hr: cfg.cache ? cfg.cacheGb * P.cacheGbHr * R : 0,
      calc: `${cfg.cacheGb} GB × ${R} region${R > 1 ? 's' : ''} × $${P.cacheGbHr}/GB·h` },
    { id: 'db', label: 'Database', on: true, hr: dbNodeHr * dbNodes + (cfg.pooler ? P.poolerHr * S : 0),
      calc: `${dbNodes} node${dbNodes > 1 ? 's' : ''} (${S} shard${S > 1 ? 's' : ''} × (1 primary + ${Rp} replica${Rp === 1 ? '' : 's'} × ${R} region${R > 1 ? 's' : ''})) × ($${P.dbVcpuHr}/vCPU·h × ${cfg.dbVcpu} + $${P.dbRamGbHr}/GB·h × ${cfg.dbRam})${cfg.pooler ? ` + pooler ${S} × $${P.poolerHr}/h` : ''}` },
    { id: 'queue', label: 'Queue + workers', on: cfg.queue, hr: cfg.queue ? P.queueHr + mPerHr(d.writes) * P.queuePerMMsg + cfg.workers * P.workerHr : 0,
      calc: `$${P.queueHr}/h + ${fmt(mPerHr(d.writes))}M msg/h × $${P.queuePerMMsg}/M + ${cfg.workers} workers × $${P.workerHr}/h` },
  ];
  const cost = Object.fromEntries(costItems.map((c) => [c.id, c.hr]));
  const costHr = costItems.reduce((a, c) => a + c.hr, 0);

  const tiers = {
    users: { label: 'Users', in: raw, cap: Infinity, rho: 0, lat: net },
    dns: { label: 'DNS', in: raw * 0.02, cap: Infinity, rho: 0, lat: 0 },
    cdn: { label: 'CDN', on: cfg.cdn, in: cdnIn, cap: Infinity, rho: 0, lat: 22, hit: 0.95 },
    gateway: { label: 'API Gateway', on: cfg.gateway, in: gwIn, cap: gwCap, rho: cfg.gateway ? gwIn / gwCap : 0, blocked, err: gwErr },
    lb: { label: 'Load Balancer', on: cfg.lb, in: gwOut, cap: lbCap, rho: cfg.lb ? gwOut / lbCap : 0, err: lbErr },
    app: { label: 'App Servers', on: true, in: appIn, work: appWork, cap: appCap, capBase: appCapBase, rho: appRho, err: appErr + sessErr, lat: appLat, perServer: sc, effServers, idleServers, cascade, sessErr },
    cache: { label: 'Cache', on: cfg.cache, in: d.cacheIn, cap: cacheCap, rho: cfg.cache ? d.cacheIn / cacheCap : 0, hit },
    db: { label: 'Database', on: true, reads: d.dbReads, writes: d.dbWrites, rho: Math.max(d.primaryRho, d.replicaRho, connNeeded / connMax), primaryRho: d.primaryRho, replicaRho: d.replicaRho, readRho: d.readRho, writeCap: d.writeCap, replicaCap: d.replicaCap, primaryReadCap: d.primaryReadCap, connNeeded, connMax, connErrFrac, err: dataErr, node: db, readLat, writeLat },
    queue: { label: 'Queue', on: cfg.queue, in: d.writes, drain: actualDrain, growth: queueGrowth, rho: cfg.queue ? (d.writes / Math.max(1, d.workersCap)) : 0, backlog, err: queueErr },
    workers: { label: 'Workers', on: cfg.queue, in: actualDrain, cap: d.workersCap, rho: cfg.queue ? Math.min(d.writes, d.workersCap) / Math.max(1, d.workersCap) : 0 },
  };
  for (const k in tiers) tiers[k].status = tiers[k].on === false ? 'off' : status(tiers[k].rho);
  if (tiers.db.connErrFrac > 0) tiers.db.status = 'broken';
  if (sessErr > 0 && tiers.app.status === 'green') tiers.app.status = 'amber';
  if (cfg.queue && backlog > 0 && queueGrowth > 0) tiers.queue.status = queueFull ? 'broken' : 'red';
  else if (cfg.queue) tiers.queue.status = backlog > 0 ? 'amber' : 'green';

  const flows = {
    'users-dns': raw * 0.02,
    'users-cdn': cdnIn,
    'users-gateway': gwIn,
    'gateway-lb': gwOut,
    'lb-app': appIn,
    'app-cache': d.cacheIn,
    'app-db': d.dbReads + (cfg.queue ? 0 : d.dbWrites),
    'app-queue': cfg.queue ? d.writes : 0,
    'queue-workers': actualDrain,
    'workers-db': actualDrain,
  };
  const edgeErr = {
    'users-gateway': gwIn ? (gwErr + blocked) / gwIn : 0,
    'gateway-lb': gwOut ? lbErr / gwOut : 0,
    'lb-app': appIn ? (appErr + sessErr) / appIn : 0,
    'app-db': (d.dbReads + d.dbWrites) ? dataErr / (d.dbReads + (cfg.queue ? 0 : d.dbWrites) || 1) : 0,
  };

  return {
    users, raw, bot, blocked, legit, served, errors, errRate, p50, p95, avail, spofs, cost, costHr, costItems,
    tiers, flows, edgeErr, maxRho, botPass,
  };
}

// ── Advisor ───────────────────────────────────────────────────────────────
export function advise(cfg, r) {
  const out = [];
  const t = r.tiers;
  const add = (severity, tier, title, detail, patch, label) => out.push({ severity, tier, title, detail, fix: patch ? { patch, label } : null });

  if (t.app.sessErr > 0) {
    add('critical', 'app', 'Users are being logged out', `Sessions live in each server’s memory, but the load balancer sends users to different servers. ~${pct(t.app.sessErr / Math.max(1, t.app.in))} of requests lose their session.`, { sessions: 'shared' }, 'Use shared session store (Redis)');
  }
  if (!cfg.lb && cfg.servers > 1) {
    add('critical', 'lb', `${cfg.servers - 1} servers are idle`, 'Without a load balancer, DNS points every user at one server. The others get no traffic.', { lb: true }, 'Add a load balancer');
  }
  if (t.db.connErrFrac > 0) {
    add('critical', 'db', 'Database out of connections', `${fmt(t.db.connNeeded)} connections requested but max_connections is ${fmt(t.db.connMax)}. Each app server holds its own pool. Errors: "too many clients".`, { pooler: true }, 'Add a connection pooler');
  }
  if (t.app.cascade > 1.05) {
    add('critical', 'app', 'Cascading failure', `The overloaded database makes app threads wait on timeouts, which cuts app capacity ~${t.app.cascade.toFixed(1)}×. Healthy requests fail too.`, { breaker: true }, 'Add circuit breakers');
  }
  if (t.lb.on && t.lb.rho > 0.8) {
    add(t.lb.rho >= 1 ? 'critical' : 'warn', 'lb', 'Load balancer saturated', `${pct(t.lb.rho)} of LB capacity.`, { lbNodes: Math.min(8, cfg.lbNodes + 1) }, 'Add LB node');
  }
  if (t.gateway.on && t.gateway.rho > 0.8) {
    add(t.gateway.rho >= 1 ? 'critical' : 'warn', 'gateway', 'Gateway saturated', 'A single-region gateway tops out around 250k rps. Spread traffic over more regions.', { regions: Math.min(3, cfg.regions + 1) }, 'Add a region');
  }
  if (t.app.rho >= 0.8) {
    const sev = t.app.rho >= 1 ? 'critical' : 'warn';
    const bound = t.app.perServer.bound;
    if (!cfg.cdn && cfg.staticPct >= 20) add(sev, 'cdn', 'Static files are eating app capacity', `${cfg.staticPct}% of requests are images, JS and CSS. A CDN serves ~95% of them from the edge.`, { cdn: true }, 'Add a CDN');
    if (!cfg.gateway && cfg.botPct >= 10) add(sev, 'gateway', 'Bots are using your capacity', `${cfg.botPct}% of traffic is abusive. A rate limiter blocks it before it reaches servers.`, { gateway: true }, 'Add rate limiter');
    if (cfg.autoscale) {
      if ((r.tiers.app.effServers / cfg.regions) >= cfg.asMax) add(sev, 'app', 'Auto-scaler hit its max', `Running ${cfg.asMax} servers, the configured ceiling.`, { asMax: Math.min(200, cfg.asMax * 2) }, `Raise max to ${Math.min(200, cfg.asMax * 2)}`);
      else add('info', 'app', 'Auto-scaler is catching up', 'New servers need ~60 s to boot. Sudden spikes outrun scaling, which is why queues and headroom matter.', null);
    } else if (!cfg.lb) {
      const nextV = VCPU_STEPS.find((v) => v > cfg.vcpu);
      if (bound === 'RAM') add(sev, 'app', 'App server is out of memory', 'Each in-flight request holds memory. Add RAM (scale up) or add servers (scale out).', { ram: RAM_STEPS.find((v) => v > cfg.ram) || cfg.ram }, 'Scale up RAM');
      else if (nextV && cfg.vcpu < 16) add(sev, 'app', 'App server CPU is saturated', 'Quickest fix: a bigger machine (vertical scaling). It has a ceiling, though.', { vcpu: nextV, ram: Math.max(cfg.ram, nextV * 2) }, `Scale up to ${nextV} vCPU`);
      add(sev, 'app', 'Scale out instead of up', 'Put several servers behind a load balancer: no ceiling, plus redundancy.', { lb: true, servers: Math.max(3, Math.ceil(cfg.servers * t.app.rho * 1.5)), sessions: 'shared' }, 'Add LB + servers');
    } else {
      if (bound === 'RAM') add(sev, 'app', 'Servers are memory-bound', `Each server is limited by RAM (${fmt(t.app.perServer.mem)} rps) before CPU (${fmt(t.app.perServer.cpu)} rps).`, { ram: RAM_STEPS.find((v) => v > cfg.ram) || cfg.ram }, 'More RAM per server');
      const need = Math.ceil(cfg.servers * t.app.rho * 1.4);
      add(sev, 'app', 'App tier at capacity', `${pct(t.app.rho)} utilised. You need ~${need} servers for headroom, or let auto-scaling handle it.`, { servers: Math.min(200, need) }, `Scale out to ${Math.min(200, need)}`);
      if (!cfg.autoscale) add('info', 'app', 'Traffic varies? Auto-scale', 'Let the fleet grow and shrink with load instead of sizing for peak.', { autoscale: true, asMax: Math.max(cfg.asMax, need * 2) }, 'Enable auto-scaling');
    }
  }
  if (t.db.readRho >= 0.75) {
    const sev = t.db.readRho >= 1 ? 'critical' : 'warn';
    if (!cfg.cache) add(sev, 'cache', 'Database is drowning in reads', `${cfg.readPct}% of traffic is reads. A cache absorbs most of them in memory.`, { cache: true, cacheGb: Math.max(4, Math.ceil(t.db.node.ws / 2)) }, 'Add a cache');
    else if (t.cache.hit < 0.85) add(sev, 'cache', 'Cache too small', `Hit rate ${pct(t.cache.hit)}: working set is ~${fmt(t.db.node.ws)} GB.`, { cacheGb: Math.min(512, cfg.cacheGb * 2) }, `Cache → ${Math.min(512, cfg.cacheGb * 2)} GB`);
    add(sev, 'db', 'Add read replicas', 'Replicas copy the primary and serve read-only queries.', { replicas: Math.min(8, cfg.replicas + Math.max(1, Math.ceil(t.db.readRho))) }, `Replicas → ${Math.min(8, cfg.replicas + Math.max(1, Math.ceil(t.db.readRho)))}`);
  }
  if (t.db.node.ramFactor < 0.9) {
    add('warn', 'db', 'Working set doesn’t fit in DB memory', `~${fmt(t.db.node.wsShard)} GB hot data per node vs ${cfg.dbRam} GB RAM, so queries hit disk.`, { dbRam: RAM_STEPS.find((v) => v > cfg.dbRam) || cfg.dbRam }, 'More DB RAM');
  }
  if (t.db.primaryRho >= 0.75) {
    const sev = t.db.primaryRho >= 1 ? 'critical' : 'warn';
    if (cfg.replicas === 0 && cfg.readPct > 50) add(sev, 'db', 'Primary does reads and writes', 'Move reads off the primary with a replica.', { replicas: 1 }, 'Add a replica');
    if (!cfg.queue) add(sev, 'queue', 'Writes are bursting the primary', 'Put writes on a queue: users get an instant ack and workers drain at a pace the DB can handle.', { queue: true, workers: 4 }, 'Add queue + workers');
    if (cfg.dbVcpu < 32) add(sev, 'db', 'Scale the database up', 'Bigger primary = more write throughput. Databases are the classic vertical-scaling case.', { dbVcpu: VCPU_STEPS.find((v) => v > cfg.dbVcpu), dbRam: Math.max(cfg.dbRam, (VCPU_STEPS.find((v) => v > cfg.dbVcpu) || cfg.dbVcpu) * 4) }, 'Bigger DB');
    else add(sev, 'db', 'Shard the database', 'One primary can only write so fast. Split data across shards to multiply write capacity.', { shards: Math.min(32, cfg.shards * 2), pooler: true }, `Shards → ${Math.min(32, cfg.shards * 2)}`);
  }
  if (cfg.queue && t.queue.growth > 0) {
    const sev = t.queue.backlog > 1e6 ? 'critical' : 'warn';
    if (t.workers.rho >= 0.99 && t.db.primaryRho < 0.9) add(sev, 'workers', 'Queue backlog growing', 'Workers can’t keep up. Add more workers.', { workers: Math.min(64, cfg.workers * 2) }, `Workers → ${Math.min(64, cfg.workers * 2)}`);
    else add(sev, 'db', 'Queue backlog growing: the DB can’t absorb writes', 'More workers would only push harder on the DB. Shard or scale the DB.', { shards: Math.min(32, cfg.shards * 2), pooler: true }, `Shards → ${Math.min(32, cfg.shards * 2)}`);
  }
  if (r.p95 > 400 && cfg.regions === 1 && r.users > 50000 && r.maxRho < 0.85) {
    add('info', 'dns', 'Users far away see slow responses', 'Network round trips dominate. Serve users from several regions (GeoDNS).', { regions: 2 }, 'Add a region');
  }
  if (!out.some((o) => o.severity !== 'info') && r.spofs.length) {
    const s = r.spofs[0];
    const patch = s.includes('app server') ? { lb: true, servers: Math.max(2, cfg.servers), sessions: 'shared' } : s.includes('load balancer') ? { lbNodes: 2 } : s.includes('replica') ? { replicas: 1 } : { regions: 2 };
    add('info', 'app', 'Healthy. Now remove single points of failure', `${r.spofs.join(' · ')}. One failure here means downtime.`, patch, 'Fix first SPOF');
  }
  const order = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

// Find the user count at which this architecture breaks.
export function findBreakingPoint(cfg) {
  const rtFor = (users) => ({ users, servers: cfg.autoscale ? cfg.asMax : cfg.servers, backlog: 0 });
  let u = 10;
  let prev = null;
  while (u < 2e9) {
    const r = compute(cfg, rtFor(u));
    const queueBreaks = cfg.queue && r.tiers.queue.growth > 0;
    if (r.errRate > 0.01 || r.p95 > 1500 || queueBreaks) {
      const t = r.tiers;
      const cand = [
        ['App servers', t.app.rho + (t.app.sessErr > 0 ? 5 : 0)],
        ['Load balancer', t.lb.on ? t.lb.rho : 0],
        ['API gateway', t.gateway.on ? t.gateway.rho : 0],
        ['DB primary (writes)', t.db.primaryRho],
        ['DB reads', t.db.readRho],
        ['DB connections', t.db.connNeeded / t.db.connMax],
        ['Queue (backlog)', queueBreaks ? 1.01 : 0],
      ].sort((a, b) => b[1] - a[1]);
      let reason = cand[0][0];
      if (t.app.sessErr > 0) reason = 'Sessions (in-memory sessions across servers)';
      return { users: prev ? (u + prev) / 2 : u, rps: r.raw, tier: reason, r };
    }
    prev = u;
    u = Math.ceil(u * 1.12);
  }
  return null;
}

export const fmt = (v) => {
  if (!isFinite(v)) return '∞';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  if (a >= 10) return Math.round(v).toString();
  return (Math.round(v * 10) / 10).toString();
};
export const pct = (v) => (isFinite(v) ? `${Math.round(v * 100)}%` : '∞');
export const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

export const SCENARIOS = [
  { id: 'mvp', name: 'Day 1 MVP', desc: 'One box, a few hundred users.', patch: { ...DEFAULT_CONFIG, users: 200 } },
  { id: 'growing', name: 'Growing startup', desc: '8k users hitting the single server. Fix it.', patch: { ...DEFAULT_CONFIG, users: 8000, vcpu: 4, ram: 8 } },
  { id: 'readheavy', name: 'Viral content site', desc: 'Read-heavy, global, 90% reads.', patch: { ...DEFAULT_CONFIG, users: 120000, readPct: 92, staticPct: 55, lb: true, servers: 10, vcpu: 4, ram: 8, sessions: 'shared' } },
  { id: 'iot', name: 'IoT telemetry', desc: 'Write-heavy firehose from devices.', patch: { ...DEFAULT_CONFIG, users: 300000, reqPerMin: 4, readPct: 10, staticPct: 0, botPct: 0, lb: true, servers: 20, vcpu: 4, ram: 8, sessions: 'shared', pooler: true } },
  { id: 'blackfriday', name: 'Black Friday', desc: 'Well built, then a 5× spike hits. Watch auto-scaling.', patch: { ...DEFAULT_CONFIG, users: 60000, lb: true, lbNodes: 2, servers: 8, vcpu: 8, ram: 16, autoscale: true, asMin: 8, asMax: 60, sessions: 'shared', cdn: true, gateway: true, cache: true, cacheGb: 32, dbVcpu: 16, dbRam: 64, replicas: 2, pooler: true, queue: true, workers: 8, breaker: true, pattern: 'spike' } },
  { id: 'planet', name: 'Planet scale', desc: 'Every pattern on. 10M users across 3 regions.', patch: { ...DEFAULT_CONFIG, users: 10_000_000, reqPerMin: 3, readPct: 90, regions: 3, cdn: true, gateway: true, lb: true, lbNodes: 4, servers: 90, vcpu: 16, ram: 32, autoscale: true, asMin: 60, asMax: 200, sessions: 'shared', cache: true, cacheGb: 256, dbVcpu: 32, dbRam: 128, replicas: 2, shards: 32, pooler: true, queue: true, workers: 128, breaker: true } },
];
