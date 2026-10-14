import type { SuppliedImage } from "@/lib/site-builder/prompt";
import { STALE_GENERATING_MS } from "@/lib/site-builder/run";
import { claimedByAnotherLead } from "@/lib/site-studio/deploy/claimed";
import { baseSubdomain, firstFreeVersion } from "@/lib/site-studio/deploy/naming";
import { reusableSubdomain } from "@/lib/site-studio/deploy/slug";
import { daConfigured } from "@/lib/template-engine/directadmin";
import { attachmentUrl } from "../../uploads";
import type { CardItem } from "../card";
import { isStepRef, need, plural, str, visibleLead } from "../helpers";
import { callRoute, RouteError } from "../invoke";
import type { ActionContext, ActionDef, Problem, StoredAction, Values } from "../types";

/**
 * Site Builder actions: start a build (one lead or many), regenerate a page
 * or retry a failed build, publish a reviewed build, delete a run. Every one
 * runs through the endpoint the Site Builder screens call (all behind
 * `studio.manage`), so the app's own rules apply unchanged.
 */

const runsRoute = () => import("@/app/api/site-builder/runs/route");
const runRoute = () => import("@/app/api/site-builder/runs/[id]/route");
const bulkRoute = () => import("@/app/api/site-builder/runs/bulk/route");
const generateRoute = () => import("@/app/api/site-builder/runs/[id]/generate/route");
const regenerateRoute = () => import("@/app/api/site-builder/runs/[id]/pages/[file]/regenerate/route");
const approveRoute = () => import("@/app/api/site-builder/runs/[id]/approve/route");
const deployRoute = () => import("@/app/api/site-builder/runs/[id]/deploy/route");
const sourceRoute = () => import("@/app/api/site-builder/images/source/route");
const pickRoute = () => import("@/app/api/site-builder/images/pick/route");

const runLink = (id: string) => ({ href: `/ai-tools/site-builder/runs/${id}`, label: "Open run" });
const leadLink = (id: string) => ({ href: `/leads/${id}`, label: "Open lead" });
const RUNS_LINK = { href: "/ai-tools/site-builder/runs", label: "Open runs" };

/** Every Site Builder endpoint is behind the one Site Studio gate (lib/site-studio/service/guard.ts). */
const allowed = (ctx: ActionContext) => need(ctx, "studio.manage");

/** The New Site screen's own limits (components/site-builder/NewSiteFlow.tsx, runs/bulk/route.ts). */
const HERO_PICK_LIMIT = 3;
const MAX_BULK_LEADS = 50;
const MAX_INSTRUCTIONS = 2000;

/** How long a whole-run retry is waited on before it is left running on its own. */
export const GENERATE_WAIT_MS = 15_000;

/* -------------------------------------------------------------- helpers */

type RunStatus = "queued" | "generating" | "review" | "approved" | "deployed" | "failed";
type Joined = { business_name?: string | null } | { business_name?: string | null }[] | null | undefined;

interface PageLite {
  status?: string;
  kind?: string;
  name?: string;
}

interface RunRow {
  id: string;
  status: RunStatus;
  lead_id: string | null;
  template_id: string | null;
  output_path: string | null;
  deployed_url: string | null;
  updated_at: string;
  generation_id?: string | null;
  pages?: Record<string, PageLite> | null;
  leads?: Joined;
}

const RUN_COLS = "id, status, lead_id, template_id, output_path, deployed_url, updated_at, leads(business_name)";

const joinedName = (j: Joined): string => (Array.isArray(j) ? j[0]?.business_name : j?.business_name) ?? "";

/** A run as the Site Builder screens read it (service role, behind studio.manage). */
async function loadRun(ctx: ActionContext, id: unknown, cols = RUN_COLS): Promise<RunRow | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.admin.from("builder_runs").select(cols).eq("id", id).maybeSingle();
  return (data as RunRow | null) ?? null;
}

const STATUS_WORDS: Record<RunStatus, string> = {
  queued: "queued",
  generating: "generating",
  review: "waiting for review",
  approved: "approved",
  deployed: "deployed",
  failed: "failed",
};

/** A run that is queued or mid-generation and has written recently — the DELETE route refuses it. */
function activeAndFresh(run: Pick<RunRow, "status" | "updated_at">, now: Date): boolean {
  const active = run.status === "queued" || run.status === "generating";
  return active && now.getTime() - new Date(run.updated_at).getTime() < STALE_GENERATING_MS;
}

/**
 * The page a person means — "about page", "Contact Us", "home", "services.html"
 * — among a run's generated files. Exact file first, then the file's stem or
 * the page's own name, then a unique partial match; otherwise the question.
 */
