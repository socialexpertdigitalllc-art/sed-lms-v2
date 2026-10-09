import { CalcError, evaluate } from "../calc";
import type { ToolDefinition } from "../llm";
import { forgetMemoryTool, saveMemoryTool } from "./memory";
import { analyzeFollowUpsTool } from "./followups";
import { breakdownLeadsTool, leadDetailsTool, pipelineSummaryTool, searchLeadsTool } from "./leads";
import { preLeadsOverviewTool } from "./preleads";
import { teamActivityTool, teamPerformanceTool } from "./team";
import { ticketsOverviewTool } from "./tickets";
import { ToolError, type AssistantTool, type ToolContext } from "./types";

/**
 * Every tool the assistant can call, and the gate in front of them.
 *
 * A user's model is only ever SHOWN the tools their permissions allow — it
 * cannot ask for what it does not know exists — and `runTool` checks again
 * before running, so a model that invents a tool name gets an error, not
 * data. Inside each tool, rows are read through the user's own client: see
 * the scoping rule in ./types.ts.
 */

export const calculateTool: AssistantTool = {
  name: "calculate",
  label: "Calculating",
  description:
    "Evaluate an arithmetic expression exactly. Use it for EVERY figure you derive rather than read — growth rates, projections, targets, averages, percentages, what-ifs. Supports + - * / % (modulo) ^, parentheses, and abs sqrt cbrt round(x, digits) floor ceil min max sum avg log ln log10 log2 exp pow, plus pi and e. No variables: substitute the numbers.",
  parameters: {
    type: "object",
    properties: { expression: { type: "string", description: "e.g. round((48250 - 41200) / 41200 * 100, 1)" } },
    required: ["expression"],
  },
  available: () => true,
  async run(args) {
    try {
      const expression = String(args.expression ?? "");
      const result = evaluate(expression);
      return { data: { expression, result }, summary: `${expression} = ${result}` };
    } catch (e) {
      if (e instanceof CalcError) throw new ToolError(e.message);
      throw e;
    }
  },
};

export const ALL_TOOLS: AssistantTool[] = [
  pipelineSummaryTool,
  breakdownLeadsTool,
  searchLeadsTool,
  leadDetailsTool,
  analyzeFollowUpsTool,
  teamPerformanceTool,
  ticketsOverviewTool,
  preLeadsOverviewTool,
  teamActivityTool,
  calculateTool,
  saveMemoryTool,
  forgetMemoryTool,
];

export function toolsFor(perms: Set<string>): AssistantTool[] {
  return ALL_TOOLS.filter((t) => t.available(perms));
}

export function toolDefinitions(tools: AssistantTool[]): ToolDefinition[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters as unknown as Record<string, unknown> },
  }));
}

/** The longest tool result handed back to the model. Tools return aggregates
 *  and capped lists, so this only ever bites on a pathological request — and
 *  a truncated JSON tail is still better than blowing the context window. */
export const MAX_TOOL_RESULT_CHARS = 60_000;

export interface ToolRunOutcome {
  ok: boolean;
  /** Exactly what goes back to the model as the tool message. */
  content: string;
  summary: string;
  label: string;
  args: Record<string, unknown>;
  durationMs: number;
}

export function parseToolArgs(raw: string): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Run one call. Never throws: every failure becomes a tool result the model
 * can read and recover from ("that agent name matches two people — which?"),
 * because a thrown error would end the whole answer instead.
 */
export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolRunOutcome> {
  const started = Date.now();
  const tool = ALL_TOOLS.find((t) => t.name === name);
  const args = parseToolArgs(rawArgs);
  const finish = (ok: boolean, payload: unknown, summary: string): ToolRunOutcome => {
    let content = JSON.stringify(payload);
    if (content.length > MAX_TOOL_RESULT_CHARS) {
      content = `${content.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated — ask for a narrower slice]`;
    }
    return { ok, content, summary, label: tool?.label ?? name, args: args ?? {}, durationMs: Date.now() - started };
  };

  if (!tool || !tool.available(ctx.perms)) {
    return finish(false, { error: `There is no tool called "${name}" available to this user.` }, "Unavailable tool");
  }
  if (args === null) {
    return finish(false, { error: "The arguments were not a valid JSON object. Call again with valid JSON." }, "Invalid arguments");
  }
  try {
    const out = await tool.run(args, ctx);
    return finish(true, out.data, out.summary);
  } catch (e) {
    if (e instanceof ToolError) return finish(false, { error: e.message }, e.message);
    console.error(`[assistant] tool ${name} failed:`, e);
    return finish(false, { error: "This lookup failed on the server. Tell the user it could not be completed right now." }, "Lookup failed");
  }
}
