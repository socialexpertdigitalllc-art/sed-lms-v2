import { reportTask, startTask, TaskStoreError } from "../tasks";
import { ToolError, type AssistantTool, type ToolContext } from "./types";

/**
 * The tools that make a long job self-sustaining (see ../tasks.ts): SED AI
 * starts a background task for a job too big for one answer, and reports its
 * progress each run — "done" ends it. Between runs it carries on by itself,
 * with nobody watching and no browser open.
 */

function requireAct(ctx: ToolContext) {
  if (!ctx.act || ctx.act.mode !== "act") throw new ToolError("Act mode is not on for this request.");
  return ctx.act;
}

function storeFailure(e: unknown): never {
  if (e instanceof TaskStoreError && /assistant_tasks|does not exist|schema cache/i.test(e.message)) {
    throw new ToolError("Background tasks aren't set up yet (an admin needs to apply migration 0092). Carry on in this answer as far as you can and say how far it got.");
  }
  throw e;
}

export const startBackgroundTaskTool: AssistantTool = {
  name: "start_background_task",
  label: "Starting a background task",
  description:
    "For a job too big for one answer — hundreds of records (\"categorise every lead\", \"set the status of all old leads\"): start it as a background task at the START of the job. SED AI then keeps working on it by itself, run after run, even with this page closed, until you report it done with update_task_progress. After starting it, keep working in this answer as usual. Needs a permission mode that lets changes run on their own (otherwise call request_permission_mode first). One per chat.",
  parameters: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "The WHOLE job in the person's terms, with every rule they gave (which records, what to set, what to leave for them, what to report at the end) — later runs only know what you write here and what the chat shows.",
      },
      progress: { type: "string", description: "Anything already done, if this answer did some of it." },
    },
    required: ["goal"],
  },
  available: (perms) => perms.has("assistant.act"),
  modes: ["act"],
  sequential: true,
  async run(args, ctx) {
    const act = requireAct(ctx);
    if (act.task) {
      return {
        data: { status: "already_running", task_id: act.task.id, goal: act.task.goal, next: "This chat already has a background task running — carry on with it." },
        summary: "A background task is already running",
      };
    }
    if (!act.autonomous) {
      throw new ToolError("A background task makes its changes with nobody there to press buttons, so it needs a permission mode that lets changes run on their own. Call request_permission_mode first (once per chat).");
    }
    const goal = String(args.goal ?? "").trim();
    if (goal.length < 10) throw new ToolError("Describe the whole job in goal — what to do, to which records, and any rules they gave.");
    const progress = typeof args.progress === "string" ? args.progress : "";
    const { task, created } = await startTask(ctx.admin, {
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      goal,
      progress,
      permissionMode: act.auto?.mode ?? null,
    }).catch(storeFailure);
    act.task = { id: task.id, goal: task.goal, background: false, progressSet: false };
    return {
      data: {
        status: created ? "started" : "already_running",
        task_id: task.id,
        next: "Keep working on it now, batch after batch. When this answer's budget runs out, SED AI carries on by itself in the background — the person does NOT need to say \"continue\". In every run, call update_task_progress before your final message; status \"done\" only when the WHOLE job is finished.",
      },
      summary: created ? "Background task started" : "A background task is already running",
    };
  },
};

export const updateTaskProgressTool: AssistantTool = {
  name: "update_task_progress",
  label: "Saving the task's progress",
  description:
    "Record how far this chat's background task has got: what is done, what is left, and anything waiting on the person. status: \"working\" (more to do — it carries on by itself), \"done\" (the WHOLE job is finished: say what was done and list anything left for the person), \"blocked\" (it can't go on without the person — put your question in progress), \"stopped\" (the person asked you to stop it). Call it before your final message in every background run.",
  parameters: {
    type: "object",
    properties: {
      progress: { type: "string", description: "Numbers and facts: e.g. \"412 of 822 categorised; next: leads created before Aug 1; 9 left for you: …\"." },
      status: { type: "string", enum: ["working", "done", "blocked", "stopped"] },
    },
    required: ["progress", "status"],
  },
  available: (perms) => perms.has("assistant.act"),
  modes: ["act"],
  sequential: true,
  async run(args, ctx) {
    const act = requireAct(ctx);
    if (!act.task) throw new ToolError("There is no background task running in this chat. To start one, call start_background_task.");
    const status = args.status;
    if (status !== "working" && status !== "done" && status !== "blocked" && status !== "stopped") throw new ToolError('status is "working", "done", "blocked" or "stopped".');
    const progress = String(args.progress ?? "").trim();
    if (!progress) throw new ToolError("Say how far it got in progress.");
    const saved = await reportTask(ctx.admin, act.task.id, { progress, status }).catch(storeFailure);
    act.task.progressSet = true;
    if (!saved) {
      return { data: { status: "not_running", next: "The task is no longer running (the person stopped it, or it finished). Don't continue it." }, summary: "The task is no longer running" };
    }
    const words = { working: "Progress saved", done: "Task done", blocked: "Waiting for them", stopped: "Task stopped" }[status];
    return {
      data: {
        status,
        next:
          status === "working"
            ? act.task.background
              ? "Saved. Finish this run with a few lines on what it did; the next run continues automatically."
              : "Saved. It continues by itself."
            : status === "done"
              ? "The task is finished. Give the person the final summary (and anything left for them)."
              : status === "blocked"
                ? "It waits for them now. Ask your question in your final message."
                : "Stopped. Say so in one sentence.",
      },
      summary: words,
    };
  },
};

export const TASK_TOOLS: AssistantTool[] = [startBackgroundTaskTool, updateTaskProgressTool];
