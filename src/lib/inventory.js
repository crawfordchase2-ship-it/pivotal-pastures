import { useState, useRef } from 'react'
import { useMachines, useGrazingPlans, usePasses, useForageInventory, useObservations, uploadPhoto } from '../hooks/useData'
import { useAuth } from '../hooks/useAuth'

const ZONES = [
  { id: 'A', label: 'Zone A — Beginning', desc: 'First 1/3 of pass' },
  { id: 'B', label: 'Zone B — Mid Field', desc: 'Middle 1/3 of pass' },
  { id: 'C', label: 'Zone C — End',       desc: 'Final 1/3 of pass' },
]

const CHECKPOINT_TYPES = [
  { id: 'entry', label: 'Rotation Entry', desc: 'Before cattle enter — sets DM baseline' },
  { id: 'mid',   label: 'Mid Rotation',  desc: 'Halfway through — tracks consumption' },
  { id: 'exit',  label: 'Rotation Exit', desc: 'After cattle leave — actual residual' },
]

export default function InventoryTab() {
  const { user }         = useAuth()
  const { data: machines } = useMachines()
  const { data: plans }    = useGrazingPlans()
  const { data: inventory, insert: insertInv } = useForageInventory()
  const { insert: insertObs } = useObservations({})

  const [selPlanId, setSelPlanId]   = useState('')
  const [checkpoint, setCheckpoint] = useState('entry')
  const [photos, setPhotos]         = useState({ A: [], B: [], C: [] })
  const [aiResults, setAiResults]   = useState({ A: null, B: null, C: null })
  const [aiLoading, setAiLoading]   = useState({ A: false, B: false, C: false })
  const [saving, setSaving]         = useState(false)

  const fileRefs = { A: useRef(), B: useRef(), C: useRef() }

  const selPlan = plans.find(p => p.id === selPlanId)
  const selMachine = selPlan ? machines.find(m => m.id === selPlan.machine_id) : null

  function addPhotos(zone, files) {
    Array.from(files).forEach(f => {
      const reader = new FileReader()
      reader.onload = e => setPhotos(prev => ({
        ...prev,
        [zone]: [...prev[zone], {
          id: Date.now() + Math.random(),
          url: e.target.result,
          base64: e.target.result.split(',')[1],
          mimeType: f.type || 'image/jpeg',
          file: f, name: f.name,
        }]
      }))
      reader.readAsDataURL(f)
    })
  }

  async function analyzeZone(zone) {
    const zonePhotos = photos[zone]
    if (zonePhotos.length === 0) return
    setAiLoading(prev => ({ ...prev, [zone]: true }))
    const photo = zonePhotos[zonePhotos.length - 1]

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          system: `You are an expert grazing agronomist. Analyze this ${checkpoint} pasture photo and return ONLY valid JSON:
{"height_inches":0,"dm_lbs_per_acre":0,"grass_density":0,"legume_pct":0,"stand_maturity":"vegetative","bloat_risk":"low","uniformity":0,"trampling":0,"bare_soil":"none","regrowth_rate_per_day":0,"confidence":"medium","notes":""}
For entry photos: estimate height and DM available. For exit photos: estimate residual height, actual removal. regrowth_rate_per_day is inches/day if visible, else 0.`,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: photo.mimeType, data: photo.base64 } },
            { type: 'text', text: `Zone ${zone} ${checkpoint} photo. Estimate forage inventory data.` }
          ]}]
        })
      })
      const data   = await resp.json()
      const raw    = data.content?.find(c => c.type === 'text')?.text || '{}'
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
      setAiResults(prev => ({ ...prev, [zone]: parsed }))
    } catch (e) {
      setAiResults(prev => ({ ...prev, [zone]: { notes: 'Error: ' + e.message } }))
    }
    setAiLoading(prev => ({ ...prev, [zone]: false }))
  }

  // Calculate weighted average inventory
  const zoneResults = ['A','B','C'].map(z => aiResults[z]).filter(Boolean)
  const avgDm = zoneResults.length > 0
    ? zoneResults.reduce((s, r) => s + (r.dm_lbs_per_acre || 0), 0) / zoneResults.length
    : 0
  const avgHeight = zoneResults.length > 0
    ? zoneResults.reduce((s, r) => s + (r.height_inches || 0), 0) / zoneResults.length
    : 0
  const avgRegrowth = zoneResults.length > 0
    ? zoneResults.reduce((s, r) => s + (r.regrowth_rate_per_day || 0), 0) / zoneResults.length
    : 0

  // Estimate total inventory
  const acresPerDay   = selPlan?.target_acres_per_day || 0
  const removePct     = selPlan?.removal_pct || 50
  const usableDm      = avgDm * (removePct / 100)
  const dailyIntake   = selPlan ? (selPlan.target_acres_per_day * avgDm * removePct / 100) : 0
  const daysOfGrazing = usableDm > 0 && acresPerDay > 0 ? (acresPerDay * avgDm * removePct / 100) / (acresPerDay * avgDm * removePct / 100) : 0

  async function saveCheckpoint() {
    if (!selPlanId || zoneResults.length === 0) return
    setSaving(true)
    try {
      await insertInv({
        plan_id:           selPlanId,
        machine_id:        selPlan.machine_id,
        checkpoint_type:   checkpoint,
        checkpoint_date:   new Date().toISOString().slice(0,10),
        photos_taken:      Object.values(photos).flat().length,
        zone_a_dm_per_acre: aiResults.A?.dm_lbs_per_acre || null,
        zone_b_dm_per_acre: aiResults.B?.dm_lbs_per_acre || null,
        zone_c_dm_per_acre: aiResults.C?.dm_lbs_per_acre || null,
        avg_dm_per_acre:   +avgDm.toFixed(0),
        avg_height_inches: +avgHeight.toFixed(1),
        total_acres:       +(acresPerDay * (selPlan?.total_cycle_days || 0)).toFixed(1),
        total_dm_available: +(avgDm * acresPerDay * (selPlan?.total_cycle_days || 0)).toFixed(0),
        usable_dm:         +(usableDm * acresPerDay * (selPlan?.total_cycle_days || 0)).toFixed(0),
        regrowth_rate_per_day: +avgRegrowth.toFixed(2),
        confidence:        zoneResults[0]?.confidence || 'medium',
      })
      // Reset photos for next checkpoint
      setPhotos({ A: [], B: [], C: [] })
      setAiResults({ A: null, B: null, C: null })
      alert('Checkpoint saved!')
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  // Get inventory history
  const planInventory = inventory.filter(i => i.plan_id === selPlanId)
    .sort((a,b) => new Date(b.checkpoint_date) - new Date(a.checkpoint_date))

  return (
    <div>
      <div className="section-heading">Forage Inventory</div>
      <div className="section-desc">
        Track forage dry matter through photo checkpoints at entry, mid-rotation, and exit.
        6 photos across 3 zones builds a statistically valid inventory estimate.
      </div>

      {/* Select plan */}
      <div className="card">
        <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
          <div className="field">
            <label className="label">Active Grazing Plan</label>
            <select className="select" value={selPlanId} onChange={e => setSelPlanId(e.target.value)}>
              <option value="">Select plan…</option>
              {plans.map(p => {
                const m = machines.find(x => x.id === p.machine_id)
                return <option key={p.id} value={p.id}>{m?.name} — {p.goal} ({p.status})</option>
              })}
            </select>
          </div>
          <div className="field">
            <label className="label">Checkpoint Type</label>
            <select className="select" value={checkpoint} onChange={e => setCheckpoint(e.target.value)}>
              {CHECKPOINT_TYPES.map(c => <option key={c.id} value={c.id}>{c.label} — {c.desc}</option>)}
            </select>
          </div>
        </div>

        {selPlan && (
          <div style={{ background: 'rgba(15,26,10,0.6)', border: '1px solid var(--moss)', borderRadius: 8, padding: '0.75rem', fontSize: '0.8rem', color: 'var(--subtext)', marginBottom: '0.75rem' }}>
            <strong style={{ color: 'var(--grass)' }}>{selMachine?.name}</strong> · {selPlan.target_acres_per_day?.toFixed(2)} ac/day · {selPlan.removal_pct}% removal target · {selPlan.total_cycle_days}d cycle
          </div>
        )}
      </div>

      {/* Photo zones */}
      {selPlanId && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {ZONES.map(zone => {
              const zPhotos = photos[zone.id]
              const result  = aiResults[zone.id]
              const loading = aiLoading[zone.id]
              return (
                <div key={zone.id} className="card" style={{ padding: '1rem' }}>
                  <div className="card-sub" style={{ marginBottom: '0.5rem' }}>{zone.label}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--subtext)', marginBottom: '0.75rem' }}>{zone.desc}</div>

                  {/* Drop zone */}
                  <div
                    onClick={() => fileRefs[zone.id].current.click()}
                    style={{ border: '2px dashed var(--bark2)', borderRadius: 8, padding: '1rem', textAlign: 'center', cursor: 'pointer', background: 'rgba(37,61,22,0.2)', marginBottom: '0.5rem' }}
                  >
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>📷</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--subtext)' }}>
                      {zPhotos.length === 0 ? 'Upload 2 photos' : `${zPhotos.length} photo${zPhotos.length !== 1 ? 's' : ''}`}
                    </div>
                  </div>
                  <input ref={fileRefs[zone.id]} type="file" accept="image/*" multiple style={{ display: 'none' }}
                    onChange={e => addPhotos(zone.id, e.target.files)} />

                  {/* Thumbnails */}
                  {zPhotos.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      {zPhotos.map(p => (
                        <img key={p.id} src={p.url} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--bark2)' }} />
                      ))}
                    </div>
                  )}

                  {/* Analyze button */}
                  {zPhotos.length > 0 && !result && (
                    <button className="btn btn-primary btn-sm btn-full" onClick={() => analyzeZone(zone.id)} disabled={loading}>
                      {loading ? <><span className="spinner" /> Analyzing…</> : '🤖 Analyze'}
                    </button>
                  )}

                  {/* AI result */}
                  {result && (
                    <div style={{ background: '#0f2208', border: '1px solid var(--moss)', borderRadius: 6, padding: '0.6rem', fontSize: '0.72rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                        <div><span style={{ color: 'var(--subtext)' }}>Height: </span><span style={{ color: 'var(--cream)', fontFamily: 'DM Mono, monospace' }}>{result.height_inches}"</span></div>
                        <div><span style={{ color: 'var(--subtext)' }}>DM: </span><span style={{ color: 'var(--grass)', fontFamily: 'DM Mono, monospace' }}>{result.dm_lbs_per_acre?.toLocaleString()} lb</span></div>
                        <div><span style={{ color: 'var(--subtext)' }}>Legume: </span><span style={{ color: 'var(--cream)', fontFamily: 'DM Mono, monospace' }}>{result.legume_pct}%</span></div>
                        <div><span style={{ color: 'var(--subtext)' }}>Bloat: </span><span style={{ color: result.bloat_risk === 'high' ? 'var(--alert)' : 'var(--cream)', fontFamily: 'DM Mono, monospace' }}>{result.bloat_risk}</span></div>
                        {result.regrowth_rate_per_day > 0 && (
                          <div style={{ gridColumn: '1/-1' }}>
                            <span style={{ color: 'var(--subtext)' }}>Regrowth: </span>
                            <span style={{ color: 'var(--grass)', fontFamily: 'DM Mono, monospace' }}>{result.regrowth_rate_per_day}"/day</span>
                          </div>
                        )}
                      </div>
                      {result.notes && <div style={{ color: 'var(--subtext)', fontStyle: 'italic', marginTop: 4 }}>{result.notes}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Summary */}
          {zoneResults.length > 0 && (
            <div className="card" style={{ border: '1px solid var(--moss)' }}>
              <div className="card-title mb-2">Inventory Summary</div>
              <div className="grid-4 mb-2">
                {[
                  ['Avg Height',       avgHeight.toFixed(1) + '"'],
                  ['Avg DM/Acre',      avgDm.toFixed(0) + ' lb'],
                  ['Zones Assessed',   zoneResults.length + ' of 3'],
                  ['Regrowth Rate',    avgRegrowth > 0 ? avgRegrowth.toFixed(2) + '"/day' : '—'],
                ].map(([l, v]) => (
                  <div key={l} className="stat-box">
                    <div className="stat-val" style={{ fontSize: '1rem' }}>{v}</div>
                    <div className="stat-lbl">{l}</div>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" onClick={saveCheckpoint} disabled={saving || zoneResults.length === 0}>
                {saving ? <><span className="spinner" /> Saving…</> : `✓ Save ${CHECKPOINT_TYPES.find(c=>c.id===checkpoint)?.label} Checkpoint`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Inventory history */}
      {planInventory.length > 0 && (
        <div className="card mt-2">
          <div className="card-title mb-2">Inventory History</div>
          {planInventory.map(inv => (
            <div key={inv.id} className="list-item">
              <div>
                <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span className="badge" style={{ borderColor: 'var(--grass)', color: 'var(--grass)' }}>{inv.checkpoint_type}</span>
                  <span className="mono text-sm text-muted">{inv.checkpoint_date}</span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--subtext)' }}>{inv.photos_taken} photos · {inv.confidence} confidence</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
                  Avg: {inv.avg_height_inches}" · {inv.avg_dm_per_acre?.toLocaleString()} lb DM/ac
                  {inv.regrowth_rate_per_day > 0 && ` · Regrowth ${inv.regrowth_rate_per_day}"/day`}
                  {inv.zone_a_dm_per_acre && ` · A:${inv.zone_a_dm_per_acre}`}
                  {inv.zone_b_dm_per_acre && ` B:${inv.zone_b_dm_per_acre}`}
                  {inv.zone_c_dm_per_acre && ` C:${inv.zone_c_dm_per_acre}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