export function matchPage(input: string, pages: Record<string, PageLite>): { file: string } | { problem: string; choices?: string[] } {
  const files = Object.keys(pages);
  const show = (f: string) => (pages[f]?.name && pages[f].name !== f ? `${pages[f].name} (${f})` : f);
  if (!files.length) return { problem: "This run has no pages yet." };
  const raw = input.trim();
  const lower = raw.toLowerCase();
  const exact = files.find((f) => f.toLowerCase() === lower || f.toLowerCase() === `${lower}.html`);
  if (exact) return { file: exact };

  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/\.html?$/, "")
      .replace(/\b(the|page|pages|webpage)\b/g, " ")
      .replace(/[^a-z0-9]+/g, "");
  const stem = (f: string) => key(f.split("/").pop() ?? f);
  let q = key(raw);
  if (["", "home", "homepage", "main", "front", "frontpage", "landing", "index"].includes(q)) q = "index";

  const named = files.filter((f) => stem(f) === q || key(pages[f]?.name ?? "") === q);
  if (named.length === 1) return { file: named[0] };
  const loose = named.length
    ? named
    : files.filter((f) => {
        const s = stem(f);
        const n = key(pages[f]?.name ?? "");
        return q.length >= 3 && ((s.length >= 3 && (s.includes(q) || q.includes(s))) || (n.length >= 3 && (n.includes(q) || q.includes(n))));
      });
  if (loose.length === 1) return { file: loose[0] };
  if (loose.length > 1) return { problem: `"${raw}" matches ${loose.length} pages of this run — which one?`, choices: loose.map(show) };
  const real = files.filter((f) => pages[f]?.kind !== "component");
  return { problem: `This run has no page called "${raw}". Its pages: ${real.map(show).join(", ")}.`, choices: real.map(show) };
}

/** Wait for a promise up to `ms`; past that it keeps running on its own (its outcome is still caught). */
export async function settleWithin<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ state: "fulfilled"; value: T } | { state: "rejected"; error: unknown } | { state: "pending" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ state: "pending" }>((resolve) => {
    timer = setTimeout(() => resolve({ state: "pending" }), ms);
  });
  const settled = p.then(
    (value) => ({ state: "fulfilled" as const, value }),
    (error: unknown) => ({ state: "rejected" as const, error }),
  );
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Undo for a build that has not started: remove the run while it is still
 * queued. The DELETE route refuses any queued run for an hour (that guard
 * protects generations in flight), but a run nobody has claimed has nothing in
 * flight — so it is removed directly, CAS on status: a run the processor (or an
 * open run screen) has just claimed is left alone and reported as started.
 */
async function cancelQueuedRuns(ctx: ActionContext, ids: string[]): Promise<{ cancelled: number; started: number }> {
  const reason = need(ctx, "studio.manage");
  if (reason) throw new RouteError(reason, 403, null);
  if (!ids.length) return { cancelled: 0, started: 0 };
  const { data, error } = await ctx.admin.from("builder_runs").delete().in("id", ids).eq("status", "queued").select("id, lead_id");
  if (error) throw new RouteError(error.message, 500, null);
  const gone = (data ?? []) as { id: string; lead_id: string | null }[];
  if (gone.length) {
    await ctx.admin.from("activity_log").insert(
      gone.map((r) => ({
        user_id: ctx.userId,
        action: "site_builder.run.deleted",
        entity_type: "builder_run",
        entity_id: r.id,
        new_value: { status: "queued", lead_id: r.lead_id, via: "assistant_undo" },
      })),
    );
  }
  return { cancelled: gone.length, started: ids.length - gone.length };
}

function createdIds(stored: StoredAction): string[] {
  const data = stored.result?.data ?? {};
  if (Array.isArray(data.ids)) return (data.ids as unknown[]).filter((x): x is string => typeof x === "string");
  return typeof data.id === "string" ? [data.id] : [];
}

/* ------------------------------------------------------------ build.start */

const IMAGE_MODES = ["Automatic", "Client photos only", "Template's own"] as const;

interface LeadForBuild {
  id: string;
  business_name: string;
  status: string;
  website_link: string | null;
  recommended_template_id: string | null;
  image_links: string[] | null;
}

/** One candidate as POST /api/site-builder/images/source returns it. */
interface SourcedCandidate {
  kind: "library" | "pexels" | "client";
  key: string;
  url?: string;
  thumb_url?: string | null;
  width?: number;
  height?: number;
  pexels_id?: number;
  download_url?: string;
  photographer?: string;
}

interface SourcedImages {
  hero?: SourcedCandidate[];
  services?: { service: string; purpose: string; candidates?: SourcedCandidate[] }[];
}

