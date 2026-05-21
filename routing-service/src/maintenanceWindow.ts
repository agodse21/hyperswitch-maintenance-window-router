/**
 * Time-of-day maintenance window routing filter.
 *
 * Pure functions — no I/O, no global state.  `nowMins` is always injected
 * so tests can use any time without patching Date.
 */

export interface MaintenanceWindow {
  /** Window start in "HH:MM" UTC (inclusive). */
  start: string;
  /** Window end in "HH:MM" UTC (exclusive). */
  end: string;
}

export interface RoutingConfig {
  /** Ordered list of connectors — first available wins. */
  routingOrder: string[];
  /** connector_name → UTC maintenance windows */
  maintenanceWindows: Record<string, MaintenanceWindow[]>;
}

export interface RoutingDecision {
  /** Chosen connector, or null when every candidate is in maintenance. */
  chosen: string | null;
  skipped: Array<{ connector: string; reason: string }>;
  nowUtcMins: number;
  allInMaintenance: boolean;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

/**
 * Parse "HH:MM" into minutes since midnight (0–1439).
 * Returns null when the string is malformed so callers can treat the window
 * as inactive rather than throwing.
 */
export function parseHHMM(s: string): number | null {
  const [hStr, mStr] = s.split(":");
  const h = parseInt(hStr ?? "", 10);
  const m = parseInt(mStr ?? "", 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// ── Window check ─────────────────────────────────────────────────────────────

/**
 * Returns true if `nowMins` falls inside `[start, end)`.
 * Handles midnight-crossing windows (start > end).
 * Returns false on parse error (safe default — window treated as inactive).
 */
export function isWindowActive(window: MaintenanceWindow, nowMins: number): boolean {
  const start = parseHHMM(window.start);
  const end = parseHHMM(window.end);
  if (start === null || end === null) return false;

  if (start <= end) {
    return nowMins >= start && nowMins < end;
  }
  // Crosses midnight: active from start→EOD OR midnight→end
  return nowMins >= start || nowMins < end;
}

/**
 * Returns true if `connector` is currently inside any of its declared windows.
 */
export function isConnectorInMaintenance(
  connector: string,
  windows: Record<string, MaintenanceWindow[]>,
  nowMins: number,
): boolean {
  return (windows[connector] ?? []).some((w) => isWindowActive(w, nowMins));
}

// ── Decision ──────────────────────────────────────────────────────────────────

/**
 * Apply maintenance window filter to an ordered connector list.
 *
 * Returns the first available connector and a full audit trail.
 * Returns `null` for `chosen` when every connector is in maintenance.
 *
 * @param routingOrder - Ordered connectors to try (priority order)
 * @param windows      - Maintenance window config
 * @param nowMins      - Current UTC minutes since midnight (0–1439)
 */
export function decideConnector(
  routingOrder: string[],
  windows: Record<string, MaintenanceWindow[]>,
  nowMins: number,
): RoutingDecision {
  const skipped: Array<{ connector: string; reason: string }> = [];

  for (const connector of routingOrder) {
    if (isConnectorInMaintenance(connector, windows, nowMins)) {
      skipped.push({ connector, reason: "maintenance_window" });
    } else {
      return { chosen: connector, skipped, nowUtcMins: nowMins, allInMaintenance: false };
    }
  }

  return { chosen: null, skipped, nowUtcMins: nowMins, allInMaintenance: true };
}

// ── Clock helper ─────────────────────────────────────────────────────────────

/** Current UTC minutes since midnight. Isolated for testability. */
export function utcMinsSinceMidnight(): number {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}
