-- 0025_ready_link_only_on_transition.sql
-- The Ready-requires-website_link guard (from 0020) fired on EVERY insert/update
-- of a Ready lead lacking a link, which blocked unrelated edits (agent reassign,
-- archive/soft-delete, bulk actions) on already-Ready leads. Narrow it so it only
-- fires when a lead is actually being SET to Ready (insert-as-Ready or a transition
-- into Ready) or when a Ready lead's website_link is being cleared -- preserving the
-- original intent while allowing other updates.
create or replace function public.enforce_ready_website_link()
returns trigger
language plpgsql
as $function$
begin
  if NEW.status = 'Ready'
     and (NEW.website_link is null or btrim(NEW.website_link) = '')
     and (
       TG_OP = 'INSERT'
       or OLD.status is distinct from 'Ready'
       or OLD.website_link is distinct from NEW.website_link
     )
  then
    raise exception 'A website link is required before a lead can be set to Ready'
      using errcode = 'check_violation';
  end if;
  return NEW;
end $function$;
