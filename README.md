# Blackjack

A multiplayer blackjack game for the browser, built with React, TypeScript and Vite,
with Supabase for logins, the database, live updates and the game server.

## Features

- Three live tables with five seats each: everyone at a table plays against the
  same dealer and sees every card as it is dealt
- 20 seconds to act on your turn, or you stand automatically
- Bet with $5, $25, $100 and $500 chips from a $1,000 starting bankroll
- Hit, stand, double down and split pairs (up to four hands)
- Insurance when the dealer shows an ace
- Dealer reveals one card at a time
- Win / loss / push tally and a count of cards left in each table's shoe
- Log in with email and password; your bankroll and record are saved to a
  Supabase database, so they follow you to any device
- Leaderboard of the top 10 players by bankroll, with a name you choose
  (emails are never shown)
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
| `Enter` | Place bet |
| `L` / `Esc` | Open / close the leaderboard |

## Running it

Requires [Node.js](https://nodejs.org/) and a [Supabase](https://supabase.com/) project.

1. Set up the database by running the files in `supabase/migrations/` (in order)
   in the Supabase SQL editor (or `npx supabase db push` on a linked project).
2. Deploy the game server: `npx supabase functions deploy table --use-api --no-verify-jwt`
3. Create `.env.local` with your project URL and publishable key:

   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   On Vercel, set the same two environment variables.
4. Install and start:

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

- `supabase/functions/_shared/game.ts` – deck, hand values and payout rules
- `supabase/functions/_shared/table.ts` – multiplayer table rules (betting, turns,
  timers, settling), shared by the server and the browser
- `supabase/functions/table/` – the Edge Function that runs every move: it locks the
  table, applies the rules and saves money, stats and table state together
- `src/App.tsx` – header, lobby or table, live bankroll
- `src/Lobby.tsx`, `src/Table.tsx`, `src/Cards.tsx` – the lobby and live table screens
- `src/useTables.ts` – live table data, and nudging tables past their timers
- `src/Account.tsx` – login / sign-up screen; loads the player's saved stats
- `src/Leaderboard.tsx` – leaderboard popup and name setting
- `src/supabase.ts` – Supabase client, loading and saving stats, leaderboard data
- `supabase/migrations/` – database tables, security rules and functions
- `src/App.css`, `src/index.css` – styles
