import { randomUUID } from "node:crypto";
import type { ActionCard, ActionRisk } from "./card";
import { cardFields, describeFields, isBlank, isCardEditable, missingFields, normalizeFields, normalizeValue, optionsOf, STEP_REF_RE, type Normalized } from "./fields";
import { ActionFailure } from "./errors";
import { RouteError } from "./invoke";
import { bell, usersWithPermission } from "./people";
import { getActionDef } from "./registry";
import { getAction, getActionSettings, insertAction, listPlan, toCard, transition, updateAction } from "./store";
import type { ActionContext, ActionDef, CheckResult, PrepareOutcome, Problem, StoredAction, Values } from "./types";

/**
 * The life of an action: prepared from what the model gathered, proposed as a
 * card, confirmed (or edited, cancelled, sent for approval), executed as the
 * person who confirmed it, and — for a while — undone. SERVER ONLY.
 *
 * NOTHING CHANGES WITHOUT A PERSON. The model can only PREPARE: it never
 * executes. Execution starts from a Confirm press in the app (or a reply on
 * a linked phone), on a proposal stored here, re-checked at that moment.
 */

/** Unconfirmed proposals stop being confirmable after this. */
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
/** A request waiting on an approver stays open for three days. */
const APPROVAL_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const DEFAULT_UNDO_MINUTES = 10;

export interface PrepareInput {
  key: string;
  fields: Values;
  ctx: ActionContext;
  conversationId: string | null;
  turnId: string | null;
  callId: string | null;
  source: StoredAction["source"];
  /** One step of a multi-step plan. */
  plan?: { id: string; index: number; total: number; title: string };
  /** A previous proposal this one corrects — it is withdrawn. */
  replaces?: string | null;
}

export function riskOf(def: ActionDef, v: Values): ActionRisk {
  return typeof def.risk === "function" ? def.risk(v) : def.risk;
}

function labelOf(def: ActionDef, v: Values): string {
  try {
    return (def.label?.(v) ?? "").trim();
  } catch {
    return "";
  }
}

/** What stands between this person and doing it themselves: null, or the reason an approver is needed. */
export async function approvalReason(def: ActionDef, ctx: ActionContext): Promise<string | null> {
  const settings = await getActionSettings(ctx.admin);
  if (settings.get(def.key)?.require_approval && !def.selfOnly) return "An admin has asked that this action is approved before it runs.";
  return def.allowed(ctx);
}

async function checkAll(def: ActionDef, values: Values, ctx: ActionContext, complete: boolean) {
  if (!def.check) return { problems: [] as Problem[], warnings: [] as string[], values: {} as Values };
  const r: CheckResult = (await def.check(values, ctx).catch((e): CheckResult => {
    console.error(`[assistant] check for ${def.key} failed:`, e);
    // A high-impact change (money, deletion, access) is never proposed on
    // checks that could not run: the person would confirm unverified facts.
    if (def.strictCheck || riskOf(def, values) === "critical") {
      return { problems: [{ field: "_", message: e instanceof ActionFailure ? e.message : "Could not check this right now — try again in a moment." }] };
    }
    return { warnings: ["Some checks could not run right now."] };
  })) ?? { problems: [], warnings: [] };
  // While fields are still missing, only problems about what IS there count.
  const problems = (r.problems ?? []).filter((p) => complete || !isBlank(values[p.field]) || p.field === "_");
  return { problems, warnings: r.warnings ?? [], values: r.values ?? {} };
}

/**
 * Run the action's check, and take in what it worked out: values it filled
 * (a receipt's bill-to from its lead) count as given — they are not asked
 * for — and read on the card like any other. When filling them completed the
 * action, the check runs once more on the complete set, so its cross-field
 * rules apply in full.
 */
async function checkAndFill(def: ActionDef, n: Normalized, ctx: ActionContext) {
  let missing = missingFields(def, n.values, n.problems);
  let checked = await checkAll(def, n.values, ctx, missing.length === 0 && n.problems.length === 0);
  if (Object.keys(checked.values).length) {
    const wasIncomplete = missing.length > 0;
    await takeIn(def, n, checked.values, ctx);
    missing = missingFields(def, n.values, n.problems);
    if (wasIncomplete && !missing.length && !n.problems.length) {
      checked = await checkAll(def, n.values, ctx, true);
      await takeIn(def, n, checked.values, ctx);
    }
  }
  return { missing, checked };
}

