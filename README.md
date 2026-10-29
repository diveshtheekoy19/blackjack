# Blackjack

A blackjack game for the browser, built with React, TypeScript and Vite.

## Features

- Bet with $5, $25, $100 and $500 chips from a $1,000 starting bankroll
- Hit, stand, double down and split pairs (up to four hands)
- Insurance when the dealer shows an ace
- Dealer plays one card at a time
- Win / loss / push tally and a count of cards left in the shoe
- Bankroll is saved in your browser between visits
- Works on desktop and phone screens

## Rules

- Six decks, reshuffled once three quarters of the shoe has been dealt
- Blackjack pays 3 to 2
- Dealer stands on all 17s, including soft 17
- If the dealer has blackjack, the hand ends immediately
- When the dealer shows an ace you're offered insurance before the dealer checks
  for blackjack. It costs half your bet and pays 2 to 1 if the dealer has
  blackjack; otherwise it's lost and play continues
- Any two cards of the same value can be split (K-10 counts as a pair)
- Double down is allowed on any two cards, including after a split
- Split aces receive one card each
- 21 on a split hand pays 1 to 1, not 3 to 2

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `H` | Hit |
| `S` | Stand |
| `D` | Double down |
| `P` | Split |
| `I` / `N` | Take / decline insurance |
| `Enter` / `Space` | Deal / next hand |

## Running it

Requires [Node.js](https://nodejs.org/).

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

Other scripts:

- `npm run build` – type-check and build for production into `dist/`
- `npm run preview` – serve the production build locally
- `npm run lint` – lint with oxlint

## Code layout

- `src/game.ts` – deck, hand values and payout rules (no React)
- `src/App.tsx` – game flow and the table UI
- `src/App.css`, `src/index.css` – styles
