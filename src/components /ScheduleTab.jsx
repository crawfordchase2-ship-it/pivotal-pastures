import { useState, useEffect } from 'react'
import { useMachines, useHerds, useSchedules } from '../hooks/useData'
import { calcSchedule, fetchSunTimes } from '../lib/grazing'

const empty = {
  date: new Date().toISOString().slice(0, 10),
  machine_id: '', herd_id: '', spans_grazed: 1,
  ipm: 25, moves_per_rotation: 6, move_dist: 50,
  sunrise_time: '06:00', sunset_time: '20:30',
  goal: 'production', post_graze_residual: '',
  notes: '', observations: '',
}

const ACTION_COLORS = {
  add_move:      'var(--sage)',
  hold:          'var(--sky)',
  remove_move:   'var(--amber)',
  adjust_timing: 'var(--straw)',
  flag_risk:     'var(--rust)',
}

const BG_MAP = {
  'Morning graze': '#0a1a2a',
  'Midday loaf':   '#2a1a00',
  'Transition':    '#2a2010',
  'Evening intake':'#0a2010',
}

function residualHint(r) {
  if (!r) return null
  const v = parseFloat(r)
  if (v < 4)  return { color: 'var(--rust)',   text: '⬆ Add one move — residual below 4"' }
  if (v <= 5) return { color: 'var(--straw)',  text: '✓ Hold — residual 4–5"' }
  if (v <= 7) return { color: 'var(--amber)',  text: '⬇ Remove one move — residual 6–7"' }
  return            { color: 'var(--sage)',    text: '🌿 Topping target — residual 8–9"' }
}

