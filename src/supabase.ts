import { FunctionsHttpError, createClient } from '@supabase/supabase-js'
import type { Action } from '../supabase/functions/_shared/table.ts'

// Both values are public: the publishable key only allows what the
// row level security rules in supabase/migrations permit.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

export const START_BANKROLL = 1000

export type SavedStats = { bankroll: number; won: number; lost: number; pushed: number }

/** Loads the player's row, creating it with a fresh bankroll on first login. */
export async function loadStats(userId: string): Promise<SavedStats> {
  const { error: insertError } = await supabase
    .from('player_stats')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (insertError) throw insertError
  const { data, error } = await supabase
    .from('player_stats')
    .select('bankroll, won, lost, pushed')
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return {
    bankroll: Number(data.bankroll),
    won: data.won,
    lost: data.lost,
    pushed: data.pushed,
  }
}

/**
 * Sends a move to the `table` Edge Function, which runs the game.
 * Returns an error message to show, or null if the move went through.
 */
export async function tableAction(table: number, action: Action): Promise<string | null> {
  const { error } = await supabase.functions.invoke('table', { body: { table, action } })
  if (!error) return null
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (body.error) return body.error
    } catch {
      // fall through to the generic message
    }
  }
  return "Couldn't reach the table. Check your connection."
}

/** Out of chips: back to the starting bankroll with a clean record. */
export async function resetBankroll(): Promise<boolean> {
  const { error } = await supabase.rpc('reset_bankroll')
  return !error
}

export type LeaderboardRow = {
  rank: number
  /** Null until the player picks a name. */
  name: string | null
  /** First characters of the player's id, for an anonymous label. */
  tag: string
  bankroll: number
  won: number
  lost: number
  pushed: number
  is_me: boolean
}

/** Top 10 players, followed by the caller's own row if they're outside it. */
export async function loadLeaderboard(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_leaderboard', { limit_count: 10 })
  if (error) throw error
  return (data as LeaderboardRow[]).map(r => ({ ...r, rank: Number(r.rank), bankroll: Number(r.bankroll) }))
}

/** Sets the name shown on the leaderboard; null makes the player anonymous. */
export async function saveDisplayName(userId: string, name: string | null): Promise<boolean> {
  const { error } = await supabase.from('player_stats').update({ display_name: name }).eq('user_id', userId)
  return !error
}
