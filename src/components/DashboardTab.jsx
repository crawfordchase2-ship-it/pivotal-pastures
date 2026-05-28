import { useState, useEffect } from 'react'
import { useMachines, useHerds, useGrazingPlans, useFieldPositions, useObservations } from '../hooks/useData'
import { useSettings, useWeatherData } from '../hooks/useSettings'
import { wlGetCurrent, windDirLabel, checkWeatherAlerts, predictHeightAtReturn, predictDMAtHeight, getCurrentSeason, phytechStressModifier } from '../lib/integrations'
import { fmt12, toMins } from '../lib/grazing'

function WeatherCard({ wx, alerts }) {
  if (!wx) return (
    <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>🌤</div>
      <div style={{ color: 'var(--subtext)', fontSize: '0.8rem' }}>No WeatherLink station connected</div>
      <div style={{ color: 'var(--subtext)', fontSize: '0.72rem', marginTop: '0.25rem' }}>Configure in Settings → WeatherLink</div>
    </div>
  )
  return (
    <div className="card">
      <div className="card-sub mb-2">Weather — Live</div>
      <div className="grid-4" style={{ marginBottom: '0.75rem' }}>
        {[
          ['🌡', wx.tempF != null ? wx.tempF + '°F' : '—', 'Temp'],
          ['💧', wx.humidity != null ? wx.humidity + '%' : '—', 'Humidity'],
          ['💨', wx.windMph != null ? wx.windMph + ' mph ' + windDirLabel(wx.windDir) : '—', 'Wind'],
          ['🌧', wx.rainInDay != null ? wx.rainInDay + '"' : '—', 'Rain Today'],
        ].map(([icon, val, lbl]) => (
          <div key={lbl} className="stat-box">
            <div style={{ fontSize: '1.2rem', marginBottom: 2 }}>{icon}</div>
            <div className="stat-val" style={{ fontSize: '1rem' }}>{val}</div>
            <div className="stat-lbl">{lbl}</div>
          </div>
        ))}
      </div>
      {wx.soilTempF && (
        <div style={{ fontSize: '0.75rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
          Soil temp: <span style={{ color: 'var(--cream)' }}>{wx.soilTempF}°F</span>
          {wx.soilMoisture && <> · Soil moisture: <span style={{ color: 'var(--cream)' }}>{wx.soilMoisture} cbar</span></>}
        </div>
      )}
      {alerts?.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          {alerts.map((a, i) => (
            <div key={i} style={{
              background: a.level === 'alert' ? 'rgba(224,64,48,0.15)' : 'rgba(224,124,24,0.12)',
              border: `1px solid ${a.level === 'alert' ? 'var(--alert)' : 'var(--amber)'}`,
              borderRadius: 7, padding: '7px 10px', marginBottom: 5,
              fontSize: '0.75rem', color: a.level === 'alert' ? 'var(--alert)' : 'var(--amber)',
            }}>
              ⚠ {a.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PhytechCard({ phytech }) {
  const stressColors = { green: 'var(--grass)', yellow: 'var(--gold)', red: 'var(--alert)' }
  if (!phytech?.connected) return (
    <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>🌱</div>
      <div style={{ color: 'var(--subtext)', fontSize: '0.8rem' }}>Phytech not connected</div>
      <div style={{ color: 'var(--subtext)', fontSize: '0.72rem', marginTop: '0.25rem' }}>Call (321) 428-3385 for API access</div>
    </div>
  )
  return (
    <div className="card">
      <div className="card-sub mb-2">Plant & Soil — Phytech</div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: phytech.plantStress ? stressColors[phytech.plantStress] : 'var(--bark)',
          border: `3px solid ${phytech.plantStress ? stressColors[phytech.plantStress] : 'var(--bark2)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: phytech.plantStress ? `0 0 12px ${stressColors[phytech.plantStress]}55` : 'none',
        }}>
          <span style={{ fontSize: '1.3rem' }}>🌿</span>
        </div>
        <div>
          <div style={{ color: phytech.plantStress ? stressColors[phytech.plantStress] : 'var(--subtext)', fontFamily: 'DM Mono, monospace', fontSize: '0.9rem', fontWeight: 600 }}>
            {phytech.plantStress ? phytech.plantStress.toUpperCase() : '—'}
          </div>
          <div style={{ color: 'var(--subtext)', fontSize: '0.7rem' }}>Plant stress status</div>
        </div>
        {phytech.dailyGrowthRate != null && (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ color: 'var(--grass)', fontFamily: 'DM Mono, monospace', fontSize: '0.9rem' }}>{phytech.dailyGrowthRate} cm/day</div>
            <div style={{ color: 'var(--subtext)', fontSize: '0.7rem' }}>Growth rate</div>
          </div>
        )}
      </div>
      <div className="grid-3">
        {[
          ['6" Moisture', phytech.soilMoisture?.depth6in != null ? phytech.soilMoisture.depth6in + '%' : '—'],
          ['12" Moisture', phytech.soilMoisture?.depth12in != null ? phytech.soilMoisture.depth12in + '%' : '—'],
          ['Soil Temp', phytech.soilTemp?.depth6in != null ? phytech.soilTemp.depth6in + '°F' : '—'],
        ].map(([l, v]) => (
          <div key={l} className="stat-box" style={{ padding: '0.6rem' }}>
            <div className="stat-val" style={{ fontSize: '0.9rem' }}>{v}</div>
            <div className="stat-lbl" style={{ fontSize: '0.55rem' }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InventoryCard({ plan, pass, position }) {
  if (!plan) return (
    <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>📊</div>
      <div style={{ color: 'var(--subtext)', fontSize: '0.8rem' }}>No active grazing plan</div>
    </div>
  )
  const daysIntoPass  = pass?.actual_start_date
    ? Math.floor((new Date() - new Date(pass.actual_start_date)) / 86400000)
    : 0
  const daysRemaining = pass?.days_per_rotation
    ? Math.max(0, pass.days_per_rotation - daysIntoPass)
    : null
  const pctComplete   = pass?.days_per_rotation
    ? Math.min(100, Math.round((daysIntoPass / pass.days_per_rotation) * 100))
    : 0

  return (
    <div className="card">
      <div className="card-sub mb-2">Forage Inventory</div>
      <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
        <div className="stat-box">
          <div className="stat-val">{daysIntoPass}</div>
          <div className="stat-lbl">Day in Pass</div>
        </div>
        <div className="stat-box">
          <div className="stat-val" style={{ color: daysRemaining < 2 ? 'var(--alert)' : 'var(--grass)' }}>
            {daysRemaining != null ? daysRemaining.toFixed(1) : '—'}
          </div>
          <div className="stat-lbl">Days Remaining</div>
        </div>
      </div>
      {pass?.days_per_rotation && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace', marginBottom: 4 }}>
            <span>Day {daysIntoPass}</span>
            <span>{pctComplete}% complete</span>
            <span>Day {Math.ceil(pass.days_per_rotation)}</span>
          </div>
          <div style={{ height: 8, background: 'var(--bark)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pctComplete}%`, background: 'linear-gradient(to right, var(--moss), var(--grass))', borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}
      {position != null && (
        <div style={{ fontSize: '0.72rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
          Current position: <span style={{ color: 'var(--cream)' }}>
            {typeof position === 'number' ? position.toFixed(1) : position}
            {pass?.type === 'pivot' ? '°' : ' ft'}
          </span>
        </div>
      )}
    </div>
  )
}

function ScheduleCard({ schedule, movesCompletedToday }) {
  if (!schedule || schedule.length === 0) return (
    <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>📅</div>
      <div style={{ color: 'var(--subtext)', fontSize: '0.8rem' }}>No schedule for today</div>
    </div>
  )
  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const nextMove = schedule.find(m => m.startMins > nowMins)
  const lastMove = schedule[schedule.length - 1]

  return (
    <div className="card">
      <div className="card-sub mb-2">Today's Schedule</div>
      {nextMove ? (
        <div style={{ background: 'rgba(15,26,10,0.8)', border: '1px solid var(--moss)', borderRadius: 8, padding: '0.75rem', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace', marginBottom: '0.25rem' }}>NEXT MOVE</div>
          <div style={{ fontSize: '1.4rem', color: 'var(--grass)', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{nextMove.startTime}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--subtext)', marginTop: '0.25rem' }}>Move #{nextMove.moveNum} · Run {nextMove.runTime} min · {nextMove.period?.label}</div>
        </div>
      ) : (
        <div style={{ color: 'var(--subtext)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>All moves complete for today ✓</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
        <span>Completed: <span style={{ color: 'var(--grass)' }}>{movesCompletedToday}</span> / {schedule.length}</span>
        <span>Last move: <span style={{ color: 'var(--cream)' }}>{lastMove.startTime}</span></span>
      </div>
    </div>
  )
}

function AIRecommendationCard({ rec }) {
  if (!rec) return (
    <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>🤖</div>
      <div style={{ color: 'var(--subtext)', fontSize: '0.8rem' }}>No recommendation yet today</div>
      <div style={{ color: 'var(--subtext)', fontSize: '0.72rem', marginTop: '0.25rem' }}>Upload photos in Rotations tab</div>
    </div>
  )
  const actionColors = {
    add_move: 'var(--grass)', hold: 'var(--sky)',
    remove_move: 'var(--gold)', flag_risk: 'var(--alert)',
  }
  const actionLabels = {
    add_move: '⬆ Add 1 Move', hold: '✓ Hold Plan',
    remove_move: '⬇ Remove 1 Move', flag_risk: '⚠ Flag Risk',
  }
  return (
    <div className="card" style={{ border: `1px solid ${actionColors[rec.recommended_action] || 'var(--bark2)'}22` }}>
      <div className="card-sub mb-2">AI Recommendation — Today</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{
          background: `${actionColors[rec.recommended_action] || 'var(--bark)'}22`,
          border: `1px solid ${actionColors[rec.recommended_action] || 'var(--bark2)'}`,
          borderRadius: 8, padding: '8px 14px',
          color: actionColors[rec.recommended_action] || 'var(--cream)',
          fontFamily: 'DM Mono, monospace', fontSize: '0.8rem', fontWeight: 600,
        }}>
          {actionLabels[rec.recommended_action] || rec.recommended_action}
        </div>
        {rec.tomorrow_moves && (
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.72rem', color: 'var(--subtext)' }}>
            Tomorrow: <span style={{ color: 'var(--grass)' }}>{rec.tomorrow_moves} moves</span>
          </div>
        )}
      </div>
      {rec.summary && <div style={{ fontSize: '0.8rem', color: 'var(--cream)', lineHeight: 1.6, marginBottom: '0.5rem' }}>{rec.summary}</div>}
      {rec.bloat_risk === 'high' && (
        <div style={{ background: 'rgba(224,64,48,0.15)', border: '1px solid var(--alert)', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', color: 'var(--alert)' }}>
          ⚠ Bloat risk elevated — delay first move or ensure hay access
        </div>
      )}
      {rec.user_decision === 'pending' && (
        <div style={{ display: 'flex', gap: 6, marginTop: '0.75rem' }}>
          <button className="btn btn-primary btn-sm">✓ Accept</button>
          <button className="btn btn-secondary btn-sm">📋 Note</button>
          <button className="btn btn-danger btn-sm">✕ Override</button>
        </div>
      )}
    </div>
  )
}

function CameraFeedCard({ observations }) {
  const preGraze  = observations?.find(o => o.photo_type === 'pre_graze')
  const postGraze = observations?.find(o => o.photo_type === 'post_graze')
  const recovery  = observations?.find(o => o.photo_type === 'recovery')

  if (!preGraze && !postGraze && !recovery) return (
    <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>📷</div>
      <div style={{ color: 'var(--subtext)', fontSize: '0.8rem' }}>No camera photos today</div>
    </div>
  )

  return (
    <div className="card">
      <div className="card-sub mb-2">Latest Camera Photos</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.5rem' }}>
        {[
          { obs: preGraze,  label: 'Pre-Graze', color: 'var(--sky)' },
          { obs: postGraze, label: 'Post-Graze', color: 'var(--gold)' },
          { obs: recovery,  label: 'Recovery',  color: 'var(--grass)' },
        ].map(({ obs, label, color }) => {
          const photos = obs?.photos ? (typeof obs.photos === 'string' ? JSON.parse(obs.photos) : obs.photos) : []
          const photo  = photos[0]
          const result = obs?.ai_result ? (typeof obs.ai_result === 'string' ? JSON.parse(obs.ai_result) : obs.ai_result) : null
          return (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.6rem', color, fontFamily: 'DM Mono, monospace', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
              {photo ? (
                <img src={photo.url} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 7, border: `1px solid ${color}44` }} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '1', background: 'var(--bark)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--bark2)' }}>
                  <span style={{ color: 'var(--subtext)', fontSize: '1.2rem' }}>📷</span>
                </div>
              )}
              {result && (
                <div style={{ fontSize: '0.62rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace', marginTop: 3 }}>
                  {result.height_inches ? `${result.height_inches}"` : ''}
                  {result.dm_lbs_per_acre ? ` · ${result.dm_lbs_per_acre} lb/ac` : ''}
                  {result.residual_height_inches ? `${result.residual_height_inches}" residual` : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DashboardTab() {
  const { data: machines }       = useMachines()
  const { data: plans }          = useGrazingPlans()
  const { data: fieldPositions } = useFieldPositions()
  const { settings }             = useSettings()
  const [selMachineId, setSelMachineId] = useState('')
  const [wxData, setWxData]             = useState(null)
  const [wxAlerts, setWxAlerts]         = useState([])
  const [wxLoading, setWxLoading]       = useState(false)
  const [phytechData, setPhytechData]   = useState(null)
  const [todaySchedule, setTodaySchedule] = useState([])

  const selMachine    = machines.find(m => m.id === selMachineId)
  const activePlan    = plans.find(p => p.machine_id === selMachineId && p.status === 'active')
  const fieldPos      = fieldPositions.find(p => p.machine_id === selMachineId)
  const { data: todayObs } = useObservations({ machine_id: selMachineId })

  // Auto-select first machine
  useEffect(() => {
    if (machines.length > 0 && !selMachineId) setSelMachineId(machines[0].id)
  }, [machines])

  // Fetch WeatherLink data when machine selected
  useEffect(() => {
    if (!selMachineId || !settings?.weatherlink?.connected) return
    const wl = settings.weatherlink
    if (!wl.api_key || !wl.api_secret || !wl.station_id) return
    setWxLoading(true)
    wlGetCurrent(wl.api_key, wl.api_secret, wl.station_id)
      .then(data => {
        setWxData(data)
        setWxAlerts(checkWeatherAlerts(data))
      })
      .catch(() => setWxData(null))
      .finally(() => setWxLoading(false))
  }, [selMachineId, settings])

  // Load today's schedule from field position
  useEffect(() => {
    if (!fieldPos?.plan_id) return
    // Load from saved schedules — simplified for now
    setTodaySchedule([])
  }, [fieldPos])

  const movesCompletedToday = fieldPos?.moves_completed_today || 0

  // Get today's AI recommendation
  const todayRec = null // Would come from daily_recommendations table

  // Get today's camera observations
  const todayDate = new Date().toISOString().slice(0, 10)
  const todayCameraObs = todayObs.filter(o => o.date === todayDate)

  return (
    <div>
      <div className="section-heading">Dashboard</div>
      <div className="section-desc">Live field status — weather, plant health, inventory and today's schedule.</div>

      {/* Field selector */}
      <div className="card" style={{ padding: '0.75rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.62rem', color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Field:</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {machines.map(m => {
              const isActive = plans.some(p => p.machine_id === m.id && p.status === 'active')
              return (
                <button key={m.id} onClick={() => setSelMachineId(m.id)} style={{
                  background: selMachineId === m.id ? 'var(--moss)' : 'var(--bark)',
                  border: `1px solid ${selMachineId === m.id ? 'var(--grass)' : 'var(--bark2)'}`,
                  borderRadius: 7, padding: '6px 12px', cursor: 'pointer',
                  color: selMachineId === m.id ? 'var(--white)' : 'var(--subtext)',
                  fontFamily: 'DM Mono, monospace', fontSize: '0.7rem', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  {m.type === 'pivot' ? '🔄' : '➡️'} {m.name}
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? 'var(--grass)' : 'var(--subtext)' }} />
                </button>
              )
            })}
          </div>
          {selMachine && (
            <div style={{ marginLeft: 'auto', fontFamily: 'DM Mono, monospace', fontSize: '0.65rem', color: 'var(--subtext)' }}>
              {fieldPos && <>Position: <span style={{ color: 'var(--grass)' }}>{Number(fieldPos.current_position).toFixed(1)}{selMachine.type === 'pivot' ? '°' : ' ft'}</span></>}
              {activePlan && <> · Plan: <span style={{ color: 'var(--grass)' }}>{activePlan.goal}</span></>}
            </div>
          )}
        </div>
      </div>

      {!selMachine ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🌾</div>
          <div style={{ color: 'var(--subtext)' }}>No machines set up yet. Add machines in the Machines tab.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {/* Weather */}
          <WeatherCard wx={wxData} alerts={wxAlerts} />

          {/* Phytech */}
          <PhytechCard phytech={phytechData} />

          {/* Inventory */}
          <InventoryCard
            plan={activePlan}
            pass={null}
            position={fieldPos?.current_position}
          />

          {/* Schedule */}
          <ScheduleCard
            schedule={todaySchedule}
            movesCompletedToday={movesCompletedToday}
          />

          {/* AI Recommendation */}
          <AIRecommendationCard rec={todayRec} />

          {/* Camera feed */}
          <CameraFeedCard observations={todayCameraObs} />
        </div>
      )}

      {machines.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🌾</div>
          <div style={{ color: 'var(--subtext)', marginBottom: '1rem' }}>Get started by adding your machines and herds.</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--subtext)' }}>
            Machines → Herds → Grazing Plan → Schedule
          </div>
        </div>
      )}
    </div>
  )
}
