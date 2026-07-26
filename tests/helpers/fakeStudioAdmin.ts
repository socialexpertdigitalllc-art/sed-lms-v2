import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A minimal in-memory stand-in for the service-role Supabase client, shaped
 * exactly to what `lib/site-studio/run/engine.ts` (and the real
 * `savePackage`/`loadPackage` it calls) actually use: `.from(table).select()
 * .eq().single()`, `.from(table).update(patch).eq().select().single()`,
 * `.from(table).insert(row)`, and `.storage.from(bucket).upload/download()`.
 *
 * Deliberately NOT a generic Supabase mock — just enough surface for the
 * engine tests to run real `savePackage`/`loadPackage` round-trips against
 * in-memory storage, with no network involved.
 */
export interface FakeAdminState {
  templates: Record<string, { manifest: unknown }>;
  leads: Record<string, Record<string, unknown>>;
  runs: Record<string, Record<string, unknown>>;
  events: Record<string, unknown>[];
  storage: Record<string, Uint8Array>;
  studio_assets: Record<string, Record<string, unknown>>;
  /** One row per deployed client site (migration 0055), keyed by row id.
   *  `subdomain` is the real table's unique index — deployRun.ts's upsert
   *  path matches on it, same as `ON CONFLICT (subdomain)` would. */
  studio_deployments: Record<string, Record<string, unknown>>;
  /** Append-only, matching the real `activity_log` table's role everywhere
   *  else in this codebase: a plain insert, never read back by app code. */
  activity_log: Record<string, unknown>[];
  /** Test hook: when set and it returns a message for a given bucket/path,
   *  storage.upload() fails with that message instead of writing bytes —
   *  used to prove rehostFromUrl never leaves an orphan studio_assets row
   *  when the bucket upload fails. Unset (default) means uploads succeed. */
  uploadShouldFail?: (bucket: string, path: string) => string | null;
  /** Same shape, for `storage.download()` — used by deployRun.ts's tests to
   *  prove a storage failure is caught BEFORE any destructive DirectAdmin
   *  call (clearDocroot) runs, even though the bytes were seeded and would
   *  otherwise download fine. */
  downloadShouldFail?: (bucket: string, path: string) => string | null;
}

export function emptyFakeAdminState(): FakeAdminState {
  return {
    templates: {},
    leads: {},
    runs: {},
    events: [],
    storage: {},
    studio_assets: {},
    studio_deployments: {},
    activity_log: [],
  };
}

type Row = Record<string, unknown>;

