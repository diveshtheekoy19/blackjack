import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { money } from '../supabase/functions/_shared/game.ts'
import { loadLeaderboard, saveDisplayName, type LeaderboardRow } from './supabase.ts'

const displayName = (r: LeaderboardRow) => r.name ?? `Player ${r.tag}`

/** Top players by bankroll, with a field to set the name shown on the board. */
export default function Leaderboard({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [nameMsg, setNameMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await loadLeaderboard()
      setRows(r)
      setError('')
      return r
    } catch {
      setError("Couldn't load the leaderboard. Check your connection.")
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadLeaderboard()
      .then(r => {
        if (cancelled) return
        setRows(r)
        setName(r.find(x => x.is_me)?.name ?? '')
      })
      .catch(() => !cancelled && setError("Couldn't load the leaderboard. Check your connection."))
    return () => {
      cancelled = true
    }
  }, [])

  const submitName = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const ok = await saveDisplayName(userId, name.trim() || null)
    setNameMsg(ok ? 'Saved!' : "Couldn't save your name. Try again.")
    if (ok) await refresh()
    setBusy(false)
  }

  const top = rows?.filter((_, i) => i < 10) ?? []
  const meBelow = rows && rows.length > 10 ? rows[rows.length - 1] : null

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="board"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="board-head">
          <h2 id="board-title">Leaderboard</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close leaderboard">
            ✕
          </button>
        </div>

        {error && <p className="auth-msg error">{error}</p>}
        {!rows && !error && <p className="hint">Loading…</p>}
        {rows && (
          <table className="board-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Bankroll</th>
                <th>W · L · P</th>
              </tr>
            </thead>
            <tbody>
              {[...top, ...(meBelow ? [meBelow] : [])].map((r, i) => (
                <tr key={i} className={`${r.is_me ? 'me' : ''} ${r === meBelow ? 'gap' : ''}`}>
                  <td>{r.rank}</td>
                  <td className="who">
                    {displayName(r)}
                    {r.is_me && ' (you)'}
                  </td>
                  <td>{money(r.bankroll)}</td>
                  <td>
                    {r.won} · {r.lost} · {r.pushed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint small">Players show up once they've finished a hand.</p>

        <form className="name-form" onSubmit={submitName}>
          <label>
            Your name on the board
            <input
              value={name}
              maxLength={20}
              placeholder="Leave empty to stay anonymous"
              onChange={e => {
                setName(e.target.value)
                setNameMsg('')
              }}
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            Save
          </button>
        </form>
        {nameMsg && <p className={`auth-msg ${nameMsg === 'Saved!' ? '' : 'error'}`}>{nameMsg}</p>}
      </div>
    </div>
  )
}