async function takeIn(def: ActionDef, n: Normalized, extra: Values, ctx: ActionContext) {
  for (const [k, v] of Object.entries(extra)) {
    const spec = def.fields.find((f) => f.name === k);
    if (!spec || isBlank(v)) {
      n.values[k] = v;
      continue;
    }
    const one = await normalizeValue(spec, v, ctx);
    n.values[k] = "problem" in one ? v : one.value;
    n.display[k] = "problem" in one ? String(v) : one.display;
  }
}

/**
 * Turn what the model gathered into a proposal — or tell it exactly what is
 * still missing or wrong. Never executes anything.
 */
export async function prepareAction(input: PrepareInput): Promise<PrepareOutcome> {
  const { ctx } = input;
  const def = getActionDef(input.key);
  if (!def) return { kind: "unknown", message: `There is no action "${input.key}". Pick one from the list of actions.` };
  const settings = await getActionSettings(ctx.admin);
  if (settings.get(def.key)?.enabled === false) {
    return { kind: "disabled", message: `An admin has switched off "${def.title}" for SED AI. The person can still do it in the app.` };
  }
  if (def.selfOnly) {
    const blocked = def.allowed(ctx);
    if (blocked) return { kind: "disabled", message: `${blocked} This one only changes the person's own things, so it can't be sent to an admin for approval either.` };
  }

  const n = await normalizeFields(def, input.fields ?? {}, ctx, { stepRefs: Boolean(input.plan) });
  const { missing, checked } = await checkAndFill(def, n, ctx);
  const problems = [...n.problems, ...checked.problems];

  if (missing.length || problems.length) {
    const understood: Record<string, string> = {};
    for (const f of def.fields) if (n.display[f.name] !== undefined && !f.hidden) understood[f.label] = n.display[f.name];
    return {
      kind: "needs_input",
      missing: await Promise.all(
        missing.map(async (f) => {
          const options = f.type === "enum" || f.type === "multi" ? await optionsOf(f, ctx) : undefined;
          return { field: f.name, label: f.label, ...(f.help ? { help: f.help } : {}), ...(options && options.length <= 15 ? { options } : {}) };
        }),
      ),
      problems,
      warnings: checked.warnings,
      understood,
    };
  }

  const preview = def.preview ? await def.preview(n.values, ctx) : {};
  const risk = riskOf(def, n.values);
  const label = labelOf(def, n.values);
  const title = (preview.title ?? `${def.title}${label ? ` — ${label}` : ""}`).slice(0, 300);
  const needsApproval = await approvalReason(def, ctx);
  const fields = preview.fields ?? (await cardFields(def, n, ctx));
  const card: Partial<ActionCard> = {
    group: def.group,
    confirmLabel: def.confirmLabel,
    fields,
    changes: preview.changes,
    items: preview.items,
    warnings: [...checked.warnings, ...(preview.warnings ?? [])],
    notes: preview.notes,
    link: preview.link ?? null,
    approval: needsApproval ? { reason: needsApproval } : null,
    plan: input.plan ? { id: input.plan.id, index: input.plan.index, total: input.plan.total, title: input.plan.title } : null,
  };
  const phrase = risk === "critical" ? (preview.confirmPhrase ?? label ?? "CONFIRM").slice(0, 80) || "CONFIRM" : null;

  if (input.replaces) {
    const old = await getAction(ctx.admin, input.replaces).catch(() => null);
    if (old && old.user_id === ctx.userId) {
      await transition(ctx.admin, old.id, ["proposed"], { status: "cancelled", error: "Replaced by a corrected proposal." }).catch(() => null);
    }
  }

  const row = await insertAction(ctx.admin, {
    user_id: ctx.userId,
    conversation_id: input.conversationId,
    turn_id: input.turnId,
    tool_call_id: input.callId,
    plan_id: input.plan?.id ?? null,
    plan_index: input.plan?.index ?? null,
    plan_title: input.plan?.title ?? null,
    action_key: def.key,
    title,
    risk,
    input: n.values,
    card,
    before_state: preview.before ?? null,
    confirm_phrase: phrase,
    status: "proposed",
    source: input.source,
    expires_at: new Date(ctx.now.getTime() + PROPOSAL_TTL_MS).toISOString(),
  });
  return { kind: "proposed", card: toCard(row), needsApproval: Boolean(needsApproval) };
}

