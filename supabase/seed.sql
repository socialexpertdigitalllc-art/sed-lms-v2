-- seed.sql — permissions catalogue, departments, default department->permission mapping.
-- Applied as migration 0002_seed. The bootstrap admin auth user is created separately.

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.view','View Leads',null,'leads',false),
  ('leads.create','Create Lead',null,'leads',false),
  ('leads.edit','Edit Lead',null,'leads',false),
  ('leads.delete','Delete Lead',null,'leads',true),
  ('leads.status_change','Change Lead Status',null,'leads',false),
  ('leads.view_all','View All Agents'' Leads',null,'leads',false),
  ('leads.export','Export Leads',null,'leads',false),
  ('leads.duplicate.override','Override Duplicate Lead Block',null,'leads',true),
  ('pre_leads.view','View Pre-Leads',null,'pre_leads',false),
  ('pre_leads.create','Create Pre-Lead',null,'pre_leads',false),
  ('pre_leads.edit','Edit Pre-Lead',null,'pre_leads',false),
  ('pre_leads.delete','Delete Pre-Lead',null,'pre_leads',true),
  ('pre_leads.followup','Update Follow-up',null,'pre_leads',false),
  ('analytics.view','View Analytics',null,'analytics',false),
  ('analytics.view_webcraft','View WebCraft Analytics',null,'analytics',false),
  ('analytics.view_deepseek','View DeepSeek Analytics',null,'analytics',false),
  ('analytics.view_all_agents','View All-Agent Analytics',null,'analytics',false),
  ('ai_tools.webcraft','Use WebCraft',null,'ai_tools',false),
  ('ai_tools.deepseek','Use DeepSeek',null,'ai_tools',false),
  ('wge.manage','Manage Website Engine (WGE)',null,'ai_tools',true),
  ('admin.users.view','View Users',null,'admin',false),
  ('admin.users.create','Create Users',null,'admin',true),
  ('admin.users.edit','Edit Users',null,'admin',false),
  ('admin.users.deactivate','Deactivate Users',null,'admin',true),
  ('admin.users.delete','Delete Users','Permanently delete a user account','admin',true),
  ('admin.departments.manage','Manage Departments',null,'admin',true),
  ('admin.permissions.manage','Manage Permissions',null,'admin',true),
  ('admin.logs.view','View Activity Log',null,'admin',false),
  ('admin.import','Import Leads','Bulk-import leads from Google Sheets','admin',true),
  ('admin.settings.manage','Manage App Settings & Add-ons',null,'admin',true),
  ('tickets.view','View Tickets',null,'tickets',false),
  ('tickets.create','Open Tickets',null,'tickets',false),
  ('tickets.assign','Assign Tickets',null,'tickets',true),
  ('tickets.resolve','Resolve Tickets',null,'tickets',false),
  ('feedback.submit','Submit Feedback',null,'feedback',false),
  ('feedback.manage','Manage Feedback',null,'feedback',true)
on conflict (key) do nothing;

insert into public.departments (name, slug, description, color, icon) values
  ('Sales','sales','Lead generation & pre-leads','#0D9488','phone'),
  ('Management','management','Oversees all leads & analytics','#7E22CE','briefcase'),
  ('Tech','tech','AI tools & website generation','#2563EB','code'),
  ('Support','support','Read-only assistance','#B45309','headphones'),
  ('Admin','admin','Full system administration','#141B2D','shield')
on conflict (slug) do nothing;

insert into public.department_permissions (department_id, permission_key)
select d.id, p.key from public.departments d join public.permissions p on true
where (d.slug, p.key) in (
  ('sales','leads.view'),('sales','leads.create'),
  ('sales','pre_leads.view'),('sales','pre_leads.create'),('sales','pre_leads.edit'),('sales','pre_leads.followup'),
  ('sales','analytics.view'),('sales','ai_tools.webcraft'),('sales','ai_tools.deepseek'),
  ('sales','tickets.view'),('sales','tickets.create'),
  ('sales','feedback.submit'),
  ('management','leads.view'),('management','leads.create'),('management','leads.edit'),('management','leads.delete'),
  ('management','leads.status_change'),('management','leads.view_all'),('management','leads.duplicate.override'),
  ('management','pre_leads.view'),('management','pre_leads.create'),('management','pre_leads.edit'),('management','pre_leads.delete'),('management','pre_leads.followup'),
  ('management','analytics.view'),('management','analytics.view_webcraft'),('management','analytics.view_deepseek'),('management','analytics.view_all_agents'),
  ('management','admin.settings.manage'),
  ('management','tickets.view'),('management','tickets.assign'),
  ('management','feedback.submit'),
  ('tech','analytics.view'),('tech','analytics.view_webcraft'),('tech','analytics.view_deepseek'),('tech','ai_tools.webcraft'),('tech','ai_tools.deepseek'),('tech','wge.manage'),
  ('tech','admin.import'),
  ('tech','tickets.view'),('tech','tickets.resolve'),
  ('tech','feedback.submit'),('tech','feedback.manage'),
  ('support','leads.view'),
  ('support','feedback.submit'),
  ('admin','admin.import'),('admin','admin.settings.manage'),('admin','leads.duplicate.override'),
  ('admin','tickets.view'),('admin','tickets.create'),('admin','tickets.assign'),('admin','tickets.resolve'),
  ('admin','feedback.submit'),('admin','feedback.manage')
)
on conflict do nothing;

insert into public.department_permissions (department_id, permission_key)
select d.id, p.key from public.departments d cross join public.permissions p
where d.slug = 'admin'
on conflict do nothing;
