// Multiplayer table rules, shared by the `table` Edge Function (which runs
// them) and the browser (which only uses the types and constants).
// Everything here is pure: the caller passes in the time and the players'
// bankrolls and gets back the new state plus the money/stat changes to save.
import {
  MAX_HANDS,
  RESHUFFLE_AT,
  dealerShouldHit,
  handValue,
  isBlackjack,
  isPair,
  newShoe,
  payout,
  settle,
  type Card,
  type Outcome,
} from './game.ts'

export const SEATS = 5
export const MIN_BET = 5
/** Betting closes this long after the first bet, or once everyone has bet. */
export const BET_MS = 15_000
export const INSURANCE_MS = 15_000
/** A player who doesn't act in time stands. */
export const TURN_MS = 20_000
/** How long results stay up before the next round's betting opens. */
export const RESULT_MS = 8_000
/** A seated player who sits out this many dealt rounds in a row loses the seat. */
export const MAX_IDLE_ROUNDS = 3

export type Hand = {
  cards: Card[]
  wager: number
  /** Came from a split: a two-card 21 is not blackjack. */
  split: boolean
  /** Split aces get exactly one card each and can't be played further. */
  splitAces: boolean
  done: boolean
}

export type HandResult = { outcome: Outcome; net: number }

export type Seat = {
  userId: string
  name: string
  /** Copy of the player's bankroll, for display. The database row is the truth. */
  bankroll: number
  /** Bet placed for the coming round (betting phase only). */
  bet: number
  /** Hands this round; empty means sitting this round out. */
  hands: Hand[]
  /** Insurance staked: null = not decided yet, 0 = declined. */
  insurance: number | null
  results: HandResult[] | null
  insuranceNet: number | null
  /** Dealt rounds in a row this player didn't bet on. */
  idle: number
  /** Left mid-round: hands are stood and the seat frees up after the round. */
  leaving: boolean
}

export type Phase = 'betting' | 'insurance' | 'playing' | 'done'

export type TableState = {
  phase: Phase
  seats: (Seat | null)[]
  shoe: Card[]
  dealer: Card[]
  /** Whose turn it is during 'playing'. */
  turn: { seat: number; hand: number } | null
  /** When the current phase or turn times out (ms since epoch). */
  deadline: number | null
  round: number
  /** The shoe was reshuffled before this round. */
  shuffled: boolean
}

/** What players are allowed to see: no shoe, and no hole card until the dealer plays. */
export type PublicTable = Omit<TableState, 'shoe'> & {
  cardsLeft: number
  holeHidden: boolean
  serverNow: number
  version: number
}

export type Action =
  | { type: 'join'; seat: number }
  | { type: 'leave' }
  | { type: 'bet'; amount: number }
  | { type: 'insurance'; take: boolean }
  | { type: 'hit' }
  | { type: 'stand' }
  | { type: 'double' }
  | { type: 'split' }
  | { type: 'tick' }

export type PlayerChange = { bankroll: number; won: number; lost: number; pushed: number }

export type Context = {
  now: number
  /** Current bankroll of every player involved; updated as money moves. */
  bankroll: Record<string, number>
  /** Name to show for a player joining. */
  name: string
  /** Filled in by the rules: what to add to each player's database row. */
  changes: Record<string, PlayerChange>
}

/** A move that isn't allowed; the message is shown to the player. */
export class ActionError extends Error {}

export function newTable(): TableState {
  return {
    phase: 'betting',
    seats: Array(SEATS).fill(null),
    shoe: newShoe(),
    dealer: [],
    turn: null,
    deadline: null,
    round: 0,
    shuffled: false,
  }
}

export function toPublic(s: TableState, version: number, now: number): PublicTable {
  const { shoe, ...rest } = s
  const holeHidden = s.phase === 'insurance' || s.phase === 'playing'
  return {
    ...rest,
    dealer: holeHidden ? s.dealer.slice(0, 1) : s.dealer,
    cardsLeft: shoe.length,
    holeHidden,
    serverNow: now,
    version,
  }
}

export function seatOf(s: { seats: (Seat | null)[] }, userId: string): number {
  return s.seats.findIndex(x => x?.userId === userId)
}

