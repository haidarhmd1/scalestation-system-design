// "Look inside" a simulator station: what happens in software and hardware
// when one request passes through it. Flows reuse the Networking sequence
// diagram format: { actors, steps: [{ from, to, kind, msg, text, ms?, lost? }], oneWay }.
// Any text may be a function of ctx = { cfg, r, tech } to use the live setup.

import { fmt, pct } from '../sim/model.js';

const f = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '—');

// Which technology picker belongs to which station.
export const STATION_PICKER = {
  dns: 'dns', cdn: 'cdn', gateway: 'gateway', lb: 'lb', proxy: 'proxy',
  app: 'runtime', cache: 'cache', db: 'db', queue: 'queue', workers: 'workers',
};

// ── Flows ──────────────────────────────────────────────────────────────────
const FLOW = {
  users: {
    oneWay: 0.2,
    actors: [
      { id: 'u', label: 'You', sub: 'tap / click' },
      { id: 'm', label: 'Browser main thread', sub: 'JS · layout · paint' },
      { id: 'n', label: 'Network stack', sub: 'browser + OS' },
      { id: 'g', label: 'GPU', sub: 'compositor' },
    ],
    steps: [
      { from: 'u', to: 'm', kind: 'app', msg: 'click event', ms: 0.1, text: 'The OS turns your touch or click into an input event and hands it to the browser’s main thread.' },
      { from: 'm', to: 'm', kind: 'cpu', msg: 'run JS handler', ms: 3, text: 'Your front-end code runs: maybe updates state, then calls fetch("/api/products/42"). Anything slow here blocks scrolling and typing.' },
      { from: 'm', to: 'n', kind: 'http', msg: 'fetch()', ms: 0.2, text: 'The request goes to the browser’s network service, which reuses an open HTTPS connection to your site if it has one (otherwise DNS + TCP + TLS first).' },
      { from: 'n', to: 'n', kind: 'kernel', msg: 'wait for response', ms: 80, text: 'The whole backend journey you see on the map happens now: CDN, gateway, load balancer, app, cache, database. The main thread is free meanwhile.' },
      { from: 'n', to: 'm', kind: 'http', msg: '200 OK + JSON', ms: 0.2, text: 'The response arrives. The browser decompresses it and parses the JSON.' },
      { from: 'm', to: 'm', kind: 'cpu', msg: 'render: style → layout → paint', ms: 6, text: 'The page updates: recalculate styles, lay out boxes, paint pixels into layers.' },
      { from: 'm', to: 'g', kind: 'cpu', msg: 'layers', ms: 0.5, text: 'The GPU composites the layers into a frame. At 60 Hz the browser has ~16 ms per frame.' },
      { from: 'g', to: 'u', kind: 'app', msg: 'new frame on screen', ms: 8, text: 'You see the result. Users feel anything under ~100 ms as instant; over ~1 s they lose focus.' },
    ],
  },

  dns: {
    oneWay: 12,
    actors: [
      { id: 'b', label: 'User’s device', sub: 'stub resolver' },
      { id: 'r', label: 'Recursive resolver', sub: 'ISP / 1.1.1.1' },
      { id: 'e', label: '{tech}', sub: 'nearest anycast edge' },
      { id: 'h', label: 'Health checkers', sub: 'probe your endpoints' },
    ],
    steps: [
      { from: 'h', to: 'h', kind: 'local', msg: 'probe /health every 10–30 s', ms: 0, text: 'Independently of any user, the provider’s health checkers in several locations keep probing your endpoints and mark them healthy or not.' },
      { from: 'b', to: 'r', kind: 'dns', msg: 'A? app.example.com', text: 'The OS asks its configured resolver (UDP port 53). Browser and OS caches missed.' },
      { from: 'r', to: 'r', kind: 'local', msg: 'cache miss (TTL expired)', ms: 0, text: 'The resolver last cached your record more than TTL seconds ago, so it must ask your authoritative DNS. (It already knows which name servers from the .com referral, cached for days.)' },
      { from: 'r', to: 'e', kind: 'dns', msg: 'A? app.example.com', text: 'Your name servers share an anycast IP: the same address is announced via BGP from many locations, so the packet lands at the nearest edge automatically.' },
      { from: 'e', to: 'e', kind: 'cpu', msg: 'lookup zone in RAM', ms: 0.05, text: 'The edge server keeps your hosted zone in memory, pushed out from a central control plane within seconds of a change. Lookup is a hash or tree search: microseconds.' },
      { from: 'e', to: 'e', kind: 'local', msg: 'apply routing policy', ms: 0.05, text: 'Simple, weighted, latency-based, geolocation or failover routing: pick which record to return for this resolver’s location, skipping endpoints the health checkers marked down.' },
      { from: 'e', to: 'r', kind: 'dns', msg: 'A 203.0.113.10  TTL 300', text: 'One small UDP packet back. Big answers (or DNSSEC) may switch to TCP.' },
      { from: 'r', to: 'b', kind: 'dns', msg: 'A 203.0.113.10', text: 'The resolver caches the answer for TTL seconds and replies. Every other user of this resolver now skips the trip.' },
    ],
  },

  cdn: {
    oneWay: 8,
    actors: [
      { id: 'u', label: 'User' },
      { id: 'p', label: '{tech} edge PoP', sub: 'nearest city' },
      { id: 's', label: 'Origin shield', sub: 'regional cache' },
      { id: 'o', label: 'Your origin', sub: 'LB / object storage' },
    ],
    steps: [
      { from: 'u', to: 'p', kind: 'http', msg: 'GET /static/app.3f9c.js', text: 'DNS or anycast sent the user to the closest point of presence (PoP), often <20 ms away. TLS ends here, at the edge.' },
      { from: 'p', to: 'p', kind: 'cpu', msg: 'hash(URL + Vary) → cache key', ms: 0.05, text: 'The edge builds a cache key from host, path, maybe query string and headers in Vary, then looks it up: first an in-RAM index, then NVMe SSDs holding the bulk of the cache.' },
      { from: 'p', to: 'u', kind: 'http', msg: 'HIT: 200 from SSD/RAM', text: 'About 95% of static requests stop here: served with sendfile-like zero-copy from memory or disk. Your servers never see them.' },
      { from: 'u', to: 'p', kind: 'http', msg: 'GET /static/new.js', text: 'A file nobody near this PoP has asked for yet.' },
      { from: 'p', to: 's', kind: 'http', msg: 'MISS → ask shield', ms: 10, text: 'Instead of every PoP hitting your origin, misses go to one regional “shield” cache first (request collapsing: 1,000 simultaneous misses become one origin fetch).' },
      { from: 's', to: 'o', kind: 'http', msg: 'MISS → origin fetch', ms: 30, text: 'Only now does a request reach your infrastructure.' },
      { from: 'o', to: 's', kind: 'http', msg: '200 + Cache-Control: max-age=31536000', ms: 30, text: 'Your Cache-Control header decides how long edges may keep it. Hashed file names (app.3f9c.js) can be cached for a year.' },
      { from: 's', to: 'p', kind: 'http', msg: 'store + forward', ms: 10, text: 'Both the shield and the edge store a copy; least-recently-used objects get evicted when disks fill up.' },
      { from: 'p', to: 'u', kind: 'http', msg: '200 (now cached here)', text: 'The next user in this city gets a HIT.' },
    ],
  },

  gateway: {
    oneWay: 1,
    actors: [
      { id: 'c', label: 'Client' },
      { id: 'g', label: '{tech}', sub: 'plugin pipeline' },
      { id: 'k', label: 'Counter store', sub: 'Redis / local memory' },
      { id: 'b', label: 'Upstream', sub: 'load balancer' },
    ],
    steps: [
      { from: 'c', to: 'g', kind: 'http', msg: 'GET /api/orders  Authorization: Bearer …', text: 'The request enters the gateway’s pipeline: a fixed list of steps (plugins/filters) that run in order for every request.' },
      { from: 'g', to: 'g', kind: 'cpu', msg: 'match route, verify JWT signature', ms: 0.1, text: 'Find the route by host and path, then check authentication: verifying a JWT is pure CPU (an HMAC or RSA/ECDSA signature check), no database needed.' },
      { from: 'g', to: 'k', kind: 'app', msg: 'INCR rl:user42:minute', ms: 0.3, text: 'Rate limiting: increment this user’s counter for the current window (or take a token from their token bucket). A shared Redis makes the limit global across gateway nodes; local memory is faster but per-node.' },
      { from: 'k', to: 'g', kind: 'app', msg: '= 61 (limit 60)', ms: 0.3, text: 'Over the limit.' },
      { from: 'g', to: 'c', kind: 'http', msg: '429 Too Many Requests  Retry-After: 12', text: 'Rejected in under a millisecond, without touching your app. This is how bot traffic gets blocked cheaply.' },
      { from: 'c', to: 'g', kind: 'http', msg: 'next request (new minute)', text: 'A well-behaved client waits and retries.' },
      { from: 'g', to: 'k', kind: 'app', msg: 'INCR → 1', ms: 0.3, text: 'Within the limit.' },
      { from: 'g', to: 'b', kind: 'http', msg: 'forward + X-User-Id, X-Request-Id', text: 'Passed on, with identity and a request ID added so every later hop can log the same ID (tracing).' },
    ],
  },

  lb: {
    oneWay: 0.5,
    actors: [
      { id: 'c', label: 'Client' },
      { id: 'nic', label: 'NIC + kernel', sub: 'TCP stack' },
      { id: 'w', label: '{tech} worker', sub: 'event loop' },
      { id: 'a', label: 'App server', sub: 'healthy pool' },
    ],
    steps: [
      { from: 'c', to: 'nic', kind: 'tcp', msg: 'SYN / TLS ClientHello', ms: 10, text: 'Packets arrive at the network card, which copies them into RAM via DMA and raises an interrupt. The kernel’s TCP stack completes the handshake and puts the new connection in the listen queue (backlog).' },
      { from: 'nic', to: 'w', kind: 'kernel', msg: 'epoll: socket readable', ms: 0.01, text: 'One worker process per CPU core waits in epoll (Linux) or kqueue. The kernel wakes exactly one worker: “this socket has data.” No thread per connection: one worker juggles tens of thousands.' },
      { from: 'w', to: 'w', kind: 'cpu', msg: 'TLS decrypt (AES-NI)', ms: 0.05, text: 'TLS termination. The handshake uses public-key crypto (the expensive part); bulk data uses AES, accelerated by dedicated CPU instructions (AES-NI).' },
      { from: 'w', to: 'w', kind: 'cpu', msg: 'parse HTTP, pick server', ms: 0.01, text: 'Parse the request line and headers, match the route, choose a backend with the algorithm (round robin, least connections, hash) among servers that passed their last health check.' },
      { from: 'w', to: 'a', kind: 'http', msg: 'reuse keep-alive conn → GET /api…', text: 'Reuses an already open connection from the upstream pool, so there is no new handshake per request.' },
      { from: 'a', to: 'w', kind: 'http', msg: '200 OK', ms: 15, text: 'The app answers. Meanwhile this worker served thousands of other sockets.' },
      { from: 'w', to: 'nic', kind: 'kernel', msg: 'write() to socket buffer', ms: 0.01, text: 'The response is copied into the kernel socket buffer; the kernel segments it into TCP packets.' },
      { from: 'nic', to: 'c', kind: 'tcp', msg: 'encrypted response', ms: 10, text: 'Out through the NIC.' },
      { from: 'w', to: 'a', kind: 'http', msg: 'GET /health (every 5 s)', text: 'In the background the LB probes every server. Fail 3 in a row and the server leaves the pool until it recovers.' },
    ],
  },

  lb4: {
    oneWay: 0.5,
    actors: [
      { id: 'c', label: 'Client' },
      { id: 'l', label: '{tech}', sub: 'L4: packets only' },
      { id: 'a', label: 'App server' },
    ],
    steps: [
      { from: 'c', to: 'l', kind: 'tcp', msg: 'SYN to static IP :443', ms: 10, text: 'An L4 balancer never looks inside: it sees IPs, ports and TCP flags.' },
      { from: 'l', to: 'l', kind: 'cpu', msg: 'hash(5-tuple) → target', ms: 0.005, text: 'It hashes source IP, source port, destination IP, destination port and protocol to pick a target, and remembers this “flow” so every packet of the connection goes to the same server.' },
      { from: 'l', to: 'a', kind: 'tcp', msg: 'forward SYN (client IP preserved)', ms: 0.5, text: 'Packets are forwarded, often by specialised network hardware or kernel bypass software (millions of packets per second). The TCP handshake is between client and app server.' },
      { from: 'a', to: 'c', kind: 'tcp', msg: 'SYN-ACK… TLS… HTTP', ms: 10, text: 'TLS and HTTP happen end-to-end with your app (or the app’s proxy). The balancer can’t route by URL, can’t add headers and can’t see 500 errors.' },
      { from: 'c', to: 'l', kind: 'tcp', msg: 'data packets', ms: 10, text: 'Each packet is looked up in the flow table and forwarded: tiny, constant cost.' },
      { from: 'l', to: 'a', kind: 'tcp', msg: 'same flow → same server', ms: 0.5, text: 'Great for any TCP/UDP protocol: databases, MQTT, game servers, gRPC (but long-lived connections stay on one server).' },
    ],
  },

  proxy: {
    oneWay: 0.3,
    actors: [
      { id: 'c', label: 'Client / LB' },
      { id: 'k', label: 'Kernel', sub: 'sockets, page cache' },
      { id: 'p', label: '{tech} worker', sub: '1 per core' },
      { id: 'a', label: 'App process', sub: 'localhost:3000' },
    ],
    steps: [
      { from: 'c', to: 'k', kind: 'tcp', msg: 'request bytes (maybe slowly)', ms: 20, text: 'A slow mobile client may trickle its request in over hundreds of ms. The kernel buffers the bytes.' },
      { from: 'k', to: 'p', kind: 'kernel', msg: 'epoll wake-up', ms: 0.01, text: 'The proxy worker reads whatever arrived, stores it in its own buffer and goes back to other connections. Your app is not involved yet: slow clients cost the proxy a few KB, not an app thread.' },
      { from: 'p', to: 'k', kind: 'disk', msg: 'GET /logo.png → sendfile()', ms: 0.05, text: 'Static file? The proxy asks the kernel to send it straight from the page cache (RAM copy of the disk file) to the socket: zero-copy, the bytes never pass through the proxy’s memory.' },
      { from: 'k', to: 'c', kind: 'http', msg: '200 image/png', ms: 1, text: 'Done without the app.' },
      { from: 'p', to: 'a', kind: 'http', msg: 'complete request → upstream (keep-alive)', text: 'Dynamic request: only once fully received is it passed to the app, over a reused local connection. The app gets requests at full speed and is free quickly.' },
      { from: 'a', to: 'p', kind: 'http', msg: 'response JSON', ms: 15, text: 'The app answers fast and moves on; the proxy buffers the response.' },
      { from: 'p', to: 'p', kind: 'cpu', msg: 'gzip / brotli + TLS', ms: 0.3, text: 'Compression (often 70–90% smaller JSON/HTML) and encryption, using CPU the app doesn’t have to spend.' },
      { from: 'p', to: 'c', kind: 'http', msg: 'compressed response', ms: 20, text: 'Sent at whatever speed the client can take.' },
    ],
  },

  app_node: {
    oneWay: 0.05,
    actors: [
      { id: 'k', label: 'Kernel', sub: 'TCP + epoll' },
      { id: 'l', label: 'Event loop', sub: 'libuv · 1 thread' },
      { id: 'v', label: 'V8', sub: 'your JS' },
      { id: 'd', label: 'DB / cache', sub: 'over the network' },
    ],
    steps: [
      { from: 'k', to: 'l', kind: 'kernel', msg: 'socket readable', ms: 0.01, text: 'The kernel already finished the TCP work. libuv, sitting in epoll, learns that a socket has a full HTTP request waiting.' },
      { from: 'l', to: 'v', kind: 'cpu', msg: 'parse HTTP → call handler', ms: 0.05, text: 'Node’s C++ HTTP parser (llhttp) parses it and the event loop calls your route handler in V8, on the one and only JavaScript thread.' },
      { from: 'v', to: 'v', kind: 'cpu', msg: 'validate, business logic', ms: 0.3, text: 'Your synchronous code runs. V8 has JIT-compiled hot functions to machine code. While this runs, no other request in this process can make progress.' },
      { from: 'v', to: 'd', kind: 'tcp', msg: 'await db.query(…)', ms: 0.3, text: 'An await on I/O: the query is written to a socket and your function is parked as a Promise. The thread is immediately free.' },
      { from: 'l', to: 'v', kind: 'cpu', msg: 'meanwhile: 50 other requests', ms: 2, text: 'This is Node’s trick: while one request waits on the database, the same thread runs other requests’ code. Thousands of concurrent requests, one thread, as long as nobody hogs the CPU.' },
      { from: 'd', to: 'k', kind: 'tcp', msg: 'rows', ms: 3, text: 'The database answers over the network.' },
      { from: 'k', to: 'l', kind: 'kernel', msg: 'epoll: data ready', ms: 0.01, text: 'The event loop is told the DB socket has data, and queues the Promise continuation.' },
      { from: 'l', to: 'v', kind: 'cpu', msg: 'resume after await → JSON.stringify', ms: 0.2, text: 'Your handler continues after the await and serialises the response. Big JSON.stringify calls block the loop too.' },
      { from: 'v', to: 'k', kind: 'kernel', msg: 'res.end() → write()', ms: 0.02, text: 'Bytes go to the kernel socket buffer; the kernel sends them.' },
      { from: 'v', to: 'v', kind: 'mem', msg: 'GC (young generation)', ms: 1, text: 'Every request allocates objects. V8’s garbage collector frees short-lived ones in quick “scavenges”; big heaps cause longer pauses.' },
    ],
  },

  app_go: {
    oneWay: 0.05,
    actors: [
      { id: 'k', label: 'Kernel', sub: 'TCP + epoll' },
      { id: 'n', label: 'Go netpoller', sub: 'runtime' },
      { id: 'g', label: 'Goroutine', sub: 'one per request' },
      { id: 's', label: 'Scheduler', sub: 'G-M-P, 1 P per vCPU' },
      { id: 'd', label: 'DB / cache' },
    ],
    steps: [
      { from: 'k', to: 'n', kind: 'kernel', msg: 'new connection ready', ms: 0.01, text: 'The Go runtime’s netpoller wraps epoll. net/http accepts the connection.' },
      { from: 'n', to: 'g', kind: 'cpu', msg: 'go serve(conn)', ms: 0.002, text: 'A new goroutine per connection: it starts with a 2–8 KB stack (an OS thread needs ~1 MB), so 100,000 of them are fine.' },
      { from: 's', to: 'g', kind: 'cpu', msg: 'run on a free P', ms: 0.01, text: 'The scheduler runs goroutines on GOMAXPROCS logical processors (P), one per vCPU, each backed by an OS thread (M). Your handler code runs truly in parallel on all cores.' },
      { from: 'g', to: 'd', kind: 'tcp', msg: 'db.QueryRow(…) (looks blocking)', ms: 0.3, text: 'You write plain blocking code. Under the hood the runtime parks the goroutine and registers the socket with the netpoller.' },
      { from: 's', to: 's', kind: 'cpu', msg: 'run other goroutines', ms: 2, text: 'The thread is not blocked: the scheduler runs other ready goroutines on it. Idle Ps “steal” work from busy ones.' },
      { from: 'd', to: 'n', kind: 'tcp', msg: 'rows arrive', ms: 3, text: 'The netpoller sees the socket is readable and marks the goroutine runnable.' },
      { from: 'g', to: 'g', kind: 'cpu', msg: 'encode JSON, write response', ms: 0.2, text: 'The goroutine continues where it left off. Compiled machine code, no JIT warm-up.' },
      { from: 'g', to: 'g', kind: 'mem', msg: 'concurrent GC', ms: 0.3, text: 'Go’s garbage collector runs concurrently with your code, usually with sub-millisecond pauses, using up to ~25% of CPU while active.' },
    ],
  },

  app_threads: {
    oneWay: 0.05,
    actors: [
      { id: 'k', label: 'Kernel', sub: 'TCP' },
      { id: 'a', label: 'Acceptor', sub: 'NIO / Kestrel / Puma' },
      { id: 't', label: 'Worker thread', sub: 'from a pool' },
      { id: 'd', label: 'DB / cache' },
    ],
    steps: [
      { from: 'k', to: 'a', kind: 'kernel', msg: 'request ready', ms: 0.01, text: 'The server’s acceptor (non-blocking I/O) reads the request.' },
      { from: 'a', to: 't', kind: 'cpu', msg: 'hand to pool thread', ms: 0.02, text: 'A thread from a fixed pool (Tomcat defaults to 200, Puma to a few per process) takes the request and owns it until the response is sent.' },
      { from: 't', to: 't', kind: 'cpu', msg: 'framework + your code', ms: 0.5, text: 'Routing, deserialisation, your logic. On the JVM / .NET hot code is JIT-compiled after warm-up, which is why the first minutes after a deploy are slower.' },
      { from: 't', to: 'd', kind: 'tcp', msg: 'query (thread blocks)', ms: 0.3, text: 'Classic blocking I/O: the thread sleeps until the answer arrives. It holds its ~1 MB stack and its pool slot while waiting.' },
      { from: 'd', to: 't', kind: 'tcp', msg: 'rows', ms: 3, text: 'The OS wakes the thread.' },
      { from: 't', to: 'k', kind: 'kernel', msg: 'write response', ms: 0.05, text: 'Response written, thread back to the pool.' },
      { from: 't', to: 't', kind: 'mem', msg: 'GC (G1 / ZGC / .NET GC)', ms: 1, text: 'Garbage collection, mostly concurrent nowadays. If the database is slow, threads pile up waiting and the pool runs dry: requests queue even with idle CPU. Java 21 virtual threads and .NET async/await avoid this.' },
    ],
  },

  app_python: {
    oneWay: 0.05,
    actors: [
      { id: 'k', label: 'Kernel', sub: 'TCP' },
      { id: 'm', label: 'Gunicorn / Uvicorn', sub: 'master + N workers' },
      { id: 'w', label: 'Worker process', sub: 'own interpreter + GIL' },
      { id: 'd', label: 'DB / cache' },
    ],
    steps: [
      { from: 'm', to: 'm', kind: 'local', msg: 'fork N workers (≈ 2 × vCPU + 1)', ms: 0, text: 'At start the master process forks several worker processes. Each has its own Python interpreter and memory, so N workers use N × the RAM.' },
      { from: 'k', to: 'w', kind: 'kernel', msg: 'accept() on shared socket', ms: 0.01, text: 'All workers listen on the same socket; the kernel gives each new connection to one of them.' },
      { from: 'w', to: 'w', kind: 'cpu', msg: 'bytecode interpreter', ms: 1.5, text: 'CPython runs your code as bytecode, typically several times slower than compiled code. The GIL (global interpreter lock) lets only one thread per process run Python at a time, which is why you scale with processes.' },
      { from: 'w', to: 'd', kind: 'tcp', msg: 'await query (FastAPI / async)', ms: 0.3, text: 'With async (Uvicorn, asyncio) the worker serves other requests while waiting, like Node. With sync Django + Gunicorn the whole worker waits.' },
      { from: 'd', to: 'w', kind: 'tcp', msg: 'rows', ms: 3, text: 'Answer arrives.' },
      { from: 'w', to: 'k', kind: 'kernel', msg: 'send response', ms: 0.05, text: 'Done. CPU-heavy work (image resizing, ML) belongs in a queue + worker, or in C extensions that release the GIL (NumPy).' },
    ],
  },

  cache_redis: {
    oneWay: 0.25,
    actors: [
      { id: 'a', label: 'App server', sub: 'client lib + pool' },
      { id: 'k', label: 'Kernel', sub: 'TCP / epoll' },
      { id: 'r', label: '{tech} main thread', sub: 'single-threaded loop' },
      { id: 'm', label: 'RAM', sub: 'hash table + values' },
    ],
    steps: [
      { from: 'a', to: 'k', kind: 'tcp', msg: 'GET product:42  (RESP protocol)', text: 'A tiny text command over a long-lived TCP connection from the app’s connection pool.' },
      { from: 'k', to: 'r', kind: 'kernel', msg: 'epoll: readable', ms: 0.005, text: 'Redis runs one main thread in an event loop (newer versions add I/O threads for reading/writing sockets). Commands execute one at a time, so each one is atomic.' },
      { from: 'r', to: 'm', kind: 'mem', msg: 'hash(key) → bucket', ms: 0.0005, text: 'The key is hashed to find a slot in a giant in-memory hash table: O(1), well under a microsecond. Most of the time is spent in networking, not the lookup.' },
      { from: 'm', to: 'r', kind: 'mem', msg: 'value (or nil = miss)', ms: 0.0005, text: 'Hit: the value. Miss: nil, and the app will read the database and SET it with a TTL (cache-aside).' },
      { from: 'r', to: 'a', kind: 'tcp', msg: '$512 … bytes', text: 'Reply goes back. Round trip inside a data centre ≈ 0.2–0.5 ms.' },
      { from: 'r', to: 'r', kind: 'local', msg: 'expire / evict (allkeys-lru)', ms: 0, text: 'In the background Redis deletes expired keys, and when maxmemory is hit it evicts approximately least-recently-used keys.' },
      { from: 'r', to: 'r', kind: 'disk', msg: 'fork() for RDB snapshot / AOF fsync', ms: 0, text: 'Optional persistence: a forked child writes a snapshot using copy-on-write memory, or every write is appended to a log. Forking a huge instance can briefly stall it.' },
    ],
  },

  cache_memcached: {
    oneWay: 0.25,
    actors: [
      { id: 'a', label: 'App server', sub: 'client hashes key → node' },
      { id: 't', label: 'Memcached thread', sub: 'one of N' },
      { id: 'm', label: 'Slab memory', sub: 'fixed-size chunks' },
    ],
    steps: [
      { from: 'a', to: 'a', kind: 'cpu', msg: 'consistent hash(key) → node 3', ms: 0.001, text: 'Memcached servers don’t talk to each other: the client library decides which server holds each key with consistent hashing.' },
      { from: 'a', to: 't', kind: 'tcp', msg: 'get product:42', text: 'Request to that node; one of several worker threads (multi-threaded, unlike Redis’ single command thread) handles it.' },
      { from: 't', to: 'm', kind: 'mem', msg: 'hash table → slab chunk', ms: 0.0005, text: 'Values live in pre-allocated “slabs” of fixed-size chunks, which avoids memory fragmentation. Each slab class has its own LRU list.' },
      { from: 't', to: 'a', kind: 'tcp', msg: 'VALUE … END', text: 'Answer. No persistence, no data types beyond bytes: simple and very fast.' },
    ],
  },

  db_postgres: {
    oneWay: 0.25,
    actors: [
      { id: 'a', label: 'App / pooler', sub: 'reused connection' },
      { id: 'b', label: '{tech} backend', sub: 'parser · planner · executor' },
      { id: 'm', label: 'Shared buffers', sub: 'RAM page cache' },
      { id: 'w', label: 'WAL', sub: 'write-ahead log' },
      { id: 'd', label: 'Disk', sub: 'NVMe / EBS' },
    ],
    steps: [
      { from: 'a', to: 'b', kind: 'tcp', msg: 'SELECT … WHERE id = $1', text: 'In PostgreSQL every connection has its own backend process (~5–10 MB of RAM). That is why connection counts are limited and poolers like PgBouncer exist.' },
      { from: 'b', to: 'b', kind: 'cpu', msg: 'parse → plan (use index)', ms: 0.05, text: 'The query is parsed and the planner picks a strategy using table statistics: here, walk the B-tree index on id instead of scanning the whole table.' },
      { from: 'b', to: 'm', kind: 'mem', msg: 'read index + table pages (8 KB)', ms: 0.01, text: 'Data lives in 8 KB pages. Hot pages are in shared buffers (RAM). If the working set fits in RAM, reads never touch disk.' },
      { from: 'm', to: 'd', kind: 'disk', msg: 'cache miss → read page', ms: 0.1, text: 'A miss costs a disk read: ~0.1 ms on local NVMe, ~0.5–1 ms on network storage, 100× slower than RAM. This is why DB RAM matters so much.' },
      { from: 'b', to: 'a', kind: 'tcp', msg: 'row', text: 'Result rows go back over the connection.' },
      { from: 'a', to: 'b', kind: 'tcp', msg: 'INSERT INTO orders … COMMIT', text: 'A write.' },
      { from: 'b', to: 'm', kind: 'mem', msg: 'new row version (MVCC)', ms: 0.02, text: 'MVCC: instead of overwriting, Postgres writes a new version of the row, so readers never wait for writers. Old versions are cleaned up later by VACUUM.' },
      { from: 'b', to: 'w', kind: 'disk', msg: 'append WAL record', ms: 0.01, text: 'The change is first appended to the write-ahead log, a sequential file. Sequential writes are fast.' },
      { from: 'w', to: 'd', kind: 'disk', msg: 'fsync on COMMIT', ms: 0.5, text: 'COMMIT waits until the WAL is physically on disk (fsync). That durability flush is often the real limit on writes per second; group commit batches many transactions into one flush.' },
      { from: 'b', to: 'a', kind: 'tcp', msg: 'COMMIT OK', text: 'Durable. The changed table pages are written to disk later by the checkpointer. Replicas receive the same WAL stream and replay it.' },
    ],
  },

  db_lsm: {
    oneWay: 0.4,
    actors: [
      { id: 'a', label: 'App', sub: 'driver' },
      { id: 'c', label: 'Coordinator node', sub: 'any node' },
      { id: 'r', label: '3 replica nodes', sub: 'chosen by token ring' },
      { id: 'd', label: 'Memtable + SSTables', sub: 'LSM tree' },
    ],
    steps: [
      { from: 'a', to: 'c', kind: 'tcp', msg: 'INSERT … USING CONSISTENCY QUORUM', text: 'There is no primary: the client sends the write to any node, which acts as coordinator.' },
      { from: 'c', to: 'c', kind: 'cpu', msg: 'hash(partition key) → token', ms: 0.005, text: 'The partition key is hashed onto a ring; the token decides which 3 nodes (replication factor 3) own this row.' },
      { from: 'c', to: 'r', kind: 'tcp', msg: 'write to all 3 replicas', text: 'Sent to all replicas in parallel.' },
      { from: 'r', to: 'd', kind: 'disk', msg: 'append commit log + memtable', ms: 0.05, text: 'Each replica appends to a commit log (sequential) and inserts into an in-memory sorted table. No reading, no in-place update: that is why writes are so fast.' },
      { from: 'r', to: 'c', kind: 'tcp', msg: '2 of 3 acks = quorum', text: 'With QUORUM the coordinator answers once 2 of 3 replicas confirmed. The third catches up later (hinted handoff, repair).' },
      { from: 'c', to: 'a', kind: 'tcp', msg: 'OK', text: 'Done.' },
      { from: 'd', to: 'd', kind: 'disk', msg: 'flush memtable → SSTable, compact', ms: 0, text: 'Full memtables are flushed as immutable sorted files (SSTables). Background compaction merges them. Reads may check several files, helped by Bloom filters in RAM.' },
    ],
  },

  db_dynamo: {
    oneWay: 0.5,
    actors: [
      { id: 'a', label: 'App', sub: 'AWS SDK (HTTPS)' },
      { id: 'q', label: 'Request router', sub: 'auth + metadata' },
      { id: 'l', label: 'Partition leader', sub: 'storage node' },
      { id: 'f', label: '2 followers', sub: 'other AZs' },
    ],
    steps: [
      { from: 'a', to: 'q', kind: 'http', msg: 'PutItem (signed HTTPS)', text: 'Every call is an HTTPS API request, signed with your AWS credentials.' },
      { from: 'q', to: 'q', kind: 'cpu', msg: 'hash(partition key) → partition', ms: 0.05, text: 'A stateless request router authenticates you, checks your capacity and finds which partition (≈ 10 GB, ≈ 1,000 writes/s each) holds this key.' },
      { from: 'q', to: 'l', kind: 'tcp', msg: 'write', text: 'To the partition’s leader replica.' },
      { from: 'l', to: 'f', kind: 'tcp', msg: 'replicate (Paxos)', ms: 1, text: 'Replicated to storage nodes in other availability zones; the write is acknowledged once a majority have it logged.' },
      { from: 'l', to: 'a', kind: 'http', msg: '200', ms: 1, text: 'Single-digit milliseconds at any scale, as long as keys are spread evenly. A “hot” key still hits one partition’s limit.' },
    ],
  },

  queue_broker: {
    oneWay: 0.3,
    actors: [
      { id: 'a', label: 'App (producer)' },
      { id: 'b', label: '{tech}', sub: 'broker' },
      { id: 's', label: 'Storage', sub: 'RAM + disk' },
      { id: 'w', label: 'Worker (consumer)' },
    ],
    steps: [
      { from: 'a', to: 'b', kind: 'tcp', msg: 'enqueue {orderId: 42}', text: 'The app serialises a small job (usually IDs, not whole objects) and hands it to the broker.' },
      { from: 'b', to: 's', kind: 'disk', msg: 'persist message', ms: 0.2, text: 'The broker stores it durably (written to disk or replicated) before confirming. That confirmation is what lets the app safely reply “202 Accepted”.' },
      { from: 'b', to: 'a', kind: 'tcp', msg: 'ack', text: 'The app’s request is done. The slow work happens later.' },
      { from: 'w', to: 'b', kind: 'tcp', msg: 'fetch next (long poll)', text: 'Workers pull jobs when they have capacity: this is natural backpressure, a busy worker simply doesn’t ask.' },
      { from: 'b', to: 'w', kind: 'tcp', msg: 'job 42 (invisible to others)', text: 'The job is leased to this worker: hidden from others for a timeout (SQS visibility timeout, RabbitMQ unacked, BullMQ lock).' },
      { from: 'w', to: 'w', kind: 'cpu', msg: 'process (idempotent)', ms: 20, text: 'The worker does the work: write to DB, send email, resize image.' },
      { from: 'w', to: 'b', kind: 'tcp', msg: 'ack → delete', text: 'Only after success is the job removed. If the worker crashes first, the lease expires and another worker gets it: at-least-once delivery, so processing must be idempotent.' },
    ],
  },

  queue_kafka: {
    oneWay: 0.3,
    actors: [
      { id: 'a', label: 'Producer' },
      { id: 'l', label: 'Partition leader', sub: 'broker' },
      { id: 'f', label: 'Followers', sub: 'replicas' },
      { id: 'c', label: 'Consumer group' },
    ],
    steps: [
      { from: 'a', to: 'a', kind: 'cpu', msg: 'hash(key) → partition 7, batch', ms: 0.01, text: 'The producer library picks a partition by key (same key → same partition → ordered) and batches messages for throughput.' },
      { from: 'a', to: 'l', kind: 'tcp', msg: 'produce batch', text: 'Sent to the partition’s leader broker.' },
      { from: 'l', to: 'l', kind: 'disk', msg: 'append to log segment (page cache)', ms: 0.05, text: 'Kafka just appends bytes to the end of a file. The OS page cache absorbs the write; sequential I/O is why one broker handles hundreds of MB/s.' },
      { from: 'f', to: 'l', kind: 'tcp', msg: 'fetch + replicate', ms: 0.5, text: 'Followers copy the log. With acks=all the write is confirmed once all in-sync replicas have it.' },
      { from: 'l', to: 'a', kind: 'tcp', msg: 'ack (offset 1,234,567)', text: 'Every message gets an offset: its position in the partition log.' },
      { from: 'c', to: 'l', kind: 'tcp', msg: 'fetch from offset', text: 'Consumers read from their own position. Messages are not deleted on read: they stay for the retention period and can be replayed.' },
      { from: 'l', to: 'c', kind: 'tcp', msg: 'sendfile() batch', ms: 0.3, text: 'Served with zero-copy from page cache to socket.' },
      { from: 'c', to: 'l', kind: 'tcp', msg: 'commit offset', text: 'The consumer group records how far it got. One partition is read by one consumer in a group, so partitions cap parallelism.' },
    ],
  },

  workers: {
    oneWay: 0.3,
    actors: [
      { id: 'q', label: 'Queue' },
      { id: 'w', label: '{tech}', sub: 'concurrency N' },
      { id: 'd', label: 'Database' },
    ],
    steps: [
      { from: 'w', to: 'q', kind: 'tcp', msg: 'take job (lease 30 s)', text: 'Each worker process runs N jobs at once (threads, async tasks or goroutines) and asks for more only when a slot is free.' },
      { from: 'q', to: 'w', kind: 'tcp', msg: 'job 42: save order', text: 'Got one.' },
      { from: 'w', to: 'd', kind: 'tcp', msg: 'INSERT … ON CONFLICT (order_id) DO NOTHING', ms: 1, text: 'Idempotent write: running the same job twice leaves the same result. Essential because queues deliver at least once.' },
      { from: 'd', to: 'w', kind: 'tcp', msg: 'timeout (DB overloaded)', lost: true, text: 'The database is busy and the call fails.' },
      { from: 'w', to: 'q', kind: 'tcp', msg: 'nack: retry in 2s, 4s, 8s…', text: 'Exponential backoff with jitter: retry later and slower, so a struggling database gets breathing room instead of a retry storm.' },
      { from: 'q', to: 'w', kind: 'tcp', msg: 'job 42 (attempt 2)', ms: 2000, text: 'Back after the delay.' },
      { from: 'w', to: 'd', kind: 'tcp', msg: 'INSERT … (succeeds)', ms: 1, text: 'Works this time.' },
      { from: 'w', to: 'q', kind: 'tcp', msg: 'ack', text: 'Removed from the queue. After too many failures a job goes to a dead-letter queue for a human to look at.' },
    ],
  },
};

