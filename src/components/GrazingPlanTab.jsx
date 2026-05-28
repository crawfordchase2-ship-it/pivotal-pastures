import { useState, useEffect, useRef } from 'react'
import { useMachines, useHerds, useGrazingPlans } from '../hooks/useData'
import {
  calcPivotPass, calcLinearPass, calcTargetAcresPerDay,
  getEndTowerRadius,
} from '../lib/grazing'

// ── Span selector ─────────────────────────────────────────────────────────────
function SpanSelector({ spans, selectedFrom, selectedTo, onChange }) {
  const [from, setFrom] = useState(selectedFrom || 1)
  const [to, setTo]     = useState(selectedTo || 1)

  useEffect(() => { setFrom(selectedFrom || 1) }, [selectedFrom])
  useEffect(() => { setTo(selectedTo || 1) }, [selectedTo])

  function apply(newFrom, newTo) {
    if (newFrom > newTo) return
    setFrom(newFrom); setTo(newTo)
    onChange(newFrom, newTo)
  }

  function handleBtn(n) {
    if (n < from) apply(n, to)
    else if (n > to) apply(from, n)
    else if (n === from && from < to) apply(n + 1, to)
    else if (n === to && from < to) apply(from, n - 1)
  }

  return (
    <div style={{ background: 'var(--bark)', borderRadius: 8, padding: '0.75rem' }}>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        {spans.map((s, i) => {
          const active = s.number >= from && s.number <= to
          return (
            <button key={i} onClick={() => handleBtn(s.number)} style={{
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
      <div className="grid-2" style={{ marginBottom: '0.4rem' }}>
        <div className="field">
          <label className="label">From Span</label>
          <select className="select" value={from} onChange={e => apply(+e.target.value, to)}>
            {spans.map(s => <option key={s.number} value={s.number}>Span {s.number} ({s.length_ft}ft)</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">To Span</label>
          <select className="select" value={to} onChange={e => apply(from, +e.target.value)}>
            {spans.map(s => <option key={s.number} value={s.number}>Span {s.number} ({s.length_ft}ft)</option>)}
          </select>
        </div>
      </div>
      <div style={{ fontSize: '0.68rem', color: 'var(--grass)', fontFamily: 'DM Mono, monospace' }}>
        ✓ Active: Spans {from}–{to} · {to - from + 1} span{to - from !== 0 ? 's' : ''}
      </div>
    </div>
  )
}

export default function GrazingPlanTab() {
  const { data: machines } = useMachines()
  const { data: herds }    = useHerds()
  const { data: plans, insert: insertPlan, update: updatePlan, remove: removePlan } = useGrazingPlans()

  const [view, setView]     = useState('list') // list | new | edit
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiForage, setAiForage]   = useState(null)
  const [photos, setPhotos]       = useState([])
  const fileRef = useRef()

  const [form, setForm] = useState({
    machine_id: '', herd_id: '', name: '', goal: 'production',
    forage_dm_per_acre: 2500, removal_pct: 50,
    start_date: new Date().toISOString().slice(0,10), notes: '',
    status: 'draft',
  })
  const [passes, setPasses] = useState([])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const selMachine = machines.find(m => m.id === form.machine_id)
  const selHerd    = herds.find(h => h.id === form.herd_id)
  const machineSpans = selMachine
    ? (typeof selMachine.spans === 'string' ? JSON.parse(selMachine.spans) : selMachine.spans) || []
    : []
  const isPivot = selMachine?.type === 'pivot'

  const targetCalc = selHerd ? calcTargetAcresPerDay({
    totalLiveweight: selHerd.total_lw || (selHerd.pairs * (selHerd.avg_weight || 1000) * 2),
    forageDmPerAcre: form.forage_dm_per_acre,
    removalPct: form.removal_pct,
  }) : null

  function calcPass(p) {
    if (!selMachine || !targetCalc || p.status === 'skipped') return null
    const spans = machineSpans
    if (isPivot) {
      return calcPivotPass({
        spans, spanFrom: p.span_from, spanTo: p.span_to,
        desiredGrazingIpm: selMachine.ipm,
        herd: selHerd,
        targetAcresPerDay: targetCalc.targetAcresPerDay,
      })
    } else {
      return calcLinearPass({
        spans, spanFrom: p.span_from, spanTo: p.span_to,
        ipm: selMachine.ipm,
        herd: selHerd,
        targetAcresPerDay: targetCalc.targetAcresPerDay,
        runLengthFt: selMachine.run_length_ft,
      })
    }
  }

  const passCalcs = passes.map(p => calcPass(p))
  const totalCycleDays = passCalcs.reduce((s, c) => s + (c?.daysPerRotation || c?.daysPerPass || 0), 0)

  function addPass() {
    const usedSpans = passes.flatMap(p => p.status !== 'skipped'
      ? Array.from({ length: p.span_to - p.span_from + 1 }, (_, i) => p.span_from + i) : [])
    const next = machineSpans.find(s => !usedSpans.includes(s.number))
    setPasses(prev => [...prev, {
      id: Date.now().toString(), pass_number: prev.length + 1,
      span_from: next?.number || 1, span_to: next?.number || 1, status: 'pending',
    }])
  }

  function updatePassSpans(idx, from, to) {
    setPasses(prev => prev.map((p, i) => i === idx ? { ...p, span_from: from, span_to: to } : p))
  }

  function removePass(idx) {
    setPasses(prev => prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, pass_number: i + 1 })))
  }

  function toggleSkip(idx) {
    setPasses(prev => prev.map((p, i) => i === idx
      ? { ...p, status: p.status === 'skipped' ? 'pending' : 'skipped' } : p))
  }

  function moveUp(idx) {
    if (idx === 0) return
    setPasses(prev => { const a = [...prev]; [a[idx-1],a[idx]]=[a[idx],a[idx-1]]; return a.map((p,i)=>({...p,pass_number:i+1})) })
  }

  function moveDown(idx) {
    if (idx === passes.length - 1) return
    setPasses(prev => { const a=[...prev]; [a[idx],a[idx+1]]=[a[idx+1],a[idx]]; return a.map((p,i)=>({...p,pass_number:i+1})) })
  }

  function openEdit(plan) {
    setForm({
      machine_id: plan.machine_id, herd_id: plan.herd_id,
      name: plan.name || '', goal: plan.goal || 'production',
      forage_dm_per_acre: plan.forage_dm_per_acre || 2500,
      removal_pct: plan.removal_pct || 50,
      start_date: plan.start_date || new Date().toISOString().slice(0,10),
      notes: plan.notes || '', status: plan.status || 'draft',
    })
    // Load passes from plan metadata
    const savedPasses = plan.passes_json
      ? JSON.parse(plan.passes_json)
      : []
    setPasses(savedPasses)
    setEditingId(plan.id)
    setView('new')
    window.scrollTo(0,0)
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
          model: 'claude-sonnet-4-20250514', max_tokens: 600,
          system: `You are an expert grazing agronomist. Analyze this pasture photo and return ONLY valid JSON:
{"estimated_height_inches":0,"estimated_dm_lbs_per_acre":0,"legume_pct":0,"stand_maturity":"vegetative","bloat_risk":"low","recommended_removal_pct":50,"confidence":"medium","notes":""}`,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: photo.mimeType, data: photo.base64 } },
            { type: 'text', text: 'Estimate forage dry matter per acre.' }
          ]}]
        })
      })
      const data = await resp.json()
      const raw  = data.content?.find(c => c.type === 'text')?.text || '{}'
      const parsed = JSON.parse(raw.replace(/```json|```/g,'').trim())
      setAiForage(parsed)
      if (parsed.estimated_dm_lbs_per_acre) set('forage_dm_per_acre', parsed.estimated_dm_lbs_per_acre)
      if (parsed.recommended_removal_pct)   set('removal_pct', parsed.recommended_removal_pct)
    } catch (e) {
      setAiForage({ notes: 'Analysis failed: ' + e.message })
    }
    setAiLoading(false)
  }

  async function savePlan() {
    if (!form.machine_id || !form.herd_id || passes.length === 0) {
      alert('Please select a machine, herd, and add at least one pass.')
      return
    }
    setSaving(true)
    try {
      const row = {
        ...form,
        total_passes: passes.filter(p => p.status !== 'skipped').length,
        total_cycle_days: +totalCycleDays.toFixed(1),
        usable_dm_per_acre: form.forage_dm_per_acre * form.removal_pct / 100,
        target_acres_per_day: targetCalc?.targetAcresPerDay,
        passes_json: JSON.stringify(passes),
      }
      if (editingId) await updatePlan(editingId, row)
      else await insertPlan(row)
      setView('list')
      resetNewPlan()
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  async function setActive(planId, currentStatus) {
    try {
      // Deactivate all other plans for this machine first
      const plan = plans.find(p => p.id === planId)
      for (const p of plans) {
        if (p.machine_id === plan.machine_id && p.id !== planId && p.status === 'active') {
          await updatePlan(p.id, { status: 'paused' })
        }
      }
      await updatePlan(planId, { status: currentStatus === 'active' ? 'draft' : 'active' })
    } catch (e) { alert('Error: ' + e.message) }
  }

  function resetNewPlan() {
    setForm({ machine_id: '', herd_id: '', name: '', goal: 'production',
      forage_dm_per_acre: 2500, removal_pct: 50,
      start_date: new Date().toISOString().slice(0,10), notes: '', status: 'draft' })
    setPasses([])
    setEditingId(null)
    setAiForage(null)
    setPhotos([])
  }

  // ── LIST VIEW ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    const statusColor = { draft: 'var(--subtext)', active: 'var(--grass)', completed: 'var(--sky)', paused: 'var(--gold)' }
    return (
      <div>
        <div className="section-heading">Grazing Plans</div>
        <div className="section-desc">Multi-pass grazing plans for pivot and linear machines.</div>

        <button className="btn btn-primary mb-2" onClick={() => { resetNewPlan(); setView('new') }}>
          + New Grazing Plan
        </button>

        {plans.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🌿</div>
            <div className="text-muted">No grazing plans yet. Create one to get started.</div>
          </div>
        )}

        {plans.map(plan => {
          const machine = machines.find(m => m.id === plan.machine_id)
          const herd    = herds.find(h => h.id === plan.herd_id)
          const isActive = plan.status === 'active'
          return (
            <div className="card" key={plan.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>{machine?.type === 'pivot' ? '🔄' : '➡️'}</span>
                    <strong style={{ color: 'var(--cream)', fontFamily: 'Satisfy, cursive', fontSize: '1.1rem' }}>
                      {plan.name || machine?.name || 'Untitled Plan'}
                    </strong>
                    <span className="badge" style={{ borderColor: statusColor[plan.status], color: statusColor[plan.status] }}>
                      {plan.status}
                    </span>
                    <span className="badge badge-amber">{plan.goal}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
                    {herd?.name} · {machine?.name} · {plan.total_passes} passes · {plan.total_cycle_days}d cycle · {plan.target_acres_per_day?.toFixed(2)} ac/day
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    className={`btn btn-sm ${isActive ? 'btn-amber' : 'btn-secondary'}`}
                    onClick={() => setActive(plan.id, plan.status)}
                  >
                    {isActive ? '● Active' : 'Set Active'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(plan)}>✎ Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => { if (confirm('Delete this plan?')) removePlan(plan.id) }}>✕</button>
                </div>
              </div>

              {/* Pass summary */}
              {plan.passes_json && (() => {
                try {
                  const savedPasses = JSON.parse(plan.passes_json)
                  return (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {savedPasses.map((p, i) => (
                        <div key={i} style={{
                          background: p.status === 'skipped' ? 'var(--bark)' : 'rgba(58,122,40,0.2)',
                          border: `1px solid ${p.status === 'skipped' ? 'var(--bark2)' : 'var(--moss)'}`,
                          borderRadius: 6, padding: '3px 9px',
                          fontSize: '0.65rem', fontFamily: 'DM Mono, monospace',
                          color: p.status === 'skipped' ? 'var(--subtext)' : 'var(--grass)',
                        }}>
                          Pass {p.pass_number}: S{p.span_from}–S{p.span_to}
                          {p.status === 'skipped' && ' (skip)'}
                        </div>
                      ))}
                    </div>
                  )
                } catch { return null }
              })()}
            </div>
          )
        })}
      </div>
    )
  }

  // ── NEW / EDIT VIEW ────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '1rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => { setView('list'); resetNewPlan() }}>← Back</button>
        <div className="section-heading" style={{ fontSize: '1.3rem', margin: 0 }}>
          {editingId ? 'Edit Grazing Plan' : 'New Grazing Plan'}
        </div>
      </div>

      {/* Step 1 */}
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
              {herds.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="label">Plan Name (optional)</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Summer 2025 Rotation 1" />
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

      {/* Step 2 */}
      <div className="card">
        <div className="card-title mb-2">Step 2 — Forage Assessment</div>
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

        {/* Photo upload */}
        <div onClick={() => fileRef.current.click()}
          style={{ border: '2px dashed var(--bark2)', borderRadius: 8, padding: '0.75rem', textAlign: 'center', cursor: 'pointer', background: 'rgba(37,61,22,0.2)', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '1.3rem' }}>📷</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--subtext)' }}>Upload forage photo for AI DM estimate (optional)</div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files[0]; if (!f) return
            const r = new FileReader()
            r.onload = ev => setPhotos([{ id: Date.now(), url: ev.target.result, base64: ev.target.result.split(',')[1], mimeType: f.type || 'image/jpeg' }])
            r.readAsDataURL(f)
          }} />

        {photos.length > 0 && (
          <div className="flex gap-1" style={{ marginBottom: '0.5rem', alignItems: 'center' }}>
            <img src={photos[0].url} style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bark2)' }} />
            <button className="btn btn-primary btn-sm" onClick={runForageAI} disabled={aiLoading}>
              {aiLoading ? <><span className="spinner" /> Analyzing…</> : '🤖 Estimate DM from Photo'}
            </button>
          </div>
        )}

        {aiForage && (
          <div style={{ background: '#0f2208', border: '1px solid var(--moss)', borderRadius: 8, padding: '0.75rem', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
            <div className="card-sub mb-1">AI Forage Estimate</div>
            <div className="grid-2">
              {[
                ['Height', aiForage.estimated_height_inches != null ? aiForage.estimated_height_inches + '"' : '—'],
                ['DM/acre', aiForage.estimated_dm_lbs_per_acre ? aiForage.estimated_dm_lbs_per_acre.toLocaleString() + ' lb' : '—'],
                ['Legume', aiForage.legume_pct != null ? aiForage.legume_pct + '%' : '—'],
                ['Bloat Risk', aiForage.bloat_risk || '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ background: 'var(--bark)', borderRadius: 5, padding: '4px 8px' }}>
                  <div style={{ fontSize: '0.56rem', color: 'var(--subtext)', textTransform: 'uppercase' }}>{l}</div>
                  <div style={{ color: 'var(--cream)', fontFamily: 'DM Mono, monospace', fontSize: '0.78rem' }}>{v}</div>
                </div>
              ))}
            </div>
            {aiForage.notes && <div style={{ marginTop: '0.4rem', color: 'var(--subtext)', fontStyle: 'italic', fontSize: '0.72rem' }}>{aiForage.notes}</div>}
          </div>
        )}

        {/* Target calc */}
        {targetCalc && selHerd && (
          <div className="grid-4 mt-2">
            {[
              ['Daily DM', targetCalc.dailyIntakeLbs.toLocaleString() + ' lb'],
              ['Usable DM/ac', targetCalc.usableDmPerAcre.toLocaleString() + ' lb'],
              ['Target Ac/Day', targetCalc.targetAcresPerDay.toFixed(3) + ' ac'],
              ['Removal', form.removal_pct + '%'],
            ].map(([l, v]) => (
              <div key={l} className="stat-box">
                <div className="stat-val" style={{ fontSize: '0.95rem' }}>{v}</div>
                <div className="stat-lbl">{l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Step 3 */}
      {selMachine && selHerd && targetCalc && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div className="card-title">Step 3 — Build Passes</div>
            <button className="btn btn-primary btn-sm" onClick={addPass}>+ Add Pass</button>
          </div>

          <div style={{ fontSize: '0.78rem', color: 'var(--subtext)', marginBottom: '0.75rem' }}>
            Select which spans to graze in each pass. Any order. Spans within a pass must be consecutive.
          </div>

          {/* Span status overview */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: '1rem' }}>
            {machineSpans.map(s => {
              const inPass = passes.some(p => p.status !== 'skipped' && s.number >= p.span_from && s.number <= p.span_to)
              return (
                <div key={s.number} style={{
                  padding: '3px 8px', borderRadius: 5, fontSize: '0.62rem',
                  fontFamily: 'DM Mono, monospace',
                  background: inPass ? 'rgba(58,122,40,0.25)' : 'rgba(168,192,136,0.08)',
                  border: `1px solid ${inPass ? 'var(--moss)' : 'var(--bark2)'}`,
                  color: inPass ? 'var(--grass)' : 'var(--subtext)',
                }}>
                  S{s.number} {inPass ? '✓' : '— rest'}
                </div>
              )
            })}
          </div>

          {passes.length === 0 && (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--subtext)', fontSize: '0.82rem' }}>
              Click "+ Add Pass" to build your rotation plan
            </div>
          )}

          {passes.map((pass, idx) => {
            const calc = passCalcs[idx]
            const isSkipped = pass.status === 'skipped'
            return (
              <div key={pass.id} style={{
                background: isSkipped ? 'rgba(15,26,10,0.4)' : 'var(--bark)',
                border: '1px solid var(--bark2)',
                borderRadius: 10, padding: '1rem', marginBottom: '0.75rem',
                opacity: isSkipped ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <div className="flex gap-1" style={{ alignItems: 'center' }}>
                    <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--grass)', fontWeight: 600 }}>
                      Pass {pass.pass_number}
                    </span>
                    {!isSkipped && (
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.7rem', color: 'var(--subtext)' }}>
                        Spans {pass.span_from}–{pass.span_to}
                      </span>
                    )}
                    {isSkipped && <span className="badge" style={{ borderColor: 'var(--subtext)', color: 'var(--subtext)' }}>Skipped — resting</span>}
                  </div>
                  <div className="flex gap-1">
                    <button className="btn btn-secondary btn-sm" onClick={() => moveUp(idx)} disabled={idx === 0}>↑</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => moveDown(idx)} disabled={idx === passes.length - 1}>↓</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleSkip(idx)}>
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
                      onChange={(f, t) => updatePassSpans(idx, f, t)}
                    />

                    {calc && (
                      <div className="grid-4 mt-2">
                        {(isPivot ? [
                          ['Ac / Move',       calc.acresPerMove],
                          ['Moves / Day',     calc.movesPerDay],
                          ['Ac / Day',        calc.actualAcresPerDay],
                          ['Runtime',         calc.runtimeMinutes + ' min'],
                          ['TL Set to',       calc.tlIpmSetting + ' ipm'],
                          ['Scale Factor',    calc.scaleFactor + '×'],
                          ['End Tower',       calc.endTowerTravelIn + ' in'],
                          ['Days / Rotation', calc.daysPerRotation],
                        ] : [
                          ['Width',           calc.grazingWidth + ' ft'],
                          ['Ac / Move',       calc.acresPerMove],
                          ['Moves / Day',     calc.movesPerDay],
                          ['Ac / Day',        calc.actualAcresPerDay],
                          ['Runtime',         calc.runtimeMinutes + ' min'],
                          ['Daily Travel',    calc.dailyTravelFt + ' ft'],
                          ['Days / Pass',     calc.daysPerPass],
                          ['IPM',             calc.tlIpmSetting],
                        ]).map(([l, v]) => (
                          <div key={l} className="stat-box" style={{ padding: '0.6rem' }}>
                            <div className="stat-val" style={{ fontSize: '0.88rem' }}>{v}</div>
                            <div className="stat-lbl" style={{ fontSize: '0.54rem' }}>{l}</div>
                          </div>
                        ))}

                        {isPivot && calc.scaleFactor > 1.001 && (
                          <div style={{
                            gridColumn: '1 / -1',
                            background: 'rgba(240,192,64,0.1)', border: '1px solid rgba(240,192,64,0.4)',
                            borderRadius: 7, padding: '0.6rem 0.8rem',
                            fontSize: '0.75rem', color: 'var(--gold)', fontFamily: 'DM Mono, monospace',
                          }}>
                            ⚙ Set TL computer to <strong>{calc.tlIpmSetting} ipm</strong> for this pass.
                            End tower travels {calc.endTowerTravelIn} in ({(calc.endTowerTravelIn/12).toFixed(1)} ft)
                            to give spans {pass.span_from}–{pass.span_to} a 50 ft move.
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
            <div style={{ background: 'rgba(15,26,10,0.6)', border: '1px solid var(--moss)', borderRadius: 10, padding: '1rem' }}>
              <div className="card-sub mb-2">Plan Summary</div>
              <div className="grid-4">
                {[
                  ['Active Passes', passes.filter(p => p.status !== 'skipped').length],
                  ['Target Ac/Day', targetCalc?.targetAcresPerDay.toFixed(3)],
                  ['Total Cycle',   totalCycleDays.toFixed(1) + ' days'],
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

      {passes.length > 0 && (
        <div className="flex gap-1">
          <button className="btn btn-primary" onClick={savePlan} disabled={saving}>
            {saving ? <><span className="spinner" /> Saving…</> : editingId ? '✓ Update Plan' : '✓ Save Grazing Plan'}
          </button>
          <button className="btn btn-secondary" onClick={() => { setView('list'); resetNewPlan() }}>Cancel</button>
        </div>
      )}
    </div>
  )
}
