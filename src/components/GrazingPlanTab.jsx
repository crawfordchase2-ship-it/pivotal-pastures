import { useState, useEffect, useRef } from 'react'
import { useMachines, useHerds, useGrazingPlans, useRotations, useAnimals, useWeightRecords } from '../hooks/useData'
import { calcPivotPass, calcLinearPass, calcTargetAcresPerDay, generateMoveSchedule, getEndTowerRadius, fmt12 } from '../lib/grazing'
import { resolveHerdMetrics } from '../lib/animals.js'
import { checkSafetyAlerts, checkRecommendationUnlock, GRASS_TYPES, detectGrowthStage } from '../lib/inventory'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const APP_VERSION = 'v3.23'

// ── Span selector ─────────────────────────────────────────────────────────────
function SpanSelector({ spans, from, to, onChange }) {
  function apply(nf, nt) { if (nf <= nt) onChange(nf, nt) }
  function handleBtn(n) {
    if (n < from) apply(n, to)
    else if (n > to) apply(from, n)
    else if (n === from && from < to) apply(n + 1, to)
    else if (n === to && from < to) apply(from, n - 1)
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
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
      <div className="grid-2">
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
      <div style={{ fontSize: '0.68rem', color: 'var(--grass)', fontFamily: 'DM Mono, monospace', marginTop: 4 }}>
        ✓ Active: Spans {from}–{to} · {to - from + 1} span{to - from !== 0 ? 's' : ''}
      </div>
    </div>
  )
}

