// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SED AI's Team & admin actions: the lead import, user accounts,
 * permissions, app settings and notification rules. The admin endpoints are
 * mocked (a few of them also write the fake rows, the way the real ones do)
 * so each action is checked against what its endpoint needs and refuses.
 */

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Rows = Record<string, Record<string, unknown>[]>;

const shared = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));
const routes = vi.hoisted(() => ({
  importRun: vi.fn<Handler>(async () => Response.json({ imported: 2, skipped: 3, failed: 0 })),
  usersPost: vi.fn<Handler>(async () => Response.json({ id: "99999999-9999-4999-8999-999999999999" }, { status: 201 })),
  userPatch: vi.fn<Handler>(async () => Response.json({ ok: true })),
  userDelete: vi.fn<Handler>(async () => Response.json({ ok: true })),
  deptPermissions: vi.fn<Handler>(async () => Response.json({ ok: true })),
  // Like the real endpoint: an upsert that keeps columns it is not given (expires_at).
  overrides: vi.fn<Handler>(async (req, ctx) => {
    const { id } = await ctx.params;
    const body = (await req.clone().json()) as { permissionKey: string; isGranted: boolean; remove?: boolean };
    const rows = (shared.tables.user_permission_overrides ??= []);
    const i = rows.findIndex((r) => r.user_id === id && r.permission_key === body.permissionKey);
    if (body.remove) {
      if (i >= 0) rows.splice(i, 1);
    } else if (i >= 0) Object.assign(rows[i], { is_granted: body.isGranted });
    else rows.push({ user_id: id, permission_key: body.permissionKey, is_granted: body.isGranted, expires_at: null });
    return Response.json({ ok: true });
  }),
  settingsPut: vi.fn<Handler>(async (req) => {
    Object.assign(shared.tables.app_settings[0], (await req.clone().json()) as Record<string, unknown>, { updated_at: "2026-10-14T05:00:01Z" });
    return Response.json({ ok: true });
  }),
  rulePut: vi.fn<Handler>(async () => Response.json({ rule: {} })),
}));
const sheets = vi.hoisted(() => ({ readSheet: vi.fn<(id: string, tab: string) => Promise<string[][]>>() }));

vi.mock("@/app/api/admin/import/run/route", () => ({ POST: routes.importRun }));
vi.mock("@/app/api/admin/users/route", () => ({ POST: routes.usersPost }));
vi.mock("@/app/api/admin/users/[id]/route", () => ({ PATCH: routes.userPatch, DELETE: routes.userDelete }));
vi.mock("@/app/api/admin/users/[id]/overrides/route", () => ({ POST: routes.overrides }));
vi.mock("@/app/api/admin/departments/[id]/permissions/route", () => ({ POST: routes.deptPermissions }));
vi.mock("@/app/api/admin/settings/route", () => ({ PUT: routes.settingsPut }));
vi.mock("@/app/api/admin/notification-rules/[eventKey]/route", () => ({ PUT: routes.rulePut }));
vi.mock("@/lib/import/sheets", () => ({ readSheet: sheets.readSheet }));

import { ADMIN_ACTIONS, clockTime, endOfDay, findPermission, ianaZone, mappingError, sheetIdFrom } from "@/lib/assistant/actions/defs/admin";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import { RouteError } from "@/lib/assistant/actions/invoke";
import type { ActionContext, ActionDef, Preview, StoredAction, Values } from "@/lib/assistant/actions/types";

/* ------------------------------------------------------------ a fake db */

type Row = Record<string, unknown>;
interface Write {
  table: string;
  op: string;
  values: unknown;
  where: string[];
}

const asTime = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
function compare(a: unknown, b: unknown): number {
  const [ta, tb] = [asTime(a), asTime(b)];
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
const like = (value: unknown, pattern: string) =>
  new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i").test(String(value ?? ""));

/** A chainable stand-in for supabase-js over fixture rows; writes change the rows and are logged. */
function fakeSupabase(tables: Rows) {
  const writes: Write[] = [];
  let seq = 0;
  const client = {
    from(table: string) {
      const where: { desc: string; test: (r: Row) => boolean }[] = [];
      let op = "select";
      let payload: unknown = null;
      let mode: "many" | "maybe" | "single" = "many";
      let head = false;
      let counted = false;
      let limit: number | null = null;
      const b: Record<string, unknown> = {};
      const filter = (desc: string, test: (r: Row) => boolean) => {
        where.push({ desc, test });
        return b;
      };
      Object.assign(b, {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          counted = Boolean(opts?.count);
          head = Boolean(opts?.head);
          return b;
        },
        insert: (v: unknown) => ((op = "insert"), (payload = v), b),
        update: (v: unknown) => ((op = "update"), (payload = v), b),
        delete: () => ((op = "delete"), b),
        eq: (c: string, v: unknown) => filter(`${c}=${String(v)}`, (r) => r[c] === v),
        neq: (c: string, v: unknown) => filter(`${c}!=${String(v)}`, (r) => r[c] !== v),
        is: (c: string, v: unknown) => filter(`${c} is ${String(v)}`, (r) => (r[c] ?? null) === v),
        in: (c: string, vs: unknown[]) => filter(`${c} in ${vs.join(",")}`, (r) => vs.includes(r[c])),
        lte: (c: string, v: unknown) => filter(`${c}<=${String(v)}`, (r) => compare(r[c], v) <= 0),
        lt: (c: string, v: unknown) => filter(`${c}<${String(v)}`, (r) => compare(r[c], v) < 0),
        gte: (c: string, v: unknown) => filter(`${c}>=${String(v)}`, (r) => compare(r[c], v) >= 0),
        ilike: (c: string, p: string) => filter(`${c}~${p}`, (r) => like(r[c], p)),
        or: (expr: string) =>
          filter(`or(${expr})`, (r) =>
            expr.split(",").some((part) => {
              const [c, kind, ...rest] = part.split(".");
              const v = rest.join(".");
              return kind === "ilike" ? like(r[c], v) : String(r[c]) === v;
            }),
          ),
        order: () => b,
        limit: (n: number) => ((limit = n), b),
        maybeSingle: () => ((mode = "maybe"), b),
        single: () => ((mode = "single"), b),
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          const rows = (tables[table] ??= []);
          const match = () => rows.filter((r) => where.every((w) => w.test(r)));
          let out: Row[];
          if (op === "insert") {
            out = ((Array.isArray(payload) ? payload : [payload]) as Row[]).map((v) => ({ id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, ...v }));
            rows.push(...out);
          } else if (op === "update") {
            out = match();
            for (const r of out) Object.assign(r, payload as Row);
          } else if (op === "delete") {
            out = match();
            tables[table] = rows.filter((r) => !out.includes(r));
          } else {
            out = match();
            if (limit !== null) out = out.slice(0, limit);
          }
          if (op !== "select") writes.push({ table, op, values: payload, where: where.map((w) => w.desc) });
          const data = head ? null : mode === "many" ? out.map((r) => ({ ...r })) : out[0] ? { ...out[0] } : null;
          const error = mode === "single" && !out[0] ? { message: "no rows" } : null;
          return Promise.resolve({ data, error, ...(counted ? { count: out.length } : {}) }).then(resolve, reject);
        },
      });
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, writes };
}

