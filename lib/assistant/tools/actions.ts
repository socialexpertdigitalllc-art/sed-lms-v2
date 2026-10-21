import { readListing } from "../actions/checks";
import { REF_KINDS, refNoun, searchRefs } from "../actions/refs";
import { autoRun, autoRunPlan, describeAction, preparePlan, prepareAction, ActionFailure, DEFAULT_UNDO_MINUTES } from "../actions/run";
import { getActionDef } from "../actions/registry";
import type { ActionCard } from "../actions/card";
import { clampMode, isPermissionMode, MODE_RANK, modeInfo } from "../actions/permissions";
import { isMissingActionTables, ACTIONS_MIGRATION_MESSAGE } from "../actions/store";
import type { ActionContext, RefKind, Values } from "../actions/types";
import { normalizeUrl } from "../actions/fields";
import { UnsafeUrlError } from "../safeFetch";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { exactDomainFor, searchDomainNames, type DomainOffer } from "@/lib/domains/service";
import type { DomainRegistrar } from "@/lib/domains/types";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { ToolError, type AssistantTool, type ToolContext } from "./types";

/**
 * The tools of ACT MODE — how the model gets things done for someone without
 * ever doing them itself. It can describe an action, PREPARE one (which only
 * stores a proposal and shows the person a card), propose a plan of several,
 * and look up the records it needs. Executing is not a tool: it happens when
 * the person presses Confirm in the app — or at once, when their permission
 * mode lets that change run on its own (../actions/permissions.ts).
 */

export function actionContext(ctx: ToolContext): ActionContext {
  return {
    userId: ctx.userId,
    displayName: ctx.displayName,
    perms: ctx.perms,
    db: ctx.db,
    admin: ctx.admin,
    timezone: ctx.timezone,
    now: ctx.now,
    isAdmin: ctx.act?.isAdmin ?? false,
  };
}

function requireAct(ctx: ToolContext) {
  if (!ctx.act || ctx.act.mode !== "act") throw new ToolError("Act mode is not on for this request.");
  return ctx.act;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingActionTables(e)) throw new ToolError(ACTIONS_MIGRATION_MESSAGE);
    if (e instanceof ActionFailure) throw new ToolError(e.message);
    throw e;
  }
}

const fieldsParam = {
  type: "object",
  description:
    "Field name → value, using the field names from describe_action. Values as the person gave them: text, numbers, true/false, lists as arrays, records by name or id, times as YYYY-MM-DDTHH:mm in company time.",
};

export const switchToActionModeTool: AssistantTool = {
  name: "switch_to_action_mode",
  label: "Switching to Act mode",
  description:
    "Call this FIRST — before anything else — when the person asks you to DO something in the app for them (create, add, submit, log, update, change, move, assign, tag, send, email, build, deploy, buy, remind, delete…) rather than to look something up or analyse. It turns on Act mode, where you prepare the change for them to confirm. Never call it for a question about their data.",
  parameters: {
    type: "object",
    properties: { task: { type: "string", description: "The task in a few words, e.g. \"create a lead for Jumbo's Pizza\"." } },
    required: ["task"],
  },
  available: (perms) => perms.has("assistant.act"),
  modes: ["ask"],
  sequential: true,
  async run(args, ctx) {
    if (!ctx.act) throw new ToolError("Act mode is not available for this person.");
    const task = String(args.task ?? "").trim().slice(0, 200) || "a task";
    ctx.act.switchRequested = task;
    return { data: { switched: true, note: "Act mode is on from your next step: the action tools are now available." }, summary: `Act mode on — ${task}` };
  },
};

export const describeActionTool: AssistantTool = {
  name: "describe_action",
  label: "Checking what's needed",
  description:
    "The fields of one action: names, which are required (and when), allowed options and formats. Call it before preparing an action you have not used in this chat.",
  parameters: {
    type: "object",
    properties: { action: { type: "string", description: "The action key, e.g. lead.create." } },
    required: ["action"],
  },
  available: (perms) => perms.has("assistant.act"),
  modes: ["act"],
  async run(args, ctx) {
    requireAct(ctx);
    const out = await guarded(() => describeAction(String(args.action ?? ""), actionContext(ctx)));
    if (!out) throw new ToolError(`There is no action "${String(args.action ?? "")}". Use one from the list.`);
    return { data: out, summary: out.title };
  },
};

