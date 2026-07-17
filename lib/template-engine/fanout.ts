// Template Engine v2 — individual service / service-area page fan-out.
//
// The client's website should have one page per service and one per service
// area (standard for local-SEO home-service sites). The template ships ONE
// sample of each — a `service_detail` page (e.g. service-kitchen.html) and an
// `area_detail` page (e.g. area-cherry-creek.html). This module decides which
// individual pages to generate from those samples, driven entirely by the
// lead's data (no operator toggles):
//   - one service page per service, ONLY when the Services hub is being built
//     and the template has a service_detail sample;
//   - one area page per service area, ONLY when the Areas hub is being built,
//     the lead has areas, and the template has an area_detail sample.
//
// Each fanned page is later regenerated from its sample, focused on that one
// service/area, and linked from the hub. Pure: no I/O.

import { businessSlug } from "./slug";

export interface FanoutInput {
  services: { key: string; name: string }[];
  areas: string[];
  manifestPages: { file: string; kind: string }[];
  /** The standard pages resolved from the lead (leadPages.resolveLeadPages). */
  buildFiles: string[];
}

export interface FanoutPage {
  file: string; // e.g. "service-kitchen-remodeling.html"
  sampleFile: string; // the template sample to rewrite, e.g. "service-kitchen.html"
  kind: "service_detail" | "area_detail";
  focus: string; // the service/area name this page centers on
  focusKey: string; // service.key (image lookup) or the slugged area
}

export interface FanoutPlan {
  pages: FanoutPage[];
  serviceHub: string | null; // the services_hub file, when it is being built
  areaHub: string | null; // the areas_hub file, when it is being built
  sampleServiceFile: string | null;
  sampleAreaFile: string | null;
  /** Sample detail files that must NOT ship as-is — the fanned pages replace them. */
  replacedSamples: string[];
}

function firstFileOfKind(pages: { file: string; kind: string }[], kind: string): string | null {
  return pages.find((p) => p.kind === kind)?.file ?? null;
}

/** Slug -> "service-<slug>.html", deduping collisions with -2, -3, … */
function uniqueFile(prefix: string, name: string, taken: Set<string>): string {
  const slug = businessSlug(name);
  let file = `${prefix}-${slug}.html`;
  let n = 2;
  while (taken.has(file)) file = `${prefix}-${slug}-${n++}.html`;
  taken.add(file);
  return file;
}

export function planFanout(input: FanoutInput): FanoutPlan {
  const { services, areas, manifestPages, buildFiles } = input;
  const built = new Set(buildFiles);

  const serviceHub = firstFileOfKind(manifestPages, "services_hub");
  const areaHub = firstFileOfKind(manifestPages, "areas_hub");
  const sampleServiceFile = firstFileOfKind(manifestPages, "service_detail");
  const sampleAreaFile = firstFileOfKind(manifestPages, "area_detail");

  const pages: FanoutPage[] = [];
  const taken = new Set<string>();
  const replacedSamples: string[] = [];

  const expandServices = !!sampleServiceFile && !!serviceHub && built.has(serviceHub) && services.length > 0;
  if (expandServices) {
    replacedSamples.push(sampleServiceFile!);
    for (const s of services) {
      pages.push({
        file: uniqueFile("service", s.name, taken),
        sampleFile: sampleServiceFile!,
        kind: "service_detail",
        focus: s.name,
        focusKey: s.key,
      });
    }
  }

  const expandAreas = !!sampleAreaFile && !!areaHub && built.has(areaHub) && areas.length > 0;
  if (expandAreas) {
    replacedSamples.push(sampleAreaFile!);
    for (const a of areas) {
      pages.push({
        file: uniqueFile("area", a, taken),
        sampleFile: sampleAreaFile!,
        kind: "area_detail",
        focus: a,
        focusKey: businessSlug(a),
      });
    }
  }

  return {
    pages,
    serviceHub: expandServices ? serviceHub : null,
    areaHub: expandAreas ? areaHub : null,
    sampleServiceFile: expandServices ? sampleServiceFile : null,
    sampleAreaFile: expandAreas ? sampleAreaFile : null,
    replacedSamples,
  };
}
