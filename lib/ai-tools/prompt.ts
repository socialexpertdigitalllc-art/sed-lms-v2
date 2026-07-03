// Website-generation prompt, ported faithfully from the legacy WebCraft /
// DeepSeek dashboards (prompt "version 4"). Shared by client (preview/edit in
// Step 2) and server. Both generators use the same prompt.

import { renderTemplate } from "./template";
import { DEFAULT_PROMPT_TEMPLATE } from "./wge-defaults";

export interface GenInput {
  name: string;
  phone: string;
  email: string;
  services: string;
  exp: string;
  profile: string;
  pages: string; // number, as string from the form
  pageNames: string;
  google: string;
  map: string;
  hero: string;
  logo: string;
  serviceImgs: string;
  imgs: string;
  color: string;
  r1: string;
  r2: string;
  r3: string;
  r4: string;
  extra: string;
}

export const EMPTY_INPUT: GenInput = {
  name: "",
  phone: "",
  email: "",
  services: "",
  exp: "",
  profile: "",
  pages: "5",
  pageNames: "",
  google: "",
  map: "",
  hero: "",
  logo: "",
  serviceImgs: "",
  imgs: "",
  color: "",
  r1: "",
  r2: "",
  r3: "",
  r4: "",
  extra: "",
};

export function defaultPages(n: string): string {
  const count = parseInt(n) || 5;
  return ["Home", "About", "Services", "Gallery", "Contact", "Blog", "FAQ", "Testimonials", "Portfolio", "Team"]
    .slice(0, count)
    .join(", ");
}

/** Resolve the substitution context (raw values + derived variables). */
export function buildContext(d: GenInput): Record<string, string> {
  const refs = [d.r1, d.r2, d.r3, d.r4].filter(Boolean);
  return {
    name: d.name,
    phone: d.phone,
    email: d.email,
    services: d.services,
    exp: d.exp,
    color: d.color,
    profile: d.profile,
    pages: d.pages,
    pageNames: d.pageNames,
    google: d.google,
    map: d.map,
    hero: d.hero,
    serviceImgs: d.serviceImgs,
    logo: d.logo,
    imgs: d.imgs,
    r1: d.r1, r2: d.r2, r3: d.r3, r4: d.r4,
    extra: d.extra,
    // derived
    references: refs.length ? refs.join("\n") : "(none provided — use your best design judgement)",
    ref_count: String(refs.length || 4),
    experience: d.exp ? `${d.exp} Years` : "(not provided)",
    page_names: d.pageNames || defaultPages(d.pages),
  };
}

export function buildPrompt(d: GenInput, template: string = DEFAULT_PROMPT_TEMPLATE): string {
  return renderTemplate(template, buildContext(d));
}
