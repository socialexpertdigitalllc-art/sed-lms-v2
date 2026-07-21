import { describe, it, expect } from "vitest";
import {
  isOrphaned,
  isInFlightStatus,
  orphanSilenceMinutes,
  shouldReclaimQueueRow,
  IN_FLIGHT_STATUSES,
  ORPHAN_AFTER_MS,
} from "@/lib/template-engine/liveness";
import { rollBackRunningSteps } from "@/lib/template-engine/forceResolve";
import type { GenStep } from "@/lib/template-engine/types";

const NOW = Date.parse("2026-07-21T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
/** Fresh enough that no honest test should ever call it dead. */
const FRESH = ago(5_000);
/** Well past the threshold — a runner that has been gone for a while. */
const STALE = ago(ORPHAN_AFTER_MS + 60_000);

describe("in-flight statuses", () => {
  it("covers exactly the statuses that claim a runner is executing", () => {
    for (const s of IN_FLIGHT_STATUSES) expect(isInFlightStatus(s)).toBe(true);
    for (const s of ["queued", "curating", "paused", "review", "ready_for_review", "deployed", "failed", "cancelled"]) {
      expect(isInFlightStatus(s)).toBe(false);
    }
  });
  it("tolerates junk from DB JSON", () => {
    for (const s of [null, undefined, 1, {}, []]) expect(isInFlightStatus(s)).toBe(false);
  });
});

describe("isOrphaned — at-rest and terminal statuses", () => {
  it("never calls an at-rest run orphaned, however old it is", () => {
    for (const status of ["queued", "curating", "paused"]) {
      expect(isOrphaned({ status, heartbeatAt: STALE, updatedAt: STALE, now: NOW })).toBe(false);
    }
  });
  it("never calls a finished run orphaned", () => {
    for (const status of ["review", "deployed", "failed", "cancelled"]) {
      expect(isOrphaned({ status, heartbeatAt: null, updatedAt: STALE, now: NOW })).toBe(false);
    }
  });
});

describe("isOrphaned — fresh heartbeat", () => {
  it("a beating run is alive in every in-flight status", () => {
    for (const status of IN_FLIGHT_STATUSES) {
      expect(isOrphaned({ status, heartbeatAt: FRESH, updatedAt: STALE, now: NOW })).toBe(false);
    }
  });
  it("is alive right up to the threshold and dead after it", () => {
    const at = { status: "building", updatedAt: null, now: NOW };
    expect(isOrphaned({ ...at, heartbeatAt: ago(ORPHAN_AFTER_MS) })).toBe(false);
    expect(isOrphaned({ ...at, heartbeatAt: ago(ORPHAN_AFTER_MS + 1) })).toBe(true);
  });
  it("treats clock skew (a heartbeat from the future) as alive", () => {
    expect(isOrphaned({ status: "building", heartbeatAt: new Date(NOW + 30_000).toISOString(), now: NOW })).toBe(false);
  });
  it("accepts a Date or epoch ms as well as an ISO string", () => {
    expect(isOrphaned({ status: "building", heartbeatAt: new Date(NOW - 1_000), now: NOW })).toBe(false);
    expect(isOrphaned({ status: "building", heartbeatAt: NOW - ORPHAN_AFTER_MS - 1_000, now: NOW })).toBe(true);
  });
});

describe("isOrphaned — stale heartbeat is the incident", () => {
  it("declares the incident's row orphaned: building, control set, heartbeat hours old", () => {
    expect(
      isOrphaned({
        status: "building",
        heartbeatAt: ago(4 * 60 * 60 * 1000),
        // The operator's own repeated Stop clicks kept this fresh while the
        // runner was long dead. It must not save the row from being orphaned.
        updatedAt: ago(2_000),
        now: NOW,
      }),
    ).toBe(true);
  });
  it("ignores updated_at entirely whenever a heartbeat exists", () => {
    // Fresh heartbeat + ancient updated_at -> alive. Stale heartbeat + fresh
    // updated_at -> dead. updated_at never decides.
    expect(isOrphaned({ status: "building", heartbeatAt: FRESH, updatedAt: ago(86_400_000), now: NOW })).toBe(false);
    expect(isOrphaned({ status: "building", heartbeatAt: STALE, updatedAt: ago(1), now: NOW })).toBe(true);
  });
});

describe("isOrphaned — null heartbeat (rows written before migration 0047)", () => {
  it("falls back to the row's age: a young row is left alone", () => {
    expect(isOrphaned({ status: "planning", heartbeatAt: null, updatedAt: ago(10_000), now: NOW })).toBe(false);
  });
  it("falls back to the row's age: an old row is orphaned", () => {
    expect(isOrphaned({ status: "planning", heartbeatAt: null, updatedAt: STALE, now: NOW })).toBe(true);
  });
  it("treats an absent column the same as null", () => {
    expect(isOrphaned({ status: "building", updatedAt: STALE, now: NOW })).toBe(true);
    expect(isOrphaned({ status: "building", updatedAt: FRESH, now: NOW })).toBe(false);
  });
  it("refuses to guess when there is no usable timestamp at all", () => {
    expect(isOrphaned({ status: "building", heartbeatAt: null, updatedAt: null, now: NOW })).toBe(false);
    expect(isOrphaned({ status: "building", heartbeatAt: "not a date", updatedAt: "nope", now: NOW })).toBe(false);
  });
});

describe("orphanSilenceMinutes", () => {
  it("reports whole minutes since the last heartbeat", () => {
    expect(orphanSilenceMinutes({ heartbeatAt: ago(7 * 60_000 + 5_000), now: NOW })).toBe(7);
  });
  it("prefers the heartbeat over the row age, and never reports zero", () => {
    expect(orphanSilenceMinutes({ heartbeatAt: ago(300_000), updatedAt: ago(1_000), now: NOW })).toBe(5);
    expect(orphanSilenceMinutes({ heartbeatAt: ago(1_000), now: NOW })).toBe(1);
  });
  it("falls back to the row age, and to 0 with nothing to go on", () => {
    expect(orphanSilenceMinutes({ updatedAt: ago(180_000), now: NOW })).toBe(3);
    expect(orphanSilenceMinutes({ now: NOW })).toBe(0);
  });
});

describe("shouldReclaimQueueRow", () => {
  const gen = (over: Record<string, unknown> = {}) => ({ status: "building", heartbeatAt: FRESH, ...over });

  it("only ever considers rows that are processing", () => {
    for (const queueStatus of ["pending", "done", "failed", null, undefined]) {
      expect(shouldReclaimQueueRow({ queueStatus, generation: gen({ heartbeatAt: STALE }), now: NOW })).toBe(false);
    }
  });
  it("leaves a healthy in-flight run alone", () => {
    expect(shouldReclaimQueueRow({ queueStatus: "processing", generation: gen(), now: NOW })).toBe(false);
  });
  it("reclaims a processing row whose generation stopped heartbeating", () => {
    expect(shouldReclaimQueueRow({ queueStatus: "processing", generation: gen({ heartbeatAt: STALE }), now: NOW })).toBe(true);
  });
  it("reclaims a processing row whose generation no longer exists", () => {
    expect(shouldReclaimQueueRow({ queueStatus: "processing", generation: null, now: NOW })).toBe(true);
  });
  it("leaves a run resting at curating alone — the processor is about to close its row", () => {
    expect(
      shouldReclaimQueueRow({ queueStatus: "processing", generation: gen({ status: "curating", heartbeatAt: STALE }), now: NOW }),
    ).toBe(false);
  });
});

describe("rollBackRunningSteps", () => {
  const step = (key: string, status: GenStep["status"]): GenStep => ({
    key,
    label: key,
    status,
    ...(status === "running" ? { started_at: "2026-07-21T11:00:00.000Z" } : {}),
  });

  it("rolls unfinished steps back to pending and drops their start time", () => {
    const out = rollBackRunningSteps([step("plan", "done"), step("verify", "running")]);
    expect(out.map((s) => s.status)).toEqual(["done", "pending"]);
    expect(out[1].started_at).toBeUndefined();
  });
  it("leaves every other status exactly as it was", () => {
    const input = [step("a", "done"), step("b", "failed"), step("c", "partial"), step("d", "pending")];
    expect(rollBackRunningSteps(input)).toEqual(input);
  });
  it("does not mutate its input", () => {
    const input = [step("verify", "running")];
    rollBackRunningSteps(input);
    expect(input[0].status).toBe("running");
  });
  it("handles an empty timeline", () => {
    expect(rollBackRunningSteps([])).toEqual([]);
  });
});
