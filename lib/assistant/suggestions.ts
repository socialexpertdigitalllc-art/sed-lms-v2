/**
 * Starter questions for an empty chat — only ones this user's assistant can
 * actually answer, so the first thing they try never hits a wall. PURE and
 * free of server imports, so the floating chat can offer them too.
 */
export function suggestionsFor(perms: Set<string>): string[] {
  const out: string[] = [];
  const team = perms.has("analytics.by_agent") || perms.has("analytics.view_all_agents") || perms.has("reports.agent_periodic");
  if (perms.has("leads.view")) {
    out.push(
      perms.has("leads.view_all")
        ? "How is the pipeline doing this month compared with last month?"
        : "How am I doing this month compared with last month?",
    );
    out.push("Which Ready leads should be called first today, and why?");
    out.push("At what time of day do our calls get picked up most — in the customer's own timezone?");
    out.push("Which business categories and states close best, and where are we wasting effort?");
  }
  if (team) out.push("Compare the agents this month — who is ahead, who is slipping, and what should each one work on?");
  if (perms.has("admin.logs.view")) out.push("Who was late or missing hours this week?");
  if (perms.has("tickets.view")) out.push("Which tickets are overdue, and who owns them?");
  out.push("Remember that my target is 10 closed websites a month.");
  return out.slice(0, 6);
}
