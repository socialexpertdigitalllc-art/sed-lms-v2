import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * An in-memory stand-in for a Supabase client — just enough PostgREST for the
 * assistant's action code: select (with count/head), insert, update, delete,
 * upsert; eq (a jsonb key too: "col->>key", as text) / neq / in / is / lt / lte / gt / gte / ilike / or(eq|ilike) /
 * not(in); order, limit, range, single / maybeSingle. Rows live in plain
 * arrays the test can read back. Not a general PostgREST clone.
 *
 * `unique` declares unique indexes (a partial one returns null for the rows
 * it doesn't cover): a write that would break one changes nothing and
 * answers Postgres's 23505, as the real table would.
 */

type Row = Record<string, unknown>;

/** A column, or one key of a jsonb column read as text ("new_value->>requestId"). */
function column(r: Row, c: string): unknown {
  const at = c.indexOf("->>");
  if (at === -1) return r[c];
  const json = r[c.slice(0, at)];
  const v = json && typeof json === "object" ? (json as Row)[c.slice(at + 3)] : undefined;
  return v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v);
}

type Filter = (r: Row) => boolean;

const ts = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const cmp = (a: unknown, b: unknown) => {
  const ta = ts(a);
  const tb = ts(b);
  if (Number.isFinite(ta) && Number.isFinite(tb) && typeof a !== "number") return ta - tb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
};

function ilike(value: unknown, pattern: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
  return re.test(String(value ?? ""));
}

function orFilter(expr: string): Filter {
  const clauses = expr.split(",").map((c) => {
    const [col, op, ...rest] = c.split(".");
    const val = rest.join(".");
    return (r: Row) => (op === "eq" ? String(r[col]) === val : op === "ilike" ? ilike(r[col], val) : false);
  });
  return (r) => clauses.some((f) => f(r));
}

/** A unique index: the key a row is unique by, or null when the index doesn't cover it. */
export type UniqueIndex = { name: string; key: (row: Row) => string | null };

export interface MemoryDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  /** Every write, in order: [table, op, payload]. */
  writes: [string, string, unknown][];
}

export function memorySupabase(
  initial: Record<string, Row[]> = {},
  defaults: Record<string, () => Row> = {},
  unique: Record<string, UniqueIndex[]> = {},
): MemoryDb {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const writes: [string, string, unknown][] = [];

  /** The first unique index the table's rows, as they would be, break. */
  function violated(table: string, rows: Row[]): string | null {
    for (const index of unique[table] ?? []) {
      const seen = new Set<string>();
      for (const r of rows) {
        const k = index.key(r);
        if (k === null) continue;
        if (seen.has(k)) return index.name;
        seen.add(k);
      }
    }
    return null;
  }
  const duplicate = (name: string) => ({ data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${name}"` } });

  function from(table: string) {
    const rows = () => (tables[table] ??= []);
    const filters: Filter[] = [];
    let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let returning = false;
    let head = false;
    let wantCount = false;
    let single: "one" | "maybe" | null = null;
    let order: [string, boolean][] = [];
    let limit: number | null = null;
    let range: [number, number] | null = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};

    const b: Record<string, unknown> = {};
    const chain = (fn: () => void) => (...args: unknown[]) => (void (fn as (...a: unknown[]) => void)(...args), b);
    Object.assign(b, {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (op === "select") {
          head = Boolean(opts?.head);
          wantCount = Boolean(opts?.count);
        } else returning = true;
        return b;
      },
      insert: (r: Row | Row[]) => ((op = "insert"), (payload = Array.isArray(r) ? r : [r]), b),
      upsert: (r: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => ((op = "upsert"), (payload = Array.isArray(r) ? r : [r]), (upsertOpts = o ?? {}), b),
      update: (p: Row) => ((op = "update"), (patch = p), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: unknown) => (filters.push((r) => column(r, c) === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      lt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) < 0), b),
      lte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) <= 0), b),
      gt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) > 0), b),
      gte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) >= 0), b),
      ilike: (c: string, p: string) => (filters.push((r) => ilike(r[c], p)), b),
      or: (expr: string) => (filters.push(orFilter(expr)), b),
      not: (c: string, operator: string, v: string) => {
        if (operator === "in") {
          const list = v.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim());
          filters.push((r) => !list.includes(String(r[c])));
        } else filters.push((r) => r[c] !== v);
        return b;
      },
      order: (c: string, o?: { ascending?: boolean }) => ((order = [...order, [c, o?.ascending !== false]]), b),
      limit: (n: number) => ((limit = n), b),
      range: (a: number, z: number) => ((range = [a, z]), b),
      single: chain(() => (single = "one")),
      maybeSingle: chain(() => (single = "maybe")),
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    });

    function matched(): Row[] {
      return rows().filter((r) => filters.every((f) => f(r)));
    }

    function shape(list: Row[], count?: number) {
      let out = [...list];
      for (const [c, asc] of [...order].reverse()) out.sort((x, y) => (asc ? 1 : -1) * cmp(x[c], y[c]));
      if (range) out = out.slice(range[0], range[1] + 1);
      if (limit !== null) out = out.slice(0, limit);
      out = out.map((r) => ({ ...r }));
      if (single === "one") return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: out.length ? "multiple rows" : "no rows" } };
      if (single === "maybe") return out.length > 1 ? { data: null, error: { message: "multiple rows" } } : { data: out[0] ?? null, error: null };
      return { data: head ? null : out, error: null, ...(count !== undefined ? { count } : {}) };
    }

    function run() {
      if (op === "select") {
        const list = matched();
        return shape(list, wantCount ? list.length : undefined);
      }
      if (op === "insert" || op === "upsert") {
        const added: Row[] = [];
        const merged: [Row, Row][] = [];
        for (const r of payload) {
          const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(defaults[table]?.() ?? {}), ...r };
          if (op === "upsert" && upsertOpts.onConflict) {
            const keys = upsertOpts.onConflict.split(",").map((k) => k.trim());
            const existing = [...rows(), ...added].find((x) => keys.every((k) => x[k] === row[k]));
            if (existing) {
              if (!upsertOpts.ignoreDuplicates) merged.push([existing, r]);
              continue;
            }
          }
          added.push(row);
        }
        const after = rows().map((x) => {
          const m = merged.find(([e]) => e === x);
          return m ? { ...x, ...m[1] } : x;
        });
        const broken = violated(table, [...after, ...added]);
        if (broken) return duplicate(broken);
        for (const [existing, r] of merged) Object.assign(existing, r);
        rows().push(...added);
        writes.push([table, op, payload]);
        return returning || single ? shape(added) : { data: null, error: null };
      }
      if (op === "update") {
        const list = matched();
        const broken = violated(table, rows().map((r) => (list.includes(r) ? { ...r, ...patch } : r)));
        if (broken) return duplicate(broken);
        for (const r of list) Object.assign(r, patch);
        writes.push([table, "update", patch]);
        return returning || single ? shape(list) : { data: null, error: null };
      }
      const list = matched();
      tables[table] = rows().filter((r) => !list.includes(r));
      writes.push([table, "delete", list.map((r) => r.id)]);
      return returning || single ? shape(list) : { data: null, error: null };
    }
    return b;
  }

  return { client: { from } as unknown as SupabaseClient, tables, writes };
}
