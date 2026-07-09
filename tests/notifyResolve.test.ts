import { describe, it, expect } from "vitest";
import { expandTargets } from "@/lib/notifications/resolve";

const rule = (o: any) => ({ event_key:"x", enabled:true, target_departments:[], target_users:[], target_roles:[], delay_minutes:0, ...o });
const ctx = { lead:{ agent_id:"agent1", closed_by:"closer1" }, ticket:{ assigned_to:"dev1", created_by:"sales1" }, feedback:{ user_id:"sub1" }, actorId:null };

describe("expandTargets", () => {
  it("disabled → empty", () => expect(expandTargets(rule({ enabled:false, target_users:["u1"] }), ctx, {})).toEqual([]));
  it("departments expand via member map", () => expect(expandTargets(rule({ target_departments:["admin"] }), ctx, { admin:["a1","a2"] }).sort()).toEqual(["a1","a2"]));
  it("users pass through", () => expect(expandTargets(rule({ target_users:["u1","u2"] }), ctx, {})).toEqual(["u1","u2"]));
  it("roles resolve from context", () => expect(expandTargets(rule({ target_roles:["lead_agent","ticket_assignee"] }), ctx, {}).sort()).toEqual(["agent1","dev1"]));
  it("dedups across sources", () => expect(expandTargets(rule({ target_users:["agent1"], target_roles:["lead_agent"] }), ctx, {})).toEqual(["agent1"]));
  it("excludes the actor", () => expect(expandTargets(rule({ target_roles:["lead_agent","ticket_creator"] }), { ...ctx, actorId:"sales1" }, {})).toEqual(["agent1"]));
  it("skips null role values", () => expect(expandTargets(rule({ target_roles:["lead_closer"] }), { ...ctx, lead:{ agent_id:"a", closed_by:null } }, {})).toEqual([]));
});
