-- Run this file in Supabase SQL Editor before enabling the dashboard.
-- The only account that can read or write data is added manually to allowed_users.

create table if not exists public.allowed_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.learning_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  record_date date not null,
  top_goal text not null default '',
  java_ai_minutes integer not null default 0 check (java_ai_minutes >= 0),
  platform_minutes integer not null default 0 check (platform_minutes >= 0),
  foundation_minutes integer not null default 0 check (foundation_minutes >= 0),
  events jsonb not null default '[]'::jsonb,
  evidence text not null default '',
  blocker text not null default '',
  reflection text not null default '',
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, record_date)
);

create table if not exists public.work_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  target_date date not null,
  next_action text not null,
  details text not null default '',
  github_repo text,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'blocked', 'completed')),
  scheduled_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe for existing installations: store the event title, category and timer
-- result alongside the existing aggregate minute columns.
alter table public.work_plans
  add column if not exists github_repo text;

alter table public.learning_days
  add column if not exists events jsonb not null default '[]'::jsonb;

-- Phase 1: evidence is stored as a JSON array; old text values are migrated as one text item.
alter table public.learning_days
  add column if not exists evidence_json jsonb not null default '[]'::jsonb;

alter table public.learning_days
  add column if not exists plan_notes jsonb not null default '{}'::jsonb;

update public.learning_days
set evidence_json = case
  when trim(evidence) = '' then '[]'::jsonb
  else jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'type', 'text', 'text', evidence, 'createdAt', now()::text))
end
where evidence_json = '[]'::jsonb and trim(evidence) <> '';

create index if not exists learning_days_user_date_idx
  on public.learning_days (user_id, record_date desc);

create index if not exists work_plans_user_schedule_idx
  on public.work_plans (user_id, scheduled_date, target_date);

create index if not exists work_plans_user_status_idx
  on public.work_plans (user_id, status, target_date);

alter table public.allowed_users enable row level security;
alter table public.learning_days enable row level security;
alter table public.work_plans enable row level security;

-- Security definer is intentional: RLS policies can check the allowlist without
-- exposing the full allowlist to a browser client.
create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_users where user_id = auth.uid()
  );
$$;

grant execute on function public.is_allowed_user() to authenticated;

drop policy if exists "read own allowlist row" on public.allowed_users;
create policy "read own allowlist row"
  on public.allowed_users for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "approved user manages own learning records" on public.learning_days;
create policy "approved user manages own learning records"
  on public.learning_days for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());

drop policy if exists "approved user manages own work plans" on public.work_plans;
create policy "approved user manages own work plans"
  on public.work_plans for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());

-- After your first GitHub login, find your UUID in Authentication > Users,
-- then run this command once with your own UUID:
-- insert into public.allowed_users (user_id) values ('YOUR_AUTH_USER_UUID');
