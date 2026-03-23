-- FinControl Supabase Schema
-- Run this in Supabase SQL Editor

-- Main data table
create table if not exists user_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  kind text not null check (kind in ('entry','history','revolut','investment','saving','stmtconfig')),
  record_id text not null,  -- local JS id for dedup
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, kind, record_id)
);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger user_data_updated_at
  before update on user_data
  for each row execute function update_updated_at();

-- Row Level Security
alter table user_data enable row level security;

create policy "Users can read own data"
  on user_data for select
  using (auth.uid() = user_id);

create policy "Users can insert own data"
  on user_data for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on user_data for update
  using (auth.uid() = user_id);

create policy "Users can delete own data"
  on user_data for delete
  using (auth.uid() = user_id);

-- Index for fast user queries
create index user_data_user_kind on user_data(user_id, kind);

-- User profiles (optional display name/avatar)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  gas_url text,  -- optional legacy Google Apps Script URL
  updated_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "Users can manage own profile"
  on profiles for all using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