/**
 * Applies one player's action. Returns the new state, or null if nothing
 * changed (e.g. a tick before the deadline). Throws ActionError for moves
 * that aren't allowed. Never mutates `state`.
 */
export function applyAction(
  state: TableState,
  userId: string,
  action: Action,
  ctx: Context,
): TableState | null {
  const s: TableState = structuredClone(state)
  const g = new Round(s, ctx)
  const changed = g.apply(userId, action)
  if (!changed) return null
  for (const seat of s.seats) {
    if (seat && seat.userId in ctx.bankroll) seat.bankroll = ctx.bankroll[seat.userId]
  }
  return s
}

class Round {
  s: TableState
  ctx: Context

  constructor(s: TableState, ctx: Context) {
    this.s = s
    this.ctx = ctx
  }

  apply(userId: string, a: Action): boolean {
    const s = this.s
    if (a.type === 'tick') return this.tick()
    if (a.type === 'join') {
      this.join(userId, a.seat)
      return true
    }
    const idx = seatOf(s, userId)
    if (idx < 0) throw new ActionError("You're not sitting at this table.")
    const seat = s.seats[idx]!
    switch (a.type) {
      case 'leave':
        this.leave(idx)
        return true
      case 'bet':
        this.bet(seat, a.amount)
        return true
      case 'insurance':
        this.insurance(seat, a.take)
        return true
      default:
        this.play(idx, a.type)
        return true
    }
  }

  // ---- money ----

  private change(userId: string): PlayerChange {
    return (this.ctx.changes[userId] ??= { bankroll: 0, won: 0, lost: 0, pushed: 0 })
  }

  private debit(userId: string, amount: number) {
    if ((this.ctx.bankroll[userId] ?? 0) < amount) throw new ActionError("You don't have enough chips.")
    this.ctx.bankroll[userId] -= amount
    this.change(userId).bankroll -= amount
  }

  private credit(userId: string, amount: number) {
    if (amount === 0) return
    this.ctx.bankroll[userId] = (this.ctx.bankroll[userId] ?? 0) + amount
    this.change(userId).bankroll += amount
  }

  private draw(): Card {
    const card = this.s.shoe.pop()
    if (card) return card
    // Only reachable in a freak round; a fresh shoe keeps the game going.
    this.s.shoe = newShoe()
    return this.s.shoe.pop()!
  }

  // ---- seats ----

  private join(userId: string, seatNo: number) {
    const s = this.s
    if (seatOf(s, userId) >= 0) throw new ActionError("You're already at this table.")
    if (!Number.isInteger(seatNo) || seatNo < 0 || seatNo >= SEATS) throw new ActionError('No such seat.')
    if (s.seats[seatNo]) throw new ActionError('That seat is taken.')
    s.seats[seatNo] = {
      userId,
      name: this.ctx.name,
      bankroll: this.ctx.bankroll[userId] ?? 0,
      bet: 0,
      hands: [],
      insurance: null,
      results: null,
      insuranceNet: null,
      idle: 0,
      leaving: false,
    }
  }

  private leave(idx: number) {
    const s = this.s
    const seat = s.seats[idx]!
    // Not in the hand being played (or it's over): the seat frees up at once.
    if (s.phase === 'betting' || s.phase === 'done' || seat.hands.length === 0) {
      s.seats[idx] = null
      if (s.phase === 'betting') this.dealIfAllBet()
      return
    }
    // Mid-round: their bets stay in and their hands stand as they are.
    seat.leaving = true
    for (const h of seat.hands) h.done = true
    if (s.phase === 'insurance') {
      if (seat.insurance === null) seat.insurance = 0
      this.peekIfAllDecided()
    } else if (s.turn?.seat === idx) {
      this.advance()
    }
  }

  // ---- betting ----

  private bet(seat: Seat, amount: number) {
    const s = this.s
    if (s.phase !== 'betting') throw new ActionError('Betting is closed until the next round.')
    if (!Number.isInteger(amount) || amount < 0) throw new ActionError('Invalid bet.')
    if (amount > 0 && amount < MIN_BET) throw new ActionError(`The minimum bet is $${MIN_BET}.`)
    if (amount > (this.ctx.bankroll[seat.userId] ?? 0)) throw new ActionError("You don't have enough chips.")
    seat.bet = amount
    if (amount > 0 && s.deadline === null) s.deadline = this.ctx.now + BET_MS
    if (!s.seats.some(x => x && x.bet > 0)) s.deadline = null
    this.dealIfAllBet()
  }