/* --------------------------------------------------------------- fixtures */

const ME = "11111111-1111-4111-8111-111111111111";
const SARA = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";
const NEW_USER = "99999999-9999-4999-8999-999999999999";
const SALES = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const TECH = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const ADMIN_DEPT = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
const MAILBOX = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const MAILBOX_UNVERIFIED = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const ACTION = "88888888-8888-4888-8888-888888888888";
const SAVED_SHEET = "1KBWPYJHyXiradB9csWMYEnlFPXVHGDTyc1pmv3uB8sk";
const SAVED_MAPPING = { A: "business_name", B: "business_phone", C: "agent", D: "status" };
/** 10:00 in Karachi (UTC+5). */
const NOW = new Date("2026-10-14T05:00:00Z");

const ALL_ADMIN = [
  "admin.import",
  "admin.users.create",
  "admin.users.edit",
  "admin.users.deactivate",
  "admin.users.delete",
  "admin.permissions.manage",
  "admin.settings.manage",
  "admin.notifications.manage",
];

let db: ReturnType<typeof fakeSupabase>;
const t = () => shared.tables;

function fixtures(): Rows {
  return {
    profiles: [
      { id: ME, display_name: "Sam Khan", email: "sam@sed.test", username: "sam", is_active: true },
      { id: SARA, display_name: "Sara Ali", email: "sara@sed.test", username: "sara", is_active: true },
      { id: BOB, display_name: "Bob Stone", email: "bob@sed.test", username: "bob", is_active: false },
    ],
    departments: [
      { id: SALES, name: "Sales", slug: "sales" },
      { id: TECH, name: "Tech", slug: "tech" },
      { id: ADMIN_DEPT, name: "Admin", slug: "admin" },
    ],
    department_members: [
      { user_id: ME, department_id: ADMIN_DEPT },
      { user_id: SARA, department_id: SALES },
      { user_id: BOB, department_id: SALES },
    ],
    department_permissions: [
      { department_id: SALES, permission_key: "leads.create" },
      { department_id: ADMIN_DEPT, permission_key: "admin.permissions.manage" },
    ],
    // An old trial grant that has run out — still a row.
    user_permission_overrides: [{ user_id: SARA, permission_key: "leads.delete", is_granted: true, expires_at: "2026-10-01T00:00:00Z" }],
    leads: [{ id: "cccccccc-cccc-4ccc-8ccc-000000000001", business_name: "Jumbo's Pizza", business_phone: "(252) 401-2775", agent_id: SARA, deleted_at: null }],
    import_config: [{ singleton: true, sheet_id: SAVED_SHEET, sheet_tab: "New (April 2026)", mapping: SAVED_MAPPING }],
    app_settings: [
      {
        singleton: true,
        company_name: "SED LMS",
        work_start_time: "09:00:00",
        work_timezone: "Asia/Karachi",
        idle_timeout_minutes: 15,
        ticket_sla: { Low: 168, Normal: 72, High: 24 },
        ticket_retention_days: 0,
        form_default_mailbox_id: null,
        updated_at: "2026-10-01T00:00:00Z",
      },
    ],
    company_mailboxes: [
      { id: MAILBOX, email_address: "hello@sed.test", display_name: "Hello", user_id: ME, status: "verified" },
      { id: MAILBOX_UNVERIFIED, email_address: "new@sed.test", display_name: "New", user_id: ME, status: "pending" },
    ],
    lead_tickets: [
      { id: "dddddddd-dddd-4ddd-8ddd-000000000001", status: "Resolved", resolved_at: "2026-08-01T00:00:00Z" },
      { id: "dddddddd-dddd-4ddd-8ddd-000000000002", status: "Resolved", resolved_at: "2026-10-10T00:00:00Z" },
      { id: "dddddddd-dddd-4ddd-8ddd-000000000003", status: "Open", resolved_at: null },
    ],
    notification_rules: [
      { event_key: "ticket_opened", enabled: true, target_departments: ["Admin"], target_users: [], target_roles: [], delay_minutes: 0, updated_at: "2026-10-01T00:00:00Z" },
    ],
  };
}

