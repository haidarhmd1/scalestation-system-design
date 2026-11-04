# ScaleStation: System Design Simulator

**Learn system design by building, scaling and breaking it.**

ScaleStation is a self-hosted, dark-mode playground for learning system design, from a single server all the way to planet-scale architectures. Read how each pattern works and watch a request travel through it step by step. See what happens on the wire, from TCP handshakes to lost packets. Then push traffic at an architecture in the live simulator and see where it breaks. Finally, build a real system yourself on your own machine, one station at a time.

The look is inspired by railway stations and signalling: requests travel like trains along tracks, every component is a station with a signal light, and patterns are grouped into "lines" from simple to complex.

> Built for beginners and for anyone preparing for system design interviews. Every technical word has an ⓘ that explains it in plain language.

---

## What's inside

The app has four tabs plus a glossary.

### 1. Network Map: 52 patterns, simplest to most complex

Patterns are grouped into five lines. Click any tile to open an animated diagram of the request journey (HTTP request → DNS → load balancer → servers → cache → database …) with a step-by-step timetable, plus **what it is**, **why it's used**, **when to use it**, **gains and costs**, real-world examples and key terms.

| Line | Level | Examples |
|---|---|---|
| 1 | Foundations | Client–server, DNS, single server, separate DB tier, n-tier, traditional monolith, vertical scaling |
| 2 | Core scaling | Horizontal scaling, load balancer, modular monolith, stateless sessions, reverse proxy, forward proxy, CDN, caching, health checks, auto-scaling |
| 3 | Intermediate | Read replicas, connection pooling, cache write strategies, message queues, SOA, pub/sub, rate limiting, API gateway, object storage, BFF, hexagonal architecture, observability |
| 4 | Advanced | Sharding, consistent hashing, microservices, distributed monolith (anti-pattern), service discovery, event streaming, CQRS, event sourcing, circuit breaker, bulkhead, backpressure, saga, outbox, Raft consensus, quorums, strangler fig |
| 5 | Planet-scale | Service mesh, GeoDNS / anycast, multi-region active-active, cell-based architecture, stream processing, serverless, distributed SQL |

- **Architecture styles compared**: a pop-up that puts the traditional monolith, modular monolith, SOA, microservices, serverless and the distributed monolith anti-pattern side by side. It compares them across 12 dimensions (deploy unit, data, scaling, team fit, operational complexity, failure isolation, consistency…), offers a head-to-head **A vs B** view that highlights the differences, and suggests a "how to choose" path.
- **Search and filters** (Networking, Scaling, Data, Caching, Messaging, Reliability, Architecture) help you find patterns quickly.
- **Try in Simulator** on many tiles loads a ready-made setup for that pattern.

### 2. Simulator: load it and break it

A live line diagram of an architecture, with requests moving along the tracks, colour-coded by load.

- **Traffic**: online users, requests per user, read/write mix, static files, bot traffic, and traffic patterns (steady, daily wave, viral growth, flash sales), plus a 5× spike button.
- **Vertical scaling**: vCPU and RAM per app server and per database node. Each server shows whether it is CPU- or memory-bound.
- **Horizontal scaling**: server count, load balancer (nodes and algorithm), auto-scaling with boot time and cooldown.
- **Components to build**: CDN, API gateway / rate limiter, reverse proxy, cache, message queue + workers, read replicas, shards, connection pooler, circuit breakers, session storage (in memory / sticky / shared Redis), 1–3 regions.
- **Real technologies**: pick what each component would be, e.g. Redis or Memcached; BullMQ, RabbitMQ, SQS or Kafka; PostgreSQL, MySQL, MongoDB or CockroachDB; NGINX, HAProxy or AWS ALB.
- **Look inside any station**: the ⌕ icon on each active card opens a pop-up with an animated step-by-step flow of what happens inside it: how Route 53 answers a DNS query, how Node.js's event loop or Go's goroutines handle a request on your vCPUs, how PostgreSQL reads pages and fsyncs the WAL, how Redis, Kafka or a CDN edge work. It covers the software and the hardware (CPU, RAM, NIC, disk), uses your live numbers, and lets you switch technologies to compare.
- **Live numbers**: offered vs served requests, error rate, p95 latency, uptime estimate and monthly cost, with history charts and an event log.
- **Find breaking point**: raises traffic until something fails and tells you which component broke first.
- **Dispatcher**: explains what is wrong ("users are being logged out", "database out of connections", "cascading failure") and applies a fix in one click.
- **How is this calculated?**: a live cost breakdown with formulas, how every stat is derived, and all assumptions with their real-world sources.
- **Full screen** with drag-to-pan and zoom, and collapsible sidebars.

