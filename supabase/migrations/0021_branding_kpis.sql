-- 0021_branding_kpis.sql — company branding + dashboard KPI permissions

alter table public.app_settings
  add column if not exists company_name text not null default 'SED LMS',
  add column if not exists logo_path text;

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('dashboard.kpi.total_leads','KPI: Total Leads',null,'dashboard',false),
  ('dashboard.kpi.quoted_revenue','KPI: Quoted Revenue',null,'dashboard',false),
  ('dashboard.kpi.ready','KPI: Ready Count',null,'dashboard',false),
  ('dashboard.kpi.avg_rating','KPI: Avg Rating',null,'dashboard',false),
  ('dashboard.kpi.closed_revenue','KPI: Closed Revenue',null,'dashboard',false),
  ('dashboard.kpi.recurring_revenue','KPI: Recurring (Yearly) Revenue',null,'dashboard',false),
  ('dashboard.kpi.avg_deal_size','KPI: Avg Deal Size',null,'dashboard',false),
  ('dashboard.kpi.conversion_rate','KPI: Conversion Rate',null,'dashboard',false),
  ('dashboard.kpi.new_this_week','KPI: New Leads This Week',null,'dashboard',false),
  ('dashboard.kpi.overdue_followups','KPI: Overdue Follow-ups',null,'dashboard',false),
  ('dashboard.kpi.pickup_rate','KPI: Pickup Rate',null,'dashboard',false),
  ('dashboard.kpi.open_tickets','KPI: Open Tickets',null,'dashboard',false),
  ('dashboard.kpi.overdue_tickets','KPI: Overdue Tickets',null,'dashboard',false),
  ('dashboard.kpi.avg_resolution_time','KPI: Avg Ticket Resolution Time',null,'dashboard',false),
  ('dashboard.strip.status','Status Percentage Strip',null,'dashboard',false),
  ('dashboard.chart.leads_over_time','Chart: Leads Over Time',null,'dashboard',false),
  ('dashboard.chart.pipeline_by_status','Chart: Pipeline by Status',null,'dashboard',false),
  ('dashboard.chart.leads_by_agent','Chart: Leads by Agent',null,'dashboard',false),
  ('dashboard.chart.site_type_split','Chart: Site Type Split',null,'dashboard',false),
  ('dashboard.chart.rating_distribution','Chart: Rating Distribution',null,'dashboard',false),
  ('dashboard.chart.fresh_vs_followup','Chart: Fresh vs Follow-up',null,'dashboard',false),
  ('dashboard.chart.revenue_by_status','Chart: Revenue by Status',null,'dashboard',false),
  ('dashboard.chart.ticket_status_split','Chart: Ticket Status Split',null,'dashboard',false)
on conflict (key) do nothing;

-- default: every department sees everything (admin revokes selectively later)
insert into public.department_permissions (department_id, permission_key)
  select d.id, p.key
  from public.departments d
  cross join public.permissions p
  where p.category = 'dashboard'
on conflict do nothing;
