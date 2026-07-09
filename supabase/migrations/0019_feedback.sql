-- 0019_feedback.sql — dashboard feedback

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in ('Bug','Feature request','Other')),
  title text not null,
  description text,
  screenshot_path text,
  status text not null default 'Open' check (status in ('Open','Resolved')),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists feedback_status_created_idx on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;
create policy "read feedback own or manager" on public.feedback for select to authenticated
  using (user_id = auth.uid() or public.has_permission('feedback.manage'));

alter table public.feedback replica identity full;
do $$ begin alter publication supabase_realtime add table public.feedback; exception when duplicate_object then null; end $$;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('feedback.submit','Submit Feedback',null,'feedback',false),
  ('feedback.manage','Manage Feedback',null,'feedback',true)
on conflict (key) do nothing;
insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('feedback.submit'),('feedback.manage')) as k(key)
  where (d.slug, k.key) in (
    ('sales','feedback.submit'),('management','feedback.submit'),('support','feedback.submit'),
    ('tech','feedback.submit'),('tech','feedback.manage'),
    ('admin','feedback.submit'),('admin','feedback.manage')
  )
on conflict do nothing;
