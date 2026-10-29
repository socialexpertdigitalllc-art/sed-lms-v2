-- 0096_sedcms_links.sql — which leads SED CMS may touch, and where
-- (lib/sedcms/links.ts, lib/sedcms/requests.ts).
-- APPLIED to production on 2026-10-24 with Aqib's yes, recorded in the
-- database's history as 0094_sedcms_links (version 20261024135131). It was
-- written as 0094; main's 0094_leads_rls_initplan.sql took that number in
-- the meantime, so the file is 0096 here. Never apply it again. Where it
-- isn't applied, every internal SED CMS route answers 503 NOT_CONFIGURED and
-- Open in CMS 503 CMS_NOT_READY (no link can be read), so nothing is read or
-- written on any site; website_link edits work as before.
-- ADDITIVE ONLY (shared prod DB): two new tables and one notification rule, no drops.
--
-- sedcms_links: a manager's decision that SED CMS may change ONE lead's
-- website, at ONE host. Made from "Open in CMS" by a studio.manage user, after
-- a plain-words confirmation. It is the only authority the internal routes
-- accept: a lead with no active link is a 404 NO_LEAD to the CMS, the CMS
-- reads and writes only the linked host, and a lead whose website_link now
-- resolves to another host is a 409 HOST_CHANGED until a manager confirms the
-- new address (which updates the link). One active link per lead, and one per
-- site: www.client.com and client.com are the same site.
--
-- sedcms_requests: every request id the CMS has used, claimed with an insert
-- before anything is written. An apply's id is single-use, so a replayed
-- apply (on either LMS process) never writes again; a change request's id
-- names its one ticket, so a retry completes that ticket instead of making a
-- second one.

create table if not exists public.sedcms_links (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  -- the lead's website host when a manager linked or confirmed it: lowercase
  -- labels, no scheme, port, path or trailing dot (lib/sedcms/files.ts isPlainHost)
  host text not null check (
    char_length(host) between 3 and 253
    and host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null
);

-- One active link per lead...
create unique index if not exists sedcms_links_one_per_lead
  on public.sedcms_links (lead_id) where revoked_at is null;
-- ...and per site, with or without www.
create unique index if not exists sedcms_links_one_per_site
  on public.sedcms_links ((regexp_replace(host, '^www[.]', ''))) where revoked_at is null;

create table if not exists public.sedcms_requests (
  request_id uuid primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('apply', 'ticket')),
  -- sha256 (hex) of what the request asked for: the same id with other content is refused
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  -- a change request's ticket, once it is complete
  ticket_id uuid references public.lead_tickets(id) on delete set null,
  created_at timestamptz not null default now(),
  -- a change request whose ticket, items, log row and notification are all done
  completed_at timestamptz
);

create index if not exists sedcms_requests_lead_idx
  on public.sedcms_requests (lead_id, created_at desc);

-- Same posture as client_domains: RLS on, no policies. Only the service role
-- reads and writes them, behind "Open in CMS" (studio.manage) and the signed
-- internal routes.
alter table public.sedcms_links enable row level security;
alter table public.sedcms_requests enable row level security;

-- A linked lead's website address changed: SED CMS is paused for it until a
-- manager confirms the new address.
insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('sedcms_host_changed', true, '{Admin}', '{}', '{}', 0)
on conflict (event_key) do nothing;
