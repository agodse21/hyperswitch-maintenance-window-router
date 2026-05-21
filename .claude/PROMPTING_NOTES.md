# Claude Agent Session — Prompting Notes

This file explains the reasoning behind key prompts in `session-transcript.jsonl`.
The full raw transcript is in the same directory.

---

## Session overview

The session covers the entire hyperswitch-maintenance-window-router from first read to final demo verification.
All prompts were deliberate — the flow was: understand → plan → spec → implement → verify → clean up.

---

## Key decision moments 

### 2. Explicit gate between planning and execution 

**Prompt:** `"You are a Senior Staff Backend Engineer helping build a production-grade payments orchestration platform..."`

**Why:** A deliberate two-step — plan first, then execute. This ensures the spec exists as a committed artifact before codegen begins, satisfying the task spec-before-code tiebreaker.

---

### 3. Architecture rejection 

**Prompt:** `"after Reviewing the entrie code. the code looks solid but intead of the rust can you write the code in typescript? create a seperate service called 'routing-service'. write everyting inside it. and also update all related files."`

**Why this was a rejection of Claude's output, not a preference:**
Claude's initial plan embedded the routing logic directly into Hyperswitch's Rust core
(`crates/router/src/core/payments/routing.rs`). The problems with that approach:

- No local Rust toolchain → `cargo check` fails with `command not found`
- Every change requires a full Rust recompile (~5 min in Docker)
- The logic is tightly coupled to Hyperswitch internals, making it hard to test in isolation

Redirecting to TypeScript forced a cleaner design: a standalone HTTP sidecar that uses
Hyperswitch's `routing.type = "single"` straight-through API as the boundary.
The result is a service that can be started, tested, and iterated on in seconds with no Rust dependency.

---

### 4. Active output verification

**Prompt:** Shared terminal output → `"we are runing outoff some error, can you access bash terminal and go though it and fix it."`

**Why:** Did not accept the implementation as done without running it. Caught two real failures:
- `docker: No such file or directory` — Docker not installed; the Makefile needed a graceful fallback
- `make up` inside `routing-service/` — wrong directory, no Makefile there

This led to fixing `demo.sh` and `Makefile` to work without Docker, and discovering a secondary bug:
the routing trace was recorded *after* the upstream call, meaning it was lost if Hyperswitch was unreachable.
That bug was explicitly caught and fixed (see `index.ts` — `recordTrace()` now called before `fetch()`).

---
