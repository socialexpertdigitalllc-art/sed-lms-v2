-- 0003: let a user be deleted without being blocked by "actor" references.
-- The user's OWN rows (department_members.user_id, user_permission_overrides.user_id)
-- already CASCADE. These references point to the user as creator/agent/actor and
-- should survive the delete with the reference nulled out.
alter table public.activity_log drop constraint activity_log_user_id_fkey,
  add constraint activity_log_user_id_fkey foreign key (user_id) references public.profiles(id) on delete set null;
alter table public.ai_generations drop constraint ai_generations_agent_id_fkey,
  add constraint ai_generations_agent_id_fkey foreign key (agent_id) references public.profiles(id) on delete set null;
alter table public.department_members drop constraint department_members_added_by_fkey,
  add constraint department_members_added_by_fkey foreign key (added_by) references public.profiles(id) on delete set null;
alter table public.department_permissions drop constraint department_permissions_granted_by_fkey,
  add constraint department_permissions_granted_by_fkey foreign key (granted_by) references public.profiles(id) on delete set null;
alter table public.leads drop constraint leads_agent_id_fkey,
  add constraint leads_agent_id_fkey foreign key (agent_id) references public.profiles(id) on delete set null;
alter table public.leads drop constraint leads_created_by_fkey,
  add constraint leads_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.pre_leads drop constraint pre_leads_agent_id_fkey,
  add constraint pre_leads_agent_id_fkey foreign key (agent_id) references public.profiles(id) on delete set null;
alter table public.pre_leads drop constraint pre_leads_last_updated_by_fkey,
  add constraint pre_leads_last_updated_by_fkey foreign key (last_updated_by) references public.profiles(id) on delete set null;
alter table public.profiles drop constraint profiles_created_by_fkey,
  add constraint profiles_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.user_permission_overrides drop constraint user_permission_overrides_granted_by_fkey,
  add constraint user_permission_overrides_granted_by_fkey foreign key (granted_by) references public.profiles(id) on delete set null;
