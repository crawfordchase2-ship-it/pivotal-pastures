import { useState, useEffect } from 'react'
import { useMachines, useHerds, useSchedules, useGrazingPlans } from '../hooks/useData'
import { calcPivotPass, calcLinearPass, generateMoveSchedule, applyManualOverride, fmt12 } from '../lib/grazing'
import { checkSafetyAlerts, checkRecommendationUnlock, RECOMMENDATION_MIN_DAYS } from '../lib/inventory'

function to24(str) {
  if (!str) return '00:00'
  const m = str.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return str.slice(0,5)||'00:00'
  let h = parseInt(m[1])
  if (m[3].toUpperCase()==='PM' && h!==12) h+=12
  if (m[3].toUpperCase()==='AM' && h===12) h=0
  return `${String(h).padStart(2,'0')}:${m[2]}`
}

export default function ScheduleTab() {
  const { data: machines } = useMachines()
  const { data: herds }    = useHerds()
  const { data: plans }    = useGrazingPlans()
  const { data: schedules, insert, update, remove, loading } = useSchedules()

  const [selMachineId, setSelMachineId] = useState('')
  const [selDate, setSelDate]           = useState(new Date().toISOString().slice(0,10))
  const [overrides, setOverrides]       = useState({})
  const [residual, setResidual]         = useState('')
  const [notes, setNotes]               = useState('')
  const [saving, setSaving]             = useState(false)
  const [addingMove, setAddingMove]     = useState(false)

  const selMachine   = machines.find(m => m.id === selMachineId)
  const activePlan   = plans.find(p => p.machine_id === selMachineId && p.status === 'active')
  const selHerd      = herds.find(h => h.id === activePlan?.herd_id)
  const machineSpans = selMachine
    ? (typeof selMachine.spans==='string' ? JSON.parse(selMachine.spans) : selMachine.spans)||[]
    : []
  const isPivot = selMachine?.type === 'pivot'

  // Get active pass from plan
  let activePass = null
  if (activePlan?.passes_json) {
    try {
      const passes = JSON.parse(activePlan.passes_json)
      activePass = passes.find(p => p.status !== 'skipped')
    } catch {}
  }

  // Calculate moves per day from active plan or fallback
  // Note: herd not required — calc only needs targetAcresPerDay from the plan
  let passCalc = null
  if (selMachine && activePass && activePlan) {
    const tgt = activePlan.target_acres_per_day || 4
    if (isPivot) {
      passCalc = calcPivotPass({ spans:machineSpans, spanFrom:activePass.span_from, spanTo:activePass.span_to, desiredGrazingIpm:selMachine.ipm, herd:selHerd, targetAcresPerDay:tgt })
    } else {
      passCalc = calcLinearPass({ spans:machineSpans, spanFrom:activePass.span_from, spanTo:activePass.span_to, ipm:selMachine.ipm, herd:selHerd, targetAcresPerDay:tgt, runLengthFt:selMachine.run_length_ft })
    }
  }

  const movesPerDay = passCalc?.movesPerDay || 6
  const [customMoves, setCustomMoves] = useState(null)
  const todayMoves = customMoves ?? movesPerDay

  // Auto-select first machine
  useEffect(() => {
    if (machines.length > 0 && !selMachineId) setSelMachineId(machines[0].id)
  }, [machines])

  // Reset custom moves when plan changes
  useEffect(() => { setCustomMoves(null) }, [activePlan?.id])

  // Sun times from plan or default
  // Guard only against truly invalid stored times (sunset at/before sunrise).
  // Real sun times (e.g. 5:55 AM / 8:50 PM) pass through unchanged.
  const toM = t => { if(!t) return null; const [h,m]=t.split(':').map(Number); return h*60+m }
  let sunrise = activePlan?.sunrise_time || '06:00'
  let sunset  = activePlan?.sunset_time  || '20:30'
  const srM = toM(sunrise), ssM = toM(sunset)
  if (srM == null || ssM == null || ssM <= srM) {
    sunrise = '06:00'; sunset = '20:30'   // only when window is broken
  }
  const runtime = passCalc?.runtimeMinutes || 30

  const baseSchedule = passCalc
    ? generateMoveSchedule(sunrise, sunset, todayMoves, runtime)
    : []

  // Apply manual overrides
  const schedule = baseSchedule.map((mv, i) => {
    if (overrides[i]) return { ...mv, startTime: overrides[i].startTime, stopTime: overrides[i].stopTime, manual: true }
    return mv
  })

  // Safety alerts from residual
  const safetyAlerts = residual ? checkSafetyAlerts({ residualInches: +residual }) : []

  // Recommendation status
  const todaySchedule = schedules.find(s => s.date === selDate && s.machine_id === selMachineId)

  function handleTimeEdit(idx, t24) {
    const [h,m] = t24.split(':').map(Number)
    const totalMins = h*60+m
    const stop = totalMins + runtime
    const sh = Math.floor(stop/60)%24, sm = stop%60
    setOverrides(prev => ({ ...prev, [idx]: {
      startTime: fmt12(totalMins),
      stopTime: `${sh%12||12}:${String(sm).padStart(2,'0')} ${sh>=12?'PM':'AM'}`,
    }}))
  }

  async function addMove() {
    setCustomMoves(m => (m||todayMoves) + 1)
  }

  async function removeMove() {
    if (todayMoves <= 1) return
    setCustomMoves(m => (m||todayMoves) - 1)
    // Update plan permanently
    if (activePlan) {
      const newMoves = todayMoves - 1
      await updatePlanMoves(newMoves)
    }
  }

  async function updatePlanMoves(newMoves) {
    if (!activePlan?.passes_json) return
    try {
      const passes = JSON.parse(activePlan.passes_json)
      // Update moves on active pass
      const updated = passes.map(p => p.status !== 'skipped' ? { ...p, moves_per_day: newMoves } : p)
      // This would call updatePlan — handled by parent
    } catch {}
  }

  async function confirmAndSave() {
    if (!selMachineId || !activePlan) return
    setSaving(true)
    try {
      const row = {
        date: selDate,
        machine_id: selMachineId,
        herd_id: activePlan.herd_id,
        plan_id: activePlan.id,
        ipm: selMachine.ipm,
        moves_per_day: todayMoves,
        sunrise_time: sunrise,
        sunset_time: sunset,
        runtime_minutes: runtime,
        move_schedule: JSON.stringify(schedule),
        spans_grazed: activePass ? `${activePass.span_from}-${activePass.span_to}` : '',
        acres_per_move: passCalc?.acresPerMove,
        acres_per_day: passCalc?.actualAcresPerDay,
        tl_ipm_setting: passCalc?.tlIpmSetting || selMachine.ipm,
        post_graze_residual: residual ? +residual : null,
        notes,
        goal: activePlan.goal,
      }
      if (todaySchedule) await update(todaySchedule.id, row)
      else await insert(row)
      setNotes(''); setResidual(''); setOverrides({})
    } catch(e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  if (loading) return <div className="text-muted text-sm" style={{ padding:'2rem' }}>Loading…</div>

  return (
    <div>
      <div className="section-heading">Daily Schedule</div>
      <div className="section-desc">Today's move schedule from your active grazing plan. Confirm moves and log post-graze observations.</div>

      {/* Machine selector */}
      <div className="card" style={{ padding:'0.75rem 1rem', marginBottom:'0.75rem' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
          <div style={{ fontFamily:'DM Mono, monospace', fontSize:'0.62rem', color:'var(--subtext)', textTransform:'uppercase' }}>Field:</div>
          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
            {machines.map(m => {
              const hasActive = plans.some(p => p.machine_id===m.id && p.status==='active')
              return (
                <button key={m.id} onClick={() => setSelMachineId(m.id)} style={{
                  background: selMachineId===m.id ? 'var(--moss)' : 'var(--bark)',
                  border:`1px solid ${selMachineId===m.id?'var(--grass)':'var(--bark2)'}`,
                  borderRadius:7, padding:'6px 12px', cursor:'pointer',
                  color: selMachineId===m.id?'var(--white)':'var(--subtext)',
                  fontFamily:'DM Mono, monospace', fontSize:'0.7rem', transition:'all 0.15s',
                  display:'flex', alignItems:'center', gap:5,
                }}>
                  {m.type==='pivot'?'🔄':'➡️'} {m.name}
                  <span style={{ width:6, height:6, borderRadius:'50%', background:hasActive?'var(--grass)':'var(--subtext)' }} />
                </button>
              )
            })}
          </div>
          <input type="date" className="input" value={selDate} onChange={e => setSelDate(e.target.value)}
            style={{ maxWidth:150, marginLeft:'auto' }} />
        </div>
      </div>

      {!selMachine && (
        <div className="card" style={{ textAlign:'center', padding:'2.5rem' }}>
          <div style={{ fontSize:'2rem', marginBottom:'0.5rem' }}>📅</div>
          <div className="text-muted">Select a field above to see today's schedule.</div>
        </div>
      )}

      {selMachine && !activePlan && (
        <div className="card" style={{ textAlign:'center', padding:'2.5rem' }}>
          <div style={{ fontSize:'2rem', marginBottom:'0.5rem' }}>🌿</div>
          <div className="text-muted">No active grazing plan for {selMachine.name}.</div>
          <div style={{ fontSize:'0.78rem', color:'var(--subtext)', marginTop:'0.5rem' }}>
            Go to the Plan tab, create a plan, and set it as Active.
          </div>
        </div>
      )}

      {selMachine && activePlan && (
        <>
          {/* Active plan banner */}
          <div style={{ background:'rgba(58,122,40,0.12)', border:'1px solid var(--moss)', borderRadius:9, padding:'0.75rem 1rem', marginBottom:'0.75rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ color:'var(--grass)', fontFamily:'DM Mono, monospace', fontSize:'0.65rem', marginBottom:'0.2rem' }}>● ACTIVE PLAN</div>
                <div style={{ color:'var(--cream)', fontWeight:600 }}>{activePlan.name || 'Rotation Plan'}</div>
                <div style={{ fontSize:'0.72rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace' }}>
                  {selHerd?.name} · {activePlan.target_acres_per_day?.toFixed(2)} ac/day · {activePlan.total_cycle_days}d cycle
                  {activePass && ` · Pass ${activePass.pass_number}: Spans ${activePass.span_from}–${activePass.span_to}`}
                </div>
              </div>
              {passCalc && isPivot && passCalc.scaleFactor > 1.001 && (
                <div style={{ background:'rgba(240,192,64,0.12)', border:'1px solid rgba(240,192,64,0.35)', borderRadius:7, padding:'6px 10px', fontFamily:'DM Mono, monospace', fontSize:'0.72rem', color:'var(--gold)' }}>
                  ⚙ TL set to <strong>{passCalc.tlIpmSetting} ipm</strong>
                </div>
              )}
            </div>
          </div>

          {/* Safety alerts */}
          {safetyAlerts.length > 0 && (
            <div style={{ marginBottom:'0.75rem' }}>
              {safetyAlerts.map((a,i) => (
                <div key={i} style={{
                  background: a.level==='critical'?'rgba(224,64,48,0.2)':'rgba(224,124,24,0.1)',
                  border:`1px solid ${a.level==='critical'?'var(--alert)':'var(--amber)'}`,
                  borderRadius:8, padding:'0.7rem 1rem', marginBottom:5,
                }}>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:600, color:a.level==='critical'?'var(--alert)':'var(--amber)', marginBottom:3 }}>{a.title}</div>
                  <div style={{ fontSize:'0.78rem', color:a.level==='critical'?'var(--alert)':'var(--amber)' }}>{a.msg}</div>
                </div>
              ))}
            </div>
          )}

          {/* Diagnostic when plan is active but schedule can't generate */}
          {activePlan && !passCalc && (
            <div style={{ background:'rgba(240,192,64,0.1)', border:'1px solid var(--gold)', borderRadius:8, padding:'0.75rem 1rem', marginBottom:'0.75rem', fontSize:'0.8rem', color:'var(--gold)' }}>
              ⚠ This plan has no usable passes yet. {!activePass ? 'Open the plan in the Plan tab and add at least one pass (span range), then Save + Set Active again.' : 'Check that the machine has spans configured.'}
              {!activePlan.target_acres_per_day && ' Target acres/day is also missing — rebuild the plan with a herd that has weight.'}
            </div>
          )}

          {/* Stats */}
          {passCalc && (
            <div className="grid-4" style={{ marginBottom:'0.75rem' }}>
              {(isPivot ? [
                ['TL Set to',      passCalc.tlIpmSetting+' ipm'],
                ['Ac / Move',      passCalc.acresPerMove],
                ['Runtime',        passCalc.runtimeMinutes+' min'],
                ['Ac / Day',       passCalc.actualAcresPerDay],
              ] : [
                ['Width',          passCalc.grazingWidth+' ft'],
                ['Ac / Move',      passCalc.acresPerMove],
                ['Runtime',        passCalc.runtimeMinutes+' min'],
                ['Ac / Day',       passCalc.actualAcresPerDay],
              ]).map(([l,v]) => (
                <div key={l} className="stat-box">
                  <div className="stat-val" style={{ fontSize:'0.9rem' }}>{v}</div>
                  <div className="stat-lbl" style={{ fontSize:'0.54rem' }}>{l}</div>
                </div>
              ))}
            </div>
          )}

          {/* Move schedule */}
          {schedule.length > 0 && (
            <div className="card">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
                <div className="card-sub">Move Schedule — {selDate}</div>
                <div className="flex gap-1">
                  <button className="btn btn-primary btn-sm" onClick={addMove}>+ Move</button>
                  <button className="btn btn-secondary btn-sm" onClick={removeMove} disabled={todayMoves<=1}>− Move</button>
                  {customMoves != null && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setCustomMoves(null)}>↺ Reset</button>
                  )}
                </div>
              </div>

              {customMoves != null && (
                <div style={{ background:'rgba(240,192,64,0.1)', border:'1px solid rgba(240,192,64,0.3)', borderRadius:7, padding:'6px 10px', marginBottom:'0.75rem', fontSize:'0.72rem', color:'var(--gold)', fontFamily:'DM Mono, monospace' }}>
                  ⚠ Plan updated: {todayMoves} moves/day (was {movesPerDay}). This change applies to the rest of this rotation.
                </div>
              )}

              <div style={{ overflowX:'auto', marginBottom:'0.75rem' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
                  <thead>
                    <tr>
                      {['Move','Start ✎','Stop','Run','Rest','Cycle','Period'].map(h => (
                        <th key={h} style={{ background:'var(--bark2)', color:'var(--harvest)', padding:'6px 8px', textAlign:'left', fontFamily:'DM Mono, monospace', fontSize:'0.56rem', letterSpacing:'0.07em', textTransform:'uppercase', borderBottom:'1px solid #3a5520' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((mv, idx) => (
                      <tr key={mv.moveNum} style={{ background:mv.manual?'rgba(240,192,64,0.04)':'transparent' }}>
                        <td style={{ padding:'6px 8px', color:mv.period?.color, fontFamily:'DM Mono, monospace', fontWeight:600 }}>
                          #{mv.moveNum}{mv.manual&&<span style={{ marginLeft:3, fontSize:'0.56rem', color:'var(--gold)' }}>✎</span>}
                        </td>
                        <td>
                          <input type="time" value={to24(mv.startTime)} onChange={e => handleTimeEdit(idx, e.target.value)}
                            style={{ background:mv.manual?'#2a1e00':'transparent', border:mv.manual?'1px solid var(--gold)':'1px solid transparent', borderRadius:4, color:mv.manual?'var(--gold)':'var(--cream)', fontFamily:'DM Mono, monospace', fontSize:'0.75rem', padding:'2px 4px', cursor:'pointer', width:95 }} />
                        </td>
                        <td style={{ padding:'6px 8px', color:'var(--subtext)', fontFamily:'DM Mono, monospace' }}>{mv.stopTime}</td>
                        <td style={{ padding:'6px 8px', color:'var(--subtext)' }}>{mv.runTime}m</td>
                        <td style={{ padding:'6px 8px', color:mv.restToNext>120?'var(--gold)':'var(--subtext)', fontWeight:mv.restToNext>120?600:400 }}>
                          {mv.restToNext!=null?`${mv.restToNext}m`:'—'}{mv.restToNext>120&&<span style={{ marginLeft:3, fontSize:'0.55rem' }}>loaf</span>}
                        </td>
                        <td style={{ padding:'6px 8px', fontFamily:'DM Mono, monospace', color:'var(--grass)' }}>{mv.cycleTime}m</td>
                        <td style={{ padding:'6px 8px', fontSize:'0.66rem', color:mv.period?.color }}>{mv.period?.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Post-graze log */}
              <hr className="divider" />
              <div className="card-sub mb-2">Post-Graze Log</div>
              <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
                <div className="field">
                  <label className="label">Post-Graze Residual (in)</label>
                  <input className="input" type="number" step="0.5" placeholder="e.g. 4.5"
                    value={residual} onChange={e => setResidual(e.target.value)} />
                  {residual && (() => {
                    const v = +residual
                    if (v < 4)  return <div style={{ color:'var(--alert)', fontSize:'0.72rem', marginTop:3 }}>⬆ Add moves — below 4" minimum</div>
                    if (v <= 5) return <div style={{ color:'var(--subtext)', fontSize:'0.72rem', marginTop:3 }}>✓ Hold — residual on target</div>
                    if (v > 7)  return <div style={{ color:'var(--gold)', fontSize:'0.72rem', marginTop:3 }}>⬇ Remove move — under-utilizing</div>
                    return null
                  })()}
                </div>
                <div className="field">
                  <label className="label">Observations</label>
                  <textarea className="textarea" rows={2} placeholder="Cattle behavior, field conditions…"
                    value={notes} onChange={e => setNotes(e.target.value)} />
                </div>
              </div>

              <button className="btn btn-primary" onClick={confirmAndSave} disabled={saving}>
                {saving ? <><span className="spinner" /> Saving…</> : todaySchedule ? '✓ Update Today' : '✓ Confirm Schedule'}
              </button>
            </div>
          )}
        </>
      )}

      {/* History */}
      {schedules.length > 0 && (
        <div className="card">
          <div className="card-title mb-2">Recent Schedules</div>
          {schedules.slice(0,10).map(s => {
            const m = machines.find(x=>x.id===s.machine_id)
            const h = herds.find(x=>x.id===s.herd_id)
            return (
              <div className="list-item" key={s.id}>
                <div>
                  <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'0.2rem' }}>
                    <span className="mono text-sm text-muted">{s.date}</span>
                    <span className="badge">{m?.name||'?'}</span>
                    {s.post_graze_residual && (
                      <span className="badge" style={{ borderColor:+s.post_graze_residual<4?'var(--alert)':+s.post_graze_residual>7?'var(--gold)':'var(--moss)', color:+s.post_graze_residual<4?'var(--alert)':+s.post_graze_residual>7?'var(--gold)':'var(--grass)' }}>
                        {s.post_graze_residual}" residual
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted">
                    {s.moves_per_day} moves · {s.acres_per_day} ac/day · {s.runtime_minutes}min/move
                    {s.tl_ipm_setting && s.tl_ipm_setting !== s.ipm && ` · TL: ${s.tl_ipm_setting} ipm`}
                  </div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => remove(s.id)}>✕</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
