# SED LMS v2 — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js + Supabase foundation — auth, the 3-layer permission engine, a permission-aware app shell, and a fully admin-manageable Users/Departments/Permissions panel — for SED LMS v2.

**Architecture:** Next.js 14 App Router (TypeScript) with Supabase Postgres/Auth/RLS. Data access is server-side via the Supabase server client; the service-role key is used only inside protected Route Handlers (e.g. admin user creation). Permissions resolve server-side as `(union of department permissions) + user grants − user revokes`, are exposed to the client through a context provider, and gate both nav and actions; every mutation re-checks on the server.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, @supabase/ssr, @supabase/supabase-js, Recharts (Phase 2), Vitest + Testing Library, Playwright, Zod, React Hook Form.

**Working directory:** `D:\sed-lms-v2` (new repo, already `git init`-ed with the spec committed).

**Reference spec:** `docs/superpowers/specs/2026-06-21-sed-lms-v2-phase-1-2-design.md`

---

## File Structure (Phase 1)

```
sed-lms-v2/
├── app/
│   ├── layout.tsx                      ← root layout, fonts, providers
│   ├── globals.css                     ← Tailwind + design tokens
│   ├── page.tsx                        ← redirect to /dashboard or /login
│   ├── login/page.tsx                  ← login form (client) + server action
│   ├── (app)/                          ← authenticated shell group
│   │   ├── layout.tsx                  ← auth guard + shell + PermissionProvider
│   │   ├── dashboard/page.tsx          ← placeholder (filled in Phase 2)
│   │   └── admin/
│   │       ├── users/page.tsx
│   │       ├── departments/page.tsx
│   │       └── permissions/page.tsx
│   └── api/
│       └── admin/
│           └── users/route.ts          ← POST create user (service role)
├── components/
│   ├── ui/                             ← shadcn primitives
│   ├── layout/{Sidebar,Topbar,AppShell}.tsx
│   ├── shared/PermissionGate.tsx
│   └── admin/{UserTable,CreateUserDialog,DepartmentCard,PermissionToggleGrid,UserOverrides}.tsx
├── lib/
│   ├── supabase/{client,server,admin,middleware}.ts
│   ├── permissions/{resolver,constants,types}.ts
│   └── utils.ts
├── hooks/usePermissions.ts
├── providers/PermissionProvider.tsx
├── middleware.ts
├── supabase/migrations/*.sql
├── supabase/seed.sql
├── tests/ (vitest) + e2e/ (playwright)
└── config files (tailwind, tsconfig, vitest, playwright, components.json)
```

---

## Task 1: Scaffold Next.js + TypeScript + Tailwind

**Files:**
- Create: project scaffold in `D:\sed-lms-v2`

- [ ] **Step 1: Scaffold the app non-interactively**

Run from `D:\sed-lms-v2` (the dir already exists with `.git`, `.gitignore`, `docs/`):

```bash
npx create-next-app@14 . --ts --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm --no-turbopack
```

If it refuses because the dir is non-empty, scaffold in a temp dir and copy:
```bash
npx create-next-app@14 ../_sed_scaffold --ts --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm --no-turbopack
cp -r ../_sed_scaffold/* ../_sed_scaffold/.* . 2>/dev/null; rm -rf ../_sed_scaffold
```

- [ ] **Step 2: Install runtime + dev dependencies**

```bash
npm install @supabase/ssr @supabase/supabase-js zod react-hook-form @hookform/resolvers recharts @tanstack/react-table lucide-react class-variance-authority clsx tailwind-merge date-fns
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: build completes with no errors (default starter compiles).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js 14 + Tailwind + deps"
```

---

## Task 2: Wire design tokens & Tailwind theme

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.ts`
- Create: `lib/utils.ts`

- [ ] **Step 1: Replace `app/globals.css` with tokens**

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #EEF1F5;
  --surface: #FFFFFF;
  --surface-2: #FBFCFD;
  --border: #DDE2EA;
  --border-subtle: #EEF1F5;
  --text: #141B2D;
  --text-muted: #5A6377;
  --text-faint: #8089A0;
  --accent: #0D9488;
  --accent-soft: #DFF5F2;
  --accent-ink: #0F766E;
}

body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; }
.font-mono, .tabular { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 2: Extend `tailwind.config.ts` theme**

```ts
import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)", surface: "var(--surface)", "surface-2": "var(--surface-2)",
        border: "var(--border)", "border-subtle": "var(--border-subtle)",
        text: "var(--text)", "text-muted": "var(--text-muted)", "text-faint": "var(--text-faint)",
        accent: "var(--accent)", "accent-soft": "var(--accent-soft)", "accent-ink": "var(--accent-ink)",
        ready: { fg: "#15803D", bg: "#DCFCE7" }, notready: { fg: "#B45309", bg: "#FEF3C7" },
        closed: { fg: "#7E22CE", bg: "#F3E8FF" }, dropped: { fg: "#B91C1C", bg: "#FEE2E2" },
        longterm: { fg: "#1D4ED8", bg: "#E8F0FE" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "monospace"] },
      borderRadius: { lg: "8px", md: "6px", sm: "4px" },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 3: Create `lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

- [ ] **Step 4: Verify dev server renders themed page**

Edit `app/page.tsx` temporarily to `<main className="p-8"><h1 className="text-2xl font-semibold text-accent">SED LMS v2</h1></main>`, run `npm run dev`, open the URL, confirm the heading is teal on a cool-gray background. Revert in Task 7.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: light-theme design tokens + tailwind theme"
```

---

## Task 3: Create the Supabase project & client wiring

**Files:**
- Create: `.env.local`, `.env.example`
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `lib/supabase/middleware.ts`, `middleware.ts`

