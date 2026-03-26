-- ============================================================
-- HYROX AI COACH — Supabase Schema
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- Habilitar UUID
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLA: profiles (extiende auth.users de Supabase)
-- ============================================================
create table public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  name        text,
  age         int,
  weight_kg   numeric(5,1),
  category    text default 'open_m',
  goal_time   text,          -- ej: "1:10:00"
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- TABLA: station_records (PRs y objetivos por estación)
-- ============================================================
create table public.station_records (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  station_key text not null,   -- 'skierg', 'sled_push', etc.
  pr_time     text,            -- ej: "2:30"
  goal_time   text,            -- objetivo para Buenos Aires
  updated_at  timestamptz default now(),
  unique(user_id, station_key)
);

-- ============================================================
-- TABLA: workouts
-- ============================================================
create table public.workouts (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  type        text not null,   -- 'run', 'pft', 'skierg', etc.
  workout_date date not null,
  duration    int not null,    -- minutos
  distance_km numeric(6,2),
  rpe         int check(rpe between 1 and 10),
  feeling     text,            -- 'great', 'good', 'ok', 'bad', 'terrible'
  notes       text,
  evaluation  text,            -- respuesta del coach IA
  created_at  timestamptz default now()
);

-- ============================================================
-- TABLA: workout_blocks (bloques de sesiones PFT)
-- ============================================================
create table public.workout_blocks (
  id          uuid default uuid_generate_v4() primary key,
  workout_id  uuid references public.workouts(id) on delete cascade not null,
  position    int not null,    -- orden del bloque (1, 2, 3...)
  exercise    text not null,   -- 'skierg', 'row', 'run', etc.
  amount      text,            -- "500m", "30 reps"
  time_done   text,            -- "2:10"
  note        text
);

-- ============================================================
-- ROW LEVEL SECURITY — cada usuario solo ve sus datos
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.station_records enable row level security;
alter table public.workouts        enable row level security;
alter table public.workout_blocks  enable row level security;

-- Profiles: el usuario solo ve y edita su propio perfil
create policy "profiles_select" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Station records
create policy "stations_select" on public.station_records for select using (auth.uid() = user_id);
create policy "stations_insert" on public.station_records for insert with check (auth.uid() = user_id);
create policy "stations_update" on public.station_records for update using (auth.uid() = user_id);
create policy "stations_delete" on public.station_records for delete using (auth.uid() = user_id);

-- Workouts
create policy "workouts_select" on public.workouts for select using (auth.uid() = user_id);
create policy "workouts_insert" on public.workouts for insert with check (auth.uid() = user_id);
create policy "workouts_update" on public.workouts for update using (auth.uid() = user_id);
create policy "workouts_delete" on public.workouts for delete using (auth.uid() = user_id);

-- Workout blocks (acceso via workout del usuario)
create policy "blocks_select" on public.workout_blocks for select
  using (exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid()));
create policy "blocks_insert" on public.workout_blocks for insert
  with check (exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid()));
create policy "blocks_delete" on public.workout_blocks for delete
  using (exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid()));

-- ============================================================
-- FUNCIÓN: auto-crear perfil cuando un usuario se registra
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ÍNDICES para performance
-- ============================================================
create index workouts_user_date on public.workouts(user_id, workout_date desc);
create index blocks_workout on public.workout_blocks(workout_id, position);
create index stations_user on public.station_records(user_id, station_key);
