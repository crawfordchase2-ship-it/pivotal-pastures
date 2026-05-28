import { useState, useRef } from 'react'
import { useMachines, useHerds, useGrazingPlans, usePasses } from '../hooks/useData'
import {
  calcPivotPass, calcLinearPass, calcTargetAcresPerDay,
  getEndTowerRadius, getRadiusToSpan, generateMoveSchedule
} from '../lib/grazing'

const ACTION_DISPLAY = {
  add_move:       { label: 'Add 1 Move',         color: 'var(--grass)',   bg: '#0f2208', icon: '⬆' },
  hold:           { label: 'Hold Current Plan',   color: 'var(--sky)',     bg: '#081018', icon: '✓' },
  remove_move:    { label: 'Remove 1 Move',       color: 'var(--gold)',    bg: '#1a1800', icon: '⬇' },
  flag_risk:      { label: 'Flag Risk',           color: 'var(--alert)',   bg: '#1a0808', icon: '⚠' },
  need_more_info: { label: 'Need Better Photos',  color: 'var(--subtext)', bg: '#111',   icon: '?' },
}

// ── Span selector component ─────────────────────────────────────────────────
function SpanSelector({ spans, selectedFrom, selectedTo, onChange, label }) {
  const [from, setFrom] = useState(selectedFrom || 1)
  const [to, setTo]     = useState(selectedTo || 1)

  function apply() {
    if (from > to) return
    onChange(from, to)
  }

  return (
    <div style={{ background: 'var(--bark)', borderRadius: 8, padding: '0.75rem' }}>
      {label && <div className="label" style={{ marginBottom: '0.5rem' }}>{label}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {spans.map((s, i) => {
          const inRange = s.number >= from && s.number <= to
          return (
            <button key={i} onClick={() => {
              if (from === to && to === s.number) return
              if (s.number < from) setFrom(s.number)
              else if (s.number > to) setTo(s.number)
              else if (s.number === from && from < to) setFrom(s.number + 1)
              else if (s.number === to && from < to) setTo(s.number - 1)
            }} style={{
              background: inRange ? 'var(--moss)' : 'var(--bark2)',
              border: `1px solid ${inRange ? 'var(--grass)' : '#3a5520'}`,
              borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
              color: inRange ? 'var(--white)' : 'var(--subtext)',
              fontFamily: 'DM Mono, monospace', fontSize: '0.72rem',
              transition: 'all 0.15s',
            }}>
              S{s.number}
              <div style={{ fontSize: '0.55rem', color: inRange ? 'var(--sprout)' : 'var(--bark2)' }}>
                {s.length_ft}ft
              </div>
            </button>
          )
        })}
      </div>
      <div className="grid-2" style={{ marginBottom: '0.5rem' }}>
        <div className="field">
          <label className="label">From Span</label>
          <select className="select" value={from} onChange={e => setFrom(+e.target.value)}>
            {spans.map(s => <option key={s.number} value={s.number}>Span {s.number} ({s.length_ft} ft)</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">To Span</label>
          <select className="select" value={to} onChange={e => setTo(+e.target.value)}>
            {spans.map(s => <option key={s.number} value={s.number}>Span {s.number} ({s.length_ft} ft)</option>)}
          </select>
        </div>
      </div>
      <button className="btn btn-primary btn-sm" onClick={apply} disabled={from > to}>
        ✓ Set Spans {from}–{to}
      </button>
      {from > to && <div style={{ color: 'var(--alert)', fontSize: '0.72rem', marginTop: 4 }}>From span must be ≤ to span</div>}
    </div>
  )
}

export default function GrazingPlanTab() {
  const { data: machines } = useMachines()
  const { data: herds }    = useHerds()
  const { data: plans, insert: insertPlan, update: updatePlan, remove: removePlan } = useGrazingPlans()

  const [view, setView]   = useState('list') // list | new | detail
  const [selPlan, setSelPlan] = useState(null)

  // New plan form
  const [form, setForm]   = useState({
    machine_id: '', herd_id: '', name: '',
    goal: 'production', forage_dm_per_acre: 2500,
    removal_pct: 50, start_date: new Date().toISOString().slice(0,10),
    notes: '',
  })
  const [passes, setPasses]   = useState([])
  const [saving, setSaving]   = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiForage, setAiForage]   = useState(null)
  const [photos, setPhotos]       = useState([])
  const fileRef = useRef()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const selMachine = machines.find(m => m.id === form.machine_id)
  const selHerd    = herds.find(h => h.id === form.herd_id)
  const machineSpans = selMachine ? (typeof selMachine.spans === 'string' ? JSON.parse(selMachine.spans) : selMachine.spans) || [] : []

  // Calculate target acres/day from current form values
  const targetCalc = selHerd ? calcTargetAcresPerDay({
    totalLiveweight: selHerd.total_lw,
    forageDmPerAcre: form.forage_dm_per_acre,
    removalPct: form.removal_pct,
  }) : null

  // Calculate each pass
  const calcPass = (p) => {
    if (!selMachine || !selHerd || !targetCalc) return null
    if (p.status === 'skipped') return null
    if (selMachine.type === 'pivot') {
      return calcPivotPass({
        spans: machineSpans,
        spanFrom: p.span_from,
        spanTo: p.span_to,
        desiredGrazingIpm: selMachine.ipm,
        herd: selHerd,
        targetAcresPerDay: targetCalc.targetAcresPerDay,
      })
    } else {
      return calcLinearPass({
        spans: machineSpans,
        spanFrom: p.span_from,
        spanTo: p.span_to,
        ipm: selMachine.ipm,
        herd: selHerd,
        targetAcresPerDay: targetCalc.targetAcresPerDay,
        runLengthFt: selMachine.run_length_ft,
      })
    }
  }

  const passCalcs = passes.map(p => calcPass(p))
  const totalCycleDays = passCalcs.reduce((sum, c) => {
    if (!c) return sum
    return sum + (c.daysPerRotation || c.daysPerPass || 0)
  }, 0)

  function addPass() {
    const usedSpans = passes.flatMap(p => p.status !== 'skipped'
      ? Array.from({ length: p.span_to - p.span_from + 1 }, (_, i) => p.span_from + i)
      : [])
    const nextAvailable = machineSpans.find(s => !usedSpans.includes(s.number))
    setPasses(prev => [...prev, {
      id: Date.now().toString(),
      pass_number: prev.length + 1,
      span_from: nextAvailable?.number || 1,
      span_to: nextAvailable?.number || 1,
      status: 'pending',
    }])
  }

  function updatePassSpans(idx, from, to) {
    setPasses(prev => prev.map((p, i) => i === idx ? { ...p, span_from: from, span_to: to } : p))
  }

  function togglePassSkip(idx) {
    setPasses(prev => prev.map((p, i) => i === idx
      ? { ...p, status: p.status === 'skipped' ? 'pending' : 'skipped' }
      : p))
  }

  function removePass(idx) {
    setPasses(prev => prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, pass_number: i + 1 })))
  }

  function movePassUp(idx) {
    if (idx === 0) return
    setPasses(prev => {
      const arr = [...prev]
      ;[arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]]
      return arr.map((p, i) => ({ ...p, pass_number: i + 1 }))
    })
  }

  function movePassDown(idx) {
    if (idx === passes.length - 1) return
    setPasses(prev => {
      const arr = [...prev]
      ;[arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]]
      return arr.map((p, i) => ({ ...p, pass_number: i + 1 }))
    })
  }

  // AI forage assessment
  function addForagePhotos(files) {
    Array.from(files).forEach(f => {
      const reader = new FileReader()
      reader.onload = e => setPhotos(prev => [...prev, {
        id: Date.now() + Math.random(),
        url: e.target.result,
        base64: e.target.result.split(',')[1],
        mimeType: f.type || 'image/jpeg',
        name: f.name,
      }])
      reader.readAsDataURL(f)
    })
  }

  async function runForageAI() {
    if (photos.length === 0) return
    setAiLoading(true)
    const photo = photos[photos.length - 1]
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          system: `You are an expert grazing agronomist. Analyze this pasture photo and return ONLY valid JSON:
{"estimated_height_inches":0,"estimated_dm_lbs_per_acre":0,"grass_density_score":0,"legume_pct":0,"stand_maturity":"vegetative","bloat_risk":"low","recommended_removal_pct":50,"confidence":"medium","notes":""}
Estimate dry matter: short dense grass ~1500 lb/ac, medium 8-10" ~2500 lb/ac, tall lush ~3500+ lb/ac. Be specific.`,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: photo.mimeType, data: photo.base64 } },
              { type: 'text', text: 'Estimate forage dry matter available per acre for grazing planning.' }
            ]
          }]
        })
      })
      const data = await resp.json()
      const raw  = data.content?.find(c => c.type === 'text')?.text || '{}'
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
      setAiForage(parsed)
      if (parsed.estimated_dm_lbs_per_acre) set('forage_dm_per_acre', parsed.estimated_dm_lbs_per_acre)
      if (parsed.recommended_removal_pct)   set('removal_pct', parsed.recommended_removal_pct)
    } catch (e) {
      setAiForage({ notes: 'Analysis failed: ' + e.message })
    }
    setAiLoading(false)
  }

  async function savePlan() {
    if (!form.machine_id || !form.herd_id || passes.length === 0) return
    setSaving(true)
    try {
      const plan = await insertPlan({
        ...form,
        total_passes: passes.length,
        total_cycle_days: +totalCycleDays.toFixed(1),
        usable_dm_per_acre: form.forage_dm_per_acre * form.removal_pct / 100,
        target_acres_per_day: targetCalc?.targetAcresPerDay,
        status: 'draft',
      })
      // Save passes (would need insert for each pass in real implementation)
      setView('list')
      setForm({ machine_id: '', herd_id: '', name: '', goal: 'production', forage_dm_per_acre: 2500, removal_pct: 50, start_date: new Date().toISOString().slice(0,10), notes: '' })
      setPasses([])
      setPhotos([])
      setAiForage(null)
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  // ── LIST VIEW ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div>
        <div className="section-heading">Grazing Plans</div>
        <div className="section-desc">Build multi-pass grazing plans for pivot and linear machines. Target acres/day calculated from forage inventory.</div>

        <button className="btn btn-primary mb-2" onClick={() => setView('new')}>+ New Grazing Plan</button>

        {plans.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🌿</div>
            <div className="text-muted">No grazing plans yet. Create one to get started.</div>
          </div>
        )}

        {plans.map(plan => {
          const machine = machines.find(m => m.id === plan.machine_id)
          const herd    = herds.find(h => h.id === plan.herd_id)
          const statusColors = { draft: 'var(--subtext)', active: 'var(--grass)', completed: 'var(--sky)', paused: 'var(--gold)' }
          return (
            <div key={plan.id} className="list-item" onClick={() => { setSelPlan(plan); setView('detail') }}>
              <div>
                <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>{machine?.type === 'pivot' ? '🔄' : '➡️'}</span>
                  <strong style={{ color: 'var(--cream)' }}>{plan.name || machine?.name}</strong>
                  <span className="badge" style={{ borderColor: statusColors[plan.status], color: statusColors[plan.status] }}>{plan.status}</span>
                  <span className="badge badge-amber">{plan.goal}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
                  {herd?.name} · {plan.total_passes} passes · {plan.total_cycle_days}d cycle · {plan.target_acres_per_day?.toFixed(2)} ac/day target
                </div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); removePlan(plan.id) }}>✕</button>
            </div>
          )
        })}
      </div>
    )
  }

  // ── NEW PLAN VIEW ──────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '1rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setView('list')}>← Back</button>
        <div className="section-heading" style={{ fontSize: '1.3rem', margin: 0 }}>New Grazing Plan</div>
      </div>

      {/* ── Step 1: Machine + Herd ── */}
      <div className="card">
        <div className="card-title mb-2">Step 1 — Machine & Herd</div>
        <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">Machine</label>
            <select className="select" value={form.machine_id} onChange={e => set('machine_id', e.target.value)}>
              <option value="">Select machine…</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.type})</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Herd</label>
            <select className="select" value={form.herd_id} onChange={e => set('herd_id', e.target.value)}>
              <option value="">Select herd…</option>
              {herds.map(h => <option key={h.id} value={h.id}>{h.name} · {h.total_lw?.toLocaleString()} lb LW</option>)}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="label">Plan Name (optional)</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Summer 2025 Rotation 1" />
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
      </div>

      {/* ── Step 2: Forage Assessment ── */}
      <div className="card">
        <div className="card-title mb-2">Step 2 — Forage Assessment</div>
        <div style={{ fontSize: '0.82rem', color: 'var(--subtext)', marginBottom: '1rem' }}>
          Upload a photo of the field or enter forage estimate manually. This sets your target acres/day.
        </div>

        <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">Forage DM / Acre (lb)</label>
            <input className="input" type="number" value={form.forage_dm_per_acre}
              onChange={e => set('forage_dm_per_acre', +e.target.value)} placeholder="e.g. 2500" />
          </div>
          <div className="field">
            <label className="label">Target Removal %</label>
            <input className="input" type="number" min={10} max={90} value={form.removal_pct}
              onChange={e => set('removal_pct', +e.target.value)} />
          </div>
        </div>

        {/* Photo upload for AI forage estimate */}
        <div
          onClick={() => fileRef.current.click()}
          style={{ border: '2px dashed var(--bark2)', borderRadius: 10, padding: '1rem', textAlign: 'center', cursor: 'pointer', background: 'rgba(37,61,22,0.3)', marginBottom: '0.75rem' }}
        >
          <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>📷</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--subtext)' }}>Upload forage photo for AI DM estimate</div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => addForagePhotos(e.target.files)} />

        {photos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {photos.map(p => (
              <img key={p.id} src={p.url} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bark2)' }} />
            ))}
            <button className="btn btn-primary btn-sm" onClick={runForageAI} disabled={aiLoading}>
              {aiLoading ? <><span className="spinner" /> Analyzing…</> : '🤖 Estimate DM from Photo'}
            </button>
          </div>
        )}

        {aiForage && (
          <div style={{ background: '#0f2208', border: '1px solid var(--moss)', borderRadius: 8, padding: '0.75rem', fontSize: '0.8rem' }}>
            <div className="card-sub mb-1">AI Forage Estimate</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              {[
                ['Height', aiForage.estimated_height_inches != null ? aiForage.estimated_height_inches + '"' : '—'],
                ['DM/acre', aiForage.estimated_dm_lbs_per_acre ? aiForage.estimated_dm_lbs_per_acre.toLocaleString() + ' lb' : '—'],
                ['Legume %', aiForage.legume_pct != null ? aiForage.legume_pct + '%' : '—'],
                ['Bloat Risk', aiForage.bloat_risk || '—'],
                ['Maturity', aiForage.stand_maturity || '—'],
                ['Confidence', aiForage.confidence || '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ background: 'var(--bark)', borderRadius: 5, padding: '4px 8px' }}>
                  <div style={{ fontSize: '0.58rem', color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div>
                  <div style={{ color: 'var(--cream)', fontFamily: 'DM Mono, monospace', fontSize: '0.78rem' }}>{v}</div>
                </div>
              ))}
            </div>
            {aiForage.notes && <div style={{ marginTop: '0.5rem', color: 'var(--subtext)', fontStyle: 'italic', fontSize: '0.75rem' }}>{aiForage.notes}</div>}
          </div>
        )}

        {/* Target acres/day result */}
        {targetCalc && selHerd && (
          <div className="grid-4 mt-2">
            {[
              ['Daily DM Intake', targetCalc.dailyIntakeLbs.toLocaleString() + ' lb'],
              ['Usable DM/ac', targetCalc.usableDmPerAcre.toLocaleString() + ' lb'],
              ['Target Acres/Day', targetCalc.targetAcresPerDay.toFixed(3) + ' ac'],
              ['Removal Target', form.removal_pct + '%'],
            ].map(([l, v]) => (
              <div key={l} className="stat-box">
                <div className="stat-val" style={{ fontSize: '1rem' }}>{v}</div>
                <div className="stat-lbl">{l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Step 3: Build Passes ── */}
      {selMachine && selHerd && targetCalc && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div className="card-title">Step 3 — Build Passes</div>
            <button className="btn btn-primary btn-sm" onClick={addPass}>+ Add Pass</button>
          </div>

          <div style={{ fontSize: '0.78rem', color: 'var(--subtext)', marginBottom: '1rem' }}>
            Select which spans to graze in each pass. Passes can be in any order. Spans within a pass must be consecutive. Unselected spans will rest.
          </div>

          {/* Skipped spans indicator */}
          {machineSpans.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: '1rem' }}>
              {machineSpans.map(s => {
                const inPass = passes.some(p => p.status !== 'skipped' && s.number >= p.span_from && s.number <= p.span_to)
                return (
                  <div key={s.number} style={{
                    padding: '3px 8px', borderRadius: 5, fontSize: '0.62rem',
                    fontFamily: 'DM Mono, monospace',
                    background: inPass ? 'rgba(58,122,40,0.3)' : 'rgba(168,192,136,0.1)',
                    border: `1px solid ${inPass ? 'var(--moss)' : 'var(--bark2)'}`,
                    color: inPass ? 'var(--grass)' : 'var(--subtext)',
                  }}>
                    S{s.number} {inPass ? '✓' : '— resting'}
                  </div>
                )
              })}
            </div>
          )}

          {passes.length === 0 && (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--subtext)', fontSize: '0.82rem' }}>
              Click "+ Add Pass" to build your grazing plan
            </div>
          )}

          {passes.map((pass, idx) => {
            const calc = passCalcs[idx]
            const isSkipped = pass.status === 'skipped'
            return (
              <div key={pass.id} style={{
                background: isSkipped ? 'rgba(15,26,10,0.5)' : 'var(--bark)',
                border: `1px solid ${isSkipped ? 'var(--bark2)' : 'var(--bark2)'}`,
                borderRadius: 10, padding: '1rem', marginBottom: '0.75rem',
                opacity: isSkipped ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div className="flex gap-1" style={{ alignItems: 'center' }}>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.8rem', color: 'var(--grass)', fontWeight: 600 }}>
                      Pass {pass.pass_number}
                    </span>
                    {!isSkipped && (
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.7rem', color: 'var(--subtext)' }}>
                        Spans {pass.span_from}–{pass.span_to}
                      </span>
                    )}
                    {isSkipped && <span className="badge" style={{ borderColor: 'var(--subtext)', color: 'var(--subtext)' }}>Skipped</span>}
                  </div>
                  <div className="flex gap-1">
                    <button className="btn btn-secondary btn-sm" onClick={() => movePassUp(idx)} disabled={idx === 0}>↑</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => movePassDown(idx)} disabled={idx === passes.length - 1}>↓</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => togglePassSkip(idx)}>
                      {isSkipped ? '↩ Include' : '⏭ Skip'}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => removePass(idx)}>✕</button>
                  </div>
                </div>

                {!isSkipped && (
                  <>
                    <SpanSelector
                      spans={machineSpans}
                      selectedFrom={pass.span_from}
                      selectedTo={pass.span_to}
                      onChange={(from, to) => updatePassSpans(idx, from, to)}
                    />

                    {calc && (
                      <div className="grid-4 mt-2">
                        {selMachine.type === 'pivot' ? [
                          ['Ac/Move',       calc.acresPerMove],
                          ['Moves/Day',     calc.movesPerDay],
                          ['Ac/Day',        calc.actualAcresPerDay],
                          ['Runtime',       calc.runtimeMinutes + ' min'],
                          ['TL Set to',     calc.tlIpmSetting + ' ipm'],
                          ['Scale Factor',  calc.scaleFactor + '×'],
                          ['End Tower',     calc.endTowerTravelIn + ' in'],
                          ['Days/Rotation', calc.daysPerRotation],
                        ] : [
                          ['Width',         calc.grazingWidth + ' ft'],
                          ['Ac/Move',       calc.acresPerMove],
                          ['Moves/Day',     calc.movesPerDay],
                          ['Ac/Day',        calc.actualAcresPerDay],
                          ['Runtime',       calc.runtimeMinutes + ' min'],
                          ['Daily Travel',  calc.dailyTravelFt + ' ft'],
                          ['Days/Pass',     calc.daysPerPass],
                          ['IPM',           calc.tlIpmSetting],
                        ].map(([l, v]) => (
                          <div key={l} className="stat-box" style={{ padding: '0.6rem' }}>
                            <div className="stat-val" style={{ fontSize: '0.9rem' }}>{v}</div>
                            <div className="stat-lbl" style={{ fontSize: '0.55rem' }}>{l}</div>
                          </div>
                        ))}

                        {/* TL ipm setting callout for pivot inner spans */}
                        {selMachine.type === 'pivot' && calc.scaleFactor > 1 && (
                          <div style={{
                            gridColumn: '1 / -1',
                            background: 'rgba(240,192,64,0.1)',
                            border: '1px solid rgba(240,192,64,0.4)',
                            borderRadius: 7, padding: '0.6rem 0.8rem',
                            fontSize: '0.78rem', color: 'var(--gold)',
                            fontFamily: 'DM Mono, monospace',
                          }}>
                            ⚙ Set TL computer to <strong>{calc.tlIpmSetting} ipm</strong> for this pass.
                            End tower travels {calc.endTowerTravelIn} inches ({(calc.endTowerTravelIn/12).toFixed(1)} ft) to give spans {pass.span_from}–{pass.span_to} a 50 ft move.
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}

          {passes.length > 0 && (
            <div className="card" style={{ background: 'rgba(15,26,10,0.6)', border: '1px solid var(--moss)' }}>
              <div className="card-sub mb-2">Plan Summary</div>
              <div className="grid-4">
                {[
                  ['Total Passes', passes.filter(p => p.status !== 'skipped').length],
                  ['Target Ac/Day', targetCalc?.targetAcresPerDay.toFixed(3)],
                  ['Total Cycle', totalCycleDays.toFixed(1) + ' days'],
                  ['Spans Resting', machineSpans.filter(s => !passes.some(p => p.status !== 'skipped' && s.number >= p.span_from && s.number <= p.span_to)).length],
                ].map(([l, v]) => (
                  <div key={l} className="stat-box">
                    <div className="stat-val">{v}</div>
                    <div className="stat-lbl">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Save ── */}
      {passes.length > 0 && (
        <div className="flex gap-1">
          <button className="btn btn-primary" onClick={savePlan} disabled={saving}>
            {saving ? <><span className="spinner" /> Saving…</> : '✓ Save Grazing Plan'}
          </button>
          <button className="btn btn-secondary" onClick={() => setView('list')}>Cancel</button>
        </div>
      )}
    </div>
  )
}
