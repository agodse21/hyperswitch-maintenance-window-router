/**
 * In-memory routing trace store.
 *
 * Keeps the last MAX_ENTRIES routing decisions so the bonus
 * GET /routing-trace/:paymentId endpoint can serve them without a DB.
 * Oldest entries are evicted once the cap is reached.
 */

import type { RoutingDecision } from "./maintenanceWindow.js";

export interface TraceEntry extends RoutingDecision {
  paymentId: string;
  chosenConnector: string | null;
  timestamp: string; // ISO 8601 UTC
}

const MAX_ENTRIES = 1_000;
const store = new Map<string, TraceEntry>();

export function recordTrace(paymentId: string, decision: RoutingDecision): void {
  if (store.size >= MAX_ENTRIES) {
    // Evict oldest entry
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(paymentId, {
    ...decision,
    paymentId,
    chosenConnector: decision.chosen,
    timestamp: new Date().toISOString(),
  });
}

export function getTrace(paymentId: string): TraceEntry | undefined {
  return store.get(paymentId);
}

/** Exposed for tests only — clears the store. */
export function _clearStore(): void {
  store.clear();
}