function ctxFor(perms: string[] = ALL_ADMIN, over: Partial<ActionContext> = {}): ActionContext {
  return {
    userId: ME,
    displayName: "Sam Khan",
    perms: new Set(perms),
    db: db.client,
    admin: db.client,
    timezone: "Asia/Karachi",
    now: NOW,
    isAdmin: true,
    ...over,
  };
}

const def = (key: string): ActionDef => {
  const d = ADMIN_ACTIONS.find((a) => a.key === key);
  if (!d) throw new Error(`no action ${key}`);
  return d;
};
const riskOf = (key: string, v: Values) => {
  const r = def(key).risk;
  return typeof r === "function" ? r(v) : r;
};

/** What prepare_action does before drawing a card: normalise, count what is missing, run the check. */
async function prepare(key: string, raw: Values, ctx = ctxFor()) {
  const d = def(key);
  const n = await normalizeFields(d, raw, ctx);
  const missing = missingFields(d, n.values, n.problems).map((f) => f.name);
  const checked = (await d.check?.(n.values, ctx)) ?? {};
  Object.assign(n.values, checked.values ?? {});
  return { values: n.values, missing, problems: [...n.problems, ...(checked.problems ?? [])], warnings: checked.warnings ?? [] };
}

/** A complete, valid proposal: its values and its card. */
async function propose(key: string, raw: Values, ctx = ctxFor()): Promise<{ values: Values; card: Preview; warnings: string[] }> {
  const r = await prepare(key, raw, ctx);
  expect(r.missing).toEqual([]);
  expect(r.problems).toEqual([]);
  return { values: r.values, card: (await def(key).preview?.(r.values, ctx)) ?? {}, warnings: r.warnings };
}

function stored(key: string, input: Values, over: Partial<StoredAction> = {}): StoredAction {
  return {
    id: ACTION,
    user_id: ME,
    conversation_id: null,
    turn_id: null,
    tool_call_id: null,
    plan_id: null,
    plan_index: null,
    plan_title: null,
    action_key: key,
    title: key,
    risk: "sensitive",
    input,
    card: {},
    before_state: null,
    confirm_phrase: null,
    status: "done",
    result: null,
    error: null,
    source: "chat",
    approver_id: null,
    approval_note: null,
    decided_at: null,
    reported_at: null,
    undo_until: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    executed_at: NOW.toISOString(),
    expires_at: NOW.toISOString(),
    ...over,
  };
}

const info = { actionId: ACTION, origin: "https://dash.test" };
type Fn = { mock: { calls: unknown[][] } };
const call = (fn: Fn, i = -1) => fn.mock.calls.at(i) as [Request, { params: Promise<Record<string, string>> }];
const bodyOf = async (fn: Fn, i = -1) => (await call(fn, i)[0].clone().json()) as Record<string, unknown>;
const pathOf = (fn: Fn, i = -1) => new URL(call(fn, i)[0].url).pathname;
const paramsOf = (fn: Fn, i = -1) => call(fn, i)[1].params;

beforeEach(() => {
  shared.tables = fixtures();
  db = fakeSupabase(shared.tables);
  for (const fn of Object.values(routes)) fn.mockClear();
  sheets.readSheet.mockReset();
});

/* ----------------------------------------------------------------- tests */

describe("who may use the admin actions", () => {
  it("files the four agreed actions under Team & admin", () => {
    expect(ADMIN_ACTIONS.map((a) => a.key)).toEqual(["import.sheet", "user.admin", "perm.admin", "settings.admin"]);
    expect(ADMIN_ACTIONS.every((a) => a.group === "Team & admin")).toBe(true);
  });

  it("refuses with the permission each endpoint checks", () => {
    const none = ctxFor([]);
    expect(def("import.sheet").allowed(none)).toBe("Your account doesn't have “Import Leads”.");
    expect(def("user.admin").allowed(none)).toBe("Your account doesn't have “Edit Users”.");
    expect(def("perm.admin").allowed(none)).toBe("Your account doesn't have “Manage Permissions”.");
    expect(def("settings.admin").allowed(none)).toBe("Your account doesn't have “Manage App Settings & Add-ons”.");
    for (const d of ADMIN_ACTIONS) expect(d.allowed(ctxFor())).toBeNull();
  });

  it("lets someone with none of the permissions still get a card to send to an approver", async () => {
    const agent = ctxFor(["leads.create"]);
    expect(def("user.admin").allowed(agent)).not.toBeNull();
    expect((await prepare("user.admin", { operation: "Deactivate", user: SARA }, agent)).problems).toEqual([]);
    expect(def("settings.admin").allowed(agent)).not.toBeNull();
    expect((await prepare("settings.admin", { company_name: "SED Digital" }, agent)).problems).toEqual([]);
    expect((await prepare("settings.admin", { event: "ticket_opened", enabled: false }, agent)).problems).toEqual([]);
  });

  it("lets a person with one user permission in, and refuses the other changes per change", async () => {
    const ctx = ctxFor(["admin.users.deactivate"]);
    expect(def("user.admin").allowed(ctx)).toBeNull();
    expect((await prepare("user.admin", { operation: "Delete", user: SARA }, ctx)).problems[0]).toEqual({
      field: "operation",
      message: "Your account doesn't have “Delete Users”.",
    });
    expect((await prepare("user.admin", { operation: "Change username", user: SARA, username: "sara2" }, ctx)).problems[0].message).toBe(
      "Your account doesn't have “Edit Users”.",
    );
    expect((await prepare("user.admin", { operation: "Create", full_name: "Zara", email: "z@sed.test", username: "zara", departments: [SALES] }, ctx)).problems[0].message).toBe(
      "Your account doesn't have “Create Users”.",
    );
    expect((await prepare("user.admin", { operation: "Deactivate", user: SARA }, ctx)).problems).toEqual([]);
  });

  it("checks the settings or notifications permission by what is being changed", async () => {
    const rulesOnly = ctxFor(["admin.notifications.manage"]);
    expect(def("settings.admin").allowed(rulesOnly)).toBeNull();
    expect((await prepare("settings.admin", { company_name: "SED" }, rulesOnly)).problems[0]).toEqual({
      field: "area",
      message: "Your account doesn't have “Manage App Settings & Add-ons”.",
    });
    expect((await prepare("settings.admin", { event: "ticket_opened", enabled: false }, rulesOnly)).problems).toEqual([]);
    expect((await prepare("settings.admin", { event: "ticket_opened", enabled: false }, ctxFor(["admin.settings.manage"]))).problems[0].message).toBe(
      "Your account doesn't have “Manage Notification Rules”.",
    );
  });

  it("never has a password, key or secret field", () => {
    for (const d of ADMIN_ACTIONS) for (const f of d.fields) expect(f.name).not.toMatch(/pass|secret|token|key$|api/i);
  });
});

