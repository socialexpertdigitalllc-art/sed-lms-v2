import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, isYmd, localDateKey, localHour, localMonthKey, localWeekKey, localWeekday, zonedMidnightMs } from "../dates";
import {
  canReadDataset,
  findDataset,
  readableColumns,
  readableDatasets,
  type ColumnType,
  type Dataset,
} from "./catalog";
import { fetchAll, fetchByIds } from "./data";
import { boolArg, intArg, localStamp, periodFrom } from "./filters";
import { ToolError, type AssistantTool, type ToolContext } from "./types";

/**
 * describe_data + query_data: the assistant's reach into everything else in
 * the LMS (lib/assistant/tools/catalog.ts) — the HitList, call logs, status
 * history, contracts, receipts, domains, websites, sign-ins and the rest.
 *
 * Same rule as every tool: a person's assistant reads what that person could
 * open by hand (row-level security, or the app's own permission check plus
 * their lead visibility), and an admin's assistant reads everything. Reads
 * only, ever.
 */

export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "is_null", "not_null"] as const;
type FilterOp = (typeof FILTER_OPS)[number];
const BUCKETS = ["day", "week", "month", "weekday", "hour"] as const;
type Bucket = (typeof BUCKETS)[number];
const METRIC_FNS = ["count", "count_distinct", "sum", "avg", "min", "max"] as const;
type MetricFn = (typeof METRIC_FNS)[number];

/** Rows returned when listing (groups when grouping). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const CLIP_TEXT = 500;
const CLIP_JSON = 400;
/** fetchAll's ceiling (100 pages of 1,000). */
const SCAN_CAP = 100_000;

type Row = Record<string, unknown>;

interface Filter {
  column: string;
  op: FilterOp;
  type: ColumnType;
  /** Already coerced to the column's type (a list for "in"). */
  value: unknown;
}

interface GroupSpec {
  column: string;
  bucket: Bucket | null;
  label: string;
}

interface MetricSpec {
  fn: MetricFn;
  column: string | null;
  name: string;
}

const isAdmin = (ctx: ToolContext) => ctx.isAdmin === true;

function datasetOrError(raw: unknown, ctx: ToolContext): Dataset {
  const access = { perms: ctx.perms, isAdmin: isAdmin(ctx) };
  const readable = readableDatasets(access).map((d) => d.key);
  if (typeof raw !== "string" || !raw.trim()) throw new ToolError(`dataset is required: one of ${readable.join(", ")}.`);
  const d = findDataset(raw);
  if (!d) throw new ToolError(`There is no dataset "${raw}". This person's assistant can read: ${readable.join(", ")}.`);
  if (!canReadDataset(d, access)) {
    throw new ToolError(`This person's account does not have access to ${d.key}, so it cannot be read. Tell them plainly; do not guess its contents.`);
  }
  return d;
}

function columnOrError(d: Dataset, raw: unknown, what: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  const cols = readableColumns(d);
  if (!cols.includes(name)) throw new ToolError(`${what}: "${String(raw)}" is not a column of ${d.key}. Columns: ${cols.join(", ")}.`);
  return name;
}

function coerce(type: ColumnType, raw: unknown, column: string): unknown {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (type === "number") {
    const n = typeof raw === "number" ? raw : Number(text);
    if (!Number.isFinite(n)) throw new ToolError(`${column} is a number column; "${text}" is not a number.`);
    return n;
  }
  if (type === "bool") {
    if (raw === true || /^(true|yes|1)$/i.test(text)) return true;
    if (raw === false || /^(false|no|0)$/i.test(text)) return false;
    throw new ToolError(`${column} is true/false; "${text}" is neither.`);
  }
  if (type === "time" && !isYmd(text) && Number.isNaN(Date.parse(text))) {
    throw new ToolError(`${column} is a date/time column; give YYYY-MM-DD (company time) or a full ISO timestamp, not "${text}".`);
  }
  return text;
}

