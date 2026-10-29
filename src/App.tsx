import { useEffect, useState } from 'react'
import { money } from '../supabase/functions/_shared/game.ts'
import Leaderboard from './Leaderboard.tsx'
import Lobby from './Lobby.tsx'
import Table from './Table.tsx'
import { supabase, type SavedStats } from './supabase.ts'
import { useTables, useTicker } from './useTables.ts'
import './App.css'

type AppProps = {
  userId: string
  email: string
  /** The player's bankroll and record as loaded from the database. */
  saved: SavedStats
  onSignOut: () => void
}

/** The player's bankroll and record, kept live as the server settles hands. */
function useMyStats(userId: string, saved: SavedStats) {
  const [stats, setStats] = useState(saved)
  useEffect(() => {
    const channel = supabase
      .channel(`player_stats:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'player_stats', filter: `user_id=eq.${userId}` },
        payload => {
          const r = payload.new as Record<string, unknown>
          setStats({
            bankroll: Number(r.bankroll),
            won: Number(r.won),
            lost: Number(r.lost),
            pushed: Number(r.pushed),
          })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])
  return stats
}

export default function App({ userId, email, saved, onSignOut }: AppProps) {
  const stats = useMyStats(userId, saved)
  const { tables, error } = useTables()
  useTicker(tables)
  const [openId, setOpenId] = useState<number | null>(null)
  const [showBoard, setShowBoard] = useState(false)

  const open = tables?.find(t => t.id === openId && t.state)

  // L opens the leaderboard, Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (showBoard && k === 'escape') setShowBoard(false)
      else if (!showBoard && k === 'l') setShowBoard(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showBoard])

  return (
    <div className="app">
      <header className="topbar">
        <h1>Blackjack</h1>
        <div className="account">
          <span className="email" title={email}>{email}</span>
          <button className="link" onClick={() => setShowBoard(true)}>
            Leaderboard
          </button>
          <button className="link" onClick={onSignOut}>
            Log out
          </button>
        </div>
        <div className="bank">
          <span className="label">Bankroll</span>
          <span className="value">{money(stats.bankroll)}</span>
        </div>
      </header>

      {error ? (
        <p className="auth-msg error">{error}</p>
      ) : !tables ? (
        <p className="hint">Loading tables…</p>
      ) : open ? (
        <Table
          table={open}
          userId={userId}
          bankroll={stats.bankroll}
          paused={showBoard}
          onLeave={() => setOpenId(null)}
        />
      ) : (
        <Lobby tables={tables} userId={userId} onOpen={setOpenId} />
      )}

      <footer className="footer">
        <span className="rules">Blackjack pays 3 to 2 · Dealer stands on all 17s · Insurance pays 2 to 1 · Split up to 4 hands · 6 decks</span>
        <span>
          W {stats.won} · L {stats.lost} · P {stats.pushed}
        </span>
      </footer>

      {showBoard && <Leaderboard userId={userId} onClose={() => setShowBoard(false)} />}
    </div>
  )
}
