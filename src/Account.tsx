import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import App from './App.tsx'
import { loadStats, supabase, type SavedStats } from './supabase.ts'

/** Shows the login screen until there's a session, then the game with the player's saved stats. */
export default function Account() {
  // undefined = still checking for an existing session
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  // Tagged with the user it belongs to, so a different login never sees it.
  const [loaded, setLoaded] = useState<{ userId: string; stats?: SavedStats; error?: string } | null>(null)
  const userId = session?.user.id
  const current = loaded && loaded.userId === userId ? loaded : null
  const saved = current?.stats
  const loadError = current?.error

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadStats(userId)
      .then(stats => !cancelled && setLoaded({ userId, stats }))
      .catch(
        () =>
          !cancelled &&
          setLoaded({ userId, error: "Couldn't load your stats. Check your connection and reload." }),
      )
    return () => {
      cancelled = true
    }
  }, [userId])

  const signOut = () => supabase.auth.signOut()

  if (session === undefined) return <Splash text="Loading…" />
  if (!session) return <Login />
  if (loadError) return <Splash text={loadError} onSignOut={signOut} />
  if (!saved) return <Splash text="Loading your stats…" />
  return (
    <App key={userId} userId={session.user.id} email={session.user.email ?? ''} saved={saved} onSignOut={signOut} />
  )
}

function Splash({ text, onSignOut }: { text: string; onSignOut?: () => void }) {
  return (
    <div className="auth">
      <h1>Blackjack</h1>
      <p className="hint">{text}</p>
      {onSignOut && (
        <button className="btn ghost" onClick={onSignOut}>
          Log out
        </button>
      )}
    </div>
  )
}

function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(
          error.code === 'email_not_confirmed'
            ? 'Please confirm your email first. Check your inbox for the link.'
            : error.code === 'invalid_credentials'
              ? 'Wrong email or password.'
              : error.message,
        )
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) setError(error.message)
      else if (!data.session) {
        setNotice(`Almost done! We sent a confirmation link to ${email}. Click it, then log in.`)
        setMode('login')
        setPassword('')
      }
    }
    setBusy(false)
  }

  const switchMode = () => {
    setMode(m => (m === 'login' ? 'signup' : 'login'))
    setError('')
    setNotice('')
  }

  return (
    <div className="auth">
      <h1>Blackjack</h1>
      <form className="auth-form" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Log in' : 'Create an account'}</h2>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="auth-msg error">{error}</p>}
        {notice && <p className="auth-msg">{notice}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
        <button className="btn ghost" type="button" onClick={switchMode}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
        </button>
      </form>
    </div>
  )
}