export const prepareActionTool: AssistantTool = {
  name: "prepare_action",
  label: "Preparing the change",
  description:
    "Prepare a change for the person to confirm. Pass everything you know; it checks every value with the app's own rules. Returns either what is still missing or wrong (ask the person, then call again with ALL values), or \"proposed\": a confirmation card is now shown and NOTHING has changed yet — the person must press its button.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", description: "The action key, e.g. lead.create." },
      fields: fieldsParam,
      replaces: { type: "string", description: "When correcting a card already shown: the action_id of that card (it is withdrawn)." },
    },
    required: ["action", "fields"],
  },
  available: (perms) => perms.has("assistant.act"),
  modes: ["act"],
  sequential: true,
  async run(args, ctx) {
    const act = requireAct(ctx);
    const fields = (args.fields && typeof args.fields === "object" && !Array.isArray(args.fields) ? args.fields : {}) as Values;
    const out = await guarded(() =>
      prepareAction({
        key: String(args.action ?? ""),
        fields,
        ctx: actionContext(ctx),
        conversationId: ctx.conversationId,
        turnId: act.turnId,
        callId: act.callId ?? null,
        source: act.source,
        replaces: typeof args.replaces === "string" ? args.replaces : null,
      }),
    );
    switch (out.kind) {
      case "unknown":
      case "disabled":
        throw new ToolError(out.message);
      case "needs_input": {
        const n = out.missing.length + out.problems.length;
        return {
          data: {
            status: "needs_input",
            missing: out.missing,
            problems: out.problems,
            warnings: out.warnings,
            understood: out.understood,
            next: "Ask the person for everything missing or wrong in ONE short message (a numbered list, with the options or format for each). Do not guess any of it. Then call prepare_action again with ALL the values, old and new.",
          },
          summary: `Needs ${n} more ${n === 1 ? "detail" : "details"}`,
        };
      }
      case "proposed": {
        if (act.auto) {
          const r = await guarded(() => autoRun(out.card, actionContext(ctx), act.auto!, (card) => ctx.emit?.({ type: "action", card })));
          ctx.emit?.({ type: "action", card: r.card });
          if (r.ran || r.card.status !== "proposed") return ranResult(r.card);
          return proposedResult(r.card, out.needsApproval, r.reason);
        }
        ctx.emit?.({ type: "action", card: out.card });
        return proposedResult(out.card, out.needsApproval, null);
      }
    }
  },
};

/** What the model is told about a card that waits for the person. */
function proposedResult(card: ActionCard, needsApproval: boolean, notAuto: string | null) {
  return {
    data: {
      status: "proposed",
      action_id: card.id,
      title: card.title,
      risk: card.risk,
      needs_approval: needsApproval,
      warnings: card.warnings ?? [],
      ...(notAuto ? { why_it_waits: notAuto } : {}),
      next: needsApproval
        ? `A card is shown. The person cannot do this themselves: tell them briefly that they can send it to an admin for approval from the card. Nothing has changed.`
        : `A card is shown. In one or two sentences say what will happen and that it happens only when they press "${card.confirmLabel}" on the card${card.risk === "critical" ? " (and type the confirmation words)" : ""}. Nothing has changed yet — never say it is done.`,
    },
    summary: `Ready to confirm: ${card.title}`,
  };
}

/** What the model is told about a change that ran on its own. */
function ranResult(card: ActionCard) {
  const minutes = getActionDef(card.key)?.undo?.minutes ?? DEFAULT_UNDO_MINUTES;
  if (card.status !== "done") {
    return {
      data: {
        status: "failed",
        action_id: card.id,
        title: card.title,
        error: card.error ?? "It could not be done.",
        next: "It was tried straight away (the person's permission mode allows it) but FAILED. Tell them in one sentence what failed and why. Do not retry on your own.",
      },
      summary: `Failed: ${card.title}`,
    };
  }
  return {
    data: {
      status: "done",
      action_id: card.id,
      title: card.title,
      result: card.result?.message ?? "Done.",
      ...(card.result?.link ? { link: card.result.link.href } : {}),
      ...(card.undoUntil ? { undo: `they can undo it from its card for ${minutes} minutes` } : {}),
      next: "It is DONE — it ran straight away because the person's permission mode allows it. Say in one sentence what was done (with the link if there is one).",
    },
    summary: `Done: ${card.title}`,
  };
}

const LEAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A plan that is nothing but one-lead category edits ("lead.update" with only
 * {lead, category}, by lead id) → the assignments for ONE lead.categorize.
 * One bulk change instead of ten cards: one card, one undo, and it counts once
 * against the changes an answer may make on its own. Null when the plan is
 * anything else. PURE; tested.
 */