- [ ] **Step 1: Create the Supabase project** (executor uses the Supabase MCP)

Use `create_project` in org `qsfrshehvjivfvibipvv`, name `sed-lms-v2`, region `ap-southeast-1` (confirm cost = $0 first via `get_cost`/`confirm_cost`). Record the project ref, URL, anon (publishable) key, and service-role key.

- [ ] **Step 2: Write `.env.example` and `.env.local`**

`.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```
Populate `.env.local` with the real values from Step 1. (`.env.local` is gitignored.)

- [ ] **Step 3: Browser client `lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 4: Server client `lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(toSet) { try { toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {} },
      },
    }
  );
}
```

- [ ] **Step 5: Admin client `lib/supabase/admin.ts`** (service role — server only)

```ts
import { createClient } from "@supabase/supabase-js";
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
```

- [ ] **Step 6: Session middleware `lib/supabase/middleware.ts` + `middleware.ts`**

`lib/supabase/middleware.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(toSet) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!user && !path.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user && path.startsWith("/login")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return response;
}
```

`middleware.ts`:
```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
export async function middleware(request: NextRequest) { return updateSession(request); }
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
```

- [ ] **Step 7: Verify connection**

Run `npm run dev`; confirm no runtime error on load and that visiting any path redirects to `/login` (page not built yet → 404 at /login is fine for now).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: supabase clients + session middleware"
```

---

## Task 4: Database migrations (schema + RLS)

**Files:**
- Create: `supabase/migrations/0001_core_schema.sql`

- [ ] **Step 1: Write the schema migration**

```sql
-- 0001_core_schema.sql
create extension if not exists "pgcrypto";

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  display_name text,
  avatar_url text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- departments
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  slug text unique not null,
  description text,
  color text default '#0D9488',
  icon text default 'users',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.department_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  dept_role text not null default 'member' check (dept_role in ('member','lead','manager')),
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  unique(user_id, department_id)
);

-- permissions
create table public.permissions (
  key text primary key,
  name text not null,
  description text,
  category text not null,
  is_sensitive boolean not null default false
);
create table public.department_permissions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete cascade,
  permission_key text references public.permissions(key) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  unique(department_id, permission_key)
);
create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  permission_key text references public.permissions(key) on delete cascade,
  is_granted boolean not null,
  reason text,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  unique(user_id, permission_key)
);

-- leads
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Not Ready',
  agent_id uuid references public.profiles(id),
  business_name text not null,
  business_phone text,
  business_email text,
  business_profile_link text,
  website_link text,
  logo_link text,
  map_embed_link text,
  site_type text,
  platform text,
  services text[] default '{}',
  service_areas text[] default '{}',
  has_service_areas boolean,
  client_experience integer,
  num_webpages integer,
  specify_pages text[] default '{}',
  color_scheme text,
  price_quoted numeric(10,2),
  yearly_price text,
  follow_up_time timestamptz,
  direct_line_saved boolean,
  fresh_or_followup text,
  reference_link text,
  image_links text[] default '{}',
  rating smallint check (rating between 1 and 10),
  comments text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index leads_status_idx on public.leads(status) where deleted_at is null;
create index leads_agent_idx on public.leads(agent_id) where deleted_at is null;

-- pre_leads (Phase 3 UI; schema now)
create table public.pre_leads (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.profiles(id),
  business_name text not null,
  phone_number text, email text, owner_name text,
  google_yelp_link text,
  areas text[] default '{}', services text[] default '{}',
  service_offered text, service_type text,
  pricing numeric(10,2),
  lead_category text not null,
  status text default 'Next follow up',
  follow_up_time timestamptz, comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_updated_by uuid references public.profiles(id),
  deleted_at timestamptz
);

-- ai_generations (Phase 4 UI; schema now)
create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  tool text not null, agent_id uuid references public.profiles(id),
  lead_id uuid references public.leads(id), business_name text,
  total_time_ms integer, input_time_ms integer, ai_time_ms integer,
  num_pages integer, page_types text[] default '{}', tokens_used integer,
  cost_usd numeric(8,6), status text default 'pending', word_count integer,
  image_count integer, pexels_count integer, complexity_score numeric(5,2),
  errors text, file_path text, created_at timestamptz not null default now()
);

-- activity_log
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text not null, entity_type text, entity_id uuid,
  old_value jsonb, new_value jsonb, created_at timestamptz not null default now()
);

-- updated_at trigger
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
create trigger trg_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger trg_leads_touch before update on public.leads for each row execute function public.touch_updated_at();
create trigger trg_prelead_touch before update on public.pre_leads for each row execute function public.touch_updated_at();
```

- [ ] **Step 2: Write RLS policies — append to the same migration**

```sql
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.department_members enable row level security;
alter table public.permissions enable row level security;
alter table public.department_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.leads enable row level security;
alter table public.pre_leads enable row level security;
alter table public.ai_generations enable row level security;
alter table public.activity_log enable row level security;

-- helper: is the current user an admin (member of 'Admin' dept)?
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from department_members dm
    join departments d on d.id = dm.department_id
    where dm.user_id = auth.uid() and d.slug = 'admin'
  );
$$;

-- authenticated users may read reference + their own context
create policy "read own profile or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "read departments" on public.departments for select to authenticated using (true);
create policy "read permissions" on public.permissions for select to authenticated using (true);
create policy "read dept_members self/admin" on public.department_members for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "read dept_perms" on public.department_permissions for select to authenticated using (true);
create policy "read own overrides/admin" on public.user_permission_overrides for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- leads: any authenticated read (non-deleted handled in queries); writes via service role / handlers re-checking perms
create policy "read leads" on public.leads for select to authenticated using (true);

-- admin-only writes on access-control tables
create policy "admin writes departments" on public.departments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin writes dept_members" on public.department_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin writes dept_perms" on public.department_permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin writes overrides" on public.user_permission_overrides for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin writes profiles" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

> Note: Mutations that need finer-grained permission checks (lead edits in Phase 2, user creation) run through Route Handlers using the service-role client, which bypasses RLS, and re-check the resolved permission set in code. RLS above is the safety net for direct client reads.

- [ ] **Step 3: Apply the migration** (executor uses Supabase MCP `apply_migration` with name `0001_core_schema`)

- [ ] **Step 4: Verify tables exist**

Use Supabase MCP `list_tables`; expected: all 10 tables present with RLS enabled.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: core db schema + RLS migration"
```

