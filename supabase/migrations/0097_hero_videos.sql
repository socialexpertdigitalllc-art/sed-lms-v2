-- 0097_hero_videos.sql — the hero video library (lib/hero-videos/*).
-- ADDITIVE ONLY (shared prod DB): one new table, new columns, no drops.
--
-- The library itself lives in Google Drive: one folder (app_settings.
-- hero_videos_folder_id) with a subfolder per category ("Kitchen Remodel",
-- "Siding", ...). "Sync" on the Site Builder's Hero Videos tab copies every
-- video in it ONCE to the shared media host (a DirectAdmin subdomain), and
-- every website built with a video-hero template embeds that one copy by URL —
-- nothing is copied per site. Drive itself cannot be the player: it answers
-- every cross-site browser request with 403.

create table if not exists public.hero_videos (
  id uuid primary key default gen_random_uuid(),
  -- the Drive file this row mirrors
  drive_file_id text not null unique,
  -- the file name without its extension ("Kitchen Remodel 2")
  name text not null check (char_length(name) between 1 and 300),
  -- the Drive subfolder it sits in — shown as the video's title in the gallery
  category text not null check (char_length(category) between 1 and 120),
  drive_folder_id text,
  drive_modified_time timestamptz,
  size_bytes bigint,
  width integer,
  height integer,
  duration_ms integer,
  -- the file name on the media host, and the public URL every site embeds
  media_path text,
  media_url text,
  -- pending → ready | failed; archived = gone from the Drive folder (hidden from
  -- the gallery, but its media copy stays: sites built with it still use it)
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'archived')),
  error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hero_videos_gallery_idx
  on public.hero_videos (category, name) where status = 'ready';

-- Reads and writes go through the service role behind the checks in
-- /api/site-builder/hero-videos/*; anyone signed in may read the catalogue.
alter table public.hero_videos enable row level security;
drop policy if exists "read hero videos" on public.hero_videos;
create policy "read hero videos" on public.hero_videos
  for select to authenticated using (true);

-- Templates whose home hero plays a library video. The lead form asks for a
-- video when one of these is picked, and generation refuses to start without one.
alter table public.builder_templates
  add column if not exists hero_video boolean not null default false;
update public.builder_templates set hero_video = true where name = 'SD Home';

-- The lead's choice: a library video, or a request for a new one (with what
-- the client wants), which the developer resolves with a link at generation.
alter table public.leads
  add column if not exists hero_video_id uuid references public.hero_videos(id) on delete set null,
  add column if not exists hero_video_request boolean not null default false,
  add column if not exists hero_video_note text check (hero_video_note is null or char_length(hero_video_note) <= 1000);

-- The Drive folder the library is synced from.
alter table public.app_settings
  add column if not exists hero_videos_folder_id text;
