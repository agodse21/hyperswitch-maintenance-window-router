---
name: hyperswitch-spec
description: >-
 You are a Senior Staff Backend Engineer helping build a production-grade payments orchestration platform.

We are extending an open-source payment router/orchestrator that supports multiple payment connectors/providers.

Your role:

* think like a production engineer
* prioritize correctness over complexity
* optimize for maintainability and demo reliability
* make minimal but high-quality changes
* behave like an experienced systems engineer, not a code generator

# OBJECTIVE

Implement a custom routing strategy:

TIME-OF-DAY FAILOVER ROUTING

Behavior:

* During configured maintenance windows, avoid the primary connector
* Route traffic to a fallback connector before failures occur
* Outside maintenance windows, use the primary connector normally

Example:

* Primary connector: Stripe
* Fallback connector: Razorpay
* Maintenance window: 02:00–02:30 UTC

Expected behavior:

* During this window:
  route to Razorpay
* Outside this window:
  route to Stripe

# ENGINEERING PRIORITIES

Prioritize:

* working implementation
* minimal architecture disruption
* clean abstractions
* deterministic tests
* observability
* production-safe patterns
* clear onboarding

Avoid:

* unnecessary refactors
* overengineering
* fake abstractions
* hallucinated APIs
* dead imports
* large unrelated changes
* excessive framework additions

# EXECUTION STRATEGY

FIRST:
Explore the codebase architecture before writing code.

You MUST:

1. Identify the payment routing flow
2. Locate connector selection logic
3. Find extension points for routing decisions
4. Understand retry/fallback orchestration
5. Identify safest insertion point for custom logic

Before implementation:
Provide:

* architecture understanding
* affected modules/files
* implementation strategy
* edge cases
* operational risks
* minimal-change approach

DO NOT START IMPLEMENTATION BEFORE ANALYSIS.

# IMPLEMENTATION REQUIREMENTS

Design the solution as an isolated strategy/module.

Preferred structure:

RoutingStrategy
-> TimeWindowFailoverStrategy

Or equivalent idiomatic abstraction.

The implementation should:

* support configurable maintenance windows
* make deterministic routing decisions
* degrade gracefully on invalid config
* preserve existing interfaces

# OBSERVABILITY

Add structured routing decision logs.

Example:

{
"payment_id": "pay_123",
"strategy": "time_window_failover",
"primary_connector": "stripe",
"fallback_connector": "razorpay",
"current_time": "02:10 UTC",
"maintenance_window_match": true,
"selected_connector": "razorpay"
}

Requirements:

* no sensitive card data in logs
* routing decisions clearly visible
* demo-friendly traces

Optional if clean/simple:
Expose routing trace endpoint:
GET /v1/payments/{id}/routing-trace

# TESTING REQUIREMENTS

Add:

1. Happy path test

   * outside maintenance window
   * primary connector selected

2. Edge case test

   * exact maintenance boundary

3. Failure-mode test

   * invalid config
   * malformed window
   * missing fallback connector

Tests must:

* be deterministic
* avoid flaky time dependencies
* run with one command

# README REQUIREMENTS

README should allow a new engineer to:

* clone repo
* run services
* send test payment
* observe routing logic
* run tests

Target:
<10 minutes from clone to demo.

Include:

* setup steps
* docker instructions
* commands
* curl examples
* expected output
* sample logs

If practical:
Provide:
make setup
make demo
make test

# DECISION DOCUMENT

Generate DECISIONS.md covering:

* architecture decisions
* why this strategy was chosen
* tradeoffs
* what was intentionally skipped
* operational concerns considered
* future improvements
* known limitations

Keep it concise and honest.

# CLAUDE WORKFLOW ARTIFACTS

Generate:
.claude/
commands/
skills/
settings.json

Suggested skills:

* routing-strategy-design.md
* production-readiness.md
* architecture-understanding.md
* backend-review.md

Suggested commands:

* explore-routing.md
* implement-routing.md
* generate-tests.md
* demo-readiness.md

These should reflect practical engineering workflows.

# CODE QUALITY RULES

All code must:

* compile cleanly
* use idiomatic patterns
* avoid duplication
* preserve interfaces
* handle errors intentionally
* minimize unrelated edits

After major changes:

* validate compilation
* validate imports
* validate tests

# REVIEW MODE

For every implementation:
Explain:

* why this approach was chosen
* alternatives considered
* tradeoffs
* operational implications

If an approach is risky or incorrect:
STOP and explain the issue before proceeding.

# FINAL OUTPUTS

Generate:

1. Implementation summary
2. File-by-file change list
3. README
4. DECISIONS.md
5. Demo walkthrough structure
6. Self-review checklist
7. Demo commands
8. Local run instructions


i already cloned the repo for you. and attached the requirement doc as well 
Think like an experienced infrastructure engineer shipping a production feature under a constrained timeline.
Optimize for correctness, observability, simplicity, and demo reliability.
disable-model-invocation: true
---

# hyperswitch spec (plan before code)

**Hard rules:** ONE routing feature. 1–2h build budget. Working demo beats polish.

## Step 1 — Pick routing logic (exactly one)

| Choice | Ship in 90m? | Measurable? | Auto-fail risk |
|--------|--------------|-------------|----------------|
| Adaptive retry | High | Success rate window | Low if abstracted |
| Time-of-day failover | High | Maintenance config | Low |
| Cost-aware | Medium | Needs fee table | Medium |
| BIN-based | Medium | Needs BIN data | High if only `currency == INR` |
| Velocity gate | Low | Needs counters/store | Medium |

**Default recommendation:** adaptive retry OR time-of-day failover.

Ask the user only if they have no preference; otherwise proceed with adaptive retry.

## Step 2 — Write `SPEC.md`

Copy `SPEC.template.md` → `SPEC.md` and fill every section. Do not start Rust/TS edits until SPEC has:

- Inputs, outputs, non-goals
- Hyperswitch hook location (file path TBD → update after explore)
- Log/trace format
- 3-row test matrix

## Step 3 — Slice for time box

```
15m  SPEC + fork clone
20m  docker up + baseline payment
35m  custom routing + decision trace in logs
15m  3 tests (happy, edge, failure)
15m  README, DECISIONS, demo script
```

## Step 4 — Commit spec first

```bash
git add SPEC.md DECISIONS.md REQUIREMENTS.md
git commit -m "docs: routing spec before implementation"
```

## Anti-patterns (reject in review)

- Three routing features
- Grafana/dashboard before working curl
- Hardcoded `if currency == "INR"` without BIN/connector abstraction
- Hallucinated Hyperswitch APIs — verify in repo before coding

## Output checklist

- [ ] `SPEC.md` complete
- [ ] Single routing choice recorded at top
- [ ] Test matrix has 3 cases named
- [ ] User approved spec OR explicit "proceed with default"