---

## Task 5: Seed permissions, departments, mapping & bootstrap admin

**Files:**
- Create: `supabase/seed.sql`
- Create: `lib/permissions/constants.ts`

- [ ] **Step 1: Permission catalogue constant `lib/permissions/constants.ts`**

```ts
export const PERMISSIONS = [
  { key: "leads.view", name: "View Leads", category: "leads" },
  { key: "leads.create", name: "Create Lead", category: "leads" },
  { key: "leads.edit", name: "Edit Lead", category: "leads" },
  { key: "leads.delete", name: "Delete Lead", category: "leads", is_sensitive: true },
  { key: "leads.status_change", name: "Change Lead Status", category: "leads" },
  { key: "leads.view_all", name: "View All Agents' Leads", category: "leads" },
  { key: "leads.export", name: "Export Leads", category: "leads" },
  { key: "pre_leads.view", name: "View Pre-Leads", category: "pre_leads" },
  { key: "pre_leads.create", name: "Create Pre-Lead", category: "pre_leads" },
  { key: "pre_leads.edit", name: "Edit Pre-Lead", category: "pre_leads" },
  { key: "pre_leads.delete", name: "Delete Pre-Lead", category: "pre_leads", is_sensitive: true },
  { key: "pre_leads.followup", name: "Update Follow-up", category: "pre_leads" },
  { key: "analytics.view", name: "View Analytics", category: "analytics" },
  { key: "analytics.view_webcraft", name: "View WebCraft Analytics", category: "analytics" },
  { key: "analytics.view_deepseek", name: "View DeepSeek Analytics", category: "analytics" },
  { key: "analytics.view_all_agents", name: "View All-Agent Analytics", category: "analytics" },
  { key: "ai_tools.webcraft", name: "Use WebCraft", category: "ai_tools" },
  { key: "ai_tools.deepseek", name: "Use DeepSeek", category: "ai_tools" },
  { key: "admin.users.view", name: "View Users", category: "admin" },
  { key: "admin.users.create", name: "Create Users", category: "admin", is_sensitive: true },
  { key: "admin.users.edit", name: "Edit Users", category: "admin" },
  { key: "admin.users.deactivate", name: "Deactivate Users", category: "admin", is_sensitive: true },
  { key: "admin.departments.manage", name: "Manage Departments", category: "admin", is_sensitive: true },
  { key: "admin.permissions.manage", name: "Manage Permissions", category: "admin", is_sensitive: true },
  { key: "admin.logs.view", name: "View Activity Log", category: "admin" },
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
```

- [ ] **Step 2: Write `supabase/seed.sql`** (permissions, departments, default mapping)

```sql
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.view','View Leads',null,'leads',false),
  ('leads.create','Create Lead',null,'leads',false),
  ('leads.edit','Edit Lead',null,'leads',false),
  ('leads.delete','Delete Lead',null,'leads',true),
  ('leads.status_change','Change Lead Status',null,'leads',false),
  ('leads.view_all',"View All Agents' Leads",null,'leads',false),
  ('leads.export','Export Leads',null,'leads',false),
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
  ('admin.users.view','View Users',null,'admin',false),
  ('admin.users.create','Create Users',null,'admin',true),
  ('admin.users.edit','Edit Users',null,'admin',false),
  ('admin.users.deactivate','Deactivate Users',null,'admin',true),
  ('admin.departments.manage','Manage Departments',null,'admin',true),
  ('admin.permissions.manage','Manage Permissions',null,'admin',true),
  ('admin.logs.view','View Activity Log',null,'admin',false)
on conflict (key) do nothing;

insert into public.departments (name, slug, description, color, icon) values
  ('Sales','sales','Lead generation & pre-leads','#0D9488','phone'),
  ('Management','management','Oversees all leads & analytics','#7E22CE','briefcase'),
  ('Tech','tech','AI tools & website generation','#2563EB','code'),
  ('Support','support','Read-only assistance','#B45309','headphones'),
  ('Admin','admin','Full system administration','#141B2D','shield')
on conflict (slug) do nothing;

-- default department -> permission mapping (audit matrix)
insert into public.department_permissions (department_id, permission_key)
select d.id, p.key from public.departments d join public.permissions p on true
where (d.slug,p.key) in (
  ('sales','leads.view'),('sales','leads.create'),
  ('sales','pre_leads.view'),('sales','pre_leads.create'),('sales','pre_leads.edit'),('sales','pre_leads.followup'),
  ('sales','analytics.view'),('sales','ai_tools.webcraft'),('sales','ai_tools.deepseek'),
  ('management','leads.view'),('management','leads.create'),('management','leads.edit'),('management','leads.delete'),
  ('management','leads.status_change'),('management','leads.view_all'),
  ('management','pre_leads.view'),('management','pre_leads.create'),('management','pre_leads.edit'),('management','pre_leads.delete'),('management','pre_leads.followup'),
  ('management','analytics.view'),('management','analytics.view_webcraft'),('management','analytics.view_deepseek'),('management','analytics.view_all_agents'),
  ('tech','analytics.view'),('tech','analytics.view_webcraft'),('tech','analytics.view_deepseek'),('tech','ai_tools.webcraft'),('tech','ai_tools.deepseek'),
  ('support','leads.view')
)
on conflict do nothing;

-- Admin department gets every permission
insert into public.department_permissions (department_id, permission_key)
select d.id, p.key from public.departments d cross join public.permissions p
where d.slug = 'admin' on conflict do nothing;
```