/** describe_action for the model. */
export async function describeAction(key: string, ctx: ActionContext) {
  const def = getActionDef(key);
  if (!def) return null;
  const needsApproval = await approvalReason(def, ctx);
  return {
    action: def.key,
    title: def.title,
    what_it_does: def.description,
    risk: typeof def.risk === "function" ? "depends on the values" : def.risk,
    ...(needsApproval ? { needs_approval: needsApproval } : {}),
    ...(def.undo ? { undo: `can be undone for ${def.undo.minutes ?? DEFAULT_UNDO_MINUTES} minutes` } : {}),
    fields: await describeFields(def, ctx),
  };
}

export { ActionFailure };

export interface ConfirmInput {
  id: string;
  ctx: ActionContext;
  origin: string;
  /** Values changed on the card: field → editor value. */
  edits?: Record<string, unknown>;
  /** Bulk: the records still ticked. */
  selected?: string[];
  /** Critical: the typed phrase. */
  phrase?: string;
  /** An approver running someone else's request. */
  asApprover?: { note?: string | null };
}

/** Earlier plan steps' records, for "@N" references. */
async function substituteStepRefs(def: ActionDef, raw: Values, row: StoredAction, ctx: ActionContext): Promise<Values> {
  if (!row.plan_id) return raw;
  const refFields = def.fields.filter((f) => f.type === "ref" && typeof raw[f.name] === "string" && STEP_REF_RE.test(String(raw[f.name])));
  if (!refFields.length) return raw;
  const steps = await listPlan(ctx.admin, row.plan_id);
  const out = { ...raw };
  for (const f of refFields) {
    const n = Number(String(raw[f.name]).slice(1));
    const step = steps.find((s) => s.plan_index === n);
    const id = step?.result?.data?.id;
    if (!step || step.status !== "done" || typeof id !== "string") {
      throw new ActionFailure(`Step ${n} has to be done first — this step uses what it creates.`, 409);
    }
    out[f.name] = id;
  }
  return out;
}

/**
 * Confirm a proposal: re-check everything as of now, then make the change as
 * the person confirming. Returns the updated card; throws ActionFailure with
 * what to fix.
 */
const RISK_RANK: Record<ActionRisk, number> = { standard: 0, sensitive: 1, critical: 2 };