function parseFilters(d: Dataset, raw: unknown): Filter[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ToolError("filters must be a list of {column, op, value}.");
  return raw.slice(0, 20).map((f, i) => {
    const o = (f ?? {}) as Row;
    const column = columnOrError(d, o.column, `filters[${i}].column`);
    const opRaw = typeof o.op === "string" ? o.op.trim().toLowerCase() : "eq";
    const op = (FILTER_OPS as readonly string[]).includes(opRaw) ? (opRaw as FilterOp) : null;
    if (!op) throw new ToolError(`filters[${i}].op "${String(o.op)}" is not one of ${FILTER_OPS.join(", ")}.`);
    const type = d.columns[column];
    if (op === "is_null" || op === "not_null") return { column, op, type, value: null };
    if (op === "contains") return { column, op, type, value: String(o.value ?? "").trim() };
    if (op === "in") {
      const list = Array.isArray(o.value) ? o.value : String(o.value ?? "").split(",");
      const values = list.map((v) => String(v).trim()).filter(Boolean).slice(0, 200).map((v) => coerce(type, v, column));
      if (!values.length) throw new ToolError(`filters[${i}]: "in" needs a comma-separated list of values.`);
      return { column, op, type, value: values };
    }
    if (o.value === undefined || o.value === null || String(o.value).trim() === "") {
      throw new ToolError(`filters[${i}] (${column} ${op}) needs a value.`);
    }
    return { column, op, type, value: coerce(type, o.value, column) };
  });
}

/** A time filter's bound as an instant: a bare date means that day in company time. */
function timeBound(value: string, op: FilterOp, tz: string): { op: FilterOp; iso: string }[] {
  if (!isYmd(value)) return [{ op, iso: new Date(value).toISOString() }];
  const start = new Date(zonedMidnightMs(value, tz)).toISOString();
  const next = new Date(zonedMidnightMs(addDays(value, 1), tz)).toISOString();
  switch (op) {
    case "gte":
      return [{ op: "gte", iso: start }];
    case "gt":
      return [{ op: "gte", iso: next }];
    case "lt":
      return [{ op: "lt", iso: start }];
    case "lte":
      return [{ op: "lt", iso: next }];
    case "eq":
      return [
        { op: "gte", iso: start },
        { op: "lt", iso: next },
      ];
    default:
      return [{ op, iso: start }];
  }
}

/** Filters Postgres can apply (everything but text search inside json). */
const serverSide = (f: Filter) => !(f.type === "json" && (f.op === "contains" || f.op === "eq" || f.op === "in"));

// The query builder's fluent type is deep; the few calls used here are typed loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

function applyFilter(q: Query, f: Filter, tz: string): Query {
  switch (f.op) {
    case "is_null":
      return q.is(f.column, null);
    case "not_null":
      return q.not(f.column, "is", null);
    case "contains":
      return q.ilike(f.column, `%${String(f.value).replace(/[%_]/g, (m) => `\\${m}`)}%`);
    case "in":
      return q.in(f.column, f.value as unknown[]);
    default: {
      if (f.type === "time" && typeof f.value === "string") {
        for (const b of timeBound(f.value, f.op, tz)) q = q[b.op === "neq" ? "neq" : b.op](f.column, b.iso);
        return q;
      }
      return q[f.op](f.column, f.value);
    }
  }
}

/** The same filter, in memory (json columns; and a check on scanned rows). */
function matches(row: Row, f: Filter): boolean {
  const v = row[f.column];
  if (f.op === "is_null") return v === null || v === undefined;
  if (f.op === "not_null") return v !== null && v !== undefined;
  const text = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x ?? "")).toLowerCase();
  if (f.op === "contains") return text(v).includes(String(f.value).toLowerCase());
  if (f.op === "eq") return Array.isArray(v) ? v.some((x) => text(x) === String(f.value).toLowerCase()) : text(v) === String(f.value).toLowerCase();
  if (f.op === "in") return (f.value as unknown[]).some((want) => (Array.isArray(v) ? v : [v]).some((x) => text(x) === String(want).toLowerCase()));
  return true;
}