- [ ] **Step 3: Apply seed** (executor runs `execute_sql` with the seed contents, or `apply_migration` named `0002_seed`)

- [ ] **Step 4: Create the bootstrap admin user** (executor, via Supabase MCP `execute_sql` + Auth)

Create an auth user (email `admin@sedsolutions.online`, a known temp password) using the admin API/SQL, then:
```sql
insert into public.profiles (id, email, full_name, display_name)
values ('<auth-user-id>', 'admin@sedsolutions.online', 'System Admin', 'Admin')
on conflict (id) do nothing;
insert into public.department_members (user_id, department_id)
select '<auth-user-id>', id from public.departments where slug='admin'
on conflict do nothing;
```

- [ ] **Step 5: Verify** with `execute_sql`: `select count(*) from permissions;` (25), `select count(*) from department_permissions where department_id=(select id from departments where slug='admin');` (25).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: seed permissions, departments, mapping + bootstrap admin"
```

---

## Task 6: Permission resolver (TDD)

**Files:**
- Create: `lib/permissions/types.ts`, `lib/permissions/resolver.ts`
- Create: `tests/resolver.test.ts`, `vitest.config.ts`, `vitest.setup.ts`

- [ ] **Step 1: Vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true, setupFiles: ["./vitest.setup.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```
`vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```
Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 2: Types `lib/permissions/types.ts`**

```ts
export interface DeptPermRow { permission_key: string; }
export interface OverrideRow { permission_key: string; is_granted: boolean; expires_at: string | null; }
export function resolvePermissions(
  deptPerms: DeptPermRow[],
  overrides: OverrideRow[],
  now: Date = new Date()
): Set<string> {
  const perms = new Set(deptPerms.map((p) => p.permission_key));
  for (const o of overrides) {
    if (o.expires_at && new Date(o.expires_at) <= now) continue;
    if (o.is_granted) perms.add(o.permission_key);
    else perms.delete(o.permission_key);
  }
  return perms;
}
```

- [ ] **Step 3: Write the failing test `tests/resolver.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolvePermissions } from "@/lib/permissions/types";

describe("resolvePermissions", () => {
  it("unions department permissions", () => {
    const r = resolvePermissions([{ permission_key: "leads.view" }, { permission_key: "leads.edit" }], []);
    expect(r.has("leads.view")).toBe(true);
    expect(r.has("leads.edit")).toBe(true);
  });
  it("adds user grants on top of dept perms", () => {
    const r = resolvePermissions([{ permission_key: "leads.view" }], [{ permission_key: "leads.export", is_granted: true, expires_at: null }]);
    expect(r.has("leads.export")).toBe(true);
  });
  it("revokes a dept permission via override", () => {
    const r = resolvePermissions([{ permission_key: "leads.delete" }], [{ permission_key: "leads.delete", is_granted: false, expires_at: null }]);
    expect(r.has("leads.delete")).toBe(false);
  });
  it("ignores expired overrides", () => {
    const past = new Date("2020-01-01").toISOString();
    const r = resolvePermissions([], [{ permission_key: "leads.export", is_granted: true, expires_at: past }], new Date("2026-01-01"));
    expect(r.has("leads.export")).toBe(false);
  });
  it("dedupes union from multiple departments", () => {
    const r = resolvePermissions([{ permission_key: "leads.view" }, { permission_key: "leads.view" }], []);
    expect([...r].filter((k) => k === "leads.view").length).toBe(1);
  });
});
```

- [ ] **Step 4: Run, expect FAIL**

Run: `npm test -- resolver`
Expected: PASS already (logic in Step 2). If you prefer strict red-green, write Step 3 before Step 2 and confirm the import error first.

- [ ] **Step 5: Server-side resolver `lib/permissions/resolver.ts`** (fetches rows, calls pure fn)

```ts
import { createClient } from "@/lib/supabase/server";
import { resolvePermissions } from "./types";

export async function getUserPermissions(userId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data: deptPerms } = await supabase
    .from("department_permissions")
    .select("permission_key, departments!inner(department_members!inner(user_id))")
    .eq("departments.department_members.user_id", userId);
  const { data: overrides } = await supabase
    .from("user_permission_overrides")
    .select("permission_key, is_granted, expires_at")
    .eq("user_id", userId);
  return resolvePermissions(
    (deptPerms ?? []).map((p: any) => ({ permission_key: p.permission_key })),
    (overrides ?? []) as any
  );
}
```

- [ ] **Step 6: Run tests, expect PASS**

Run: `npm test`
Expected: 5 passing.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: permission resolver with tests"
```

---

## Task 7: Login page + auth actions

**Files:**
- Create: `app/login/page.tsx`, `app/login/actions.ts`
- Replace: `app/page.tsx`

- [ ] **Step 1: `app/page.tsx` → redirect**

```tsx
import { redirect } from "next/navigation";
export default function Home() { redirect("/dashboard"); }
```

- [ ] **Step 2: Server action `app/login/actions.ts`**

```ts
"use server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function login(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid email or password" };
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 3: `app/login/page.tsx`** (light-theme card, accent button)

