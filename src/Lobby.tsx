import { useState } from 'react'
import { SEATS, seatOf } from '../supabase/functions/_shared/table.ts'
import { tableAction } from './supabase.ts'
import type { LiveTable } from './useTables.ts'

const PHASE = {
  betting: 'Taking bets',
  insurance: 'Insurance',
  playing: 'Playing',
  done: 'Round over',
}

/** Pick a table: join the first free seat, or watch if it's full. */
export default function Lobby({
  tables,
  userId,
  onOpen,
}: {
  tables: LiveTable[]
  userId: string
  onOpen: (id: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const seatedAt = tables.find(t => t.state && seatOf(t.state, userId) >= 0)?.id

  const join = async (t: LiveTable) => {
    const free = t.state ? t.state.seats.findIndex(x => x === null) : 0
    setBusy(true)
    setError('')
    const err = await tableAction(t.id, { type: 'join', seat: free })
    setBusy(false)
    if (err) setError(err)
    else onOpen(t.id)
  }

  return (
    <main className="lobby">
      <h2>Choose a table</h2>
      <p className="hint">
        Up to {SEATS} players per table, all playing against the same dealer.
      </p>
      {error && <p className="auth-msg error">{error}</p>}
      <div className="lobby-tables">
        {tables.map(t => {
          const seats = t.state?.seats ?? []
          const players = seats.filter(x => x !== null)
          const full = players.length >= SEATS
          const mine = t.id === seatedAt
          return (
            <section key={t.id} className={`lobby-table ${mine ? 'me' : ''}`}>
              <div className="lobby-head">
                <strong>{t.name}</strong>
                <span className="hint small">
                  {players.length === 0 ? 'Empty' : PHASE[t.state!.phase]}
                </span>
              </div>
              <div className="lobby-seats" aria-label={`${players.length} of ${SEATS} seats taken`}>
                {Array.from({ length: SEATS }, (_, i) => (
                  <span key={i} className={`dot ${seats[i] ? 'taken' : ''}`} />
                ))}
                <span className="hint small">
                  {players.length} / {SEATS}
                </span>
              </div>
              <p className="lobby-names hint small">
                {players.length ? players.map(p => p.name).join(', ') : 'No one here yet'}
              </p>
              {mine ? (
                <button className="btn primary" onClick={() => onOpen(t.id)}>
                  Back to your seat
                </button>
              ) : (
                <div className="actions">
                  <button
                    className="btn primary"
                    onClick={() => join(t)}
                    disabled={busy || full || seatedAt !== undefined}
                  >
                    {full ? 'Full' : 'Join'}
                  </button>
                  <button className="btn ghost" onClick={() => onOpen(t.id)} disabled={!t.state}>
                    Watch
                  </button>
                </div>
              )}
            </section>
          )
        })}
      </div>
      {seatedAt !== undefined && (
        <p className="hint small">You can sit at one table at a time. Leave your table to join another.</p>
      )}
    </main>
  )
}