// ── Station explanations ───────────────────────────────────────────────────
const runtimeFlow = { node: 'app_node', go: 'app_go', python: 'app_python', java: 'app_threads', dotnet: 'app_threads', rails: 'app_threads' };
const dbFlow = { postgres: 'db_postgres', mysql: 'db_postgres', aurora: 'db_postgres', mongodb: 'db_postgres', cockroach: 'db_postgres', cassandra: 'db_lsm', dynamodb: 'db_dynamo' };
const cacheFlow = { memcached: 'cache_memcached' };
const queueFlow = { kafka: 'queue_kafka' };

export const INSIDE = {
  users: {
    title: 'Inside the user’s device',
    summary: 'Before any of your servers work, the user’s browser or app turns a tap into a network request, and afterwards turns bytes back into pixels.',
    flow: () => 'users',
    software: [
      ['Browser main thread', 'Runs JavaScript, calculates styles and layout, and paints. One thread: heavy JS makes the whole page feel stuck.'],
      ['Network service', 'Keeps a pool of HTTPS connections per site, a DNS cache and the HTTP cache. A repeat visit can skip DNS, TCP and TLS entirely.'],
      ['Caches', 'Memory cache, disk cache and service workers can answer requests without the network at all, if your headers allow it.'],
    ],
    hardware: [
      ['CPU', 'Phones are 3–5× slower than laptops at running JavaScript. A bundle that parses in 50 ms on your Mac takes 250 ms on a mid-range Android.'],
      ['Radio', 'Mobile networks add 30–100 ms latency and lose packets. Waking the radio from idle can cost extra hundreds of ms.'],
      ['GPU', 'Composites layers into frames; smooth scrolling needs a new frame every 16 ms (60 Hz).'],
    ],
    live: ({ r }) => [['Online users', fmt(r.users)], ['Requests per second', `${fmt(r.raw)}/s`]],
  },

  dns: {
    title: 'Inside {tech}',
    summary: 'Authoritative DNS answers “what is the IP of your domain?” from servers all over the world, then lets resolvers cache that answer.',
    flow: () => 'dns',
    software: [
      ['Control plane', 'Your records (zone) are stored centrally and pushed to every edge location. A change reaches all edges in seconds; reaching users takes up to the old TTL, because resolvers cache.'],
      ['Data plane', 'Edge servers answer queries from memory. A query is one small UDP packet in and one out, so a single server answers hundreds of thousands per second.'],
      ['Routing policies', 'Instead of one fixed answer, the edge can pick per query: by latency, geography, weight (canary releases) or health (failover).'],
    ],
    hardware: [
      ['Anycast + BGP', 'The same IP address is announced from many data centres; internet routing delivers each packet to the nearest one. That gives low latency and soaks up DDoS traffic across many sites.'],
      ['RAM', 'Whole zones live in memory; disk is only used to load them.'],
      ['Network', 'Mostly packets per second, not bandwidth: DNS answers are tiny.'],
    ],
    live: ({ cfg, r }) => [['Regions', cfg.regions], ['DNS lookups reaching it', `${fmt(r.flows['users-dns'])}/s`], ['TTL', '300 s']],
  },

  cdn: {
    title: 'Inside the {tech} edge',
    summary: 'A CDN is a huge distributed cache: hundreds of locations with racks of servers full of SSDs and RAM, keeping copies of your files close to users.',
    flow: () => 'cdn',
    software: [
      ['Cache key & rules', 'URL plus selected headers becomes the key. Cache-Control from your origin decides how long a copy is fresh.'],
      ['Tiered caching', 'Edge → regional shield → origin. Request collapsing turns many simultaneous misses into one origin fetch.'],
      ['Edge compute', 'Rules, WAF and small functions (Workers, Lambda@Edge, Compute) run before the cache: redirects, auth, A/B tests.'],
      ['Purge', 'Invalidate a URL or tag everywhere; it takes ~150 ms on Fastly, seconds to minutes elsewhere. Hashed file names avoid needing purges at all.'],
    ],
    hardware: [
      ['NVMe SSDs + RAM', 'The hottest objects stay in RAM, the long tail on fast SSDs. Each PoP holds terabytes.'],
      ['Network', 'Edge servers push tens to hundreds of Gbit/s each, and sit inside or next to ISPs to keep paths short.'],
      ['Kernel tricks', 'Zero-copy sending (sendfile, kTLS), so file bytes go from disk cache to network card without extra copies.'],
    ],
    live: ({ r }) => [['Static requests at the edge', `${fmt(r.tiers.cdn.in)}/s`], ['Edge hit rate', '95%']],
  },

  gateway: {
    title: 'Inside {tech}',
    summary: 'An API gateway runs every request through a pipeline of checks (routing, auth, quotas, transformation) before it is allowed near your servers.',
    flow: () => 'gateway',
    software: [
      ['Plugin pipeline', 'Each route has an ordered list of plugins/filters: authentication, rate limiting, request size limits, CORS, logging, transformation.'],
      ['Rate limiting algorithms', 'Fixed window (simple counter per minute), sliding window (smoother) or token bucket (allows short bursts). Counters live in local memory or a shared Redis.'],
      ['Auth', 'API keys are looked up in a cache; JWTs are verified by checking a signature with the public key, without any network call.'],
    ],
    hardware: [
      ['CPU', 'Mostly signature checks, TLS and header parsing: microseconds each, but at hundreds of thousands of requests per second this is the cost.'],
      ['Network', 'A shared Redis for counters adds ~0.3 ms per request; some gateways sync counters asynchronously to avoid it.'],
    ],
    live: ({ r }) => [['Load', pct(r.tiers.gateway.rho)], ['Coming in', `${fmt(r.tiers.gateway.in)}/s`], ['Blocked (429)', `${fmt(r.tiers.gateway.blocked)}/s`]],
  },

  lb: {
    title: 'Inside {tech}',
    summary: 'A load balancer accepts connections from clients and spreads requests across healthy app servers. Software ones use a few event-driven worker processes; managed ones are fleets of these behind the scenes.',
    flow: ({ techId }) => (techId === 'nlb' ? 'lb4' : 'lb'),
    software: [
      ['Event loop workers', 'One worker per CPU core, each handling thousands of connections with epoll. No thread per connection, so memory stays small.'],
      ['Algorithms', ({ cfg }) => `You picked “${cfg.lbAlgo}”. Round robin rotates; least connections favours the least busy server (best for uneven requests); IP hash keeps a client on one server.`],
      ['Health checks', 'Active checks (call /health every few seconds) and passive ones (count errors on real traffic) remove sick servers from the pool.'],
      ['Connection reuse', 'Client connections end at the LB; upstream connections to app servers are pooled and reused.'],
    ],
    hardware: [
      ['NIC', 'The network card writes packets into RAM directly (DMA) and spreads them across CPU cores (RSS queues), so all cores share the work.'],
      ['CPU', 'TLS is the big cost: handshakes use RSA/ECDSA, data uses AES with hardware acceleration (AES-NI).'],
      ['RAM', 'A few KB per open connection for buffers: a million idle connections fit in a few GB.'],
    ],
    live: ({ cfg, r }) => [['Nodes', cfg.lbNodes], ['Load', pct(r.tiers.lb.rho)], ['Requests', `${fmt(r.tiers.lb.in)}/s`], ['Algorithm', cfg.lbAlgo]],
  },

  proxy: {
    title: 'Inside {tech}',
    summary: 'A reverse proxy sits on each app server in front of your app process and does the generic, repetitive work so your code only sees complete, clean requests.',
    flow: () => 'proxy',
    software: [
      ['Master + workers', 'A master process reads config and manages workers; each worker is single-threaded and event-driven. Config reloads start new workers without dropping connections.'],
      ['Buffering', 'Reads the whole request and response, so a slow client never ties up an app thread or event loop.'],
      ['Static files', 'Served straight from disk via the kernel page cache with sendfile().'],
      ['Compression & TLS', 'gzip/brotli and HTTPS handled here, not in your app.'],
    ],
    hardware: [
      ['Page cache (RAM)', 'Frequently served files stay in the kernel’s RAM cache, so “disk” reads are actually memory reads.'],
      ['CPU', 'Compression and TLS take some CPU on the same machine as your app, which is why the simulator takes a small slice of each server for the proxy.'],
    ],
    live: ({ r }) => [['Load', pct(r.tiers.proxy.rho)], ['Static served locally', `${fmt(r.tiers.proxy.staticServed)}/s`]],
  },

  app: {
    title: 'Inside {tech}',
    summary: ({ cfg }) => `Each app server is a virtual machine with ${cfg.vcpu} vCPU and ${cfg.ram} GB RAM. Here is how the runtime turns one request into CPU work and network calls, and why the server tops out where it does.`,
    flow: ({ techId }) => runtimeFlow[techId] || 'app_threads',
    software: [
      ['Concurrency model', ({ techId, cfg }) => ({
        node: `One JavaScript thread per process. To use all ${cfg.vcpu} vCPU you run ${cfg.vcpu} processes (Node cluster, PM2, or ${cfg.vcpu} containers). I/O waits are cheap; CPU-heavy code blocks everyone in that process.`,
        go: `Goroutines on GOMAXPROCS = ${cfg.vcpu} OS threads. One process uses all cores; blocking calls are cheap because the runtime parks goroutines, not threads.`,
        python: `CPython’s GIL allows one running thread per process, so Gunicorn/Uvicorn starts several worker processes (about 2 × ${cfg.vcpu} + 1 = ${2 * cfg.vcpu + 1}). Each worker costs its own RAM.`,
        java: 'A pool of OS threads, one per in-flight request (Tomcat default 200). Java 21 virtual threads make blocking cheap like goroutines.',
        dotnet: 'Kestrel with async/await on the .NET thread pool: threads are released while awaiting I/O.',
        rails: 'Puma: a few processes × a few threads each. Ruby’s GVL lets one thread run Ruby at a time per process; threads still help while waiting on I/O.',
      }[techId] || 'A pool of threads or processes handles requests concurrently.')],
      ['Memory', ({ cfg }) => `${cfg.ram} GB holds the runtime, your code, every in-flight request’s data, connection pools and in-process caches. The garbage collector reclaims it; too little RAM means frequent GC pauses or out-of-memory kills.`],
      ['Connection pools', 'Each process keeps a few open connections to the database and cache. Servers × processes × pool size is how fast you hit the database’s connection limit.'],
      ['Why ~120 req/s per vCPU', 'A typical API request spends a few ms of CPU on parsing, logic, serialisation, logging and TLS. 1,000 ms ÷ ~8 ms ≈ 120. A trivial endpoint does thousands; a heavy one, tens.'],
    ],
    hardware: [
      ['vCPU', ({ cfg }) => `A vCPU is usually one hyper-thread of a physical core on a shared host: ${cfg.vcpu} vCPU ≈ ${Math.max(1, cfg.vcpu / 2)} physical core${cfg.vcpu > 2 ? 's' : ''}. The CPU runs machine code from L1/L2/L3 caches; a trip to RAM costs ~100 ns, so cache-friendly code is faster.`],
      ['Context switches & syscalls', 'Every read/write on a socket is a system call into the kernel (~0.1–1 µs). Thousands of threads mean the OS keeps switching between them, which burns CPU.'],
      ['NIC & kernel', 'The network card DMAs packets into RAM and interrupts a core; the kernel’s TCP stack reassembles them before your runtime ever sees a request.'],
      ['Disk', 'Mostly idle for a stateless app server: logs and the container image. Everything durable lives in the database.'],
    ],
    live: ({ cfg, r }) => {
      const t = r.tiers.app;
      return [
        ['Servers', fmt(t.effServers)],
        ['Per server', `${cfg.vcpu} vCPU / ${cfg.ram} GB`],
        ['Capacity per server', `${fmt(t.perServer.cap)}/s (${t.perServer.bound}-bound)`],
        ['CPU limit · RAM limit', `${fmt(t.perServer.cpu)}/s · ${fmt(t.perServer.mem)}/s`],
        ['Load', pct(t.rho)],
        ['Time in app', `${f(t.lat, 1)} ms`],
      ];
    },
  },

  cache: {
    title: 'Inside {tech}',
    summary: 'An in-memory key-value store: a giant hash table in RAM, reached over the network in a fraction of a millisecond.',
    flow: ({ techId }) => cacheFlow[techId] || 'cache_redis',
    software: [
      ['Data structures', 'Redis/Valkey store strings, hashes, lists, sets and sorted sets, each operation atomic. Memcached stores plain bytes.'],
      ['Expiry & eviction', 'Every key can have a TTL. When memory is full, an eviction policy (approximate LRU or LFU) drops the least useful keys.'],
      ['Cache-aside', 'The app asks the cache first; on a miss it reads the database and writes the value back with a TTL. The cache never talks to the database itself.'],
      ['Replication', 'A replica receives a stream of every write and can take over if the primary dies (Sentinel, cluster mode or the managed service).'],
    ],
    hardware: [
      ['RAM', ({ cfg }) => `Everything lives in your ${cfg.cacheGb} GB of RAM. A RAM access is ~100 ns versus ~100,000 ns for an SSD read: this is the whole point.`],
      ['CPU', 'A single core can serve ~100k+ simple commands per second; the network stack, not the lookup, is the bottleneck.'],
      ['Network', 'Most of the 0.2–0.5 ms round trip is the network. Pipelining (sending many commands at once) cuts it.'],
    ],
    live: ({ cfg, r }) => [['Size', `${cfg.cacheGb} GB`], ['Hit rate', pct(r.tiers.cache.hit)], ['Reads', `${fmt(r.tiers.cache.in)}/s`], ['Load', pct(r.tiers.cache.rho)]],
  },

  db: {
    title: 'Inside {tech}',
    summary: ({ cfg }) => `The database server (${cfg.dbVcpu} vCPU / ${cfg.dbRam} GB) has to answer queries fast and never lose a committed write. RAM decides read speed; the durable log flush decides write speed.`,
    flow: ({ techId }) => dbFlow[techId] || 'db_postgres',
    software: [
      ['Query pipeline', 'Parse the SQL, plan (choose indexes and join order from statistics), execute. EXPLAIN shows the plan; a missing index turns a 1 ms lookup into a full table scan.'],
      ['Indexes', 'B-tree indexes keep keys sorted so a lookup touches ~3–4 pages even in a billion-row table. Every index also slows writes a little.'],
      ['Transactions & locks', 'MVCC lets reads see a consistent snapshot without blocking writes; rows being written are locked so two writers can’t clash.'],
      ['Durability', 'Every change goes to a write-ahead log first and is fsynced on commit. Replicas replay the same log.'],
      ['Connections', ({ r }) => `Each connection costs memory (a whole process in Postgres). Right now you need about ${fmt(r.tiers.db.connNeeded)} of ${fmt(r.tiers.db.connMax)} allowed.`],
    ],
    hardware: [
      ['RAM', ({ cfg }) => `${cfg.dbRam} GB caches data and index pages. If the working set fits, reads come from memory (~µs); if not, from disk (~0.1–1 ms each), which is why databases are usually scaled up in RAM first.`],
      ['Disk', 'Writes are limited by how fast the log can be flushed (fsync). Local NVMe does it in ~50 µs; network block storage in ~0.5–1 ms. IOPS limits on cloud disks are a classic hidden bottleneck.'],
      ['CPU', ({ cfg }) => `${cfg.dbVcpu} vCPU run query execution: sorting, joins, aggregations, JSON. Simple key lookups are cheap; analytical queries can eat a core each.`],
    ],
    live: ({ cfg, r }) => {
      const t = r.tiers.db;
      return [
        ['Server', `${cfg.dbVcpu} vCPU / ${cfg.dbRam} GB`],
        ['Writes', `${fmt(t.writes)}/s`],
        ['Reads', `${fmt(t.reads)}/s`],
        ['Primary load', pct(t.primaryRho)],
        ['Connections', `${fmt(t.connNeeded)} / ${fmt(t.connMax)}`],
      ];
    },
  },

  queue: {
    title: 'Inside {tech}',
    summary: 'A broker stores jobs durably and hands each one to a worker, so the app can reply immediately and spikes become a backlog instead of errors.',
    flow: ({ techId }) => queueFlow[techId] || 'queue_broker',
    software: [
      ['Durability', 'A message is confirmed only once it is on disk or replicated, so a broker crash doesn’t lose accepted work.'],
      ['Delivery', 'Queues lease a message to one consumer and delete it on ack (at-least-once). Logs like Kafka keep messages and let each consumer track its own offset.'],
      ['Retries & dead letters', 'Failed jobs come back with backoff; after N attempts they go to a dead-letter queue.'],
      ['Ordering', 'Usually only guaranteed per queue or partition, and only with one consumer per partition.'],
    ],
    hardware: [
      ['Disk', 'Brokers write sequentially (append-only), which even spinning disks do quickly; Kafka leans on the OS page cache.'],
      ['RAM', 'Redis-based queues (BullMQ, Sidekiq) keep jobs in memory: very fast, but a huge backlog needs a lot of RAM.'],
      ['Network', 'Throughput per broker is often limited by network bandwidth and replication traffic.'],
    ],
    live: ({ r }) => [['Writes coming in', `${fmt(r.tiers.queue.in)}/s`], ['Drained', `${fmt(r.tiers.queue.drain)}/s`], ['Backlog', fmt(r.tiers.queue.backlog)]],
  },

  workers: {
    title: 'Inside {tech}',
    summary: 'Workers are processes that pull jobs from the queue, do the slow work and acknowledge it. They are scaled independently of the web servers.',
    flow: () => 'workers',
    software: [
      ['Concurrency', 'Each worker runs several jobs at once: threads (Sidekiq), processes (Celery prefork), async tasks (BullMQ) or goroutines.'],
      ['Idempotency', 'Because a job can run twice (crash after work, before ack), every job must be safe to repeat: upserts, unique keys, “already done?” checks.'],
      ['Backoff', 'Retries wait longer each time, with random jitter, so a failing dependency isn’t hammered.'],
    ],
    hardware: [
      ['CPU', 'Image, video and PDF jobs are CPU-bound: size workers by cores. Email or API-call jobs are I/O-bound: run many per core.'],
      ['RAM', 'Large jobs (files, reports) need memory per concurrent job; limit concurrency to avoid out-of-memory kills.'],
    ],
    live: ({ cfg, r }) => [['Workers', cfg.workers], ['Busy', pct(r.tiers.workers.rho)], ['Jobs drained', `${fmt(r.tiers.workers.in)}/s`]],
  },
};