/** The pick body the New Site screen sends for a candidate (NewSiteFlow.tsx resolveDisplayCandidate). */
function pickBody(c: SourcedCandidate, purpose: string, leadId: string): Record<string, unknown> {
  if (c.kind === "library") return { kind: "link", url: c.url, subject: purpose };
  if (c.kind === "pexels") {
    return {
      kind: "pexels",
      pexels: {
        download_url: c.download_url,
        thumb_url: c.thumb_url,
        pexels_id: c.pexels_id,
        width: c.width,
        height: c.height,
        photographer: c.photographer,
        subject: purpose,
      },
    };
  }
  return { kind: "client", url: c.url, lead_id: leadId, subject: purpose };
}

/**
 * Turn picks into the run's images through the pick route — one at a time:
 * each is a quick write, and the images keep the order they were chosen in.
 */
async function pickAll(picks: { body: Record<string, unknown>; purpose: string }[]): Promise<SuppliedImage[]> {
  const out: SuppliedImage[] = [];
  for (const p of picks) {
    const res = await callRoute<{ url: string }>(pickRoute, "POST", { path: "/api/site-builder/images/pick", body: p.body });
    out.push({ url: res.url, purpose: p.purpose });
  }
  return out;
}

/**
 * The images the New Site screen would carry into Generate with no clicks:
 * the person's own hero images (or the top three sourced ones), the first
 * candidate of every service row, and the client's own photos as the gallery.
 */
async function buildImages(v: Values, ctx: ActionContext, lead: LeadForBuild): Promise<{ images: SuppliedImage[]; note: string | null }> {
  const mode = str(v.images) || "Automatic";
  let note: string | null = null;

  const own: string[] = [];
  for (const item of Array.isArray(v.hero_images) ? (v.hero_images as string[]) : []) {
    const url = await attachmentUrl(ctx.admin, ctx.ownerId ?? ctx.userId, item);
    if (url) own.push(url);
  }
  const images = await pickAll(own.map((url) => ({ body: { kind: "link", url, subject: "Hero" }, purpose: "Hero" })));

  if (mode === "Automatic") {
    let sourced: SourcedImages | null = null;
    try {
      sourced = await callRoute<SourcedImages>(sourceRoute, "POST", { path: "/api/site-builder/images/source", body: { lead_id: lead.id } });
    } catch (e) {
      // As on the screen: no sourced candidates is not a reason not to build.
      if (!(e instanceof RouteError)) throw e;
      note = `stock photos could not be found (${e.message}), so the template's own fill in`;
    }
    if (sourced) {
      const hero = own.length ? [] : (sourced.hero ?? []).slice(0, HERO_PICK_LIMIT).map((c) => ({ body: pickBody(c, "Hero", lead.id), purpose: "Hero" }));
      const services = (sourced.services ?? []).flatMap((r) => (r.candidates?.length ? [{ body: pickBody(r.candidates[0], r.purpose, lead.id), purpose: r.purpose }] : []));
      images.push(...(await pickAll([...hero, ...services])));
    }
  }

  if (mode !== "Template's own") {
    images.push(...(await pickAll((lead.image_links ?? []).map((url) => ({ body: { kind: "client", url, lead_id: lead.id }, purpose: "Gallery" })))));
  }
  return { images, note };
}

const LEAD_BUILD_COLS = "id, business_name, status, website_link, recommended_template_id, image_links";

