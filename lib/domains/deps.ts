// lib/domains/deps.ts — the real dependencies of the domain pipeline.
import { request } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as cf from "@/lib/cloudflare/client";
import * as hostinger from "@/lib/hostinger/client";
import { findLiveStagingDeployment, goLiveOnDomain } from "@/lib/site-studio/deploy/golive";
import type { PipelineDeps } from "./pipeline";

/**
 * Does the hosting server at `ip` serve `domain`? Hostinger answers a hosted
 * domain with 200/301/302 and an unknown one with 403 (verified 2026-10-02:
 * independentac.com -> 301, an unknown host -> 403). null = no answer.
 */
export function probeVhost(ip: string, domain: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    const req = request(
      { host: ip, port: 80, path: "/", method: "GET", headers: { Host: domain, "User-Agent": "sed-lms-domain-check" }, timeout: 10000 },
      (res) => {
        res.resume();
        const s = res.statusCode ?? 0;
        resolve(s >= 200 && s < 400);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}

/** Public A records via Cloudflare's DNS-over-HTTPS resolver. */
export async function resolvesTo(domain: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { Answer?: { type: number; data: string }[] };
    return (j.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
  } catch {
    return null;
  }
}

export function realPipelineDeps(admin: SupabaseClient): PipelineDeps {
  return {
    admin,
    cf: {
      getRegistrationStatus: cf.getRegistrationStatus,
      getRegistration: cf.getRegistration,
      setAutoRenew: cf.setAutoRenew,
      findZone: cf.findZone,
      createZone: cf.createZone,
      listDnsRecords: cf.listDnsRecords,
      createDnsRecord: cf.createDnsRecord,
      updateDnsRecord: cf.updateDnsRecord,
      deleteDnsRecord: cf.deleteDnsRecord,
    },
    hostinger: {
      getWebsite: hostinger.getWebsite,
      ensureWebsite: hostinger.ensureWebsite,
      verifyDomainOwnership: hostinger.verifyDomainOwnership,
      ensureSsl: hostinger.ensureSsl,
      isStaticWebsite: hostinger.isStaticWebsite,
      websiteTypeLabel: hostinger.websiteTypeLabel,
      getHostingerPortfolioDomain: hostinger.getHostingerPortfolioDomain,
      completeHostingerDomainSetup: hostinger.completeHostingerDomainSetup,
      enableHostingerAutoRenew: hostinger.enableHostingerAutoRenew,
    },
    goLive: goLiveOnDomain,
    findStaging: findLiveStagingDeployment,
    probeVhost,
    resolvesTo,
    sandbox: cf.registrarSandbox(),
  };
}