describe("import.sheet", () => {
  const SHEET: string[][] = [
    ["Business", "Phone", "Agent", "Status"],
    ["Jumbo's Pizza", "(252) 401-2775", "Sara Ali", "Ready"], // already a lead
    ["New Bakery", "(512) 555-0101", "Sara Ali", "Not Ready"],
    ["", "(512) 555-0102", "", ""], // no business name
    ["Roof Co", "(512) 555-0103", "Zed Unknown", "Ready"],
    ["New Bakery", "(512) 555-0101", "Sara Ali", ""], // repeated in the sheet
  ];

  it("uses the sheet, tab and mapping saved on the Import page", async () => {
    const r = await prepare("import.sheet", {});
    expect(r.missing).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.values).toMatchObject({ sheet: SAVED_SHEET, tab: "New (April 2026)", mapping: SAVED_MAPPING });
  });

  it("takes another sheet's link — and then asks for its tab", async () => {
    const link = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit#gid=0";
    const r = await prepare("import.sheet", { sheet: link });
    expect(r.values.sheet).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd");
    expect(r.problems).toEqual([{ field: "_", message: "Which tab of that sheet should be imported?" }]);
    expect((await prepare("import.sheet", { sheet: link, tab: "May" })).problems).toEqual([]);
    expect((await prepare("import.sheet", { sheet: "https://example.com/sheet" })).problems[0]).toMatchObject({ field: "sheet" });
  });

  it("refuses a mapping that would skip every row", async () => {
    t().import_config[0].mapping = { A: "business_phone" };
    expect((await prepare("import.sheet", {})).problems[0].message).toMatch(/No column is mapped to business_name/);
    expect(mappingError({ A: "business_name", B: "password" })).toBe('Column B: "password" is not a field the import can fill.');
    expect(mappingError({ "1": "business_name" })).toBe('"1" is not a column letter.');
    expect(mappingError(SAVED_MAPPING)).toBeNull();
  });

  it("previews how many new leads the sheet would create, by the import's own rules", async () => {
    sheets.readSheet.mockResolvedValue(SHEET);
    const { card } = await propose("import.sheet", {});
    expect(sheets.readSheet).toHaveBeenCalledWith(SAVED_SHEET, "New (April 2026)");
    expect(card.title).toBe("Import 2 new leads from “New (April 2026)”");
    expect(card.fields?.find((f) => f.name === "rows")?.value).toBe("5: 2 new, 2 already in the system, 1 without a business name");
    expect(card.warnings).toEqual(["No user is called Zed Unknown — their leads will be imported unassigned."]);
  });

  it("warns on the card when the sheet cannot be read", async () => {
    sheets.readSheet.mockRejectedValue(new Error("The caller does not have permission"));
    const { card } = await propose("import.sheet", {});
    expect(card.title).toBe("Import leads from “New (April 2026)”");
    expect(card.warnings?.[0]).toMatch(/could not be read for a preview \(The caller does not have permission\)/);
  });

  it("runs the import endpoint with the sheet, tab and mapping", async () => {
    const { values } = await propose("import.sheet", { tab: "Leads" });
    const res = await def("import.sheet").execute(values, ctxFor(), info);
    expect(pathOf(routes.importRun)).toBe("/api/admin/import/run");
    expect(await bodyOf(routes.importRun)).toEqual({ sheetId: SAVED_SHEET, tab: "Leads", mapping: SAVED_MAPPING });
    expect(res.message).toBe("Imported 2 leads from “Leads”; 3 skipped (already in the system or no business name).");
  });

  it("fails when nothing could be imported", async () => {
    routes.importRun.mockResolvedValueOnce(Response.json({ imported: 0, skipped: 0, failed: 4, error: "A Ready lead needs a website link." }));
    const { values } = await propose("import.sheet", {});
    await expect(def("import.sheet").execute(values, ctxFor(), info)).rejects.toThrow("Nothing was imported: A Ready lead needs a website link.");
  });

  it("knows a sheet link from an id", () => {
    expect(sheetIdFrom(SAVED_SHEET)).toBe(SAVED_SHEET);
    expect(sheetIdFrom(`https://docs.google.com/spreadsheets/d/${SAVED_SHEET}/edit`)).toBe(SAVED_SHEET);
    expect(sheetIdFrom("my sheet")).toBeNull();
  });
});

