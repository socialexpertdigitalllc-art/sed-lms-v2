import { randomBytes } from "node:crypto";
import { DEFAULT_MAPPING, IMPORT_TARGETS } from "@/lib/import/columns";
import { mapRow } from "@/lib/import/map";
import { catSetKey, catViewKey } from "@/lib/leads/categories";
import { LEAD_STATUSES } from "@/lib/leads/types";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";
import { departmentSlugs } from "@/lib/notifications/logic";
import { isKnownPermissionKey, PERMISSIONS } from "@/lib/permissions/constants";
import { addDays, zonedMidnightMs } from "../../dates";
import type { CardChange, CardField, CardLink } from "../card";
import { formatDate, formatDateTime, isBlank } from "../fields";
import { changesOf, displayValue, isStepRef, need, plural, str } from "../helpers";
import { callRoute, RouteError } from "../invoke";
import { likeTerm } from "../refs";
import type { ActionContext, ActionDef, Problem, Values } from "../types";

/**
 * Team & admin actions: run the lead import, manage user accounts, grant and
 * revoke permissions, change app settings and notification rules. Each goes
 * through the endpoint the admin screen uses (see ../invoke.ts), so the
 * screen's permission checks and activity log apply unchanged.
 *
 * NO SECRETS. Nothing here takes or shows a password, API key or other
 * credential: a new account is created without a usable password (an admin
 * sets the first one on the user's page), and the AI-provider / email-provider
 * screens are not reachable from SED AI at all.
 */

const importRunRoute = () => import("@/app/api/admin/import/run/route");
const usersRoute = () => import("@/app/api/admin/users/route");
const userRoute = () => import("@/app/api/admin/users/[id]/route");
const overridesRoute = () => import("@/app/api/admin/users/[id]/overrides/route");
const deptPermissionsRoute = () => import("@/app/api/admin/departments/[id]/permissions/route");
const settingsRoute = () => import("@/app/api/admin/settings/route");
const ruleRoute = () => import("@/app/api/admin/notification-rules/[eventKey]/route");

/* -------------------------------------------------------------- helpers */

/** A refusal in our own words — shown to the person as is. */
const refuse = (message: string, status = 409) => new RouteError(message, status, null);

const idList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const pad = (n: number) => String(n).padStart(2, "0");

interface Person {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  is_active: boolean;
}

/** The Users screens read profiles with the service role behind admin.users.* — so do these. */
async function personOf(ctx: ActionContext, id: unknown): Promise<Person | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.admin.from("profiles").select("id, email, username, display_name, is_active").eq("id", id).maybeSingle();
  return (data as Person | null) ?? null;
}

const nameOf = (p: Pick<Person, "display_name" | "email">) => (p.display_name ?? "").trim() || p.email;

async function departmentsOf(ctx: ActionContext, userId: string): Promise<string[]> {
  const { data } = await ctx.admin.from("department_members").select("department_id").eq("user_id", userId);
  return ((data ?? []) as { department_id: string }[]).map((m) => m.department_id);
}

