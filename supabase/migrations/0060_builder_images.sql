-- 0060_builder_images.sql — Site Builder's image library: LINKS, not bytes.
--
-- ADDITIVE ONLY. Shared prod DB: one new table, no drops, no type changes, no
-- edits to any existing table.
--
-- WHY A SEPARATE TABLE FROM `studio_assets`.
-- Site Builder references every image on a generated site by its own public
-- URL — a Pexels CDN link, or the client's own photo link — and downloads
-- nothing. `studio_assets` cannot express that: its `storage_path` is NOT NULL
-- because Site Studio genuinely needs the BYTES (it zips images into the
-- package at finalize, and `resolveAssets` fails loudly on an asset it cannot
-- read). Adding link-only rows there would put rows Site Studio cannot use
-- into the very table it searches. So the two systems keep separate libraries:
-- `studio_assets` stores rehosted bytes for Site Studio, this stores links for
-- Site Builder, and neither can break the other.
--
-- WHAT IT IS FOR. "Store the direct link of the image against the service, and
-- when that image is used again, the link is already there" — so a service
-- searched once does not have to be searched again, and the same photo reused
-- for another client resolves to the identical URL with no API call.
--
-- TRADE-OFF, RECORDED DELIBERATELY: a linked image is served by a third party,
-- so a URL that ever rots takes that image off the live site with it. That is
-- accepted here in exchange for sites that carry no copies and no credentials;
-- Pexels CDN URLs are stable, and a client photo link is the client's own.
create table if not exists public.builder_images (
  id uuid primary key default gen_random_uuid(),
  -- The direct, public, hot-linkable URL that goes into the site's HTML.
  url text not null,
  -- A smaller rendition for the picker grid. Falls back to `url` when the
  -- source offers only one size (a client photo link).
  thumb_url text,
  -- The service/topic this image was found for — what a later search matches
  -- on, e.g. "Drain Cleaning". Free text, matched case-insensitively.
  subject text not null default '',
  source text not null check (source in ('pexels', 'client_link')),
  pexels_id bigint,
  photographer text,
  width int not null default 0,
  height int not null default 0,
  -- Client photos are fenced to their lead, exactly as in studio_assets;
  -- stock (pexels) rows are shared and MUST NOT carry a lead.
  lead_id uuid references public.leads (id) on delete cascade,
  constraint builder_images_client_needs_lead
    check ((source = 'client_link') = (lead_id is not null)),
  use_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- The same link is one library entry, however many times it is picked.
create unique index if not exists builder_images_url on public.builder_images (url);
-- One row per Pexels photo, so re-picking it reuses the stored link.
create unique index if not exists builder_images_pexels on public.builder_images (pexels_id)
  where pexels_id is not null;
create index if not exists builder_images_subject on public.builder_images (subject);
create index if not exists builder_images_lead on public.builder_images (lead_id)
  where lead_id is not null;

-- RLS: enabled, NO policies — service-role routes only, the same posture as
-- every studio_/builder_ table (see 0051, 0053, 0057).
alter table public.builder_images enable row level security;