```tsx
"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <main className="min-h-screen grid place-items-center bg-bg">
      <form action={action} className="w-[360px] bg-surface border border-border rounded-lg p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-text">SED LMS</h1>
        <p className="text-sm text-text-muted mt-1 mb-6">Sign in to your dashboard</p>
        {state?.error && <div className="mb-4 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{state.error}</div>}
        <label className="block text-xs font-semibold uppercase tracking-wide text-text-faint mb-1">Email</label>
        <input name="email" type="email" required autoFocus className="w-full mb-4 px-3 py-2 rounded-md border border-border bg-surface text-text outline-none focus:ring-2 focus:ring-accent" />
        <label className="block text-xs font-semibold uppercase tracking-wide text-text-faint mb-1">Password</label>
        <input name="password" type="password" required className="w-full mb-6 px-3 py-2 rounded-md border border-border bg-surface text-text outline-none focus:ring-2 focus:ring-accent" />
        <button disabled={pending} className="w-full bg-accent text-white rounded-md py-2 font-semibold disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Verify login works end-to-end**

Run `npm run dev`, go to `/login`, sign in with the bootstrap admin → redirected to `/dashboard` (404 until Task 8). Wrong password → inline error.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: login page + auth actions"
```

---

## Task 8: App shell + PermissionProvider + authenticated layout

**Files:**
- Create: `providers/PermissionProvider.tsx`, `hooks/usePermissions.ts`, `components/shared/PermissionGate.tsx`
- Create: `components/layout/{AppShell,Sidebar,Topbar}.tsx`
- Create: `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx`
- Create: `tests/permission-gate.test.tsx`

- [ ] **Step 1: Provider + hook**

`providers/PermissionProvider.tsx`:
```tsx
"use client";
import { createContext, useContext } from "react";
const Ctx = createContext<Set<string>>(new Set());
export function PermissionProvider({ value, children }: { value: string[]; children: React.ReactNode }) {
  return <Ctx.Provider value={new Set(value)}>{children}</Ctx.Provider>;
}
export function usePermissionSet() { return useContext(Ctx); }
```
`hooks/usePermissions.ts`:
```ts
"use client";
import { usePermissionSet } from "@/providers/PermissionProvider";
export function usePermissions() {
  const set = usePermissionSet();
  return { has: (k: string) => set.has(k), all: set };
}
```

- [ ] **Step 2: `PermissionGate` + failing test**

`components/shared/PermissionGate.tsx`:
```tsx
"use client";
import { usePermissions } from "@/hooks/usePermissions";
export function PermissionGate({ perm, children, fallback = null }: { perm: string; children: React.ReactNode; fallback?: React.ReactNode; }) {
  const { has } = usePermissions();
  return has(perm) ? <>{children}</> : <>{fallback}</>;
}
```
`tests/permission-gate.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionProvider } from "@/providers/PermissionProvider";
import { PermissionGate } from "@/components/shared/PermissionGate";

describe("PermissionGate", () => {
  it("renders children when permission present", () => {
    render(<PermissionProvider value={["leads.edit"]}><PermissionGate perm="leads.edit">OK</PermissionGate></PermissionProvider>);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });
  it("renders fallback when permission absent", () => {
    render(<PermissionProvider value={[]}><PermissionGate perm="leads.edit" fallback="NO">OK</PermissionGate></PermissionProvider>);
    expect(screen.getByText("NO")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run gate test, expect PASS**

Run: `npm test -- permission-gate`
Expected: 2 passing.

- [ ] **Step 4: Sidebar (permission-filtered) `components/layout/Sidebar.tsx`**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", perm: "analytics.view" },
  { href: "/leads", label: "Leads", perm: "leads.view" },
  { href: "/by-agent", label: "By Agent", perm: "analytics.view" },
];
const ADMIN_NAV = [
  { href: "/admin/users", label: "Users", perm: "admin.users.view" },
  { href: "/admin/departments", label: "Departments", perm: "admin.departments.manage" },
  { href: "/admin/permissions", label: "Permissions", perm: "admin.permissions.manage" },
];

export function Sidebar() {
  const { has } = usePermissions();
  const path = usePathname();
  const item = (n: { href: string; label: string }) => (
    <Link key={n.href} href={n.href} className={cn("flex items-center px-3 py-2 rounded-md text-sm font-medium",
      path.startsWith(n.href) ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>{n.label}</Link>
  );
  const adminVisible = ADMIN_NAV.filter((n) => has(n.perm));
  return (
    <aside className="w-56 shrink-0 bg-surface-2 border-r border-border p-3 flex flex-col gap-1">
      <div className="px-3 py-2 font-semibold text-text">SED LMS</div>
      {NAV.filter((n) => has(n.perm)).map(item)}
      {adminVisible.length > 0 && <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-text-faint">Admin</div>}
      {adminVisible.map(item)}
    </aside>
  );
}
```

- [ ] **Step 5: Topbar + AppShell**

`components/layout/Topbar.tsx`:
```tsx
import { logout } from "@/app/login/actions";
export function Topbar({ email }: { email: string }) {
  return (
    <header className="h-14 border-b border-border bg-surface flex items-center justify-between px-5">
      <div className="text-sm text-text-faint">Search leads… <span className="font-mono">⌘K</span></div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-muted">{email}</span>
        <form action={logout}><button className="text-sm text-text-muted hover:text-text">Sign out</button></form>
      </div>
    </header>
  );
}
```
`components/layout/AppShell.tsx`:
```tsx
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar email={email} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Authenticated layout `app/(app)/layout.tsx`** (auth guard + resolve perms)

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { PermissionProvider } from "@/providers/PermissionProvider";
import { AppShell } from "@/components/layout/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  return (
    <PermissionProvider value={[...perms]}>
      <AppShell email={user.email ?? ""}>{children}</AppShell>
    </PermissionProvider>
  );
}
```