export default function ScheduleTab() {
  const { data: machines } = useMachines()
  const { data: herds }    = useHerds()
  const { data: schedules, insert, update, remove, loading } = useSchedules()
  const [form, setForm] = useState({ ...empty })
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Auto-fetch sun times on date change
  useEffect(() => {
    if (!form.date) return
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => fetchSunTimes(form.date, pos.coords.latitude, pos.coords.longitude)
          .then(({ sunrise, sunset }) => setForm(f => ({ ...f, sunrise_time: sunrise, sunset_time: sunset }))),
        () => fetchSunTimes(form.date)
          .then(({ sunrise, sunset }) => setForm(f => ({ ...f, sunrise_time: sunrise, sunset_time: sunset })))
      )
    } else {
      fetchSunTimes(form.date)
        .then(({ sunrise, sunset }) => setForm(f => ({ ...f, sunrise_time: sunrise, sunset_time: sunset })))
    }
  }, [form.date])

  const selMachine = machines.find(m => m.id === form.machine_id)
  const selHerd    = herds.find(h => h.id === form.herd_id)
  const calc       = selMachine && selHerd ? calcSchedule({
    machine: selMachine, herd: selHerd,
    spansGrazed: form.spans_grazed, ipm: form.ipm,
    movesPerRotation: form.moves_per_rotation, moveDist: form.move_dist,
    sunriseTime: form.sunrise_time, sunsetTime: form.sunset_time,
  }) : null

  const hint = residualHint(form.post_graze_residual)

  async function save() {
    if (!form.machine_id || !form.herd_id) return
    setSaving(true)
    try {
      const row = {
        ...form,
        move_schedule:       calc?.moveSchedule ? JSON.stringify(calc.moveSchedule) : null,
        acres_per_move:      calc?.acresPerMove,
        acres_per_day:       calc?.acresPerDay,
        alloc_stock_density: calc?.allocStockDensity,
        mins_per_move:       calc?.minsPerMove,
        hrs_per_rotation:    calc?.hrsPerRotation,
        days_per_pass:       calc?.daysPerPass,
        num_passes:          calc?.numPasses,
        full_rotation_days:  calc?.fullRotationDays,
      }
      if (editing) await update(editing, row)
      else await insert(row)
      setForm({ ...empty })
      setEditing(null)
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  function editRow(s) {
    setForm({
      date: s.date, machine_id: s.machine_id, herd_id: s.herd_id,
      spans_grazed: s.spans_grazed, ipm: s.ipm, moves_per_rotation: s.moves_per_rotation,
      move_dist: s.move_dist, sunrise_time: s.sunrise_time, sunset_time: s.sunset_time,
      goal: s.goal, post_graze_residual: s.post_graze_residual || '',
      notes: s.notes || '', observations: s.observations || '',
    })
    setEditing(s.id)
  }

  if (loading) return <div className="text-muted text-sm" style={{ padding: '2rem' }}>Loading…</div>

  return (
    <div>
      <div className="section-heading">Daily Grazing Schedule</div>
      <div className="section-desc">Build behavior-driven move schedules anchored to sunrise and sunset.</div>

      <div className="card">
        <div className="card-title mb-2">{editing ? 'Edit Schedule' : 'New Schedule'}</div>

        {/* Row 1 */}
        <div className="grid-3" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">Date</label>
            <input className="input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Machine</label>
            <select className="select" value={form.machine_id} onChange={e => {
              set('machine_id', e.target.value)
              const m = machines.find(x => x.id === e.target.value)
              if (m) set('move_dist', m.move_dist)
            }}>
              <option value="">Select machine…</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Herd</label>
            <select className="select" value={form.herd_id} onChange={e => set('herd_id', e.target.value)}>
              <option value="">Select herd…</option>
              {herds.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2 */}
        <div className="grid-4" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">Spans Grazed</label>
            <input className="input" type="number" min={1} max={selMachine?.spans || 20} value={form.spans_grazed} onChange={e => set('spans_grazed', +e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Inches / Min</label>
            <input className="input" type="number" step="1" value={form.ipm} onChange={e => set('ipm', +e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Moves / Rotation</label>
            <input className="input" type="number" min={1} value={form.moves_per_rotation} onChange={e => set('moves_per_rotation', +e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Move Dist (ft)</label>
            <input className="input" type="number" value={form.move_dist} onChange={e => set('move_dist', +e.target.value)} />
          </div>
        </div>

        {/* Row 3 — Sun times */}
        <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">🌅 Sunrise (first move)</label>
            <input className="input" type="time" value={form.sunrise_time} onChange={e => set('sunrise_time', e.target.value)} />
          </div>
          <div className="field">
            <label className="label">🌇 Sunset (last move)</label>
            <input className="input" type="time" value={form.sunset_time} onChange={e => set('sunset_time', e.target.value)} />
          </div>
        </div>

        {/* Row 4 — Goal + Residual */}
        <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">Grazing Goal</label>
            <select className="select" value={form.goal} onChange={e => set('goal', e.target.value)}>
              <option value="production">Production Grazing</option>
              <option value="topping">Topping</option>
              <option value="stockpile">Stockpile</option>
              <option value="recovery">Recovery</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Post-Graze Residual (in)</label>
            <input className="input" type="number" step="0.5" placeholder="e.g. 4.5" value={form.post_graze_residual} onChange={e => set('post_graze_residual', e.target.value)} />
          </div>
        </div>

        {hint && (
          <div style={{ padding: '9px 13px', borderRadius: 7, background: 'var(--bark)', border: `1px solid ${hint.color}`, color: hint.color, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            {hint.text}
          </div>
        )}

        {/* Row 5 — Notes */}
        <div className="grid-2" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label className="label">Notes</label>
            <textarea className="textarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Field conditions…" />
          </div>
          <div className="field">
            <label className="label">Observations</label>
            <textarea className="textarea" rows={2} value={form.observations} onChange={e => set('observations', e.target.value)} placeholder="Cattle behavior, grass quality…" />
          </div>
        </div>

        {/* Live calc stats */}
        {calc && (
          <>
            <hr className="divider" />
            <div className="card-sub mb-2">Calculated Summary</div>
            <div className="grid-4 mb-2">
              {[
                ['Acres / Move', calc.acresPerMove],
                ['Acres / Day',  calc.acresPerDay],
                ['Alloc lb/ac',  calc.allocStockDensity?.toLocaleString()],
                ['Min / Move',   calc.minsPerMove],
              ].map(([l, v]) => (
                <div key={l} className="stat-box">
                  <div className="stat-val">{v}</div>
                  <div className="stat-lbl">{l}</div>
                </div>
              ))}
            </div>
            <div className="grid-4 mb-2">
              {[
                ['Hrs / Rotation',   calc.hrsPerRotation],
                ['Days / Pass',      calc.daysPerPass],
                ['Passes',           calc.numPasses],
                ['Full Rotation',    calc.fullRotationDays + 'd'],
              ].map(([l, v]) => (
                <div key={l} className="stat-box">
                  <div className="stat-val">{v}</div>
                  <div className="stat-lbl">{l}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Move schedule table */}
        {calc?.moveSchedule?.length > 0 && (
          <>
            <hr className="divider" />
            <div className="card-sub mb-2">Move Schedule — Behavior-Driven Spacing</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {[
                { label: 'Morning graze',  color: 'var(--sky)',    bg: '#0a1a2a' },
                { label: 'Midday loaf',    color: 'var(--amber)',  bg: '#2a1a00' },
                { label: 'Transition',     color: 'var(--straw)',  bg: '#2a2010' },
                { label: 'Evening intake', color: 'var(--meadow)', bg: '#0a2010' },
              ].map(b => (
                <span key={b.label} style={{ background: b.bg, color: b.color, padding: '3px 9px', borderRadius: 4, fontSize: '0.65rem', fontFamily: 'DM Mono, monospace', border: `1px solid ${b.color}44` }}>{b.label}</span>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="schedule-table">
                <thead>
                  <tr>
                    {['Move #', 'Start', 'Stop', 'Run', 'Rest', 'Cycle', 'Period'].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calc.moveSchedule.map(mv => (
                    <tr key={mv.moveNum} style={{ background: BG_MAP[mv.period?.label] || 'transparent' }}>
                      <td style={{ color: mv.period?.color, fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>#{mv.moveNum}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', color: 'var(--cream)' }}>{mv.startTime}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', color: 'var(--cream)' }}>{mv.stopTime}</td>
                      <td style={{ color: 'var(--straw)' }}>{mv.runTime} min</td>
                      <td style={{ color: mv.restToNext > 90 ? 'var(--amber)' : 'var(--straw)', fontWeight: mv.restToNext > 90 ? 600 : 400 }}>
                        {mv.restToNext != null ? `${mv.restToNext} min` : '—'}
                        {mv.restToNext > 90 && <span style={{ marginLeft: 5, fontSize: '0.6rem', color: 'var(--amber)' }}>loaf</span>}
                      </td>
                      <td style={{ fontFamily: 'DM Mono, monospace', color: 'var(--sage)' }}>{mv.cycleTime} min</td>
                      <td style={{ fontSize: '0.68rem', color: mv.period?.color }}>{mv.period?.label}</td>
                    </tr>
                  ))}
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
          {editing && <button className="btn btn-secondary" onClick={() => { setForm({ ...empty }); setEditing(null) }}>Cancel</button>}
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
                  <div className="flex gap-1" style={{ alignItems: 'center' }}>
                    <span className="mono text-sm text-muted">{s.date}</span>
                    <span className="badge">{m?.name || '?'}</span>
                    <span className="badge badge-amber">{h?.name || '?'}</span>
                  </div>
                  <div className="text-sm text-muted mt-1">
                    {s.acres_per_day} ac/day · {s.alloc_stock_density?.toLocaleString()} lb/ac · {s.moves_per_rotation} moves · {s.full_rotation_days}d rotation
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
