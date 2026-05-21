# DECISIONS.md

## What I built

**Time-of-day maintenance window routing sidecar** — a TypeScript/Hono microservice (`routing-service/`) that sits in front of Hyperswitch and pre-empts connector failover before any request is dispatched.

**Architecture:**
```
curl → routing-service :3000 (TypeScript) → hyperswitch-server :8080 (Rust)
```

When a payment arrives, the sidecar:
1. Reads the ordered connector priority list and maintenance windows from `config/windows.json`
2. Filters out connectors currently in their declared UTC windows
3. Forwards the payment to Hyperswitch with `routing: { type: "single", data: { connector: "<chosen>" } }` (straight-through routing — no Hyperswitch routing config needed)
4. Records the decision in an in-memory trace store

**Bonus endpoint:** `GET /routing-trace/:paymentId` returns the full decision trace (chosen connector, skipped list, UTC time) for any payment routed through the service.

**Why TypeScript instead of modifying Rust:** The routing logic is domain logic — it belongs in a service that can be reasoned about, deployed, and tested independently. TypeScript gives fast iteration, excellent test tooling (Jest), and a clean HTTP boundary. Hyperswitch's straight-through routing API (`routing.type = "single"`) is exactly the right seam to use for forcing a pre-decided connector. No Rust patches required.

## What I skipped (and why)

| Skipped | Reason |
|---------|--------|
| Per-weekday schedule | Adds config complexity. Core feature works without it; noted as +4h item |
| Persistent trace store (Redis/DB) | The in-memory store is evicted on restart but is sufficient for the demo. A Redis-backed store is the obvious next step |
| Prometheus metrics | Bonus item — the decision data is already structured; emitting it to Prometheus is a one-line addition |
| Full Hyperswitch routing API integration | Used straight-through routing (`type: "single"`) which is simpler and has no race conditions vs. configuring a routing algorithm in DB |
| Rate limiting / retry cap | Not in scope for 90m; documented as production concern below |

## Trade-offs

**Proxy vs. embedded Rust module:** A proxy requires an extra network hop per payment (~0.5ms LAN latency). The benefit is full decoupling — the routing logic can be updated, restarted, and tested without touching the Rust binary or rebuilding Hyperswitch. For a sidecar on the same Docker network this overhead is negligible.

**JSON file config vs. API-managed config:** A JSON file is simple, version-controlled, and human-readable. The trade-off is that changing windows requires a file write (or volume mount update) rather than a PATCH call. A production system would expose a config API backed by the database.

**In-memory trace store:** Traces are lost on restart. The cap (1,000 entries) prevents unbounded memory growth. For production, replace with a `payment_routing_trace` DB table or append to Redis.

**`fetch` for upstream calls:** Uses Node.js native `fetch` (stable since Node 18). No extra HTTP client dependency needed.

## Production instinct

**Retry storm guard** — if all connectors are in maintenance, the service returns HTTP 503 immediately, which prevents clients from hammering the upstream. A `Retry-After` header indicating the nearest window-end time would be the next improvement.

**PII in logs** — all structured log fields (`connector`, `nowUtcMins`, `skippedCount`) are non-PII. Payment IDs from Hyperswitch are opaque tokens. Card numbers and IPs do not appear in routing log lines.

## What I'd do with another 4 hours

1. **Persist routing traces to Hyperswitch's DB** (write a `routing_trace` column on `payment_attempts`) so the trace API survives restarts and can be queried per merchant.
2. **Prometheus counter** `routing_decisions_total{connector,decision}` — one line with `prom-client`; surfaces real-time failover rates.
3. **Per-weekday + timezone schedule** — extend `MaintenanceWindow` with an optional `weekdays` array and use `Intl.DateTimeFormat` for tz-aware comparisons.

## What's broken or hacky

- **`scripts/demo.sh` mutates `routing-service/config/windows.json`** to cover the current time. This is a demo convenience; in production windows would come from a config API.
- **Demo connectors use fake API keys** (`demo_key`). Hyperswitch will reject the payment at the connector auth step, but the routing decision fires before that — the `routing_decision` log lines and `/routing-trace` endpoint are visible regardless of payment success.
- **Hyperswitch build time**: the first `docker compose up` compiles Rust from scratch (~5 min). Subsequent runs use the Docker volume cache.
