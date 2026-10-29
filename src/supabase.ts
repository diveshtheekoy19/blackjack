import { createClient } from '@supabase/supabase-js'

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

/** Returns false if the save didn't go through (e.g. offline). */
export async function saveStats(userId: string, stats: SavedStats): Promise<boolean> {
  const { error } = await supabase
    .from('player_stats')
    .update({ ...stats, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  return !error
}
