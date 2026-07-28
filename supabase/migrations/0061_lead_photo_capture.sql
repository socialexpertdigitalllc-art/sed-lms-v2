-- 0061_lead_photo_capture.sql — Google Business Profile photo capture.
--
-- FILE ONLY. Do NOT apply — the operator's DB is production; they apply this
-- after review (see AGENTS.md).
--
-- ADDITIVE ONLY. Shared prod DB: three new tables, no drops, no type changes,
-- no edits to any existing table. In particular `leads` is NOT touched:
-- capture state is a workflow concern and has no business in the lead row.
-- The captured URLs land in the EXISTING `leads.image_links`, so every
-- downstream consumer (Site Builder, Template Engine, copy-lead) needs no
-- change at all.
--
-- RLS: enabled, NO policies on all three — service-role routes only, the same
-- posture as every studio_/builder_ table (0051, 0053, 0057, 0060).
-- `image_hosts` additionally HOLDS CREDENTIALS: `encrypted_credentials` is a
-- JSON object AES-256-GCM encrypted with MAILBOX_ENC_KEY (lib/mail/crypto.ts),
-- stored as `iv:tag:ciphertext`, exactly like `ai_providers` (0046).

-- ------------------------------------------------------- per-lead capture run
create table if not exists public.lead_photo_captures (
  lead_id uuid primary key references public.leads (id) on delete cascade,
  -- pending: a browser is working on it right now.
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'none_found', 'failed')),
  -- WHICH link this capture was for. The Images group compares it against the
  -- lead's current business_profile_link: when they differ, the link has been
  -- edited since and a fresh capture runs automatically.
  profile_link text,
  found_count int not null default 0,
  error text,
  -- which build of the extension produced this, so a bad harvest is traceable
  extension_version text,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ------------------------------------------------------------ the candidates
-- One row per harvested photo. Thumbnails render straight from `thumb_url`
-- (googleusercontent hotlinks fine), so the picker costs no storage and no
-- bandwidth of ours — only PICKED photos are ever copied anywhere.
create table if not exists public.lead_photo_candidates (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  -- the Google photo id: the natural identity, so re-capture is idempotent
  photo_key text not null,
  thumb_url text not null,
  -- the =s0 original that actually gets uploaded
  source_url text not null,
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'failed', 'skipped')),
  hosted_url text,
  host_provider text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_photo_candidates_key
  on public.lead_photo_candidates (lead_id, photo_key);
create index if not exists lead_photo_candidates_lead
  on public.lead_photo_candidates (lead_id);

-- --------------------------------------------------------------- host keys
-- `position` is insertion order within a provider: the key added first is
-- tried first. Provider order itself is NOT stored — it is a product decision
-- hardcoded in lib/photo-capture/hosts/order.ts (imgbb → postimages →
-- imgchest).
--
-- postimages rows carry NO credentials: postimages publishes no API and no API
-- keys at all, so its row is nothing but an on/off switch.
create table if not exists public.image_hosts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('imgbb', 'postimages', 'imgchest')),
  label text not null default '',
  encrypted_credentials text,
  position int not null default 0,
  enabled boolean not null default true,
  -- set when the host reported a limit; it rejoins the chain by itself
  exhausted_until timestamptz,
  last_error text,
  upload_count int not null default 0,
  last_used_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists image_hosts_order on public.image_hosts (provider, position);

alter table public.lead_photo_captures enable row level security;
alter table public.lead_photo_candidates enable row level security;
alter table public.image_hosts enable row level security;
