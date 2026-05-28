import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

export default function AuthPage() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth()
  const [mode, setMode]         = useState('signin')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleEmail(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error: err } = mode === 'signin'
        ? await signInWithEmail(email, password, remember)
        : await signUpWithEmail(email, password)
      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function handleGoogle() {
    setError('')
    try {
      const { error: err } = await signInWithGoogle()
      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">🌾</span>
          <div className="auth-logo-title">Pivotal Pastures</div>
          <div className="auth-logo-sub">Regenerative Grazing Manager</div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleEmail} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="field">
            <label className="label">Email</label>
            <input className="input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" required />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <input className="input" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required />
          </div>

          {/* Remember me */}
          {mode === 'signin' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                id="remember"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--grass)', cursor: 'pointer' }}
              />
              <label htmlFor="remember" style={{
                fontFamily: 'DM Mono, monospace', fontSize: '0.65rem',
                color: 'var(--subtext)', cursor: 'pointer', letterSpacing: '0.05em',
              }}>
                Remember me for 30 days
              </label>
            </div>
          )}

          <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? <><span className="spinner" /> {mode === 'signin' ? 'Signing in…' : 'Creating account…'}</>
              : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="auth-divider">or</div>

        <button className="btn btn-secondary btn-full" onClick={handleGoogle}>
          <span>🔐</span> Continue with Google
        </button>

        <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.78rem', color: 'var(--subtext)' }}>
          {mode === 'signin' ? (
            <>Don't have an account?{' '}
              <button onClick={() => setMode('signup')} style={{ background: 'none', border: 'none', color: 'var(--grass)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'Lora, serif' }}>
                Sign up
              </button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button onClick={() => setMode('signin')} style={{ background: 'none', border: 'none', color: 'var(--grass)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'Lora, serif' }}>
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
