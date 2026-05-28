import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { wlGetStations } from '../lib/integrations'

const SECTION = {
  FARM:        'farm',
  WEATHERLINK: 'weatherlink',
  PHYTECH:     'phytech',
  DROPBOX:     'dropbox',
  NOTIFY:      'notifications',
  ACCOUNT:     'account',
}

export default function SettingsTab() {
  const { user, signOut } = useAuth()
  const [section, setSection] = useState(SECTION.FARM)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  // Farm profile
  const [farm, setFarm] = useState({
    farm_name: '', location_lat: '', location_lng: '',
    zip_code: '', timezone: 'America/Chicago', units: 'imperial',
  })

  // WeatherLink
  const [wl, setWl] = useState({
    api_key: '', api_secret: '', station_id: '', station_name: '',
    connected: false, last_sync: null,
  })
  const [wlStations, setWlStations] = useState([])
  const [wlTesting, setWlTesting]   = useState(false)
  const [wlError, setWlError]       = useState('')

  // Phytech
  const [phytech, setPhytech] = useState({
    api_key: '', field_id: '', connected: false,
  })

  // Dropbox
  const [dropbox, setDropbox] = useState({
    connected: false, access_token: '',
    folder_mappings: [], // [{machine_id, machine_name, pre_graze_path, post_graze_path, recovery_path}]
    poll_interval: 15,
  })

  // Notifications
  const [notify, setNotify] = useState({
    daily_report_time: '19:00',
    bloat_alert: true, residual_alert: true,
    rain_alert: true, frost_alert: true,
    low_inventory_days: 3,
    method: 'push',
  })

  // Load settings from Supabase on mount
  useEffect(() => {
    if (!user) return
    supabase.from('app_settings').select('*').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (!data) return
        if (data.farm_profile)     setFarm(JSON.parse(data.farm_profile))
        if (data.weatherlink)      setWl(JSON.parse(data.weatherlink))
        if (data.phytech)          setPhytech(JSON.parse(data.phytech))
        if (data.dropbox)          setDropbox(JSON.parse(data.dropbox))
        if (data.notifications)    setNotify(JSON.parse(data.notifications))
      })
  }, [user])

  async function saveSettings() {
    setSaving(true)
    try {
      const row = {
        user_id:       user.id,
        farm_profile:  JSON.stringify(farm),
        weatherlink:   JSON.stringify(wl),
        phytech:       JSON.stringify(phytech),
        dropbox:       JSON.stringify(dropbox),
        notifications: JSON.stringify(notify),
        updated_at:    new Date().toISOString(),
      }
      await supabase.from('app_settings').upsert(row, { onConflict: 'user_id' })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { alert('Error saving: ' + e.message) }
    setSaving(false)
  }

  async function testWeatherLink() {
    if (!wl.api_key || !wl.api_secret) { setWlError('Enter API key and secret first'); return }
    setWlTesting(true); setWlError('')
    try {
      const stations = await wlGetStations(wl.api_key, wl.api_secret)
      setWlStations(stations)
      if (stations.length > 0) {
        setWl(w => ({ ...w, connected: true, station_id: w.station_id || stations[0].station_id, station_name: w.station_name || stations[0].station_name }))
      }
    } catch (e) { setWlError(e.message) }
    setWlTesting(false)
  }

  const navItems = [
    { id: SECTION.FARM,        label: 'Farm Profile',    icon: '🌾' },
    { id: SECTION.WEATHERLINK, label: 'WeatherLink',     icon: '🌤' },
    { id: SECTION.PHYTECH,     label: 'Phytech',         icon: '🌱' },
    { id: SECTION.DROPBOX,     label: 'Dropbox / Cameras', icon: '📷' },
    { id: SECTION.NOTIFY,      label: 'Notifications',   icon: '🔔' },
    { id: SECTION.ACCOUNT,     label: 'Account',         icon: '👤' },
  ]

  return (
    <div>
      <div className="section-heading">Settings</div>
      <div className="section-desc">Configure your farm profile, data connections and notifications.</div>

      <div className="grid-2">
        {/* ── Sidebar nav ── */}
        <div style={{ maxWidth: 220 }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => setSection(item.id)} style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              width: '100%', padding: '10px 14px', marginBottom: 4,
              background: section === item.id ? 'var(--moss)' : 'var(--bark)',
              border: `1px solid ${section === item.id ? 'var(--grass)' : 'var(--bark2)'}`,
              borderRadius: 8, cursor: 'pointer', color: section === item.id ? 'var(--white)' : 'var(--subtext)',
              fontFamily: 'DM Mono, monospace', fontSize: '0.72rem', letterSpacing: '0.04em',
              transition: 'all 0.15s', textAlign: 'left',
            }}>
              <span>{item.icon}</span> {item.label}
              {item.id === SECTION.WEATHERLINK && wl.connected && <span style={{ marginLeft: 'auto', color: 'var(--grass)', fontSize: '0.6rem' }}>●</span>}
              {item.id === SECTION.PHYTECH && phytech.connected && <span style={{ marginLeft: 'auto', color: 'var(--grass)', fontSize: '0.6rem' }}>●</span>}
              {item.id === SECTION.DROPBOX && dropbox.connected && <span style={{ marginLeft: 'auto', color: 'var(--grass)', fontSize: '0.6rem' }}>●</span>}
            </button>
          ))}
        </div>

        {/* ── Content panels ── */}
        <div>
          {/* FARM PROFILE */}
          {section === SECTION.FARM && (
            <div className="card">
              <div className="card-title mb-2">Farm Profile</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div className="field">
                  <label className="label">Farm Name</label>
                  <input className="input" value={farm.farm_name} onChange={e => setFarm(f => ({ ...f, farm_name: e.target.value }))} placeholder="e.g. Crawford Cattle Co." />
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label className="label">Zip Code</label>
                    <input className="input" value={farm.zip_code} onChange={e => setFarm(f => ({ ...f, zip_code: e.target.value }))} placeholder="e.g. 69001" />
                  </div>
                  <div className="field">
                    <label className="label">Time Zone</label>
                    <select className="select" value={farm.timezone} onChange={e => setFarm(f => ({ ...f, timezone: e.target.value }))}>
                      <option value="America/Chicago">Central</option>
                      <option value="America/Denver">Mountain</option>
                      <option value="America/New_York">Eastern</option>
                      <option value="America/Los_Angeles">Pacific</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="label">Units</label>
                  <select className="select" value={farm.units} onChange={e => setFarm(f => ({ ...f, units: e.target.value }))}>
                    <option value="imperial">Imperial (ft, lb, °F)</option>
                    <option value="metric">Metric (m, kg, °C)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* WEATHERLINK */}
          {section === SECTION.WEATHERLINK && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div className="card-title">WeatherLink v2</div>
                {wl.connected && <span style={{ background: 'rgba(110,192,64,0.2)', border: '1px solid var(--grass)', borderRadius: 20, padding: '3px 10px', fontSize: '0.65rem', color: 'var(--grass)', fontFamily: 'DM Mono, monospace' }}>● Connected</span>}
              </div>

              <div style={{ background: 'rgba(15,26,10,0.6)', border: '1px solid var(--moss)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', fontSize: '0.78rem', color: 'var(--subtext)' }}>
                Get your API key from <strong style={{ color: 'var(--grass)' }}>weatherlink.com</strong> → My Account → API Access → Generate v2 Key
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div className="field">
                  <label className="label">API Key</label>
                  <input className="input" value={wl.api_key} onChange={e => setWl(w => ({ ...w, api_key: e.target.value }))} placeholder="Your WeatherLink v2 API key" />
                </div>
                <div className="field">
                  <label className="label">API Secret</label>
                  <input className="input" type="password" value={wl.api_secret} onChange={e => setWl(w => ({ ...w, api_secret: e.target.value }))} placeholder="Your WeatherLink v2 API secret" />
                </div>

                <button className="btn btn-primary" onClick={testWeatherLink} disabled={wlTesting}>
                  {wlTesting ? <><span className="spinner" /> Connecting…</> : '🔗 Connect & Discover Stations'}
                </button>

                {wlError && <div style={{ color: 'var(--alert)', fontSize: '0.78rem', fontFamily: 'DM Mono, monospace' }}>⚠ {wlError}</div>}

                {wlStations.length > 0 && (
                  <div className="field">
                    <label className="label">Select Station</label>
                    <select className="select" value={wl.station_id} onChange={e => {
                      const st = wlStations.find(s => String(s.station_id) === e.target.value)
                      setWl(w => ({ ...w, station_id: e.target.value, station_name: st?.station_name || '' }))
                    }}>
                      {wlStations.map(st => (
                        <option key={st.station_id} value={st.station_id}>{st.station_name} (ID: {st.station_id})</option>
                      ))}
                    </select>
                  </div>
                )}

                {wl.connected && wl.station_name && (
                  <div style={{ background: 'rgba(110,192,64,0.1)', border: '1px solid rgba(110,192,64,0.3)', borderRadius: 7, padding: '0.75rem', fontSize: '0.78rem' }}>
                    <div style={{ color: 'var(--grass)', fontFamily: 'DM Mono, monospace', marginBottom: '0.25rem' }}>✓ Connected to: {wl.station_name}</div>
                    <div style={{ color: 'var(--subtext)' }}>Station ID: {wl.station_id}</div>
                    {wl.last_sync && <div style={{ color: 'var(--subtext)' }}>Last sync: {new Date(wl.last_sync * 1000).toLocaleString()}</div>}
                  </div>
                )}

                <div style={{ fontSize: '0.72rem', color: 'var(--subtext)' }}>
                  Data pulled: temperature, humidity, wind speed/direction, daily rainfall, soil moisture (if probe attached)
                </div>
              </div>
            </div>
          )}

          {/* PHYTECH */}
          {section === SECTION.PHYTECH && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div className="card-title">Phytech Integration</div>
                <span style={{ background: 'rgba(240,192,64,0.15)', border: '1px solid rgba(240,192,64,0.4)', borderRadius: 20, padding: '3px 10px', fontSize: '0.65rem', color: 'var(--gold)', fontFamily: 'DM Mono, monospace' }}>Pending API Access</span>
              </div>

              <div style={{ background: 'rgba(240,192,64,0.08)', border: '1px solid rgba(240,192,64,0.3)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--subtext)' }}>
                <div style={{ color: 'var(--gold)', fontWeight: 600, marginBottom: '0.4rem' }}>⏳ Awaiting Phytech API Credentials</div>
                Contact Phytech to request API access for your account:
                <div style={{ fontFamily: 'DM Mono, monospace', color: 'var(--cream)', marginTop: '0.4rem', fontSize: '0.9rem' }}>📞 (321) 428-3385</div>
                <div style={{ marginTop: '0.3rem' }}>Ask for: API endpoint URL, API key, and your field/block IDs</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div className="field">
                  <label className="label">Phytech API Key (when provided)</label>
                  <input className="input" value={phytech.api_key} onChange={e => setPhytech(p => ({ ...p, api_key: e.target.value }))} placeholder="Enter API key once received from Phytech" />
                </div>
                <div className="field">
                  <label className="label">Field / Block ID</label>
                  <input className="input" value={phytech.field_id} onChange={e => setPhytech(p => ({ ...p, field_id: e.target.value }))} placeholder="Your Phytech field ID" />
                </div>

                <div style={{ background: 'var(--bark)', borderRadius: 8, padding: '0.75rem', fontSize: '0.75rem', color: 'var(--subtext)' }}>
                  <div style={{ color: 'var(--grass)', marginBottom: '0.4rem', fontFamily: 'DM Mono, monospace' }}>Data that will be available once connected:</div>
                  <div>🌱 Plant stress indicator (green / yellow / red)</div>
                  <div>📊 MDS — Maximum Daily Shrinkage (growth rate)</div>
                  <div>💧 Soil moisture at 6", 12", 24" depth</div>
                  <div>🌡 Soil temperature per depth</div>
                  <div>⚡ Tensiometer pressure (cbar)</div>
                  <div>🌤 On-site weather station data</div>
                </div>
              </div>
            </div>
          )}

          {/* DROPBOX */}
          {section === SECTION.DROPBOX && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div className="card-title">Dropbox / Trail Cameras</div>
                {dropbox.connected && <span style={{ background: 'rgba(110,192,64,0.2)', border: '1px solid var(--grass)', borderRadius: 20, padding: '3px 10px', fontSize: '0.65rem', color: 'var(--grass)', fontFamily: 'DM Mono, monospace' }}>● Connected</span>}
              </div>

              <div style={{ background: 'rgba(15,26,10,0.6)', border: '1px solid var(--moss)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', fontSize: '0.78rem', color: 'var(--subtext)' }}>
                Set up your trail cameras to sync photos to Dropbox. The app pulls new photos automatically every {dropbox.poll_interval} minutes.
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--subtext)', marginBottom: '1rem' }}>
                <div style={{ color: 'var(--grass)', fontFamily: 'DM Mono, monospace', marginBottom: '0.5rem' }}>Expected Dropbox folder structure:</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.68rem', background: 'var(--bark)', borderRadius: 6, padding: '0.5rem 0.75rem', lineHeight: 1.8 }}>
                  /PivotalPastures/<br />
                  &nbsp;&nbsp;{'/TrevorNorthPivot/'}<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;{'/Camera1-PreGraze/'}<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;{'/Camera2-PostGraze/'}<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;{'/Camera3-Recovery/'}
                </div>
              </div>

              {!dropbox.connected ? (
                <button className="btn btn-primary" onClick={() => {
                  // Dropbox OAuth — in production this would open OAuth popup
                  alert('Dropbox OAuth integration — connect your Dropbox account to enable automatic photo syncing. Implementation requires Dropbox App key in environment variables.')
                }}>
                  📦 Connect Dropbox Account
                </button>
              ) : (
                <>
                  <div className="field" style={{ marginBottom: '0.75rem' }}>
                    <label className="label">Poll Interval</label>
                    <select className="select" value={dropbox.poll_interval} onChange={e => setDropbox(d => ({ ...d, poll_interval: +e.target.value }))}>
                      <option value={15}>Every 15 minutes</option>
                      <option value={30}>Every 30 minutes</option>
                      <option value={60}>Every hour</option>
                    </select>
                  </div>

                  <div style={{ color: 'var(--subtext)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
                    📷 Camera folder mappings are configured per machine in the Machines tab.
                  </div>
                </>
              )}
            </div>
          )}

          {/* NOTIFICATIONS */}
          {section === SECTION.NOTIFY && (
            <div className="card">
              <div className="card-title mb-2">Notification Settings</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div className="field">
                  <label className="label">Daily Report Time</label>
                  <input className="input" type="time" value={notify.daily_report_time} onChange={e => setNotify(n => ({ ...n, daily_report_time: e.target.value }))} />
                  <div style={{ fontSize: '0.68rem', color: 'var(--subtext)', marginTop: 3 }}>Daily summary compiled from all photos and sent at this time</div>
                </div>

                <div className="field">
                  <label className="label">Low Inventory Alert</label>
                  <select className="select" value={notify.low_inventory_days} onChange={e => setNotify(n => ({ ...n, low_inventory_days: +e.target.value }))}>
                    <option value={1}>Alert when 1 day remaining</option>
                    <option value={2}>Alert when 2 days remaining</option>
                    <option value={3}>Alert when 3 days remaining</option>
                    <option value={5}>Alert when 5 days remaining</option>
                  </select>
                </div>

                <div className="field">
                  <label className="label">Notification Method</label>
                  <select className="select" value={notify.method} onChange={e => setNotify(n => ({ ...n, method: e.target.value }))}>
                    <option value="push">Push notification</option>
                    <option value="email">Email</option>
                    <option value="both">Both</option>
                  </select>
                </div>

                <div style={{ background: 'var(--bark)', borderRadius: 8, padding: '0.75rem' }}>
                  <div className="label" style={{ marginBottom: '0.5rem' }}>Alert Types</div>
                  {[
                    { key: 'bloat_alert',    label: '🌿 Bloat risk alert' },
                    { key: 'residual_alert', label: '📏 Residual too low/high' },
                    { key: 'rain_alert',     label: '🌧 Rain / soil condition alert' },
                    { key: 'frost_alert',    label: '❄️ Frost warning' },
                  ].map(item => (
                    <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--bark2)' }}>
                      <span style={{ fontSize: '0.82rem', color: 'var(--cream)' }}>{item.label}</span>
                      <button onClick={() => setNotify(n => ({ ...n, [item.key]: !n[item.key] }))} style={{
                        background: notify[item.key] ? 'var(--moss)' : 'var(--bark2)',
                        border: `1px solid ${notify[item.key] ? 'var(--grass)' : '#3a5520'}`,
                        borderRadius: 20, padding: '3px 12px', cursor: 'pointer',
                        color: notify[item.key] ? 'var(--white)' : 'var(--subtext)',
                        fontFamily: 'DM Mono, monospace', fontSize: '0.65rem', transition: 'all 0.15s',
                      }}>
                        {notify[item.key] ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ACCOUNT */}
          {section === SECTION.ACCOUNT && (
            <div className="card">
              <div className="card-title mb-2">Account</div>
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--bark)', borderRadius: 8, fontSize: '0.82rem' }}>
                <div style={{ color: 'var(--subtext)', marginBottom: '0.25rem' }}>Signed in as:</div>
                <div style={{ color: 'var(--cream)', fontFamily: 'DM Mono, monospace' }}>{user?.email}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button className="btn btn-secondary" onClick={signOut}>Sign Out</button>
                <button className="btn btn-danger btn-sm" onClick={() => {
                  if (confirm('Delete your account and all data? This cannot be undone.')) {
                    alert('Please contact support to delete your account.')
                  }
                }}>Delete Account</button>
              </div>
            </div>
          )}

          {/* Save button */}
          {section !== SECTION.ACCOUNT && (
            <button className="btn btn-primary mt-2" onClick={saveSettings} disabled={saving} style={{ width: '100%', justifyContent: 'center' }}>
              {saving ? <><span className="spinner" /> Saving…</> : saved ? '✓ Saved!' : '💾 Save Settings'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
