-- Public name shown on the leaderboard (emails stay private).
alter table public.player_stats
  add column if not exists display_name text
  check (display_name is null or char_length(display_name) between 1 and 20);

-- Top players by bankroll, plus the caller's own row if they're outside the top.
-- Players can't read each other's rows (row level security), so this runs as
-- the table owner and returns only the columns that are safe to share.
-- Players who haven't finished a hand yet are left out, except the caller.
create or replace function public.get_leaderboard(limit_count integer default 10)
returns table (
  rank bigint,
  name text,
  tag text,
  bankroll numeric,
  won integer,
  lost integer,
  pushed integer,
  is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select
      rank() over (order by s.bankroll desc) as rank,
      row_number() over (order by s.bankroll desc, s.updated_at) as position,
      s.display_name as name,
      left(s.user_id::text, 4) as tag,
      s.bankroll,
      s.won,
      s.lost,
      s.pushed,
      s.user_id = (select auth.uid()) as is_me
    from public.player_stats s
    where s.won + s.lost + s.pushed > 0 or s.user_id = (select auth.uid())
  )
  select rank, name, tag, bankroll, won, lost, pushed, is_me
  from ranked
  where position <= least(greatest(limit_count, 1), 50) or is_me
  order by position;
$$;

revoke execute on function public.get_leaderboard(integer) from public, anon;
grant execute on function public.get_leaderboard(integer) to authenticated;
