# Routing Feature Spec — Time-of-Day Maintenance Window Failover

**Chosen logic:** Time-of-day failover — skip connectors during their declared UTC maintenance windows and preemptively failover before any timeout occurs.

**Time budget:** 90 min focused

## Problem

Payment connectors publish scheduled maintenance windows (e.g. Stripe: 02:00–04:00 UTC Tuesdays). Hyperswitch's built-in routing has no mechanism to pre-emptively skip a connector during its known downtime. Without this, attempts are routed to the unavailable connector, time out, and only then fall back — costing seconds of latency per payment and degrading success rate.

This feature filters connectors from the routing result *before* the request is dispatched, based on a configurable UTC time-range map. The result is zero-timeout failover with a structured log entry capturing inputs and the connector chosen.

## Decision boundary

**Inputs:**
- Resolved connector list (from static/rule-based or fallback routing)
- `maintenance_windows` config: `HashMap<connector_name_snake_case, Vec<{start: "HH:MM", end: "HH:MM"}>>` (UTC)
- Current UTC time-of-day (seconds since midnight)

**Outputs:**
- Filtered connector list with in-maintenance connectors removed
- If all connectors are filtered: empty list (triggers upstream fallback to merchant's default config)

**Non-goals (explicit skips):**
- No per-weekday schedules (day-of-week support is a +4h item)
- No Redis or external state — config is static TOML loaded at startup
- No Grafana dashboard, no Prometheus metrics (bonus item, not in 90m core)
- No v2 API path (v1 only)

## Integration point in Hyperswitch

- **Hook location:** `crates/router/src/core/payments/routing.rs`, function `perform_static_routing_locally` (v1, line ~889), after `resolve_or_fallback_with_approach` resolves the connector list, before `Ok(...)` return
- **New module:** `crates/router/src/core/payments/maintenance_window.rs`
- **Config location:** `crates/router/src/configs/settings.rs` — new `maintenance_windows: MaintenanceWindowConfig` field with `#[serde(default)]`
- **Data source:** TOML config loaded at app startup into `AppState.conf.maintenance_windows`
- **Fallback when data missing:** `MaintenanceWindowConfig` derives `Default` with empty map → no connectors are filtered (no-op)

## Observability

**Log line (one per filtered connector):**
```
routing_decision event="connector_skipped" connector="stripe" reason="maintenance_window" now_utc_mins=120 window_start=120 window_end=240
```

**Log line (chosen connector):**
```
routing_decision event="connector_chosen" connector="adyen" skipped_count=1 now_utc_mins=120
```

**Log line (all in maintenance, triggering fallback):**
```
routing_decision event="all_connectors_in_maintenance_fallback" skipped_count=2 now_utc_mins=120
```

## Test matrix

| Case | Input | Expected |
|------|-------|----------|
| Happy path | `stripe` in window, `adyen` not in window | `adyen` returned, `stripe` logged as skipped |
| Edge: midnight-crossing window | `stripe` window 23:00–01:00, now=23:30 | `stripe` skipped |
| Failure: all connectors in maintenance | Both connectors in window | empty list returned; all-in-maintenance log emitted |

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Config typo silently skips connectors | `hhmm_to_mins` returns `None` on parse error; window treated as inactive (safe default) |
| Retry storm if fallback also degraded | Not addressed in this scope (declared in DECISIONS.md) |
| PII in logs | Connector names are not PII; payment_id/card not in routing log lines |

## Acceptance

- [ ] `make demo` / `scripts/demo.sh` prints `routing_decision` log lines with connector + reason
- [ ] `cargo test -p router maintenance_window` runs and 3 tests pass
- [ ] DECISIONS.md matches what shipped
