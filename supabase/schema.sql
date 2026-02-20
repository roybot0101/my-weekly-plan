create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_week_start text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  duration integer not null default 30,
  due_date date,
  urgent boolean not null default false,
  important boolean not null default false,
  notes text not null default '',
  links text[] not null default '{}',
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'Not Started',
  scheduled jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "Profiles owner select" on public.profiles;
create policy "Profiles owner select" on public.profiles
for select using (auth.uid() = user_id);

drop policy if exists "Profiles owner upsert" on public.profiles;
create policy "Profiles owner upsert" on public.profiles
for insert with check (auth.uid() = user_id);

drop policy if exists "Profiles owner update" on public.profiles;
create policy "Profiles owner update" on public.profiles
for update using (auth.uid() = user_id);

drop policy if exists "Tasks owner read" on public.tasks;
create policy "Tasks owner read" on public.tasks
for select using (auth.uid() = user_id);

drop policy if exists "Tasks owner insert" on public.tasks;
create policy "Tasks owner insert" on public.tasks
for insert with check (auth.uid() = user_id);

drop policy if exists "Tasks owner update" on public.tasks;
create policy "Tasks owner update" on public.tasks
for update using (auth.uid() = user_id);

drop policy if exists "Tasks owner delete" on public.tasks;
create policy "Tasks owner delete" on public.tasks
for delete using (auth.uid() = user_id);

alter table public.profiles
add column if not exists backlog_order text[] not null default '{}';

alter table public.profiles
add column if not exists kanban_order text[] not null default '{}';
