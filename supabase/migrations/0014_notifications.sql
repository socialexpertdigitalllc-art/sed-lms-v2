create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  lead_id uuid references public.leads(id) on delete set null,
  title text not null,
  body text not null,
  dedup_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create unique index if not exists notifications_dedup_key_idx on public.notifications (dedup_key);
create index if not exists notifications_user_unread_idx on public.notifications (user_id, read_at, created_at desc);

create table if not exists public.user_notification_settings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  enabled boolean not null default true,
  lead_time_minutes int not null default 15,
  primary key (user_id, event_key)
);

alter table public.notifications enable row level security;
drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());

alter table public.user_notification_settings enable row level security;
drop policy if exists "read own or admin notif settings" on public.user_notification_settings;
create policy "read own or admin notif settings" on public.user_notification_settings
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
alter table public.notifications replica identity full;
