-- Shared live tables. The `table` Edge Function runs the game; players only
-- read the public state and send moves to the function.

-- What players see, pushed to them live through Realtime.
create table if not exists public.game_tables (
  id smallint primary key,
  name text not null,
  state jsonb,
  updated_at timestamptz not null default now()
);

alter table public.game_tables enable row level security;

create policy "Players see the tables"
  on public.game_tables for select
  to authenticated
  using (true);

revoke insert, update, delete on public.game_tables from anon, authenticated;

-- The full state, including the shoe and the dealer's hole card. This schema
-- isn't exposed through the API, so only the Edge Function can reach it.
create schema if not exists game_private;
revoke all on schema game_private from public, anon, authenticated;

create table if not exists game_private.table_state (
  id smallint primary key references public.game_tables (id),
  state jsonb,
  version bigint not null default 0
);

insert into public.game_tables (id, name) values
  (1, 'Table 1'),
  (2, 'Table 2'),
  (3, 'Table 3')
on conflict (id) do nothing;

insert into game_private.table_state (id)
select id from public.game_tables
on conflict (id) do nothing;

-- Only the server moves money now: players may create their own row (with
-- the default bankroll) and change their leaderboard name, nothing else.
revoke insert, update on public.player_stats from anon, authenticated;
grant insert (user_id) on public.player_stats to authenticated;
grant update (display_name) on public.player_stats to authenticated;

-- Out of chips: start over with $1,000 and a clean record.
create or replace function public.reset_bankroll()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.player_stats
    set bankroll = 1000, won = 0, lost = 0, pushed = 0, updated_at = now()
    where user_id = (select auth.uid()) and bankroll < 5;
  if not found then
    raise exception 'You can only start over when you are out of chips';
  end if;
end;
$$;

revoke execute on function public.reset_bankroll() from public, anon;
grant execute on function public.reset_bankroll() to authenticated;

-- Live updates for the tables and for each player's own bankroll row
-- (row level security still decides who receives which rows).
alter publication supabase_realtime add table public.game_tables;
alter publication supabase_realtime add table public.player_stats;
