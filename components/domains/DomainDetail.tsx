"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, CalendarClock, CheckCircle2, Copy, ExternalLink, Globe, History, Link2, Loader2, RefreshCw, RotateCw, Stethoscope, Trash2, Unlink } from "lucide-react";
import { Panel, Pill } from "@/components/common/Panel";
import { BackLink } from "@/components/common/BackLink";
import { RelativeTime } from "@/components/common/RelativeTime";
import { btnGhostSm, btnPrimary, btnSecondary, btnSecondarySm } from "@/components/common/buttons";
import { cn } from "@/lib/utils";
import { DomainStatusPill, DomainSteps, HealthPill, RegistrationPill, daysLeft, money } from "@/components/domains/DomainBits";
import { ConfirmAction, Switch, useDomainCall } from "@/components/domains/DomainControls";
import { DomainDnsPanel } from "@/components/domains/DomainDnsPanel";
import { DomainRegistrarPanel } from "@/components/domains/DomainRegistrarPanel";
import { PickLeadDialog } from "@/components/domains/PickDialogs";
import { registrarDashboardUrl, type DomainHealth } from "@/lib/domains/types";
import type { DomainActivity, DomainDetail } from "@/lib/domains/detail";

const ACTIVITY_WORDS: Record<string, string> = {
  "domain.purchased": "Bought",
  "domain.purchase_failed": "Purchase failed",
  "domain.linked": "Linked to a lead",
  "domain.unlinked": "Unlinked from its lead",
  "domain.setup_stopped": "Setup stopped",
  "domain.auto_renew_on": "Auto-renew turned on",
  "domain.auto_renew_off": "Auto-renew turned off",
  "domain.renewed": "Renewed",
  "domain.locked": "Transfer lock on",
  "domain.unlocked": "Transfer lock off",
  "domain.privacy_on": "WHOIS privacy on",
  "domain.privacy_off": "WHOIS privacy off",
  "domain.nameservers_changed": "Nameservers changed",
  "domain.forwarding_set": "Forwarding set",
  "domain.forwarding_removed": "Forwarding removed",
  "domain.auth_code_viewed": "Transfer code viewed",
  "domain.move_started": "Move to another account started",
  "domain.move_cancelled": "Move cancelled",
  "domain.dns_changed": "DNS record",
  "domain.dns_reset": "DNS reset to defaults",
  "domain.dns_restored": "DNS restored to an earlier version",
  "domain.marked_live": "Marked live by hand",
  "domain.site_copied": "Staging site copied to the domain",
};

function activityText(a: DomainActivity): string {
  const v = a.value ?? {};
  const base = ACTIVITY_WORDS[a.action] ?? a.action.replace(/^domain\./, "").replace(/_/g, " ");
  if (a.action === "domain.dns_changed") {
    const rec = (v.after ?? v.before) as { type?: string; name?: string; content?: string } | null;
    return `${base} ${String(v.change ?? "changed")}${rec ? `: ${rec.type} ${rec.name} → ${rec.content}` : ""}`;
  }
  if (a.action === "domain.nameservers_changed" && Array.isArray(v.nameservers)) return `${base}: ${(v.nameservers as string[]).join(", ")}`;
  if (a.action === "domain.forwarding_set" && v.to) return `${base}: ${String(v.to)}`;
  if (a.action === "domain.move_started" && v.to) return `${base} (${String(v.to)})`;
  if (a.action === "domain.renewed") return `${base}${v.pending ? " — payment processing" : ""}${typeof v.total_cents === "number" ? ` (${money(v.total_cents as number)})` : ""}`;
  if ((a.action === "domain.setup_stopped" || a.action === "domain.purchase_failed") && v.error) return `${base}: ${String(v.error)}`;
  return base;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 text-text">{children}</dd>
    </>
  );
}

const CHECK_COLOR: Record<string, string> = {
  up: "bg-ready-fg",
  down: "bg-dropped-fg",
  ssl_error: "bg-notready-fg",
  parked: "bg-text-faint",
  no_dns: "bg-border",
};

const STATUS_WORDS: Record<string, string> = {
  live: "The lead's website is live on this domain.",
  connected: "Set up by hand before the dashboard managed domains — the dashboard only watches it.",
  unassigned: "Not linked to a lead. Linking it starts the automatic setup (hosting, DNS, SSL, the site).",
  waiting_for_site:
    "Ready — waiting for the lead's site. It goes live by itself once the lead has a staging site (or its dmviral link on the lead), or once the site is uploaded to the domain.",
  setting_up: "The dashboard is connecting it now.",
  purchasing: "The registrar is completing the purchase.",
  needs_attention: "Setup stopped — see the reason below and retry.",
  failed: "The purchase failed; nothing was bought.",
};

