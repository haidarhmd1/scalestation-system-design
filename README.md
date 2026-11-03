# Signal Box: System Design Atlas

A self-hosted, dark-mode playground for learning system design, styled like a railway signal box.

- **Network Map**: 48 system design and architecture patterns on 5 "lines", from Foundations to Planet-scale. Click any station tile to open an animated line diagram of the request journey, step by step, with what it is, why it's used, when to use it, and the trade-offs.
- **Simulator**: build a live architecture and push traffic through it. Scale vertically (vCPU and RAM) and horizontally (servers and load balancer), and add a CDN, rate limiter, cache, queue and workers, read replicas, shards, a connection pooler, circuit breakers, auto-scaling and multiple regions. Watch signals turn amber or red, see where it breaks, and apply the dispatcher's suggested fixes.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173

`npm run build && npm run preview` serves a production build.

## Stack

Vite + React 18 with no other runtime dependencies. All diagrams are hand-rolled SVG. The capacity model lives in `src/sim/model.js`. Its numbers are teaching approximations (queueing ≈ 1/(1−ρ)), not benchmarks.