  private dealIfAllBet() {
    const seated = this.s.seats.filter(x => x !== null)
    if (seated.length > 0 && seated.every(x => x.bet > 0)) this.deal()
  }

  private deal() {
    const s = this.s
    // Check every bet can still be covered before taking any money.
    for (const seat of s.seats) {
      if (seat && seat.bet > (this.ctx.bankroll[seat.userId] ?? 0)) seat.bet = 0
    }
    for (let i = 0; i < SEATS; i++) {
      const seat = s.seats[i]
      if (!seat) continue
      seat.results = null
      seat.insuranceNet = null
      seat.insurance = null
      seat.hands = []
      if (seat.bet > 0) {
        seat.idle = 0
      } else if (++seat.idle >= MAX_IDLE_ROUNDS) {
        s.seats[i] = null
      }
    }
    const players = s.seats.filter((x): x is Seat => x !== null && x.bet > 0)
    s.deadline = null
    if (players.length === 0) return

    if (s.shoe.length < RESHUFFLE_AT) {
      s.shoe = newShoe()
      s.shuffled = true
    } else {
      s.shuffled = false
    }
    for (const p of players) {
      this.debit(p.userId, p.bet)
      p.hands = [{ cards: [], wager: p.bet, split: false, splitAces: false, done: false }]
      p.bet = 0
    }
    s.dealer = []
    for (let n = 0; n < 2; n++) {
      for (const p of players) p.hands[0].cards.push(this.draw())
      s.dealer.push(this.draw())
    }
    s.round++
    s.turn = null

    // Dealer shows an ace: offer insurance before checking for blackjack.
    if (s.dealer[0].rank === 'A') {
      s.phase = 'insurance'
      s.deadline = this.ctx.now + INSURANCE_MS
    } else {
      this.peek()
    }
  }

  // ---- insurance and the dealer's blackjack check ----

  private insurance(seat: Seat, take: boolean) {
    if (this.s.phase !== 'insurance') throw new ActionError('Insurance is not on offer right now.')
    if (seat.hands.length === 0) throw new ActionError("You're not in this round.")
    if (seat.insurance !== null) throw new ActionError("You've already decided.")
    const cost = take ? seat.hands[0].wager / 2 : 0
    if (cost > 0) this.debit(seat.userId, cost)
    seat.insurance = cost
    this.peekIfAllDecided()
  }

  private peekIfAllDecided() {
    if (this.players().every(p => p.insurance !== null)) this.peek()
  }

  private peek() {
    const s = this.s
    for (const p of this.players()) {
      p.insurance ??= 0
      // Insurance is lost straight away if the dealer turns out not to have blackjack.
      if (p.insurance > 0 && !isBlackjack(s.dealer)) p.insuranceNet = -p.insurance
    }
    if (isBlackjack(s.dealer)) {
      this.finish()
      return
    }
    for (const p of this.players()) {
      if (isBlackjack(p.hands[0].cards)) p.hands[0].done = true
    }
    s.phase = 'playing'
    s.turn = { seat: -1, hand: 0 }
    this.advance()
  }

  // ---- playing ----

  private play(idx: number, move: 'hit' | 'stand' | 'double' | 'split') {
    const s = this.s
    if (s.phase !== 'playing' || s.turn?.seat !== idx) throw new ActionError("It's not your turn.")
    const seat = s.seats[idx]!
    const h = seat.hands[s.turn.hand]
    switch (move) {
      case 'hit':
        h.cards.push(this.draw())
        if (handValue(h.cards).total >= 21) this.endHand(h)
        else s.deadline = this.ctx.now + TURN_MS
        return
      case 'stand':
        this.endHand(h)
        return
      case 'double':
        if (h.cards.length !== 2) throw new ActionError('You can only double on your first two cards.')
        this.debit(seat.userId, h.wager)
        h.wager *= 2
        h.cards.push(this.draw())
        this.endHand(h)
        return
      case 'split': {
        if (!isPair(h.cards)) throw new ActionError('You can only split a pair.')
        if (seat.hands.length >= MAX_HANDS) throw new ActionError(`You can split into at most ${MAX_HANDS} hands.`)
        this.debit(seat.userId, h.wager)
        const [c1, c2] = h.cards
        const aces = c1.rank === 'A'
        const first: Hand = { cards: [c1, this.draw()], wager: h.wager, split: true, splitAces: aces, done: false }
        const second: Hand = { cards: [c2], wager: h.wager, split: true, splitAces: aces, done: false }
        seat.hands.splice(s.turn.hand, 1, first, second)
        if (aces || handValue(first.cards).total === 21) this.endHand(first)
        else s.deadline = this.ctx.now + TURN_MS
        return
      }
    }
  }

