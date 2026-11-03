# ScaleYard: System Design Simulator

**Learn system design by building, scaling and breaking it.**

A self-hosted, dark-mode playground for learning system design. Its look is inspired by railway yards and signalling: requests travel like trains along tracks, and every component has a signal light.

- **Network Map**: 49 system design and architecture patterns on 5 "lines", from Foundations to Planet-scale. Click any station tile to open an animated diagram of the request journey, step by step, with what it is, why it's used, when to use it, the trade-offs and key terms explained.
- **Simulator**: build a live architecture and push traffic through it. Scale vertically (vCPU and RAM) and horizontally (servers and load balancer), and add a CDN, rate limiter, reverse proxy, cache, queue and workers, read replicas, shards, a connection pooler, circuit breakers, auto-scaling and multiple regions. Watch signals turn amber or red, find the breaking point, and apply the dispatcher's suggested fixes. "How is this calculated?" explains every number, cost and assumption.
- **Glossary**: beginner-friendly explanations of 46 terms, each covering where the word comes from, what it does, an everyday example and why it matters when scaling.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173

`npm run build && npm run preview` serves a production build.

## Stack

Vite + React 18 with no other runtime dependencies. All diagrams are hand-rolled SVG. The capacity model lives in `src/sim/model.js`; its unit prices live in the `PRICES` table there. The numbers are teaching approximations (queueing ≈ 1/(1−ρ)), not benchmarks.

---

Built by Haidar Hammoud · [GitHub](https://github.com/haidarhmd1) · [LinkedIn](https://www.linkedin.com/in/haidarhmd)
