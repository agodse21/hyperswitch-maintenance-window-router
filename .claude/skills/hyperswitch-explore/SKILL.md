---
name: hyperswitch-explore
description: >-
  Explores a Hyperswitch fork to find routing, connector selection, retry, and
  logging hooks. Use after SPEC.md exists, before implementing custom routing,
  or when asked where to plug in routing logic.
---

# Hyperswitch explore

Run exploration **in parallel** where possible. Update `SPEC.md` hook section with real paths.

## Clone & baseline (if not done)

```bash
# From empty dir or fork on GitHub first
git clone https://github.com/juspay/hyperswitch.git
cd hyperswitch
```

Read upstream `README.md` and `docker-compose*.yml` for official quickstart. Prefer upstream commands in your fork README.

## Search targets (routing integration)

Run these ripgrep queries and read top hits (not every match):

```bash
rg -n "routing|router|connector.*select|pick_connector" --type rust -g '!target' | head -40
rg -n "retry|fallback" crates/ --type rust | head -40
rg -n "routing_algorithm|RoutingAlgorithm" . | head -30
```

**Document in SPEC.md:**

| Question | Answer (file:line) |
|----------|-------------------|
| Where is connector chosen for a payment? | |
| Where are retries decided? | |
| Where to attach custom rule (middleware vs algorithm)? | |
| Existing decision/trace/logging? | |

## Minimal run verification

1. Start stack per upstream docs (usually `docker compose up`).
2. Confirm health endpoint or admin UI if documented.
3. Note env vars and ports for README.

Do **not** refactor unrelated crates. Find the **smallest** extension point.

## Explore sub-agent prompt (if delegating)

```
In this Hyperswitch repo, find where payment routing picks a connector and where retry/fallback is decided. Return: (1) top 3 file paths with line refs, (2) suggested hook for ONE custom rule from SPEC.md, (3) how to log a routing decision. Read only; no edits.
```

## Exit criteria

- [ ] Stack runs OR blocker documented in DECISIONS.md
- [ ] SPEC.md "Integration point" has real paths
- [ ] Baseline payment attempt documented (even if sandbox/mock)