function parseGroups(d: Dataset, raw: unknown): GroupSpec[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const list = (Array.isArray(raw) ? raw : [raw]).slice(0, 2);
  return list.map((g) => {
    const [col, bucketRaw] = String(g).split(":").map((s) => s.trim());
    const column = columnOrError(d, col, "group_by");
    const type = d.columns[column];
    let bucket: Bucket | null = null;
    if (type === "time") {
      const b = (bucketRaw || "day").toLowerCase();
      if (!(BUCKETS as readonly string[]).includes(b)) throw new ToolError(`group_by "${g}": the bucket must be one of ${BUCKETS.join(", ")}.`);
      bucket = b as Bucket;
    }
    return { column, bucket, label: bucket ? `${column}:${bucket}` : column };
  });
}

function parseMetrics(d: Dataset, raw: unknown): MetricSpec[] {
  const list = raw === undefined || raw === null || raw === "" ? ["count"] : (Array.isArray(raw) ? raw : [raw]).slice(0, 8);
  return list.map((m) => {
    const [fnRaw, col] = String(m).split(":").map((s) => s.trim());
    const fn = fnRaw.toLowerCase() as MetricFn;
    if (!(METRIC_FNS as readonly string[]).includes(fn)) throw new ToolError(`metric "${m}": use count, count_distinct:col, sum:col, avg:col, min:col or max:col.`);
    if (fn === "count") return { fn, column: null, name: "count" };
    const column = columnOrError(d, col, `metric ${fn}`);
    if ((fn === "sum" || fn === "avg") && d.columns[column] !== "number") throw new ToolError(`${fn} needs a number column; ${column} is ${d.columns[column]}.`);
    return { fn, column, name: `${fn}:${column}` };
  });
}

interface LeadInfo {
  business_name: string | null;
  status: string | null;
  agent_id: string | null;
}

/** Name, status and agent of these leads — every lead for an admin, else the visible ones. */
async function leadInfo(ctx: ToolContext, ids: string[]): Promise<Map<string, LeadInfo>> {
  const out = new Map<string, LeadInfo>();
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return out;
  if (isAdmin(ctx)) {
    const rows = await fetchByIds<Row>(want, (chunk) => ctx.admin.from("leads").select("id, business_name, status, agent_id").in("id", chunk));
    for (const r of rows) out.set(String(r.id), { business_name: (r.business_name as string) ?? null, status: (r.status as string) ?? null, agent_id: (r.agent_id as string) ?? null });
    return out;
  }
  const visible = await ctx.data.leads();
  const set = new Set(want);
  for (const l of visible) if (set.has(l.id)) out.set(l.id, { business_name: l.business_name, status: l.status, agent_id: l.agent_id });
  return out;
}

function clip(v: unknown, type: ColumnType, tz: string): unknown {
  if (v === null || v === undefined) return null;
  if (type === "time" && typeof v === "string") return localStamp(v, tz) ?? v;
  if (type === "json") {
    const s = JSON.stringify(v);
    return s.length > CLIP_JSON ? `${s.slice(0, CLIP_JSON)}…` : v;
  }
  if (typeof v === "string" && v.length > CLIP_TEXT) return `${v.slice(0, CLIP_TEXT)}…`;
  return v;
}

function groupKeys(row: Row, g: GroupSpec, type: ColumnType, tz: string): string[] {
  const v = row[g.column];
  if (v === null || v === undefined || v === "") return ["(empty)"];
  if (g.bucket && typeof v === "string") {
    if (g.bucket === "day") return [localDateKey(v, tz)];
    if (g.bucket === "week") return [localWeekKey(v, tz)];
    if (g.bucket === "month") return [localMonthKey(v, tz)];
    if (g.bucket === "weekday") return [localWeekday(v, tz)];
    return [String(localHour(v, tz)).padStart(2, "0")];
  }
  if (type === "json" && Array.isArray(v)) {
    const items = v.map((x) => (typeof x === "string" ? x.trim() : JSON.stringify(x))).filter(Boolean);
    return items.length ? [...new Set(items)] : ["(empty)"];
  }
  return [typeof v === "string" ? v : JSON.stringify(v)];
}

