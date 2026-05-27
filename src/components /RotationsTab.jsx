import { useState, useRef } from 'react'
import { useRotations, useObservations, useSchedules, useMachines, useHerds, uploadPhoto } from '../hooks/useData'
import { useAuth } from '../hooks/useAuth'
import { validateRecommendation } from '../lib/grazing'

const PHOTO_TYPES = [
  { id: 'pre_graze',  label: 'Pre-Graze',   icon: '🌿', desc: 'Height, density, maturity, bloat risk' },
  { id: 'post_graze', label: 'Post-Graze',  icon: '🐾', desc: 'Residual, uniformity, trampling' },
  { id: 'recovery',   label: 'Recovery',    icon: '🌱', desc: '3–7 days after — regrowth speed' },
  { id: 'cattle',     label: 'Cattle',      icon: '🐄', desc: 'Condition, gut fill, stress' },
  { id: 'manure',     label: 'Manure',      icon: '💧', desc: 'Consistency, looseness concern' },
]

const ACTION_DISPLAY = {
  add_move:       { label: 'Add 1 Move',           color: 'var(--sage)',  bg: '#0a2010', icon: '⬆' },
  hold:           { label: 'Hold Current Plan',     color: 'var(--sky)',   bg: '#0a1a2a', icon: '✓' },
  remove_move:    { label: 'Remove 1 Move',         color: 'var(--amber)', bg: '#2a1a00', icon: '⬇' },
  adjust_timing:  { label: 'Adjust Timing Only',    color: 'var(--straw)', bg: '#2a2010', icon: '⏱' },
  flag_risk:      { label: 'Flag Risk',             color: 'var(--rust)',  bg: '#2a0a00', icon: '⚠' },
  need_more_info: { label: 'Need Better Photos',    color: '#888',         bg: '#1a1a1a', icon: '?' },
}

