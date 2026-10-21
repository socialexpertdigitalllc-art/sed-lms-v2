// lib/domains/searchResponse.ts — the one answer both search routes give:
// /api/domains/search (buying, domains.purchase) and /api/domains/check
// (checking a name, domains.view). Kept apart from the routes so they can't drift.
import { NextResponse } from "next/server";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { searchDomainNames } from "./service";
import type { DomainRegistrar } from "./types";

export async function domainSearchResponse(url: URL): Promise<NextResponse> {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const registrar: DomainRegistrar = url.searchParams.get("registrar") === "hostinger" ? "hostinger" : "cloudflare";
  if (!q) return NextResponse.json({ results: [], exact: null, otherEndings: [], similar: [] });
  if (registrar === "cloudflare" && !cloudflareConfigured()) {
    return NextResponse.json({ error: "Cloudflare is not configured." }, { status: 422 });
  }
  if (registrar === "hostinger" && !hostingerConfigured()) {
    return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });
  }
  const found = await searchDomainNames(q, registrar);
  if (found === null) return NextResponse.json({ error: `Could not reach ${registrar === "cloudflare" ? "Cloudflare" : "Hostinger"} — try again.` }, { status: 502 });
  const results = [...(found.exact?.offer ? [found.exact.offer] : []), ...found.otherEndings, ...found.similar];
  return NextResponse.json({ ...found, results, registrar });
}
