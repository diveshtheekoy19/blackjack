import { handValue, isRed, type Card } from '../supabase/functions/_shared/game.ts'

export function PlayingCard({ card }: { card: Card }) {
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

export function FaceDownCard() {
  return <div className="card card-back" aria-label="Face-down card" />
}

export function TotalBadge({ cards }: { cards: Card[] }) {
  const { total, soft } = handValue(cards)
  return (
    <span className={`total ${total > 21 ? 'bust' : ''}`}>
      {soft && total < 21 ? `${total - 10} / ${total}` : total}
      {total > 21 && ' bust'}
    </span>
  )
}