async function departmentNames(ctx: ActionContext, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await ctx.admin.from("departments").select("id, name").in("id", [...new Set(ids)]);
  return new Map(((data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
}

async function adminDepartmentId(ctx: ActionContext): Promise<string | null> {
  const { data } = await ctx.admin.from("departments").select("id").eq("slug", "admin").maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function leadCount(ctx: ActionContext, agentId: string): Promise<number> {
  const { count } = await ctx.admin.from("leads").select("id", { count: "exact", head: true }).eq("agent_id", agentId).is("deleted_at", null);
  return count ?? 0;
}

const userLink = (id: string, label = "Open user"): CardLink => ({ href: `/admin/users/${id}`, label });

/* ---------------------------------------------------------- import.sheet */

/** A Google Sheets link or a bare spreadsheet id → the id. */
export function sheetIdFrom(input: string): string | null {
  const s = input.trim();
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

/** Why a column mapping cannot be used, or null. The import page's own choices only. */
export function mappingError(m: unknown): string | null {
  if (!m || typeof m !== "object" || Array.isArray(m)) return "The column mapping must map column letters to lead fields, like {\"F\": \"business_name\"}.";
  const entries = Object.entries(m as Record<string, unknown>);
  if (!entries.length) return "The column mapping is empty.";
  for (const [col, field] of entries) {
    if (!/^[A-Z]{1,3}$/i.test(col)) return `"${col}" is not a column letter.`;
    if (typeof field !== "string" || !(IMPORT_TARGETS as readonly string[]).includes(field)) return `Column ${col}: "${String(field)}" is not a field the import can fill.`;
  }
  if (!entries.some(([, f]) => f === "business_name")) return "No column is mapped to business_name, so every row would be skipped. Fix the mapping on the Import page.";
  return null;
}

interface ImportConfigRow {
  sheet_id: string;
  sheet_tab: string;
  mapping: Record<string, string> | null;
}

/** The sheet, tab and mapping saved on the Import page (read the way that page does: service role, behind admin.import). */
async function savedImport(ctx: ActionContext): Promise<ImportConfigRow | null> {
  const { data } = await ctx.admin.from("import_config").select("sheet_id, sheet_tab, mapping").eq("singleton", true).maybeSingle();
  return (data as ImportConfigRow | null) ?? null;
}

interface DryRun {
  /** Data rows (the header row is not one). */
  total: number;
  valid: number;
  /** Rows without a business name. */
  invalid: number;
  /** Already in the system (or repeated in the sheet): skipped. */
  dup: number;
  newCount: number;
  /** Agent names on new rows that match no user — those leads are imported unassigned. */
  unmatched: string[];
}

/** The Import page's Preview: the same rules as the import itself, nothing written. */
async function dryRun(ctx: ActionContext, sheetId: string, tab: string, mapping: Record<string, string>): Promise<DryRun> {
  // googleapis is heavy: loaded only when a card actually needs the sheet.
  const { readSheet } = await import("@/lib/import/sheets");
  const rows = await readSheet(sheetId, tab);
  const [{ data: existing }, { data: profiles }] = await Promise.all([
    ctx.admin.from("leads").select("business_name, business_phone").is("deleted_at", null),
    ctx.admin.from("profiles").select("display_name"),
  ]);
  const key = (name: unknown, phone: unknown) => `${String(name ?? "").trim().toLowerCase()}|${String(phone ?? "").trim()}`;
  const seen = new Set(((existing ?? []) as { business_name: unknown; business_phone: unknown }[]).map((l) => key(l.business_name, l.business_phone)));
  const agents = new Set(((profiles ?? []) as { display_name: unknown }[]).map((p) => String(p.display_name ?? "").trim().toLowerCase()));
  const out: DryRun = { total: Math.max(0, rows.length - 1), valid: 0, invalid: 0, dup: 0, newCount: 0, unmatched: [] };
  const unmatched = new Set<string>();
  for (const row of rows.slice(1)) {
    const m = mapRow(row, mapping);
    if (!m) {
      out.invalid++;
      continue;
    }
    out.valid++;
    const k = key(m.lead.business_name, m.lead.business_phone);
    if (seen.has(k)) {
      out.dup++;
      continue;
    }
    seen.add(k);
    if (m.agentName && !agents.has(m.agentName.trim().toLowerCase())) unmatched.add(m.agentName.trim());
  }
  out.newCount = out.valid - out.dup;
  out.unmatched = [...unmatched];
  return out;
}

async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("reading it took too long")), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const importSheet: ActionDef = {
  key: "import.sheet",
  group: "Team & admin",
  title: "Import leads from Google Sheets",
  description:
    "Run the lead import from a Google Sheet, like Admin → Import: each row becomes a lead, rows already in the system (same business name + phone) are skipped, and each lead goes to the agent named in the sheet. Uses the sheet, tab and column mapping saved on the Import page unless the person names another sheet or tab. The card shows how many new leads it would create before anything happens.",
  confirmLabel: "Import leads",
  risk: "sensitive",
  allowed: (ctx) => need(ctx, "admin.import"),
  fields: [
    { name: "sheet", label: "Spreadsheet", type: "text", max: 500, editable: false, help: "The Google Sheet's link or ID. Leave out for the sheet saved on the Import page." },
    { name: "tab", label: "Tab", type: "text", max: 100, editable: false, help: "The tab (worksheet) name. Leave out for the saved tab." },
    {
      name: "mapping",
      label: "Column mapping",
      type: "json",
      hidden: true,
      help: "Leave out: the mapping saved on the Import page is used. Only when the person spells out their columns: {\"A\": \"business_name\", \"B\": \"business_phone\"…}.",
    },
  ],
  label: (v) => str(v.tab),
  minutesSaved: 5,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const values: Values = {};
    const saved = await savedImport(ctx);
    let sheet: string | null = null;
    if (typeof v.sheet === "string") {
      sheet = sheetIdFrom(v.sheet);
      if (!sheet) problems.push({ field: "sheet", message: "That is not a Google Sheets link or spreadsheet ID." });
      else values.sheet = sheet;
    } else if (saved?.sheet_id) values.sheet = sheet = saved.sheet_id;
    else problems.push({ field: "_", message: "Which Google Sheet? None is saved on the Import page — ask for its link." });
    // The saved tab belongs to the saved sheet: another sheet needs its own.
    if (typeof v.tab !== "string") {
      if (saved?.sheet_tab && (!sheet || sheet === saved.sheet_id)) values.tab = saved.sheet_tab;
      else if (sheet) problems.push({ field: "_", message: "Which tab of that sheet should be imported?" });
    }
    let mapping: unknown = v.mapping;
    if (typeof mapping === "string") {
      try {
        mapping = JSON.parse(mapping);
      } catch {
        /* reported below */
      }
    }
    if (mapping === undefined || mapping === null) mapping = saved?.mapping && Object.keys(saved.mapping).length ? saved.mapping : DEFAULT_MAPPING;
    const err = mappingError(mapping);
    if (err) problems.push({ field: "_", message: err });
    else values.mapping = mapping;
    return { problems, values };
  },
  async preview(v, ctx) {
    const sheet = str(v.sheet);
    const tab = str(v.tab);
    const mapping = v.mapping as Record<string, string>;
    const fields: CardField[] = [
      { name: "sheet", label: "Spreadsheet", value: sheet },
      { name: "tab", label: "Tab", value: tab },
      { name: "mapping", label: "Columns", value: `${Object.values(mapping).filter((f) => f && f !== "(ignore)").length} mapped` },
    ];
    const warnings: string[] = [];
    let title = `Import leads from “${tab}”`;
    try {
      // The card waits for this inside the chat turn: a slow sheet becomes a warning, not a stall.
      const r = await within(dryRun(ctx, sheet, tab, mapping), 30_000);
      title = `Import ${plural(r.newCount, "new lead")} from “${tab}”`;
      fields.push({ name: "rows", label: "Rows", value: `${r.total}: ${r.newCount} new, ${r.dup} already in the system, ${r.invalid} without a business name` });
      if (!r.newCount) warnings.push("Nothing new to import: every row is already in the system or has no business name.");
      if (r.unmatched.length) {
        const names = r.unmatched.slice(0, 8).join(", ") + (r.unmatched.length > 8 ? "…" : "");
        warnings.push(`No user is called ${names} — their leads will be imported unassigned.`);
      }
    } catch (e) {
      warnings.push(
        `The sheet could not be read for a preview (${e instanceof Error ? e.message : "unknown error"}). The import will fail the same way — check the link, the tab name, and that the sheet is shared with the import service account.`,
      );
    }
    return {
      title,
      fields,
      warnings,
      notes: [
        "Rows already in the system (same business name + phone) are skipped; each lead goes to the agent named in the sheet.",
        "An import cannot be undone here — imported leads would have to be archived.",
      ],
      link: { href: "/admin/import", label: "Open Import" },
    };
  },
  async execute(v) {
    const res = await callRoute<{ imported?: number; skipped?: number; failed?: number; error?: string }>(importRunRoute, "POST", {
      path: "/api/admin/import/run",
      body: { sheetId: str(v.sheet), tab: str(v.tab), mapping: v.mapping },
    });
    const imported = res.imported ?? 0;
    const skipped = res.skipped ?? 0;
    const failed = res.failed ?? 0;
    if (!imported && failed) throw refuse(`Nothing was imported: ${res.error ?? `${plural(failed, "row")} failed`}.`, 422);
    const parts = [`Imported ${plural(imported, "lead")} from “${str(v.tab)}”`];
    if (skipped) parts.push(`${skipped} skipped (already in the system or no business name)`);
    if (failed) parts.push(`${failed} failed${res.error ? ` — ${res.error}` : ""}`);
    return { message: `${parts.join("; ")}.`, link: { href: "/leads", label: "Open leads" }, data: { imported, skipped, failed } };
  },
};

/* ------------------------------------------------------------ user.admin */

const USER_OPS = ["Create", "Activate", "Deactivate", "Change departments", "Change username", "Delete"] as const;
type UserOp = (typeof USER_OPS)[number];

/** Exactly what /api/admin/users and /api/admin/users/[id] check for each change. */
const USER_OP_PERMISSION: Record<UserOp, string> = {
  Create: "admin.users.create",
  Activate: "admin.users.deactivate",
  Deactivate: "admin.users.deactivate",
  "Change departments": "admin.users.edit",
  "Change username": "admin.users.edit",
  Delete: "admin.users.delete",
};

/** The users endpoint's username rule (stored lower-case). */
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

const userOp = (v: Values): UserOp | null => USER_OPS.find((o) => o === v.operation) ?? null;
const isCreate = (v: Values) => v.operation === "Create";
const holdsAnyUserPermission = (ctx: ActionContext) => Object.values(USER_OP_PERMISSION).some((p) => ctx.perms.has(p));

/** The person's departments after adding and removing. */
function nextDepartments(current: string[], add: string[], remove: string[]): string[] {
  return [...new Set([...current.filter((d) => !remove.includes(d)), ...add])];
}

/**
 * The users endpoint requires a first password for a new account. SED AI
 * never handles one: it sends a random value that is never stored, shown or
 * logged, so nobody can sign in to the account until an admin sets a password
 * on the person's page (Admin → Users → Reset password) — like an invitation.
 */
const unusablePassword = () => randomBytes(32).toString("base64url");

interface UserBefore {
  is_active: boolean;
  username: string | null;
  departmentIds: string[];
}

async function usernameTaken(ctx: ActionContext, username: string, exceptId: string | null): Promise<boolean> {
  const { data } = await ctx.admin.from("profiles").select("id").eq("username", username).maybeSingle();
  const id = (data as { id: string } | null)?.id;
  return Boolean(id) && id !== exceptId;
}

const userAdmin: ActionDef = {
  key: "user.admin",
  group: "Team & admin",
  title: "Manage a user account",
  description:
    "Admin → Users, one change at a time: create an account (name, email, username, departments — never a password: an admin sets the first password on the person's page afterwards), activate or deactivate someone, change their departments (add / remove), change their username, or delete the account. Each needs the same permission as on the Users screen.",
  confirmLabel: "Apply",
  risk: (v) => (v.operation === "Deactivate" || v.operation === "Delete" || v.operation === "Change departments" ? "critical" : "sensitive"),
  allowed: (ctx) => (holdsAnyUserPermission(ctx) ? null : need(ctx, "admin.users.edit")),
  fields: [
    { name: "operation", label: "Change", type: "enum", options: USER_OPS, required: true, editable: false, help: "Which change to make." },
    { name: "user", label: "Person", type: "ref", ref: "user", required: true, editable: false, showIf: (v) => !isCreate(v), help: "Whose account." },
    { name: "full_name", label: "Full name", type: "text", required: true, max: 120, showIf: isCreate },
    { name: "display_name", label: "Display name", type: "text", required: true, max: 80, showIf: isCreate, default: (_ctx: ActionContext, v: Values) => v.full_name, help: "The name shown in the app (default: the full name)." },
    { name: "email", label: "Email", type: "email", required: true, showIf: isCreate, help: "Their sign-in email." },
    {
      name: "username",
      label: "Username",
      type: "text",
      required: true,
      max: 30,
      showIf: (v) => isCreate(v) || v.operation === "Change username",
      help: "3–30 characters: letters, numbers, . _ or - (they sign in with it).",
    },
    { name: "departments", label: "Departments", type: "refs", ref: "department", required: true, showIf: isCreate, help: "One or more departments — they decide what the person can do." },
    { name: "add_departments", label: "Add to departments", type: "refs", ref: "department", showIf: (v) => v.operation === "Change departments" },
    { name: "remove_departments", label: "Remove from departments", type: "refs", ref: "department", showIf: (v) => v.operation === "Change departments" },
  ],
  label: (v) => str(v.__name) || str(v.full_name),
  produces: "user",
  minutesSaved: 2,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    const op = userOp(v);
    // Each change needs its own permission. Someone with none of them is not
    // stopped here: `allowed` already sends their request to an approver, whose
    // own permission this check then tests when they approve it.
    if (op && holdsAnyUserPermission(ctx)) {
      const reason = need(ctx, USER_OP_PERMISSION[op]);
      if (reason) problems.push({ field: "operation", message: reason });
    }
    const target = op && op !== "Create" ? await personOf(ctx, v.user) : null;
    if (target) values.__name = nameOf(target);
    else if (op && op !== "Create" && typeof v.user === "string" && !isStepRef(v.user)) problems.push({ field: "user", message: "That account no longer exists." });

    if (typeof v.username === "string") {
      const u = v.username.trim().toLowerCase();
      if (!USERNAME_RE.test(u)) problems.push({ field: "username", message: "A username is 3–30 characters: letters, numbers, . _ or -." });
      else {
        values.username = u;
        if (target && target.username === u) problems.push({ field: "username", message: `That is already ${nameOf(target)}'s username.` });
        else if (await usernameTaken(ctx, u, target?.id ?? null)) problems.push({ field: "username", message: `The username “${u}” is already taken.` });
      }
    }
    if (op === "Create" && typeof v.email === "string") {
      // Sign-in emails are case-insensitive.
      const { data } = await ctx.admin.from("profiles").select("id, display_name, email").ilike("email", likeTerm(v.email)).limit(1).maybeSingle();
      if (data) problems.push({ field: "email", message: `There is already an account with ${v.email} (${nameOf(data as Person)}).` });
    }
    const adminDept = op === "Create" || op === "Change departments" ? await adminDepartmentId(ctx) : null;
    if (op === "Create" && adminDept && idList(v.departments).includes(adminDept)) warnings.push("The Admin department can do everything in the app.");

    if (target && op) {
      const name = nameOf(target);
      if (op === "Activate" && target.is_active) problems.push({ field: "user", message: `${name} is already active.` });
      if (op === "Deactivate" && !target.is_active) problems.push({ field: "user", message: `${name} is already deactivated.` });
      // The endpoint refuses deleting yourself; deactivating yourself would lock you out.
      if (op === "Delete" && target.id === ctx.userId) problems.push({ field: "user", message: "You cannot delete your own account." });
      if (op === "Deactivate" && target.id === ctx.userId) problems.push({ field: "user", message: "SED AI won't deactivate your own account — you would be locked out." });
      if (op === "Change departments") {
        const add = idList(v.add_departments);
        const remove = idList(v.remove_departments);
        if (!add.length && !remove.length) problems.push({ field: "_", message: "Say which departments to add them to or take them out of." });
        else {
          const current = await departmentsOf(ctx, target.id);
          const next = nextDepartments(current, add, remove);
          if (sameSet(current, next)) problems.push({ field: "_", message: `That changes nothing — ${name}'s departments are already like that.` });
          else if (!next.length) warnings.push(`${name} will be in no department, so they lose every permission that comes from one.`);
          if (adminDept && add.includes(adminDept) && !current.includes(adminDept)) warnings.push("The Admin department can do everything in the app.");
          if (adminDept && target.id === ctx.userId && current.includes(adminDept) && !next.includes(adminDept)) {
            warnings.push("You are taking yourself out of Admin — you may lose access to this.");
          }
        }
      }
    }
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    const op = userOp(v);
    if (!op) return {};
    if (op === "Create") {
      const names = await departmentNames(ctx, idList(v.departments));
      return {
        title: `Create an account for ${str(v.full_name)}`,
        notes: [
          "They can't sign in until you set their first password on their page (Admin → Users) — SED AI never sees or sets passwords.",
          `What they can do comes from ${[...names.values()].join(", ") || "their departments"}.`,
        ],
        link: { href: "/admin/users", label: "Open Users" },
      };
    }
    const p = await personOf(ctx, v.user);
    if (!p) return { title: `${op} — the account from ${str(v.user)}`, fields: [] };
    const name = nameOf(p);
    const current = await departmentsOf(ctx, p.id);
    const before: UserBefore = { is_active: p.is_active, username: p.username, departmentIds: current };
    const base = { fields: [], link: userLink(p.id), before };
    switch (op) {
      case "Activate":
        return { ...base, title: `Activate ${name}`, changes: [{ label: "Account", from: "Deactivated", to: "Active" }], notes: ["They can sign in again."] };
      case "Deactivate": {
        const leads = await leadCount(ctx, p.id);
        return {
          ...base,
          title: `Deactivate ${name}`,
          changes: [{ label: "Account", from: "Active", to: "Deactivated" }],
          notes: ["They are signed out and can't sign in until someone activates them again."],
          warnings: leads ? [`${plural(leads, "lead")} stay assigned to them — reassign them if someone else should follow up.`] : undefined,
          confirmPhrase: name,
        };
      }
      case "Change departments": {
        const next = nextDepartments(current, idList(v.add_departments), idList(v.remove_departments));
        const names = await departmentNames(ctx, [...current, ...next]);
        const show = (list: string[]) => list.map((d) => names.get(d) ?? "?").join(", ") || "none";
        return {
          ...base,
          title: `Change ${name}'s departments`,
          changes: [{ label: "Departments", from: show(current), to: show(next) }],
          notes: ["What they can do follows their departments."],
          confirmPhrase: name,
        };
      }
      case "Change username":
        return {
          ...base,
          title: `Change ${name}'s username`,
          changes: [{ label: "Username", from: p.username ? `@${p.username}` : "—", to: `@${str(v.username)}` }],
          notes: ["They sign in with the new username from now on — tell them."],
        };
      case "Delete": {
        const leads = await leadCount(ctx, p.id);
        return {
          ...base,
          title: `Delete ${name}'s account`,
          link: { href: "/admin/users", label: "Open Users" },
          warnings: [
            "Deleting is permanent: the account, its department memberships and permission overrides are removed.",
            ...(leads ? [`Their ${plural(leads, "lead")} become unassigned.`] : []),
          ],
          notes: ["To only stop them signing in, deactivate the account instead."],
          confirmPhrase: name,
        };
      }
    }
  },
  async stale(before, v, ctx) {
    if (isCreate(v)) return null;
    const p = await personOf(ctx, v.user);
    if (!p) return "that account no longer exists.";
    const b = before as UserBefore | null;
    if (!b) return null;
    if (b.is_active !== p.is_active) return `the account was ${p.is_active ? "activated" : "deactivated"} in the meantime.`;
    if (v.operation === "Change username" && b.username !== p.username) return "their username was changed in the meantime.";
    if (v.operation === "Change departments" && !sameSet(b.departmentIds, await departmentsOf(ctx, p.id))) return "their departments were changed in the meantime.";
    return null;
  },
  async execute(v, ctx) {
    const op = userOp(v);
    if (op === "Create") {
      const display = str(v.display_name);
      const res = await callRoute<{ id: string }>(usersRoute, "POST", {
        path: "/api/admin/users",
        body: {
          email: v.email,
          username: v.username,
          fullName: str(v.full_name),
          displayName: display,
          tempPassword: unusablePassword(),
          departmentIds: idList(v.departments),
        },
      });
      return {
        message: `Created the account for ${display} (@${str(v.username)}). They can't sign in until a first password is set on their page: Admin → Users → ${display} → Reset password.`,
        link: userLink(res.id, "Set their password"),
        data: { id: res.id, kind: "user" },
        undoable: false,
      };
    }
    const id = str(v.user);
    const name = str(v.__name) || "the account";
    const path = `/api/admin/users/${id}`;
    switch (op) {
      case "Activate":
      case "Deactivate":
        await callRoute(userRoute, "PATCH", { path, params: { id }, body: { isActive: op === "Activate" } });
        return { message: `${name} is ${op === "Activate" ? "active again" : "deactivated"}.`, link: userLink(id), data: { id } };
      case "Change departments": {
        // The endpoint replaces the whole list: build it from the list as it is now.
        const next = nextDepartments(await departmentsOf(ctx, id), idList(v.add_departments), idList(v.remove_departments));
        await callRoute(userRoute, "PATCH", { path, params: { id }, body: { departmentIds: next } });
        return { message: `Updated ${name}'s departments.`, link: userLink(id), data: { id, departmentIds: next } };
      }
      case "Change username":
        await callRoute(userRoute, "PATCH", { path, params: { id }, body: { username: v.username } });
        return { message: `${name}'s username is now @${str(v.username)}.`, link: userLink(id), data: { id } };
      case "Delete":
        await callRoute(userRoute, "DELETE", { path, params: { id } });
        return { message: `Deleted ${name}'s account.`, link: { href: "/admin/users", label: "Open Users" }, data: { id }, undoable: false };
      default:
        throw refuse("Say which change to make.", 422);
    }
  },
  undo: {
    async run(stored) {
      const b = (stored.before_state ?? {}) as Partial<UserBefore>;
      const id = str(stored.input.user);
      const path = `/api/admin/users/${id}`;
      switch (stored.input.operation) {
        case "Activate":
        case "Deactivate":
          if (typeof b.is_active !== "boolean") throw refuse("The previous state is unknown.");
          await callRoute(userRoute, "PATCH", { path, params: { id }, body: { isActive: b.is_active } });
          return b.is_active ? "the account is active again." : "the account is deactivated again.";
        case "Change departments":
          if (!Array.isArray(b.departmentIds)) throw refuse("The previous departments are unknown.");
          await callRoute(userRoute, "PATCH", { path, params: { id }, body: { departmentIds: b.departmentIds } });
          return "their departments are as they were.";
        case "Change username":
          if (!b.username) throw refuse("They had no username before — set one in Admin → Users.");
          await callRoute(userRoute, "PATCH", { path, params: { id }, body: { username: b.username } });
          return `their username is @${b.username} again.`;
        default:
          throw refuse("This change can't be undone here.");
      }
    },
  },
};

/* ------------------------------------------------------------ perm.admin */

export interface PermissionInfo {
  key: string;
  name: string;
  sensitive: boolean;
}

/** Every grantable permission with its name as the admin screens show it (the catalogue + the per-status lead keys). */
const PERMISSION_CATALOGUE: PermissionInfo[] = [
  ...PERMISSIONS.map((p) => ({ key: p.key as string, name: p.name as string, sensitive: (p as { is_sensitive?: boolean }).is_sensitive === true })),
  ...LEAD_STATUSES.flatMap((s) => [
    { key: catViewKey(s), name: `View ${s} Leads`, sensitive: false },
    { key: catSetKey(s), name: `Set Lead to ${s}`, sensitive: false },
  ]),
].filter((p) => isKnownPermissionKey(p.key));

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The permission someone means — by its key or its human name ("Delete Users"). */
export function findPermission(input: string): { ok: true; perm: PermissionInfo } | { ok: false; message: string; choices?: string[] } {
  const q = input.trim();
  const sq = squash(q);
  if (!sq) return { ok: false, message: "Say which permission." };
  const exact = PERMISSION_CATALOGUE.find((p) => p.key === q.toLowerCase()) ?? PERMISSION_CATALOGUE.find((p) => squash(p.name) === sq || squash(p.key) === sq);
  if (exact) return { ok: true, perm: exact };
  const close = PERMISSION_CATALOGUE.filter((p) => squash(p.name).includes(sq) || squash(p.key).includes(sq));
  if (close.length === 1) return { ok: true, perm: close[0] };
  if (close.length > 1) {
    return { ok: false, message: `"${q}" matches ${close.length} permissions — which one?`, choices: close.slice(0, 8).map((p) => `${p.name} (${p.key})`) };
  }
  return { ok: false, message: `No permission is called "${q}". Use its name as on Admin → Permissions (e.g. "Delete Users") or its key.` };
}

const PERM_OPS = ["Grant", "Revoke", "Reset to department default"] as const;
type PermOp = (typeof PERM_OPS)[number];
const RESET: PermOp = "Reset to department default";

interface Override {
  is_granted: boolean;
  expires_at: string | null;
}

type PermBefore = { kind: "department"; granted: boolean } | { kind: "person"; override: Override | null };

async function departmentHas(ctx: ActionContext, departmentId: string, key: string): Promise<boolean> {
  const { data } = await ctx.admin.from("department_permissions").select("permission_key").eq("department_id", departmentId).eq("permission_key", key).maybeSingle();
  return Boolean(data);
}

async function overrideOf(ctx: ActionContext, userId: string, key: string): Promise<Override | null> {
  const { data } = await ctx.admin.from("user_permission_overrides").select("is_granted, expires_at").eq("user_id", userId).eq("permission_key", key).maybeSingle();
  return (data as Override | null) ?? null;
}

/** The person's departments that give `key`, by name. */
async function inheritedFrom(ctx: ActionContext, userId: string, key: string): Promise<string[]> {
  const depts = await departmentsOf(ctx, userId);
  if (!depts.length) return [];
  const { data } = await ctx.admin.from("department_permissions").select("department_id").eq("permission_key", key).in("department_id", depts);
  const giving = ((data ?? []) as { department_id: string }[]).map((r) => r.department_id);
  return [...(await departmentNames(ctx, giving)).values()];
}

/** An override that still applies (an expired one is ignored by the permission resolver). */
const live = (o: Override | null, now: Date): Override | null => (o && (!o.expires_at || Date.parse(o.expires_at) > now.getTime()) ? o : null);

const sameInstant = (a: string | null | undefined, b: string | null | undefined) => (!a && !b) || (Boolean(a) && Boolean(b) && Date.parse(a!) === Date.parse(b!));

/** "Until" a day = until that day ends in company time. */
export function endOfDay(ymd: string, tz: string): string {
  return new Date(zonedMidnightMs(addDays(ymd, 1), tz)).toISOString();
}

function personState(o: Override | null, inherited: string[], tz: string, now: Date): string {
  const until = o?.expires_at ? ` until ${formatDateTime(o.expires_at, tz, now)}` : "";
  if (o?.is_granted) return `Yes — personal grant${until}`;
  if (o) return `No — personal revoke${until}`;
  return inherited.length ? `Yes — through ${inherited.join(", ")}` : "No";
}

/**
 * The overrides endpoint takes no expiry, and its upsert keeps whatever
 * expires_at the row already had (an old, passed expiry makes a new grant a
 * dead letter). Once it has saved the override — its permission check passed —
 * the expiry is set to what the card said, on that one row.
 */
async function settleExpiry(ctx: ActionContext, userId: string, key: string, expiresAt: string | null): Promise<void> {
  const row = await overrideOf(ctx, userId, key);
  if (!row || sameInstant(row.expires_at, expiresAt)) return;
  const { error } = await ctx.admin.from("user_permission_overrides").update({ expires_at: expiresAt }).eq("user_id", userId).eq("permission_key", key);
  if (error) throw new Error(error.message);
  await ctx.admin.from("activity_log").insert({
    user_id: ctx.userId,
    action: "user.permission.expiry_set",
    entity_type: "user",
    entity_id: userId,
    new_value: { permissionKey: key, expires_at: expiresAt, via: "assistant" },
  });
}

const permOf = (v: Values): PermissionInfo => {
  const r = findPermission(str(v.permission));
  return r.ok ? r.perm : { key: str(v.permission), name: str(v.permission), sensitive: false };
};

const permAdmin: ActionDef = {
  key: "perm.admin",
  group: "Team & admin",
  title: "Grant or revoke a permission",
  description:
    "Give or take away one permission — for a whole department (like the department's permission grid) or for one person on top of their departments, optionally only until a date (a trial). \"Reset to department default\" removes a person's own grant or revoke. Name the permission as the admin screens do (\"Delete Users\", \"Create Lead\") or by its key.",
  confirmLabel: "Apply",
  risk: "critical",
  allowed: (ctx) => need(ctx, "admin.permissions.manage"),
  fields: [
    { name: "operation", label: "Change", type: "enum", options: PERM_OPS, required: true, editable: false, help: "Grant, Revoke, or (people only) Reset to department default." },
    { name: "permission", label: "Permission", type: "text", required: true, max: 120, editable: false, help: "Its name as on Admin → Permissions (\"Delete Users\") or its key (\"admin.users.delete\")." },
    { name: "department", label: "Department", type: "ref", ref: "department", editable: false, help: "For everyone in a department. Give a department OR a person." },
    {
      name: "user",
      label: "Person",
      type: "ref",
      ref: "user",
      editable: false,
      required: (v) => isBlank(v.department),
      help: "For one person (on top of their departments). Give a person OR a department.",
    },
    {
      name: "until",
      label: "Until (last day)",
      type: "date",
      future: true,
      editable: false,
      showIf: (v) => isBlank(v.department) && v.operation !== RESET,
      help: "People only, optional: the grant or revoke ends after this day (company time). Leave out for permanent.",
    },
  ],
  label: (v) => str(v.__target),
  minutesSaved: 1,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    const op = PERM_OPS.find((o) => o === v.operation) ?? null;
    let perm: PermissionInfo | null = null;
    if (typeof v.permission === "string") {
      const r = findPermission(v.permission);
      if (r.ok) {
        perm = r.perm;
        values.permission = r.perm.key;
      } else problems.push({ field: "permission", message: r.message, ...(r.choices ? { choices: r.choices } : {}) });
    }
    const dept = typeof v.department === "string" && !isStepRef(v.department) ? v.department : null;
    const user = typeof v.user === "string" && !isStepRef(v.user) ? v.user : null;
    if (typeof v.department === "string" && typeof v.user === "string") problems.push({ field: "user", message: "Give a department OR a person, not both." });
    if (typeof v.department === "string" && op === RESET) problems.push({ field: "operation", message: "A department has no personal grants to reset — use Grant or Revoke." });
    if (!perm || !op || problems.length) return { problems, warnings, values };

    if (dept) {
      const name = (await departmentNames(ctx, [dept])).get(dept) ?? "That department";
      values.__target = name;
      const has = await departmentHas(ctx, dept, perm.key);
      if (op === "Grant" && has) problems.push({ field: "permission", message: `${name} already has “${perm.name}”.` });
      if (op === "Revoke" && !has) problems.push({ field: "permission", message: `${name} does not have “${perm.name}” — nothing to revoke.` });
      if (op === "Revoke" && perm.key === "admin.permissions.manage" && (await departmentsOf(ctx, ctx.userId)).includes(dept)) {
        warnings.push("You are in this department: you may lose the ability to manage permissions yourself.");
      }
    }
    if (user) {
      const p = await personOf(ctx, user);
      if (!p) return { problems: [...problems, { field: "user", message: "That account no longer exists." }], warnings, values };
      const name = nameOf(p);
      values.__target = name;
      const ov = live(await overrideOf(ctx, user, perm.key), ctx.now);
      const inherited = await inheritedFrom(ctx, user, perm.key);
      const until = typeof v.until === "string" ? endOfDay(v.until, ctx.timezone) : null;
      if (op === "Grant" && ov?.is_granted && sameInstant(ov.expires_at, until)) problems.push({ field: "permission", message: `${name} already has a personal grant of “${perm.name}”.` });
      if (op === "Revoke" && ov && !ov.is_granted && sameInstant(ov.expires_at, until)) problems.push({ field: "permission", message: `“${perm.name}” is already revoked for ${name}.` });
      if (op === RESET && !ov) problems.push({ field: "permission", message: `${name} has no personal grant or revoke of “${perm.name}” — their departments already decide it.` });
      if (op === "Grant" && !ov && inherited.length && !until) warnings.push(`${name} already has it through ${inherited.join(", ")}; a personal grant keeps it even if they leave.`);
      if (op === "Revoke" && !ov && !inherited.length) warnings.push(`${name} doesn't have it now; a personal revoke also blocks it if a department gives it later.`);
      if (user === ctx.userId && perm.key === "admin.permissions.manage" && op !== "Grant") warnings.push("This is your own access to manage permissions.");
    }
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    const perm = permOf(v);
    const op = v.operation as PermOp;
    const label = `${perm.name} (${perm.key})`;
    const warnings = perm.sensitive ? [`“${perm.name}” is a sensitive permission.`] : [];
    if (typeof v.department === "string") {
      const id = v.department;
      const name = str(v.__target);
      const has = await departmentHas(ctx, id, perm.key);
      const { count } = await ctx.admin.from("department_members").select("user_id", { count: "exact", head: true }).eq("department_id", id);
      const before: PermBefore = { kind: "department", granted: has };
      return {
        title: op === "Grant" ? `Grant “${perm.name}” to ${name}` : `Revoke “${perm.name}” from ${name}`,
        fields: [],
        changes: [{ label, from: has ? "Yes" : "No", to: op === "Grant" ? "Yes" : "No" }],
        warnings,
        notes: [`Applies to everyone in ${name} (${plural(count ?? 0, "person", "people")}).`, ...(op === "Revoke" ? ["People with a personal grant keep it."] : [])],
        link: { href: `/admin/departments/${id}`, label: "Open department" },
        confirmPhrase: name,
        before,
      };
    }
    const id = str(v.user);
    const name = str(v.__target) || `the person from step ${id.slice(1)}`;
    const raw = isStepRef(id) ? null : await overrideOf(ctx, id, perm.key);
    const inherited = isStepRef(id) ? [] : await inheritedFrom(ctx, id, perm.key);
    const until = typeof v.until === "string" ? ` until the end of ${formatDate(v.until)}` : "";
    const after = op === "Grant" ? `Yes — personal grant${until}` : op === "Revoke" ? `No — personal revoke${until}` : inherited.length ? `Yes — through ${inherited.join(", ")}` : "No";
    const before: PermBefore = { kind: "person", override: raw };
    return {
      title:
        op === "Grant" ? `Give ${name} “${perm.name}”${until}` : op === "Revoke" ? `Take “${perm.name}” away from ${name}${until}` : `Reset ${name}'s “${perm.name}” to their departments`,
      fields: [],
      changes: [{ label, from: personState(live(raw, ctx.now), inherited, ctx.timezone, ctx.now), to: after }],
      warnings,
      notes: until ? [`It ends by itself after ${formatDate(str(v.until))} (${ctx.timezone}); then their departments decide again.`] : undefined,
      link: isStepRef(id) ? null : userLink(id),
      confirmPhrase: str(v.__target) || perm.name,
      before,
    };
  },
  async stale(before, v, ctx) {
    const b = before as PermBefore | null;
    if (!b) return null;
    const key = str(v.permission);
    if (b.kind === "department") return (await departmentHas(ctx, str(v.department), key)) === b.granted ? null : "the department's permissions were changed in the meantime.";
    const now = await overrideOf(ctx, str(v.user), key);
    const same = (!now && !b.override) || (now && b.override && now.is_granted === b.override.is_granted && sameInstant(now.expires_at, b.override.expires_at));
    return same ? null : "their permissions were changed in the meantime.";
  },
  async execute(v, ctx) {
    const perm = permOf(v);
    const op = v.operation as PermOp;
    const name = str(v.__target);
    if (typeof v.department === "string") {
      const id = v.department;
      await callRoute(deptPermissionsRoute, "POST", { path: `/api/admin/departments/${id}/permissions`, params: { id }, body: { permissionKey: perm.key, enabled: op === "Grant" } });
      return {
        message: op === "Grant" ? `${name} now has “${perm.name}”.` : `${name} no longer has “${perm.name}”.`,
        link: { href: `/admin/departments/${id}`, label: "Open department" },
        data: { id },
      };
    }
    const id = str(v.user);
    await callRoute(overridesRoute, "POST", {
      path: `/api/admin/users/${id}/overrides`,
      params: { id },
      body: { permissionKey: perm.key, isGranted: op === "Grant", remove: op === RESET },
    });
    if (op !== RESET) await settleExpiry(ctx, id, perm.key, typeof v.until === "string" ? endOfDay(v.until, ctx.timezone) : null);
    const until = typeof v.until === "string" ? ` until the end of ${formatDate(v.until)}` : "";
    const message =
      op === "Grant" ? `${name} now has “${perm.name}”${until}.` : op === "Revoke" ? `${name} no longer has “${perm.name}”${until}.` : `${name}'s departments decide “${perm.name}” again.`;
    return { message, link: userLink(id), data: { id } };
  },
  undo: {
    async run(stored, ctx) {
      const b = stored.before_state as PermBefore | null;
      const key = str(stored.input.permission);
      if (!b) throw refuse("The previous state is unknown.");
      if (b.kind === "department") {
        const id = str(stored.input.department);
        await callRoute(deptPermissionsRoute, "POST", { path: `/api/admin/departments/${id}/permissions`, params: { id }, body: { permissionKey: key, enabled: b.granted } });
        return b.granted ? "the department has it again." : "the department no longer has it.";
      }
      const id = str(stored.input.user);
      const path = `/api/admin/users/${id}/overrides`;
      if (!b.override) {
        await callRoute(overridesRoute, "POST", { path, params: { id }, body: { permissionKey: key, isGranted: false, remove: true } });
        return "their departments decide it again, as before.";
      }
      await callRoute(overridesRoute, "POST", { path, params: { id }, body: { permissionKey: key, isGranted: b.override.is_granted, remove: false } });
      await settleExpiry(ctx, id, key, b.override.expires_at);
      return "their previous personal setting is back.";
    },
  },
};

/* -------------------------------------------------------- settings.admin */

const AREAS = ["App settings", "Notification rule"] as const;
/** The notification-rules endpoint's department slugs, and its contextual roles. */
const RULE_DEPARTMENTS = ["sales", "management", "tech", "support", "admin"] as const;
const RULE_ROLES = ["lead_agent", "lead_closer", "ticket_assignee", "ticket_creator", "feedback_submitter", "mailbox_owner", "contract_creator"] as const;
const ROLE_LABEL: Record<string, string> = {
  lead_agent: "Lead agent",
  lead_closer: "Lead closer",
  ticket_assignee: "Ticket assignee",
  ticket_creator: "Ticket creator",
  feedback_submitter: "Feedback submitter",
  mailbox_owner: "Mailbox owner",
  contract_creator: "Contract creator",
};
const DEPARTMENT_LABEL = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

const APP_LABELS: Record<string, string> = {
  company_name: "Company name",
  work_start_time: "Work start time",
  work_timezone: "Company timezone",
  idle_timeout_minutes: "Idle timeout (minutes)",
  sla_low_hours: "Ticket SLA — Low (hours)",
  sla_normal_hours: "Ticket SLA — Normal (hours)",
  sla_high_hours: "Ticket SLA — High (hours)",
  ticket_retention_days: "Keep resolved tickets",
  form_sender: "Form Relay default sender",
};
const APP_FIELDS = Object.keys(APP_LABELS);
const RULE_FIELDS = ["event", "enabled", "add_departments", "remove_departments", "add_people", "remove_people", "add_roles", "remove_roles", "delay_minutes"];

const isGiven = (v: Values, names: string[]) => names.some((n) => !isBlank(v[n]));
/** While the area is not known yet, both kinds of field are kept. */
const forApp = (v: Values) => v.area !== "Notification rule";
const forRule = (v: Values) => v.area !== "App settings";

type EventMeta = (typeof NOTIFICATION_EVENTS)[number];
const eventOf = (key: unknown): EventMeta | undefined => NOTIFICATION_EVENTS.find((e) => e.key === key);

/** "9:30", "09:30", "9am", "6:15 pm" → "HH:MM" (24-hour), or null. */
export function clockTime(input: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?\s*m?\.?$/i.exec(input.trim());
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
  }
  return h > 23 || min > 59 ? null : `${pad(h)}:${pad(min)}`;
}