export async function confirmAction(input: ConfirmInput): Promise<ActionCard> {
  const row = await getAction(input.ctx.admin, input.id);
  // An approver runs it with their own permissions, but the requester's own
  // things (the files they attached) stay theirs.
  const ctx: ActionContext = row && input.asApprover ? { ...input.ctx, ownerId: row.user_id } : input.ctx;
  if (!row || (!input.asApprover && row.user_id !== ctx.userId)) throw new ActionFailure("That action was not found.", 404);
  const expectStatus = input.asApprover ? "awaiting_approval" : "proposed";
  if (row.status !== expectStatus) throw new ActionFailure(alreadyMessage(row), 409);
  if (Date.parse(row.expires_at) < ctx.now.getTime()) {
    await transition(ctx.admin, row.id, [expectStatus], { status: "expired" });
    throw new ActionFailure("This proposal has expired. Ask SED AI again for a fresh one.", 410);
  }
  const def = getActionDef(row.action_key);
  if (!def) throw new ActionFailure("This action no longer exists.", 410);
  const settings = await getActionSettings(ctx.admin);
  if (settings.get(def.key)?.enabled === false) throw new ActionFailure(`An admin has switched off "${def.title}" for SED AI.`, 403);

  if (input.asApprover) {
    // Approval means a second person: nobody approves their own request, and
    // what only concerns the requester's own things is never run by someone else.
    if (row.user_id === input.ctx.userId) throw new ActionFailure("You can't approve your own request — another admin has to.", 403);
    if (def.selfOnly) throw new ActionFailure("This only changes the requester's own things, so it can't be approved for them.", 403);
    const own = def.allowed(ctx);
    if (own) throw new ActionFailure(`You can't approve this: ${own}`, 403);
  } else {
    const reason = await approvalReason(def, ctx);
    if (reason) throw new ActionFailure(`${reason} Send it for approval instead.`, 403);
  }

  // Edits and the person's ticks are applied, then everything is checked
  // again as of NOW — a time that was in the future at proposal time may not
  // be any more, and the record may have moved on.
  let raw: Values = { ...(row.input ?? {}) };
  if (input.edits && !input.asApprover) {
    for (const [k, v] of Object.entries(input.edits)) {
      // Only what the card offered to edit: the rest is changed by asking again.
      const spec = def.fields.find((f) => f.name === k);
      if (!spec || !isCardEditable(spec)) continue;
      raw[k] = v;
    }
  }
  raw = await substituteStepRefs(def, raw, row, ctx);
  if (def.bulkField && input.selected) {
    const all = Array.isArray(raw[def.bulkField]) ? (raw[def.bulkField] as string[]) : [];
    const keep = all.filter((id) => input.selected!.includes(id));
    if (!keep.length) throw new ActionFailure("Tick at least one record, or cancel.", 422);
    raw[def.bulkField] = keep;
  }
  const n = await normalizeFields(def, raw, ctx);
  const { missing, checked } = await checkAndFill(def, n, ctx);
  const problems = [...n.problems, ...checked.problems, ...missing.map((f) => ({ field: f.name, message: `${f.label} is required.` }))];
  if (problems.length) throw new ActionFailure(problems.map((p) => p.message).join(" "), 422, problems);

  // What the person confirms is what the card showed at its level of care: an
  // edit may not turn it into a bigger change than the one proposed, and a
  // critical change (confirmed by typing its name) is never edited in place.
  if (input.edits && Object.keys(input.edits).length) {
    if (row.risk === "critical") throw new ActionFailure("A high-impact change can't be edited on its card. Ask SED AI to prepare it again with the change.", 422);
    if (RISK_RANK[riskOf(def, n.values)] > RISK_RANK[row.risk]) {
      throw new ActionFailure("That edit makes this a bigger change than the one proposed. Ask SED AI to prepare it again so you can review it.", 409);
    }
  }

  // High impact: whoever runs it — the requester or the approver — types its name.
  if (row.risk === "critical") {
    const typed = (input.phrase ?? "").trim().toLowerCase();
    if (!row.confirm_phrase || typed !== row.confirm_phrase.trim().toLowerCase()) {
      throw new ActionFailure(`Type "${row.confirm_phrase}" to confirm.`, 422);
    }
  }

  if (def.stale) {
    const reason = await def.stale(row.before_state, n.values, ctx).catch(() => null);
    if (reason) {
      await transition(ctx.admin, row.id, [expectStatus], { status: "failed", error: `Not changed: ${reason} Ask SED AI again for a fresh proposal.` });
      throw new ActionFailure(`Not changed: ${reason}`, 409);
    }
  }

  // Edited values go on the card too, so it shows what actually ran.
  const fields = input.edits ? await cardFields(def, n, ctx) : undefined;
  const claimed = await transition(ctx.admin, row.id, [expectStatus], {
    status: "executing",
    input: n.values,
    ...(fields ? { card: { ...row.card, fields } } : {}),
    ...(input.asApprover ? { approver_id: ctx.userId, decided_at: ctx.now.toISOString(), approval_note: input.asApprover.note ?? null } : {}),
  });
  if (!claimed) throw new ActionFailure("This action is already being handled.", 409);

  try {
    const result = await def.execute(n.values, ctx, { actionId: row.id, origin: input.origin, requesterId: row.user_id });
    const undoable = Boolean(def.undo) && result.undoable !== false;
    const done = await updateAction(ctx.admin, row.id, {
      status: "done",
      result,
      error: null,
      executed_at: new Date().toISOString(),
      undo_until: undoable ? new Date(Date.now() + (def.undo!.minutes ?? DEFAULT_UNDO_MINUTES) * 60_000).toISOString() : null,
    });
    if (input.asApprover) await tellRequester(ctx, row, `Approved and done: ${row.title}`, result.message, result.link?.href);
    return toCard(done ?? claimed);
  } catch (e) {
    const message = failureMessage(e);
    if (!(e instanceof RouteError) && !(e instanceof ActionFailure)) console.error(`[assistant] action ${def.key} failed:`, e);
    const failed = await updateAction(ctx.admin, row.id, { status: "failed", error: message, executed_at: new Date().toISOString() });
    if (input.asApprover) await tellRequester(ctx, row, `Approved, but it failed: ${row.title}`, message);
    return toCard(failed ?? claimed);
  }
}

