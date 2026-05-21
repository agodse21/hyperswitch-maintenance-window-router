/**
 * HTTP integration tests for the Hono app.
 *
 * Uses Hono's built-in `app.request()` — no real HTTP server needed.
 * Two dependencies are mocked:
 *   - `node:fs`  → controls which windows.json config the app sees
 *   - `fetch`    → controls what Hyperswitch "returns" (or throws)
 */

import { jest } from "@jest/globals";

// ── Mock node:fs before importing the app ────────────────────────────────────
const mockReadFileSync = jest.fn<typeof import("node:fs").readFileSync>();
jest.mock("node:fs", () => ({
  ...jest.requireActual<typeof import("node:fs")>("node:fs"),
  readFileSync: mockReadFileSync,
}));

// ── Mock global fetch ─────────────────────────────────────────────────────────
const mockFetch = jest.fn<typeof fetch>();
global.fetch = mockFetch;

// Import AFTER mocks are in place
import { app } from "../index";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setConfig(config: object): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockReadFileSync.mockReturnValue(JSON.stringify(config) as any);
}

function mockHyperswitch(body: object, status = 200): void {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockHyperswitchDown(): void {
  mockFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:8080"));
}

function paymentRequest(overrides: object = {}): Request {
  return new Request("http://localhost/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": "test_key" },
    body: JSON.stringify({ amount: 1000, currency: "USD", payment_id: "pay_test_001", ...overrides }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ status: "ok", service: "maintenance-window-router" });
  });
});

describe("POST /payments — routing decisions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("chooses primary connector when it has no maintenance window", async () => {
    setConfig({
      routingOrder: ["stripe", "adyen"],
      maintenanceWindows: { stripe: [], adyen: [] },
    });
    mockHyperswitch({ payment_id: "pay_hs_001", status: "processing" });

    const res = await app.request(paymentRequest());

    expect(res.status).toBe(200);
    // fetch was called with stripe forced in the body
    const calledBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(calledBody.routing).toEqual({ type: "single", data: { connector: "stripe" } });
  });

  it("skips stripe in maintenance and chooses adyen", async () => {
    setConfig({
      routingOrder: ["stripe", "adyen"],
      maintenanceWindows: {
        // Whole-day window guarantees stripe is always skipped
        stripe: [{ start: "00:00", end: "23:59" }],
        adyen: [],
      },
    });
    mockHyperswitch({ payment_id: "pay_hs_002", status: "processing" });

    const res = await app.request(paymentRequest({ payment_id: "pay_test_002" }));

    expect(res.status).toBe(200);
    const calledBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(calledBody.routing.data.connector).toBe("adyen");
  });

  it("returns 503 when all connectors are in maintenance", async () => {
    setConfig({
      routingOrder: ["stripe", "adyen"],
      maintenanceWindows: {
        stripe: [{ start: "00:00", end: "23:59" }],
        adyen: [{ start: "00:00", end: "23:59" }],
      },
    });

    const res = await app.request(paymentRequest({ payment_id: "pay_test_003" }));

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json).toMatchObject({ error: "all configured connectors are in maintenance" });
    // Should NOT have called Hyperswitch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 502 with routing_decision when Hyperswitch is unreachable", async () => {
    setConfig({
      routingOrder: ["stripe", "adyen"],
      maintenanceWindows: { stripe: [], adyen: [] },
    });
    mockHyperswitchDown();

    const res = await app.request(paymentRequest({ payment_id: "pay_test_004" }));

    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string; routing_decision: { chosen: string } };
    expect(json).toMatchObject({ error: "upstream Hyperswitch unreachable" });
    expect(json.routing_decision.chosen).toBe("stripe"); // still tells us which connector was picked
  });
});

describe("GET /routing-trace/:paymentId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the decision stored during a payment request", async () => {
    setConfig({
      routingOrder: ["stripe", "adyen"],
      maintenanceWindows: {
        stripe: [{ start: "00:00", end: "23:59" }],
        adyen: [],
      },
    });
    mockHyperswitchDown(); // upstream down — trace still stored before the call

    await app.request(paymentRequest({ payment_id: "pay_trace_001" }));

    const res = await app.request("/routing-trace/pay_trace_001");
    expect(res.status).toBe(200);
    const trace = (await res.json()) as { chosenConnector: string; skipped: Array<{ connector: string }> };
    expect(trace.chosenConnector).toBe("adyen");
    expect(trace.skipped[0]?.connector).toBe("stripe");
  });

  it("returns 404 for unknown payment ids", async () => {
    const res = await app.request("/routing-trace/does_not_exist_xyz");
    expect(res.status).toBe(404);
  });
});