const buildStart: ActionDef = {
  key: "build.start",
  group: "Site Builder",
  title: "Build a website for a lead",
  description:
    "Start a Site Builder build for one lead, like the New Site screen: the template (default: the one sales picked with the client), the images (found automatically by default), optional instructions for the AI, and whether the site publishes itself when it is ready (default yes, as on the screen; then the card asks for the business name to be typed). For many leads at once use build.bulk.",
  confirmLabel: "Start build",
  risk: (v) => (v.auto_deploy === false ? "standard" : "critical"),
  allowed,
  fields: [
    { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false },
    {
      name: "template",
      label: "Template",
      type: "ref",
      ref: "builder_template",
      help: "Leave empty to use the template sales picked with the client (the lead's recommended template). Ask only when the lead has none.",
    },
    {
      name: "images",
      label: "Images",
      type: "enum",
      options: IMAGE_MODES,
      default: "Automatic",
      help: "Automatic (default) = what the New Site screen picks by itself: the best stock photos for the hero and each service, plus the client's own photos as the gallery. Client photos only = just the lead's photos. Template's own = keep the template's stock photos.",
    },
    {
      name: "hero_images",
      label: "Hero images",
      type: "attachments",
      max: HERO_PICK_LIMIT,
      help: "Optional: up to 3 specific images for the top of the home page — links, or images attached in this chat. They replace the automatic hero picks.",
    },
    {
      name: "instructions",
      label: "Instructions for the AI",
      type: "longtext",
      max: MAX_INSTRUCTIONS,
      help: "Optional: anything the client wants that the lead's details do not say — e.g. an English/Spanish site, a formal tone.",
    },
    {
      name: "auto_deploy",
      label: "Publish when ready",
      type: "boolean",
      default: true,
      help: "Yes (the screen's default): the site goes live on its subdomain as soon as it is generated, the lead's website link is set and its agent is told. No: it waits for review (then build.deploy).",
    },
  ],
  label: (v) => str(v.__name),
  produces: "site_run",
  minutesSaved: 6,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    const lead = await visibleLead<LeadForBuild>(ctx, v.lead, LEAD_BUILD_COLS);
    if (typeof v.lead === "string" && !isStepRef(v.lead) && !lead) problems.push({ field: "lead", message: "That lead is not visible to you." });

    if (typeof v.template === "string") {
      const { data: t } = await ctx.admin.from("builder_templates").select("id, name").eq("id", v.template).maybeSingle();
      if (t) values.__template = (t as { name: string }).name;
    }
    if (!lead) return { problems, values };
    values.__name = lead.business_name;

    // The route falls back to the lead's recommended template — say up front when there is none.
    if (typeof v.template !== "string") {
      const rec = lead.recommended_template_id;
      const { data: t } = rec ? await ctx.admin.from("builder_templates").select("id, name").eq("id", rec).maybeSingle() : { data: null };
      if (t) values.__template = `${(t as { name: string }).name} (picked by sales with the client)`;
      else {
        problems.push({
          field: "template",
          message: rec
            ? "The template sales recommended for this lead no longer exists — which template should the site use?"
            : `${lead.business_name} has no recommended template — which template should the site use?`,
        });
      }
    }

    if (lead.status !== "Not Ready") warnings.push(`${lead.business_name} is ${lead.status} — the New Site screen only builds sites for Not Ready leads.`);
    const { data: active } = await ctx.admin.from("builder_runs").select("id, status").eq("lead_id", lead.id).in("status", ["queued", "generating"]).limit(1);
    const running = ((active ?? []) as { status: string }[])[0];
    if (running) warnings.push(`${lead.business_name} already has a build ${running.status} — this starts a second one.`);
    if (v.auto_deploy !== false && lead.website_link) {
      warnings.push(
        reusableSubdomain(lead.website_link, process.env.DA_DOMAIN ?? "")
          ? `${lead.business_name}'s current site (${lead.website_link}) is replaced by this build when it publishes.`
          : `${lead.business_name}'s website link (${lead.website_link}) will point at the new site when it publishes.`,
      );
    }
    values.__photos = (lead.image_links ?? []).length;
    return { problems, warnings, values };
  },
  async preview(v) {
    const name = str(v.__name);
    const notes: string[] = [];
    if (typeof v.template !== "string" && v.__template) notes.push(`Template: ${str(v.__template)}.`);
    // A lead from an earlier plan step is not known yet: its photos are counted at confirm.
    const photos = typeof v.__photos === "number" ? v.__photos : null;
    const own = Array.isArray(v.hero_images) ? v.hero_images.length : 0;
    if (v.images === "Automatic") {
      notes.push(
        `Images are picked as on the New Site screen: ${own ? "your hero images" : "the best stock photos for the hero"} and each service${photos !== 0 ? `, and the client's ${photos ? plural(photos, "photo") : "photos"} as the gallery` : ""}.`,
      );
    } else if (v.images === "Client photos only") {
      notes.push(photos !== 0 ? `The client's ${photos ? plural(photos, "photo") : "photos"} go in the gallery; the template's photos fill the rest.` : "The lead has no photos on file, so the template's photos are kept.");
    } else notes.push("The template's own photos are kept.");
    notes.push(
      v.auto_deploy === false
        ? "When it is generated the site waits for review — publish it afterwards (build.deploy)."
        : "When it is generated the site goes live on its subdomain straight away: the lead's website link is set and its agent is told. No review step.",
    );
    notes.push("Generation starts on its own within a few minutes — open the run to start it at once and watch each page.");
    return {
      title: `Build a website for ${name || "the lead from an earlier step"}`,
      notes,
      link: isStepRef(v.lead) ? null : leadLink(str(v.lead)),
      confirmPhrase: name,
    };
  },
  async execute(v, ctx) {
    const lead = await visibleLead<LeadForBuild>(ctx, v.lead, LEAD_BUILD_COLS);
    if (!lead) throw new RouteError("That lead is not visible to you.", 404, null);
    const { images, note } = await buildImages(v, ctx, lead);
    const instructions = str(v.instructions).trim().slice(0, MAX_INSTRUCTIONS);
    const autoDeploy = v.auto_deploy !== false;
    const res = await callRoute<{ run: { id: string } }>(runsRoute, "POST", {
      path: "/api/site-builder/runs",
      body: {
        lead_id: lead.id,
        // Omitted, the route uses the lead's recommended template (the same default the screen applies).
        ...(typeof v.template === "string" ? { template_id: v.template } : {}),
        images,
        options: { auto_deploy: autoDeploy, ...(instructions ? { instructions } : {}) },
      },
    });
    const template = str(v.__template).replace(/ \(picked by sales.*\)$/, "");
    return {
      message:
        `Started building ${lead.business_name}'s website${template ? ` with ${template}` : ""} (${plural(images.length, "image")}${note ? `; ${note}` : ""}). ` +
        `It generates within a few minutes${autoDeploy ? " and publishes itself when ready" : ", then waits for review"}.`,
      link: runLink(res.run.id),
      data: { id: res.run.id, kind: "site_run" },
    };
  },
  undo: {
    minutes: 10,
    async run(stored, ctx) {
      const r = await cancelQueuedRuns(ctx, createdIds(stored));
      if (!r.cancelled) throw new RouteError("It has already started generating — stop it from the run screen instead.", 409, null);
      return "the build was cancelled before it started.";
    },
  },
};

