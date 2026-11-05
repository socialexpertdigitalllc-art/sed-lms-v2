import { describe, it, expect, vi } from "vitest";
import {
  LeadsSync,
  createSyncScheduler,
  permissionFingerprint,
  CACHE_VERSION,
  CACHE_MAX_AGE_MS,
  OVERLAP_MS,
  PAGE_SIZE,
  type CachedLeads,
  type LeadsCache,
  type LeadsSource,
  type SyncRow,
  type TagLink,
} from "@/lib/leads/liveSync";

/**
 * A fake database behind row-level security: `rows` is the whole table,
 * `canSee` is the viewer's policy, and every read counts itself so the tests
 * can prove a change costs a delta, not a full re-read.
 */
function fakeDb(initial: SyncRow[], canSee: (r: SyncRow) => boolean = () => true) {
  const db = {
    rows: initial.map((r) => ({ ...r })),
    links: [] as TagLink[],
    canSee,
    reads: { page: 0, changedSince: 0, count: 0, ids: 0, byIds: 0, tagLinks: 0 },
    lastSince: "",
  };
  const visible = () => db.rows.filter((r) => db.canSee(r));
  const live = () => visible().filter((r) => !r.deleted_at);
  const withTags = (r: SyncRow): SyncRow => ({
    ...r,
    tag_ids: db.links.filter((l) => l.lead_id === r.id).map((l) => l.tag_id).sort(),
  });
  const source: LeadsSource = {
    async page(from, to) {
      db.reads.page++;
      const sorted = [...live()].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1));
      return sorted.slice(from, to + 1).map(withTags);
    },
    async changedSince(since, from, to) {
      db.reads.changedSince++;
      db.lastSince = since;
      const out = visible()
        .filter((r) => r.updated_at > since)
        .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1));
      return out.slice(from, to + 1).map(withTags);
    },
    async count() {
      db.reads.count++;
      return live().length;
    },
    async ids(from, to) {
      db.reads.ids++;
      return live().map((r) => r.id).sort().slice(from, to + 1);
    },
    async byIds(ids) {
      db.reads.byIds++;
      return live().filter((r) => ids.includes(r.id)).map(withTags);
    },
    async tagLinks(from, to) {
      db.reads.tagLinks++;
      return db.links.slice(from, to + 1);
    },
  };
  return { db, source };
}

const T0 = Date.parse("2026-11-05T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function lead(id: string, minute: number, extra: Partial<SyncRow> = {}): SyncRow {
  return {
    id,
    business_name: `Biz ${id}`,
    status: "Ready",
    agent_id: "agent-1",
    created_at: iso(T0 + minute * 60_000),
    updated_at: iso(T0 + minute * 60_000),
    deleted_at: null,
    tag_ids: [],
    ...extra,
  } as unknown as SyncRow;
}

function memCache(): LeadsCache & { store: Map<string, CachedLeads> } {
  const store = new Map<string, CachedLeads>();
  return {
    store,
    async load(k) {
      return store.get(k) ?? null;
    },
    async save(k, v) {
      store.set(k, JSON.parse(JSON.stringify(v)));
    },
  };
}

