---
name: demo-verify
description: >-
  Verifies the Hyperswitch demo end-to-end: README onboarding,
  curl/script payment, routing trace in logs, and tests.
---

# Demo verify (15-minute reviewer simulation)

Pretend you are a new engineer with **15 minutes**.

## Fresh clone test

```bash
cd /tmp && rm -rf hs-verify && git clone <YOUR_FORK_URL> hs-verify
cd hs-verify
# Follow README exactly — do not use prior knowledge
```

Timer targets:

- **<10 min** — stack up
- **<15 min** — test payment + visible routing decision

## Required artifacts

| File | Check |
|------|-------|
| `README.md` | Prerequisites, clone, env, start, test payment command |
| `scripts/demo.sh` or `make demo` | Single entry; prints or tails routing decision |
| `DECISIONS.md` | ≤1 page; honest hacks |
| Tests | One command, 3 cases for custom path |

## Routing visibility

Pass if **any**:

- Log line contains `routing_decision` with inputs + connector
- **Bonus:** `GET /v1/payments/{id}/routing-trace` returns JSON

Fail if logic only exists in code comments.

## Test command

```bash
# Use whatever README documents — example:
cargo test -p <your_crate> -- --nocapture
# or
make test
```

All three: happy, edge, failure — must be named in README or test output.

## README snippet template

Add to fork README:

```markdown
## Quick demo (<10 min)

1. `cp .env.example .env` && fill keys
2. `docker compose up -d` (or `make up`)
3. `./scripts/demo.sh`

Expect log line: `routing_decision ...`
```

## Verification report

Emit markdown:

```markdown
## Verify result: PASS | FAIL

- Clone to running: Xm
- Test payment: PASS/FAIL
- Routing visible: PASS/FAIL (paste sample line)
- Tests: PASS/FAIL (command + count)
- Blockers: ...
```