/* ------------------------------------------------------------ build.regen */

/** Statuses the page-regenerate route accepts (runs/[id]/pages/[file]/regenerate). */
const REGENERATABLE = new Set<RunStatus>(["review", "approved", "failed"]);
/** Statuses the generate route claims (lib/site-builder/generateRun.ts RESUMABLE). */
const RESUMABLE = new Set<RunStatus>(["queued", "failed"]);

const hasPage = (v: Values) => typeof v.page === "string" && v.page.trim() !== "";

const buildRegen: ActionDef = {
  key: "build.regen",
  group: "Site Builder",
  title: "Regenerate a page of a build (or retry a failed build)",
  description:
    "Rewrite one page of a Site Builder run with the AI — optionally with an instruction like 'make the hero shorter' — while the run is waiting for review, approved, or failed. Name the page as the person does ('about page', 'contact'). With no page, it retries a FAILED run's failed pages (or starts a queued run now). A run in review cannot be regenerated as a whole: regenerate its pages, or start a new build.",
  confirmLabel: "Regenerate",
  risk: "standard",
  allowed,
  fields: [
    { name: "run", label: "Run", type: "ref", ref: "site_run", required: true, editable: false },
    {
      name: "page",
      label: "Page",
      type: "text",
      max: 200,
      editable: false,
      help: "The page to rewrite, as the person names it ('about page', 'Contact', 'services.html'). Leave empty only to retry a failed run's failed pages.",
    },
    {
      name: "instruction",
      label: "Instruction",
      type: "longtext",
      max: MAX_INSTRUCTIONS,
      showIf: hasPage,
      help: "Optional: what to change on that page, e.g. 'shorter hero, warmer tone'.",
    },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 2,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const values: Values = {};
    const run = await loadRun(ctx, v.run, `${RUN_COLS}, generation_id, pages`);
    if (typeof v.run === "string" && !isStepRef(v.run) && !run) problems.push({ field: "run", message: "That run no longer exists." });
    if (!run) return { problems };
    const name = joinedName(run.leads) || "this lead";
    values.__name = name;
    values.__status = run.status;

    if (hasPage(v)) {
      if (!REGENERATABLE.has(run.status)) {
        problems.push({
          field: "page",
          message:
            run.status === "deployed"
              ? `This run is deployed — regenerating a page would not change the live site. Start a new build for ${name} instead.`
              : `Cannot regenerate: this run is "${run.status}", not "review", "approved" or "failed".`,
        });
      } else if (run.generation_id) {
        // The route would discard the rewritten page (after paying for it): it stands aside for a claimed run.
        problems.push({ field: "run", message: "This run is still held by an earlier generation — use “Stop and recover” on the run screen first, then regenerate." });
      }
      const hit = matchPage(str(v.page), run.pages ?? {});
      if ("file" in hit) {
        values.__file = hit.file;
        values.__page = run.pages?.[hit.file]?.name ?? hit.file;
      } else problems.push({ field: "page", message: hit.problem, ...(hit.choices ? { choices: hit.choices } : {}) });
      return { problems, values };
    }

    const stale = run.status === "generating" && ctx.now.getTime() - new Date(run.updated_at).getTime() > STALE_GENERATING_MS;
    if (!RESUMABLE.has(run.status) && !stale) {
      problems.push({
        field: "_",
        message:
          run.status === "generating"
            ? "This run is generating right now — wait for it to finish."
            : `A run that is ${STATUS_WORDS[run.status]} cannot be regenerated as a whole. Name a page to rewrite, or start a new build for ${name}.`,
      });
    }
    return { problems, values };
  },
  async preview(v) {
    const name = str(v.__name) || "the new build";
    const link = isStepRef(v.run) ? null : runLink(str(v.run));
    if (hasPage(v)) {
      return {
        title: `Regenerate ${str(v.__page)} — ${name}`,
        warnings: ["The current version of this page is replaced (it is not kept)."],
        notes: ["Only this page is rewritten; it can take a few minutes. The rest of the run stays as it is."],
        link,
        before: { status: v.__status },
      };
    }
    return {
      title: v.__status === "queued" ? `Start ${name}'s build now` : `Retry the failed pages — ${name}`,
      notes: [
        v.__status === "queued"
          ? "It starts generating now instead of waiting for the background processor."
          : "Only the pages that failed are generated again — finished pages are kept and cost nothing.",
        "It keeps running in the background; watch it on the run screen.",
      ],
      link,
      before: { status: v.__status },
    };
  },
  async stale(before, v, ctx) {
    const b = before as { status?: string } | null;
    const run = await loadRun(ctx, v.run, "id, status, updated_at");
    if (!run) return "the run no longer exists.";
    return b?.status && run.status !== b.status ? `the run is ${STATUS_WORDS[run.status]} now.` : null;
  },
  async execute(v) {
    const id = str(v.run);
    const name = str(v.__name);
    if (hasPage(v)) {
      const file = str(v.__file);
      const instruction = str(v.instruction).trim();
      await callRoute(regenerateRoute, "POST", {
        path: `/api/site-builder/runs/${id}/pages/${encodeURIComponent(file)}/regenerate`,
        // The route decodes its own segment, exactly as for the run screen's URL.
        params: { id, file: encodeURIComponent(file) },
        body: { instruction: instruction || undefined },
      });
      return { message: `Regenerated ${str(v.__page)} on ${name}'s site.`, link: runLink(id), data: { id, file } };
    }
    // A whole-run generation can take most of an hour: like the run screen's Retry,
    // it is started here and left running; only an immediate refusal is reported.
    const outcome = await settleWithin(callRoute<{ run?: { status?: string } }>(generateRoute, "POST", { path: `/api/site-builder/runs/${id}/generate`, params: { id } }), GENERATE_WAIT_MS);
    if (outcome.state === "rejected") throw outcome.error;
    if (outcome.state === "fulfilled") {
      const status = outcome.value.run?.status as RunStatus | undefined;
      return { message: `${name}'s run is ${status ? STATUS_WORDS[status] : "updated"}.`, link: runLink(id), data: { id } };
    }
    return { message: `${v.__status === "queued" ? "Started" : "Retrying the failed pages of"} ${name}'s build — it keeps running in the background.`, link: runLink(id), data: { id } };
  },
};

