/**
 * Maintenance-window routing sidecar for Hyperswitch.
 *
 * Sits in front of Hyperswitch and pre-empts connector failover before
 * timeouts occur.  For every incoming payment the service:
 *
 *   1. Reads the ordered connector priority list from config.
 *   2. Filters out connectors currently in a declared UTC maintenance window.
 *   3. Forwards the payment to Hyperswitch with the chosen connector forced
 *      via `routing: { type: "single", data: { connector: "<name>" } }`.
 *   4. Records the decision in an in-memory trace store.
 *
 * Bonus endpoint:  GET /routing-trace/:paymentId
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import * as fs from "node:fs";
import * as path from "node:path";
import { decideConnector, utcMinsSinceMidnight, type RoutingConfig } from "./maintenanceWindow.js";
import { recordTrace, getTrace } from "./traceStore.js";

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_PATH =
  process.env.ROUTING_CONFIG_PATH ??
  path.join(__dirname, "..", "config", "windows.json");

const HYPERSWITCH_URL =
  process.env.HYPERSWITCH_URL ?? "http://localhost:8080";

function loadConfig(): RoutingConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw) as RoutingConfig;
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono();
app.use("*", logger());

/** Health check — also checked by Hyperswitch's open_router health probe. */
app.get("/health", (c) => c.json({ status: "ok", service: "maintenance-window-router" }));

/**
 * Payment proxy — the main routing entry point.
 *
 * Applies maintenance window filter, picks a connector, and forwards to
 * Hyperswitch with straight-through routing enforced.
 */
app.post("/payments", async (c) => {
  const apiKey = c.req.header("api-key") ?? "";
  const body = await c.req.json<Record<string, unknown>>();

  const config = loadConfig();
  const nowMins = utcMinsSinceMidnight();
  const decision = decideConnector(config.routingOrder, config.maintenanceWindows, nowMins);

  // Structured log for demo visibility
  if (decision.allInMaintenance) {
    console.warn(
      JSON.stringify({
        routing_decision: "all_connectors_in_maintenance_fallback",
        skipped: decision.skipped,
        nowUtcMins: nowMins,
      }),
    );
    return c.json({ error: "all configured connectors are in maintenance" }, 503);
  }

  for (const { connector, reason } of decision.skipped) {
    console.info(
      JSON.stringify({
        routing_decision: "connector_skipped",
        connector,
        reason,
        nowUtcMins: nowMins,
      }),
    );
  }

  console.info(
    JSON.stringify({
      routing_decision: "connector_chosen",
      connector: decision.chosen,
      skippedCount: decision.skipped.length,
      nowUtcMins: nowMins,
    }),
  );

  // Record the routing decision now — before the upstream call — so the
  // trace is always available even if Hyperswitch is unreachable.
  const requestPaymentId = (body.payment_id as string | undefined) ?? `pending_${Date.now()}`;
  recordTrace(requestPaymentId, decision);

  // Inject straight-through routing so Hyperswitch uses our chosen connector
  const enrichedBody = {
    ...body,
    routing: {
      type: "single",
      data: { connector: decision.chosen },
    },
  };

  let hsResponse: Response;
  try {
    hsResponse = await fetch(`${HYPERSWITCH_URL}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(enrichedBody),
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "upstream_unreachable", error: String(err) }));
    return c.json(
      {
        error: "upstream Hyperswitch unreachable",
        routing_decision: { chosen: decision.chosen, skipped: decision.skipped },
      },
      502,
    );
  }

  const responseJson = (await hsResponse.json()) as { payment_id?: string };

  // Update trace with the real payment_id returned by Hyperswitch (if different)
  const finalPaymentId = responseJson.payment_id ?? requestPaymentId;
  if (finalPaymentId !== requestPaymentId) {
    recordTrace(finalPaymentId, decision);
  }

  return c.json(responseJson, hsResponse.status as 200);
});

/**
 * Routing trace endpoint (bonus).
 * Returns the maintenance-window decision that was made for a given payment.
 */
app.get("/routing-trace/:paymentId", (c) => {
  const { paymentId } = c.req.param();
  const trace = getTrace(paymentId);
  if (!trace) {
    return c.json({ error: "trace not found", paymentId }, 404);
  }
  return c.json(trace);
});

// ── Server ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Skip binding when imported by Jest so tests don't leave open handles.
if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.info(`routing-service listening on :${PORT}`);
    console.info(`upstream Hyperswitch: ${HYPERSWITCH_URL}`);
    console.info(`config: ${CONFIG_PATH}`);
  });
}

export { app };
