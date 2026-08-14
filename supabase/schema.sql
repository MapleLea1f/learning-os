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
  workspace_id uuid,
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

alter table public.work_plans
  add column if not exists workspace_id uuid;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  local_path text,
  status text not null default 'active' check (status in ('active', 'archived')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'work_plans_workspace_id_fkey'
      and conrelid = 'public.work_plans'::regclass
  ) then
    alter table public.work_plans
      add constraint work_plans_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces (id) on delete set null;
  end if;
end
$$;

create table if not exists public.workspace_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_task_id uuid references public.workspace_tasks (id) on delete cascade,
  title text not null,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'completed', 'blocked')),
  due_date date,
  notes text not null default '',
  source text not null default 'manual' check (source in ('manual', 'skill')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  resource_type text not null check (resource_type in ('link', 'chatgpt', 'deepseek', 'local_path', 'file_output')),
  title text not null,
  url text,
  path text,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  task_id uuid references public.workspace_tasks (id) on delete set null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'blocked', 'cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_executions
  add column if not exists task_id uuid references public.workspace_tasks (id) on delete set null;

create table if not exists public.workspace_execution_steps (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.workspace_executions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'blocked', 'cancelled')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connector_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  pairing_code_hash text not null unique,
  access_token text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  evidence_type text not null check (evidence_type in ('git_commit', 'file', 'command', 'test')),
  title text not null,
  content text not null default '',
  source_key text,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, source_key)
);

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

create index if not exists workspaces_user_updated_idx
  on public.workspaces (user_id, updated_at desc);

create index if not exists workspace_tasks_workspace_status_idx
  on public.workspace_tasks (workspace_id, status, priority, updated_at desc);

create index if not exists workspace_resources_workspace_created_idx
  on public.workspace_resources (workspace_id, created_at desc);

create index if not exists workspace_executions_workspace_updated_idx
  on public.workspace_executions (workspace_id, updated_at desc);

create index if not exists workspace_executions_task_idx
  on public.workspace_executions (task_id, updated_at desc);

create index if not exists workspace_execution_steps_execution_position_idx
  on public.workspace_execution_steps (execution_id, position, updated_at desc);

create index if not exists connector_pairings_expires_idx
  on public.connector_pairings (expires_at, used_at);

create index if not exists workspace_evidence_workspace_observed_idx
  on public.workspace_evidence (workspace_id, observed_at desc);

alter table public.allowed_users enable row level security;
alter table public.learning_days enable row level security;
alter table public.work_plans enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_tasks enable row level security;
alter table public.workspace_resources enable row level security;
alter table public.workspace_executions enable row level security;
alter table public.workspace_execution_steps enable row level security;
alter table public.connector_pairings enable row level security;
alter table public.workspace_evidence enable row level security;

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

drop policy if exists "approved user manages own workspaces" on public.workspaces;
create policy "approved user manages own workspaces"
  on public.workspaces for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());

drop policy if exists "approved user manages own workspace tasks" on public.workspace_tasks;
create policy "approved user manages own workspace tasks"
  on public.workspace_tasks for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());

drop policy if exists "approved user manages own workspace resources" on public.workspace_resources;
create policy "approved user manages own workspace resources"
  on public.workspace_resources for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());

drop policy if exists "approved user manages own workspace executions" on public.workspace_executions;
create policy "approved user manages own workspace executions"
  on public.workspace_executions for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());

drop policy if exists "approved user manages own workspace execution steps" on public.workspace_execution_steps;
create policy "approved user manages own workspace execution steps"
  on public.workspace_execution_steps for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());

drop policy if exists "approved user manages own connector pairings" on public.connector_pairings;
create policy "approved user manages own connector pairings"
  on public.connector_pairings for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());

drop policy if exists "approved user manages own workspace evidence" on public.workspace_evidence;
create policy "approved user manages own workspace evidence"
  on public.workspace_evidence for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());

create extension if not exists pgcrypto;

create or replace function public.exchange_connector_pairing(input_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pairing public.connector_pairings%rowtype;
begin
  select * into pairing
  from public.connector_pairings
  where pairing_code_hash = encode(extensions.digest(convert_to(input_code, 'UTF8'), 'sha256'::text), 'hex')
    and used_at is null
    and expires_at > now()
  for update;

  if pairing.id is null then
    return jsonb_build_object('ok', false, 'error', 'Invalid or expired pairing code.');
  end if;

  update public.connector_pairings set used_at = now() where id = pairing.id;
  return jsonb_build_object(
    'ok', true,
    'access_token', pairing.access_token,
    'workspace_id', pairing.workspace_id,
    'user_id', pairing.user_id
  );
end;
$$;

grant execute on function public.exchange_connector_pairing(text) to anon, authenticated;

-- After your first GitHub login, find your UUID in Authentication > Users,
-- then run this command once with your own UUID:
-- insert into public.allowed_users (user_id) values ('YOUR_AUTH_USER_UUID');
