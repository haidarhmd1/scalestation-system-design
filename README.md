# ScaleStation: System Design Simulator

**Learn system design by building, scaling and breaking it.**

ScaleStation is a self-hosted, dark-mode playground for learning system design, from a single server all the way to planet-scale architectures. Read how each pattern works, watch a request travel through it step by step, then build your own system in a live simulator, push traffic at it and see exactly where it breaks and what to add next.

The look is inspired by railway stations and signalling: requests travel like trains along tracks, every component is a station with a signal light, and patterns are grouped into "lines" from simple to complex.

> Built for beginners and for anyone preparing for system design interviews. Every technical word has an ⓘ that explains it in plain language.

---

## What's inside

### 1. Network Map: 49 patterns, simplest to most complex

Patterns are grouped into five lines. Click any tile to open an animated diagram of the request journey (HTTP request → DNS → load balancer → servers → cache → database …) with a step-by-step timetable, plus **what it is**, **why it's used**, **when to use it**, **gains and costs**, real-world examples and key terms.

| Line | Level | Examples |
|---|---|---|
| 1 | Foundations | Client–server, DNS, single server, separate DB tier, n-tier, monolith, vertical scaling |
| 2 | Core scaling | Horizontal scaling, load balancer, stateless sessions, reverse proxy, forward proxy, CDN, caching, health checks, auto-scaling |
| 3 | Intermediate | Read replicas, connection pooling, cache write strategies, message queues, pub/sub, rate limiting, API gateway, object storage, BFF, hexagonal architecture, observability |
| 4 | Advanced | Sharding, consistent hashing, microservices, service discovery, event streaming, CQRS, event sourcing, circuit breaker, bulkhead, backpressure, saga, outbox, Raft consensus, quorums, strangler fig |
| 5 | Planet-scale | Service mesh, GeoDNS / anycast, multi-region active-active, cell-based architecture, stream processing, serverless, distributed SQL |

Search and category filters (Networking, Scaling, Data, Caching, Messaging, Reliability, Architecture) help you find patterns quickly. Many tiles have **Try in Simulator**, which loads a ready-made setup for that pattern.

### 2. Simulator: build it, load it, break it

A live line diagram of your architecture, with requests moving along the tracks, colour-coded by load.

- **Traffic**: online users, requests per user, read/write mix, static files, bot traffic, and traffic patterns (steady, daily wave, viral growth, flash sales), plus a 5× spike button.
- **Vertical scaling**: vCPU and RAM per app server and per database node. Each server shows whether it is CPU- or memory-bound.
- **Horizontal scaling**: server count, load balancer (nodes and algorithm), auto-scaling with boot time and cooldown.
- **Components to build**: CDN, API gateway / rate limiter, reverse proxy, cache, message queue + workers, read replicas, shards, connection pooler, circuit breakers, session storage (in memory / sticky / shared Redis), 1–3 regions.
- **Real technologies**: pick what each component would be, e.g. Redis or Memcached, BullMQ, RabbitMQ, SQS or Kafka, PostgreSQL, MySQL, MongoDB or CockroachDB, NGINX, HAProxy or AWS ALB.
- **Live numbers**: offered vs served requests, error rate, p95 latency, uptime estimate and monthly cost, with history charts and an event log.
- **Find breaking point**: raises traffic until something fails and tells you which component broke first.
- **Dispatcher**: explains what is wrong ("users are being logged out", "database out of connections", "cascading failure") and applies a fix in one click.
- **How is this calculated?**: a live cost breakdown with formulas, how every stat is derived, and all assumptions with their real-world sources.
- **Full screen** with drag-to-pan and zoom, and collapsible sidebars.

### 3. Glossary: 46 terms for total beginners

From CPU and RAM to sharding, backpressure and circuit breakers. Each entry covers where the word comes from, what it is, what it does, an everyday example (a restaurant runs through all of them: cooks are CPU cores, the counter is RAM, the host at the door is the load balancer) and why it matters when you scale. Proxies also get "When you DO / DO NOT need one" lists.

---

## Getting started

Requires [Node.js](https://nodejs.org/) 18 or newer.

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

---

## How the simulator works

The simulator is a **capacity model**, not a benchmark. Every component has a capacity, the traffic offered to it is compared against that capacity, and:

- **Utilisation** = load ÷ capacity drives the green / amber / red signals.
- **Latency** per component = base time × 1 ÷ (1 − utilisation), the classic queueing-theory result. Busy components get slow fast.
- **Overload** turns into errors, plus specific failure modes: database connection limits, lost in-memory sessions, cascading failures without circuit breakers, and growing queue backlogs.
- **Cost** uses approximate public cloud on-demand prices (AWS us-east-1 style).

All numbers are plausible orders of magnitude for learning. Real systems vary a lot, so always load-test your own. The in-app **How is this calculated?** panel lists every formula, price and assumption with its source.

---

## Project structure

```
src/
├── App.jsx                 # Shell: navigation, tabs, footer
├── components/
│   ├── Catalogue.jsx       # Network Map tab: pattern tiles + detail pop-up
│   ├── FlowDiagram.jsx     # Animated step-by-step request diagrams
│   ├── Simulator.jsx       # Simulator tab: controls, inspector, charts, dispatcher
│   ├── SimMap.jsx          # Live line diagram with moving requests, pan & zoom
│   ├── Methodology.jsx     # "How is this calculated?" panel
│   ├── Glossary.jsx        # ⓘ icons and glossary pop-ups
│   └── ui.jsx              # Sliders, toggles, popovers, sparklines
├── data/
│   ├── patterns.js         # The 49 patterns: text, diagrams, simulator presets
│   └── glossary.js         # The 46 glossary terms
├── sim/
│   ├── model.js            # Capacity model, prices, advisor, breaking-point search
│   └── tech.js             # Technology choices and station explanations
└── styles.css              # Dark theme and layout
```

**Tech stack:** Vite + React 18, no other runtime dependencies. All diagrams are hand-drawn SVG; there is no chart or diagram library. To use your own cloud provider's prices, edit the `PRICES` table in `src/sim/model.js`.

---

## Author

Built by **Haidar Hammoud** · [GitHub](https://github.com/haidarhmd1) · [LinkedIn](https://www.linkedin.com/in/haidarhmd)