/* ----------------------------------------------------------- build.deploy */

const buildDeploy: ActionDef = {
  key: "build.deploy",
  group: "Site Builder",
  title: "Publish a built website",
  description:
    "Approve a Site Builder run that is waiting for review and deploy it to its live subdomain — the run screen's Approve, then Deploy. The lead's website link is set to the site and its agent is told. Only a run waiting for review (or already approved) can be published.",
  confirmLabel: "Publish site",
  risk: "critical",
  allowed,
  fields: [{ name: "run", label: "Run", type: "ref", ref: "site_run", required: true, editable: false }],
  label: (v) => str(v.__name),
  minutesSaved: 3,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const run = await loadRun(ctx, v.run);
    if (typeof v.run === "string" && !isStepRef(v.run) && !run) problems.push({ field: "run", message: "That run no longer exists." });
    if (!run) return { problems };
    const name = joinedName(run.leads) || "this lead";
    if (run.status === "deployed") problems.push({ field: "run", message: `This run is already live${run.deployed_url ? ` at ${run.deployed_url}` : ""}.` });
    else if (run.status !== "review" && run.status !== "approved") {
      problems.push({
        field: "run",
        message:
          run.status === "failed"
            ? "This run failed — retry it or regenerate its failed pages before publishing."
            : `This run is still ${run.status} — it can be published once it is waiting for review.`,
      });
    } else if (!run.output_path) problems.push({ field: "run", message: "Cannot deploy: it has no packaged zip — regenerate one of its pages to package it." });
    if (!run.lead_id) problems.push({ field: "run", message: "This run has no lead." });
    if (!daConfigured()) problems.push({ field: "_", message: "Deployment is not configured. Set DA_HOST, DA_USERNAME, DA_LOGIN_KEY, DA_DOMAIN." });
    return { problems, values: { __name: name, __status: run.status, __lead: run.lead_id } };
  },
  async preview(v, ctx) {
    const name = str(v.__name);
    const daDomain = process.env.DA_DOMAIN ?? "";
    const leadId = typeof v.__lead === "string" ? v.__lead : null;
    const warnings: string[] = [];
    let sub: string | null = null;
    if (leadId) {
      const { data } = await ctx.admin.from("leads").select("id, business_name, website_link").eq("id", leadId).maybeSingle();
      const lead = data as { business_name: string; website_link: string | null } | null;
      // Where it will land: the subdomain the lead is already live on, else a free one from its name (lib/site-builder/deploy.ts).
      sub = reusableSubdomain(lead?.website_link, daDomain);
      if (sub) warnings.push(`It replaces the site live at ${sub}.${daDomain} now.`);
      else {
        sub = await firstFreeVersion(baseSubdomain(lead?.business_name ?? name), (s) => claimedByAnotherLead(ctx.admin, s, leadId)).catch(() => null);
        if (lead?.website_link) warnings.push(`${name}'s website link (${lead.website_link}) is changed to the new site.`);
      }
    }
    return {
      title: `Publish ${name ? `${name}'s website` : "the new build"}${sub && daDomain ? ` to ${sub}.${daDomain}` : ""}`,
      warnings,
      notes: [
        ...(v.__status === "review" ? ["The run is approved first, then deployed."] : []),
        "The site goes live on a public address, the lead's website link is set to it, and its agent is told.",
        "To take it offline again later, use site.takedown.",
      ],
      link: runLink(str(v.run)),
      confirmPhrase: name,
      before: { status: v.__status },
    };
  },
  async stale(before, v, ctx) {
    const b = before as { status?: string } | null;
    const run = await loadRun(ctx, v.run, "id, status, updated_at");
    if (!run) return "the run no longer exists.";
    return b?.status && run.status !== b.status ? `the run is ${STATUS_WORDS[run.status]} now.` : null;
  },
  async execute(v) {
    const id = str(v.run);
    if (v.__status === "review") await callRoute(approveRoute, "POST", { path: `/api/site-builder/runs/${id}/approve`, params: { id } });
    const res = await callRoute<{ url: string; reused?: boolean; clearWarning?: string | null }>(deployRoute, "POST", { path: `/api/site-builder/runs/${id}/deploy`, params: { id } });
    return {
      message: `${str(v.__name)}'s website is live at ${res.url}.${res.clearWarning ? ` ${res.clearWarning}` : ""}`,
      link: { href: res.url, label: "Open site" },
      data: { id, url: res.url },
    };
  },
};

