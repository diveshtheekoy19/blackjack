export type Suit = '♠' | '♥' | '♦' | '♣'

export type Card = {
  id: number
  rank: string
  suit: Suit
}

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose'

const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export const DECKS = 6
// Reshuffle once three quarters of the shoe has been dealt.
export const RESHUFFLE_AT = Math.floor(DECKS * 52 * 0.25)

let nextId = 0

export function newShoe(decks = DECKS): Card[] {
  const shoe: Card[] = []
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) shoe.push({ id: nextId++, rank, suit })
    }
  }
  // Fisher–Yates shuffle
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shoe[i], shoe[j]] = [shoe[j], shoe[i]]
  }
  return shoe
}

function cardValue(rank: string): number {
  if (rank === 'A') return 11
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10
  return Number(rank)
}

/** Best total for a hand; `soft` means an ace is still being counted as 11. */
export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0
  let aces = 0
  for (const c of cards) {
    total += cardValue(c.rank)
    if (c.rank === 'A') aces++
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 }
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21
}

export const MAX_HANDS = 4

/** Any two cards of equal value can be split, so K-10 counts as a pair. */
export function isPair(cards: Card[]): boolean {
  return cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank)
}

export function isRed(suit: Suit): boolean {
  return suit === '♥' || suit === '♦'
}

/** Dealer stands on all 17s. */
export function dealerShouldHit(cards: Card[]): boolean {
  return handValue(cards).total < 17
}

/** `fromSplit`: a two-card 21 on a split hand is plain 21, not blackjack. */
export function settle(player: Card[], dealer: Card[], fromSplit = false): Outcome {
  const p = handValue(player).total
  const d = handValue(dealer).total
  const pBJ = !fromSplit && isBlackjack(player)
  const dBJ = isBlackjack(dealer)

  if (p > 21) return 'lose'
  if (pBJ && dBJ) return 'push'
  if (pBJ) return 'blackjack'
  if (dBJ) return 'lose'
  if (d > 21) return 'win'
  if (p > d) return 'win'
  if (p < d) return 'lose'
  return 'push'
}

/** Total returned to the player (stake included) for a given wager. */
export function payout(outcome: Outcome, wager: number): number {
  switch (outcome) {
    case 'blackjack':
      return wager * 2.5
    case 'win':
      return wager * 2
    case 'push':
      return wager
    case 'lose':
      return 0
  }
}