/** An IANA zone ("Asia/Karachi", any case) in its canonical spelling, or null. Abbreviations such as "EST" are not zones. */
export function ianaZone(input: string): string | null {
  const s = input.trim();
  if (!s.includes("/") && s.toUpperCase() !== "UTC") return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: s }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

interface AppRow {
  company_name: string;
  work_start_time: string;
  work_timezone: string;
  idle_timeout_minutes: number;
  ticket_sla: { Low?: number; Normal?: number; High?: number } | null;
  ticket_retention_days: number;
  form_default_mailbox_id: string | null;
  updated_at?: string | null;
}

/** The settings row, read like Admin → Settings (service role, behind admin.settings.manage) — fresh, not the 60s cache. */
async function appSettingsRow(ctx: ActionContext): Promise<AppRow | null> {
  const { data } = await ctx.admin
    .from("app_settings")
    .select("company_name, work_start_time, work_timezone, idle_timeout_minutes, ticket_sla, ticket_retention_days, form_default_mailbox_id, updated_at")
    .eq("singleton", true)
    .maybeSingle();
  return (data as AppRow | null) ?? null;
}

/** The settings as this action's fields. */
function flatSettings(row: AppRow): Values {
  const sla = row.ticket_sla ?? {};
  return {
    company_name: row.company_name,
    work_start_time: str(row.work_start_time).slice(0, 5), // a Postgres time reads "09:00:00"
    work_timezone: row.work_timezone,
    idle_timeout_minutes: row.idle_timeout_minutes,
    sla_low_hours: sla.Low ?? 168,
    sla_normal_hours: sla.Normal ?? 72,
    sla_high_hours: sla.High ?? 24,
    ticket_retention_days: row.ticket_retention_days ?? 0,
    form_sender: row.form_default_mailbox_id ?? null,
  };
}

