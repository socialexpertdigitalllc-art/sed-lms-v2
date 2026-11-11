import { describe, it, expect, beforeEach } from "vitest";
import { loadLeadDraft, saveLeadDraft, clearLeadDraft, mergeLeadDraft, leadDraftKey } from "@/lib/leads/leadDraft";
import { emptyNewLead } from "@/lib/leads/newLeadForm";

describe("lead draft on this device", () => {
  beforeEach(() => localStorage.clear());
  const blank = JSON.stringify(emptyNewLead("Not Ready"));

  it("saves and loads the form, per person", () => {
    const f = { ...emptyNewLead("Not Ready"), business_name: "Acme" };
    saveLeadDraft("u1", f, blank, 1234);
    expect(loadLeadDraft("u1")).toMatchObject({ savedAt: 1234, form: { business_name: "Acme" } });
    expect(loadLeadDraft("u2")).toBeNull();
  });

  it("a blank form is not kept", () => {
    saveLeadDraft("u1", { ...emptyNewLead("Not Ready"), business_name: "Acme" }, blank);
    saveLeadDraft("u1", emptyNewLead("Not Ready"), blank);
    expect(loadLeadDraft("u1")).toBeNull();
  });

  it("clear forgets it", () => {
    saveLeadDraft("u1", { ...emptyNewLead("Not Ready"), business_name: "Acme" }, blank);
    clearLeadDraft("u1");
    expect(localStorage.getItem(leadDraftKey("u1"))).toBeNull();
  });

  it("garbage or an older format reads as no draft", () => {
    localStorage.setItem(leadDraftKey("u1"), "{not json");
    expect(loadLeadDraft("u1")).toBeNull();
    localStorage.setItem(leadDraftKey("u1"), JSON.stringify({ v: 0, savedAt: 1, form: {} }));
    expect(loadLeadDraft("u1")).toBeNull();
  });

  it("merging keeps new fields' defaults, lists as lists, and only allowed statuses", () => {
    const fresh = emptyNewLead("Not Ready");
    const m = mergeLeadDraft(
      fresh,
      { business_name: "Acme", status: "Closed", developer_instructions: "old text" as never, services: ["Roofing"], unknown: 1 } as never,
      ["Not Ready", "Ready"],
    );
    expect(m.business_name).toBe("Acme");
    expect(m.status).toBe("Not Ready");
    expect(m.developer_instructions).toEqual(["old text"]);
    expect(m.services).toEqual(["Roofing"]);
    expect("unknown" in m).toBe(false);
    expect(m.color_scheme).toBe(fresh.color_scheme);
  });
});