### 3. Build Your Own: a real system, on your machine

A hands-on track of 12 stations. You write a real backend, run it with Docker and grow it step by step. Every station has complete, copy-ready files, the commands to run them, a checklist, "prove it works" commands and "what breaks next". Your progress is saved in the browser.

**Pick your language** (switch any time):

| Language | Framework |
|---|---|
| Node.js · TypeScript | **Express 5** or **Fastify 5** (runs `.ts` directly on Node 22.18+, with `npm run typecheck`) |
| Python | FastAPI |
| Go | net/http (Go 1.25+) |

**The stations:**

1. **Your first server**, and a first load test with k6
2. **Database**: PostgreSQL with a connection pool
3. **Containers** with Docker Compose
4. **Reverse proxy + load balancer**: NGINX in front of 3 replicas
5. **Stateless**: see the in-memory state bug across replicas, then fix it with Redis
6. **Cache**: cache-aside reads in Redis
7. **Queue + worker**: accept orders with 202, save them with an idempotent worker, watch the backlog
8. **Protection**: rate limiting (429) and surviving a crashed server
9. **Observability**: `/metrics` in every language, Prometheus, and a ready-made Grafana dashboard
10. **Breaking point**: ramp to 500 virtual users and find the bottleneck
11. **Infrastructure as code**: the whole stack in **Terraform or OpenTofu** (your choice, same files), with plan, apply, scaling by variable, drift detection and destroy. It runs on local Docker, so no cloud account is needed
12. **Next stops**: read replicas, PgBouncer, CDN, sharding, the cloud

Every station has been run end to end in Docker for TypeScript (Express and Fastify) and Python. The IaC station was tested with both Terraform and OpenTofu.

### 4. Networking: what actually happens on the wire

Every arrow in a system design diagram is a network trip. This tab explains them from the cable up.

- **The layers**: the 7-layer OSI model next to the 4-layer TCP/IP model. Click a layer to see its job, its unit of data (frame, packet, segment), its addresses (MAC, IP, port), its protocols, an everyday analogy, what it means for system design (L4 vs L7 load balancers, VPCs, the speed of light), what it looks like when it breaks, and commands to try (`curl -v`, `dig`, `nc`, `traceroute`, `openssl s_client`).
- **Encapsulation**: one HTTPS request, animated as it is wrapped in TLS, TCP, IP and Ethernet headers, forwarded by a router, and unwrapped by the server.
- **12 animated flows**: sequence diagrams with a running clock that adds up every round trip:
  - opening a URL from start to finish
  - the TCP lifecycle (handshake, data, teardown)
  - a lost packet and fast retransmit
  - slow start and congestion control
  - UDP for a video call
  - a full DNS lookup from root to authoritative
  - the TLS 1.3 handshake
  - HTTP/3 over QUIC
  - DHCP and ARP when joining Wi-Fi
  - NAT
  - WebSocket
  - a request through an L7 load balancer
- **TCP vs UDP vs QUIC** and **HTTP/1.1 vs 2 vs 3** side by side, with when to pick each.
- **16 protocol cards** (IP, TCP, UDP, QUIC, ICMP, ARP, DHCP, DNS, TLS, HTTP/1.1–3, WebSocket, gRPC, NAT, BGP): how they work, what they are used for, what to watch out for, and what their header carries.
- **Numbers worth knowing**: round-trip times from localhost to across the world, MTU, the first TCP flight, and the ports you meet in the Build Your Own track.

### Glossary: 63 terms for total beginners

