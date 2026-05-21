import {
  parseHHMM,
  isWindowActive,
  decideConnector,
  type MaintenanceWindow,
  type RoutingConfig,
} from "../maintenanceWindow";

// ── Helpers ───────────────────────────────────────────────────────────────────

function win(start: string, end: string): MaintenanceWindow {
  return { start, end };
}

function configWith(connector: string, windows: MaintenanceWindow[]): RoutingConfig {
  return {
    routingOrder: [connector, "adyen"],
    maintenanceWindows: { [connector]: windows },
  };
}

// ── Unit: parseHHMM ───────────────────────────────────────────────────────────

describe("parseHHMM", () => {
  it("parses valid times", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("02:30")).toBe(150);
    expect(parseHHMM("23:59")).toBe(1439);
  });

  it("returns null on malformed input (safe default → window inactive)", () => {
    expect(parseHHMM("25:00")).toBeNull();
    expect(parseHHMM("ab:cd")).toBeNull();
    expect(parseHHMM("0230")).toBeNull();
  });
});

// ── Unit: isWindowActive ──────────────────────────────────────────────────────

describe("isWindowActive", () => {
  it("returns false for malformed bounds (safe default)", () => {
    expect(isWindowActive({ start: "bad", end: "04:00" }, 150)).toBe(false);
  });
});

// ── Integration: decideConnector ─────────────────────────────────────────────

/**
 * Happy path: primary connector (stripe) is in maintenance, fallback (adyen) is chosen.
 * Verifies the skipped array contains stripe and the chosen connector is adyen.
 */
describe("decideConnector — happy path", () => {
  it("skips stripe (in maintenance 02:00–04:00) and chooses adyen at 02:30 UTC", () => {
    const config: RoutingConfig = {
      routingOrder: ["stripe", "adyen"],
      maintenanceWindows: {
        stripe: [win("02:00", "04:00")],
      },
    };
    const nowMins = 2 * 60 + 30; // 02:30 → inside stripe window

    const result = decideConnector(config.routingOrder, config.maintenanceWindows, nowMins);

    expect(result.chosen).toBe("adyen");
    expect(result.allInMaintenance).toBe(false);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toEqual({ connector: "stripe", reason: "maintenance_window" });
    expect(result.nowUtcMins).toBe(nowMins);
  });
});

/**
 * Edge case: window crosses midnight (23:00–01:00).
 * Tests all four boundary conditions:
 *   - 23:30 → inside
 *   - 00:30 → inside (post-midnight)
 *   - 01:00 → outside (exclusive end)
 *   - 22:59 → outside (before start)
 */
describe("decideConnector — midnight-crossing window edge case", () => {
  const config: RoutingConfig = {
    routingOrder: ["stripe", "adyen"],
    maintenanceWindows: {
      stripe: [win("23:00", "01:00")],
    },
  };

  it("skips stripe at 23:30 (inside 23:00–01:00)", () => {
    const result = decideConnector(config.routingOrder, config.maintenanceWindows, 23 * 60 + 30);
    expect(result.chosen).toBe("adyen");
    expect(result.skipped[0]?.connector).toBe("stripe");
  });

  it("skips stripe at 00:30 (post-midnight, still inside 23:00–01:00)", () => {
    const result = decideConnector(config.routingOrder, config.maintenanceWindows, 30);
    expect(result.chosen).toBe("adyen");
    expect(result.skipped[0]?.connector).toBe("stripe");
  });

  it("does NOT skip stripe at 01:00 (exclusive end boundary)", () => {
    const result = decideConnector(config.routingOrder, config.maintenanceWindows, 60);
    expect(result.chosen).toBe("stripe");
    expect(result.skipped).toHaveLength(0);
  });

  it("does NOT skip stripe at 22:59 (before window starts)", () => {
    const result = decideConnector(config.routingOrder, config.maintenanceWindows, 22 * 60 + 59);
    expect(result.chosen).toBe("stripe");
    expect(result.skipped).toHaveLength(0);
  });
});

/**
 * Failure mode: every connector in the routing list is in maintenance.
 * The result must have `chosen = null` and `allInMaintenance = true` so
 * the caller can return a 503 rather than routing to an unavailable connector.
 */
describe("decideConnector — failure: all connectors in maintenance", () => {
  it("returns chosen=null and allInMaintenance=true when all connectors are down", () => {
    const config: RoutingConfig = {
      routingOrder: ["stripe", "adyen"],
      maintenanceWindows: {
        stripe: [win("02:00", "04:00")],
        adyen: [win("02:00", "04:00")],
      },
    };
    const nowMins = 3 * 60; // 03:00 — both in maintenance

    const result = decideConnector(config.routingOrder, config.maintenanceWindows, nowMins);

    expect(result.chosen).toBeNull();
    expect(result.allInMaintenance).toBe(true);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.connector)).toEqual(["stripe", "adyen"]);
  });
});
