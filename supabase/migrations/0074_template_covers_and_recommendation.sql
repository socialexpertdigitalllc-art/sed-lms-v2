-- Templates become something a salesperson can SEE and pick.
--
-- Until now a template was a name and a page count on an operator-only
-- screen. Two things change that:
--
--   cover_image_path — a screenshot of the built site, stored beside the
--     source zip in the `builder-templates` bucket. Required on every NEW
--     upload (enforced in the route, not as a NOT NULL, so the templates
--     already uploaded stay loadable and can have a cover added).
--
--   in_service — whether the template is offered to sales at all. Defaults
--     to FALSE: a template that has just been uploaded has not been checked
--     by anyone, and the safe default for "should we sell this?" is no.
--
-- And leads.recommended_template_id records the template the agent picked
-- with the client. ON DELETE SET NULL rather than restrict: retiring a
-- template must not be blocked by, or destroy, historical leads that once
-- referenced it — the lead keeps its history, it just loses the pointer.

alter table public.builder_templates
  add column if not exists cover_image_path text,
  add column if not exists in_service boolean not null default false;

comment on column public.builder_templates.cover_image_path is
  'Storage key of the cover screenshot in the builder-templates bucket.';
comment on column public.builder_templates.in_service is
  'Offered to sales in the lead form. Off until someone vouches for the template.';

alter table public.leads
  add column if not exists recommended_template_id uuid
    references public.builder_templates (id) on delete set null;

comment on column public.leads.recommended_template_id is
  'The template the agent selected with the client on the submission form.';

-- The lead form lists in-service templates, newest first, and nothing else.
create index if not exists builder_templates_in_service_idx
  on public.builder_templates (created_at desc)
  where in_service;