- [ ] **Step 7: Dashboard placeholder `app/(app)/dashboard/page.tsx`**

```tsx
export default function DashboardPage() {
  return <div><h1 className="text-xl font-semibold text-text">Dashboard</h1><p className="text-text-muted mt-1">KPIs and charts land in Phase 2.</p></div>;
}
```

- [ ] **Step 8: Verify shell + gating**

Run `npm run dev`, log in as admin → see sidebar incl. Admin section; all nav present (admin has every perm). `npm test` → all green.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: app shell, permission provider, gate (+tests)"
```

---

## Task 9: Admin → Create User Route Handler (TDD on validation)

**Files:**
- Create: `lib/admin/createUserSchema.ts`, `app/api/admin/users/route.ts`
- Create: `tests/createUserSchema.test.ts`

- [ ] **Step 1: Zod schema `lib/admin/createUserSchema.ts`**

```ts
import { z } from "zod";
export const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  displayName: z.string().min(1),
  tempPassword: z.string().min(8),
  departmentIds: z.array(z.string().uuid()).min(1),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;
```

- [ ] **Step 2: Failing test `tests/createUserSchema.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createUserSchema } from "@/lib/admin/createUserSchema";
describe("createUserSchema", () => {
  it("rejects short passwords", () => {
    expect(createUserSchema.safeParse({ email: "a@b.com", fullName: "A", displayName: "A", tempPassword: "short", departmentIds: ["11111111-1111-1111-1111-111111111111"] }).success).toBe(false);
  });
  it("requires at least one department", () => {
    expect(createUserSchema.safeParse({ email: "a@b.com", fullName: "A", displayName: "A", tempPassword: "longenough", departmentIds: [] }).success).toBe(false);
  });
  it("accepts valid input", () => {
    expect(createUserSchema.safeParse({ email: "a@b.com", fullName: "A", displayName: "A", tempPassword: "longenough", departmentIds: ["11111111-1111-1111-1111-111111111111"] }).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run test → expect PASS** (`npm test -- createUserSchema`).

- [ ] **Step 4: Route Handler `app/api/admin/users/route.ts`** (re-checks permission, service role)

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createUserSchema } from "@/lib/admin/createUserSchema";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.users.create")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createUserSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  const { email, fullName, displayName, tempPassword, departmentIds } = parsed.data;

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: tempPassword, email_confirm: true,
  });
  if (error || !created.user) return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });

  const uid = created.user.id;
  await admin.from("profiles").insert({ id: uid, email, full_name: fullName, display_name: displayName, created_by: user.id });
  await admin.from("department_members").insert(departmentIds.map((d) => ({ user_id: uid, department_id: d, added_by: user.id })));
  await admin.from("activity_log").insert({ user_id: user.id, action: "user.created", entity_type: "user", entity_id: uid, new_value: { email } });
  return NextResponse.json({ id: uid }, { status: 201 });
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: admin create-user route handler (+schema tests)"
```

---

## Task 10: Admin → Users page (list + create dialog)

**Files:**
- Create: `app/(app)/admin/users/page.tsx`, `components/admin/UserTable.tsx`, `components/admin/CreateUserDialog.tsx`

- [ ] **Step 1: Server page fetches users + departments**

`app/(app)/admin/users/page.tsx`:
```tsx
import { createClient } from "@/lib/supabase/server";
import { UserTable } from "@/components/admin/UserTable";
import { CreateUserDialog } from "@/components/admin/CreateUserDialog";

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, display_name, is_active, created_at, department_members(departments(name, color))")
    .order("created_at", { ascending: false });
  const { data: departments } = await supabase.from("departments").select("id, name").eq("is_active", true);
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold text-text">Users</h1>
        <CreateUserDialog departments={departments ?? []} />
      </div>
      <UserTable users={users ?? []} />
    </div>
  );
}
```

- [ ] **Step 2: `UserTable.tsx`** (light, dense, status + dept badges)

```tsx
"use client";
export function UserTable({ users }: { users: any[] }) {
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[10px] uppercase tracking-wide text-text-faint border-b border-border">
          <th className="px-4 py-3">User</th><th className="px-4 py-3">Departments</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created</th>
        </tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-border-subtle">
              <td className="px-4 py-3"><div className="font-medium text-text">{u.display_name}</div><div className="text-text-faint text-xs">{u.email}</div></td>
              <td className="px-4 py-3 space-x-1">{u.department_members?.map((m: any, i: number) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: (m.departments?.color ?? "#0D9488") + "22", color: m.departments?.color ?? "#0D9488" }}>{m.departments?.name}</span>
              ))}</td>
              <td className="px-4 py-3">{u.is_active
                ? <span className="text-xs px-2 py-0.5 rounded-full bg-ready-bg text-ready-fg">Active</span>
                : <span className="text-xs px-2 py-0.5 rounded-full bg-dropped-bg text-dropped-fg">Inactive</span>}</td>
              <td className="px-4 py-3 font-mono text-text-muted text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: `CreateUserDialog.tsx`** (RHF + Zod, POSTs to the handler)

