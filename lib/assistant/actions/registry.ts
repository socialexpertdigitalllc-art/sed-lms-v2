import { ADMIN_ACTIONS } from "./defs/admin";
import { AGENT_ACTIONS } from "./defs/agent";
import { AUTOMATION_ACTIONS } from "./defs/automation";
import { CMS_ACTIONS } from "./defs/cms";
import { DOMAIN_ACTIONS } from "./defs/domains";
import { EMAIL_ACTIONS } from "./defs/email";
import { FORM_ACTIONS } from "./defs/forms";
import { LEAD_ACTIONS } from "./defs/leads";
import { MONEY_ACTIONS } from "./defs/money";
import { PERSONAL_ACTIONS } from "./defs/personal";
import { PRELEAD_ACTIONS } from "./defs/preleads";
import { SITE_BUILDER_ACTIONS } from "./defs/sitebuilder";
import { TICKET_ACTIONS } from "./defs/tickets";
import type { ActionContext, ActionDef } from "./types";

/**
 * Every action SED AI can propose. SERVER ONLY.
 *
 * Adding an action = writing its definition in ./defs and listing it here.
 * Who may use it is decided per person by the definition's `allowed` (their
 * permissions), by the admin's per-action switch, and by `assistant.act`.
 */

export const ACTION_DEFS: ActionDef[] = [
  ...LEAD_ACTIONS,
  ...PRELEAD_ACTIONS,
  ...TICKET_ACTIONS,
  ...AGENT_ACTIONS,
  ...SITE_BUILDER_ACTIONS,
  ...DOMAIN_ACTIONS,
  ...MONEY_ACTIONS,
  ...EMAIL_ACTIONS,
  ...CMS_ACTIONS,
  ...FORM_ACTIONS,
  ...PERSONAL_ACTIONS,
  ...ADMIN_ACTIONS,
  ...AUTOMATION_ACTIONS,
];

const BY_KEY = new Map(ACTION_DEFS.map((d) => [d.key, d]));

export function getActionDef(key: string): ActionDef | undefined {
  return BY_KEY.get(key.trim());
}

/** The catalogue as the model sees it in Act mode: one line per action, grouped. */
export function actionCatalogue(ctx: ActionContext, disabled: Set<string>): string {
  const groups = new Map<string, string[]>();
  for (const d of ACTION_DEFS) {
    if (disabled.has(d.key)) continue;
    const blocked = d.allowed(ctx);
    const line = `- ${d.key}: ${d.title}${blocked ? " (needs an approver for you)" : ""}`;
    groups.set(d.group, [...(groups.get(d.group) ?? []), line]);
  }
  return [...groups.entries()].map(([g, lines]) => `${g}:\n${lines.join("\n")}`).join("\n");
}
