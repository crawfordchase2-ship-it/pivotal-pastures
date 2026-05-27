import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import AuthPage from './components/AuthPage'
import RotationsTab from './components/RotationsTab'
import MachinesTab from './components/MachinesTab'
import HerdsTab from './components/HerdsTab'
import ScheduleTab from './components/ScheduleTab'
import ReportsTab from './components/ReportsTab'

const TABS = [
  { id: 'rotation', label: 'Rotations', icon: '🌀' },
  { id: 'machines', label: 'Machines',  icon: '⚙️' },
  { id: 'herds',    label: 'Herds',     icon: '🐄' },
  { id: 'schedule', label: 'Schedule',  icon: '📅' },
  { id: 'reports',  label: 'Reports',   icon: '📋' },
]

export default function App() {
  const { user, loading, signOut } = useAuth()
  const [tab, setTab] = useState('rotation')

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--earth)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🌾</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.7rem', color: 'var(--straw)', letterSpacing: '0.1em' }}>LOADING…</div>
        </div>
      </div>
    )
  }

  if (!user) return <AuthPage />

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <div className="logo-icon">🌾</div>
          <div>
            <div className="logo-text">Pivotal Pastures</div>
            <div className="logo-sub">Grazing Manager</div>
          </div>
        </div>
        <nav className="desktop-nav">
          {TABS.map(t => (
            <button key={t.id} className={`desktop-nav-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={signOut}>Sign Out</button>
        </div>
      </header>
      <main className="main">
        {tab === 'rotation' && <RotationsTab />}
        {tab === 'machines' && <MachinesTab />}
        {tab === 'herds'    && <HerdsTab />}
        {tab === 'schedule' && <ScheduleTab />}
        {tab === 'reports'  && <ReportsTab />}
      </main>
      <nav className="bottom-nav">
        {TABS.map(t => (
          <button key={t.id} className={`bottom-nav-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