const givenApp = (v: Values): Values => Object.fromEntries(APP_FIELDS.filter((f) => v[f] !== undefined && v[f] !== null).map((f) => [f, v[f]]));

/** The settings endpoint replaces the whole row: every field, current values plus the changes. */
function settingsBody(f: Values): Record<string, unknown> {
  return {
    work_start_time: f.work_start_time,
    work_timezone: f.work_timezone,
    idle_timeout_minutes: f.idle_timeout_minutes,
    ticket_sla: { Low: f.sla_low_hours, Normal: f.sla_normal_hours, High: f.sla_high_hours },
    ticket_retention_days: f.ticket_retention_days,
    company_name: f.company_name,
    form_default_mailbox_id: f.form_sender ?? null,
  };
}

/** Shortening retention deletes resolved tickets (the maintenance sweep purges past it, for good). */
const cutsRetention = (from: number, to: number) => to > 0 && (from === 0 || to < from);

interface RuleState {
  enabled: boolean;
  target_departments: string[];
  target_users: string[];
  target_roles: string[];
  delay_minutes: number;
}

/**
 * A rule as the endpoint will accept it back: department names as slugs
 * ("Admin" → "admin"), and only departments and roles the endpoint allows for
 * this event (anything else is listed in `dropped`). No row = never set up.
 */