From CPU and RAM to sharding, idempotency, stateless vs stateful servers, TCP, UDP, TLS, round trips, monitoring and infrastructure as code. Each entry covers:

- where the word comes from
- what it is and what it does
- an everyday example (a restaurant runs through all of them: cooks are CPU cores, the counter is RAM, the host at the door is the load balancer)
- why it matters when you scale

Proxies also get "When you DO / DO NOT need one" lists.

---

## Getting started

Requires [Node.js](https://nodejs.org/) 18 or newer to run the site.

```bash
git clone https://github.com/haidarhmd1/scalestation-system-design.git
cd scalestation-system-design
npm install
npm run dev
```

Then open http://localhost:5173 (Vite picks the next free port if 5173 is taken).

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server with hot reload |
| `npm run build` | Build a production version into `dist/` |
| `npm run preview` | Serve the production build locally |

**For the Build Your Own track** you also need [Docker](https://www.docker.com/products/docker-desktop/), [k6](https://k6.io/docs/get-started/installation/), your chosen language (Node.js 22.18+, Python 3, or Go 1.25+), and, for station 11, [Terraform](https://developer.hashicorp.com/terraform/install) or [OpenTofu](https://opentofu.org/docs/intro/install/).

---

## How the simulator works

The simulator is a **capacity model**, not a benchmark. Every component has a capacity, and the traffic offered to it is compared against that capacity:

- **Utilisation** = load ÷ capacity. It drives the green / amber / red signals.
- **Latency** per component = base time × 1 ÷ (1 − utilisation), the classic queueing-theory result. Busy components get slow fast.
- **Overload** turns into errors. There are also specific failure modes: database connection limits, lost in-memory sessions, cascading failures without circuit breakers, and growing queue backlogs.
- **Cost** uses approximate public cloud on-demand prices (AWS us-east-1 style).

All numbers are plausible orders of magnitude for learning. Real systems vary a lot, so always load-test your own (the Build Your Own track shows how). The in-app **How is this calculated?** panel lists every formula, price and assumption with its source.

---

## Project structure

```
src/
├── App.jsx                 # Shell: navigation, tabs, footer
├── components/
│   ├── Catalogue.jsx       # Network Map tab: pattern tiles + detail pop-up
│   ├── ArchCompare.jsx     # "Architecture styles compared" pop-up (A vs B)
│   ├── FlowDiagram.jsx     # Animated step-by-step request diagrams
│   ├── Simulator.jsx       # Simulator tab: controls, inspector, charts, dispatcher
│   ├── SimMap.jsx          # Live line diagram with moving requests, pan & zoom
│   ├── Methodology.jsx     # "How is this calculated?" panel
│   ├── Build.jsx           # Build Your Own tab: language picker, stations, progress
│   ├── Networking.jsx      # Networking tab: layers, encapsulation, sequence-diagram flows
│   ├── Inside.jsx          # Simulator "look inside a station" pop-up
│   ├── Glossary.jsx        # ⓘ icons and glossary pop-ups
│   └── ui.jsx              # Sliders, toggles, popovers, sparklines
├── data/
│   ├── patterns.js         # The 52 patterns: text, diagrams, simulator presets
│   ├── architectures.js    # Architecture styles and comparison dimensions
│   ├── journey.js          # Build track: stations and all code (TS, Python, Go,
│   │                       #   Docker, NGINX, Prometheus, Grafana, Terraform)
│   ├── networking.js       # Layers, flows, protocols and network numbers
│   ├── internals.js        # What happens inside each station, per technology
│   └── glossary.js         # The 63 glossary terms
├── sim/
│   ├── model.js            # Capacity model, prices, advisor, breaking-point search
│   └── tech.js             # Technology choices and station explanations
└── styles.css              # Dark theme and layout
```

**Tech stack:** Vite + React 18, no other runtime dependencies. All diagrams are hand-drawn SVG; there is no chart or diagram library. To use your own cloud provider's prices, edit the `PRICES` table in `src/sim/model.js`.

---

## Author

Built by **Haidar Hammoud** · [GitHub](https://github.com/haidarhmd1) · [LinkedIn](https://www.linkedin.com/in/haidarhmd)
