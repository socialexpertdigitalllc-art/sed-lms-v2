-- 0099_everything_live_ticks.sql — every table a screen shows announces its changes.
-- ADDITIVE ONLY (shared prod DB): two functions, triggers, one trigger swapped.
--
-- Each table gets its own Realtime topic, 'lms:t:<table>', so a screen only
-- hears about the tables it shows (components/layout/LiveRouteRefresh.tsx and
-- lib/realtime/tableTicks.ts). The leads group (leads, lead_tag_links,
-- lead_follow_ups, lead_tickets) stays on 'lms:leads' (0097, 0098).
--
-- Row ticks carry the changed row's id, lead_id and ticket_id (when it has
-- them) and nothing else, so an open lead or ticket page refreshes only for
-- its own rows. Busy tables send one tick per statement instead.
--
-- A failed broadcast never fails the write.

create or replace function public.broadcast_row_tick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  begin
    if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
    perform realtime.send(
      jsonb_strip_nulls(jsonb_build_object(
        'table', tg_table_name, 'op', tg_op,
        'id', r->>'id', 'lead_id', r->>'lead_id', 'ticket_id', r->>'ticket_id'
      )),
      'changed',
      'lms:t:' || tg_table_name,
      false
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

create or replace function public.broadcast_table_tick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op), 'changed', 'lms:t:' || tg_table_name, false);
  exception when others then
    null;
  end;
  return null;
end;
$$;

-- lead_tickets: a row tick on the leads topic, so an open lead page can tell
-- whether the ticket is its own (0098 sent a bare statement tick).
create or replace function public.broadcast_leads_row_tick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  begin
    if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
    perform realtime.send(
      jsonb_strip_nulls(jsonb_build_object('table', tg_table_name, 'op', tg_op, 'id', r->>'id', 'lead_id', r->>'lead_id')),
      'changed',
      'lms:leads',
      false
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

revoke all on function public.broadcast_row_tick() from public, anon, authenticated;
revoke all on function public.broadcast_table_tick() from public, anon, authenticated;
revoke all on function public.broadcast_leads_row_tick() from public, anon, authenticated;

drop trigger if exists trg_lead_tickets_live_tick on public.lead_tickets;
create trigger trg_lead_tickets_live_tick
  after insert or update or delete on public.lead_tickets
  for each row execute function public.broadcast_leads_row_tick();

do $$
declare
  t text;
  row_tables text[] := array[
    'pre_leads','feedback','ticket_items','ticket_item_attachments','contracts','payment_links',
    'form_endpoints','form_submissions','lead_receipts','lead_hitlist','lead_status_events',
    'lead_domain_checks','lead_photo_candidates','lead_photo_captures','lead_logo_generations',
    'client_domains','website_leads','website_services','website_coupons','website_offers',
    'website_portfolio','website_testimonials','website_settings','website_addons','profiles',
    'departments','department_members','department_permissions','user_permission_overrides',
    'permissions','closer_assignments','notification_rules','company_mailboxes','image_hosts',
    'ai_providers','ai_task_assignments','contract_templates','contract_placeholders',
    'user_signatures','builder_templates','studio_templates','studio_runs','studio_deployments',
    'website_templates','ai_generations','lead_tags','lead_tag_shares','wge_queue','wge_config',
    'template_generations','email_verify_providers'
  ];
  statement_tables text[] := array['activity_log','builder_runs','assistant_actions'];
begin
  foreach t in array row_tables loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_live_tick', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.broadcast_row_tick()',
      'trg_' || t || '_live_tick', t);
  end loop;
  foreach t in array statement_tables loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_live_tick', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each statement execute function public.broadcast_table_tick()',
      'trg_' || t || '_live_tick', t);
  end loop;
end $$;
