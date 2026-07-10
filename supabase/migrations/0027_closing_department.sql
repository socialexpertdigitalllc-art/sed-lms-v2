-- 0027_closing_department.sql — dedicated "Closing" department; its members
-- populate the lead "Closed by" picker (previously drew from Sales). Starts empty.
insert into public.departments (name, slug, description, color, icon)
values ('Closing', 'closing', 'Closers who finalize deals; populates the Lead "Closed by" picker.', '#7C3AED', 'handshake')
on conflict (slug) do nothing;
