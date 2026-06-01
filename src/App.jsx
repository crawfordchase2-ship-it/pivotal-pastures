import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import AuthPage         from './components/AuthPage'
import DashboardTab     from './components/DashboardTab'
import MachinesTab      from './components/MachinesTab'
import HerdsTab         from './components/HerdsTab'
import GrazingPlanTab   from './components/GrazingPlanTab'
import ScheduleTab      from './components/ScheduleTab'
import FieldMapTab      from './components/FieldMapTab'
import InventoryTab     from './components/InventoryTab'
import RotationsTab     from './components/RotationsTab'
import ReportsTab       from './components/ReportsTab'
import SettingsTab      from './components/SettingsTab'
import AnimalsTab       from './components/AnimalsTab'

// ── App version ──────────────────────────────────────────────────────────────
const APP_VERSION = 'v3.19'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
  { id: 'map',       label: 'Field Map', icon: '🗺' },
  { id: 'plan',      label: 'Plan',      icon: '🌿' },
  { id: 'schedule',  label: 'Schedule',  icon: '📅' },
  { id: 'inventory', label: 'Inventory', icon: '📊' },
  { id: 'rotations', label: 'Rotations', icon: '🌀' },
  { id: 'machines',  label: 'Machines',  icon: '⚙️' },
  { id: 'herds',     label: 'Herds',     icon: '🐄' },
  { id: 'animals',   label: 'Animals',   icon: '🐮' },
  { id: 'reports',   label: 'Reports',   icon: '📋' },
  { id: 'settings',  label: 'Settings',  icon: '🔧' },
]

const MOBILE_TABS = ['dashboard', 'schedule', 'map', 'inventory', 'rotations']

export default function App() {
  const { user, loading, signOut } = useAuth()
  const [tab, setTab]         = useState('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--earth)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🌾</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.7rem', color: 'var(--subtext)', letterSpacing: '0.1em' }}>LOADING…</div>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative', zIndex: 1 }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>{user.email?.split('@')[0]}</span>
          <button className="btn btn-secondary btn-sm" onClick={signOut}>Sign Out</button>
        </div>
      </header>

      <main className="main">
        {tab === 'dashboard'  && <DashboardTab />}
        {tab === 'map'        && <FieldMapTab />}
        {tab === 'plan'       && <GrazingPlanTab />}
        {tab === 'schedule'   && <ScheduleTab />}
        {tab === 'inventory'  && <InventoryTab />}
        {tab === 'rotations'  && <RotationsTab />}
        {tab === 'machines'   && <MachinesTab />}
        {tab === 'herds'      && <HerdsTab />}
        {tab === 'animals'    && <AnimalsTab />}
        {tab === 'reports'    && <ReportsTab />}
        {tab === 'settings'   && <SettingsTab />}
      </main>

      <nav className="bottom-nav">
        {TABS.filter(t => MOBILE_TABS.includes(t.id)).map(t => (
          <button key={t.id} className={`bottom-nav-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
        <button className={`bottom-nav-btn ${!MOBILE_TABS.includes(tab) ? 'active' : ''}`} onClick={() => setMenuOpen(o => !o)}>
          <span className="nav-icon">⋯</span>
          More
        </button>
      </nav>

      {menuOpen && (
        <div style={{ position: 'fixed', bottom: 65, right: 0, left: 0, background: 'var(--soil)', borderTop: '1px solid var(--bark2)', zIndex: 200, padding: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.5rem' }}
          onClick={() => setMenuOpen(false)}>
          {TABS.filter(t => !MOBILE_TABS.includes(t.id)).map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setMenuOpen(false) }} style={{
              background: tab === t.id ? 'var(--moss)' : 'var(--bark)',
              border: `1px solid ${tab === t.id ? 'var(--grass)' : 'var(--bark2)'}`,
              borderRadius: 8, padding: '10px 8px', cursor: 'pointer',
              color: tab === t.id ? 'var(--white)' : 'var(--subtext)',
              fontFamily: 'DM Mono, monospace', fontSize: '0.62rem', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              <span style={{ fontSize: '1.2rem' }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    {/* Version badge */}
      <div style={{
        position: 'fixed', bottom: 70, right: 8,
        background: 'rgba(46,77,28,0.85)',
        border: '1px solid var(--bark2)',
        borderRadius: 5, padding: '2px 7px',
        fontFamily: 'DM Mono, monospace',
        fontSize: '0.55rem', color: 'var(--subtext)',
        zIndex: 50, backdropFilter: 'blur(4px)',
        pointerEvents: 'none',
      }}>
        {APP_VERSION}
      </div>
    </div>
  )
}
