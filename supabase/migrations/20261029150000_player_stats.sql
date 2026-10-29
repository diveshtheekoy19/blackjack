-- One row per logged-in player: their bankroll and W/L/P record.
create table if not exists public.player_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bankroll numeric not null default 1000 check (bankroll >= 0),
  won integer not null default 0 check (won >= 0),
  lost integer not null default 0 check (lost >= 0),
  pushed integer not null default 0 check (pushed >= 0),
  updated_at timestamptz not null default now()
);

-- Row Level Security: each player can only see and change their own row.
alter table public.player_stats enable row level security;

create policy "Players read own stats"
  on public.player_stats for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Players insert own stats"
  on public.player_stats for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Players update own stats"
  on public.player_stats for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
