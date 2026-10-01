// lib/domains/detail.ts — everything the domain page shows, in one read: the
// row (with its lead), its activity history and 30 days of health checks.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientDomainRow, HealthState } from "./types";

export type DomainWithLead = ClientDomainRow & { leads?: { business_name: string | null } | null };

export interface DomainActivity {
  id: string;
  action: string;
  at: string;
  by: string | null;
  value: Record<string, unknown> | null;
}

export interface DomainCheck {
  at: string;
  state: HealthState;
  http_status: number | null;
  ms: number | null;
  error: string | null;
}

export interface DomainDetail {
  domain: DomainWithLead;
  activity: DomainActivity[];
  checks: DomainCheck[];
  uptime30: number | null;
  avgMs30: number | null;
}

export async function loadDomainRow(admin: SupabaseClient, id: string): Promise<DomainWithLead | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("client_domains").select("*, leads(business_name)").eq("id", id).maybeSingle();
  return (data as DomainWithLead | null) ?? null;
}

export async function loadDomainDetail(admin: SupabaseClient, id: string, now = new Date()): Promise<DomainDetail | null> {
  const domain = await loadDomainRow(admin, id);
  if (!domain) return null;
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [{ data: log }, { data: checks }] = await Promise.all([
    admin
      .from("activity_log")
      .select("id, action, new_value, created_at, profiles(display_name)")
      .eq("entity_type", "client_domain")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(60),
    admin
      .from("client_domain_checks")
      .select("checked_at, state, http_status, ms, error")
      .eq("domain_id", id)
      .gte("checked_at", since)
      .order("checked_at", { ascending: true })
      .limit(500),
  ]);
  const activity: DomainActivity[] = (
    (log ?? []) as unknown as {
      id: string;
      action: string;
      new_value: Record<string, unknown> | null;
      created_at: string;
      profiles: { display_name: string | null } | { display_name: string | null }[] | null;
    }[]
  ).map((a) => {
    const p = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
    return { id: a.id, action: a.action, at: a.created_at, by: p?.display_name ?? null, value: a.new_value };
  });
  const list: DomainCheck[] = ((checks ?? []) as { checked_at: string; state: HealthState; http_status: number | null; ms: number | null; error: string | null }[]).map(
    (c) => ({ at: c.checked_at, state: c.state, http_status: c.http_status, ms: c.ms, error: c.error }),
  );
  const counted = list.filter((c) => c.state === "up" || c.state === "down" || c.state === "ssl_error");
  const up = counted.filter((c) => c.state === "up");
  const timed = up.filter((c) => typeof c.ms === "number");
  return {
    domain,
    activity,
    checks: list,
    uptime30: counted.length ? Math.round((up.length / counted.length) * 1000) / 10 : null,
    avgMs30: timed.length ? Math.round(timed.reduce((n, c) => n + (c.ms ?? 0), 0) / timed.length) : null,
  };
}
