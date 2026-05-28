import { useState, useEffect } from 'react'
import { useMachines, useHerds, useSchedules, useGrazingPlans } from '../hooks/useData'
import {
  calcPivotPass, calcLinearPass, calcTargetAcresPerDay,
  generateMoveSchedule, applyManualOverride,
  fetchSunTimes, getEndTowerRadius,
  toMins, fmt12,
} from '../lib/grazing'

const BG_MAP = {
  'Morning graze': '#0a1a08',
  'Midday loaf':   '#1a1800',
  'Transition':    '#1a1500',
  'Evening intake':'#0a1a08',
}

function residualHint(r) {
  if (!r) return null
  const v = parseFloat(r)
  if (v < 4)  return { color: 'var(--alert)',   text: '⬆ Add one move — residual below 4"' }
  if (v <= 5) return { color: 'var(--subtext)', text: '✓ Hold — residual 4–5"' }
  if (v <= 7) return { color: 'var(--gold)',    text: '⬇ Remove one move — residual 6–7"' }
  return            { color: 'var(--grass)',    text: '🌿 Topping target — residual 8–9"' }
}

function to24(str) {
  if (!str) return '00:00'
  const m = str.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return str.slice(0,5) || '00:00'
  let h = parseInt(m[1])
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2,'0')}:${m[2]}`
}

const emptyForm = {
  date: new Date().toISOString().slice(0,10),
  machine_id: '', herd_id: '', plan_id: '',
  spans_from: 1, spans_to: 1,
  ipm: 20, moves_per_day: 6,
  sunrise_time: '06:00', sunset_time: '20:30',
  goal: 'production', post_graze_residual: '',
  notes: '', observations: '',
}

export default function ScheduleTab() {
  const { data: machines } = useMachines()
  const { data: herds }    = useHerds()
  const { data: plans }    = useGrazingPlans()
  const { data: schedules, insert, update, remove, loading } = useSchedules()

  const [form, setForm]           = useState({ ...emptyForm })
  const [editing, setEditing]     = useState(null)
  const [saving, setSaving]       = useState(false)
  const [manualSched, setManualSched] = useState(null)
  const [activePlanInfo, setActivePlanInfo] = useState(null)

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setManualSched(null) }

  // Auto-fetch sun times
  useEffect(() => {
    if (!form.date) return
    const fetch = (lat, lng) => fetchSunTimes(form.date, lat, lng)
      .then(({ sunrise, sunset }) => setForm(f => ({ ...f, sunrise_time: sunrise, sunset_time: sunset })))
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(p => fetch(p.coords.latitude, p.coords.longitude), () => fetch(41.5, -99.5))
      : fetch(41.5, -99.5)
  }, [form.date])

  // Auto-load from active plan when machine selected
  useEffect(() => {
    if (!form.machine_id) return
    const activePlan = plans.find(p => p.machine_id === form.machine_id && p.status === 'active')
    if (activePlan) {
      setActivePlanInfo(activePlan)
      set('plan_id', activePlan.id)
      // Load herd from plan if not set
      if (!form.herd_id) setForm(f => ({ ...f, herd_id: activePlan.herd_id }))
      // Load first active pass info
      if (activePlan.passes_json) {
        try {
          const passes = JSON.parse(activePlan.passes_json)
          const firstPass = passes.find(p => p.status !== 'skipped')
          if (firstPass) {
            setForm(f => ({ ...f,
              spans_from: firstPass.span_from,
              spans_to: firstPass.span_to,
            }))
          }
        } catch {}
      }
    } else {
      setActivePlanInfo(null)
    }
  }, [form.machine_id, plans])

  const selMachine   = machines.find(m => m.id === form.machine_id)
  const selHerd      = herds.find(h => h.id === form.herd_id)
  const machineSpans = selMachine
    ? (typeof selMachine.spans === 'string' ? JSON.parse(selMachine.spans) : selMachine.spans) || []
    : []
  const isPivot = selMachine?.type === 'pivot'

  // Calculate pass
  let passCalc = null
  if (selMachine && selHerd) {
    const tgt = activePlanInfo?.target_acres_per_day || 4.0
    if (isPivot) {
      passCalc = calcPivotPass({
        spans: machineSpans, spanFrom: form.spans_from, spanTo: form.spans_to,
        desiredGrazingIpm: form.ipm, herd: selHerd, targetAcresPerDay: tgt,
      })
    } else {
      passCalc = calcLinearPass({
        spans: machineSpans, spanFrom: form.spans_from, spanTo: form.spans_to,
        ipm: form.ipm, herd: selHerd, targetAcresPerDay: tgt,
        runLengthFt: selMachine.run_length_ft,
      })
    }
    if (passCalc) {
      passCalc = { ...passCalc, movesPerDay: form.moves_per_day }
      passCalc.actualAcresPerDay = +(passCalc.acresPerMove * form.moves_per_day).toFixed(3)
    }
  }

  const runtime = passCalc?.runtimeMinutes || 30
  const schedule = passCalc
    ? generateMoveSchedule(form.sunrise_time, form.sunset_time, form.moves_per_day, runtime)
    : []
  const activeSchedule = manualSched || schedule

  function handleTimeEdit(idx, t24) {
    const base = manualSched || schedule
    setManualSched(applyManualOverride(base, idx, t24, runtime))
  }

  const hint = residualHint(form.post_graze_residual)

  async function save() {
    if (!form.machine_id || !form.herd_id) return
    setSaving(true)
    try {
      const schedToSave = manualSched || schedule
      const row = {
        ...form,
        move_schedule:       schedToSave ? JSON.stringify(schedToSave) : null,
        acres_per_move:      passCalc?.acresPerMove,
        acres_per_day:       passCalc?.actualAcresPerDay,
        alloc_stock_density: selHerd && passCalc ? Math.round((selHerd.total_lw || 0) / passCalc.acresPerMove) : null,
        degrees_per_move:    passCalc?.degreesPerMove || null,
        end_tower_travel_in: passCalc?.endTowerTravelIn || null,
        tl_ipm_setting:      passCalc?.tlIpmSetting || form.ipm,
        runtime_minutes:     passCalc?.runtimeMinutes,
        moves_per_day:       form.moves_per_day,
        spans_grazed:        `${form.spans_from}-${form.spans_to}`,
      }
      if (editing) await update(editing, row)
      else await insert(row)
      setForm({ ...emptyForm }); setEditing(null); setManualSched(null)
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  function editRow(s) {
    const parts = (s.spans_grazed || '1-1').split('-').map(Number)
    setForm({
      date: s.date, machine_id: s.machine_id, herd_id: s.herd_id,
      plan_id: s.plan_id || '',
      spans_from: parts[0] || 1, spans_to: parts[1] || parts[0] || 1,
      ipm: s.ipm, moves_per_day: s.moves_per_day || 6,
      sunrise_time: s.sunrise_time, sunset_time: s.sunset_time,
      goal: s.goal, post_graze_residual: s.post_graze_residual || '',
      notes: s.notes || '', observations: s.observations || '',
    })
    if (s.move_schedule) {
      try {
        const p = typeof s.move_schedule === 'string' ? JSON.parse(s.move_schedule) : s.move_schedule
        if (p?.some(m => m.manual)) setManualSched(p)
      } catch {}
    }
    setEditing(s.id)
    window.scrollTo(0,0)
  }

  if (loading) return <div className="text-muted text-sm" style={{ padding: '2rem' }}>Loading…</div>

  return (
    <div>
      <div className="section-heading">Daily Schedule</div>
      <div className="section-desc">Behavior-driven move schedules. Select a machine with an active plan to auto-fill settings.</div>

      <div className="card">
        <div className="card-title mb-2">{editing ? 'Edit Schedule' : 'New Schedule'}</div>

        {/* Active plan banner */}
        {activePlanInfo && (
          <div style={{ background: 'rgba(58,122,40,0.15)', border: '1px solid var(--moss)', borderRadius: 8, padding: '0.6rem 0.9rem', marginBottom: '0.75rem', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--grass)', fontFamily: 'DM Mono, monospace' }}>● Active Plan: </span>
            <span style={{ color: 'var(--cream)' }}>{activePlanInfo.name || 'Unnamed Plan'}</span>
            <span style={{ color: 'var(--subtext)', marginLeft: 8 }}>
              {activePlanInfo.target_acres_per_day?.toFixed(2)} ac/day target · {activePlanInfo.total_cycle_days}d cycle
            </span>
          </div>
        )}

        {/* Row 1 */}
        <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">Date</label>
            <input className="input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Machine</label>
            <select className="select" value={form.machine_id} onChange={e => {
              const m = machines.find(x => x.id === e.target.value)
              setForm(f => ({ ...f, machine_id: e.target.value, ipm: m?.ipm || f.ipm }))
              setManualSched(null)
            }}>
              <option value="">Select machine…</option>
              {machines.map(m => {
                const hasActive = plans.some(p => p.machine_id === m.id && p.status === 'active')
                return <option key={m.id} value={m.id}>{m.name} ({m.type}){hasActive ? ' ●' : ''}</option>
              })}
            </select>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">Herd</label>
            <select className="select" value={form.herd_id} onChange={e => set('herd_id', e.target.value)}>
              <option value="">Select herd…</option>
              {herds.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Grazing Goal</label>
            <select className="select" value={form.goal} onChange={e => set('goal', e.target.value)}>
              <option value="production">Production Grazing</option>
              <option value="topping">Topping</option>
              <option value="stockpile">Stockpile</option>
              <option value="recovery">Recovery</option>
            </select>
          </div>
        </div>

        {/* Span selector */}
        {selMachine && machineSpans.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div className="label" style={{ marginBottom: '0.4rem' }}>Active Spans</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: '0.4rem' }}>
              {machineSpans.map(s => {
                const active = s.number >= form.spans_from && s.number <= form.spans_to
                return (
                  <button key={s.number} onClick={() => {
                    let newFrom = form.spans_from, newTo = form.spans_to
                    if (s.number < newFrom) newFrom = s.number
                    else if (s.number > newTo) newTo = s.number
                    else if (s.number === newFrom && newFrom < newTo) newFrom = s.number + 1
                    else if (s.number === newTo && newFrom < newTo) newTo = s.number - 1
                    setForm(f => ({ ...f, spans_from: newFrom, spans_to: newTo }))
                    setManualSched(null)
                  }} style={{
                    background: active ? 'var(--moss)' : 'var(--bark2)',
                    border: `1px solid ${active ? 'var(--grass)' : '#3a5520'}`,
                    borderRadius: 6, padding: '5px 9px', cursor: 'pointer',
                    color: active ? 'var(--white)' : 'var(--subtext)',
                    fontFamily: 'DM Mono, monospace', fontSize: '0.7rem', transition: 'all 0.12s',
                  }}>
                    S{s.number}<div style={{ fontSize: '0.53rem' }}>{s.length_ft}ft</div>
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
              Active: Spans {form.spans_from}–{form.spans_to}
              {isPivot && ` | Outer radius: ${machineSpans.slice(0, form.spans_to).reduce((s,x) => s + x.length_ft, 0)} ft`}
              {!isPivot && ` | Width: ${machineSpans.slice(form.spans_from-1, form.spans_to).reduce((s,x) => s + x.length_ft, 0)} ft`}
            </div>
          </div>
        )}

        {/* Row 2 */}
        <div className="grid-4" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">Grazing IPM</label>
            <input className="input" type="number" step="1" value={form.ipm} onChange={e => set('ipm', +e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Moves / Day</label>
            <input className="input" type="number" min={1} value={form.moves_per_day} onChange={e => set('moves_per_day', +e.target.value)} />
          </div>
          <div className="field">
            <label className="label">🌅 Sunrise</label>
            <input className="input" type="time" value={form.sunrise_time} onChange={e => set('sunrise_time', e.target.value)} />
          </div>
          <div className="field">
            <label className="label">🌇 Sunset</label>
            <input className="input" type="time" value={form.sunset_time} onChange={e => set('sunset_time', e.target.value)} />
          </div>
        </div>

        {/* Residual */}
        <div className="field" style={{ marginBottom: '0.75rem', maxWidth: 200 }}>
          <label className="label">Post-Graze Residual (in)</label>
          <input className="input" type="number" step="0.5" placeholder="e.g. 4.5"
            value={form.post_graze_residual} onChange={e => set('post_graze_residual', e.target.value)} />
        </div>

        {hint && (
          <div style={{ padding: '8px 12px', borderRadius: 7, background: 'var(--bark)', border: `1px solid ${hint.color}`, color: hint.color, fontSize: '0.82rem', marginBottom: '0.75rem' }}>
            {hint.text}
          </div>
        )}

        {/* TL ipm callout */}
        {isPivot && passCalc && passCalc.scaleFactor > 1.001 && (
          <div style={{ background: 'rgba(240,192,64,0.1)', border: '1px solid rgba(240,192,64,0.35)', borderRadius: 8, padding: '0.6rem 0.9rem', marginBottom: '0.75rem', fontFamily: 'DM Mono, monospace', fontSize: '0.75rem', color: 'var(--gold)' }}>
            ⚙ Set TL computer to <strong>{passCalc.tlIpmSetting} ipm</strong> for spans {form.spans_from}–{form.spans_to}.
            End tower travels {passCalc.endTowerTravelIn} in ({(passCalc.endTowerTravelIn/12).toFixed(1)} ft) per move.
          </div>
        )}

        {/* Notes */}
        <div className="grid-2" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label className="label">Notes</label>
            <textarea className="textarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Field conditions…" />
          </div>
          <div className="field">
            <label className="label">Observations</label>
            <textarea className="textarea" rows={2} value={form.observations} onChange={e => set('observations', e.target.value)} placeholder="Cattle behavior…" />
          </div>
        </div>

        {/* Calc stats */}
        {passCalc && selHerd && (
          <>
            <hr className="divider" />
            <div className="card-sub mb-2">Calculated Summary</div>
            <div className="grid-4 mb-2">
              {(isPivot ? [
                ['Ac / Move',       passCalc.acresPerMove],
                ['Ac / Day',        passCalc.actualAcresPerDay],
                ['Alloc lb/ac',     selHerd.total_lw ? Math.round(selHerd.total_lw / passCalc.acresPerMove).toLocaleString() : '—'],
                ['Runtime / Move',  passCalc.runtimeMinutes + ' min'],
                ['TL IPM',          passCalc.tlIpmSetting + ' ipm'],
                ['° / Move',        passCalc.degreesPerMove?.toFixed(3) + '°'],
                ['End Tower',       passCalc.endTowerTravelIn + ' in'],
                ['Days / Rotation', passCalc.daysPerRotation],
              ] : [
                ['Width',           passCalc.grazingWidth + ' ft'],
                ['Ac / Move',       passCalc.acresPerMove],
                ['Ac / Day',        passCalc.actualAcresPerDay],
                ['Alloc lb/ac',     selHerd.total_lw ? Math.round(selHerd.total_lw / passCalc.acresPerMove).toLocaleString() : '—'],
                ['Runtime / Move',  passCalc.runtimeMinutes + ' min'],
                ['Daily Travel',    passCalc.dailyTravelFt + ' ft'],
                ['Days / Pass',     passCalc.daysPerPass],
                ['IPM',             passCalc.tlIpmSetting],
              ]).map(([l, v]) => (
                <div key={l} className="stat-box">
                  <div className="stat-val" style={{ fontSize: '0.9rem' }}>{v}</div>
                  <div className="stat-lbl" style={{ fontSize: '0.54rem' }}>{l}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Move schedule */}
        {activeSchedule.length > 0 && (
          <>
            <hr className="divider" />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <div className="card-sub">Move Schedule — Click start time to edit</div>
              <div className="flex gap-1">
                {manualSched && <span style={{ fontSize: '0.6rem', color: 'var(--gold)', fontFamily: 'DM Mono, monospace' }}>✎ Manual overrides</span>}
                {manualSched && <button className="btn btn-secondary btn-sm" onClick={() => setManualSched(null)}>↺ Reset</button>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: '0.6rem' }}>
              {[
                { label: 'Morning graze',  color: 'var(--sky)',     bg: '#0a1a08' },
                { label: 'Midday loaf',    color: 'var(--gold)',    bg: '#1a1800' },
                { label: 'Transition',     color: 'var(--harvest)', bg: '#1a1500' },
                { label: 'Evening intake', color: 'var(--grass)',   bg: '#0a1a08' },
              ].map(b => (
                <span key={b.label} style={{ background: b.bg, color: b.color, padding: '2px 8px', borderRadius: 4, fontSize: '0.6rem', fontFamily: 'DM Mono, monospace', border: `1px solid ${b.color}33` }}>{b.label}</span>
              ))}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    {['Move','Start ✎','Stop','Run','Rest','Cycle','Period'].map(h => (
                      <th key={h} style={{ background: 'var(--bark2)', color: 'var(--harvest)', padding: '6px 8px', textAlign: 'left', fontFamily: 'DM Mono, monospace', fontSize: '0.56rem', letterSpacing: '0.07em', textTransform: 'uppercase', borderBottom: '1px solid #3a5520' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSchedule.map((mv, idx) => {
                    const isManual = mv.manual === true
                    const isLong   = mv.restToNext > 120
                    const bg       = BG_MAP[mv.period?.label] || 'transparent'
                    return (
                      <tr key={mv.moveNum} style={{ background: bg }}>
                        <td style={{ padding: '6px 8px', color: mv.period?.color, fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>
                          #{mv.moveNum}{isManual && <span style={{ marginLeft: 3, fontSize: '0.56rem', color: 'var(--gold)' }}>✎</span>}
                        </td>
                        <td>
                          <input type="time" value={to24(mv.startTime)}
                            onChange={e => handleTimeEdit(idx, e.target.value)}
                            style={{ background: isManual ? '#2a1e00' : 'transparent', border: isManual ? '1px solid var(--gold)' : '1px solid transparent', borderRadius: 4, color: isManual ? 'var(--gold)' : 'var(--cream)', fontFamily: 'DM Mono, monospace', fontSize: '0.75rem', padding: '2px 4px', cursor: 'pointer', width: 95 }} />
                        </td>
                        <td style={{ padding: '6px 8px', fontFamily: 'DM Mono, monospace', color: 'var(--subtext)' }}>{mv.stopTime}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--subtext)' }}>{mv.runTime}m</td>
                        <td style={{ padding: '6px 8px', color: isLong ? 'var(--gold)' : 'var(--subtext)', fontWeight: isLong ? 600 : 400 }}>
                          {mv.restToNext != null ? `${mv.restToNext}m` : '—'}
                          {isLong && <span style={{ marginLeft: 3, fontSize: '0.55rem', color: 'var(--gold)' }}>loaf</span>}
                        </td>
                        <td style={{ padding: '6px 8px', fontFamily: 'DM Mono, monospace', color: 'var(--grass)' }}>{mv.cycleTime}m</td>
                        <td style={{ padding: '6px 8px', fontSize: '0.66rem', color: mv.period?.color }}>{mv.period?.label}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <hr className="divider" />
        <div className="flex gap-1">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <><span className="spinner" /> Saving…</> : editing ? '✓ Update' : '+ Save Schedule'}
          </button>
          {editing && <button className="btn btn-secondary" onClick={() => { setForm({ ...emptyForm }); setEditing(null); setManualSched(null) }}>Cancel</button>}
        </div>
      </div>

      {/* Saved schedules */}
      {schedules.length > 0 && (
        <div className="card">
          <div className="card-title mb-2">Saved Schedules</div>
          {schedules.map(s => {
            const m = machines.find(x => x.id === s.machine_id)
            const h = herds.find(x => x.id === s.herd_id)
            return (
              <div className="list-item" key={s.id} onClick={() => editRow(s)}>
                <div>
                  <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.25rem' }}>
                    <span className="mono text-sm text-muted">{s.date}</span>
                    <span className="badge">{m?.name || '?'}</span>
                    <span className="badge badge-amber">{h?.name || '?'}</span>
                    {s.tl_ipm_setting && s.tl_ipm_setting !== s.ipm && (
                      <span className="badge" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>TL: {s.tl_ipm_setting} ipm</span>
                    )}
                  </div>
                  <div className="text-sm text-muted">
                    Spans {s.spans_grazed} · {s.acres_per_day} ac/day · {s.moves_per_day} moves · {s.runtime_minutes} min/move
                  </div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); remove(s.id) }}>✕</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