/* ------------------------------------------------------------- build.bulk */

const ACTIVE = new Set(["queued", "generating"]);

const buildBulk: ActionDef = {
  key: "build.bulk",
  group: "Site Builder",
  title: "Start website builds for many leads",
  description:
    "Queue one Site Builder run per lead (at most 50), all with the same template — the Runs board's Bulk generate. The background processor builds them one at a time; bulk builds never publish themselves (each waits for review) and pick no images (each keeps the template's photos). Leads that already have a build queued or generating are skipped. Find the leads first, then pass their ids.",
  confirmLabel: "Queue builds",
  risk: "sensitive",
  allowed,
  fields: [
    { name: "leads", label: "Leads", type: "refs", ref: "lead", required: true, min: 1, max: MAX_BULK_LEADS, editable: false },
    { name: "template", label: "Template", type: "ref", ref: "builder_template", required: true, help: "One template for every lead in the batch — ask which." },
    { name: "instructions", label: "Instructions for the AI", type: "longtext", max: MAX_INSTRUCTIONS, help: "Optional: applied to every site in the batch." },
  ],
  bulkField: "leads",
  minutesSaved: 10,
  async preview(v, ctx) {
    const ids = v.leads as string[];
    const [{ data: leadRows }, { data: runRows }, { data: t }] = await Promise.all([
      ctx.db.from("leads").select("id, business_name, status").in("id", ids).is("deleted_at", null),
      ctx.admin.from("builder_runs").select("lead_id, status, created_at").in("lead_id", ids).order("created_at", { ascending: false }),
      ctx.admin.from("builder_templates").select("name").eq("id", str(v.template)).maybeSingle(),
    ]);
    const leads = (leadRows ?? []) as { id: string; business_name: string; status: string }[];
    const latest = new Map<string, string>();
    const active = new Set<string>();
    for (const r of (runRows ?? []) as { lead_id: string; status: string }[]) {
      if (!latest.has(r.lead_id)) latest.set(r.lead_id, r.status);
      if (ACTIVE.has(r.status)) active.add(r.lead_id);
    }
    const items: CardItem[] = leads.map((l) => {
      const last = latest.get(l.id);
      const run = active.has(l.id)
        ? "already has a build queued or generating — it will be skipped"
        : last
          ? last === "deployed"
            ? "already has a published build"
            : `already has a run (${STATUS_WORDS[last as RunStatus] ?? last})`
          : null;
      return { id: l.id, label: l.business_name, detail: [l.status, run].filter(Boolean).join(" · "), href: `/leads/${l.id}`, selected: true };
    });
    const warnings: string[] = [];
    const skipped = leads.filter((l) => active.has(l.id)).length;
    if (skipped) warnings.push(`${plural(skipped, "lead")} already ${skipped === 1 ? "has" : "have"} a build queued or generating and will be skipped.`);
    const notReady = leads.filter((l) => l.status !== "Not Ready").length;
    if (notReady) warnings.push(`${plural(notReady, "lead")} ${notReady === 1 ? "is" : "are"} not Not Ready — the bulk picker only offers Not Ready leads.`);
    if (leads.length < ids.length) warnings.push(`${plural(ids.length - leads.length, "lead")} could not be found and will be skipped.`);
    return {
      title: `Queue ${plural(leads.length, "website build")} with ${str((t as { name?: string } | null)?.name) || "the template"}`,
      items,
      warnings,
      notes: [
        "Bulk builds never publish themselves — each waits for review; publish them one by one (build.deploy).",
        "The processor builds one site at a time, so a batch takes a while. Watch it on the Runs board.",
        "No images are picked in bulk: each site keeps the template's photos (regenerate pages afterwards to change them).",
      ],
      link: RUNS_LINK,
    };
  },
  async execute(v) {
    const ids = v.leads as string[];
    const instructions = str(v.instructions).trim().slice(0, MAX_INSTRUCTIONS);
    const res = await callRoute<{ results?: ({ lead_id: string; created: string } | { lead_id: string; skipped: string })[]; created?: number; skipped?: number }>(
      bulkRoute,
      "POST",
      { path: "/api/site-builder/runs/bulk", body: { lead_ids: ids, template_id: v.template, ...(instructions ? { options: { instructions } } : {}) } },
    );
    const results = res.results ?? [];
    const created = results.flatMap((r) => ("created" in r ? [r.created] : []));
    const reasons = [...new Set(results.flatMap((r) => ("skipped" in r ? [r.skipped] : [])))];
    return {
      message: `Queued ${plural(created.length, "website build")}${reasons.length ? `; skipped ${results.length - created.length} (${reasons.join("; ")})` : ""}.`,
      link: RUNS_LINK,
      data: { ids: created },
      undoable: created.length > 0,
    };
  },
  undo: {
    minutes: 10,
    async run(stored, ctx) {
      const r = await cancelQueuedRuns(ctx, createdIds(stored));
      if (!r.cancelled) throw new RouteError("Every build has already started — stop them from the run screens instead.", 409, null);
      return `${plural(r.cancelled, "build")} cancelled${r.started ? ` (${r.started} had already started and keep going)` : ""}.`;
    },
  },
};

