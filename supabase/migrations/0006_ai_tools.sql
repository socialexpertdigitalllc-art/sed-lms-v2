-- Phase 4 — AI Tools (WebCraft + DeepSeek generators)

-- 1. Extra metadata columns on ai_generations
alter table public.ai_generations add column if not exists model text;
alter table public.ai_generations add column if not exists num_files integer;

create index if not exists idx_ai_generations_tool on public.ai_generations (tool);
create index if not exists idx_ai_generations_created_at on public.ai_generations (created_at desc);
create index if not exists idx_ai_generations_agent on public.ai_generations (agent_id);

-- 2. Scoped reads: an agent sees their own generations; managers/tech see all
--    for a tool if they hold that tool's analytics permission (or the
--    all-agent analytics permission).
drop policy if exists "read ai_generations" on public.ai_generations;
create policy "read ai_generations scoped" on public.ai_generations for select to authenticated
  using (
    agent_id = auth.uid()
    or public.has_permission('analytics.view_all_agents')
    or (tool = 'webcraft' and public.has_permission('analytics.view_webcraft'))
    or (tool = 'deepseek' and public.has_permission('analytics.view_deepseek'))
  );

-- App handlers write via the service role (bypasses RLS); this policy is a
-- belt-and-braces guard so a logged-in client can only insert rows for itself.
drop policy if exists "insert own ai_generations" on public.ai_generations;
create policy "insert own ai_generations" on public.ai_generations for insert to authenticated
  with check (agent_id = auth.uid());

-- 3. Private Storage bucket for generated site files. Reads/writes go through
--    the service role; the UI fetches via short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('ai-generations', 'ai-generations', false)
on conflict (id) do nothing;