export function failureMessage(e: unknown): string {
  if (e instanceof RouteError || e instanceof ActionFailure) return e.message;
  return "The change failed on the server. Nothing was changed — try again, or do it in the app.";
}

function alreadyMessage(row: StoredAction): string {
  switch (row.status) {
    case "done":
      return "This has already been done.";
    case "executing":
      return "This is already being done.";
    case "cancelled":
      return "This proposal was cancelled.";
    case "expired":
      return "This proposal has expired. Ask SED AI again for a fresh one.";
    case "awaiting_approval":
      return "This is waiting for an approver.";
    case "rejected":
      return "An approver turned this down.";
    case "undone":
      return "This was done and then undone.";
    default:
      return "This can no longer be confirmed.";
  }
}

export async function cancelAction(id: string, ctx: ActionContext): Promise<ActionCard> {
  const row = await getAction(ctx.admin, id);
  if (!row || row.user_id !== ctx.userId) throw new ActionFailure("That action was not found.", 404);
  const next = await transition(ctx.admin, id, ["proposed", "awaiting_approval"], { status: "cancelled" });
  if (!next) throw new ActionFailure(alreadyMessage(row), 409);
  return toCard(next);
}

export async function undoAction(id: string, actor: ActionContext): Promise<ActionCard> {
  const row = await getAction(actor.admin, id);
  const ctx: ActionContext = row ? { ...actor, ownerId: row.user_id } : actor;
  if (!row || (row.user_id !== ctx.userId && row.approver_id !== ctx.userId)) throw new ActionFailure("That action was not found.", 404);
  const def = getActionDef(row.action_key);
  if (row.status !== "done" || !def?.undo || !row.undo_until || Date.parse(row.undo_until) < ctx.now.getTime()) {
    throw new ActionFailure("This can no longer be undone here — change it back in the app.", 409);
  }
  const claimed = await transition(ctx.admin, id, ["done"], { status: "executing" });
  if (!claimed) throw new ActionFailure("This is already being handled.", 409);
  try {
    const message = await def.undo.run(row, ctx);
    const next = await updateAction(ctx.admin, id, {
      status: "undone",
      undo_until: null,
      result: { ...(row.result ?? { message: "" }), message: `${row.result?.message ?? "Done"} — then undone: ${message}` },
    });
    return toCard(next ?? claimed);
  } catch (e) {
    const next = await updateAction(ctx.admin, id, { status: "done", error: `Undo failed: ${failureMessage(e)}` });
    if (!(e instanceof RouteError)) console.error(`[assistant] undo of ${row.action_key} failed:`, e);
    return toCard(next ?? claimed);
  }
}

/* -------------------------------------------------------------- approvals */

export interface Draft {
  /** Values changed on the card. */
  edits?: Record<string, unknown>;
  /** Bulk: the records still ticked. */
  selected?: string[];
}

/**
 * The card as the person left it — their edits and unticks applied to the
 * stored values and re-checked — for what is sent on (to an approver).
 */
async function applyDraft(def: ActionDef, row: StoredAction, ctx: ActionContext, draft: Draft) {
  let raw: Values = { ...(row.input ?? {}) };
  const edited = Object.keys(draft.edits ?? {}).length > 0;
  if (edited && row.risk === "critical") throw new ActionFailure("A high-impact change can't be edited on its card. Ask SED AI to prepare it again with the change.", 422);
  for (const [k, v] of Object.entries(draft.edits ?? {})) {
    const spec = def.fields.find((f) => f.name === k);
    if (spec && isCardEditable(spec)) raw[k] = v;
  }
  let items = row.card?.items;
  if (def.bulkField && draft.selected) {
    const all = Array.isArray(raw[def.bulkField]) ? (raw[def.bulkField] as string[]) : [];
    const keep = all.filter((id) => draft.selected!.includes(id));
    if (!keep.length) throw new ActionFailure("Tick at least one record, or cancel.", 422);
    raw = { ...raw, [def.bulkField]: keep };
    items = items?.map((i) => ({ ...i, selected: keep.includes(i.id) })).filter((i) => i.selected);
  }
  const n = await normalizeFields(def, raw, ctx);
  const missing = missingFields(def, n.values, n.problems);
  const problems = [...n.problems, ...missing.map((f) => ({ field: f.name, message: `${f.label} is required.` }))];
  if (problems.length) throw new ActionFailure(problems.map((p) => p.message).join(" "), 422, problems);
  if (edited && RISK_RANK[riskOf(def, n.values)] > RISK_RANK[row.risk]) {
    throw new ActionFailure("That edit makes this a bigger change than the one proposed. Ask SED AI to prepare it again so you can review it.", 409);
  }
  // Scratch values (__name…) the proposal worked out stay with it.
  const values: Values = { ...Object.fromEntries(Object.entries(row.input ?? {}).filter(([k]) => k.startsWith("__"))), ...n.values };
  const fields = edited ? await cardFields(def, n, ctx) : row.card?.fields;
  return { values, card: { ...row.card, fields, items } };
}