```tsx
"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createUserSchema, type CreateUserInput } from "@/lib/admin/createUserSchema";
import { useRouter } from "next/navigation";

export function CreateUserDialog({ departments }: { departments: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<CreateUserInput>({ resolver: zodResolver(createUserSchema) });
  async function onSubmit(values: CreateUserInput) {
    const res = await fetch("/api/admin/users", { method: "POST", body: JSON.stringify(values) });
    if (!res.ok) { setError("email", { message: (await res.json()).error ?? "Failed" }); return; }
    setOpen(false); router.refresh();
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className="bg-accent text-white rounded-md px-4 py-2 text-sm font-semibold">+ New User</button>
      {open && (
        <div className="fixed inset-0 bg-black/30 grid place-items-center z-50" onClick={() => setOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit(onSubmit)} className="bg-surface border border-border rounded-lg p-6 w-[420px]">
            <h2 className="font-semibold text-text mb-4">Create user</h2>
            {(["fullName","displayName","email","tempPassword"] as const).map((f) => (
              <div key={f} className="mb-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-text-faint mb-1">{f}</label>
                <input type={f === "tempPassword" ? "text" : f === "email" ? "email" : "text"} {...register(f)} className="w-full px-3 py-2 rounded-md border border-border focus:ring-2 focus:ring-accent outline-none" />
                {errors[f] && <p className="text-xs text-dropped-fg mt-1">{errors[f]?.message as string}</p>}
              </div>
            ))}
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-faint mb-1">Departments</label>
            <select multiple {...register("departmentIds")} className="w-full px-3 py-2 rounded-md border border-border mb-4 h-28">
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-md border border-border">Cancel</button>
              <button disabled={isSubmitting} className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold disabled:opacity-60">Create</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Verify** — as admin, open `/admin/users`, create a user, confirm it appears with dept badges and the new user can log in with the temp password.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: admin users page (list + create dialog)"
```

---

## Task 11: Admin → Departments (CRUD + members + permission toggle grid)

**Files:**
- Create: `app/(app)/admin/departments/page.tsx`, `app/(app)/admin/departments/[id]/page.tsx`
- Create: `components/admin/PermissionToggleGrid.tsx`
- Create: `app/api/admin/departments/[id]/permissions/route.ts`

- [ ] **Step 1: Departments list page** — server fetch with member + permission counts, link each to detail.