/* ----------------------------------------------------------- build.delete */

const buildDelete: ActionDef = {
  key: "build.delete",
  group: "Site Builder",
  title: "Delete a Site Builder run",
  description:
    "Delete a run with its pages and packaged zip. A deployed run's live site stays up (take it down with site.takedown). A run that is still queued or generating cannot be deleted.",
  confirmLabel: "Delete run",
  risk: "critical",
  allowed,
  fields: [{ name: "run", label: "Run", type: "ref", ref: "site_run", required: true, editable: false }],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const run = await loadRun(ctx, v.run);
    if (typeof v.run === "string" && !isStepRef(v.run) && !run) problems.push({ field: "run", message: "That run no longer exists." });
    if (!run) return { problems };
    if (activeAndFresh(run, ctx.now)) {
      problems.push({ field: "run", message: "This run is still generating — wait for it to finish, or use Stop and recover to release it, then delete it." });
    }
    return { problems, values: { __name: joinedName(run.leads) || "this lead", __status: run.status, __url: run.deployed_url } };
  },
  async preview(v) {
    const name = str(v.__name);
    const warnings = ["The run's pages and packaged zip are deleted for good."];
    if (v.__status === "deployed") warnings.push(`Its site stays live${v.__url ? ` at ${str(v.__url)}` : ""} — take it down separately (site.takedown) if it should go.`);
    const status = STATUS_WORDS[v.__status as RunStatus];
    return {
      title: name ? `Delete ${name}'s run${status ? ` (${status})` : ""}` : "Delete the new build's run",
      warnings,
      link: isStepRef(v.run) ? null : runLink(str(v.run)),
      confirmPhrase: name,
      before: { status: v.__status },
    };
  },
  async stale(before, v, ctx) {
    const b = before as { status?: string } | null;
    const run = await loadRun(ctx, v.run, "id, status, updated_at");
    if (!run) return "the run no longer exists.";
    return b?.status && run.status !== b.status ? `the run is ${STATUS_WORDS[run.status]} now.` : null;
  },
  async execute(v) {
    const id = str(v.run);
    await callRoute(runRoute, "DELETE", { path: `/api/site-builder/runs/${id}`, params: { id } });
    return { message: `Deleted ${str(v.__name)}'s run.`, link: RUNS_LINK, data: { id } };
  },
};

export const SITE_BUILDER_ACTIONS: ActionDef[] = [buildStart, buildRegen, buildDeploy, buildBulk, buildDelete];