export async function requestApproval(id: string, ctx: ActionContext, note: string | null, draft: Draft = {}): Promise<ActionCard> {
  const row = await getAction(ctx.admin, id);
  if (!row || row.user_id !== ctx.userId) throw new ActionFailure("That action was not found.", 404);
  const def = getActionDef(row.action_key);
  if (!def) throw new ActionFailure("This action no longer exists.", 410);
  if (def.selfOnly) throw new ActionFailure("This only changes your own things, so it can't be sent for approval.", 403);
  if (row.status !== "proposed") throw new ActionFailure(alreadyMessage(row), 409);
  // What the admin approves is the card as the person left it.
  const applied = await applyDraft(def, row, ctx, draft);
  const next = await transition(ctx.admin, id, ["proposed"], {
    status: "awaiting_approval",
    approval_note: note,
    input: applied.values,
    expires_at: new Date(ctx.now.getTime() + APPROVAL_TTL_MS).toISOString(),
    card: { ...applied.card, approval: { reason: row.card?.approval?.reason ?? "Sent for approval.", note } },
  });
  if (!next) throw new ActionFailure(alreadyMessage(row), 409);
  const approvers = (await usersWithPermission(ctx.admin, "assistant.actions.manage")).filter((u) => u !== ctx.userId);
  await Promise.all(
    approvers.map((uid) =>
      bell(ctx.admin, uid, {
        title: `${ctx.displayName} asks you to approve: ${row.title}`.slice(0, 200),
        body: note ? `“${note}”` : "SED AI prepared it; it runs as you once you approve.",
        dedupKey: `assistant_approval:${row.id}:${uid}`,
        targetUrl: `/assistant/actions?tab=approvals`,
        eventKey: "assistant_approval",
      }),
    ),
  );
  return toCard(next);
}

/** An approver turns a request down. Approving runs it: see confirmAction({ asApprover }). */
export async function rejectAction(id: string, ctx: ActionContext, note: string | null): Promise<ActionCard> {
  const row = await getAction(ctx.admin, id);
  if (!row) throw new ActionFailure("That action was not found.", 404);
  const next = await transition(ctx.admin, id, ["awaiting_approval"], {
    status: "rejected",
    approver_id: ctx.userId,
    decided_at: ctx.now.toISOString(),
    approval_note: note,
  });
  if (!next) throw new ActionFailure(alreadyMessage(row), 409);
  await tellRequester(ctx, row, `Not approved: ${row.title}`, note ? `${ctx.displayName}: “${note}”` : `${ctx.displayName} turned it down.`);
  return toCard(next);
}

async function tellRequester(ctx: ActionContext, row: StoredAction, title: string, body: string, href?: string | null) {
  if (row.user_id === ctx.userId) return;
  await bell(ctx.admin, row.user_id, {
    title,
    body,
    dedupKey: `assistant_decision:${row.id}`,
    targetUrl: href ?? (row.conversation_id ? `/assistant?c=${row.conversation_id}` : "/assistant/actions"),
    eventKey: "assistant_approval",
  });
}

/* ------------------------------------------------------------------ plans */

export interface PlanStepInput {
  action: string;
  fields: Values;
}