function matchIlike(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

/** Parses PostgREST's `.or("kind.eq.stock,lead_id.eq.<uuid>")` shorthand into
 *  [column, value] pairs, ORed together. Only the `eq` operator is supported
 *  — the one form `searchLibrary`'s client fence actually needs. */
function parseOrExpr(expr: string): [string, string][] {
  return expr.split(",").map((clause) => {
    const [col, , ...rest] = clause.split(".");
    return [col, rest.join(".")] as [string, string];
  });
}

/**
 * A minimal in-memory `studio_assets` table, in the same spirit as the
 * hand-rolled `studio_runs` chain above: a real single-winner-shaped filter
 * accumulator, not a generic PostgREST clone. Supports exactly what
 * `lib/site-studio/assets/{library,rehost}.ts` need: `.select().eq/.or/.ilike
 * /.in/.order/.limit` (thenable, plus `.single()`/`.maybeSingle()`),
 * `.insert(row).select().single()` (honouring the `pexels_id` unique index by
 * surfacing a `23505` error, matching real Postgres), and
 * `.update(patch).eq(...)`.
 */
function assetsTable(state: FakeAdminState) {
  const rows = () => state.studio_assets;

  function selectBuilder() {
    const eqs: [string, unknown][] = [];
    let orClauses: [string, string][] | null = null;
    let ilikeFilter: [string, string] | null = null;
    let inFilter: [string, unknown[]] | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    function compute(): Row[] {
      let out = Object.values(rows());
      for (const [col, val] of eqs) out = out.filter((r) => r[col] === val);
      if (orClauses) {
        const clauses = orClauses;
        out = out.filter((r) => clauses.some(([col, val]) => String(r[col] ?? "") === val));
      }
      if (ilikeFilter) {
        const [col, pattern] = ilikeFilter;
        out = out.filter((r) => matchIlike(String(r[col] ?? ""), pattern));
      }
      if (inFilter) {
        const [col, vals] = inFilter;
        out = out.filter((r) => vals.includes(r[col]));
      }
      if (orderCol) {
        const col = orderCol;
        out = [...out].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return orderAsc ? cmp : -cmp;
        });
      }
      if (limitN != null) out = out.slice(0, limitN);
      return out;
    }

    const builder = {
      eq(col: string, val: unknown) {
        eqs.push([col, val]);
        return builder;
      },
      or(expr: string) {
        orClauses = parseOrExpr(expr);
        return builder;
      },
      ilike(col: string, pattern: string) {
        ilikeFilter = [col, pattern];
        return builder;
      },
      in(col: string, vals: unknown[]) {
        inFilter = [col, vals];
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      single: async () => {
        const found = compute();
        return found.length === 1 ? { data: found[0], error: null } : { data: null, error: { message: "not found" } };
      },
      maybeSingle: async () => {
        const found = compute();
        return { data: found[0] ?? null, error: null };
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve({ data: compute(), error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    select: (_cols?: string) => selectBuilder(),
    insert: (row: Row) => ({
      select: () => ({
        single: async () => {
          if (row.pexels_id != null) {
            const dupe = Object.values(rows()).find((r) => r.pexels_id === row.pexels_id);
            if (dupe) {
              return {
                data: null,
                error: { message: 'duplicate key value violates unique constraint "studio_assets_pexels"', code: "23505" },
              };
            }
          }
          const id = (row.id as string) ?? `asset_${Object.keys(rows()).length + 1}`;
          const created: Row = { use_count: 0, created_at: new Date().toISOString(), ...row, id };
          state.studio_assets[id] = created;
          return { data: created, error: null };
        },
      }),
    }),
    update: (patch: Row) => {
      const eqs: [string, unknown][] = [];
      const chain = {
        eq(col: string, val: unknown) {
          eqs.push([col, val]);
          return chain;
        },
        select: () => ({
          single: async () => {
            const target = Object.entries(rows()).find(([, r]) => eqs.every(([c, v]) => r[c] === v));
            if (!target) return { data: null, error: { message: "not found" } };
            const updated = { ...target[1], ...patch };
            state.studio_assets[target[0]] = updated;
            return { data: updated, error: null };
          },
        }),
        then(resolve: (v: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) {
          const target = Object.entries(rows()).find(([, r]) => eqs.every(([c, v]) => r[c] === v));
          if (target) state.studio_assets[target[0]] = { ...target[1], ...patch };
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

/**
 * A minimal in-memory `studio_deployments` table shaped to what
 * `lib/site-studio/deploy/deployRun.ts` needs: `.select().eq(...)`
 * (`.maybeSingle()`/`.single()`/thenable-array), `.update(patch).eq(...)`
 * (closing out a stale sibling live row), and `.upsert(row, { onConflict:
 * "subdomain" }).select().single()` — matching ON CONFLICT (subdomain) DO
 * UPDATE against the real unique index migration 0055 creates, which is
 * exactly what makes a redeploy update the existing row instead of erroring
 * on the duplicate key.
 *
 * The upsert ALSO models the partial unique index
 * `studio_deployments_one_live_per_lead (lead_id) WHERE status = 'live' AND
 * lead_id IS NOT NULL`: writing a `status: 'live'` row for a lead that
 * already has a DIFFERENT live row is rejected with a `23505`, exactly like
 * real Postgres would reject it. Without this, a bug in deployRun.ts that
 * fails to retire a lead's old live row before writing the new one would
 * pass every test silently instead of surfacing as the constraint violation
 * it really is in production.
 */
function deploymentsTable(state: FakeAdminState) {
  const rows = () => state.studio_deployments;

  function selectBuilder() {
    const eqs: [string, unknown][] = [];
    const builder = {
      eq(col: string, val: unknown) {
        eqs.push([col, val]);
        return builder;
      },
      maybeSingle: async () => {
        const found = Object.values(rows()).find((r) => eqs.every(([c, v]) => r[c] === v));
        return { data: found ?? null, error: null };
      },
      single: async () => {
        const found = Object.values(rows()).find((r) => eqs.every(([c, v]) => r[c] === v));
        return found ? { data: found, error: null } : { data: null, error: { message: "not found" } };
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) {
        const found = Object.values(rows()).filter((r) => eqs.every(([c, v]) => r[c] === v));
        return Promise.resolve({ data: found, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    select: (_cols?: string) => selectBuilder(),
    update: (patch: Row) => {
      const eqs: [string, unknown][] = [];
      const chain = {
        eq(col: string, val: unknown) {
          eqs.push([col, val]);
          return chain;
        },
        then(resolve: (v: { data: null; error: null | { message: string } }) => unknown, reject?: (e: unknown) => unknown) {
          const target = Object.entries(rows()).find(([, r]) => eqs.every(([c, v]) => r[c] === v));
          if (!target) return Promise.resolve({ data: null, error: { message: "not found" } }).then(resolve, reject);
          state.studio_deployments[target[0]] = { ...target[1], ...patch };
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
    upsert: (row: Row, opts?: { onConflict?: string }) => {
      const conflictCol = opts?.onConflict ?? "id";
      return {
        select: () => ({
          single: async () => {
            const existing = Object.entries(rows()).find(([, r]) => r[conflictCol] === row[conflictCol]);
            if (row.status === "live" && row.lead_id != null) {
              const conflictingLive = Object.entries(rows()).find(
                ([id, r]) =>
                  r.status === "live" &&
                  r.lead_id === row.lead_id &&
                  r[conflictCol] !== row[conflictCol] &&
                  (!existing || id !== existing[0]),
              );
              if (conflictingLive) {
                return {
                  data: null,
                  error: {
                    message: `duplicate key value violates unique constraint "studio_deployments_one_live_per_lead"`,
                    code: "23505",
                  },
                };
              }
            }
            const now = new Date().toISOString();
            const id = existing ? existing[0] : (row.id as string) ?? `deploy_${Object.keys(rows()).length + 1}`;
            // Deliberately does NOT force `updated_at`/`deployed_at` the way
            // an earlier version of this fake did — that masked a real bug
            // (FIX 8, review): those columns only move in real Postgres when
            // the CALLER's row payload includes them. If deployRun.ts ever
            // stops setting them explicitly, this fake must go stale right
            // along with it, not paper over the omission.
            const merged: Row = existing
              ? { ...existing[1], ...row }
              : { created_at: now, taken_down_at: null, ...row, id };
            state.studio_deployments[id] = merged;
            return { data: merged, error: null };
          },
        }),
      };
    },
  };
}

export function makeFakeAdmin(state: FakeAdminState): SupabaseClient {
  const single = (get: () => Record<string, unknown> | undefined) => ({
    single: async () => {
      const row = get();
      return row ? { data: row, error: null } : { data: null, error: { message: "not found" } };
    },
  });

  const admin = {
    from(table: string) {
      if (table === "studio_templates") {
        return { select: () => ({ eq: (_c: string, val: string) => single(() => state.templates[val]) }) };
      }
      if (table === "leads") {
        return {
          select: () => ({ eq: (_c: string, val: string) => single(() => state.leads[val]) }),
          // deployRun.ts sets `website_link` after a successful deploy — a
          // plain `.update(patch).eq("id", val)` thenable, no CAS (leads
          // aren't optimistically-locked anywhere else in this codebase).
          update: (patch: Row) => {
            const eqs: [string, unknown][] = [];
            const chain = {
              eq(col: string, val: unknown) {
                eqs.push([col, val]);
                return chain;
              },
              then(resolve: (v: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) {
                for (const [id, row] of Object.entries(state.leads)) {
                  if (eqs.every(([c, v]) => row[c] === v)) state.leads[id] = { ...row, ...patch };
                }
                return Promise.resolve({ data: null, error: null }).then(resolve, reject);
              },
            };
            return chain;
          },
        };
      }
      if (table === "studio_deployments") {
        return deploymentsTable(state);
      }
      if (table === "activity_log") {
        return {
          insert: async (row: Row) => {
            state.activity_log.push(row);
            return { data: null, error: null };
          },
        };
      }
      if (table === "studio_runs") {
        return {
          select: () => ({ eq: (_c: string, val: string) => single(() => state.runs[val]) }),
          // Supports chained .eq() calls (e.g. .eq("id", id).eq("updated_at",
          // token)) so the engine's optimistic step-claim can be exercised for
          // real: ALL accumulated filters must match the CURRENT stored row
          // for the update to take effect, mirroring a Postgres UPDATE ...
          // WHERE — a stale second filter (another writer already moved it)
          // makes the update a no-op, returning no row.
          update: (patch: Record<string, unknown>) => {
            const filters: [string, unknown][] = [];
            const chain = {
              eq(col: string, val: unknown) {
                filters.push([col, val]);
                return chain;
              },
              select: () => ({
                single: async () => {
                  const id = filters.find(([c]) => c === "id")?.[1] as string | undefined;
                  const current = id ? state.runs[id] : undefined;
                  if (!current) return { data: null, error: { message: "not found" } };
                  const matches = filters.every(([c, v]) => current[c] === v);
                  if (!matches) return { data: null, error: { message: "no rows matched (stale filter)" } };
                  const updated = { ...current, ...patch };
                  state.runs[id as string] = updated;
                  return { data: updated, error: null };
                },
              }),
            };
            return chain;
          },
        };
      }
      if (table === "studio_run_events") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.events.push(row);
            return { data: null, error: null };
          },
        };
      }
      if (table === "studio_assets") {
        return assetsTable(state);
      }
      throw new Error(`fakeStudioAdmin: unexpected table "${table}"`);
    },
    storage: {
      from(bucket: string) {
        return {
          upload: async (path: string, bytes: Uint8Array) => {
            const failMessage = state.uploadShouldFail?.(bucket, path);
            if (failMessage) return { data: null, error: { message: failMessage } };
            state.storage[`${bucket}/${path}`] = bytes;
            return { data: { path }, error: null };
          },
          download: async (path: string) => {
            const failMessage = state.downloadShouldFail?.(bucket, path);
            if (failMessage) return { data: null, error: { message: failMessage } };
            const bytes = state.storage[`${bucket}/${path}`];
            if (!bytes) return { data: null, error: { message: `not found: ${bucket}/${path}` } };
            const copy = bytes.slice();
            return { data: { arrayBuffer: async () => copy.buffer }, error: null };
          },
          remove: async (paths: string[]) => {
            for (const p of paths) delete state.storage[`${bucket}/${p}`];
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };

  return admin as unknown as SupabaseClient;
}