function metricValue(rows: Row[], m: MetricSpec, d: Dataset, tz: string): number | string | null {
  if (m.fn === "count") return rows.length;
  const col = m.column!;
  const values = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "");
  if (m.fn === "count_distinct") return new Set(values.map((v) => (typeof v === "string" ? v : JSON.stringify(v)))).size;
  if (d.columns[col] === "time") {
    if (!values.length) return null;
    const ms = values.map((v) => Date.parse(String(v))).filter(Number.isFinite);
    if (!ms.length) return null;
    const pick = m.fn === "min" ? Math.min(...ms) : Math.max(...ms);
    return localStamp(new Date(pick).toISOString(), tz);
  }
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  if (m.fn === "sum") return round(nums.reduce((a, b) => a + b, 0));
  if (m.fn === "avg") return round(nums.reduce((a, b) => a + b, 0) / nums.length);
  return m.fn === "min" ? Math.min(...nums) : Math.max(...nums);
}

const round = (n: number) => Math.round(n * 100) / 100;

/* -------------------------------------------------------------- describe */

export const describeDataTool: AssistantTool = {
  name: "describe_data",
  label: "Checking what data there is",
  description:
    "List every LMS dataset this person's assistant can read (the HitList, follow-up calls, status history, tickets, contracts, receipts, domains, websites, sign-ins, app usage, notifications, website inquiries and more), or — with `dataset` — that dataset's columns and their types. Call it whenever you are not sure which dataset or column holds what you need, before saying something is unavailable.",
  parameters: {
    type: "object",
    properties: { dataset: { type: "string", description: "A dataset name, for its columns. Omit to list the datasets." } },
  },
  available: () => true,
  async run(args, ctx) {
    const access = { perms: ctx.perms, isAdmin: isAdmin(ctx) };
    if (typeof args.dataset === "string" && args.dataset.trim()) {
      const d = datasetOrError(args.dataset, ctx);
      const columns = Object.fromEntries(readableColumns(d).map((c) => [c, d.columns[c]]));
      return {
        data: {
          dataset: d.key,
          about: d.about,
          columns,
          ...(d.userColumns?.length ? { people_columns: d.userColumns, note: "Columns holding a person come back with their name too (<column>_name). Filter on them by id — find ids in the people dataset." } : {}),
          ...(d.leadColumn && d.key !== "leads" ? { lead_column: d.leadColumn, tip: "include_lead: true adds each row's business name, status and agent." } : {}),
          ...(d.softDelete ? { soft_delete: `Deleted rows (${d.softDelete} set) are left out unless include_deleted is true.` } : {}),
        },
        summary: `${d.key}: ${Object.keys(columns).length} columns`,
      };
    }
    const list = readableDatasets(access);
    return {
      data: {
        access: access.isAdmin ? "Admin: everything in the LMS is readable." : "Exactly what this person can open in the app.",
        datasets: list.map((d) => ({ dataset: d.key, about: d.about })),
      },
      summary: `${list.length} datasets readable`,
    };
  },
};

/* ----------------------------------------------------------------- query */