describe("user.admin", () => {
  it("asks for what a new account needs — and never a password", async () => {
    expect((await prepare("user.admin", { operation: "Create" })).missing).toEqual(["full_name", "display_name", "email", "username", "departments"]);
    const r = await prepare("user.admin", { operation: "Create", full_name: "Zara Malik" });
    expect(r.values.display_name).toBe("Zara Malik");
    expect(r.missing).toEqual(["email", "username", "departments"]);
    expect((await prepare("user.admin", { operation: "Deactivate" })).missing).toEqual(["user"]);
    expect((await prepare("user.admin", {})).missing).toEqual(["operation", "user"]);
  });

  it("creates the account with a password nobody ever sees", async () => {
    const { values, card } = await propose("user.admin", { operation: "Create", full_name: "Zara Malik", email: "Zara@SED.test", username: "Zara.M", departments: ["Sales"] });
    expect(riskOf("user.admin", values)).toBe("sensitive");
    expect(card.notes?.[0]).toMatch(/can't sign in until you set their first password/);
    const res = await def("user.admin").execute(values, ctxFor(), info);
    const body = await bodyOf(routes.usersPost);
    expect(pathOf(routes.usersPost)).toBe("/api/admin/users");
    expect(body).toMatchObject({ email: "zara@sed.test", username: "zara.m", fullName: "Zara Malik", displayName: "Zara Malik", departmentIds: [SALES] });
    expect(typeof body.tempPassword).toBe("string");
    expect(String(body.tempPassword).length).toBeGreaterThanOrEqual(40);
    // Not on the card, not in the result the model reads, not in the stored values.
    expect(JSON.stringify(res)).not.toContain(String(body.tempPassword));
    expect(JSON.stringify(values)).not.toContain(String(body.tempPassword));
    expect(res).toMatchObject({ data: { id: NEW_USER, kind: "user" }, undoable: false, link: { href: `/admin/users/${NEW_USER}` } });
    expect(res.message).toMatch(/can't sign in until a first password is set/);
  });

  it("refuses a taken username or email, and flags the Admin department", async () => {
    const r = await prepare("user.admin", { operation: "Create", full_name: "Sara Two", email: "sara@sed.test", username: "SARA", departments: [ADMIN_DEPT] });
    expect(r.problems).toEqual([
      { field: "username", message: "The username “sara” is already taken." },
      { field: "email", message: "There is already an account with sara@sed.test (Sara Ali)." },
    ]);
    expect(r.warnings).toEqual(["The Admin department can do everything in the app."]);
    expect((await prepare("user.admin", { operation: "Create", full_name: "X", email: "x@sed.test", username: "x!", departments: [SALES] })).problems[0].field).toBe("username");
  });

  it("deactivates with the person's name as the confirm words, and undo activates again", async () => {
    const { values, card } = await propose("user.admin", { operation: "deactivate", user: "Sara" });
    expect(values).toMatchObject({ operation: "Deactivate", user: SARA, __name: "Sara Ali" });
    expect(riskOf("user.admin", values)).toBe("critical");
    expect(card).toMatchObject({ title: "Deactivate Sara Ali", confirmPhrase: "Sara Ali", changes: [{ label: "Account", from: "Active", to: "Deactivated" }] });
    expect(card.warnings).toEqual(["1 lead stay assigned to them — reassign them if someone else should follow up."]);
    expect(card.before).toEqual({ is_active: true, username: "sara", departmentIds: [SALES] });

    await def("user.admin").execute(values, ctxFor(), info);
    expect(pathOf(routes.userPatch)).toBe(`/api/admin/users/${SARA}`);
    expect(await paramsOf(routes.userPatch)).toEqual({ id: SARA });
    expect(await bodyOf(routes.userPatch)).toEqual({ isActive: false });

    expect(await def("user.admin").undo!.run(stored("user.admin", values, { before_state: card.before }), ctxFor())).toBe("the account is active again.");
    expect(await bodyOf(routes.userPatch)).toEqual({ isActive: true });
  });

  it("will not lock the person out or delete their own account", async () => {
    expect((await prepare("user.admin", { operation: "Deactivate", user: ME })).problems[0].message).toMatch(/won't deactivate your own account/);
    expect((await prepare("user.admin", { operation: "Delete", user: ME })).problems[0].message).toBe("You cannot delete your own account.");
    expect((await prepare("user.admin", { operation: "Activate", user: SARA })).problems[0].message).toBe("Sara Ali is already active.");
  });

  it("activates a deactivated account without a typed phrase", async () => {
    const { values, card } = await propose("user.admin", { operation: "Activate", user: BOB });
    expect(riskOf("user.admin", values)).toBe("sensitive");
    expect(card.confirmPhrase).toBeUndefined();
    await def("user.admin").execute(values, ctxFor(), info);
    expect(await bodyOf(routes.userPatch)).toEqual({ isActive: true });
  });

  it("changes departments by adding and removing, sending the whole new list", async () => {
    const { values, card } = await propose("user.admin", { operation: "Change departments", user: SARA, add_departments: ["Tech"], remove_departments: ["Sales"] });
    expect(riskOf("user.admin", values)).toBe("critical");
    expect(card.changes).toEqual([{ label: "Departments", from: "Sales", to: "Tech" }]);
    await def("user.admin").execute(values, ctxFor(), info);
    expect(await bodyOf(routes.userPatch)).toEqual({ departmentIds: [TECH] });
    await def("user.admin").undo!.run(stored("user.admin", values, { before_state: card.before }), ctxFor());
    expect(await bodyOf(routes.userPatch)).toEqual({ departmentIds: [SALES] });
  });

  it("says when a department change changes nothing, or when the list moved on", async () => {
    expect((await prepare("user.admin", { operation: "Change departments", user: SARA, add_departments: [SALES] })).problems[0].message).toMatch(/changes nothing/);
    expect((await prepare("user.admin", { operation: "Change departments", user: SARA })).problems[0].message).toMatch(/Say which departments/);
    const { values, card } = await propose("user.admin", { operation: "Change departments", user: SARA, add_departments: [TECH] });
    t().department_members.push({ user_id: SARA, department_id: ADMIN_DEPT });
    expect(await def("user.admin").stale!(card.before, values, ctxFor())).toBe("their departments were changed in the meantime.");
  });

  it("changes a username (lower-cased) and undo puts the old one back", async () => {
    const { values, card } = await propose("user.admin", { operation: "Change username", user: SARA, username: "Sara.K" });
    expect(card.changes).toEqual([{ label: "Username", from: "@sara", to: "@sara.k" }]);
    await def("user.admin").execute(values, ctxFor(), info);
    expect(await bodyOf(routes.userPatch)).toEqual({ username: "sara.k" });
    expect(await def("user.admin").undo!.run(stored("user.admin", values, { before_state: card.before }), ctxFor())).toBe("their username is @sara again.");
    expect(await bodyOf(routes.userPatch)).toEqual({ username: "sara" });
    expect((await prepare("user.admin", { operation: "Change username", user: SARA, username: "bob" })).problems[0].message).toBe("The username “bob” is already taken.");
  });

  it("deletes through the endpoint, permanently", async () => {
    const { values, card } = await propose("user.admin", { operation: "Delete", user: SARA });
    expect(card.confirmPhrase).toBe("Sara Ali");
    expect(card.warnings).toContain("Their 1 lead become unassigned.");
    const res = await def("user.admin").execute(values, ctxFor(), info);
    expect(call(routes.userDelete)[0].method).toBe("DELETE");
    expect(pathOf(routes.userDelete)).toBe(`/api/admin/users/${SARA}`);
    expect(res.undoable).toBe(false);
  });

  it("lets the endpoint's refusal through as the failure", async () => {
    routes.userPatch.mockResolvedValueOnce(Response.json({ error: "Forbidden" }, { status: 403 }));
    const { values } = await propose("user.admin", { operation: "Deactivate", user: SARA });
    await expect(def("user.admin").execute(values, ctxFor(), info)).rejects.toBeInstanceOf(RouteError);
  });
});

describe("perm.admin", () => {
  it("knows a permission by its name or its key", () => {
    expect(findPermission("Delete Users")).toMatchObject({ ok: true, perm: { key: "admin.users.delete", sensitive: true } });
    expect(findPermission("admin.users.delete")).toMatchObject({ ok: true, perm: { name: "Delete Users" } });
    expect(findPermission("view ready leads")).toMatchObject({ ok: true, perm: { key: "leads.cat_view.ready" } });
    expect(findPermission("import leads")).toMatchObject({ ok: true, perm: { key: "admin.import" } });
    const many = findPermission("users");
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.choices).toContain("Delete Users (admin.users.delete)");
    expect(findPermission("launch rockets")).toMatchObject({ ok: false });
  });

  it("asks for a department or a person", async () => {
    expect((await prepare("perm.admin", {})).missing).toEqual(["operation", "permission", "user"]);
    expect((await prepare("perm.admin", { operation: "Grant", permission: "Delete Lead", department: SALES })).missing).toEqual([]);
    expect((await prepare("perm.admin", { operation: "Grant", permission: "Delete Lead", department: SALES, user: SARA })).problems[0].message).toBe(
      "Give a department OR a person, not both.",
    );
  });

  it("grants to a department through its permission grid's endpoint; undo revokes", async () => {
    const { values, card } = await propose("perm.admin", { operation: "Grant", permission: "Delete Lead", department: "Sales" });
    expect(values.permission).toBe("leads.delete");
    expect(riskOf("perm.admin", values)).toBe("critical");
    expect(card).toMatchObject({
      title: "Grant “Delete Lead” to Sales",
      confirmPhrase: "Sales",
      changes: [{ label: "Delete Lead (leads.delete)", from: "No", to: "Yes" }],
      warnings: ["“Delete Lead” is a sensitive permission."],
    });
    expect(card.notes?.[0]).toBe("Applies to everyone in Sales (2 people).");
    await def("perm.admin").execute(values, ctxFor(), info);
    expect(pathOf(routes.deptPermissions)).toBe(`/api/admin/departments/${SALES}/permissions`);
    expect(await paramsOf(routes.deptPermissions)).toEqual({ id: SALES });
    expect(await bodyOf(routes.deptPermissions)).toEqual({ permissionKey: "leads.delete", enabled: true });
    await def("perm.admin").undo!.run(stored("perm.admin", values, { before_state: card.before }), ctxFor());
    expect(await bodyOf(routes.deptPermissions)).toEqual({ permissionKey: "leads.delete", enabled: false });
  });

  it("says when a department already has it, or has nothing to revoke", async () => {
    expect((await prepare("perm.admin", { operation: "Grant", permission: "Create Lead", department: SALES })).problems[0].message).toBe("Sales already has “Create Lead”.");
    expect((await prepare("perm.admin", { operation: "Revoke", permission: "Delete Lead", department: SALES })).problems[0].message).toMatch(/nothing to revoke/);
    expect((await prepare("perm.admin", { operation: "Reset to department default", permission: "Delete Lead", department: SALES })).problems[0].field).toBe("operation");
  });

  it("grants a person a trial until the end of a day, fixing the expiry the endpoint leaves behind", async () => {
    const { values, card } = await propose("perm.admin", { operation: "Grant", permission: "Delete Lead", user: SARA, until: "2026-10-20" });
    expect(card.title).toBe("Give Sara Ali “Delete Lead” until the end of Tue, Oct 20, 2026");
    expect(card.changes?.[0]).toEqual({ label: "Delete Lead (leads.delete)", from: "No", to: "Yes — personal grant until the end of Tue, Oct 20, 2026" });
    expect(card.confirmPhrase).toBe("Sara Ali");
    await def("perm.admin").execute(values, ctxFor(), info);
    expect(pathOf(routes.overrides)).toBe(`/api/admin/users/${SARA}/overrides`);
    expect(await bodyOf(routes.overrides)).toEqual({ permissionKey: "leads.delete", isGranted: true, remove: false });
    // Midnight starting Oct 21 in Karachi.
    expect(t().user_permission_overrides[0]).toMatchObject({ is_granted: true, expires_at: "2026-10-20T19:00:00.000Z" });
    expect(db.writes.find((w) => w.table === "activity_log")?.values).toMatchObject({ action: "user.permission.expiry_set", entity_id: SARA });

    // Undo: the old (expired) grant row as it was.
    await def("perm.admin").undo!.run(stored("perm.admin", values, { before_state: card.before }), ctxFor());
    expect(t().user_permission_overrides[0]).toMatchObject({ is_granted: true, expires_at: "2026-10-01T00:00:00Z" });
  });

  it("makes a permanent grant permanent even over an old expired row", async () => {
    const { values } = await propose("perm.admin", { operation: "Grant", permission: "leads.delete", user: SARA });
    await def("perm.admin").execute(values, ctxFor(), info);
    expect(t().user_permission_overrides[0]).toMatchObject({ is_granted: true, expires_at: null });
  });

  it("revokes for a person and undo clears the override again", async () => {
    const { values, card } = await propose("perm.admin", { operation: "Revoke", permission: "Create Lead", user: SARA });
    expect(card.changes?.[0]).toEqual({ label: "Create Lead (leads.create)", from: "Yes — through Sales", to: "No — personal revoke" });
    await def("perm.admin").execute(values, ctxFor(), info);
    expect(t().user_permission_overrides.find((o) => o.permission_key === "leads.create")).toMatchObject({ is_granted: false, expires_at: null });
    expect(await def("perm.admin").undo!.run(stored("perm.admin", values, { before_state: card.before }), ctxFor())).toBe("their departments decide it again, as before.");
    expect(await bodyOf(routes.overrides)).toEqual({ permissionKey: "leads.create", isGranted: false, remove: true });
    expect(t().user_permission_overrides.find((o) => o.permission_key === "leads.create")).toBeUndefined();
  });

  it("resets only a personal override that still applies", async () => {
    expect((await prepare("perm.admin", { operation: "Reset to department default", permission: "Delete Lead", user: SARA })).problems[0].message).toMatch(/no personal grant or revoke/);
    t().user_permission_overrides.push({ user_id: SARA, permission_key: "admin.import", is_granted: true, expires_at: null });
    const { values } = await propose("perm.admin", { operation: "Reset to department default", permission: "Import Leads", user: SARA });
    await def("perm.admin").execute(values, ctxFor(), info);
    expect(await bodyOf(routes.overrides)).toEqual({ permissionKey: "admin.import", isGranted: false, remove: true });
  });

  it("refuses on confirm when the permissions moved on", async () => {
    const { values, card } = await propose("perm.admin", { operation: "Grant", permission: "Delete Lead", department: SALES });
    t().department_permissions.push({ department_id: SALES, permission_key: "leads.delete" });
    expect(await def("perm.admin").stale!(card.before, values, ctxFor())).toBe("the department's permissions were changed in the meantime.");
  });

  it("ends a trial at the end of the day in company time", () => {
    expect(endOfDay("2026-10-20", "Asia/Karachi")).toBe("2026-10-20T19:00:00.000Z");
    expect(endOfDay("2026-12-31", "America/New_York")).toBe("2027-01-01T05:00:00.000Z");
  });
});

describe("settings.admin — app settings", () => {
  it("works out what is being changed from the fields given", async () => {
    expect((await prepare("settings.admin", {})).missing).toEqual(["area"]);
    expect((await prepare("settings.admin", { company_name: "SED Digital" })).values.area).toBe("App settings");
    expect((await prepare("settings.admin", { event: "ticket_opened", enabled: false })).values.area).toBe("Notification rule");
  });

  it("reads times and timezones the way people say them", async () => {
    const { values, card } = await propose("settings.admin", { work_start_time: "9:30am", work_timezone: "america/new_york" });
    expect(values).toMatchObject({ work_start_time: "09:30", work_timezone: "America/New_York" });
    expect(card.changes).toEqual([
      { label: "Work start time", from: "09:00", to: "09:30" },
      { label: "Company timezone", from: "Asia/Karachi", to: "America/New_York" },
    ]);
    expect(card.warnings?.[0]).toMatch(/Day boundaries/);
    expect((await prepare("settings.admin", { work_timezone: "EST" })).problems[0].field).toBe("work_timezone");
    expect((await prepare("settings.admin", { work_start_time: "25:00" })).problems[0].field).toBe("work_start_time");
    expect(clockTime("6:15 pm")).toBe("18:15");
    expect(clockTime("12am")).toBe("00:00");
    expect(clockTime("9")).toBeNull();
    expect(ianaZone("utc")).toBe("UTC");
  });

  it("sends the endpoint the whole settings row with only the change applied", async () => {
    const { values } = await propose("settings.admin", { company_name: "SED Digital" });
    expect(riskOf("settings.admin", values)).toBe("sensitive");
    await def("settings.admin").execute(values, ctxFor(), info);
    expect(pathOf(routes.settingsPut)).toBe("/api/admin/settings");
    expect(await bodyOf(routes.settingsPut)).toEqual({
      work_start_time: "09:00",
      work_timezone: "Asia/Karachi",
      idle_timeout_minutes: 15,
      ticket_sla: { Low: 168, Normal: 72, High: 24 },
      ticket_retention_days: 0,
      company_name: "SED Digital",
      form_default_mailbox_id: null,
    });
  });

  it("undo restores only what it changed", async () => {
    const { values, card } = await propose("settings.admin", { company_name: "SED Digital", sla_high_hours: 12 });
    await def("settings.admin").execute(values, ctxFor(), info);
    t().app_settings[0].idle_timeout_minutes = 30; // someone else, meanwhile
    expect(await def("settings.admin").undo!.run(stored("settings.admin", values, { before_state: card.before }), ctxFor())).toBe("the previous settings are back.");
    expect(await bodyOf(routes.settingsPut)).toMatchObject({ company_name: "SED LMS", ticket_sla: { Low: 168, Normal: 72, High: 24 }, idle_timeout_minutes: 30 });
  });

  it("makes deleting old tickets a high-impact change with typed words", async () => {
    const { values, card } = await propose("settings.admin", { ticket_retention_days: 30 });
    expect(values.__retention_cut).toBe(true);
    expect(riskOf("settings.admin", values)).toBe("critical");
    expect(card.confirmPhrase).toBe("keep 30 days");
    expect(card.warnings?.[0]).toBe("Resolved tickets older than 30 days are deleted for good by the nightly cleanup — 1 ticket right now. They can't be restored.");
    expect(card.changes).toEqual([{ label: "Keep resolved tickets", from: "Forever", to: "30 days" }]);
    // Keeping tickets longer deletes nothing.
    t().app_settings[0].ticket_retention_days = 30;
    expect(riskOf("settings.admin", (await prepare("settings.admin", { ticket_retention_days: 60 })).values)).toBe("sensitive");
  });

  it("only takes a verified mailbox as the Form Relay sender", async () => {
    expect((await prepare("settings.admin", { form_sender: MAILBOX_UNVERIFIED })).problems[0].message).toMatch(/Only a verified mailbox/);
    const { values, card } = await propose("settings.admin", { form_sender: "hello@sed.test" });
    expect(card.changes).toEqual([{ label: "Form Relay default sender", from: "—", to: "hello@sed.test" }]);
    await def("settings.admin").execute(values, ctxFor(), info);
    expect((await bodyOf(routes.settingsPut)).form_default_mailbox_id).toBe(MAILBOX);
  });

  it("says when nothing would change, and when someone else changed the settings", async () => {
    expect((await prepare("settings.admin", { company_name: "SED LMS" })).problems[0].message).toBe("Those settings already have those values.");
    const { values, card } = await propose("settings.admin", { company_name: "SED Digital" });
    t().app_settings[0].updated_at = "2026-10-14T04:59:00Z";
    expect(await def("settings.admin").stale!(card.before, values, ctxFor())).toBe("the settings were changed by someone else after this was proposed.");
  });
});

describe("settings.admin — notification rules", () => {
  it("adds departments and people to a rule, sending the endpoint's slugs", async () => {
    const { values, card } = await propose("settings.admin", { event: "Ticket opened", add_departments: ["Tech"], add_people: ["Sara"] });
    expect(values.event).toBe("ticket_opened");
    expect(card.title).toBe("Notification rule — Ticket opened (needs assignment)");
    expect(card.changes).toEqual([
      { label: "Departments", from: "Admin", to: "Admin, Tech" },
      { label: "People", from: "—", to: "Sara Ali" },
    ]);
    await def("settings.admin").execute(values, ctxFor(), info);
    expect(pathOf(routes.rulePut)).toBe("/api/admin/notification-rules/ticket_opened");
    expect(await paramsOf(routes.rulePut)).toEqual({ eventKey: "ticket_opened" });
    expect(await bodyOf(routes.rulePut)).toEqual({ enabled: true, target_departments: ["admin", "tech"], target_users: [SARA], target_roles: [], delay_minutes: 0 });

    await def("settings.admin").undo!.run(stored("settings.admin", values, { before_state: card.before }), ctxFor());
    expect(await bodyOf(routes.rulePut)).toEqual({ enabled: true, target_departments: ["admin"], target_users: [], target_roles: [], delay_minutes: 0 });
  });

  it("only offers the roles the event has", async () => {
    const r = await prepare("settings.admin", { event: "ticket_opened", add_roles: ["lead agent"] });
    expect(r.values.add_roles).toEqual(["lead_agent"]);
    expect(r.problems[0].message).toBe("“Ticket opened (needs assignment)” can't go to Lead agent — it has no roles.");
    expect((await prepare("settings.admin", { event: "ticket_resolved", add_roles: ["ticket_creator"] })).problems).toEqual([]);
  });

  it("says when the rule is already set that way", async () => {
    expect((await prepare("settings.admin", { event: "ticket_opened", enabled: true })).problems[0].message).toBe("That is already how the rule is set.");
    expect((await prepare("settings.admin", { event: "ticket_opened" })).problems[0].message).toMatch(/Say what to change on the rule/);
  });

  it("switches off again on undo a rule that had never been set up", async () => {
    const { values, card } = await propose("settings.admin", { event: "website_lead_received", add_departments: ["management"] });
    expect(card.changes?.[0]).toEqual({ label: "Notification", from: "Off (never set up)", to: "On" });
    await def("settings.admin").execute(values, ctxFor(), info);
    expect(await bodyOf(routes.rulePut)).toEqual({ enabled: true, target_departments: ["management"], target_users: [], target_roles: [], delay_minutes: 0 });
    await def("settings.admin").undo!.run(stored("settings.admin", values, { before_state: card.before }), ctxFor());
    expect(await bodyOf(routes.rulePut)).toEqual({ enabled: false, target_departments: [], target_users: [], target_roles: [], delay_minutes: 0 });
  });
});
