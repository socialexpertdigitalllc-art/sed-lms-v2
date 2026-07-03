-- Add a unique username for sign-in (email or username). Admin-managed.
alter table public.profiles add column username text;

-- backfill from the email local-part, sanitized + de-duplicated
with clean as (
  select id, created_at,
    coalesce(nullif(regexp_replace(lower(split_part(email,'@',1)), '[^a-z0-9._-]', '', 'g'), ''), 'user') as b
  from public.profiles
),
ranked as (
  select id, b, row_number() over (partition by b order by created_at) as rn from clean
)
update public.profiles p
set username = case when r.rn = 1 then r.b else r.b || r.rn::text end
from ranked r where r.id = p.id;

alter table public.profiles
  add constraint profiles_username_unique unique (username),
  alter column username set not null,
  add constraint profiles_username_format check (username ~ '^[a-z0-9._-]{1,30}$');
