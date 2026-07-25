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
}

export function emptyFakeAdminState(): FakeAdminState {
  return { templates: {}, leads: {}, runs: {}, events: [], storage: {} };
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
        return { select: () => ({ eq: (_c: string, val: string) => single(() => state.leads[val]) }) };
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
      throw new Error(`fakeStudioAdmin: unexpected table "${table}"`);
    },
    storage: {
      from(bucket: string) {
        return {
          upload: async (path: string, bytes: Uint8Array) => {
            state.storage[`${bucket}/${path}`] = bytes;
            return { data: { path }, error: null };
          },
          download: async (path: string) => {
            const bytes = state.storage[`${bucket}/${path}`];
            if (!bytes) return { data: null, error: { message: `not found: ${bucket}/${path}` } };
            const copy = bytes.slice();
            return { data: { arrayBuffer: async () => copy.buffer }, error: null };
          },
        };
      },
    },
  };

  return admin as unknown as SupabaseClient;
}
