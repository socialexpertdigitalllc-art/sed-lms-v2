/**
 * The pure decision logic behind the "No candidates" fix: the page-loop stop
 * condition, the per-click stats aggregation, the operator-facing sentence,
 * the per-slot people override, and the curated-fallback merge. None of these
 * touch Pexels, Gemini or the DB.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateGatherStats,
  describeGatherStats,
  emptyGatherStats,
  slotExcludesPeople,
  type GatherAttempt,
  type ImageCandidate,
} from "@/lib/template-engine/imageSlots";
import {
  shouldContinuePaging,
  DEFAULT_PAGING_LIMITS,
  MIN_NEW_CANDIDATES,
  MAX_PAGES_PER_CLICK,
  GATHER_TIME_BUDGET_MS,
} from "@/lib/template-engine/gatherImages";
import { pickCuratedCandidates } from "@/lib/template-engine/curatedImages";

const attempt = (over: Partial<GatherAttempt> = {}): GatherAttempt => ({
  query: "roof repair",
  broadened: false,
  page: 2,
  fetched: 12,
  alreadySeen: 0,
  rejectedByVision: 0,
  trimmed: 0,
  kept: 0,
  ...over,
});

describe("shouldContinuePaging", () => {
  it("keeps paging while under every budget and short of the target", () => {
    expect(shouldContinuePaging({ kept: 0, pagesConsumed: 0, elapsedMs: 0 })).toBe(true);
    expect(shouldContinuePaging({ kept: 3, pagesConsumed: 2, elapsedMs: 10_000 })).toBe(true);
  });

  it("stops as soon as the click has MIN_NEW_CANDIDATES", () => {
    expect(shouldContinuePaging({ kept: MIN_NEW_CANDIDATES, pagesConsumed: 0, elapsedMs: 0 })).toBe(false);
    expect(shouldContinuePaging({ kept: MIN_NEW_CANDIDATES + 5, pagesConsumed: 0, elapsedMs: 0 })).toBe(false);
  });

  it("stops at the page budget even with zero candidates found", () => {
    expect(shouldContinuePaging({ kept: 0, pagesConsumed: MAX_PAGES_PER_CLICK, elapsedMs: 0 })).toBe(false);
  });

  it("stops at the time budget even with pages left", () => {
    expect(shouldContinuePaging({ kept: 0, pagesConsumed: 1, elapsedMs: GATHER_TIME_BUDGET_MS })).toBe(false);
    expect(shouldContinuePaging({ kept: 0, pagesConsumed: 1, elapsedMs: GATHER_TIME_BUDGET_MS - 1 })).toBe(true);
  });

  it("honours injected limits (so the budgets are tunable, not hard-wired)", () => {
    const limits = { minNew: 1, maxPages: 10, timeBudgetMs: 1000 };
    expect(shouldContinuePaging({ kept: 1, pagesConsumed: 0, elapsedMs: 0 }, limits)).toBe(false);
    expect(shouldContinuePaging({ kept: 0, pagesConsumed: 4, elapsedMs: 0 }, limits)).toBe(true);
  });

  it("ships the intended defaults", () => {
    expect(DEFAULT_PAGING_LIMITS).toEqual({ minNew: 4, maxPages: 3, timeBudgetMs: 25_000 });
  });
});

describe("aggregateGatherStats", () => {
  it("sums every counter across attempts", () => {
    const stats = aggregateGatherStats([
      attempt({ page: 2, fetched: 12, rejectedByVision: 10, alreadySeen: 1, kept: 1 }),
      attempt({ page: 3, fetched: 12, rejectedByVision: 8, trimmed: 2, kept: 2 }),
    ]);
    expect(stats.fetched).toBe(24);
    expect(stats.rejectedByVision).toBe(18);
    expect(stats.alreadySeen).toBe(1);
    expect(stats.trimmed).toBe(2);
    expect(stats.kept).toBe(3);
    expect(stats.pages).toBe(2);
  });

  it("counts a broadened retry of the SAME page as one page, and records both queries", () => {
    const stats = aggregateGatherStats([
      attempt({ page: 2, query: "bespoke soffit repair", kept: 0 }),
      attempt({ page: 2, query: "Roofing", broadened: true, kept: 4 }),
    ]);
    expect(stats.pages).toBe(1);
    expect(stats.queries).toEqual(["bespoke soffit repair", "Roofing"]);
    expect(stats.broadened).toBe(true);
  });

  it("is empty-safe and defaults timedOut to false", () => {
    expect(aggregateGatherStats([])).toEqual(emptyGatherStats());
    expect(aggregateGatherStats([attempt()], { timedOut: true }).timedOut).toBe(true);
  });
});

describe("describeGatherStats", () => {
  it("says nothing when no gather has run (legacy slots have no stats)", () => {
    expect(describeGatherStats(undefined)).toBe("");
    expect(describeGatherStats(emptyGatherStats())).toBe("");
  });

  it("explains the real reason a slot looks empty", () => {
    const stats = aggregateGatherStats([
      attempt({ fetched: 12, rejectedByVision: 11, alreadySeen: 1, kept: 0 }),
    ]);
    expect(describeGatherStats(stats)).toBe(
      "Searched 1 page: found 12, 11 filtered out (people), 1 already shown, 0 new.",
    );
  });

  it("distinguishes 'Pexels had nothing' from 'everything was filtered'", () => {
    const stats = aggregateGatherStats([attempt({ fetched: 0 })]);
    expect(describeGatherStats(stats)).toBe("Searched 1 page — Pexels had no more photos for this search.");
  });

  it("mentions the broader search and the time budget when they applied", () => {
    const stats = aggregateGatherStats(
      [
        attempt({ page: 2, fetched: 12, rejectedByVision: 12 }),
        attempt({ page: 2, query: "Roofing", broadened: true, fetched: 12, rejectedByVision: 10, kept: 2 }),
      ],
      { timedOut: true },
    );
    const line = describeGatherStats(stats);
    expect(line).toContain("Also tried a broader search.");
    expect(line).toContain("Stopped early on the time budget");
    expect(line).toContain("2 new");
  });

  it("reports trimmed candidates separately from filtered ones", () => {
    const stats = aggregateGatherStats([attempt({ fetched: 12, trimmed: 7, kept: 5 })]);
    expect(describeGatherStats(stats)).toBe("Searched 1 page: found 12, 7 over this slot's limit, 5 new.");
  });
});

describe("slotExcludesPeople", () => {
  it("inherits the generation when the slot has no override (legacy slots)", () => {
    expect(slotExcludesPeople({}, true)).toBe(true);
    expect(slotExcludesPeople({}, false)).toBe(false);
    expect(slotExcludesPeople({ allow_people: undefined }, true)).toBe(true);
  });

  it("only an explicit true lifts the gate for one slot", () => {
    expect(slotExcludesPeople({ allow_people: true }, true)).toBe(false);
    expect(slotExcludesPeople({ allow_people: false }, true)).toBe(true);
  });

  it("never re-imposes the gate the generation already dropped", () => {
    expect(slotExcludesPeople({ allow_people: true }, false)).toBe(false);
  });
});

describe("pickCuratedCandidates", () => {
  const c = (url: string): ImageCandidate => ({ url, thumb: url, source: "curated" });

  it("puts exact service_key matches ahead of the broader business_type ones", () => {
    const out = pickCuratedCandidates([c("a"), c("b")], [c("c")], []);
    expect(out.map((x) => x.url)).toEqual(["a", "b", "c"]);
  });

  it("drops urls the slot already shows, and de-dupes across both lists", () => {
    const out = pickCuratedCandidates([c("a"), c("b")], [c("b"), c("c")], ["a"]);
    expect(out.map((x) => x.url)).toEqual(["b", "c"]);
  });

  it("respects the limit", () => {
    const out = pickCuratedCandidates([c("a"), c("b"), c("c")], [], [], 2);
    expect(out).toHaveLength(2);
  });
});
