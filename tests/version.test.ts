import { describe, it, expect } from "vitest";
import {
  APP_VERSION,
  CHANGELOG,
  compareVersions,
  formatVersion,
  parseVersion,
} from "@/lib/version/changelog";

describe("parseVersion", () => {
  it("splits a version into numeric parts", () => {
    expect(parseVersion("2.6.1")).toEqual([2, 6, 1]);
    expect(parseVersion("2.0.0")).toEqual([2, 0, 0]);
    expect(parseVersion("2.10.12")).toEqual([2, 10, 12]);
  });
  it("tolerates a leading v", () => {
    expect(parseVersion("v2.3.4")).toEqual([2, 3, 4]);
  });
  it("throws on a malformed version", () => {
    expect(() => parseVersion("2.6")).toThrow();
    expect(() => parseVersion("banana")).toThrow();
  });
});

describe("formatVersion", () => {
  it("prefixes with v", () => {
    expect(formatVersion("2.6.1")).toBe("v2.6.1");
  });
  it("does not double the prefix", () => {
    expect(formatVersion("v2.6.1")).toBe("v2.6.1");
  });
});

describe("compareVersions", () => {
  it("orders by minor then patch", () => {
    expect(compareVersions("2.6.1", "2.6.0")).toBeGreaterThan(0);
    expect(compareVersions("2.6.0", "2.7.0")).toBeLessThan(0);
    expect(compareVersions("2.6.1", "2.6.1")).toBe(0);
  });
  it("compares numerically, not lexically", () => {
    expect(compareVersions("2.10.0", "2.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.1.10", "2.1.9")).toBeGreaterThan(0);
  });
  it("sorts newest-first when used as a descending comparator", () => {
    const sorted = ["2.1.0", "2.10.0", "2.2.1"].sort((a, b) => compareVersions(b, a));
    expect(sorted).toEqual(["2.10.0", "2.2.1", "2.1.0"]);
  });
});

describe("CHANGELOG", () => {
  it("is not empty", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  it("is ordered strictly newest-first", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(
        compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version),
      ).toBeGreaterThan(0);
    }
  });

  it("uses unique v2 versions", () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const v of versions) expect(v).toMatch(/^2\.\d+\.\d+$/);
  });

  it("exposes the newest version as APP_VERSION", () => {
    expect(APP_VERSION).toBe(CHANGELOG[0].version);
  });

  it("gives every entry a title, an ISO date and at least one change", () => {
    for (const entry of CHANGELOG) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.date))).toBe(false);
      expect(entry.changes.length).toBeGreaterThan(0);
      for (const change of entry.changes) {
        expect(["feature", "improvement", "fix"]).toContain(change.kind);
        expect(change.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("never goes back in time as versions increase", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(Date.parse(CHANGELOG[i - 1].date)).toBeGreaterThanOrEqual(
        Date.parse(CHANGELOG[i].date),
      );
    }
  });
});