async function ruleOf(ctx: ActionContext, event: EventMeta): Promise<{ state: RuleState; exists: boolean; updated_at: string | null; dropped: string[] }> {
  const { data } = await ctx.admin
    .from("notification_rules")
    .select("enabled, target_departments, target_users, target_roles, delay_minutes, updated_at")
    .eq("event_key", event.key)
    .maybeSingle();
  const row = data as (Partial<RuleState> & { updated_at?: string | null }) | null;
  const depts = departmentSlugs(row?.target_departments ?? []);
  const roles = row?.target_roles ?? [];
  const okDept = (d: string) => (RULE_DEPARTMENTS as readonly string[]).includes(d);
  const okRole = (r: string) => (event.availableRoles as readonly string[]).includes(r);
  return {
    // Like the Notification Rules screen: a rule never set up starts switched on.
    state: {
      enabled: row?.enabled ?? true,
      target_departments: depts.filter(okDept),
      target_users: row?.target_users ?? [],
      target_roles: roles.filter(okRole),
      delay_minutes: row?.delay_minutes ?? 0,
    },
    exists: Boolean(row),
    updated_at: row?.updated_at ?? null,
    dropped: [...depts.filter((d) => !okDept(d)), ...roles.filter((r) => !okRole(r))],
  };
}

