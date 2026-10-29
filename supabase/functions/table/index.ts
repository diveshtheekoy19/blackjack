// Runs the shared blackjack tables. Every move goes through here: the table
// row is locked, the rules in ../_shared/table.ts work out the new state,
// and the money, stats and public state are saved in one transaction.
import postgres from 'npm:postgres@3.4.5'
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'
import {
  ActionError,
  applyAction,
  newTable,
  toPublic,
  type Action,
  type TableState,
} from '../_shared/table.ts'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false })
const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const ACTIONS = new Set(['join', 'leave', 'bet', 'insurance', 'hit', 'stand', 'double', 'split', 'tick'])

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '')
  const { data } = jwt ? await auth.auth.getUser(jwt) : { data: { user: null } }
  const user = data.user
  if (!user) return reply(401, { error: 'Please log in again.' })

  let tableId: number
  let action: Action
  try {
    const body = await req.json()
    tableId = Number(body.table)
    action = body.action
    if (!Number.isInteger(tableId) || !action || !ACTIONS.has(action.type)) throw new Error()
  } catch {
    return reply(400, { error: 'Bad request.' })
  }

  try {
    await sql.begin(async tx => {
      const [row] = await tx`
        select state, version from game_private.table_state where id = ${tableId} for update`
      if (!row) throw new ActionError('No such table.')
      const state: TableState = row.state ?? newTable()

      if (action.type === 'join') {
        const elsewhere = await tx`
          select id from game_private.table_state
          where id <> ${tableId}
            and state -> 'seats' @> ${tx.json([{ userId: user.id }])}`
        if (elsewhere.length) throw new ActionError("You're already sitting at another table. Leave it first.")
      }

      // Lock every player involved, in a fixed order, so money can't be
      // spent twice across tables.
      const ids = new Set([user.id])
      for (const seat of state.seats) if (seat) ids.add(seat.userId)
      const players = await tx`
        select user_id, bankroll, display_name from public.player_stats
        where user_id in ${tx([...ids])}
        order by user_id
        for update`
      const bankroll: Record<string, number> = {}
      let name = `Player ${user.id.slice(0, 4)}`
      for (const p of players) {
        bankroll[p.user_id] = Number(p.bankroll)
        if (p.user_id === user.id && p.display_name) name = p.display_name
      }
      if (!(user.id in bankroll)) throw new ActionError('Reload the page and try again.')

      const now = Date.now()
      const ctx = { now, bankroll, name, changes: {} }
      const next = applyAction(state, user.id, action, ctx)
      if (!next) return

      for (const [userId, c] of Object.entries(ctx.changes)) {
        await tx`
          update public.player_stats set
            bankroll = bankroll + ${c.bankroll},
            won = won + ${c.won},
            lost = lost + ${c.lost},
            pushed = pushed + ${c.pushed},
            updated_at = now()
          where user_id = ${userId}`
      }
      const version = Number(row.version) + 1
      await tx`
        update game_private.table_state
        set state = ${tx.json(next)}, version = ${version}
        where id = ${tableId}`
      await tx`
        update public.game_tables
        set state = ${tx.json(toPublic(next, version, now))}, updated_at = now()
        where id = ${tableId}`
    })
  } catch (e) {
    if (e instanceof ActionError) return reply(400, { error: e.message })
    console.error(e)
    return reply(500, { error: 'Something went wrong. Try again.' })
  }
  return reply(200, { ok: true })
})