// ── Technology-specific notes: how this product does it ─────────────────────
export const TECH_NOTES = {
  // DNS
  route53: ['Runs on hundreds of AWS edge locations with anycast name servers spread over 4 different top-level domains for resilience.', 'Alias records point straight at AWS load balancers and CloudFront, and follow their IPs automatically.', 'Health checks from multiple AWS regions drive failover and latency-based routing. 100% availability SLA.'],
  'cloudflare-dns': ['Same anycast network as Cloudflare’s CDN (300+ cities), so answers usually come from very close by.', '“Proxied” records return Cloudflare’s own IPs, putting the CDN and WAF in front of you automatically.'],
  'gcp-dns': ['Anycast name servers on Google’s global network; private zones for VPC-internal names.', 'Changes propagate through Google’s control plane in seconds.'],
  ns1: ['“Filter chains” compute each answer from live data: health, load, geography, cost.', 'Popular for steering traffic between several CDNs or clouds.'],
  // CDN
  cloudflare: ['Every server in every PoP runs every service (cache, WAF, Workers), so any machine can handle any request.', 'Tiered Cache and Cache Reserve reduce origin fetches; Workers run your JS in V8 isolates at the edge.'],
  cloudfront: ['Edge locations plus Regional Edge Caches as the shield tier; Origin Shield adds one more layer.', 'Lambda@Edge and CloudFront Functions run code on requests; tight integration with S3 and ALB origins.'],
  fastly: ['Programmable with VCL or WebAssembly (Compute); purges propagate globally in ~150 ms.', 'Fewer but larger PoPs with lots of SSD per site.'],
  akamai: ['The oldest and largest CDN, with servers deep inside ISP networks.', 'Strong for huge media delivery and enterprise security.'],
  bunny: ['Simple pull-zone CDN priced per GB, with optional storage zones as origin.', 'Fewer features, very low cost.'],
  // Gateway
  kong: ['Built on NGINX + OpenResty: plugins are Lua code running inside NGINX workers.', 'Rate-limiting plugin can count locally, in Redis (cluster-wide) or in its database.'],
  'nginx-rl': ['limit_req uses a leaky bucket per key (e.g. client IP), stored in a shared-memory zone that all workers on that machine see.', 'Limits are per machine, not global.'],
  'aws-apigw': ['Fully managed: throttling uses a token bucket per account, stage and API key.', 'Can call Lambda directly. Adds a few ms and a price per million requests.'],
  'envoy-gw': ['Envoy filters handle auth and local rate limits; a separate global rate-limit service (backed by Redis) coordinates cluster-wide limits.', 'Configured through the Kubernetes Gateway API.'],
  'cf-waf': ['Runs at Cloudflare’s edge, so blocked traffic never reaches your network at all.', 'Uses bot scores, managed rule sets and rate rules per path.'],
  // LB
  nginx: ['Master process + one worker per core (worker_processes auto), each using epoll.', 'upstream blocks with keepalive pools; passive health checks (max_fails) in open source, active ones in NGINX Plus.'],
  haproxy: ['Multi-threaded event loop; famous for performance and detailed stats.', 'Rich active health checks, connection queues per server and stick tables for rate limits.'],
  alb: ['A managed fleet of L7 proxies that AWS scales for you; nodes in every availability zone.', 'Routes by host, path, headers; targets register automatically from Auto Scaling Groups or ECS.'],
  nlb: ['L4: forwards TCP/UDP flows without reading them, built on AWS’s Hyperplane network fabric.', 'Static IPs per zone, millions of requests per second, preserves the client IP.'],
  envoy: ['Multi-threaded: each worker thread owns its connections; config arrives live over the xDS API.', 'Retries, outlier detection and circuit breaking built in. The data plane of Istio.'],
  traefik: ['Written in Go; watches Docker or Kubernetes and creates routes for new services automatically.', 'Built-in Let’s Encrypt certificate management.'],
  // Proxy
  'nginx-rp': ['Event-driven workers, sendfile for static files, proxy_buffering on by default.', 'gzip and brotli (module), TLS session caching, upstream keepalive.'],
  caddy: ['Written in Go with goroutines; gets and renews HTTPS certificates automatically.', 'A whole reverse-proxy config can be two lines in a Caddyfile.'],
  'traefik-rp': ['Discovers services from Docker labels or Kubernetes Ingress, no config reloads needed.', 'Middlewares for compression, retries and rate limits.'],
  'envoy-rp': ['Usually deployed as a sidecar next to each service in a mesh, configured over an API.', 'Very detailed metrics per route and upstream.'],
  'haproxy-rp': ['Extremely efficient event loop; strong health checks and queueing.', 'Commonly used both as the edge proxy and as the load balancer.'],
  apache: ['Classic multi-process / multi-thread design (prefork, worker or event MPM).', 'mod_proxy forwards to app servers; still common in PHP stacks.'],
  // Runtime
  node: ['V8 compiles JS to machine code (JIT); libuv provides the event loop and a small thread pool (4 threads) for file I/O, DNS lookups and crypto.', 'Use worker_threads or a separate service for CPU-heavy tasks.'],
  go: ['Compiled to a single static binary; the runtime includes the scheduler, netpoller and GC.', 'Low memory per request; no warm-up.'],
  java: ['HotSpot JIT optimises hot code after warm-up; G1 or ZGC collectors keep pauses short.', 'Spring Boot runs on Tomcat (thread pool) or Netty (event loop, WebFlux).'],
  python: ['Gunicorn (WSGI, sync) or Uvicorn (ASGI, async) workers, each a separate process with its own interpreter.', 'C extensions (NumPy, orjson) run outside the GIL for speed.'],
  rails: ['Puma: clustered processes, each with a thread pool; YJIT compiles hot Ruby code.', 'Copy-on-write forking saves RAM across processes.'],
  dotnet: ['Kestrel web server on top of async sockets; RyuJIT plus tiered compilation, Native AOT optional.', 'async/await frees threads while waiting on I/O.'],
  // Cache
  redis: ['Single command thread with I/O threads since Redis 6; commands are atomic.', 'Persistence via RDB snapshots or the AOF log; Redis Cluster shards keys across 16,384 hash slots.'],
  valkey: ['Wire-compatible fork of Redis 7.2 under the Linux Foundation; improved multi-threaded I/O.', 'Same commands, clients and data structures.'],
  memcached: ['Multi-threaded, slab allocator, no persistence or replication.', 'Clients shard keys across servers with consistent hashing.'],
  elasticache: ['Managed Redis, Valkey or Memcached: AWS handles replicas, failover, patching and backups.', 'Cluster mode shards data across nodes.'],
  dragonfly: ['Shared-nothing design: each thread owns a shard of the keyspace, so one machine uses all cores.', 'Redis- and Memcached-compatible protocol.'],
  // DB
  postgres: ['Process per connection, shared buffers + OS page cache, WAL with streaming replication.', 'MVCC means VACUUM must keep up with updates and deletes.'],
  mysql: ['InnoDB: thread per connection, buffer pool (often ~70% of RAM), redo log for durability, clustered primary key index.', 'Replicas replay the binlog.'],
  aurora: ['Compute is separate from storage: the database sends only log records to a storage layer that keeps 6 copies across 3 availability zones.', 'Replicas share the same storage, so they lag only milliseconds.'],
  mongodb: ['WiredTiger engine: B-tree storage, document-level concurrency, a journal for durability, its own cache (~50% of RAM).', 'Replica sets elect a primary with a Raft-like protocol; sharding by shard key.'],
  cockroach: ['Data is split into ~512 MB ranges, each replicated 3× with Raft; any node can coordinate a transaction.', 'Pebble (LSM) storage engine; survives node and zone failures automatically.'],
  cassandra: ['Leaderless: any node coordinates; consistency level (ONE, QUORUM, ALL) per query.', 'LSM storage: commit log + memtable → SSTables + compaction. ScyllaDB rewrites it in C++ with a thread-per-core design.'],
  dynamodb: ['Request routers + storage nodes; each partition is replicated across 3 availability zones with Paxos.', 'Adaptive capacity moves throughput to hot partitions; still design keys to spread load.'],
  // Queue
  bullmq: ['Jobs are Redis hashes; waiting/active/completed lists and Lua scripts make moves atomic.', 'Delayed jobs live in a sorted set scored by run time.'],
  rabbitmq: ['Erlang-based broker: producers publish to exchanges, which route to queues by binding rules.', 'Quorum queues replicate with Raft; consumers ack each message.'],
  sqs: ['Fully managed and distributed: messages are stored redundantly across multiple availability zones.', 'Visibility timeout hides a received message; FIFO queues add ordering and deduplication.'],
  kafka: ['A distributed append-only log: topics split into partitions, replicated across brokers.', 'Consumers track offsets; KRaft replaces ZooKeeper for metadata.'],
  pubsub: ['Google-managed global topics; push or pull subscriptions, acknowledgment deadlines.', 'Scales automatically; ordering keys for per-key order.'],
  nats: ['Tiny Go server with core pub/sub in memory; JetStream adds persistence with Raft-replicated streams.', 'Very low latency.'],
  // Workers
  'bullmq-worker': ['Node.js workers with a concurrency setting: many async jobs on one event loop.', 'Locks are renewed while a job runs; stalled jobs are retried.'],
  celery: ['Python workers with prefork (processes), threads or gevent pools.', 'Broker is RabbitMQ or Redis; results can go to a result backend.'],
  sidekiq: ['Ruby threads in one process, pulling jobs from Redis lists.', 'Retries with exponential backoff built in.'],
  lambda: ['An event source mapping polls SQS or Kafka and invokes functions in batches; AWS scales concurrency up and down.', 'Each invocation runs in a Firecracker micro-VM; cold starts add latency.'],
  temporal: ['Workflows are code whose every step is recorded as an event history, so they survive crashes and can run for months.', 'Workers poll task queues on the Temporal server.'],
  'kafka-consumers': ['A consumer group splits partitions among members; adding consumers beyond the partition count adds nothing.', 'Rebalances happen when members join or leave.'],
};

export const INTERNAL_FLOWS = FLOW;