function nextRule(s: RuleState, v: Values): RuleState {
  const edit = (list: string[], add: unknown, remove: unknown) => {
    const out = list.filter((x) => !idList(remove).includes(x));
    for (const a of idList(add)) if (!out.includes(a)) out.push(a);
    return out;
  };
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : s.enabled,
    target_departments: edit(s.target_departments, v.add_departments, v.remove_departments),
    target_users: edit(s.target_users, v.add_people, v.remove_people),
    target_roles: edit(s.target_roles, v.add_roles, v.remove_roles),
    delay_minutes: typeof v.delay_minutes === "number" ? v.delay_minutes : s.delay_minutes,
  };
}

const sameRule = (a: RuleState, b: RuleState) =>
  a.enabled === b.enabled &&
  sameSet(a.target_departments, b.target_departments) &&
  sameSet(a.target_users, b.target_users) &&
  sameSet(a.target_roles, b.target_roles) &&
  a.delay_minutes === b.delay_minutes;

type SettingsBefore =
  | { area: "app"; flat: Values; updated_at: string | null }
  | { area: "rule"; event: string; state: RuleState; exists: boolean; updated_at: string | null };

async function displayNames(ctx: ActionContext, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await ctx.admin.from("profiles").select("id, display_name, email").in("id", [...new Set(ids)]);
  return new Map(((data ?? []) as Person[]).map((p) => [p.id, nameOf(p)]));
}