export function categoryEditsAsBulk(steps: { action: string; fields: Values }[]): { lead: string; category: string }[] | null {
  if (steps.length < 2) return null;
  const out: { lead: string; category: string }[] = [];
  for (const s of steps) {
    if (s.action !== "lead.update") return null;
    const keys = Object.keys(s.fields).filter((k) => s.fields[k] !== undefined && s.fields[k] !== null && s.fields[k] !== "");
    if (keys.some((k) => k !== "lead" && k !== "category")) return null;
    const lead = typeof s.fields.lead === "string" ? s.fields.lead.trim() : "";
    const category = typeof s.fields.category === "string" ? s.fields.category.trim() : "";
    if (!LEAD_ID.test(lead) || !category) return null;
    out.push({ lead, category });
  }
  return out;
}

export const proposePlanTool: AssistantTool = {
  name: "propose_plan",
  label: "Preparing a plan",
  description:
    "Prepare several changes that belong together, in order (e.g. create a lead, open a ticket on it, remind me Friday). A later step can use the record an earlier step creates: put \"@1\" (step 1's record), \"@2\"… in its field. Every step is checked first; then one card per step is shown, with Run all.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "What the plan achieves, in a few words." },
      steps: {
        type: "array",
        description: "The steps, in order (at most 10).",
        items: {
          type: "object",
          properties: { action: { type: "string" }, fields: fieldsParam },
          required: ["action", "fields"],
        },
      },
    },
    required: ["title", "steps"],
  },
  available: (perms) => perms.has("assistant.act"),
  modes: ["act"],
  sequential: true,
  async run(args, ctx) {
    const act = requireAct(ctx);
    const steps = Array.isArray(args.steps) ? args.steps : [];
    const parsed = steps.map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { action: String(o.action ?? ""), fields: (o.fields && typeof o.fields === "object" ? o.fields : {}) as Values };
    });
    // Ten category edits are one bulk change, not a ten-card plan.
    const bulk = categoryEditsAsBulk(parsed);
    if (bulk) {
      const r = await prepareActionTool.run({ action: "lead.categorize", fields: { assignments: bulk } }, ctx);
      return {
        data: {
          ...(r.data as Record<string, unknown>),
          merged: `These ${bulk.length} category edits were made as ONE bulk change (lead.categorize). For categories always use lead.categorize directly — up to 50 leads per action.`,
        },
        summary: r.summary,
      };
    }
    const out = await guarded(() =>
      preparePlan(String(args.title ?? "Plan").slice(0, 200), parsed, {
        ctx: actionContext(ctx),
        conversationId: ctx.conversationId,
        turnId: act.turnId,
        callId: act.callId ?? null,
        source: act.source,
      }),
    );
    if (out.kind === "needs_input") {
      return {
        data: {
          status: "needs_input",
          steps: out.steps,
          next: "Ask the person for everything missing in ONE message (grouped by step), then call propose_plan again with all the steps complete.",
        },
        summary: `Plan needs more details (${out.steps.length} step${out.steps.length === 1 ? "" : "s"})`,
      };
    }
    for (const card of out.cards) ctx.emit?.({ type: "action", card });
    if (act.auto) {
      const r = await guarded(() => autoRunPlan(out.cards, actionContext(ctx), act.auto!, (card) => ctx.emit?.({ type: "action", card })));
      for (const card of r.cards) ctx.emit?.({ type: "action", card });
      if (r.ran) {
        const waiting = r.cards.filter((c) => c.status === "proposed").length;
        return {
          data: {
            status: waiting ? "partly_done" : r.cards.every((c) => c.status === "done") ? "done" : "failed",
            plan_id: out.planId,
            steps: r.cards.map((c) => ({ action_id: c.id, title: c.title, status: c.status, ...(c.result?.message ? { result: c.result.message } : {}), ...(c.error ? { error: c.error } : {}) })),
            ...(r.stoppedAt ? { stopped_at: r.stoppedAt } : {}),
            next: waiting
              ? "The first steps ran straight away (the person's permission mode allows them); the rest wait on their cards. Say what was done and what still needs their confirmation, and why it stopped."
              : "Every step ran straight away (the person's permission mode allows it). Say in a sentence or two what was done, and any step that failed.",
          },
          summary: `Plan: ${r.ran} of ${r.cards.length} steps done`,
        };
      }
    }
    return {
      data: {
        status: "proposed",
        plan_id: out.planId,
        steps: out.cards.map((c) => ({ action_id: c.id, title: c.title, needs_approval: Boolean(c.approval) })),
        next: "The plan's cards are shown. Say in a sentence what the plan does and that nothing happens until they press Run all (or confirm step by step).",
      },
      summary: `Plan ready: ${out.cards.length} steps`,
    };
  },
};

