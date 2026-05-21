# Maintenance Window Routing 

> This is a fork of [Hyperswitch](https://github.com/juspay/hyperswitch) with one custom routing feature added.
> Design doc: [SPEC.md](./SPEC.md) | Architecture decisions: [DECISIONS.md](./DECISIONS.md)

---

## What was built

A **TypeScript routing sidecar** (`routing-service/`) that sits in front of Hyperswitch and pre-emptively skips payment connectors during their declared UTC maintenance windows — picking the next available connector **before** any request is dispatched. Zero timeouts, zero failed attempts.

```
Your app  →  routing-service :3000 (TypeScript)  →  Hyperswitch :8080 (Rust)
```

**Example:** if Stripe has a maintenance window from `02:00–04:00 UTC`, and a payment comes in at `03:00 UTC`, the sidecar silently routes to Adyen instead. No timeout, no retry, no failed payment.

---

## Prerequisites

You only need two things installed:

| Tool | Install |
|------|---------|
| **Node.js** (v18 or newer) | https://nodejs.org |
| **curl** | Already installed on most systems |

> `jq` is optional but makes JSON output pretty. Install with `sudo apt install jq` (Linux) or `brew install jq` (Mac).

Check your versions:
```bash
node --version   # should say v18.x or higher
npm --version    # comes with Node
```

---

## Project structure

```
hyperswitch-maintenance-window-router/
│
├── routing-service/               ← The custom routing feature (TypeScript)
│   ├── src/
│   │   ├── index.ts               ← HTTP server (Hono) — 3 endpoints
│   │   ├── maintenanceWindow.ts   ← Core routing logic (pure functions)
│   │   ├── traceStore.ts          ← In-memory store for routing traces
│   │   └── __tests__/
│   │       ├── maintenanceWindow.test.ts   ← Unit tests (9 tests)
│   │       └── app.test.ts                 ← HTTP integration tests (7 tests)
│   ├── config/
│   │   └── windows.json           ← Edit this to configure maintenance windows
│   ├── package.json
│   └── tsconfig.json
│
├── scripts/
│   └── demo.sh                    ← One-command end-to-end demo
│
├── Makefile                       ← Shortcuts: make demo / make test-routing / make dev
├── SPEC.md                        ← Design doc written before any code
├── DECISIONS.md                   ← Architecture decisions and trade-offs
│
└── crates/                        ← Hyperswitch Rust source (unchanged)
```

---

## Quickstart — run the demo in 3 steps

```bash
# Step 1: clone the repo
git clone <this-repo-url>
cd hyperswitch

# Step 2: install dependencies for the routing service
cd routing-service && npm install && cd ..

# Step 3: run the demo
make demo
```

That's it. The demo will:
1. Set a maintenance window for **Stripe** that covers the current UTC time
2. Start the routing service on port 3000
3. Send a test payment
4. Print the routing decision (you should see Stripe skipped, Adyen chosen)
5. Show the full routing trace from the bonus API

**Expected output:**
```
═══════════════════════════════════════════════════
 Maintenance-Window Routing Demo (TypeScript)
═══════════════════════════════════════════════════
 Stripe window (UTC): 18:26 – 18:38
 Current UTC time:    18:27 (1107 mins)

▶ Starting routing-service...
✓ routing-service healthy

▶ Sending payment...
  chosen connector : adyen
  skipped          : stripe

 routing_decision log lines:
═══════════════════════════════════════════════════
{"routing_decision":"connector_skipped","connector":"stripe","reason":"maintenance_window","nowUtcMins":1107}
{"routing_decision":"connector_chosen","connector":"adyen","skippedCount":1,"nowUtcMins":1107}

 GET /routing-trace/demo_pay_001:
═══════════════════════════════════════════════════
{
  "chosenConnector": "adyen",
  "skipped": [{ "connector": "stripe", "reason": "maintenance_window" }],
  "nowUtcMins": 1107,
  "allInMaintenance": false
}

 Demo complete.
 Expected: stripe SKIPPED (in maintenance), adyen CHOSEN.
```

> **Note:** The payment will show `error: upstream Hyperswitch unreachable` — that's expected. The routing decision fires *before* forwarding to Hyperswitch. The log lines and trace API are the proof the logic works.

---

## Run tests

```bash
make test-routing
```

Or manually:
```bash
cd routing-service
npm test
```

**Expected output — all 16 tests should pass:**
```
PASS src/__tests__/maintenanceWindow.test.ts
  ✓ parses valid times
  ✓ returns null on malformed input (safe default → window inactive)
  ✓ returns false for malformed bounds (safe default)
  ✓ skips stripe (in maintenance 02:00–04:00) and chooses adyen at 02:30 UTC
  ✓ skips stripe at 23:30 (inside 23:00–01:00)
  ✓ skips stripe at 00:30 (post-midnight, still inside 23:00–01:00)
  ✓ does NOT skip stripe at 01:00 (exclusive end boundary)
  ✓ does NOT skip stripe at 22:59 (before window starts)
  ✓ returns chosen=null and allInMaintenance=true when all connectors are down

PASS src/__tests__/app.test.ts
  ✓ GET /health returns 200 with status ok
  ✓ chooses primary connector when it has no maintenance window
  ✓ skips stripe in maintenance and chooses adyen
  ✓ returns 503 when all connectors are in maintenance
  ✓ returns 502 with routing_decision when Hyperswitch is unreachable
  ✓ returns the decision stored during a payment request
  ✓ returns 404 for unknown payment ids

Tests: 16 passed, 16 total
```

---

## Run the service interactively (for manual testing)

```bash
make dev
```

The service starts on **http://localhost:3000**.

Now open a second terminal and try the endpoints:

### Health check
```bash
curl http://localhost:3000/health
```
```json
{ "status": "ok", "service": "maintenance-window-router" }
```

### Send a payment
```bash
curl -X POST http://localhost:3000/payments \
  -H "api-key: test_key" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "currency": "USD",
    "payment_id": "my_test_payment"
  }'
```

### Check the routing trace (bonus API)
```bash
curl http://localhost:3000/routing-trace/my_test_payment
```
```json
{
  "chosenConnector": "stripe",
  "skipped": [],
  "nowUtcMins": 720,
  "allInMaintenance": false,
  "paymentId": "my_test_payment",
  "timestamp": "2026-05-21T12:00:00.000Z"
}
```

---

## Configure maintenance windows

Edit **`routing-service/config/windows.json`**:

```json
{
  "routingOrder": ["stripe", "adyen"],
  "maintenanceWindows": {
    "stripe": [{ "start": "02:00", "end": "04:00" }],
    "adyen":  []
  }
}
```

| Field | What it does |
|-------|-------------|
| `routingOrder` | Connectors in priority order. First available one is chosen. |
| `maintenanceWindows` | Per-connector list of UTC time ranges to skip. Empty array = always available. |
| `start` / `end` | 24-hour UTC time in `"HH:MM"` format. |

**Midnight-crossing windows work too:**
```json
"stripe": [{ "start": "23:00", "end": "01:00" }]
```
This skips Stripe from 11 PM to 1 AM UTC.

**Multiple windows per connector:**
```json
"stripe": [
  { "start": "02:00", "end": "04:00" },
  { "start": "14:00", "end": "14:30" }
]
```

The file is re-read on every request — no restart needed after changes.

---

## All available commands

| Command | What it does |
|---------|-------------|
| `make demo` | Full end-to-end demo — sets a window, starts service, sends payment, shows logs |
| `make test-routing` | Runs all 16 Jest tests |
| `make dev` | Starts the routing service on port 3000 for manual testing |

---

## How it works (for the curious)

1. A payment `POST /payments` hits the routing service
2. It reads `config/windows.json` to get the connector priority list and windows
3. It checks the current UTC time against each connector's windows
4. Connectors in an active window are removed from the list
5. The first remaining connector is chosen
6. The payment is forwarded to Hyperswitch with `routing: { type: "single", data: { connector: "adyen" } }` — this forces Hyperswitch to use exactly that connector
7. The routing decision is saved in memory and available via `GET /routing-trace/:paymentId`

**Log format (one line per decision):**
```json
{"routing_decision":"connector_skipped","connector":"stripe","reason":"maintenance_window","nowUtcMins":150}
{"routing_decision":"connector_chosen","connector":"adyen","skippedCount":1,"nowUtcMins":150}
```

**If every connector is in maintenance:** the service returns HTTP 503 immediately — no request is forwarded to Hyperswitch.

---

## Source files explained

| File | Lines | Purpose |
|------|-------|---------|
| `routing-service/src/maintenanceWindow.ts` | 111 | Pure logic: parse times, check windows, decide connector. No side effects. |
| `routing-service/src/index.ts` | 162 | Hono HTTP server. Three routes: `/health`, `POST /payments`, `GET /routing-trace/:id` |
| `routing-service/src/traceStore.ts` | ~30 | In-memory map of `paymentId → decision`. Capped at 1,000 entries. |
| `routing-service/src/__tests__/maintenanceWindow.test.ts` | 137 | 9 unit tests for the core logic |
| `routing-service/src/__tests__/app.test.ts` | 170 | 7 HTTP integration tests using Hono's built-in test client |
| `routing-service/config/windows.json` | 1 | Config file — edit this to define windows |
| `scripts/demo.sh` | 90 | Automated demo script |
| `SPEC.md` | ~75 | Written before any code — defines the problem, inputs, outputs, test matrix |
| `DECISIONS.md` | ~60 | Why TypeScript, why a proxy, what was skipped, production concerns |

---

*The rest of this file is the original Hyperswitch README.*

---

<p align="center">
  <img src="./docs/imgs/hyperswitch-logo-dark.svg#gh-dark-mode-only" alt="Hyperswitch-Logo" width="40%" />
  <img src="./docs/imgs/hyperswitch-logo-light.svg#gh-light-mode-only" alt="Hyperswitch-Logo" width="40%" />
</p>

<h1 align="center">Composable Open-Source Payments Infrastructure</h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/juspay/hyperswitch/main/docs/gifs/quickstart.gif" alt="Quickstart demo" />
</p>


<!-- @import "[TOC]" {cmd="toc" depthFrom=1 depthTo=6 orderedList=false} -->

<p align="center">
  <a href="https://github.com/juspay/hyperswitch/actions?query=workflow%3ACI+branch%3Amain">
    <img src="https://github.com/juspay/hyperswitch/workflows/CI-push/badge.svg" />
  </a>
  <a href="https://github.com/juspay/hyperswitch/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/juspay/hyperswitch" />
  </a>
  <a href="https://github.com/juspay/hyperswitch/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/Made_in-Rust-orange" />
  </a>
</p>

<p align="center">
  <a href="https://www.linkedin.com/company/hyperswitch/">
    <img src="https://img.shields.io/badge/follow-hyperswitch-blue?logo=linkedin&labelColor=grey"/>
  </a>
  <a href="https://x.com/hyperswitchio">
    <img src="https://img.shields.io/badge/follow-%40hyperswitchio-white?logo=x&labelColor=grey"/>
  </a>
  <a href="https://inviter.co/hyperswitch-slack">
    <img src="https://img.shields.io/badge/chat-on_slack-blue?logo=slack&labelColor=grey&color=%233f0e40"/>
  </a>
</p>

<hr/>

<details>
<summary><strong>📁 Table of Contents</strong></summary>

- [What Can I Do with Hyperswitch?](#-what-can-i-do-with-hyperswitch)
- [Quickstart (Local Setup)](#-quickstart-local-setup)
- [Cloud Deployment](#cloud-deployment)
- [Hosted Sandbox (No Setup Required)](#hosted-sandbox-no-setup-required)
- [Why Hyperswitch?](#-why-hyperswitch)
- [Architectural Overview](#architectural-overview)
- [Our Vision](#our-vision)
- [Community & Contributions](#community--contributions)
- [Feature Requests & Bugs](#feature-requests--bugs)
- [Versioning](#versioning)
- [License](#copyright-and-license)
- [Team Behind Hyperswitch](#team-behind-hyperswitch)

</details>

<summary><h2>What Can I Do with Hyperswitch?</h2></summary>

Hyperswitch offers a modular, open-source payments infrastructure designed for flexibility and control. Apart from our Payment Suite offering, this solution allows businesses to pick and integrate only the modules they need on top of their existing payment stack — without unnecessary complexity or vendor lock-in.

Each module is independent and purpose-built to optimize different aspects of payment processing.

<h3> Learn More About The Payment Modules </h3>
<details>

- **Cost Observability**  
  Advanced observability tools to audit, monitor, and optimize your payment costs. Detect hidden fees, downgrades, and penalties with self-serve dashboards and actionable insights.  
  _[Read more](https://docs.hyperswitch.io/about-hyperswitch/payments-modules/ai-powered-cost-observability)_

- **Revenue Recovery**  
  Combat passive churn with intelligent retry strategies tuned by card bin, region, method, and more. Offers fine-grained control over retry algorithms, penalty budgets, and recovery transparency.  
  _[Read more](https://docs.hyperswitch.io/about-hyperswitch/payments-modules/revenue-recovery)_

- **Vault**  
  A PCI-compliant vault service to store cards, tokens, wallets, and bank credentials. Provides a unified, secure, and reusable store of customer-linked payment methods. Also supports bring-your-own-vault to connect existing providers including VGS and TokenEx without re-tokenizing or migrating stored cards.  
  _[Read more](https://docs.hyperswitch.io/about-hyperswitch/payments-modules/vault)_

- **Intelligent Routing**  
  Route each transaction across Stripe, Adyen, Braintree, Worldpay, Checkout.com, and 120+ others to the PSP with the highest predicted auth rate. Reduce retries, avoid downtime, and minimize latency while maximizing first attempt success. 
  _[Read more](https://docs.hyperswitch.io/about-hyperswitch/payments-modules/intelligent-routing)_

- **Reconciliation**  
  Automate 2-way and 3-way reconciliation with backdated support, staggered scheduling, and customizable outputs. Reduces manual ops effort and increases audit confidence.  
  _[Read more](https://docs.hyperswitch.io/about-hyperswitch/payments-modules/reconciliation)_

- **Alternate Payment Methods**  
  Drop-in widgets for PayPal, Apple Pay, Google Pay, Samsung Pay, Pay by Bank, and BNPL providers like Klarna. Maximizes conversions with seamless one-click checkout.  
  _[Read more](https://docs.hyperswitch.io/about-hyperswitch/payments-modules/enable-alternate-payment-method-widgets)_

</details>

## Quickstart 

<h3> Local Setup via Docker </h3>

```bash
# One-click local setup

git clone --depth 1 --branch latest https://github.com/juspay/hyperswitch

cd hyperswitch

scripts/setup.sh
```
<details>
  <summary><strong>This script: </strong></summary>

  - Detects Docker/Podman  
  - Offers multiple deployment profiles:
    - **Standard**: App server + Control Center  
    - **Full**: Includes monitoring + schedulers  
    - **Minimal**: Standalone App server  
  - Provides access links when done

  If you need further help, check out our [video tutorial](https://docs.hyperswitch.io/hyperswitch-open-source/overview/unified-local-setup-using-docker).  

  👉 After setup, [configure a connector](https://docs.hyperswitch.io/hyperswitch-open-source/account-setup/using-hyperswitch-control-center#add-a-payment-processor) and [test a payment](https://docs.hyperswitch.io/hyperswitch-open-source/account-setup/test-a-payment).
</details>


<h3>Hosted Sandbox (No Setup Required)</h3>

Hyperswitch offers a fully hosted sandbox environment that requires no setup. You can explore the Control Center, configure payment connectors, and test payments directly from the UI.

   <a href="https://app.hyperswitch.io">
     <img src="https://github.com/juspay/hyperswitch/blob/main/docs/imgs/try-the-sandbox.png?raw=true" height="35">
   </a>


<details>
  <summary><strong> What you can do in the Hosted Sandbox</strong></summary>

  - Access the full Control Center  
  - Configure payment connectors  
  - View logs, routing rules, and retry strategies  
  - Try payments directly from the UI  
</details>

<h3><strong>Cloud Deployment</strong></h3>

You can deploy to AWS, GCP, or Azure using Helm Charts.

<a href="https://docs.hyperswitch.io/hyperswitch-open-source/deploy-on-kubernetes-using-helm">Cloud Deployment Instructions</a>.


<a href="#architectural-overview">
  <h2 id="architectural-overview">Architectural Overview</h2>
</a>
<img src="./docs/imgs/features.png" />
<img src="./docs/imgs/non-functional-features.png" />
<img src="./docs/imgs/hyperswitch-architecture-v1.png" />

## Why Hyperswitch?

Hyperswitch is a commercial open-source payments stack purpose-built for scale, flexibility, and developer experience. Designed with a modular architecture, Hyperswitch lets you pick only the components you need—whether it’s routing, retries, vaulting, or observability—without vendor lock-in or bloated integrations.

Built in Rust for performance and reliability, Hyperswitch connects to Stripe, Adyen, Braintree, Worldpay, Checkout.com, Cybersource, and 120+ processors — exposing smart routing and retry logic, and provides a visual workflow builder in the Control Center. Whether you're integrating a full payment suite or augmenting an existing stack with a single module, Hyperswitch meets you where you are.

Common starting points: teams moving from a single Stripe/ Stripe connect or Braintree integration to multi-PSP routing, merchants replacing a payment gateway with direct acquirer connections to TSYS, JP Morgan Payments, or other acquirers, and merchants rearchitecting their payments platform through Hyperswitch while keeping their existing VGS, TokenEx or other existing vault intact.

<strong>“Linux for Payments”</strong> — Hyperswitch is a well-architected reference for teams who want to own their payments stack.

We believe in:

- <strong> Embracing Payment Diversity:</strong> Innovation comes from enabling choice—across payment methods, processors, and flows.

- <strong> Open Source by Default:</strong> Transparency drives trust and builds better, reusable software.

- <strong> Community-Driven Development:</strong> Our roadmap is shaped by real-world use cases and contributors. 

- <strong> Systems-Level Engineering:</strong> We hold ourselves to a high bar for reliability, security, and performance.

- <strong> Maximizing Value Creation:</strong> For developers, customers, and partners alike.

- <strong> Community-Driven, Enterprise-Tested:</strong> Hyperswitch is built in the open with real-world feedback from developers and contributors, and maintained by Juspay, the team powering payment infrastructure for 400+ leading enterprises worldwide.

## Supported Connectors

Hyperswitch integrates with 100+ payment processors out of the box. Each connector has a dedicated guide covering credentials setup, webhook configuration, supported payment methods, and common failure modes.

| Processor | Type | Guide |
|-----------|------|-------|
| Global Payments | Payment Gateway | [View →](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities/available-connectors/globalpayments) |
| Stripe | Payment Gateway | [View →](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities/available-connectors/stripe) |
| Paypal | Payment Gateway | [View →](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities/available-connectors/paypal) |
| Adyen | Payment Gateway | [View →](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities/available-connectors/adyen) |
| Bank of America | Payment Gateway | [View →](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities/available-connectors/boa) |

👉 [Browse all available connectors →](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities/available-connectors)

## Hyperswitch Ecosystem Mapping
Hyperswitch is built as a set of modular services and SDKs that work together. The Rust app server in this repo is the core, and the repositories below extend it with dashboards, client SDKs, and deployment tooling.

### 1. Core backend services

The Rust services that process payments. The app server is the center of gravity; the vault and encryption service handle sensitive-data operations alongside it. [`hyperswitch-prism`](https://github.com/juspay/hyperswitch-prism) is a separate, lighter entry point: a unified connector library that can be used directly against payment processors without running the full switch.

|  | [hyperswitch](https://github.com/juspay/hyperswitch) | [card-vault](https://github.com/juspay/hyperswitch-card-vault) | [encryption-service](https://github.com/juspay/hyperswitch-encryption-service) | [prism](https://github.com/juspay/hyperswitch-prism) |
| :--- | :---: | :---: | :---: | :---: |
| **Language** | Rust | Rust | Rust | Rust |
| **Role** | App server. Routing, retries, vaulting, observability. | PCI-compliant card storage. | Encryption, decryption, KMS. | Unified connector library, 100+ processors. |
| **Depends on** | card-vault, encryption-service | encryption-service | None | None |

### 2. Dashboard

Merchant-facing UIs for configuring connectors, routing, and viewing transactions. Both require the `hyperswitch` backend to be running.

|  | [control-center](https://github.com/juspay/hyperswitch-control-center) | [control-center-embedded](https://github.com/juspay/hyperswitch-control-center-embedded) |
| :--- | :---: | :---: |
| **Language** | ReScript | TypeScript |
| **Role** | Full merchant dashboard. Connectors, routing rules, analytics, API keys. | Embeddable Hyperswitch components for partners and merchants surfacing Hyperswitch UI inside their own apps. |
| **Depends on** | hyperswitch backend | hyperswitch backend |

### 3. Web checkout SDKs

How a browser talks to Hyperswitch. [`hyperswitch-client-core`](https://github.com/juspay/hyperswitch-client-core) is the shared core, pulled in as a git submodule by every client SDK (web and mobile). [`hyperswitch-sdk-utils`](https://github.com/juspay/hyperswitch-sdk-utils) holds shared assets that merchants doing Headless Implementations consume directly.

|  | [hyperswitch-web](https://github.com/juspay/hyperswitch-web) | [client-core](https://github.com/juspay/hyperswitch-client-core) | [react-hyper-js](https://github.com/juspay/react-hyper-js) | [sdk-utils](https://github.com/juspay/hyperswitch-sdk-utils) |
| :--- | :---: | :---: | :---: | :---: |
| **Language** | ReScript | ReScript | ReScript | ReScript |
| **Distribution** | npm | git submodule | [npm](https://www.npmjs.com/package/@juspay-tech/react-hyper-js) | git submodule |
| **Role** | Primary web SDK. ReScript-built React library for unified checkout. | Shared SDK core consumed transitively by every client SDK. | Idiomatic React wrapper around the Hyper JS loader. | Shared utilities and assets used across client-core and hyperswitch-web. |
| **Depends on** | hyperswitch backend | None | hyperswitch-web | None |

### 4. Mobile SDKs

Native SDKs for embedding Hyperswitch checkout into mobile apps. All are built on top of [`hyperswitch-client-core`](https://github.com/juspay/hyperswitch-client-core), pulled in as a git submodule.

|  | [Android](https://github.com/juspay/hyperswitch-sdk-android) | [iOS](https://github.com/juspay/hyperswitch-sdk-ios) | [React Native](https://github.com/juspay/react-native-hyperswitch) | [Flutter](https://github.com/juspay/flutter_hyperswitch) |
| :--- | :---: | :---: | :---: | :---: |
| **Repository** | hyperswitch-sdk-android | hyperswitch-sdk-ios | react-native-hyperswitch | flutter_hyperswitch |
| **Language** | Kotlin | Swift | TypeScript | Dart |
| **Distribution** | Maven | CocoaPods (SPM in progress) | npm | pub.dev |
| **Status** | Officially supported | Officially supported | Officially supported | Officially supported |

> [!IMPORTANT]
> An older repo, `hyperswitch-sdk-react-native`, is being deprecated and has already been removed from npm. Use [`react-native-hyperswitch`](https://github.com/juspay/react-native-hyperswitch) instead.

### 5. Deployment & infrastructure

Tooling for running Hyperswitch, from local development through production.

|  | [hyperswitch-suite](https://github.com/juspay/hyperswitch-suite) | [hyperswitch-helm](https://github.com/juspay/hyperswitch-helm) |
| :--- | :---: | :---: |
| **Tooling** | Terraform (HCL) | Helm charts |
| **Role** | Umbrella full-suite deployment that wires the core, vault, control-center, and web together. Recommended starting point for the full stack. | Kubernetes deployments for GCP, Azure, or any K8s-compatible platform. |


## Contributing

We welcome contributors from around the world to help build Hyperswitch. Whether you're fixing bugs, improving documentation, or adding new features, your help is appreciated.

Please read our [contributing guidelines](https://github.com/juspay/hyperswitch/blob/main/docs/CONTRIBUTING.md) to get started.

Join the conversation on [Slack](https://inviter.co/hyperswitch-slack) or explore open issues on [GitHub](https://github.com/juspay/hyperswitch/issues).

<a href="#feature-requests">
  <h2 id="feature-requests">Feature requests & Bugs</h2>
</a>

For new product features, enhancements, roadmap discussions, or to share queries and ideas, visit our [GitHub Discussions](https://github.com/juspay/hyperswitch/discussions)

For reporting a bug, please read the issue guidelines and search for [existing and closed issues](https://github.com/juspay/hyperswitch/issues). If your problem or idea is not addressed yet, please [open a new issue](https://github.com/juspay/hyperswitch/issues/new/choose).

<a href="#versioning">
  <h2 id="versioning">Versioning</h2>
</a>

Check the [CHANGELOG.md](./CHANGELOG.md) file for details.

<a href="#copyright-and-license">
  <h2 id="copyright-and-license">Copyright and License</h2>
</a>

This product is licensed under the [Apache 2.0 License](LICENSE).
