# Blackjack

A blackjack game for the browser, built with React, TypeScript and Vite.

## Features

- Bet with $5, $25, $100 and $500 chips from a $1,000 starting bankroll
- Hit, stand, double down and split pairs (up to four hands)
- Insurance when the dealer shows an ace
- Dealer plays one card at a time
- Win / loss / push tally and a count of cards left in the shoe
- Log in with email and password; your bankroll and record are saved to a
  Supabase database, so they follow you to any device
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

Requires [Node.js](https://nodejs.org/) and a [Supabase](https://supabase.com/) project.

1. Create the `player_stats` table by running
   `supabase/migrations/20261029150000_player_stats.sql` in the Supabase SQL editor
   (or `npx supabase db push` on a linked project).
2. Create `.env.local` with your project URL and publishable key:

   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   On Vercel, set the same two environment variables.
3. Install and start:

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
- `src/Account.tsx` – login / sign-up screen; loads the player's saved stats
- `src/supabase.ts` – Supabase client, loading and saving stats
- `supabase/migrations/` – database table and row level security rules
- `src/App.css`, `src/index.css` – styles