export const findRecordsTool: AssistantTool = {
  name: "find_records",
  label: "Looking it up",
  description:
    "Find records by name to get their ids — leads, pre-leads, tickets, people, tags, domains, websites, Site Builder runs, mailboxes, receipts, contracts, forms, coupons… Use it when a name might match several records, or to list candidates for the person to pick from.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...REF_KINDS], description: "What kind of record." },
      query: { type: "string", description: "A name, part of one, a phone number, a domain, or an id." },
    },
    required: ["kind", "query"],
  },
  available: (perms) => perms.has("assistant.act"),
  modes: ["act"],
  async run(args, ctx) {
    requireAct(ctx);
    const kind = String(args.kind ?? "") as RefKind;
    if (!REF_KINDS.includes(kind)) throw new ToolError(`Unknown kind "${kind}". Use one of: ${REF_KINDS.join(", ")}.`);
    const q = String(args.query ?? "").trim();
    if (!q) throw new ToolError("Say what to look for.");
    const hits = await guarded(() => searchRefs(kind, q, actionContext(ctx), 10));
    return {
      data: { kind, query: q, results: hits },
      summary: hits.length ? `${hits.length} ${refNoun(kind)}${hits.length === 1 ? "" : "s"} found` : `No ${refNoun(kind)} found`,
    };
  },
};

export const readBusinessLinkTool: AssistantTool = {
  name: "read_business_link",
  label: "Reading the listing",
  description:
    "Read a Google Maps, Yelp or Facebook link the person pasted: the business's name, phone, address, category and rating where the page shows them — to fill a lead. Confirm what it found with the person; ask for what it did not find.",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "The link as pasted." } },
    required: ["url"],
  },
  available: (perms) => perms.has("assistant.act"),
  modes: ["act"],
  async run(args, ctx) {
    requireAct(ctx);
    const url = normalizeUrl(args.url);
    if (!url) throw new ToolError("That is not a web link.");
    const facts = await readListing(url).catch((e) => {
      if (e instanceof UnsafeUrlError) throw new ToolError(`That link can't be opened: ${e.message}`);
      throw e;
    });
    const found = ["business_name", "phone", "address", "category", "rating"].filter((k) => facts[k as keyof typeof facts] !== undefined);
    return {
      data: { ...facts, note: "Best effort from the public page. Show the person what was found; ask for anything missing." },
      summary: found.length ? `Found ${found.join(", ").replace(/_/g, " ")}` : "Nothing readable on that page",
    };
  },
};

