import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DECKS,
  MAX_HANDS,
  RESHUFFLE_AT,
  dealerShouldHit,
  handValue,
  isBlackjack,
  isPair,
  isRed,
  newShoe,
  payout,
  settle,
  type Card,
  type Outcome,
} from './game.ts'
import { START_BANKROLL, saveStats, type SavedStats } from './supabase.ts'
import './App.css'

type Phase = 'betting' | 'insurance' | 'player' | 'dealer' | 'done'

type Hand = {
  cards: Card[]
  wager: number
  /** Came from a split: a two-card 21 is not blackjack. */
  split: boolean
  /** Split aces get exactly one card each and can't be played further. */
  splitAces: boolean
}

type HandResult = { outcome: Outcome; net: number }

const CHIPS = [5, 25, 100, 500]

const money = (n: number) =>
  '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 })

const signedMoney = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n))

const MESSAGES: Record<Outcome, string> = {
  blackjack: 'Blackjack! You win 3 to 2',
  win: 'You win!',
  push: 'Push — bet returned',
  lose: 'Dealer wins',
}

const SHORT: Record<Outcome, string> = {
  blackjack: 'Blackjack',
  win: 'Win',
  push: 'Push',
  lose: 'Lose',
}

function PlayingCard({ card, hidden }: { card: Card; hidden?: boolean }) {
  if (hidden) return <div className="card card-back" aria-label="Face-down card" />
  return (
    <div
      className={`card ${isRed(card.suit) ? 'red' : ''}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className="corner top">
        {card.rank}
        <br />
        {card.suit}
      </span>
      <span className="pip">{card.suit}</span>
      <span className="corner bottom">
        {card.rank}
        <br />
        {card.suit}
      </span>
    </div>
  )
}

function TotalBadge({ cards }: { cards: Card[] }) {
  const { total, soft } = handValue(cards)
  return (
    <span className={`total ${total > 21 ? 'bust' : ''}`}>
      {soft && total < 21 ? `${total - 10} / ${total}` : total}
      {total > 21 && ' bust'}
    </span>
  )
}

type AppProps = {
  userId: string
  email: string
  /** The player's bankroll and record as loaded from the database. */
  saved: SavedStats
  onSignOut: () => void
}

export default function App({ userId, email, saved, onSignOut }: AppProps) {
  const shoe = useRef<Card[]>(newShoe())
  const [cardsLeft, setCardsLeft] = useState(DECKS * 52)

  const [bankroll, setBankroll] = useState(saved.bankroll)
  const [bet, setBet] = useState(0)
  const [phase, setPhase] = useState<Phase>('betting')
  const [hands, setHands] = useState<Hand[]>([])
  const [active, setActive] = useState(0)
  const [dealer, setDealer] = useState<Card[]>([])
  const [results, setResults] = useState<HandResult[] | null>(null)
  /** Insurance staked this round (0 if declined or not offered). */
  const [insurance, setInsurance] = useState(0)
  /** Insurance win/loss, once the dealer has checked for blackjack. */
  const [insuranceNet, setInsuranceNet] = useState<number | null>(null)
  const [stats, setStats] = useState({ won: saved.won, lost: saved.lost, pushed: saved.pushed })
  const [shuffled, setShuffled] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  // Save every change to the database. Saves are chained so they arrive in
  // order and an older value never overwrites a newer one.
  const saveQueue = useRef(Promise.resolve())
  useEffect(() => {
    const snapshot = { bankroll, ...stats }
    saveQueue.current = saveQueue.current.then(async () => {
      setSaveFailed(!(await saveStats(userId, snapshot)))
    })
  }, [userId, bankroll, stats])

  const draw = useCallback((): Card => {
    const card = shoe.current.pop()!
    setCardsLeft(shoe.current.length)
    return card
  }, [])

  const finish = useCallback((hs: Hand[], d: Card[], ins: number) => {
    const res = hs.map(h => {
      const outcome = settle(h.cards, d, h.split)
      return { outcome, net: payout(outcome, h.wager) - h.wager }
    })
    // Insurance pays 2 to 1 when the dealer has blackjack.
    const insReturned = ins > 0 && isBlackjack(d) ? ins * 3 : 0
    const returned = hs.reduce((sum, h, i) => sum + h.wager + res[i].net, 0) + insReturned
    setBankroll(b => b + returned)
    setInsuranceNet(ins > 0 ? insReturned - ins : null)
    setResults(res)
    setStats(s => {
      const next = { ...s }
      for (const r of res) {
        if (r.outcome === 'push') next.pushed++
        else if (r.outcome === 'lose') next.lost++
        else next.won++
      }
      return next
    })
    setPhase('done')
  }, [])

  /**
   * The hand at `idx` is finished: move to the next playable hand, dealing
   * the second card to split hands as they come up. When none are left the
   * dealer plays, unless every hand has bust.
   */
  const moveOn = useCallback(
    (hs: Hand[], idx: number) => {
      const next = [...hs]
      for (let i = idx + 1; i < next.length; i++) {
        if (next[i].cards.length === 1) {
          next[i] = { ...next[i], cards: [...next[i].cards, draw()] }
        }
        const h = next[i]
        if (h.splitAces || handValue(h.cards).total === 21) continue
        setHands(next)
        setActive(i)
        return
      }
      setHands(next)
      if (next.every(h => handValue(h.cards).total > 21)) finish(next, dealer, insurance)
      else setPhase('dealer')
    },
    [dealer, insurance, draw, finish],
  )

  /** Dealer checks for blackjack; the round ends at once if either side has one. */
  const peek = useCallback(
    (hs: Hand[], d: Card[], ins: number) => {
      if (isBlackjack(hs[0].cards) || isBlackjack(d)) finish(hs, d, ins)
      else setPhase('player')
    },
    [finish],
  )

  const deal = useCallback(() => {
    if (phase !== 'betting' || bet <= 0 || bet > bankroll) return
    if (shoe.current.length < RESHUFFLE_AT) {
      shoe.current = newShoe()
      setShuffled(true)
    } else {
      setShuffled(false)
    }
    const p1 = draw(), d1 = draw(), p2 = draw(), d2 = draw()
    const hs: Hand[] = [{ cards: [p1, p2], wager: bet, split: false, splitAces: false }]
    const d = [d1, d2]
    setBankroll(b => b - bet)
    setHands(hs)
    setActive(0)
    setDealer(d)
    setResults(null)
    setInsurance(0)
    setInsuranceNet(null)
    // Dealer shows an ace: offer insurance before checking for blackjack.
    if (d1.rank === 'A') setPhase('insurance')
    else peek(hs, d, 0)
  }, [phase, bet, bankroll, draw, peek])

  const insuranceCost = hands.length ? hands[0].wager / 2 : 0
  const canInsure = phase === 'insurance' && bankroll >= insuranceCost

  const decideInsurance = useCallback(
    (take: boolean) => {
      if (phase !== 'insurance' || (take && !canInsure)) return
      const ins = take ? insuranceCost : 0
      if (take) setBankroll(b => b - ins)
      setInsurance(ins)
      // Lost straight away if the dealer turns out not to have blackjack.
      if (ins > 0 && !isBlackjack(dealer)) setInsuranceNet(-ins)
      peek(hands, dealer, ins)
    },
    [phase, canInsure, insuranceCost, hands, dealer, peek],
  )

  const current = phase === 'player' ? hands[active] : undefined

  const hit = useCallback(() => {
    if (!current) return
    const h = { ...current, cards: [...current.cards, draw()] }
    const hs = hands.map((x, i) => (i === active ? h : x))
    if (handValue(h.cards).total >= 21) moveOn(hs, active)
    else setHands(hs)
  }, [current, hands, active, draw, moveOn])

  const stand = useCallback(() => {
    if (current) moveOn(hands, active)
  }, [current, hands, active, moveOn])

  const canDouble = !!current && current.cards.length === 2 && bankroll >= current.wager

  const double = useCallback(() => {
    if (!current || !canDouble) return
    const h = { ...current, wager: current.wager * 2, cards: [...current.cards, draw()] }
    setBankroll(b => b - current.wager)
    moveOn(hands.map((x, i) => (i === active ? h : x)), active)
  }, [current, canDouble, hands, active, draw, moveOn])

  const canSplit =
    !!current &&
    isPair(current.cards) &&
    hands.length < MAX_HANDS &&
    bankroll >= current.wager

  const split = useCallback(() => {
    if (!current || !canSplit) return
    const [c1, c2] = current.cards
    const aces = c1.rank === 'A'
    const first: Hand = { cards: [c1, draw()], wager: current.wager, split: true, splitAces: aces }
    const second: Hand = { cards: [c2], wager: current.wager, split: true, splitAces: aces }
    const hs = [...hands.slice(0, active), first, second, ...hands.slice(active + 1)]
    setBankroll(b => b - current.wager)
    if (aces || handValue(first.cards).total === 21) moveOn(hs, active)
    else setHands(hs)
  }, [current, canSplit, hands, active, draw, moveOn])

  const nextHand = useCallback(() => {
    setPhase('betting')
    setHands([])
    setDealer([])
    setResults(null)
    setInsurance(0)
    setInsuranceNet(null)
    // Keep the same bet ready if it's still affordable.
    setBet(b => (b <= bankroll ? b : 0))
  }, [bankroll])

  // Dealer draws one card at a time so the play is easy to follow.
  useEffect(() => {
    if (phase !== 'dealer') return
    const t = setTimeout(() => {
      if (dealerShouldHit(dealer)) setDealer([...dealer, draw()])
      else finish(hands, dealer, insurance)
    }, 650)
    return () => clearTimeout(t)
  }, [phase, dealer, hands, insurance, draw, finish])

  // Keyboard shortcuts: H hit, S stand, D double, P split, I/N insurance,
  // Enter/Space deal or next hand.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (phase === 'player') {
        if (k === 'h') hit()
        else if (k === 's') stand()
        else if (k === 'd') double()
        else if (k === 'p') split()
      } else if (phase === 'insurance') {
        if (k === 'i') decideInsurance(true)
        else if (k === 'n') decideInsurance(false)
      } else if (k === 'enter' || k === ' ') {
        if (phase === 'betting') deal()
        else if (phase === 'done') nextHand()
        else return
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, hit, stand, double, split, decideInsurance, deal, nextHand])

  const addChip = (value: number) => {
    if (phase === 'betting') setBet(b => Math.min(b + value, bankroll))
  }

  const resetBankroll = () => {
    setBankroll(START_BANKROLL)
    setBet(0)
    setStats({ won: 0, lost: 0, pushed: 0 })
  }

  const holeHidden = phase === 'player' || phase === 'insurance'
  const dealerShown = holeHidden ? dealer.slice(0, 1) : dealer
  const broke = phase === 'betting' && bankroll < CHIPS[0] && bet === 0
  const totalWager = hands.reduce((sum, h) => sum + h.wager, 0)
  const handsNet = results?.reduce((sum, r) => sum + r.net, 0) ?? 0
  const totalNet = handsNet + (insuranceNet ?? 0)
  const multi = hands.length > 1
  const insuranceLine =
    insuranceNet === null
      ? null
      : insuranceNet > 0
        ? `Insurance pays ${money(insuranceNet)}`
        : `Insurance lost ${money(-insuranceNet)}`

  return (
    <div className="app">
      <header className="topbar">
        <h1>Blackjack</h1>
        <div className="account">
          <span className="email" title={email}>{email}</span>
          <button className="link" onClick={onSignOut}>
            Log out
          </button>
        </div>
        <div className="bank">
          <span className="label">Bankroll</span>
          <span className="value">{money(bankroll)}</span>
        </div>
      </header>

      <main className="table">
        <section className="hand dealer" aria-label="Dealer's hand">
          <div className="hand-label">
            Dealer {dealer.length > 0 && <TotalBadge cards={dealerShown} />}
          </div>
          <div className="cards">
            {dealer.map((c, i) => (
              <PlayingCard key={c.id} card={c} hidden={holeHidden && i === 1} />
            ))}
            {dealer.length === 0 && <div className="card-slot" />}
          </div>
        </section>

        <div className="center" aria-live="polite">
          {results ? (
            multi ? (
              <div className={`banner ${totalNet > 0 ? 'win' : totalNet < 0 ? 'lose' : 'push'}`}>
                <strong>
                  {totalNet > 0 ? 'You come out ahead' : totalNet < 0 ? 'Dealer comes out ahead' : 'Even overall'}
                </strong>
                {insuranceLine && <span className="sub">{insuranceLine}</span>}
                <span>{signedMoney(totalNet)}</span>
              </div>
            ) : (
              <div className={`banner ${results[0].outcome}`}>
                <strong>{MESSAGES[results[0].outcome]}</strong>
                {insuranceLine && <span className="sub">{insuranceLine}</span>}
                <span>
                  {insuranceLine ? 'Overall ' : ''}
                  {signedMoney(totalNet)}
                </span>
              </div>
            )
          ) : phase === 'insurance' ? (
            <p className="hint">
              Dealer shows an ace. Insurance costs <strong>{money(insuranceCost)}</strong> and pays
              2 to 1 if the dealer has blackjack.
            </p>
          ) : phase === 'betting' ? (
            <p className="hint">
              {shuffled ? 'Shoe reshuffled. ' : ''}Place your bet, then deal
            </p>
          ) : phase === 'dealer' ? (
            <p className="hint">Dealer plays…</p>
          ) : (
            <p className="hint">
              {insurance > 0 && phase === 'player' ? 'No dealer blackjack, insurance lost · ' : ''}
              {multi ? `Playing hand ${active + 1} of ${hands.length} · ` : ''}
              Bet <strong>{money(totalWager)}</strong>
            </p>
          )}
        </div>

        <section className={`player-hands ${hands.length > 2 ? 'compact' : ''}`} aria-label="Your hands">
          {hands.length === 0 && (
            <div className="hand">
              <div className="cards">
                <div className="card-slot" />
              </div>
              <div className="hand-label">You</div>
            </div>
          )}
          {hands.map((h, i) => {
            const isActive = phase === 'player' && i === active
            const r = results?.[i]
            return (
              <div
                key={i}
                className={`hand ${multi ? 'boxed' : ''} ${isActive && multi ? 'active' : ''}`}
                aria-current={isActive && multi ? 'true' : undefined}
              >
                <div className="cards">
                  {h.cards.map(c => (
                    <PlayingCard key={c.id} card={c} />
                  ))}
                </div>
                <div className="hand-label">
                  {multi ? `Hand ${i + 1}` : 'You'} <TotalBadge cards={h.cards} />
                </div>
                {multi && (
                  <div className="hand-meta">
                    {money(h.wager)}
                    {r && <span className={`tag ${r.outcome}`}>{SHORT[r.outcome]} {signedMoney(r.net)}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      </main>

      <section className="controls">
        {phase === 'betting' && !broke && (
          <>
            <div className="chips" role="group" aria-label="Add chips to bet">
              {CHIPS.map(v => (
                <button
                  key={v}
                  className={`chip chip-${v}`}
                  onClick={() => addChip(v)}
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
              <button className="btn ghost" onClick={() => setBet(0)} disabled={bet === 0}>
                Clear
              </button>
              <button className="btn primary" onClick={deal} disabled={bet === 0}>
                Deal
              </button>
            </div>
          </>
        )}

        {broke && (
          <div className="actions">
            <p className="hint">You're out of chips.</p>
            <button className="btn primary" onClick={resetBankroll}>
              Start over with {money(START_BANKROLL)}
            </button>
          </div>
        )}

        {phase === 'insurance' && (
          <div className="actions">
            <button className="btn primary" onClick={() => decideInsurance(true)} disabled={!canInsure}>
              Take insurance <kbd>I</kbd>
            </button>
            <button className="btn" onClick={() => decideInsurance(false)}>
              No thanks <kbd>N</kbd>
            </button>
          </div>
        )}

        {phase === 'player' && (
          <div className="actions">
            <button className="btn primary" onClick={hit}>
              Hit <kbd>H</kbd>
            </button>
            <button className="btn primary" onClick={stand}>
              Stand <kbd>S</kbd>
            </button>
            <button className="btn" onClick={double} disabled={!canDouble}>
              Double <kbd>D</kbd>
            </button>
            <button className="btn" onClick={split} disabled={!canSplit}>
              Split <kbd>P</kbd>
            </button>
          </div>
        )}

        {phase === 'dealer' && (
          <div className="actions">
            <button className="btn" disabled>
              Dealer's turn
            </button>
          </div>
        )}

        {phase === 'done' && (
          <div className="actions">
            <button className="btn primary" onClick={nextHand}>
              Next hand <kbd>Enter</kbd>
            </button>
          </div>
        )}
      </section>

      <footer className="footer">
        <span>Blackjack pays 3 to 2 · Dealer stands on all 17s · Insurance pays 2 to 1 · Split up to 4 hands · 6 decks</span>
        <span>
          {saveFailed && <span className="save-error">Not saved, check your connection · </span>}
          W {stats.won} · L {stats.lost} · P {stats.pushed} · {cardsLeft} cards left
        </span>
      </footer>
    </div>
  )
}