export const queryDataTool: AssistantTool = {
  name: "query_data",
  label: "Reading the data",
  description:
    "Read any LMS dataset this person can see (see describe_data): list rows, or group and aggregate them. Examples — HitList leads with their stars: dataset hitlist, include_lead true, order_by priority. HitList by stars: dataset hitlist, group_by [\"priority\"]. Calls per agent per week: dataset follow_ups, group_by [\"user_id\", \"created_at:week\"]. Revenue from receipts this month: dataset receipts, from/to, metrics [\"sum:total\"]. Filters: [{column, op, value}] with op eq, neq, gt, gte, lt, lte, in (comma-separated), contains (text search), is_null, not_null; dates as YYYY-MM-DD in company time. Every row and total comes from the database — report them as given, and say so when a result was capped.",
  parameters: {
    type: "object",
    properties: {
      dataset: { type: "string", description: "Which dataset (describe_data lists them)." },
      columns: { type: "array", items: { type: "string" }, description: "Columns to return when listing rows (default: all)." },
      filters: {
        type: "array",
        description: "Conditions every row must meet.",
        items: {
          type: "object",
          properties: {
            column: { type: "string" },
            op: { type: "string", enum: [...FILTER_OPS] },
            value: { type: "string", description: "The value as text; for in, a comma-separated list. Dates YYYY-MM-DD (company time) or ISO." },
          },
          required: ["column", "op"],
        },
      },
      date_column: { type: "string", description: "The date column from/to apply to (default created_at, or the dataset's main date)." },
      from: { type: "string", description: "Start date, YYYY-MM-DD inclusive, company time." },
      to: { type: "string", description: "End date, YYYY-MM-DD inclusive. Defaults to today when from is given." },
      group_by: {
        type: "array",
        items: { type: "string" },
        description: "Up to 2 columns to group by. Date columns take a bucket: created_at:day | :week | :month | :weekday | :hour (company time). A list column (e.g. services) counts each item.",
      },
      metrics: {
        type: "array",
        items: { type: "string" },
        description: "With group_by (or alone, for totals): count (default), count_distinct:col, sum:col, avg:col, min:col, max:col.",
      },
      order_by: { type: "string", description: "A column (listing) or a metric name / group column (grouping)." },
      desc: { type: "boolean", description: "Descending order (default true for metrics and dates)." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `Rows or groups to return (default ${DEFAULT_LIMIT}).` },
      offset: { type: "integer", minimum: 0, description: "Skip this many rows (paging)." },
      include_lead: { type: "boolean", description: "Add each row's lead: business name, status, agent and link." },
      include_deleted: { type: "boolean", description: "Include deleted rows (leads, pre-leads)." },
    },
    required: ["dataset"],
  },
  available: () => true,
  async run(args, ctx) {
    const d = datasetOrError(args.dataset, ctx);
    const admin = isAdmin(ctx);
    const tz = ctx.timezone;
    const cols = readableColumns(d);
    const filters = parseFilters(d, args.filters);

    // A period on one date column, in company time.
    const period = periodFrom({ from: typeof args.from === "string" ? args.from : undefined, to: typeof args.to === "string" ? args.to : undefined }, ctx, "all");
    let periodColumn: string | null = null;
    if (period) {
      periodColumn =
        typeof args.date_column === "string" && args.date_column.trim()
          ? columnOrError(d, args.date_column, "date_column")
          : cols.includes("created_at")
            ? "created_at"
            : (cols.find((c) => d.columns[c] === "time") ?? null);
      if (!periodColumn || d.columns[periodColumn] !== "time") throw new ToolError(`${d.key} has no date column for from/to; pick one with date_column.`);
    }

    const groups = parseGroups(d, args.group_by);
    const wantsMetrics = args.metrics !== undefined && args.metrics !== null && !(Array.isArray(args.metrics) && !args.metrics.length);
    const metrics = groups.length || wantsMetrics ? parseMetrics(d, args.metrics) : [];
    const aggregate = metrics.length > 0;
    const limit = intArg(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = intArg(args.offset, 0, 0, 1_000_000);
    const includeLead = boolArg(args.include_lead, false) && !!d.leadColumn;
    const includeDeleted = boolArg(args.include_deleted, false);

    // Which columns to read.
    const shown = Array.isArray(args.columns) && args.columns.length && !aggregate ? args.columns.map((c) => columnOrError(d, c, "columns")) : cols;
    const needed = new Set<string>(aggregate ? [] : shown);
    for (const g of groups) needed.add(g.column);
    for (const m of metrics) if (m.column) needed.add(m.column);
    for (const f of filters) if (!serverSide(f)) needed.add(f.column);
    if (d.leadColumn) needed.add(d.leadColumn);
    for (const c of d.order) needed.add(c);
    if (!needed.size) needed.add(d.order[0]);

    // Who reads it: an admin, or a table the app serves through the service
    // role (after the permission check above), goes through the service role.
    const client: SupabaseClient = admin || d.via === "service" ? ctx.admin : ctx.db;
    // Rows tied to a lead are cut to the leads this person can see.
    const scopeToLeads = !admin && !!d.leadColumn && d.key !== "leads" && d.leadScoped !== false;
    const memoryFilters = filters.filter((f) => !serverSide(f));
    const scan = aggregate || scopeToLeads || memoryFilters.length > 0;

    const orderBy = typeof args.order_by === "string" && args.order_by.trim() ? args.order_by.trim() : null;
    const build = (selectCols: string, opts?: { count?: "exact"; head?: boolean }) => {
      let q: Query = client.from(d.table).select(selectCols, opts);
      for (const f of filters) if (serverSide(f)) q = applyFilter(q, f, tz);
      if (period && periodColumn) {
        q = q.gte(periodColumn, new Date(period.fromMs).toISOString()).lt(periodColumn, new Date(period.toExMs).toISOString());
      }
      if (d.softDelete && !includeDeleted) q = q.is(d.softDelete, null);
      return q;
    };

    const applied: Row = {};
    if (filters.length) applied.filters = filters.map((f) => ({ column: f.column, op: f.op, ...(f.value !== null ? { value: f.value } : {}) }));
    if (period) applied.period = { from: period.from, to: period.to, column: periodColumn, timezone: tz };
    if (d.softDelete && !includeDeleted) applied.deleted = "excluded";
    const notes: string[] = [];
    const names = await ctx.data.names();

    let rows: Row[];
    let total: number;
    if (scan) {
      rows = await fetchAll<Row>((from, to) => {
        let q = build([...needed].join(", "));
        for (const c of d.order) q = q.order(c, { ascending: true });
        return q.range(from, to);
      });
      if (rows.length >= SCAN_CAP) notes.push(`Only the first ${SCAN_CAP.toLocaleString("en-US")} matching rows were read — narrow it with filters or a period for an exact answer.`);
      for (const f of memoryFilters) rows = rows.filter((r) => matches(r, f));
      if (scopeToLeads) {
        const visible = new Set((await ctx.data.leads()).map((l) => l.id));
        const before = rows.length;
        rows = rows.filter((r) => {
          const id = r[d.leadColumn!];
          return id === null || id === undefined || visible.has(String(id));
        });
        if (rows.length < before) notes.push(`${before - rows.length} row(s) on leads this person cannot see were left out.`);
      }
      total = rows.length;
    } else {
      // Straight from Postgres, paged there: no scoping or grouping needed.
      let q = build([...needed].join(", "), { count: "exact" });
      if (orderBy) {
        const col = columnOrError(d, orderBy, "order_by");
        q = q.order(col, { ascending: args.desc === false || (args.desc === undefined && d.columns[col] !== "time" && d.columns[col] !== "number"), nullsFirst: false });
      }
      for (const c of d.order) q = q.order(c, { ascending: !orderBy ? false : true });
      const { data, error, count } = await q.range(offset, offset + limit - 1);
      if (error) throw new ToolError(`The database refused the read: ${error.message}`);
      rows = (data ?? []) as Row[];
      total = typeof count === "number" ? count : rows.length;
    }

    const leadIds = d.leadColumn ? rows.map((r) => r[d.leadColumn!]).filter((x): x is string => typeof x === "string") : [];
    const needLeads = includeLead || groups.some((g) => g.column === d.leadColumn);
    const leads = needLeads ? await leadInfo(ctx, leadIds) : new Map<string, LeadInfo>();
    const isPerson = (c: string) => d.userColumns?.includes(c) ?? false;

    /* ---- grouping / totals */
    if (aggregate) {
      const label = (g: GroupSpec, key: string) => {
        if (key === "(empty)") return key;
        if (isPerson(g.column)) return names(key);
        if (g.column === d.leadColumn) return leads.get(key)?.business_name ?? key;
        return key;
      };
      const totals = Object.fromEntries(metrics.map((m) => [m.name, metricValue(rows, m, d, tz)]));
      if (!groups.length) {
        return {
          data: { dataset: d.key, ...applied, rows_matched: total, totals, ...(notes.length ? { notes } : {}) },
          summary: `${d.key}: ${total.toLocaleString("en-US")} rows`,
        };
      }
      const buckets = new Map<string, { keys: string[]; rows: Row[] }>();
      for (const r of rows) {
        const k1 = groupKeys(r, groups[0], d.columns[groups[0].column], tz);
        const k2 = groups[1] ? groupKeys(r, groups[1], d.columns[groups[1].column], tz) : [null];
        for (const a of k1) {
          for (const b of k2) {
            const id = b === null ? a : `${a}\u0000${b}`;
            const entry = buckets.get(id) ?? { keys: b === null ? [a] : [a, b], rows: [] };
            entry.rows.push(r);
            buckets.set(id, entry);
          }
        }
      }
      let out = [...buckets.values()].map(({ keys, rows: rs }) => {
        const row: Row = {};
        groups.forEach((g, i) => {
          row[g.label] = label(g, keys[i]);
          if (g.column === d.leadColumn && keys[i] !== "(empty)") row.link = `/leads/${keys[i]}`;
        });
        for (const m of metrics) row[m.name] = metricValue(rs, m, d, tz);
        return row;
      });
      const sortKey = orderBy && (metrics.some((m) => m.name === orderBy) || groups.some((g) => g.label === orderBy || g.column === orderBy))
        ? (groups.find((g) => g.column === orderBy)?.label ?? orderBy)
        : groups.some((g) => g.bucket) && !orderBy
          ? groups.find((g) => g.bucket)!.label
          : metrics[0].name;
      const sortGroup = groups.find((g) => g.label === sortKey);
      // Metrics and number groups (stars, ratings) read best biggest first; dates and names in order.
      const descending = args.desc === undefined ? !sortGroup || (!sortGroup.bucket && d.columns[sortGroup.column] === "number") : args.desc === true;
      out = out.sort((a, b) => {
        const x = a[sortKey];
        const y = b[sortKey];
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "en", { numeric: true });
        return descending ? -c : c;
      });
      const shownGroups = out.slice(0, limit);
      return {
        data: {
          dataset: d.key,
          ...applied,
          rows_matched: total,
          group_by: groups.map((g) => g.label),
          total_groups: out.length,
          ...(out.length > shownGroups.length ? { truncated: `Showing ${shownGroups.length} of ${out.length} groups.` } : {}),
          totals,
          groups: shownGroups,
          ...(groups.some((g) => d.columns[g.column] === "json") ? { note: "A row with several items in a list column counts once in each, so group counts can add up to more than rows_matched." } : {}),
          ...(notes.length ? { notes } : {}),
        },
        summary: `${d.key}: ${out.length} group${out.length === 1 ? "" : "s"} over ${total.toLocaleString("en-US")} rows`,
      };
    }

    /* ---- listing */
    let listed = rows;
    if (scan) {
      if (orderBy) {
        const col = columnOrError(d, orderBy, "order_by");
        const t = d.columns[col];
        const descending = args.desc === undefined ? t === "time" || t === "number" : args.desc === true;
        listed = [...rows].sort((a, b) => {
          const x = a[col];
          const y = b[col];
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          const c = t === "number" ? Number(x) - Number(y) : t === "time" ? Date.parse(String(x)) - Date.parse(String(y)) : String(x).localeCompare(String(y));
          return descending ? -c : c;
        });
      } else {
        listed = [...rows].reverse(); // newest first
      }
      listed = listed.slice(offset, offset + limit);
    }
    const out = listed.map((r) => {
      const row: Row = {};
      for (const c of shown) {
        row[c] = clip(r[c], d.columns[c], tz);
        if (isPerson(c) && typeof r[c] === "string") row[`${c}_name`] = names(r[c] as string);
      }
      if (d.key === "leads" && typeof r.id === "string") row.link = `/leads/${r.id}`;
      if (includeLead) {
        const id = r[d.leadColumn!];
        const l = typeof id === "string" ? leads.get(id) : undefined;
        row.lead = l ? { business_name: l.business_name, status: l.status, agent: names(l.agent_id), link: `/leads/${id}` } : null;
      }
      return row;
    });
    return {
      data: {
        dataset: d.key,
        ...applied,
        total_rows: total,
        showing: out.length,
        ...(offset ? { offset } : {}),
        ...(offset + out.length < total ? { more: total - offset - out.length } : {}),
        rows: out,
        ...(notes.length ? { notes } : {}),
      },
      summary: `${d.key}: ${total.toLocaleString("en-US")} row${total === 1 ? "" : "s"}${total > out.length ? ` · showing ${out.length}` : ""}`,
    };
  },
};

export const DATA_TOOLS: AssistantTool[] = [describeDataTool, queryDataTool];
