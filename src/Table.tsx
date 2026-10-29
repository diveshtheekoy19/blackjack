import { useCallback, useEffect, useState } from 'react'
import { MAX_HANDS, handValue, isPair, money } from '../supabase/functions/_shared/game.ts'
import {
  MIN_BET,
  SEATS,
  seatOf,
  type Action,
  type PublicTable,
  type Seat,
} from '../supabase/functions/_shared/table.ts'
import { FaceDownCard, PlayingCard, TotalBadge } from './Cards.tsx'
import { START_BANKROLL, resetBankroll, tableAction } from './supabase.ts'
import { localDeadline, type LiveTable } from './useTables.ts'

const CHIPS = [5, 25, 100, 500]

const SHORT = { blackjack: 'Blackjack', win: 'Win', push: 'Push', lose: 'Lose' }

const signedMoney = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n))

/** Re-renders every `ms` so countdowns tick. */
function useNow(ms: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/**
 * The server reveals the dealer's whole hand at once; show the cards one at
 * a time so players can follow along. Returns how many cards to show.
 */
function useDealerReveal(s: PublicTable) {
  const [reveal, setReveal] = useState({ round: -1, count: 0 })
  const target = s.dealer.length
  const shown = s.holeHidden ? target : Math.min(reveal.round === s.round ? reveal.count : 2, target)
  useEffect(() => {
    if (s.holeHidden || shown >= target) return
    const t = setTimeout(() => setReveal({ round: s.round, count: shown + 1 }), 650)
    return () => clearTimeout(t)
  }, [s.holeHidden, s.round, shown, target])
  return { shown, revealing: !s.holeHidden && shown < target }
}

type Props = {
  table: LiveTable
  userId: string
  bankroll: number
  /** Keyboard shortcuts are off while something (the leaderboard) is on top. */
  paused: boolean
  onLeave: () => void
}

export default function Table({ table, userId, bankroll, paused, onLeave }: Props) {
  const s = table.state!
  const now = useNow(250)
  const { shown, revealing } = useDealerReveal(s)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [chips, setChips] = useState(0)

  const mine = seatOf(s, userId)
  const me = mine >= 0 ? s.seats[mine]! : null
  const deadline = localDeadline(table)
  const secondsLeft = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000))

  const send = useCallback(
    async (action: Action) => {
      setBusy(true)
      setError('')
      const err = await tableAction(table.id, action)
      if (err) setError(err)
      setBusy(false)
      return !err
    },
    [table.id],
  )

  const inRound = !!me && me.hands.length > 0
  const myTurn = s.phase === 'playing' && s.turn?.seat === mine
  const current = myTurn ? me!.hands[s.turn!.hand] : undefined
  const canDouble = !!current && current.cards.length === 2 && bankroll >= current.wager
  const canSplit =
    !!current && isPair(current.cards) && me!.hands.length < MAX_HANDS && bankroll >= current.wager
  const canInsure = s.phase === 'insurance' && inRound && me!.insurance === null
  const insuranceCost = inRound ? me!.hands[0].wager / 2 : 0
  const betting = s.phase === 'betting' && !!me
  const betPlaced = betting && me!.bet > 0
  const bet = Math.min(chips, bankroll)
  const broke = !!me && !inRound && bankroll < MIN_BET && !betPlaced

  const placeBet = useCallback(() => {
    if (betting && !betPlaced && bet >= MIN_BET && !busy) send({ type: 'bet', amount: bet })
  }, [betting, betPlaced, bet, busy, send])

  // Keyboard shortcuts: H hit, S stand, D double, P split, I/N insurance, Enter bet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused || busy || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (myTurn) {
        if (k === 'h') send({ type: 'hit' })
        else if (k === 's') send({ type: 'stand' })
        else if (k === 'd' && canDouble) send({ type: 'double' })
        else if (k === 'p' && canSplit) send({ type: 'split' })
      } else if (canInsure) {
        if (k === 'i' && bankroll >= insuranceCost) send({ type: 'insurance', take: true })
        else if (k === 'n') send({ type: 'insurance', take: false })
      } else if (k === 'enter' && betting) {
        e.preventDefault()
        placeBet()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paused, busy, myTurn, canDouble, canSplit, canInsure, bankroll, insuranceCost, betting, placeBet, send])

  const leave = async () => {
    if (!me || (await send({ type: 'leave' }))) onLeave()
  }

  const players = s.seats.filter(x => x !== null).length

  return (
    <>
      <div className="table-bar">
        <strong>{table.name}</strong>
        <span className="hint">
          {players} / {SEATS} players · {s.cardsLeft} cards left
        </span>
        <button className="btn ghost small" onClick={leave} disabled={busy}>
          {me ? 'Leave table' : 'Back to lobby'}
        </button>
      </div>

      <main className="table">
        <section className="hand dealer" aria-label="Dealer's hand">
          <div className="hand-label">
            Dealer {s.dealer.length > 0 && <TotalBadge cards={s.dealer.slice(0, shown)} />}
          </div>
          <div className="cards">
            {s.dealer.slice(0, shown).map(c => (
              <PlayingCard key={c.id} card={c} />
            ))}
            {s.holeHidden && <FaceDownCard />}
            {s.dealer.length === 0 && <div className="card-slot" />}
          </div>
        </section>

        <div className="center" aria-live="polite">
          <Status
            s={s}
            me={me}
            myTurn={myTurn}
            secondsLeft={secondsLeft}
            revealing={revealing}
          />
        </div>

        <section className={`seats ${me ? 'seated' : ''}`} aria-label="Players">
          {s.seats.map((seat, i) =>
            seat ? (
              <SeatView
                key={i}
                seat={seat}
                s={s}
                index={i}
                isMe={i === mine}
                showResults={!revealing}
              />
            ) : (
              <div key={i} className="seat empty">
                {me ? (
                  <span className="hint">Empty seat</span>
                ) : (
                  <button className="btn small" onClick={() => send({ type: 'join', seat: i })} disabled={busy}>
                    Sit here
                  </button>
                )}
              </div>
            ),
          )}
        </section>
      </main>

      <section className="controls">
        {error && <p className="auth-msg error">{error}</p>}

        {!me && <p className="hint">Pick an empty seat to join the game.</p>}

        {broke && (
          <div className="actions">
            <p className="hint">You're out of chips.</p>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                if (!(await resetBankroll())) setError("Couldn't start over. Try again.")
              }}
            >
              Start over with {money(START_BANKROLL)}
            </button>
          </div>
        )}

        {betting && !broke && !betPlaced && (
          <>
            <div className="chips" role="group" aria-label="Add chips to bet">
              {CHIPS.map(v => (
                <button
                  key={v}
                  className={`chip chip-${v}`}
                  onClick={() => setChips(bet + v)}
                  disabled={bet + v > bankroll}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="actions">
              <div className="bet-display">
                Bet <strong>{money(bet)}</strong>
              </div>
              <button className="btn ghost" onClick={() => setChips(0)} disabled={bet === 0}>
                Clear
              </button>
              <button className="btn primary" onClick={placeBet} disabled={bet < MIN_BET || busy}>
                Place bet <kbd>Enter</kbd>
              </button>
            </div>
          </>
        )}

        {betPlaced && (
          <div className="actions">
            <p className="hint">
              Your bet: <strong>{money(me!.bet)}</strong>
            </p>
            <button className="btn ghost" onClick={() => send({ type: 'bet', amount: 0 })} disabled={busy}>
              Change bet
            </button>
          </div>
        )}

        {canInsure && (
          <div className="actions">
            <button
              className="btn primary"
              onClick={() => send({ type: 'insurance', take: true })}
              disabled={busy || bankroll < insuranceCost}
            >
              Take insurance ({money(insuranceCost)}) <kbd>I</kbd>
            </button>
            <button className="btn" onClick={() => send({ type: 'insurance', take: false })} disabled={busy}>
              No thanks <kbd>N</kbd>
            </button>
          </div>
        )}

        {myTurn && (
          <div className="actions">
            <button className="btn primary" onClick={() => send({ type: 'hit' })} disabled={busy}>
              Hit <kbd>H</kbd>
            </button>
            <button className="btn primary" onClick={() => send({ type: 'stand' })} disabled={busy}>
              Stand <kbd>S</kbd>
            </button>
            <button className="btn" onClick={() => send({ type: 'double' })} disabled={busy || !canDouble}>
              Double <kbd>D</kbd>
            </button>
            <button className="btn" onClick={() => send({ type: 'split' })} disabled={busy || !canSplit}>
              Split <kbd>P</kbd>
            </button>
          </div>
        )}
      </section>
    </>
  )
}

function Status({
  s,
  me,
  myTurn,
  secondsLeft,
  revealing,
}: {
  s: PublicTable
  me: Seat | null
  myTurn: boolean
  secondsLeft: number | null
  revealing: boolean
}) {
  const timer = secondsLeft !== null ? ` · ${secondsLeft}s` : ''
  const inRound = !!me && me.hands.length > 0

  if (s.phase === 'betting') {
    const anyBet = s.seats.some(x => x && x.bet > 0)
    return (
      <p className="hint">
        {s.shuffled && s.round > 0 ? 'Shoe reshuffled. ' : ''}
        {anyBet ? `Dealing soon${timer}` : 'Place your bets'}
      </p>
    )
  }
  if (s.phase === 'insurance') {
    return (
      <p className="hint">
        Dealer shows an ace. {inRound && me!.insurance === null ? 'Take insurance?' : 'Waiting for players'}
        {timer}
      </p>
    )
  }
  if (s.phase === 'playing') {
    const turnName = s.turn ? s.seats[s.turn.seat]?.name : ''
    return (
      <p className={`hint ${myTurn ? 'your-turn' : ''}`}>
        {myTurn ? 'Your turn' : `${turnName}'s turn`}
        {timer}
      </p>
    )
  }
  // done
  if (revealing) return <p className="hint">Dealer plays…</p>
  if (inRound && me!.results) {
    const net = me!.results.reduce((a, r) => a + r.net, 0) + (me!.insuranceNet ?? 0)
    return (
      <div className={`banner ${net > 0 ? 'win' : net < 0 ? 'lose' : 'push'}`}>
        <strong>{net > 0 ? 'You win!' : net < 0 ? 'Dealer wins' : 'Push'}</strong>
        <span>{signedMoney(net)}</span>
        <span className="sub">Next round{timer}</span>
      </div>
    )
  }
  return <p className="hint">Next round{timer}</p>
}

function SeatView({
  seat,
  s,
  index,
  isMe,
  showResults,
}: {
  seat: Seat
  s: PublicTable
  index: number
  isMe: boolean
  showResults: boolean
}) {
  const turnHere = s.phase === 'playing' && s.turn?.seat === index
  return (
    <div className={`seat ${isMe ? 'me' : ''} ${turnHere ? 'turn' : ''}`}>
      <div className="seat-head">
        <span className="seat-name" title={seat.name}>
          {seat.name}
          {isMe && ' (you)'}
        </span>
        <span className="seat-bank">{money(seat.bankroll)}</span>
      </div>

      {seat.hands.length === 0 ? (
        <p className="hint small">
          {seat.leaving ? 'Leaving' : s.phase === 'betting' ? (seat.bet > 0 ? `Bet ${money(seat.bet)}` : 'Betting…') : 'Sitting out'}
        </p>
      ) : (
        <div className="seat-hands">
          {seat.hands.map((h, j) => {
            const active = turnHere && s.turn?.hand === j
            const r = showResults ? seat.results?.[j] : undefined
            return (
              <div key={j} className={`seat-hand ${active ? 'active' : ''}`}>
                <div className="cards mini">
                  {h.cards.map(c => (
                    <PlayingCard key={c.id} card={c} />
                  ))}
                </div>
                <div className="hand-meta">
                  <TotalBadge cards={h.cards} />
                  {money(h.wager)}
                </div>
                {r && (
                  <span className={`tag ${r.outcome}`}>
                    {SHORT[r.outcome]} {signedMoney(r.net)}
                  </span>
                )}
                {!r && h.done && handValue(h.cards).total > 21 && <span className="tag lose">Bust</span>}
              </div>
            )
          })}
          {showResults && seat.insuranceNet !== null && (
            <span className={`tag ${seat.insuranceNet > 0 ? 'win' : 'lose'}`}>
              Insurance {signedMoney(seat.insuranceNet)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
