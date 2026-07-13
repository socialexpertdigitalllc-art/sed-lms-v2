-- 0031_nullable_optional_lead_arrays.sql — align DB nullability with the app contract.
-- design_reference_links + add_ons were created NOT NULL (0016) while the form,
-- zod schema (createLeadSchema: .nullable()), and the Lead type (string[] | null,
-- AddOn[] | null) all treat them as nullable — buildLeadPayload sends null when the
-- sections are left empty, exactly like every sibling optional column (services,
-- service_areas, specify_pages, image_links, all nullable). Submitting the form
-- with no design refs / no add-ons therefore violated the not-null constraint.
alter table public.leads alter column design_reference_links drop not null;
alter table public.leads alter column add_ons drop not null;