const ids = (s: LeadsSync) => s.getSnapshot().leads.map((l) => l.id);
const clock = (start = T0 + 60 * 60_000) => {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

describe("live leads — first visit", () => {
  it("reads every lead once, newest first, and is ready", async () => {
    const { db, source } = fakeDb([lead("a", 1), lead("b", 3), lead("c", 2)]);
    const s = new LeadsSync(source, null, "leads:u1", "fp");
    expect(s.getSnapshot().status).toBe("idle");
    await s.start();
    expect(s.getSnapshot().status).toBe("ready");
    expect(ids(s)).toEqual(["b", "c", "a"]);
    expect(db.reads.page).toBe(1);
  });

  it("pages past 1,000 rows (PostgREST's cap)", async () => {
    const many = Array.from({ length: PAGE_SIZE + 7 }, (_, i) => lead(`l${String(i).padStart(5, "0")}`, i));
    const { db, source } = fakeDb(many);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    expect(s.getSnapshot().leads).toHaveLength(PAGE_SIZE + 7);
    expect(db.reads.page).toBe(2);
  });

  it("never shows soft-deleted leads", async () => {
    const { source } = fakeDb([lead("a", 1), lead("gone", 2, { deleted_at: iso(T0) })]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    expect(ids(s)).toEqual(["a"]);
  });

  it("a failed first read shows an error, and a retry recovers", async () => {
    const { source } = fakeDb([lead("a", 1)]);
    const page = source.page;
    source.page = vi.fn().mockRejectedValueOnce(new Error("network down")).mockImplementation(page);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    expect(s.getSnapshot()).toMatchObject({ status: "error", error: "network down" });
    await s.sync();
    expect(s.getSnapshot()).toMatchObject({ status: "ready", error: null });
    expect(ids(s)).toEqual(["a"]);
  });
});

describe("live leads — a change costs only the changed rows", () => {
  it("an edit is patched in place from a 'changed since' read, no full re-read", async () => {
    const { db, source } = fakeDb([lead("a", 1), lead("b", 2)]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    const before = s.getSnapshot().leads;

    db.rows[0] = { ...db.rows[0], status: "Closed", updated_at: iso(T0 + 30 * 60_000) } as SyncRow;
    await s.sync();

    expect(db.reads.page).toBe(1); // still just the first visit
    expect(db.reads.changedSince).toBe(1);
    expect(s.getSnapshot().leads.find((l) => l.id === "a")?.status).toBe("Closed");
    expect(s.getSnapshot().leads).not.toBe(before);
  });

  it("asks for changes from a little BEFORE the newest it has (late commits are not missed)", async () => {
    const { db, source } = fakeDb([lead("a", 1), lead("b", 5)]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    await s.sync();
    expect(db.lastSince).toBe(iso(T0 + 5 * 60_000 - OVERLAP_MS));
  });

  it("a new lead appears; a soft-deleted one disappears", async () => {
    const { db, source } = fakeDb([lead("a", 1), lead("b", 2)]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    db.rows.push(lead("new", 40));
    db.rows[0] = { ...db.rows[0], deleted_at: iso(T0 + 41 * 60_000), updated_at: iso(T0 + 41 * 60_000) } as SyncRow;
    await s.sync();
    expect(ids(s)).toEqual(["new", "b"]);
    expect(db.reads.ids).toBe(0); // the count matched: no reconcile needed
  });

  it("nothing changed: two tiny reads, no new snapshot (screens don't re-render)", async () => {
    const { db, source } = fakeDb([lead("a", 1)]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    const snap = s.getSnapshot();
    const fn = vi.fn();
    s.subscribe(fn);
    await s.sync();
    expect(s.getSnapshot()).toBe(snap);
    expect(fn).not.toHaveBeenCalled();
    expect(db.reads).toMatchObject({ page: 1, changedSince: 1, count: 1, ids: 0 });
  });

  it("a burst of syncs while one runs folds into ONE more run", async () => {
    const { db, source } = fakeDb([lead("a", 1)]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    await Promise.all([s.sync(), s.sync(), s.sync(), s.sync()]);
    expect(db.reads.changedSince).toBe(2);
  });
});

describe("live leads — leads that leave or join the viewer's view", () => {
  it("a lead reassigned away is dropped (the count check catches it)", async () => {
    const { db, source } = fakeDb([lead("mine", 1), lead("moving", 2)], (r) => r.agent_id === "agent-1");
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    db.rows[1] = { ...db.rows[1], agent_id: "agent-2", updated_at: iso(T0 + 50 * 60_000) } as SyncRow;
    await s.sync();
    expect(ids(s)).toEqual(["mine"]);
    expect(db.reads.ids).toBe(1);
  });

  it("a lead that becomes visible without a new edit is fetched (e.g. joined a closer's team)", async () => {
    // "teams" was last edited long before anything the viewer has seen, so a
    // "changed since" read can never return it — only the count check can.
    const { db, source } = fakeDb([lead("mine", 30), lead("teams", 2, { agent_id: "agent-9" })], (r) => r.agent_id === "agent-1");
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    expect(ids(s)).toEqual(["mine"]);
    db.canSee = () => true; // the viewer's scope widened; no row changed
    await s.sync();
    expect(ids(s)).toEqual(["mine", "teams"]);
    expect(db.reads.byIds).toBe(1);
  });

  it("a hard-deleted lead is dropped", async () => {
    const { db, source } = fakeDb([lead("a", 1), lead("b", 2)]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    db.rows = db.rows.filter((r) => r.id !== "a");
    await s.sync();
    expect(ids(s)).toEqual(["b"]);
  });
});

describe("live leads — tags", () => {
  it("a tag tick re-reads the tag links and updates only the affected leads", async () => {
    const { db, source } = fakeDb([lead("a", 1), lead("b", 2)]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    db.links.push({ lead_id: "a", tag_id: "t2" }, { lead_id: "a", tag_id: "t1" });
    await s.sync({ tags: true });
    const a = s.getSnapshot().leads.find((l) => l.id === "a");
    expect(a?.tag_ids).toEqual(["t1", "t2"]);
    expect(db.reads.tagLinks).toBe(1);
    db.links = [];
    await s.sync({ tags: true });
    expect(s.getSnapshot().leads.find((l) => l.id === "a")?.tag_ids).toEqual([]);
  });

  it("a plain sync does not read tag links", async () => {
    const { db, source } = fakeDb([lead("a", 1)]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    await s.sync();
    expect(db.reads.tagLinks).toBe(0);
  });
});

describe("live leads — the browser copy across reloads", () => {
  async function seeded(fp = "fp", savedAt?: number) {
    const c = clock();
    const cache = memCache();
    const { db, source } = fakeDb([lead("a", 1), lead("b", 2)]);
    const first = new LeadsSync(source, cache, "leads:u1", fp, { now: c.now });
    await first.start();
    await first.saveNow();
    if (savedAt !== undefined) cache.store.get("leads:u1")!.savedAt = savedAt;
    return { c, cache, db, source };
  }

  it("a reload opens from the copy at once, then syncs only the changes", async () => {
    const { c, cache, db, source } = await seeded();
    db.rows.push(lead("c", 30));
    const reloaded = new LeadsSync(source, cache, "leads:u1", "fp", { now: c.now });
    const seen: string[] = [];
    reloaded.subscribe(() => seen.push(`${reloaded.getSnapshot().status}:${reloaded.getSnapshot().fromCache}:${ids(reloaded).join("")}`));
    await reloaded.start();
    expect(seen[0]).toBe("ready:true:ba"); // the saved copy, before any read
    expect(ids(reloaded)).toEqual(["c", "b", "a"]);
    expect(reloaded.getSnapshot().fromCache).toBe(false);
    expect(db.reads.page).toBe(1); // only the first visit ever read everything
  });

  it("a permission change throws the copy away and reads afresh", async () => {
    const { c, cache, db, source } = await seeded("fp-old");
    const s = new LeadsSync(source, cache, "leads:u1", "fp-new", { now: c.now });
    await s.start();
    expect(db.reads.page).toBe(2);
    expect(ids(s)).toEqual(["b", "a"]);
  });

  it("a copy older than a week is not trusted", async () => {
    const { c, cache, db, source } = await seeded("fp", T0 - CACHE_MAX_AGE_MS);
    const s = new LeadsSync(source, cache, "leads:u1", "fp", { now: c.now });
    await s.start();
    expect(db.reads.page).toBe(2);
  });

  it("a copy from another app version is not trusted", async () => {
    const { c, cache, db, source } = await seeded();
    cache.store.get("leads:u1")!.v = CACHE_VERSION + 1;
    const s = new LeadsSync(source, cache, "leads:u1", "fp", { now: c.now });
    await s.start();
    expect(db.reads.page).toBe(2);
  });

  it("a broken cache (private mode, full disk) just means no copy", async () => {
    const { source } = fakeDb([lead("a", 1)]);
    const broken: LeadsCache = { load: () => Promise.reject(new Error("blocked")), save: () => Promise.reject(new Error("quota")) };
    const s = new LeadsSync(source, broken, "k", "fp");
    await s.start();
    await s.saveNow();
    expect(ids(s)).toEqual(["a"]);
  });

  it("saves after a change, debounced", async () => {
    const timers: (() => void)[] = [];
    const cache = memCache();
    const { db, source } = fakeDb([lead("a", 1)]);
    const s = new LeadsSync(source, cache, "leads:u1", "fp", { setTimer: (fn) => timers.push(fn), clearTimer: () => {} });
    await s.start();
    expect(cache.store.size).toBe(0);
    timers.at(-1)!();
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.store.get("leads:u1")?.rows.map((r) => r.id)).toEqual(["a"]);
    db.rows.push(lead("b", 9));
    await s.sync();
    timers.at(-1)!();
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.store.get("leads:u1")?.rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });
});

describe("live leads — a background sync failure keeps the leads on screen", () => {
  it("keeps the data and reports the error, then clears it on the next good sync", async () => {
    const { db, source } = fakeDb([lead("a", 1)]);
    const s = new LeadsSync(source, null, "k", "fp");
    await s.start();
    const changed = source.changedSince;
    source.changedSince = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockImplementation(changed);
    await s.sync();
    expect(s.getSnapshot()).toMatchObject({ status: "ready", error: "timeout" });
    expect(ids(s)).toEqual(["a"]);
    db.rows.push(lead("b", 5));
    await s.sync();
    expect(s.getSnapshot()).toMatchObject({ status: "ready", error: null });
    expect(ids(s)).toEqual(["b", "a"]);
  });
});

describe("permissionFingerprint", () => {
  it("is the same for the same set in any order, different for a different set", () => {
    expect(permissionFingerprint(["b", "a"])).toBe(permissionFingerprint(new Set(["a", "b"])));
    expect(permissionFingerprint(["a"])).not.toBe(permissionFingerprint(["a", "leads.view_all"]));
  });
});

describe("sync scheduler — when a tick turns into a sync", () => {
  function setup(visible = true) {
    const timers: { fn: () => void; ms: number }[] = [];
    const run = vi.fn();
    let isVisible = visible;
    const sch = createSyncScheduler(run, () => isVisible, {
      debounceMs: 250,
      jitterMs: 400,
      random: () => 0.5,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => {},
    });
    const fireAll = () => {
      const due = timers.splice(0);
      for (const t of due) t.fn();
    };
    return { sch, run, timers, fireAll, setVisible: (v: boolean) => (isVisible = v) };
  }

  it("a burst of ticks is one sync, after a short spread-out wait", () => {
    const { sch, run, timers, fireAll } = setup();
    sch.onTick("leads");
    sch.onTick("leads");
    sch.onTick("leads");
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(450);
    fireAll();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ tags: false });
  });

  it("a tags tick in the burst asks for the tag links too", () => {
    const { sch, run, fireAll } = setup();
    sch.onTick("leads");
    sch.onTick("tags");
    fireAll();
    expect(run).toHaveBeenCalledWith({ tags: true });
  });

  it("a hidden tab does nothing, then syncs once when looked at", () => {
    const { sch, run, timers, fireAll, setVisible } = setup(false);
    sch.onTick("leads");
    sch.onTick("tags");
    expect(timers).toHaveLength(0);
    expect(sch.pending).toBe(true);
    setVisible(true);
    sch.onVisible();
    fireAll();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ tags: true });
    expect(sch.pending).toBe(false);
  });

  it("a tab hidden between the tick and the timer waits for the next look", () => {
    const { sch, run, fireAll, setVisible } = setup();
    sch.onTick("leads");
    setVisible(false);
    fireAll();
    expect(run).not.toHaveBeenCalled();
    setVisible(true);
    sch.onVisible();
    fireAll();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