// ── Alert banner ──────────────────────────────────────────────────────────────
function AlertBanner({ alerts }) {
  if (!alerts?.length) return null
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      {alerts.map((a, i) => (
        <div key={i} style={{
          background: a.level === 'critical' ? 'rgba(224,64,48,0.2)' : a.level === 'alert' ? 'rgba(224,64,48,0.15)' : 'rgba(224,124,24,0.1)',
          border: `1px solid ${a.level === 'critical' || a.level === 'alert' ? 'var(--alert)' : 'var(--amber)'}`,
          borderRadius: 8, padding: '0.6rem 0.8rem', marginBottom: 5,
          color: a.level === 'critical' || a.level === 'alert' ? 'var(--alert)' : 'var(--amber)',
          fontSize: '0.78rem',
        }}>
          <div style={{ fontWeight: 600, fontFamily: 'DM Mono, monospace', marginBottom: 2 }}>{a.title}</div>
          <div>{a.msg}</div>
        </div>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function GrazingPlanTab() {
  const { user } = useAuth()
  const { data: machines } = useMachines()
  const { data: herds }    = useHerds()
  const { data: animals }  = useAnimals()
  const { data: weightRecords } = useWeightRecords()
  const { data: plans, insert: insertPlan, update: updatePlan, remove: removePlan } = useGrazingPlans()

  const [view, setView]         = useState('list') // list | build
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [photos, setPhotos]     = useState([])
  const [aiForage, setAiForage] = useState(null)
  const fileRef = useRef()

  // Plan form
  const [form, setForm] = useState({
    machine_id: '', herd_id: '', name: '', goal: 'production',
    grass_type: 'cool_season',
    forage_dm_per_acre: 2500, removal_pct: 50,
    start_date: new Date().toISOString().slice(0,10),
    sunrise_time: '06:00', sunset_time: '20:30',
    notes: '', status: 'draft',
  })
  const [passes, setPasses]         = useState([])
  const [activePassIdx, setActivePassIdx] = useState(0)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const selMachine   = machines.find(m => m.id === form.machine_id)
  const selHerd      = herds.find(h => h.id === form.herd_id)
  const isPivot      = selMachine?.type === 'pivot'
  const machineSpans = selMachine
    ? (typeof selMachine.spans === 'string' ? JSON.parse(selMachine.spans) : selMachine.spans) || []
    : []

  // Auto fetch sun times
  useEffect(() => {
    if (!form.start_date) return
    const go = (lat, lng) => {
      const d = new Date(form.start_date)
      const J = Math.floor((d - new Date(d.getFullYear(),0,0)) / 86400000)
      const dlt = 23.45 * Math.sin((360/365*(J-81)) * Math.PI/180)
      const ha  = Math.acos(-Math.tan(lat*Math.PI/180)*Math.tan(dlt*Math.PI/180)) * 180/Math.PI
      const sr  = 12 - ha/15, ss = 12 + ha/15
      const fmt = m => { const h=Math.floor(m),mn=Math.round((m-h)*60); return `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}` }
      setForm(f => ({ ...f, sunrise_time: fmt(sr), sunset_time: fmt(ss) }))
    }
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(p => go(p.coords.latitude, p.coords.longitude), () => go(41.5, -99.5))
      : go(41.5, -99.5)
  }, [form.start_date])

  // Resolve herd weight: live from animal records if assigned, else stored estimate
  const weightsByAnimal = {}
  weightRecords.forEach(w => {
    if (!weightsByAnimal[w.animal_id]) weightsByAnimal[w.animal_id] = []
    weightsByAnimal[w.animal_id].push(w)
  })
  const herdMetrics = selHerd ? resolveHerdMetrics(selHerd, animals, weightsByAnimal) : null
  const herdLiveweight = herdMetrics
    ? (herdMetrics.totalLiveweight || selHerd.total_lw || (selHerd.pairs * (selHerd.avg_weight||1000) * 2))
    : 0
  // Prefer the herd's real per-class daily DM (lactating/calf-adjusted) when available
  const herdDailyDm = herdMetrics && herdMetrics.dailyDmLbs ? herdMetrics.dailyDmLbs : (herdLiveweight * 0.025)

  const targetCalc = selHerd ? (() => {
    const usableDm = form.forage_dm_per_acre * (form.removal_pct / 100)
    return {
      dailyIntakeLbs: Math.round(herdDailyDm),
      usableDmPerAcre: Math.round(usableDm),
      targetAcresPerDay: usableDm > 0 ? +(herdDailyDm / usableDm).toFixed(3) : 0,
    }
  })() : null

  function calcPass(p) {
    if (!selMachine || !targetCalc || p.status === 'skipped') return null
    if (isPivot) {
      return calcPivotPass({ spans: machineSpans, spanFrom: p.span_from, spanTo: p.span_to, desiredGrazingIpm: selMachine.ipm, herd: selHerd, targetAcresPerDay: targetCalc.targetAcresPerDay })
    } else {
      return calcLinearPass({ spans: machineSpans, spanFrom: p.span_from, spanTo: p.span_to, ipm: selMachine.ipm, herd: selHerd, targetAcresPerDay: targetCalc.targetAcresPerDay, runLengthFt: selMachine.run_length_ft })
    }
  }

  const passCalcs      = passes.map(p => calcPass(p))
  const totalCycleDays = passCalcs.reduce((s,c) => s + (c?.daysPerRotation||c?.daysPerPass||0), 0)
  const activeCalc     = passCalcs[activePassIdx]

  // Schedule from active pass
  const schedule = activeCalc
    ? generateMoveSchedule(form.sunrise_time, form.sunset_time, activeCalc.movesPerDay, activeCalc.runtimeMinutes)
    : []

  function addPass() {
    const used = new Set(passes.flatMap(p => p.status !== 'skipped' ? Array.from({length: p.span_to-p.span_from+1},(_,i)=>p.span_from+i) : []))
    const next = machineSpans.find(s => !used.has(s.number))
    setPasses(prev => [...prev, { id: Date.now().toString(), pass_number: prev.length+1, span_from: next?.number||1, span_to: next?.number||1, status: 'pending' }])
  }
  function removePass(idx) { setPasses(prev => prev.filter((_,i)=>i!==idx).map((p,i)=>({...p,pass_number:i+1}))) }
  function updatePassSpans(idx, f, t) { setPasses(prev => prev.map((p,i)=>i===idx?{...p,span_from:f,span_to:t}:p)) }
  function toggleSkip(idx) { setPasses(prev => prev.map((p,i)=>i===idx?{...p,status:p.status==='skipped'?'pending':'skipped'}:p)) }

  async function runForageAI() {
    if (!photos.length) return
    setAiLoading(true)
    const photo = photos[photos.length-1]
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 600,
          system: `You are an expert regenerative grazing agronomist. Analyze this pasture photo conservatively. Return ONLY valid JSON:
{"estimated_height_inches":0,"estimated_dm_lbs_per_acre":0,"legume_pct":0,"stand_maturity":"vegetative","growth_stage":"vegetative","seed_heads":false,"bloat_risk":"low","recommended_removal_pct":50,"confidence":"medium","notes":""}
Be conservative on DM estimates. growth_stage must be one of: vegetative, transition, reproductive, dormant`,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: photo.mimeType, data: photo.base64 } },
            { type: 'text', text: 'Estimate forage dry matter per acre for grazing planning. Be conservative.' }
          ]}]
        })
      })
      const data   = await resp.json()
      const raw    = data.content?.find(c => c.type==='text')?.text || '{}'
      const parsed = JSON.parse(raw.replace(/```json|```/g,'').trim())
      setAiForage(parsed)
      if (parsed.estimated_dm_lbs_per_acre) set('forage_dm_per_acre', parsed.estimated_dm_lbs_per_acre)
      if (parsed.recommended_removal_pct)   set('removal_pct', parsed.recommended_removal_pct)
    } catch(e) { setAiForage({ notes: 'Analysis failed: ' + e.message }) }
    setAiLoading(false)
  }

  function openEdit(plan) {
    setForm({
      machine_id: plan.machine_id, herd_id: plan.herd_id,
      name: plan.name||'', goal: plan.goal||'production',
      grass_type: plan.grass_type||'cool_season',
      forage_dm_per_acre: plan.forage_dm_per_acre||2500,
      removal_pct: plan.removal_pct||50,
      start_date: plan.start_date||new Date().toISOString().slice(0,10),
      sunrise_time: plan.sunrise_time||'06:00',
      sunset_time: plan.sunset_time||'20:30',
      notes: plan.notes||'', status: plan.status||'draft',
    })
    const saved = plan.passes_json ? JSON.parse(plan.passes_json) : []
    setPasses(saved)
    setEditingId(plan.id)
    setView('build')
    window.scrollTo(0,0)
  }

  async function setActive(planId, currentStatus) {
    const plan = plans.find(p => p.id === planId)
    for (const p of plans) {
      if (p.machine_id === plan.machine_id && p.id !== planId && p.status === 'active')
        await updatePlan(p.id, { status: 'paused' })
    }
    await updatePlan(planId, { status: currentStatus === 'active' ? 'draft' : 'active' })
  }

  async function savePlan() {
    if (!form.machine_id || !form.herd_id || passes.length === 0) {
      alert('Select a machine, herd, and add at least one pass.'); return
    }
    setSaving(true)
    try {
      const row = {
        ...form,
        total_passes: passes.filter(p=>p.status!=='skipped').length,
        total_cycle_days: +totalCycleDays.toFixed(1),
        usable_dm_per_acre: form.forage_dm_per_acre * form.removal_pct / 100,
        target_acres_per_day: targetCalc?.targetAcresPerDay,
        passes_json: JSON.stringify(passes),
      }
      if (editingId) await updatePlan(editingId, row)
      else await insertPlan(row)
      setView('list'); reset()
    } catch(e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  function reset() {
    setForm({ machine_id:'', herd_id:'', name:'', goal:'production', grass_type:'cool_season', forage_dm_per_acre:2500, removal_pct:50, start_date:new Date().toISOString().slice(0,10), sunrise_time:'06:00', sunset_time:'20:30', notes:'', status:'draft' })
    setPasses([]); setEditingId(null); setAiForage(null); setPhotos([])
  }

  // ── LIST VIEW ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    const sc = { draft:'var(--subtext)', active:'var(--grass)', completed:'var(--sky)', paused:'var(--gold)' }
    return (
      <div>
        <div className="section-heading">Grazing Plans</div>
        <div className="section-desc">One plan per rotation. Photos, schedule, and recommendations all in one place.</div>
        <button className="btn btn-primary mb-2" onClick={() => { reset(); setView('build') }}>+ New Grazing Plan</button>
        {plans.length === 0 && (
          <div className="card" style={{ textAlign:'center', padding:'2.5rem' }}>
            <div style={{ fontSize:'3rem', marginBottom:'0.75rem' }}>🌿</div>
            <div className="text-muted">No grazing plans yet. Create your first plan to get started.</div>
          </div>
        )}
        {plans.map(plan => {
          const machine = machines.find(m => m.id === plan.machine_id)
          const herd    = herds.find(h => h.id === plan.herd_id)
          const isActive = plan.status === 'active'
          let savedPasses = []
          try { savedPasses = plan.passes_json ? JSON.parse(plan.passes_json) : [] } catch {}
          return (
            <div className="card" key={plan.id}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'0.75rem' }}>
                <div>
                  <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'0.3rem' }}>
                    <span style={{ fontSize:'1.1rem' }}>{machine?.type==='pivot'?'🔄':'➡️'}</span>
                    <strong style={{ color:'var(--cream)', fontFamily:'Satisfy, cursive', fontSize:'1.1rem' }}>
                      {plan.name || machine?.name || 'Untitled Plan'}
                    </strong>
                    <span className="badge" style={{ borderColor:sc[plan.status], color:sc[plan.status] }}>{plan.status}</span>
                    <span className="badge badge-amber">{plan.goal}</span>
                  </div>
                  <div style={{ fontSize:'0.72rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace' }}>
                    {herd?.name} · {machine?.name} · {plan.total_passes} passes · {plan.total_cycle_days}d cycle · {plan.target_acres_per_day?.toFixed(2)} ac/day
                    {plan.start_date && ` · Started ${plan.start_date}`}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button className={`btn btn-sm ${isActive?'btn-amber':'btn-secondary'}`} onClick={() => setActive(plan.id, plan.status)}>
                    {isActive ? '● Active' : 'Set Active'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(plan)}>✎ Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => { if(confirm('Delete?')) removePlan(plan.id) }}>✕</button>
                </div>
              </div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                {savedPasses.map((p,i) => (
                  <div key={i} style={{
                    background: p.status==='skipped'?'var(--bark)':'rgba(58,122,40,0.2)',
                    border:`1px solid ${p.status==='skipped'?'var(--bark2)':'var(--moss)'}`,
                    borderRadius:5, padding:'2px 8px',
                    fontSize:'0.62rem', fontFamily:'DM Mono, monospace',
                    color:p.status==='skipped'?'var(--subtext)':'var(--grass)',
                  }}>
                    Pass {p.pass_number}: S{p.span_from}–S{p.span_to}{p.status==='skipped'?' (skip)':''}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ── BUILD VIEW ─────────────────────────────────────────────────────────────
  const aiAlerts = aiForage ? checkSafetyAlerts({
    residualInches: null,
    legumePct: aiForage.legume_pct,
    trampling: null,
    seedHeads: aiForage.seed_heads,
    soilWet: false,
  }) : []

  return (
    <div>
      <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'1rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => { setView('list'); reset() }}>← Back</button>
        <div className="section-heading" style={{ fontSize:'1.3rem', margin:0 }}>
          {editingId ? 'Edit Grazing Plan' : 'New Grazing Plan'}
        </div>
        <span style={{ marginLeft:'auto', fontFamily:'DM Mono, monospace', fontSize:'0.6rem', color:'var(--subtext)' }}>{APP_VERSION}</span>
      </div>

      {/* ── STEP 1: Machine & Herd ── */}
      <div className="card">
        <div className="card-title mb-2">Step 1 — Machine & Herd</div>
        <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
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
        <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
          <div className="field">
            <label className="label">Plan Name</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Summer 2026 Rotation 1" />
          </div>
          <div className="field">
            <label className="label">Grass Type</label>
            <select className="select" value={form.grass_type} onChange={e => set('grass_type', e.target.value)}>
              {Object.entries(GRASS_TYPES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="label">Grazing Goal</label>
            <select className="select" value={form.goal} onChange={e => set('goal', e.target.value)}>
              <option value="production">Production Grazing</option>
              <option value="topping">Topping — keep vegetative</option>
              <option value="stockpile">Stockpile for winter</option>
              <option value="recovery">Stand recovery</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Start Date</label>
            <input className="input" type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── STEP 2: Forage Assessment & Photos ── */}
      <div className="card">
        <div className="card-title mb-2">Step 2 — Forage Assessment & Photos</div>
        <div style={{ fontSize:'0.8rem', color:'var(--subtext)', marginBottom:'1rem', lineHeight:1.6 }}>
          Upload a pre-graze photo for AI DM estimate, or enter manually.
          After cattle enter, upload daily pre/post graze photos here.
          Recommendations unlock after <strong style={{ color:'var(--grass)' }}>7 days</strong> of photos + first recovery photo.
        </div>

        {/* Photo upload */}
        <div onClick={() => fileRef.current.click()} style={{
          border:'2px dashed var(--bark2)', borderRadius:10, padding:'1rem',
          textAlign:'center', cursor:'pointer', background:'rgba(37,61,22,0.2)', marginBottom:'0.75rem',
        }}>
          <div style={{ fontSize:'1.5rem' }}>📷</div>
          <div style={{ fontSize:'0.75rem', color:'var(--subtext)' }}>
            Upload forage or field photo — AI estimates DM and growth stage
          </div>
          <div style={{ fontSize:'0.65rem', color:'var(--subtext)', marginTop:3 }}>
            Use for: entry assessment · daily pre-graze · post-graze · recovery checks
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:'none' }}
          onChange={e => {
            Array.from(e.target.files).forEach(f => {
              const r = new FileReader()
              r.onload = ev => setPhotos(prev => [...prev, { id:Date.now()+Math.random(), url:ev.target.result, base64:ev.target.result.split(',')[1], mimeType:f.type||'image/jpeg', name:f.name }])
              r.readAsDataURL(f)
            })
          }} />

        {photos.length > 0 && (
          <div style={{ marginBottom:'0.75rem' }}>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:'0.5rem' }}>
              {photos.map(p => (
                <div key={p.id} style={{ position:'relative' }}>
                  <img src={p.url} style={{ width:55, height:55, objectFit:'cover', borderRadius:6, border:'1px solid var(--bark2)' }} />
                  <button onClick={() => setPhotos(prev => prev.filter(x=>x.id!==p.id))} style={{
                    position:'absolute', top:2, right:2, background:'rgba(0,0,0,0.7)',
                    border:'none', color:'white', borderRadius:3, width:16, height:16,
                    cursor:'pointer', fontSize:9, display:'flex', alignItems:'center', justifyContent:'center',
                  }}>✕</button>
                </div>
              ))}
            </div>
            <button className="btn btn-primary btn-sm" onClick={runForageAI} disabled={aiLoading}>
              {aiLoading ? <><span className="spinner" /> Analyzing…</> : '🤖 Estimate DM from Photo'}
            </button>
          </div>
        )}

        {/* AI result */}
        {aiForage && (
          <div style={{ background:'#0f2208', border:'1px solid var(--moss)', borderRadius:9, padding:'0.75rem', marginBottom:'0.75rem' }}>
            <div className="card-sub mb-1">AI Forage Estimate</div>
            <AlertBanner alerts={aiAlerts} />
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, marginBottom:'0.5rem' }}>
              {[
                ['Height',       aiForage.estimated_height_inches != null ? aiForage.estimated_height_inches+'"' : '—'],
                ['DM / acre',    aiForage.estimated_dm_lbs_per_acre ? aiForage.estimated_dm_lbs_per_acre.toLocaleString()+' lb' : '—'],
                ['Legume %',     aiForage.legume_pct != null ? aiForage.legume_pct+'%' : '—'],
                ['Growth Stage', aiForage.growth_stage || '—'],
                ['Bloat Risk',   aiForage.bloat_risk || '—'],
                ['Confidence',   aiForage.confidence || '—'],
              ].map(([l,v]) => (
                <div key={l} style={{ background:'var(--bark)', borderRadius:5, padding:'4px 8px' }}>
                  <div style={{ fontSize:'0.56rem', color:'var(--subtext)', textTransform:'uppercase' }}>{l}</div>
                  <div style={{ color:'var(--cream)', fontFamily:'DM Mono, monospace', fontSize:'0.78rem' }}>{v}</div>
                </div>
              ))}
            </div>
            {aiForage.seed_heads && (
              <div style={{ background:'rgba(224,64,48,0.12)', border:'1px solid var(--alert)', borderRadius:6, padding:'6px 10px', fontSize:'0.75rem', color:'var(--alert)', marginBottom:'0.5rem' }}>
                🌾 Seed heads detected — stand entering reproductive stage. Speed up rotation to keep vegetative.
              </div>
            )}
            {aiForage.notes && <div style={{ fontSize:'0.72rem', color:'var(--subtext)', fontStyle:'italic' }}>{aiForage.notes}</div>}
          </div>
        )}

        {/* Manual DM entry */}
        <div className="grid-2" style={{ marginBottom:'0.5rem' }}>
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

        {/* Recommendation lock status */}
        <div style={{ background:'var(--bark)', borderRadius:8, padding:'0.75rem', fontSize:'0.78rem' }}>
          <div style={{ color:'var(--subtext)', marginBottom:'0.3rem', fontFamily:'DM Mono, monospace', fontSize:'0.62rem', textTransform:'uppercase', letterSpacing:'0.08em' }}>
            Recommendation Status
          </div>
          <div style={{ color:'var(--gold)' }}>
            ⏳ Recommendations unlock after 7 days of daily photos + first recovery photo
          </div>
          <div style={{ color:'var(--subtext)', fontSize:'0.7rem', marginTop:'0.3rem' }}>
            Safety alerts (residual below 4", bloat risk, seed heads) fire immediately regardless.
            Recovery photo requested every 7 days once active.
          </div>
        </div>

        {/* Target calculation */}
        {targetCalc && selHerd && (
          <div className="grid-4 mt-2">
            {[
              ['Daily DM',      targetCalc.dailyIntakeLbs.toLocaleString()+' lb'],
              ['Usable DM/ac',  targetCalc.usableDmPerAcre.toLocaleString()+' lb'],
              ['Target Ac/Day', targetCalc.targetAcresPerDay.toFixed(3)+' ac'],
              ['Removal',       form.removal_pct+'%'],
            ].map(([l,v]) => (
              <div key={l} className="stat-box">
                <div className="stat-val" style={{ fontSize:'0.95rem' }}>{v}</div>
                <div className="stat-lbl">{l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── STEP 3: Build Passes ── */}
      {selMachine && selHerd && targetCalc && (
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
            <div className="card-title">Step 3 — Build Passes</div>
            <button className="btn btn-primary btn-sm" onClick={addPass}>+ Add Pass</button>
          </div>
          <div style={{ fontSize:'0.78rem', color:'var(--subtext)', marginBottom:'0.75rem' }}>
            Select spans for each pass. App calculates moves/day and TL settings automatically.
          </div>

          {/* Span status */}
          <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:'1rem' }}>
            {machineSpans.map(s => {
              const inPass = passes.some(p => p.status!=='skipped' && s.number>=p.span_from && s.number<=p.span_to)
              return (
                <div key={s.number} style={{
                  padding:'3px 8px', borderRadius:5, fontSize:'0.62rem', fontFamily:'DM Mono, monospace',
                  background: inPass?'rgba(58,122,40,0.25)':'rgba(168,192,136,0.06)',
                  border:`1px solid ${inPass?'var(--moss)':'var(--bark2)'}`,
                  color: inPass?'var(--grass)':'var(--subtext)',
                }}>S{s.number} {inPass?'✓':'— rest'}</div>
              )
            })}
          </div>

          {passes.length === 0 && (
            <div style={{ textAlign:'center', padding:'1.5rem', color:'var(--subtext)', fontSize:'0.82rem' }}>
              Click "+ Add Pass" to define your rotation passes
            </div>
          )}

          {passes.map((pass, idx) => {
            const calc = passCalcs[idx]
            const isSkipped = pass.status === 'skipped'
            const isActive  = idx === activePassIdx
            return (
              <div key={pass.id} style={{
                background: isSkipped?'rgba(15,26,10,0.4)':isActive?'rgba(58,122,40,0.1)':'var(--bark)',
                border:`1px solid ${isSkipped?'var(--bark2)':isActive?'var(--grass)':'var(--bark2)'}`,
                borderRadius:10, padding:'1rem', marginBottom:'0.75rem', opacity:isSkipped?0.6:1,
              }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.6rem' }}>
                  <div className="flex gap-1" style={{ alignItems:'center' }}>
                    <button onClick={() => setActivePassIdx(idx)} style={{
                      fontFamily:'DM Mono, monospace', color:isActive?'var(--white)':'var(--grass)',
                      fontWeight:600, background:isActive?'var(--moss)':'transparent',
                      border:`1px solid ${isActive?'var(--grass)':'transparent'}`,
                      borderRadius:5, padding:'2px 8px', cursor:'pointer', fontSize:'0.8rem',
                    }}>
                      Pass {pass.pass_number}
                    </button>
                    {!isSkipped && <span style={{ fontFamily:'DM Mono, monospace', fontSize:'0.7rem', color:'var(--subtext)' }}>Spans {pass.span_from}–{pass.span_to}</span>}
                    {isSkipped && <span className="badge" style={{ borderColor:'var(--subtext)', color:'var(--subtext)' }}>Skipped</span>}
                    {isActive && !isSkipped && <span className="badge" style={{ borderColor:'var(--grass)', color:'var(--grass)' }}>Schedule preview</span>}
                  </div>
                  <div className="flex gap-1">
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleSkip(idx)}>{isSkipped?'↩ Include':'⏭ Skip'}</button>
                    <button className="btn btn-danger btn-sm" onClick={() => removePass(idx)}>✕</button>
                  </div>
                </div>

                {!isSkipped && (
                  <>
                    <SpanSelector
                      spans={machineSpans} from={pass.span_from} to={pass.span_to}
                      onChange={(f,t) => updatePassSpans(idx,f,t)}
                    />
                    {calc && (
                      <div className="grid-4 mt-2">
                        {(isPivot ? [
                          ['Ac / Move',       calc.acresPerMove],
                          ['Moves / Day',     calc.movesPerDay],
                          ['Ac / Day',        calc.actualAcresPerDay],
                          ['Runtime',         calc.runtimeMinutes+' min'],
                          ['TL Set to',       calc.tlIpmSetting+' ipm'],
                          ['Scale Factor',    calc.scaleFactor+'×'],
                          ['End Tower',       calc.endTowerTravelIn+' in'],
                          ['Days / Rotation', calc.daysPerRotation],
                        ] : [
                          ['Width',           calc.grazingWidth+' ft'],
                          ['Ac / Move',       calc.acresPerMove],
                          ['Moves / Day',     calc.movesPerDay],
                          ['Ac / Day',        calc.actualAcresPerDay],
                          ['Runtime',         calc.runtimeMinutes+' min'],
                          ['Daily Travel',    calc.dailyTravelFt+' ft'],
                          ['Days / Pass',     calc.daysPerPass],
                          ['IPM',             calc.tlIpmSetting],
                        ]).map(([l,v]) => (
                          <div key={l} className="stat-box" style={{ padding:'0.5rem' }}>
                            <div className="stat-val" style={{ fontSize:'0.85rem' }}>{v}</div>
                            <div className="stat-lbl" style={{ fontSize:'0.52rem' }}>{l}</div>
                          </div>
                        ))}
                        {isPivot && calc.scaleFactor > 1.001 && (
                          <div style={{ gridColumn:'1 / -1', background:'rgba(240,192,64,0.1)', border:'1px solid rgba(240,192,64,0.35)', borderRadius:7, padding:'0.6rem 0.8rem', fontFamily:'DM Mono, monospace', fontSize:'0.72rem', color:'var(--gold)' }}>
                            ⚙ Set TL to <strong>{calc.tlIpmSetting} ipm</strong> for spans {pass.span_from}–{pass.span_to}.
                            End tower travels {calc.endTowerTravelIn}in per move.
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
            <div style={{ background:'rgba(15,26,10,0.6)', border:'1px solid var(--moss)', borderRadius:10, padding:'1rem' }}>
              <div className="card-sub mb-2">Plan Summary</div>
              <div className="grid-4">
                {[
                  ['Active Passes',  passes.filter(p=>p.status!=='skipped').length],
                  ['Target Ac/Day',  targetCalc?.targetAcresPerDay.toFixed(3)],
                  ['Total Cycle',    totalCycleDays.toFixed(1)+' days'],
                  ['Spans Resting',  machineSpans.filter(s=>!passes.some(p=>p.status!=='skipped'&&s.number>=p.span_from&&s.number<=p.span_to)).length],
                ].map(([l,v]) => (
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

      {/* ── STEP 4: Schedule Preview ── */}
      {activeCalc && schedule.length > 0 && (
        <div className="card">
          <div className="card-title mb-2">Step 4 — Schedule Preview</div>
          <div style={{ fontSize:'0.78rem', color:'var(--subtext)', marginBottom:'0.75rem' }}>
            Schedule for Pass {activePassIdx+1} based on plan settings. Showing Pass {activePassIdx+1} — click a pass above to preview others.
          </div>

          <div className="grid-4" style={{ marginBottom:'0.75rem' }}>
            <div className="field">
              <label className="label">🌅 Sunrise</label>
              <input className="input" type="time" value={form.sunrise_time} onChange={e => set('sunrise_time', e.target.value)} />
            </div>
            <div className="field">
              <label className="label">🌇 Sunset</label>
              <input className="input" type="time" value={form.sunset_time} onChange={e => set('sunset_time', e.target.value)} />
            </div>
          </div>

          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
              <thead>
                <tr>
                  {['Move','Start','Stop','Run','Rest','Period'].map(h => (
                    <th key={h} style={{ background:'var(--bark2)', color:'var(--harvest)', padding:'6px 8px', textAlign:'left', fontFamily:'DM Mono, monospace', fontSize:'0.56rem', letterSpacing:'0.07em', textTransform:'uppercase', borderBottom:'1px solid #3a5520' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.map((mv) => (
                  <tr key={mv.moveNum}>
                    <td style={{ padding:'6px 8px', color:mv.period?.color, fontFamily:'DM Mono, monospace', fontWeight:600 }}>#{mv.moveNum}</td>
                    <td style={{ padding:'6px 8px', color:'var(--cream)', fontFamily:'DM Mono, monospace' }}>{mv.startTime}</td>
                    <td style={{ padding:'6px 8px', color:'var(--subtext)' }}>{mv.stopTime}</td>
                    <td style={{ padding:'6px 8px', color:'var(--subtext)' }}>{mv.runTime}m</td>
                    <td style={{ padding:'6px 8px', color:mv.restToNext>120?'var(--gold)':'var(--subtext)', fontWeight:mv.restToNext>120?600:400 }}>
                      {mv.restToNext!=null?`${mv.restToNext}m`:'—'}
                      {mv.restToNext>120 && <span style={{ marginLeft:3, fontSize:'0.55rem' }}>loaf</span>}
                    </td>
                    <td style={{ padding:'6px 8px', fontSize:'0.66rem', color:mv.period?.color }}>{mv.period?.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Save */}
      {passes.length > 0 && (
        <div className="flex gap-1 mb-2">
          <button className="btn btn-primary" onClick={savePlan} disabled={saving}>
            {saving ? <><span className="spinner" /> Saving…</> : editingId ? '✓ Update Plan' : '✓ Save Grazing Plan'}
          </button>
          <button className="btn btn-secondary" onClick={() => { setView('list'); reset() }}>Cancel</button>
        </div>
      )}
    </div>
  )
}