function ObserveView({ rotation, machines, herds, schedules, onBack }) {
  const { user } = useAuth()
  const { insert: insertObs } = useObservations(rotation.id)
  const [photoType, setPhotoType] = useState('pre_graze')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [pass, setPass] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState([])
  const [aiResult, setAiResult] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()

  const machine  = machines.find(m => m.id === rotation.machine_id)
  const herd     = herds.find(h => h.id === rotation.herd_id)
  const schedule = schedules.find(s => s.id === rotation.active_schedule_id || s.id === rotation.base_schedule_id)
  const ptInfo   = PHOTO_TYPES.find(p => p.id === photoType)

  function addFiles(files) {
    Array.from(files).forEach(f => {
      const reader = new FileReader()
      reader.onload = e => setPhotos(ps => [...ps, {
        id: Date.now().toString() + Math.random(),
        url: e.target.result,
        base64: e.target.result.split(',')[1],
        mimeType: f.type || 'image/jpeg',
        file: f, name: f.name,
      }])
      reader.readAsDataURL(f)
    })
  }

  async function runAI() {
    if (photos.length === 0) return
    setAiLoading(true)
    setAiResult(null)
    const photo = photos[photos.length - 1]

    const context = `Photo type: ${photoType}
Grazing goal: ${rotation.goal}
Machine: ${machine?.name || 'unknown'}, ${machine?.type}, ${machine?.spans} spans × ${machine?.span_length}ft
Herd: ${herd?.name}, ${herd?.pairs} pairs, ${herd?.total_lw?.toLocaleString()} lb total liveweight
Current moves per rotation: ${schedule?.moves_per_rotation || '?'}
Acres per move: ${schedule?.acres_per_move || '?'}
Observer notes: ${notes || 'none'}
Date: ${date}`

    const systemPrompt = `You are an expert grazing management agronomist for irrigated pivot and linear grazing systems.
Analyze the photo and return ONLY valid JSON. No markdown. No preamble:
{"photo_type":"${photoType}","estimated_pre_graze_height_inches":null,"estimated_post_graze_residual_inches":null,"estimated_removal_percent":null,"grazing_uniformity_score_1_to_10":null,"trampling_score_1_to_10":null,"bare_soil_visibility":"none","grass_density_score_1_to_10":null,"legume_dominance_score_1_to_10":null,"stand_maturity":"vegetative","bloat_risk":"low","cattle_condition_notes":"","manure_notes":"","confidence":"medium","recommended_action":"hold","recommended_move_change":0,"plain_language_summary":"","reasoning":""}
Rules: residual<4→add_move; residual 4-5→hold; residual 6-7→remove_move; residual>7→remove_move; topping+residual<6→add_move; trampling>=7→flag_risk; high legume+wet→bloat_risk:high; cattle hollow→flag_risk; low quality photo→need_more_info`

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: photo.mimeType, data: photo.base64 } },
            { type: 'text', text: context },
          ]}],
        })
      })
      const data = await resp.json()
      const raw = data.content?.find(c => c.type === 'text')?.text || '{}'
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
      const validated = validateRecommendation(parsed, rotation.goal, schedule?.moves_per_rotation || 6)
      setAiResult({ ...parsed, ...validated })
    } catch (e) {
      setAiResult({ recommended_action: 'need_more_info', plain_language_summary: 'Analysis failed: ' + e.message, confidence: 'low' })
    }
    setAiLoading(false)
  }

  async function saveObservation(decision) {
    setSaving(true)
    try {
      const uploadedPhotos = []
      for (const p of photos) {
        if (p.file) {
          try {
            const { url } = await uploadPhoto(user.id, p.file)
            uploadedPhotos.push({ url, name: p.name })
          } catch {
            uploadedPhotos.push({ url: p.url, name: p.name })
          }
        }
      }
      await insertObs({
        date, photo_type: photoType, pass, notes,
        photos: uploadedPhotos,
        ai_result: aiResult,
        user_decision: decision,
      })
      setPhotos([]); setAiResult(null); setNotes(''); setPass('')
      onBack()
    } catch (e) { alert('Error saving: ' + e.message) }
    setSaving(false)
  }

  const action = aiResult ? ACTION_DISPLAY[aiResult.recommended_action] || ACTION_DISPLAY.hold : null

  return (
    <div>
      <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '1rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back</button>
        <div className="section-heading" style={{ fontSize: '1.3rem', margin: 0 }}>Field Observation</div>
        {machine && <span className="badge">{machine.name}</span>}
      </div>

      <div className="grid-2">
        <div>
          <div className="card">
            <div className="card-title mb-2">Photo Type</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
              {PHOTO_TYPES.map(pt => (
                <button key={pt.id} onClick={() => setPhotoType(pt.id)} style={{
                  background: photoType === pt.id ? 'var(--moss)' : 'var(--bark)',
                  border: `1px solid ${photoType === pt.id ? 'var(--sage)' : '#5a4530'}`,
                  borderRadius: 8, padding: '10px', cursor: 'pointer', textAlign: 'left',
                }}>
                  <div style={{ fontSize: '1.2rem' }}>{pt.icon}</div>
                  <div style={{ color: 'var(--cream)', fontSize: '0.78rem', fontWeight: 500 }}>{pt.label}</div>
                  <div style={{ color: 'var(--straw)', fontSize: '0.62rem', marginTop: 2 }}>{pt.desc}</div>
                </button>
              ))}
            </div>

            <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
              <div className="field"><label className="label">Date</label>
                <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
              <div className="field"><label className="label">Pass / Strip</label>
                <input className="input" placeholder="e.g. Pass 2, Strip 4" value={pass} onChange={e => setPass(e.target.value)} /></div>
            </div>

            <div className="field" style={{ marginBottom: '0.75rem' }}>
              <label className="label">Observer Notes</label>
              <textarea className="textarea" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Height estimate, cattle behavior, soil conditions…" />
            </div>

            <div className={`photo-drop ${dragOver ? 'drag-over' : ''}`}
              onClick={() => fileRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>{ptInfo?.icon || '📷'}</div>
              <div style={{ color: 'var(--straw)', fontSize: '0.8rem' }}>Upload {ptInfo?.label} photo</div>
              <div style={{ color: 'var(--bark)', fontSize: '0.65rem', marginTop: 3 }}>Click or drag · JPG, PNG, HEIC</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />

            {photos.length > 0 && (
              <div className="photo-grid mt-2">
                {photos.map(p => (
                  <div key={p.id} className="photo-thumb">
                    <img src={p.url} alt={p.name} />
                    <button className="photo-del" onClick={() => setPhotos(ps => ps.filter(x => x.id !== p.id))}>✕</button>
                  </div>
                ))}
              </div>
            )}

            <button className="btn btn-primary btn-full mt-2" onClick={runAI} disabled={photos.length === 0 || aiLoading}>
              {aiLoading ? <><span className="spinner" /> Analyzing…</> : '🤖 Analyze with AI'}
            </button>
          </div>
        </div>

        <div>
          {!aiResult && !aiLoading && (
            <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🔬</div>
              <div className="text-muted text-sm">Upload a photo and click Analyze to get a structured AI assessment with move recommendations.</div>
            </div>
          )}
          {aiLoading && (
            <div className="ai-box">
              <div className="ai-box-header"><div className="ai-dot" /><span className="mono text-sm text-sage">Analyzing {ptInfo?.label} photo…</span><div className="spinner" /></div>
            </div>
          )}
          {aiResult && !aiLoading && (() => {
            const act = ACTION_DISPLAY[aiResult.recommended_action] || ACTION_DISPLAY.hold
            return (
              <div>
                <div style={{ background: act.bg, border: `2px solid ${act.color}`, borderRadius: 12, padding: '1.1rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '1.8rem' }}>{act.icon}</span>
                    <div>
                      <div style={{ color: act.color, fontFamily: 'DM Mono, monospace', fontSize: '0.95rem', fontWeight: 600 }}>{act.label}</div>
                      <div style={{ color: 'var(--straw)', fontSize: '0.65rem', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        AI Recommendation · {aiResult.confidence} confidence
                      </div>
                    </div>
                  </div>
                  <div style={{ color: 'var(--cream)', fontSize: '0.85rem', lineHeight: 1.6 }}>{aiResult.plain_language_summary}</div>
                  {aiResult.reasoning && <div style={{ color: 'var(--straw)', fontSize: '0.75rem', marginTop: '0.4rem', fontStyle: 'italic' }}>{aiResult.reasoning}</div>}
                  {aiResult.warnings?.length > 0 && aiResult.warnings.map((w, i) => (
                    <div key={i} style={{ marginTop: '0.4rem', color: 'var(--rust)', fontSize: '0.78rem' }}>⚠ {w}</div>
                  ))}
                </div>

                <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
                  <div className="card-sub mb-2">Assessment Metrics</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.75rem' }}>
                    {[
                      ['Pre-Graze Height',    aiResult.estimated_pre_graze_height_inches != null ? aiResult.estimated_pre_graze_height_inches + '"' : '—'],
                      ['Post-Graze Residual', aiResult.estimated_post_graze_residual_inches != null ? aiResult.estimated_post_graze_residual_inches + '"' : '—'],
                      ['Removal %',           aiResult.estimated_removal_percent != null ? aiResult.estimated_removal_percent + '%' : '—'],
                      ['Uniformity',          aiResult.grazing_uniformity_score_1_to_10 != null ? aiResult.grazing_uniformity_score_1_to_10 + '/10' : '—'],
                      ['Trampling',           aiResult.trampling_score_1_to_10 != null ? aiResult.trampling_score_1_to_10 + '/10' : '—'],
                      ['Bare Soil',           aiResult.bare_soil_visibility || '—'],
                      ['Stand Maturity',      aiResult.stand_maturity || '—'],
                      ['Bloat Risk',          aiResult.bloat_risk || '—'],
                    ].map(([l, v]) => (
                      <div key={l} style={{ background: 'var(--bark)', borderRadius: 6, padding: '6px 9px' }}>
                        <div style={{ color: 'var(--straw)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div>
                        <div style={{ color: v === 'high' ? 'var(--rust)' : v === 'moderate' ? 'var(--amber)' : 'var(--cream)', fontWeight: 500 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card" style={{ padding: '1rem' }}>
                  <div className="card-sub mb-2">Your Decision</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <button className="btn btn-primary btn-full" onClick={() => saveObservation('accepted')} disabled={saving}>
                      {saving ? <><span className="spinner" /> Saving…</> : `✓ Accept — ${act.label}`}
                    </button>
                    <button className="btn btn-secondary btn-full" onClick={() => saveObservation('noted')}>📋 Note Only</button>
                    <button className="btn btn-secondary btn-full" style={{ color: 'var(--rust)' }} onClick={() => saveObservation('rejected')}>✕ Reject</button>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

function HistoryView({ rotation, machines, onBack }) {
  const { data: obs } = useObservations(rotation.id)
  const machine = machines.find(m => m.id === rotation.machine_id)

  return (
    <div>
      <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '1rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back</button>
        <div className="section-heading" style={{ fontSize: '1.3rem', margin: 0 }}>Observation History</div>
        {machine && <span className="badge">{machine.name}</span>}
      </div>
      {obs.length === 0 && <div className="text-muted text-sm">No observations yet.</div>}
      {obs.map(o => {
        const pt  = PHOTO_TYPES.find(p => p.id === o.photo_type)
        const act = o.ai_result ? ACTION_DISPLAY[o.ai_result.recommended_action] : null
        const decColor = o.user_decision === 'accepted' ? 'var(--sage)' : o.user_decision === 'rejected' ? 'var(--rust)' : 'var(--straw)'
        return (
          <div key={o.id} className="card">
            <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
              <span>{pt?.icon}</span>
              <strong style={{ color: 'var(--cream)' }}>{pt?.label}</strong>
              <span className="badge">{o.date}</span>
              {o.pass && <span className="badge badge-amber">{o.pass}</span>}
              {act && <span style={{ fontSize: '0.7rem', color: act.color, fontFamily: 'DM Mono, monospace' }}>{act.icon} {act.label}</span>}
              <span style={{ fontSize: '0.7rem', color: decColor, fontFamily: 'DM Mono, monospace' }}>
                {o.user_decision === 'accepted' ? '✓ Accepted' : o.user_decision === 'rejected' ? '✕ Rejected' : '📋 Noted'}
              </span>
            </div>
            {o.notes && <div className="text-sm text-muted mb-1">{o.notes}</div>}
            {o.ai_result?.plain_language_summary && (
              <div style={{ fontSize: '0.82rem', color: 'var(--cream)', fontStyle: 'italic', marginBottom: '0.5rem' }}>
                "{o.ai_result.plain_language_summary}"
              </div>
            )}
            {o.photos?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {o.photos.map((p, i) => (
                  <img key={i} src={p.url} alt={p.name} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bark)' }} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function RotationsTab() {
  const { data: rotations, insert: insertRot, update: updateRot } = useRotations()
  const { data: machines } = useMachines()
  const { data: herds }    = useHerds()
  const { data: schedules } = useSchedules()
  const { data: allObs }   = useObservations(null)

  const [view, setView]     = useState('dashboard')
  const [selRot, setSelRot] = useState(null)
  const [newForm, setNewForm] = useState({ machine_id: '', herd_id: '', base_schedule_id: '', start_date: new Date().toISOString().slice(0, 10), goal: 'production', notes: '' })
  const [saving, setSaving] = useState(false)

  const setN = (k, v) => setNewForm(f => ({ ...f, [k]: v }))

  async function startRotation() {
    if (!newForm.machine_id || !newForm.herd_id) return
    setSaving(true)
    try {
      const rot = await insertRot({ ...newForm, status: 'active', active_schedule_id: newForm.base_schedule_id || null })
      setSelRot(rot)
      setView('dashboard')
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  async function closeRotation(id) {
    if (!confirm('Close this rotation?')) return
    await updateRot(id, { status: 'closed', closed_date: new Date().toISOString().slice(0, 10) })
  }

  if (view === 'new') {
    return (
      <div>
        <div className="section-heading">Start New Rotation</div>
        <div className="section-desc">Create a rotation to track field observations and AI recommendations.</div>
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="field"><label className="label">Machine</label>
              <select className="select" value={newForm.machine_id} onChange={e => setN('machine_id', e.target.value)}>
                <option value="">Select machine…</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></div>
            <div className="field"><label className="label">Herd</label>
              <select className="select" value={newForm.herd_id} onChange={e => setN('herd_id', e.target.value)}>
                <option value="">Select herd…</option>
                {herds.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select></div>
            <div className="field"><label className="label">Base Schedule (optional)</label>
              <select className="select" value={newForm.base_schedule_id} onChange={e => setN('base_schedule_id', e.target.value)}>
                <option value="">No schedule linked</option>
                {schedules.map(s => {
                  const m = machines.find(x => x.id === s.machine_id)
                  return <option key={s.id} value={s.id}>{s.date} — {m?.name}</option>
                })}
              </select></div>
            <div className="grid-2">
              <div className="field"><label className="label">Start Date</label>
                <input className="input" type="date" value={newForm.start_date} onChange={e => setN('start_date', e.target.value)} /></div>
              <div className="field"><label className="label">Grazing Goal</label>
                <select className="select" value={newForm.goal} onChange={e => setN('goal', e.target.value)}>
                  <option value="production">Production Grazing</option>
                  <option value="topping">Topping</option>
                  <option value="stockpile">Stockpile</option>
                  <option value="recovery">Recovery</option>
                </select></div>
            </div>
            <div className="field"><label className="label">Notes</label>
              <textarea className="textarea" rows={2} value={newForm.notes} onChange={e => setN('notes', e.target.value)} /></div>
          </div>
          <div className="flex gap-1 mt-2">
            <button className="btn btn-primary" onClick={startRotation} disabled={saving}>
              {saving ? <><span className="spinner" /> Starting…</> : '🌀 Start Rotation'}
            </button>
            <button className="btn btn-secondary" onClick={() => setView('dashboard')}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  if (view === 'observe' && selRot) {
    return <ObserveView rotation={selRot} machines={machines} herds={herds} schedules={schedules} onBack={() => setView('dashboard')} />
  }

  if (view === 'history' && selRot) {
    return <HistoryView rotation={selRot} machines={machines} onBack={() => setView('dashboard')} />
  }

  const active = rotations.filter(r => r.status === 'active')
  const closed = rotations.filter(r => r.status === 'closed')

  return (
    <div>
      <div className="section-heading">Rotation Dashboard</div>
      <div className="section-desc">Track field observations and AI recommendations through each grazing rotation.</div>

      <button className="btn btn-primary mb-2" onClick={() => setView('new')}>+ Start New Rotation</button>

      {active.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🌀</div>
          <div className="text-muted">No active rotations. Start one to begin tracking field observations.</div>
        </div>
      )}

      {active.map(rot => {
        const machine  = machines.find(m => m.id === rot.machine_id)
        const herd     = herds.find(h => h.id === rot.herd_id)
        const schedule = schedules.find(s => s.id === rot.active_schedule_id || s.id === rot.base_schedule_id)
        const days     = Math.floor((Date.now() - new Date(rot.start_date).getTime()) / 86400000)
        return (
          <div key={rot.id} className="card" style={{ border: '1px solid var(--moss)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>🌀</span>
                  <strong style={{ fontSize: '1rem' }}>{machine?.name || 'Unknown'}</strong>
                  <span className="badge" style={{ borderColor: 'var(--moss)', color: 'var(--meadow)' }}>Active</span>
                  <span className="badge badge-amber">{rot.goal}</span>
                </div>
                <div className="text-sm text-muted">
                  {herd?.name} · Started {rot.start_date} · Day {days + 1}
                  {schedule && ` · ${schedule.moves_per_rotation} moves · ${schedule.acres_per_day} ac/day`}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => closeRotation(rot.id)}>Close</button>
            </div>

            <div className="card-sub mb-2">Field Checkpoints</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '0.4rem', marginBottom: '1rem' }}>
              {PHOTO_TYPES.map(pt => (
                <button key={pt.id} onClick={() => { setSelRot(rot); setView('observe') }}
                  style={{ background: 'var(--bark)', border: '1px solid #5a4530', borderRadius: 8, padding: '8px 4px', cursor: 'pointer', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.3rem' }}>{pt.icon}</div>
                  <div style={{ color: 'var(--cream)', fontSize: '0.62rem', marginTop: 2 }}>{pt.label}</div>
                </button>
              ))}
            </div>

            <div className="grid-4">
              {[['Day', days + 1], ['Moves/Rot', schedule?.moves_per_rotation || '—'], ['Ac/Day', schedule?.acres_per_day || '—'], ['Rotation', schedule ? schedule.full_rotation_days + 'd' : '—']].map(([l, v]) => (
                <div key={l} className="stat-box"><div className="stat-val" style={{ fontSize: '1rem' }}>{v}</div><div className="stat-lbl">{l}</div></div>
              ))}
            </div>

            <div className="flex gap-1 mt-2">
              <button className="btn btn-secondary btn-sm" onClick={() => { setSelRot(rot); setView('history') }}>📋 History</button>
            </div>
          </div>
        )
      })}

      {closed.length > 0 && (
        <div className="card mt-2">
          <div className="card-title mb-2">Past Rotations</div>
          {closed.map(rot => {
            const machine = machines.find(m => m.id === rot.machine_id)
            const herd    = herds.find(h => h.id === rot.herd_id)
            return (
              <div key={rot.id} className="list-item" onClick={() => { setSelRot(rot); setView('history') }}>
                <div>
                  <div className="flex gap-1" style={{ alignItems: 'center' }}>
                    <span>🌀</span><strong>{machine?.name}</strong>
                    <span className="badge">{rot.start_date}</span>
                    <span className="badge badge-amber">{rot.goal}</span>
                  </div>
                  <div className="text-sm text-muted mt-1">{herd?.name}{rot.closed_date && ` · Closed ${rot.closed_date}`}</div>
                </div>
                <span className="text-sm text-sage">View →</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
