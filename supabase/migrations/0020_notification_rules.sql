-- 0020_notification_rules.sql — admin-configurable routing + two bells + Ready guard

create table if not exists public.notification_rules (
  event_key text primary key,
  enabled boolean not null default true,
  target_departments text[] not null default '{}',
  target_users uuid[] not null default '{}',
  target_roles text[] not null default '{}',
  delay_minutes int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.notification_rules enable row level security;
create policy "read notification_rules" on public.notification_rules for select to authenticated using (true);

insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('followup_reminder',  true,  '{}',                '{}', '{lead_agent}',                 15),
  ('website_ready',      true,  '{}',                '{}', '{lead_agent}',                 0),
  ('lead_submitted',     true,  '{management,admin}','{}', '{}',                           0),
  ('prelead_submitted',  true,  '{management,admin}','{}', '{}',                           0),
  ('lead_status_changed',false, '{}',                '{}', '{}',                           0),
  ('ticket_opened',      true,  '{admin}',           '{}', '{}',                           0),
  ('ticket_assigned',    true,  '{}',                '{}', '{ticket_assignee}',            0),
  ('ticket_resolved',    true,  '{}',                '{}', '{ticket_creator,lead_agent}',  0),
  ('ticket_reopened',    true,  '{}',                '{}', '{ticket_assignee}',            0),
  ('ticket_overdue',     true,  '{admin}',           '{}', '{ticket_assignee}',            0),
  ('feedback_submitted', true,  '{tech,admin}',      '{}', '{}',                           0),
  ('feedback_resolved',  true,  '{}',                '{}', '{feedback_submitter}',         0)
on conflict (event_key) do nothing;

alter table public.notifications
  add column if not exists bell text not null default 'general',
  add column if not exists deliver_after timestamptz not null default now();
create index if not exists notifications_user_bell_idx on public.notifications (user_id, bell, read_at, created_at desc);

create or replace function public.enforce_ready_website_link() returns trigger
language plpgsql as $$
begin
  if NEW.status = 'Ready' and (NEW.website_link is null or btrim(NEW.website_link) = '') then
    raise exception 'A website link is required before a lead can be set to Ready'
      using errcode = 'check_violation';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_ready_website_link on public.leads;
create trigger trg_ready_website_link before insert or update on public.leads
  for each row execute function public.enforce_ready_website_link();

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('admin.notifications.manage','Manage Notification Rules',null,'admin',true)
on conflict (key) do nothing;
insert into public.department_permissions (department_id, permission_key)
  select d.id, 'admin.notifications.manage' from public.departments d where d.slug = 'admin'
on conflict do nothing;
