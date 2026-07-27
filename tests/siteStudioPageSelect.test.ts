import { describe, it, expect } from "vitest";
import { selectPages, pageKindForName } from "@/lib/site-studio/run/pageSelect";
import type { TemplateManifest } from "@/lib/site-studio/schema";

const manifest = {
  engine: 3, name: "t", version: 1, identity: {}, theme: { mode: "none", roles: {} }, nav: [],
  pages: [
    { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "", slots: [], repeats: [] },
    { id: "about", file: "about.html", kind: "about", stampable: false, title_sample: "", slots: [], repeats: [] },
    { id: "services", file: "services.html", kind: "services_hub", stampable: false, title_sample: "", slots: [], repeats: [] },
    { id: "contact", file: "contact.html", kind: "contact", stampable: false, title_sample: "", slots: [], repeats: [] },
    { id: "svc", file: "service.html", kind: "service", stampable: true, title_sample: "", slots: [], repeats: [] },
  ],
} as unknown as TemplateManifest;

describe("pageKindForName", () => {
  it("maps how sales actually types page names", () => {
    expect(pageKindForName("Home")).toBe("home");
    expect(pageKindForName("About Us")).toBe("about");
    expect(pageKindForName("our services")).toBe("services_hub");
    expect(pageKindForName("Service Areas")).toBe("areas_hub");
    expect(pageKindForName("Contact Us")).toBe("contact");
    expect(pageKindForName("Gallery")).toBe("gallery");
    expect(pageKindForName("Something Odd")).toBeNull();
  });

  it("maps the reviews/testimonials synonym group", () => {
    expect(pageKindForName("Testimonials")).toBe("reviews");
    expect(pageKindForName("Reviews")).toBe("reviews");
    expect(pageKindForName("Customer Reviews")).toBe("reviews");
    expect(pageKindForName("What Our Customers Say")).toBe("reviews");
    expect(pageKindForName("Feedback")).toBe("reviews");
  });

  it("still matches a canonical phrase embedded in extra words", () => {
    expect(pageKindForName("Areas We Serve")).toBe("areas_hub");
  });

  it("never builds a plausible-but-wrong page from a short or garbled name", () => {
    // Previously matched via a reverse "canonical phrase contains input"
    // fallback: "Us" -> about, "Get" -> contact, "Do" -> services_hub,
    // "Work" -> gallery. That's worse than not matching at all.
    expect(pageKindForName("Us")).toBeNull();
    expect(pageKindForName("Get")).toBeNull();
    expect(pageKindForName("Do")).toBeNull();
    expect(pageKindForName("Work")).toBeNull();
  });
});

describe("selectPages", () => {
  it("uses the requested pages, always builds home first", () => {
    const r = selectPages(manifest, { requested: ["About Us", "Contact"], services: [], areas: [] });
    expect(r.pages.map((p) => p.page_id)).toEqual(["index", "about", "contact"]);
    expect(r.skipped).toEqual([]);
  });
  it("falls back to every non-stampable page when nothing was requested", () => {
    const r = selectPages(manifest, { requested: [], services: [], areas: [] });
    expect(r.pages.map((p) => p.page_id)).toEqual(["index", "about", "services", "contact"]);
  });
  it("reports requested pages the template cannot provide", () => {
    const r = selectPages(manifest, { requested: ["Home", "Blog"], services: [], areas: [] });
    expect(r.pages.map((p) => p.page_id)).toEqual(["index"]);
    expect(r.skipped).toEqual(["Blog"]);
  });
  it("stamps one page per service when fan-out is on", () => {
    const r = selectPages(manifest, {
      requested: ["Home"], services: ["Drain Cleaning", "Water Heaters"], areas: [],
      fanOutServices: true,
    });
    const stamped = r.pages.filter((p) => p.page_id === "svc");
    expect(stamped).toHaveLength(2);
    expect(stamped[0].output).toBe("services/drain-cleaning.html");
    expect(stamped[0].stamp_value).toBe("Drain Cleaning");
    expect(stamped[1].output).toBe("services/water-heaters.html");
  });
  it("does not stamp when fan-out is off, and never stamps without items", () => {
    expect(selectPages(manifest, { requested: ["Home"], services: ["A"], areas: [] })
      .pages.some((p) => p.page_id === "svc")).toBe(false);
    expect(selectPages(manifest, { requested: ["Home"], services: [], areas: [], fanOutServices: true })
      .pages.some((p) => p.page_id === "svc")).toBe(false);
  });
  it("never lets two services collide on the same stamped output - the loser is surfaced, not dropped", () => {
    const r = selectPages(manifest, {
      requested: ["Home"], services: ["Drain Cleaning", "drain  cleaning!"], areas: [],
      fanOutServices: true,
    });
    const stamped = r.pages.filter((p) => p.page_id === "svc");
    expect(stamped).toHaveLength(1);
    expect(stamped[0].output).toBe("services/drain-cleaning.html");
    expect(stamped[0].stamp_value).toBe("Drain Cleaning");
    expect(r.skipped).toEqual(["drain  cleaning!"]);
  });
});