  private endHand(h: Hand) {
    h.done = true
    this.advance()
  }

  /**
   * Moves the turn to the next hand that still needs playing, dealing the
   * second card to split hands as they come up. When there are none left
   * the dealer plays and the round is settled.
   */
  private advance() {
    const s = this.s
    const from = s.turn ?? { seat: -1, hand: 0 }
    for (let i = Math.max(from.seat, 0); i < SEATS; i++) {
      const seat = s.seats[i]
      if (!seat) continue
      for (let j = i === from.seat ? from.hand + 1 : 0; j < seat.hands.length; j++) {
        const h = seat.hands[j]
        if (h.cards.length === 1) h.cards.push(this.draw())
        if (h.splitAces || handValue(h.cards).total >= 21) h.done = true
        if (h.done) continue
        s.turn = { seat: i, hand: j }
        s.deadline = this.ctx.now + TURN_MS
        return
      }
    }
    this.dealerPlays()
  }

  private dealerPlays() {
    const s = this.s
    s.turn = null
    // The dealer only draws if some hand still depends on the dealer's total.
    const live = this.players().some(p =>
      p.hands.some(h => handValue(h.cards).total <= 21 && !(isBlackjack(h.cards) && !h.split)),
    )
    if (live) while (dealerShouldHit(s.dealer)) s.dealer.push(this.draw())
    this.finish()
  }

  private finish() {
    const s = this.s
    const dealerBJ = isBlackjack(s.dealer)
    for (const p of this.players()) {
      p.results = p.hands.map(h => {
        const outcome = settle(h.cards, s.dealer, h.split)
        return { outcome, net: payout(outcome, h.wager) - h.wager }
      })
      this.credit(
        p.userId,
        p.hands.reduce((sum, h, i) => sum + h.wager + p.results![i].net, 0),
      )
      const c = this.change(p.userId)
      for (const r of p.results) {
        if (r.outcome === 'push') c.pushed++
        else if (r.outcome === 'lose') c.lost++
        else c.won++
      }
      // Insurance pays 2 to 1 when the dealer has blackjack.
      const ins = p.insurance ?? 0
      if (ins > 0 && dealerBJ) {
        this.credit(p.userId, ins * 3)
        p.insuranceNet = ins * 2
      }
      for (const h of p.hands) h.done = true
    }
    s.phase = 'done'
    s.turn = null
    s.deadline = this.ctx.now + RESULT_MS
  }

  /** Clears the finished round and opens betting for the next one. */
  private nextRound() {
    const s = this.s
    for (let i = 0; i < SEATS; i++) {
      const seat = s.seats[i]
      if (!seat) continue
      if (seat.leaving) {
        s.seats[i] = null
        continue
      }
      seat.hands = []
      seat.results = null
      seat.insurance = null
      seat.insuranceNet = null
    }
    s.dealer = []
    s.phase = 'betting'
    s.deadline = null
  }

  /** Anyone at the table (or watching) can nudge the table past a deadline. */
  private tick(): boolean {
    const s = this.s
    if (s.deadline === null || this.ctx.now < s.deadline) return false
    switch (s.phase) {
      case 'betting':
        if (s.seats.some(x => x && x.bet > 0)) this.deal()
        else s.deadline = null
        break
      case 'insurance':
        this.peek()
        break
      case 'playing': {
        const t = s.turn!
        this.endHand(s.seats[t.seat]!.hands[t.hand])
        break
      }
      case 'done':
        this.nextRound()
        break
    }
    return true
  }

  private players(): Seat[] {
    return this.s.seats.filter((x): x is Seat => x !== null && x.hands.length > 0)
  }
}