const EVENT_HELP = NOTIFICATION_EVENTS.map((e) => `${e.key} = ${e.label}`).join("; ");

const holdsSettingsPermission = (ctx: ActionContext) => ctx.perms.has("admin.settings.manage") || ctx.perms.has("admin.notifications.manage");

const settingsAdmin: ActionDef = {
  key: "settings.admin",
  group: "Team & admin",
  title: "Change app settings or a notification rule",
  description:
    "Admin settings. App settings (Admin → Settings): company name, work start time, company timezone, idle timeout, ticket SLA hours, how long resolved tickets are kept, the Form Relay default sender. Or one notification rule (Admin → Notifications): switch an event's notification on or off, add or remove the departments, people or roles it goes to, or its delay. Only the values given change. Never credentials or API keys.",
  confirmLabel: "Save settings",
  risk: (v) => (v.__retention_cut === true ? "critical" : "sensitive"),
  allowed: (ctx) => (holdsSettingsPermission(ctx) ? null : need(ctx, "admin.settings.manage")),
  fields: [
    {
      name: "area",
      label: "What",
      type: "enum",
      options: AREAS,
      required: true,
      editable: false,
      // Worked out from the fields given, when they are all of one kind.
      default: (_ctx: ActionContext, v: Values) =>
        isGiven(v, RULE_FIELDS) && !isGiven(v, APP_FIELDS) ? "Notification rule" : isGiven(v, APP_FIELDS) && !isGiven(v, RULE_FIELDS) ? "App settings" : undefined,
      help: "App settings, or a Notification rule.",
    },
    { name: "company_name", label: "Company name", type: "text", max: 80, showIf: forApp },
    { name: "work_start_time", label: "Work start time", type: "text", max: 10, showIf: forApp, help: "HH:MM, 24-hour (09:00)." },
    { name: "work_timezone", label: "Company timezone", type: "text", max: 60, showIf: forApp, help: "An IANA timezone, e.g. Asia/Karachi or America/New_York." },
    { name: "idle_timeout_minutes", label: "Idle timeout (minutes)", type: "integer", min: 1, showIf: forApp },
    { name: "sla_low_hours", label: "Ticket SLA — Low (hours)", type: "integer", min: 1, showIf: forApp },
    { name: "sla_normal_hours", label: "Ticket SLA — Normal (hours)", type: "integer", min: 1, showIf: forApp },
    { name: "sla_high_hours", label: "Ticket SLA — High (hours)", type: "integer", min: 1, showIf: forApp },
    {
      name: "ticket_retention_days",
      label: "Keep resolved tickets (days)",
      type: "integer",
      min: 0,
      editable: false,
      showIf: forApp,
      help: "Resolved tickets older than this are deleted for good by the nightly cleanup; 0 = keep forever.",
    },
    { name: "form_sender", label: "Form Relay default sender", type: "ref", ref: "mailbox", editable: false, showIf: forApp, help: "A verified company mailbox." },
    { name: "event", label: "Event", type: "enum", options: NOTIFICATION_EVENTS.map((e) => e.key), required: (v) => v.area === "Notification rule", editable: false, showIf: forRule, help: `Which notification: ${EVENT_HELP}.` },
    { name: "enabled", label: "Notification on", type: "boolean", showIf: forRule, help: "true to switch the notification on, false to switch it off." },
    { name: "add_departments", label: "Also notify departments", type: "multi", options: RULE_DEPARTMENTS, showIf: forRule },
    { name: "remove_departments", label: "Stop notifying departments", type: "multi", options: RULE_DEPARTMENTS, showIf: forRule },
    { name: "add_people", label: "Also notify people", type: "refs", ref: "user", refFilter: "active", showIf: forRule },
    { name: "remove_people", label: "Stop notifying people", type: "refs", ref: "user", showIf: forRule },
    {
      name: "add_roles",
      label: "Also notify roles",
      type: "multi",
      options: RULE_ROLES,
      showIf: forRule,
      help: "Who the record belongs to: lead_agent, lead_closer, ticket_assignee, ticket_creator, feedback_submitter, mailbox_owner, contract_creator — only those the event offers.",
    },
    { name: "remove_roles", label: "Stop notifying roles", type: "multi", options: RULE_ROLES, showIf: forRule },
    { name: "delay_minutes", label: "Delay (minutes)", type: "integer", min: 0, showIf: forRule, help: "Minutes to wait before notifying. For the follow-up reminder: minutes BEFORE the follow-up." },
  ],
  label: (v) => (v.area === "Notification rule" ? (eventOf(v.event)?.label ?? "notification rule") : "app settings"),
  minutesSaved: 2,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    // Someone with neither permission is sent to an approver by `allowed`;
    // someone with the other one is told which this change needs.
    const own = holdsSettingsPermission(ctx);
    if (v.area === "App settings") {
      const reason = own ? need(ctx, "admin.settings.manage") : null;
      if (reason) return { problems: [{ field: "area", message: reason }] };
      if (!isGiven(v, APP_FIELDS)) problems.push({ field: "_", message: "Say which setting to change, and to what." });
      if (typeof v.work_start_time === "string") {
        const t = clockTime(v.work_start_time);
        if (t) values.work_start_time = t;
        else problems.push({ field: "work_start_time", message: "The work start time must be a time like 09:00." });
      }
      if (typeof v.work_timezone === "string") {
        const z = ianaZone(v.work_timezone);
        if (z) values.work_timezone = z;
        else problems.push({ field: "work_timezone", message: "That is not a timezone — use a name like Asia/Karachi or America/New_York." });
      }
      if (typeof v.form_sender === "string") {
        const { data } = await ctx.admin.from("company_mailboxes").select("status").eq("id", v.form_sender).maybeSingle();
        if ((data as { status?: string } | null)?.status !== "verified") problems.push({ field: "form_sender", message: "Only a verified mailbox can send — verify it under Company Mail first." });
      }
      const row = await appSettingsRow(ctx);
      if (!row) return { problems: [...problems, { field: "_", message: "The app settings are not set up yet — open Admin → Settings once first." }] };
      const cur = flatSettings(row);
      const next = { ...cur, ...givenApp({ ...v, ...values }) };
      if (isGiven(v, APP_FIELDS) && !problems.length && APP_FIELDS.every((f) => displayValue(cur[f]) === displayValue(next[f]))) {
        problems.push({ field: "_", message: "Those settings already have those values." });
      }
      if (cutsRetention(Number(cur.ticket_retention_days), Number(next.ticket_retention_days))) values.__retention_cut = true;
      return { problems, warnings, values };
    }

    if (v.area !== "Notification rule") return {};
    const reason = own ? need(ctx, "admin.notifications.manage") : null;
    if (reason) return { problems: [{ field: "area", message: reason }] };
    if (!isGiven(v, RULE_FIELDS.filter((f) => f !== "event"))) problems.push({ field: "_", message: "Say what to change on the rule: on/off, who it goes to, or its delay." });
    const event = eventOf(v.event);
    if (!event) return { problems, warnings, values };
    const offered = event.availableRoles as readonly string[];
    const badRoles = idList(v.add_roles).filter((r) => !offered.includes(r));
    if (badRoles.length) {
      problems.push({
        field: "add_roles",
        message: `“${event.label}” can't go to ${badRoles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}${offered.length ? ` — it offers ${offered.map((r) => ROLE_LABEL[r] ?? r).join(", ")}` : " — it has no roles"}.`,
      });
    }
    if (typeof v.delay_minutes === "number" && event.timingMode === "none") warnings.push(`“${event.label}” is normally sent right away; the Notification Rules screen does not offer a delay for it.`);
    const current = await ruleOf(ctx, event);
    if (!problems.length && current.exists && sameRule(current.state, nextRule(current.state, v))) problems.push({ field: "_", message: "That is already how the rule is set." });
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    if (v.area === "App settings") {
      const row = await appSettingsRow(ctx);
      const cur = row ? flatSettings(row) : {};
      const after = givenApp(v);
      const mailboxIds = [cur.form_sender, after.form_sender].filter((x): x is string => typeof x === "string");
      const { data: boxes } = mailboxIds.length ? await ctx.admin.from("company_mailboxes").select("id, email_address").in("id", mailboxIds) : { data: [] };
      const emails = new Map(((boxes ?? []) as { id: string; email_address: string }[]).map((b) => [b.id, b.email_address]));
      const show = (field: string, val: unknown) =>
        field === "ticket_retention_days" ? (val === 0 ? "Forever" : val === undefined || val === null ? "" : `${val} days`) : field === "form_sender" ? (typeof val === "string" ? (emails.get(val) ?? "a mailbox") : "") : displayValue(val);
      const warnings: string[] = [];
      const days = Number(after.ticket_retention_days);
      if (v.__retention_cut === true) {
        const cutoff = new Date(ctx.now.getTime() - days * 86_400_000).toISOString();
        const { count } = await ctx.admin.from("lead_tickets").select("id", { count: "exact", head: true }).eq("status", "Resolved").lt("resolved_at", cutoff);
        warnings.push(`Resolved tickets older than ${days} days are deleted for good by the nightly cleanup${count ? ` — ${plural(count, "ticket")} right now` : ""}. They can't be restored.`);
      }
      if (after.work_timezone !== undefined) warnings.push("Day boundaries for reports, lateness and reminders move to the new timezone.");
      return {
        title: "Change app settings",
        fields: [],
        changes: changesOf(cur, after, APP_LABELS, show),
        warnings,
        notes: ["Applies to everyone in the app."],
        link: { href: "/admin/settings", label: "Open Settings" },
        confirmPhrase: v.__retention_cut === true ? `keep ${days} days` : undefined,
        before: { area: "app", flat: cur, updated_at: row?.updated_at ?? null } satisfies SettingsBefore,
      };
    }
    const event = eventOf(v.event)!;
    const r = await ruleOf(ctx, event);
    const next = nextRule(r.state, v);
    const names = await displayNames(ctx, [...r.state.target_users, ...next.target_users]);
    const list = (xs: string[], label: (x: string) => string) => xs.map(label).join(", ") || "—";
    const before = { ...r.state, enabled: r.exists && r.state.enabled };
    const changes: CardChange[] = [];
    const push = (label: string, from: string, to: string) => from !== to && changes.push({ label, from, to });
    push("Notification", r.exists ? (before.enabled ? "On" : "Off") : "Off (never set up)", next.enabled ? "On" : "Off");
    push("Departments", list(before.target_departments, DEPARTMENT_LABEL), list(next.target_departments, DEPARTMENT_LABEL));
    push("People", list(before.target_users, (id) => names.get(id) ?? "someone"), list(next.target_users, (id) => names.get(id) ?? "someone"));
    push("Roles", list(before.target_roles, (x) => ROLE_LABEL[x] ?? x), list(next.target_roles, (x) => ROLE_LABEL[x] ?? x));
    push(event.timingMode === "lead_time" ? "Minutes before" : "Delay (minutes)", String(before.delay_minutes), String(next.delay_minutes));
    return {
      title: `Notification rule — ${event.label}`,
      fields: [],
      changes,
      warnings: r.dropped.length ? [`The rule also named ${r.dropped.join(", ")}, which this event can't use; saving drops them.`] : undefined,
      notes: [event.description, "Applies to notifications from now on."],
      link: { href: "/admin/notifications", label: "Open notification rules" },
      before: { area: "rule", event: event.key, state: r.state, exists: r.exists, updated_at: r.updated_at } satisfies SettingsBefore,
    };
  },
  async stale(before, _v, ctx) {
    const b = before as SettingsBefore | null;
    if (!b) return null;
    if (b.area === "app") {
      const row = await appSettingsRow(ctx);
      return (row?.updated_at ?? null) === b.updated_at ? null : "the settings were changed by someone else after this was proposed.";
    }
    const event = eventOf(b.event);
    if (!event) return "that event no longer exists.";
    return (await ruleOf(ctx, event)).updated_at === b.updated_at ? null : "the rule was changed by someone else after this was proposed.";
  },
  async execute(v, ctx) {
    if (v.area === "App settings") {
      const row = await appSettingsRow(ctx);
      if (!row) throw refuse("The app settings could not be read.", 500);
      const next = { ...flatSettings(row), ...givenApp(v) };
      await callRoute(settingsRoute, "PUT", { path: "/api/admin/settings", body: settingsBody(next) });
      const what = Object.keys(givenApp(v)).map((f) => APP_LABELS[f].toLowerCase());
      return { message: `Saved the app settings (${what.join(", ")}).`, link: { href: "/admin/settings", label: "Open Settings" }, data: { fields: Object.keys(givenApp(v)) } };
    }
    const event = eventOf(v.event);
    if (!event) throw refuse("Say which notification rule to change.", 422);
    const next = nextRule((await ruleOf(ctx, event)).state, v);
    await callRoute(ruleRoute, "PUT", { path: `/api/admin/notification-rules/${event.key}`, params: { eventKey: event.key }, body: next });
    return { message: `Updated the “${event.label}” notification rule.`, link: { href: "/admin/notifications", label: "Open notification rules" }, data: { event: event.key } };
  },
  undo: {
    async run(stored, ctx) {
      const b = stored.before_state as SettingsBefore | null;
      if (!b) throw refuse("The previous settings are unknown.");
      const input = stored.input;
      if (b.area === "app") {
        const row = await appSettingsRow(ctx);
        if (!row) throw refuse("The app settings could not be read.", 500);
        // Only what this change touched goes back; anything changed since stays.
        const restored = { ...flatSettings(row), ...Object.fromEntries(Object.keys(givenApp(input)).map((f) => [f, b.flat[f] ?? null])) };
        await callRoute(settingsRoute, "PUT", { path: "/api/admin/settings", body: settingsBody(restored) });
        return "the previous settings are back.";
      }
      const event = eventOf(b.event);
      if (!event) throw refuse("That event no longer exists.");
      const now = (await ruleOf(ctx, event)).state;
      const touched = (...names: string[]) => isGiven(input, names);
      // A rule that had never been set up sent nothing: switched off is the same.
      const prev: RuleState = b.exists ? b.state : { enabled: false, target_departments: [], target_users: [], target_roles: [], delay_minutes: 0 };
      const restored: RuleState = {
        enabled: touched("enabled") || !b.exists ? prev.enabled : now.enabled,
        target_departments: touched("add_departments", "remove_departments") ? prev.target_departments : now.target_departments,
        target_users: touched("add_people", "remove_people") ? prev.target_users : now.target_users,
        target_roles: touched("add_roles", "remove_roles") ? prev.target_roles : now.target_roles,
        delay_minutes: touched("delay_minutes") ? prev.delay_minutes : now.delay_minutes,
      };
      await callRoute(ruleRoute, "PUT", { path: `/api/admin/notification-rules/${event.key}`, params: { eventKey: event.key }, body: restored });
      return "the rule is as it was.";
    },
  },
};

export const ADMIN_ACTIONS: ActionDef[] = [importSheet, userAdmin, permAdmin, settingsAdmin];
