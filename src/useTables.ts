import { useEffect, useState } from 'react'
import type { PublicTable } from '../supabase/functions/_shared/table.ts'
import { supabase, tableAction } from './supabase.ts'

export type LiveTable = {
  id: number
  name: string
  /** Null until someone first sits down. */
  state: PublicTable | null
  /** Local time the state arrived, to turn server deadlines into local ones. */
  receivedAt: number
}

/** When a server deadline falls, in this browser's clock. */
export function localDeadline(t: LiveTable): number | null {
  const s = t.state
  return s?.deadline == null ? null : s.deadline - s.serverNow + t.receivedAt
}

/** All tables, kept up to date live. */
export function useTables(): { tables: LiveTable[] | null; error: string } {
  const [tables, setTables] = useState<LiveTable[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    // Keep whichever copy of a table is newest: a live update can arrive
    // before or after the first load.
    const merge = (rows: { id: number; name: string; state: PublicTable | null }[]) =>
      setTables(prev => {
        const byId = new Map((prev ?? []).map(t => [t.id, t]))
        for (const r of rows) {
          const old = byId.get(r.id)
          if (old?.state && r.state && old.state.version >= r.state.version) continue
          byId.set(r.id, { ...r, receivedAt: Date.now() })
        }
        return [...byId.values()].sort((a, b) => a.id - b.id)
      })

    const channel = supabase
      .channel('game_tables')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_tables' }, payload =>
        merge([payload.new as { id: number; name: string; state: PublicTable | null }]),
      )
      .subscribe()

    supabase
      .from('game_tables')
      .select('id, name, state')
      .order('id')
      .then(({ data, error }) => {
        if (error) setError("Couldn't load the tables. Check your connection and reload.")
        else merge(data)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return { tables, error }
}

/**
 * Nudges tables past their deadlines (betting closing, a turn timing out,
 * the next round starting). Every open browser does this; the server ignores
 * nudges that come too early or twice.
 */
export function useTicker(tables: LiveTable[] | null) {
  const due = (tables ?? [])
    .map(t => ({ id: t.id, at: localDeadline(t), version: t.state?.version }))
    .filter(t => t.at !== null)
  const key = due.map(t => `${t.id}:${t.version}:${t.at}`).join(',')

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const t of due) {
      const tick = () => {
        tableAction(t.id, { type: 'tick' })
        // Keep nudging until the table moves on (which re-runs this effect).
        timers.push(setTimeout(tick, 3000))
      }
      timers.push(setTimeout(tick, Math.max(0, t.at! - Date.now()) + 300))
    }
    return () => timers.forEach(clearTimeout)
    // `key` captures everything in `due` that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