export type PlanOutcome =
  | { kind: "needs_input"; steps: { step: number; action: string; outcome: Exclude<PrepareOutcome, { kind: "proposed" }> }[] }
  | { kind: "proposed"; planId: string; cards: ActionCard[] };

/**
 * Several actions proposed together ("create the lead, open a ticket on it,
 * remind me Friday"). Every step is checked before ANY card is shown, so a
 * plan never half-appears. Later steps may name an earlier step's record as
 * "@1", "@2"…
 */
export async function preparePlan(
  title: string,
  steps: PlanStepInput[],
  base: Omit<PrepareInput, "key" | "fields" | "plan" | "replaces">,
): Promise<PlanOutcome> {
  if (!steps.length) throw new ActionFailure("A plan needs at least one step.");
  if (steps.length > 10) throw new ActionFailure("Keep a plan to at most 10 steps.");
  // Dry run: prepare each step's values without saving, by checking fields only.
  const failures: { step: number; action: string; outcome: Exclude<PrepareOutcome, { kind: "proposed" }> }[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const def = getActionDef(s.action);
    if (!def) {
      failures.push({ step: i + 1, action: s.action, outcome: { kind: "unknown", message: `There is no action "${s.action}".` } });
      continue;
    }
    const n = await normalizeFields(def, s.fields ?? {}, base.ctx, { stepRefs: true });
    for (const [k, v] of Object.entries(n.values)) {
      if (typeof v === "string" && STEP_REF_RE.test(v) && Number(v.slice(1)) >= i + 1) {
        n.problems.push({ field: k, message: `Step ${i + 1} can only use records from earlier steps (not ${v}).` });
      }
    }
    const missing = missingFields(def, n.values, n.problems);
    if (missing.length || n.problems.length) {
      failures.push({
        step: i + 1,
        action: s.action,
        outcome: {
          kind: "needs_input",
          missing: missing.map((f) => ({ field: f.name, label: f.label, ...(f.help ? { help: f.help } : {}) })),
          problems: n.problems,
          warnings: [],
          understood: {},
        },
      });
    }
  }
  if (failures.length) return { kind: "needs_input", steps: failures };

  const planId = randomUUID();
  const cards: ActionCard[] = [];
  for (let i = 0; i < steps.length; i++) {
    const out = await prepareAction({
      ...base,
      key: steps[i].action,
      fields: steps[i].fields ?? {},
      plan: { id: planId, index: i + 1, total: steps.length, title },
    });
    if (out.kind !== "proposed") {
      // Checks that depend on live data (a duplicate) can still stop a step:
      // withdraw what was already shown so the plan does not half-appear.
      for (const c of cards) await transition(base.ctx.admin, c.id, ["proposed"], { status: "cancelled", error: "The plan was not complete." }).catch(() => null);
      return { kind: "needs_input", steps: [{ step: i + 1, action: steps[i].action, outcome: out }] };
    }
    cards.push(out.card);
  }
  return { kind: "proposed", planId, cards };
}

/**
 * "Run all": confirm a plan's open steps in order, stopping at the first that
 * fails (later steps may depend on it).
 */
export async function confirmPlan(planId: string, ctx: ActionContext, origin: string, drafts: Record<string, Draft> = {}): Promise<ActionCard[]> {
  const steps = await listPlan(ctx.admin, planId);
  if (!steps.length || steps.some((s) => s.user_id !== ctx.userId)) throw new ActionFailure("That plan was not found.", 404);
  const out: ActionCard[] = [];
  let stopped = false;
  for (const step of steps) {
    if (stopped || step.status !== "proposed") {
      out.push(toCard((await getAction(ctx.admin, step.id)) ?? step));
      continue;
    }
    if (step.risk === "critical") {
      // Critical steps are confirmed one by one, with their phrase.
      stopped = true;
      out.push(toCard(step));
      continue;
    }
    try {
      // Each step as its card was left: edits, unticked records.
      const draft = drafts[step.id] ?? {};
      const card = await confirmAction({ id: step.id, ctx, origin, edits: draft.edits, selected: draft.selected });
      out.push(card);
      if (card.status !== "done") stopped = true;
    } catch (e) {
      stopped = true;
      const fresh = await getAction(ctx.admin, step.id);
      const card = toCard(fresh ?? step);
      out.push({ ...card, error: card.error ?? failureMessage(e) });
    }
  }
  return out;
}