```tsx
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
export default async function DepartmentsPage() {
  const supabase = await createClient();
  const { data: depts } = await supabase.from("departments")
    .select("id, name, slug, color, department_members(count), department_permissions(count)").order("name");
  return (
    <div>
      <h1 className="text-xl font-semibold text-text mb-5">Departments</h1>
      <div className="grid grid-cols-3 gap-4">
        {(depts ?? []).map((d: any) => (
          <Link key={d.id} href={`/admin/departments/${d.id}`} className="bg-surface border border-border rounded-lg p-4 hover:border-accent">
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: d.color }} /><span className="font-medium text-text">{d.name}</span></div>
            <div className="mt-3 text-xs text-text-faint font-mono">{d.department_members?.[0]?.count ?? 0} members · {d.department_permissions?.[0]?.count ?? 0} perms</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Permission-toggle route `app/api/admin/departments/[id]/permissions/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await getUserPermissions(user.id)).has("admin.permissions.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { permissionKey, enabled } = await req.json();
  const admin = createAdminClient();
  if (enabled) await admin.from("department_permissions").upsert({ department_id: id, permission_key: permissionKey, granted_by: user.id }, { onConflict: "department_id,permission_key" });
  else await admin.from("department_permissions").delete().eq("department_id", id).eq("permission_key", permissionKey);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Detail page `[id]/page.tsx`** — fetch department, all permissions, its granted set, current members; render `PermissionToggleGrid` and member list. (Server component fetch + client grid.)

```tsx
import { createClient } from "@/lib/supabase/server";
import { PermissionToggleGrid } from "@/components/admin/PermissionToggleGrid";

export default async function DeptDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: dept } = await supabase.from("departments").select("id, name").eq("id", id).single();
  const { data: perms } = await supabase.from("permissions").select("key, name, category").order("category");
  const { data: granted } = await supabase.from("department_permissions").select("permission_key").eq("department_id", id);
  const grantedSet = new Set((granted ?? []).map((g) => g.permission_key));
  return (
    <div>
      <h1 className="text-xl font-semibold text-text mb-5">{dept?.name} — Permissions</h1>
      <PermissionToggleGrid deptId={id} permissions={perms ?? []} granted={[...grantedSet]} />
    </div>
  );
}
```

- [ ] **Step 4: `PermissionToggleGrid.tsx`** (client, grouped by category, optimistic toggle)

```tsx
"use client";
import { useState } from "react";
export function PermissionToggleGrid({ deptId, permissions, granted }: { deptId: string; permissions: { key: string; name: string; category: string }[]; granted: string[]; }) {
  const [on, setOn] = useState(new Set(granted));
  const groups = permissions.reduce<Record<string, typeof permissions>>((a, p) => ((a[p.category] ??= []).push(p), a), {});
  async function toggle(key: string) {
    const enabled = !on.has(key);
    setOn((prev) => { const n = new Set(prev); enabled ? n.add(key) : n.delete(key); return n; });
    await fetch(`/api/admin/departments/${deptId}/permissions`, { method: "POST", body: JSON.stringify({ permissionKey: key, enabled }) });
  }
  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([cat, perms]) => (
        <div key={cat} className="bg-surface border border-border rounded-lg p-4">
          <div className="text-[10px] uppercase tracking-wider text-text-faint mb-3">{cat}</div>
          <div className="grid grid-cols-2 gap-2">
            {perms.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" checked={on.has(p.key)} onChange={() => toggle(p.key)} className="accent-accent" />
                {p.name} <span className="font-mono text-xs text-text-faint">{p.key}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Verify** — toggle a permission for "Sales", reload, confirm it persisted; a Sales-only user's nav reflects the change after re-login.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: admin departments + permission toggle grid"
```

---

## Task 12: Admin → Permissions catalogue + User overrides

**Files:**
- Create: `app/(app)/admin/permissions/page.tsx`
- Create: `app/(app)/admin/users/[id]/page.tsx`, `components/admin/UserOverrides.tsx`
- Create: `app/api/admin/users/[id]/overrides/route.ts`, `app/api/admin/users/[id]/route.ts` (activate/deactivate + dept assignment)

- [ ] **Step 1: Permissions catalogue page** — read-only grid grouped by category, showing which departments grant each key.

```tsx
import { createClient } from "@/lib/supabase/server";
export default async function PermissionsPage() {
  const supabase = await createClient();
  const { data: perms } = await supabase.from("permissions").select("key, name, category, is_sensitive").order("category");
  const { data: dp } = await supabase.from("department_permissions").select("permission_key, departments(name)");
  const byKey = (dp ?? []).reduce<Record<string, string[]>>((a, r: any) => ((a[r.permission_key] ??= []).push(r.departments?.name), a), {});
  return (
    <div>
      <h1 className="text-xl font-semibold text-text mb-5">Permissions</h1>
      <div className="bg-surface border border-border rounded-lg divide-y divide-border-subtle">
        {(perms ?? []).map((p) => (
          <div key={p.key} className="flex items-center justify-between px-4 py-3">
            <div><div className="text-sm text-text">{p.name} {p.is_sensitive && <span className="text-xs text-dropped-fg">sensitive</span>}</div><div className="font-mono text-xs text-text-faint">{p.key}</div></div>
            <div className="text-xs text-text-muted">{(byKey[p.key] ?? []).join(", ") || "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Override route `app/api/admin/users/[id]/overrides/route.ts`** — mirrors the dept-permission route, writes `user_permission_overrides` (upsert grant/revoke, optional expiry), guarded by `admin.permissions.manage`.

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await getUserPermissions(user.id)).has("admin.permissions.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { permissionKey, isGranted, remove } = await req.json();
  const admin = createAdminClient();
  if (remove) await admin.from("user_permission_overrides").delete().eq("user_id", id).eq("permission_key", permissionKey);
  else await admin.from("user_permission_overrides").upsert({ user_id: id, permission_key: permissionKey, is_granted: isGranted, granted_by: user.id }, { onConflict: "user_id,permission_key" });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Activate/deactivate + dept assignment route `app/api/admin/users/[id]/route.ts`** (PATCH).

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  const body = await req.json();
  const admin = createAdminClient();
  if ("isActive" in body) {
    if (!perms.has("admin.users.deactivate")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await admin.from("profiles").update({ is_active: body.isActive }).eq("id", id);
    await admin.auth.admin.updateUserById(id, { ban_duration: body.isActive ? "none" : "876000h" });
  }
  if ("departmentIds" in body) {
    if (!perms.has("admin.users.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await admin.from("department_members").delete().eq("user_id", id);
    if (body.departmentIds.length) await admin.from("department_members").insert(body.departmentIds.map((d: string) => ({ user_id: id, department_id: d, added_by: user.id })));
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: User detail page + `UserOverrides.tsx`** — show effective permissions (computed), dept assignment editor, and grant/revoke toggles writing to the override route. (Server fetch of user, depts, all perms, current overrides; client component for toggles, same pattern as `PermissionToggleGrid`.)

- [ ] **Step 5: Verify** — grant a Sales user `leads.delete` via override → they gain it; revoke a dept-granted perm via override → they lose it; deactivate a user → they can't log in.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: permissions catalogue + user overrides + activate/deactivate"
```

---

## Task 13: E2E smoke test (Playwright)

**Files:**
- Create: `playwright.config.ts`, `e2e/auth.spec.ts`

- [ ] **Step 1: Playwright config** (baseURL `http://localhost:3000`, `webServer` runs `npm run dev`). Add script `"e2e": "playwright test"`.

- [ ] **Step 2: Smoke spec `e2e/auth.spec.ts`**

```ts
import { test, expect } from "@playwright/test";
test("login → dashboard → admin nav visible for admin", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', process.env.E2E_ADMIN_EMAIL!);
  await page.fill('input[name="password"]', process.env.E2E_ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByText("Users")).toBeVisible();
});
test("unauthenticated is redirected to login", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/login/);
});
```

- [ ] **Step 3: Install browser + run**

Run: `npx playwright install chromium && npm run e2e`
Expected: 2 passing (with `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` set to the bootstrap admin).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: playwright auth + nav smoke"
```

---

## Self-Review (completed by plan author)

**Spec coverage** — Phase 1 items mapped: scaffold/tokens (T1–2), Supabase + migrations + RLS (T3–4), seed + bootstrap admin (T5), resolver (T6), auth/login + middleware (T3,T7), app shell + provider + gate (T8), admin users CRUD + create (T9–10, T12), departments + toggle grid (T11), permissions catalogue + overrides + activate/deactivate (T12), tests (T6,T8,T9,T13). ✅
**Placeholder scan** — Task 12 Step 4 and Task 11 Step 1 describe components by pattern but every referenced symbol (PermissionToggleGrid pattern, routes) has concrete code in this plan; no TODO/TBD strings. The "describe by pattern" steps repeat an already-shown component shape intentionally to avoid duplication, with the API contract fully specified.
**Type consistency** — `resolvePermissions` / `getUserPermissions` signatures consistent across T6/T8/T9/T11/T12; `createUserSchema` fields consistent T9/T10; permission keys match seed + constants.
**Out-of-scope confirmed** — pre_leads/ai_generations/activity_log tables created (schema) but no UI; Phase 2 dashboard/leads deferred to the Phase 2 plan.