/**
 * One domain, everything about it: registration and renewal, the website and
 * lead it serves, its health, DNS records, registrar settings and history.
 */
export function DomainDetailView({ initial, canManage, canPurchase }: { initial: DomainDetail; canManage: boolean; canPurchase: boolean }) {
  const router = useRouter();
  const { call, busy } = useDomainCall();
  const [detail, setDetail] = useState(initial);
  const [now, setNow] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [confirmRenew, setConfirmRenew] = useState(false);
  const [confirmRenewOff, setConfirmRenewOff] = useState(false);
  const [confirmSite, setConfirmSite] = useState<"mark_live" | "copy_staging" | null>(null);
  const d = detail.domain;
  const health = d.health_state ? (d.health as DomainHealth) : null;

  const reload = useCallback(async () => {
    const r = await fetch(`/api/domains/${d.id}`);
    if (r.ok) setDetail((await r.json()) as DomainDetail);
    setNow(Date.now());
  }, [d.id]);

  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);

  // keep a setup in progress fresh
  useEffect(() => {
    if (!["purchasing", "setting_up"].includes(d.status)) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [d.status, reload]);

  const expired = d.registrar_status === "expired";
  // the site step can be closed by hand: waiting for the site, or stopped at it
  const atSiteStep = d.status === "waiting_for_site" || (d.status === "needs_attention" && d.step === "site");
  const missing = d.registrar_status === "missing";
  const left = now ? daysLeft(d.expires_at, now) : null;
  const registrarName = d.registrar === "cloudflare" ? "Cloudflare" : "Hostinger";

  async function checkNow() {
    const r = await call<{ health: DomainHealth }>("health", `/api/domains/${d.id}/health`, { method: "POST" });
    if (r.ok) await reload();
  }

  async function syncNow() {
    const r = await call("sync", "/api/domains/sync", { method: "POST" }, { title: "Synced with the registrars" });
    if (r.ok) await reload();
  }

  async function setAutoRenew(on: boolean) {
    setConfirmRenewOff(false);
    const r = await call("autorenew", `/api/domains/${d.id}`, { method: "PATCH", body: { autoRenew: on } }, { title: `Auto-renew ${on ? "on" : "off"} for ${d.domain}` });
    if (r.ok) await reload();
  }

  async function renew() {
    const r = await call<{ pending: boolean }>("renew", `/api/domains/${d.id}/renew`, { method: "POST" }, {
      title: `${d.domain} renewed`,
      body: "If Hostinger is still processing the payment, the new expiry date shows once it clears.",
    });
    setConfirmRenew(false);
    if (r.ok) {
      // read the new expiry back from the registrar
      await call("sync", "/api/domains/sync", { method: "POST" });
      await reload();
    }
  }

  async function unlink() {
    if (!confirm(`Unlink ${d.domain} from ${d.leads?.business_name ?? "its lead"}?`)) return;
    const r = await call("unlink", `/api/domains/${d.id}`, { method: "PATCH", body: { leadId: null } }, { title: "Unlinked" });
    if (r.ok) await reload();
  }

  async function retry() {
    const r = await call("retry", `/api/domains/${d.id}/retry`, { method: "POST" }, { title: `Retrying ${d.domain}` });
    if (r.ok) await reload();
  }

  async function siteAction(action: "mark_live" | "copy_staging") {
    const r = await call("site", `/api/domains/${d.id}/site`, { method: "POST", body: { action } }, {
      title: action === "mark_live" ? `${d.domain} marked live` : `Staging site copied to ${d.domain}`,
      body: "The lead's website link now points at the domain.",
    });
    setConfirmSite(null);
    if (r.ok) await reload();
  }

  async function removeRow() {
    if (!confirm(`Remove ${d.domain} from the dashboard? Nothing changes at the registrar; its history stays in the activity log.`)) return;
    const r = await call("remove", `/api/domains/${d.id}`, { method: "DELETE" }, { title: `${d.domain} removed` });
    if (r.ok) router.push("/domains");
  }

  const checks = detail.checks.slice(-60);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <BackLink href="/domains" label="All domains" />
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0 space-y-2">
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-text">
              <span className="truncate">{d.domain}</span>
              <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" title="Open the site" aria-label={`Open ${d.domain}`} className="text-text-faint hover:text-text">
                <ExternalLink className="h-4 w-4" />
              </a>
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <DomainStatusPill status={d.status} />
              <RegistrationPill status={d.registrar_status} />
              <HealthPill state={d.health_state} />
              <Pill tone="neutral">{registrarName}</Pill>
              {d.origin === "purchased" ? <Pill tone="accent">Bought here</Pill> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => void checkNow()} disabled={busy === "health"}>
              {busy === "health" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />} Check site
            </button>
            {canManage ? (
              <button type="button" className={btnSecondary} onClick={() => void syncNow()} disabled={busy === "sync"} title="Read the latest from the registrars">
                {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync
              </button>
            ) : null}
            <a href={registrarDashboardUrl(d)} target="_blank" rel="noreferrer" className={btnSecondary}>
              {registrarName} <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>

      {expired ? (
        <p className="rounded-md border border-dropped-fg/30 bg-dropped-bg p-3 text-sm text-dropped-fg">
          This domain expired{d.expires_at ? ` on ${new Date(d.expires_at).toLocaleDateString()}` : ""} — its site and email have stopped working.{" "}
          {d.registrar === "hostinger" ? "Renew it below while Hostinger still allows it (a late renewal can cost more)." : "Renew it in Cloudflare while it can still be recovered."}
        </p>
      ) : null}
      {missing ? (
        <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-text-muted">
          {registrarName} no longer lists this domain in our account — it was moved, transferred out or deleted. Nothing can be changed here any more.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel icon={CalendarClock} title="Registration & renewal">
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
            <Fact label="Registered">{d.registered_at ? new Date(d.registered_at).toLocaleDateString() : "—"}</Fact>
            <Fact label="Expires">
              {d.expires_at ? new Date(d.expires_at).toLocaleDateString() : "—"}
              {left !== null && !expired ? (
                <span className={cn("ml-1 text-xs", left <= 30 && d.auto_renew !== true ? "font-semibold text-notready-fg" : "text-text-faint")}>
                  {left >= 0 ? `in ${left} day${left === 1 ? "" : "s"}` : `${-left} days ago`}
                </span>
              ) : null}
            </Fact>
            <Fact label="Auto-renew">
              {expired || missing ? (
                <span className="text-text-faint">—</span>
              ) : d.auto_renew === null ? (
                <span className="text-text-faint">Unknown — press Sync</span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className={d.auto_renew ? "text-ready-fg" : "font-semibold text-notready-fg"}>{d.auto_renew ? "On" : "Off"}</span>
                  {canManage ? (
                    <Switch
                      on={d.auto_renew}
                      label="Auto-renew"
                      disabled={busy === "autorenew"}
                      onChange={(next) => (next ? void setAutoRenew(true) : setConfirmRenewOff(true))}
                    />
                  ) : null}
                </span>
              )}
            </Fact>
            <Fact label="Renews at">{d.renewal_cost_cents ? `${money(d.renewal_cost_cents, d.currency ?? "USD")} / year` : "—"}</Fact>
            <Fact label="Next charge">
              {d.next_billing_at && d.auto_renew ? new Date(d.next_billing_at).toLocaleDateString() : <span className="text-text-faint">{d.auto_renew === false ? "None — won't renew" : "—"}</span>}
            </Fact>
            {d.details?.subscription_status ? <Fact label="Subscription">{d.details.subscription_status.replace(/_/g, " ")}</Fact> : null}
            {d.origin === "purchased" && d.registration_cost_cents ? <Fact label="Paid">{money(d.registration_cost_cents, d.currency ?? "USD")} first year</Fact> : null}
          </dl>
          {!missing ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {d.registrar === "hostinger" ? (
                canPurchase ? (
                  <button type="button" className={expired ? btnPrimary : btnSecondarySm} onClick={() => setConfirmRenew(true)} disabled={busy === "renew"}>
                    {busy === "renew" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {expired ? "Renew now" : "Renew a year now"}
                  </button>
                ) : null
              ) : (
                <a href={registrarDashboardUrl(d)} target="_blank" rel="noreferrer" className={btnSecondarySm}>
                  Renew in Cloudflare <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ) : null}
          {d.registrar === "cloudflare" && !missing ? (
            <p className="mt-2 text-xs text-text-muted">Cloudflare renews on the expiry date when auto-renew is on; its API can&apos;t renew early.</p>
          ) : null}
        </Panel>

        <Panel icon={Globe} title="Website & lead">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-muted">Lead</span>
              {d.lead_id ? (
                <span className="inline-flex items-center gap-1">
                  <Link href={`/leads/${d.lead_id}`} className="font-medium text-accent-ink hover:underline">
                    {d.leads?.business_name ?? "Lead"}
                  </Link>
                  {canManage && d.status !== "purchasing" ? (
                    <button type="button" className={btnGhostSm} title="Unlink" aria-label="Unlink from the lead" onClick={() => void unlink()} disabled={busy === "unlink"}>
                      <Unlink className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
              ) : canManage && (d.status === "unassigned" || d.status === "connected") && !missing ? (
                <button type="button" className={btnSecondarySm} onClick={() => setLinkOpen(true)}>
                  <Link2 className="h-3.5 w-3.5" /> Link a lead
                </button>
              ) : (
                <span className="text-text-faint">Not linked</span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-text-muted">{STATUS_WORDS[d.status] ?? ""}</p>
            {["purchasing", "setting_up", "waiting_for_site", "needs_attention", "live"].includes(d.status) ? <DomainSteps row={d} /> : null}
            {d.last_error && (d.status === "needs_attention" || d.status === "failed") ? (
              <p className="rounded-md bg-dropped-bg p-2 text-xs text-dropped-fg">{d.last_error}</p>
            ) : null}
            {canManage && (d.status === "needs_attention" || d.status === "waiting_for_site") ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnSecondarySm} onClick={() => void retry()} disabled={busy === "retry"}>
                  <RotateCw className="h-3.5 w-3.5" /> {d.status === "waiting_for_site" ? "Check again" : "Retry"}
                </button>
                {atSiteStep && detail.stagingUrl ? (
                  <button type="button" className={btnSecondarySm} onClick={() => setConfirmSite("copy_staging")} disabled={busy === "site"}>
                    <Copy className="h-3.5 w-3.5" /> Copy staging site
                  </button>
                ) : null}
                {atSiteStep ? (
                  <button type="button" className={btnSecondarySm} onClick={() => setConfirmSite("mark_live")} disabled={busy === "site"}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark as live
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3 text-xs">
              <span className="text-text-muted">Hosting</span>
              <span className="text-text">{d.hosting_username ? `Hostinger (${d.hosting_username})` : d.status === "connected" ? "Outside Hostinger" : "—"}</span>
            </div>
          </div>
        </Panel>

        <Panel icon={Activity} title="Site health" action={health ? <span className="text-[11px] text-text-faint">checked <RelativeTime iso={d.health_checked_at} /></span> : null}>
          {!health ? (
            <p className="text-sm text-text-muted">Not checked yet — the dashboard checks every site every few hours, or press Check site.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className={cn("text-sm", health.state === "up" ? "text-ready-fg" : health.state === "down" || health.state === "ssl_error" ? "text-dropped-fg" : "text-text-muted")}>
                {health.summary}
              </p>
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-xs">
                <Fact label="HTTP">{health.http_status ?? "—"}</Fact>
                <Fact label="Response">{health.ms !== null ? `${health.ms} ms` : "—"}</Fact>
                <Fact label="SSL">
                  {health.ssl ? (
                    health.ssl.valid ? (
                      <>
                        Valid{health.ssl.valid_to ? ` to ${new Date(health.ssl.valid_to).toLocaleDateString()}` : ""}
                        {health.ssl.issuer ? <span className="text-text-faint"> · {health.ssl.issuer}</span> : null}
                      </>
                    ) : (
                      <span className="text-dropped-fg">{health.ssl.error ?? "Invalid"}</span>
                    )
                  ) : (
                    "—"
                  )}
                </Fact>
                <Fact label="Points at">
                  <span className="break-all font-mono">{[...new Set([...(health.dns.apex ?? []), ...(health.dns.www ?? [])])].join(", ") || "nothing"}</span>
                </Fact>
                <Fact label="Since">
                  <RelativeTime iso={health.since} />
                </Fact>
              </dl>
              <div className="space-y-1 border-t border-border-subtle pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">30 days</span>
                  <span className="font-mono text-text">
                    {detail.uptime30 !== null ? `${detail.uptime30}% up` : "—"}
                    {detail.avgMs30 !== null ? <span className="text-text-faint"> · {detail.avgMs30} ms avg</span> : null}
                  </span>
                </div>
                {checks.length ? (
                  <div className="flex h-5 items-end gap-px" aria-label="Recent checks">
                    {checks.map((c, i) => (
                      <span
                        key={`${c.at}-${i}`}
                        className={cn("h-full flex-1 rounded-[1px]", CHECK_COLOR[c.state] ?? "bg-border")}
                        title={`${new Date(c.at).toLocaleString()} — ${c.state}${c.error ? `: ${c.error}` : c.ms ? ` (${c.ms} ms)` : ""}`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {!missing ? <DomainDnsPanel domainId={d.id} domain={d.domain} registrar={d.registrar} canManage={canManage} /> : null}
      {!missing ? <DomainRegistrarPanel domainId={d.id} domain={d.domain} canManage={canManage} onChanged={() => void reload()} /> : null}

      <Panel icon={History} title="Activity" count={detail.activity.length} flush>
        {detail.activity.length === 0 ? (
          <p className="p-4 text-sm text-text-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {detail.activity.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
                <span className="min-w-0 break-words text-text">{activityText(a)}</span>
                <span className="shrink-0 text-xs text-text-faint">
                  {a.by ? `${a.by} · ` : ""}
                  <RelativeTime iso={a.at} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canManage && (missing || d.status === "failed") ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dropped-fg/30 p-4">
          <p className="text-sm text-text-muted">This domain isn&apos;t ours any more. Remove it from the dashboard (the registrar isn&apos;t touched).</p>
          <button type="button" className={btnSecondarySm} onClick={() => void removeRow()} disabled={busy === "remove"}>
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        </div>
      ) : null}

      {linkOpen ? <PickLeadDialog domain={d} onClose={() => setLinkOpen(false)} onLinked={() => void reload()} /> : null}
      {confirmRenew ? (
        <ConfirmAction
          title={`Renew ${d.domain} now?`}
          confirmLabel={`Renew${d.renewal_cost_cents ? ` for ${money(d.renewal_cost_cents, d.currency ?? "USD")}` : ""}`}
          busy={busy === "renew"}
          onConfirm={() => void renew()}
          onClose={() => setConfirmRenew(false)}
        >
          <p>
            This charges the company&apos;s default payment method on Hostinger
            {d.renewal_cost_cents ? (
              <>
                {" "}
                about <strong className="text-text">{money(d.renewal_cost_cents, d.currency ?? "USD")}</strong>
              </>
            ) : null}{" "}
            and adds a year to the registration.
          </p>
          {expired ? <p>It has already expired, so Hostinger may add a late-renewal fee.</p> : null}
        </ConfirmAction>
      ) : null}
      {confirmSite === "copy_staging" ? (
        <ConfirmAction
          title={`Copy the staging site to ${d.domain}?`}
          confirmLabel="Copy it"
          busy={busy === "site"}
          onConfirm={() => void siteAction("copy_staging")}
          onClose={() => setConfirmSite(null)}
        >
          <p>
            The files of <span className="font-mono text-text">{detail.stagingUrl}</span> replace whatever {d.domain} serves now (a copy of the current files is kept
            first). The lead&apos;s website link becomes https://{d.domain} and the staging subdomain is removed once Hostinger confirms the files.
          </p>
        </ConfirmAction>
      ) : null}
      {confirmSite === "mark_live" ? (
        <ConfirmAction
          title={`Mark ${d.domain} as live?`}
          confirmLabel="Mark as live"
          busy={busy === "site"}
          onConfirm={() => void siteAction("mark_live")}
          onClose={() => setConfirmSite(null)}
        >
          <p>
            Use this when the site is already on {d.domain} — uploaded by hand, or hosted elsewhere. Nothing is copied or changed on the domain; the lead&apos;s website
            link becomes https://{d.domain}.
          </p>
        </ConfirmAction>
      ) : null}
      {confirmRenewOff ? (
        <ConfirmAction title={`Turn auto-renew off for ${d.domain}?`} confirmLabel="Turn off" danger busy={busy === "autorenew"} onConfirm={() => void setAutoRenew(false)} onClose={() => setConfirmRenewOff(false)}>
          <p>
            {d.domain} will expire on {d.expires_at ? new Date(d.expires_at).toLocaleDateString() : "its expiry date"} unless someone renews it — the client&apos;s site and email
            stop working then.
          </p>
        </ConfirmAction>
      ) : null}
    </div>
  );
}