export const checkDomainTool: AssistantTool = {
  name: "check_domain",
  label: "Checking the domain",
  description:
    "Is a domain name available, and what does it cost (first year and yearly renewal) on the company's registrars? Read-only — use it to talk prices before preparing domain.buy. Checks the exact name first (.com when no ending is given), then lists alternatives, which are different names.",
  parameters: {
    type: "object",
    properties: {
      domain: { type: "string", description: "The domain or name to check, e.g. jumbospizza.com." },
      registrar: { type: "string", enum: ["cloudflare", "hostinger"], description: "Only this registrar (default: every configured one)." },
    },
    required: ["domain"],
  },
  available: (perms) => perms.has("assistant.act") && perms.has("domains.purchase"),
  modes: ["act"],
  async run(args, ctx) {
    requireAct(ctx);
    const q = String(args.domain ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[/?#].*$/, "");
    if (!q) throw new ToolError("Say which domain.");
    const registrars = (args.registrar === "cloudflare" || args.registrar === "hostinger" ? [args.registrar] : ["cloudflare", "hostinger"]) as DomainRegistrar[];
    const usable = registrars.filter((r) => (r === "cloudflare" ? cloudflareConfigured() : hostingerConfigured()));
    if (!usable.length) throw new ToolError("No domain registrar is set up on this server.");
    const results = await Promise.all(usable.map((r) => searchDomainNames(q, r).catch(() => null)));
    const money = (c: number | null, cur: string) => (c === null ? null : `${cur === "USD" ? "$" : `${cur} `}${(c / 100).toFixed(2)}`);
    const view = (o: DomainOffer) => ({
      domain: o.domain,
      registrar: o.registrar,
      available: o.available,
      first_year: money(o.registrationCents, o.currency),
      renewal_per_year: money(o.renewalCents, o.currency),
      reason: o.reason,
    });
    const exactName = exactDomainFor(q)?.domain ?? null;
    const exact = results.flatMap((r) => (r?.exact?.offer ? [r.exact.offer] : []));
    const alternatives = results.flatMap((r) => (r ? [...r.otherEndings, ...r.similar] : [])).slice(0, 16);
    const exactAvailable = exact.some((o) => o.available);
    return {
      data: {
        query: q,
        // The name exactly as asked (.com when no ending was given) — say plainly
        // whether IT is available before offering anything else.
        exact_match: exactName ? { domain: exactName, available: exactAvailable, by_registrar: exact.map(view) } : null,
        alternatives: alternatives.map(view),
        note: "Alternatives are DIFFERENT names from the one asked for. Never present one as if it were the requested name; say clearly when the exact name is taken.",
        ...(results.some((r) => r === null) ? { unreachable: "One registrar could not be reached; its prices are missing." } : {}),
      },
      summary: exactName ? `${exactName} is ${exactAvailable ? "available" : "not available"}` : alternatives.length ? `${alternatives.filter((o) => o.available).length} available options` : "No results",
    };
  },
};

/**
 * A big job meets a permission mode that would make every change wait on a
 * card: ask the person ONCE to switch to the mode the job needs. The chat
 * shows a button; switching carries the job on by itself.
 */
export const requestPermissionModeTool: AssistantTool = {
  name: "request_permission_mode",
  label: "Asking to switch the permission mode",
  description:
    "Ask the person ONCE (per chat) to raise their permission mode, when the task means many changes and their current mode would make each one wait on a card for them to press. A button appears under your message; when they switch, the task continues by itself. After calling it, stop: no more changes in this answer.",
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["auto_safe", "auto"], description: "auto_safe: safe changes run on their own. auto: everything but high-impact changes." },
      reason: { type: "string", description: "Why, in a few words, e.g. \"to categorise 802 leads without a card each\"." },
    },
    required: ["mode", "reason"],
  },
  available: (perms) => perms.has("assistant.act"),
  modes: ["act"],
  sequential: true,
  async run(args, ctx) {
    const act = requireAct(ctx);
    const auto = act.auto;
    if (!auto) throw new ToolError("Permission modes are not available here.");
    const want = args.mode;
    if (!isPermissionMode(want) || want === "ask") throw new ToolError('Ask for "auto_safe" or "auto".');
    if (act.task?.background) {
      throw new ToolError("This is a background run — nobody is here to press a button. Carry on with what their mode allows, and note in update_task_progress anything that needs a higher mode.");
    }
    if (act.source === "telegram" || act.source === "whatsapp") {
      throw new ToolError("There is no button on the phone. Tell them they can switch the permission mode in SED AI on the computer (the chip next to Act), then carry on with what their mode allows.");
    }
    if (MODE_RANK[clampMode(auto.mode, auto.cap)] >= MODE_RANK[want]) {
      return { data: { status: "already", next: "Their mode already lets these changes run on their own — carry on with the task." }, summary: "Already allowed" };
    }
    if (MODE_RANK[auto.cap] < MODE_RANK[want]) {
      throw new ToolError(`The company's limit is "${modeInfo(auto.cap).label}" — carry on with cards they confirm, and mention that an admin can raise the limit.`);
    }
    const { data: prior } = await ctx.admin
      .from("assistant_messages")
      .select("id")
      .eq("conversation_id", ctx.conversationId)
      .eq("tool_name", "request_permission_mode")
      .limit(1);
    if (prior?.length) {
      throw new ToolError("You already asked to switch the permission mode in this chat — don't ask again. Carry on under their current mode (changes wait on cards).");
    }
    const reason = String(args.reason ?? "").trim().slice(0, 200);
    act.askedPermission = true;
    return {
      data: {
        status: "asked",
        mode: want,
        next: "A button is shown under your message. In one or two sentences say what you need it for and that, once they switch, the task carries on by itself. Make no more changes in this answer.",
      },
      summary: `Asked to switch to “${modeInfo(want).label}”${reason ? ` — ${reason}` : ""}`,
    };
  },
};

export const ACTION_TOOLS: AssistantTool[] = [
  requestPermissionModeTool,
  switchToActionModeTool,
  describeActionTool,
  prepareActionTool,
  proposePlanTool,
  findRecordsTool,
  readBusinessLinkTool,
  checkDomainTool,
];
