---
name: implement-routing
description: >-
  Implements exactly one custom routing rule in a Hyperswitch fork per SPEC.md.
  Use after hyperswitch-explore, for adaptive retry, maintenance windows.
disable-model-invocation: true
---

# Implement custom routing

**Precondition:** `SPEC.md` exists with hook location and test matrix.

## Implementation rules

1. **One feature** — no second routing mode.
2. **Abstraction** — trait/module/config, not a single inline `if`.
3. **Graceful degradation** — missing stats/config → documented default (upstream behavior).
4. **No hallucinated APIs** — every symbol must exist in the fork; grep before import.
5. **Reject slop** — delete dead imports; comments must match code.

## Adaptive retry (reference design)

```
Module: custom_routing::adaptive_retry
Input:  connector_id, window_stats (success_rate, sample_count), attempt
Output: Decision { RetrySame | Fallback { connector } | FailFast }
Window: in-memory ring per connector (5 min); min_samples before trusting rate
Floor:  if success_rate < floor → fallback to next connector in merchant config
Cap:    max_attempts to prevent retry storm
```

Log every decision:

```
routing_decision connector=stripe reason=low_success_rate rate=0.42 attempts=2 fallback=adyen
```

## Time-of-day failover (reference design)

```
Config: maintenance_windows.yaml — connector, tz, cron or HH:MM ranges
Skip connector in window; pick next eligible from merchant routing list
Log: routing_decision connector=adyen reason=maintenance_window until=2026-05-21T04:00Z
```

## Code quality bar

- Types for `RoutingDecision` / `DecisionReason`
- Errors: log + degrade, don't panic payment path
- No copy-paste across connectors — loop over config

## Tests (same PR)

| Test | Assert |
|------|--------|
| Happy | High success rate → keeps primary connector |
| Edge | Below floor with enough samples → fallback |
| Failure | Missing stats / zero samples → safe default |

Run: document exact command in README (`cargo test custom_routing` or `make test`).

## Course-correction (for Loom)

When Claude proposes wrong file/API, **stop**, grep repo, update SPEC, continue. Note rejection in commit message or DECISIONS.

## Done when

- [ ] Demo payment triggers log line with inputs + chosen connector
- [ ] 3 tests pass
- [ ] No auto-fail patterns (trivial INR-only hack, dead code)
