import { useState } from 'react'
import { useHerds, useAnimals, useWeightRecords } from '../hooks/useData'
import { resolveHerdMetrics, animalsInHerd, calcLiveHerdMetrics, breakdownSummary, breakdownDetailed } from '../lib/animals.js'

// ── Animal class library ───────────────────────────────────────────────────────
const ANIMAL_CLASSES = [
  { id: 'cow_calf_pair',    label: 'Cow-Calf Pair',      intakeRate: 3.1,  hasCalf: true,  calfRate: 3.2, icon: '🐄🐮' },
  { id: 'lactating_cow',   label: 'Lactating Cow',       intakeRate: 3.0,  hasCalf: false, icon: '🐄' },
  { id: 'bred_cow',        label: 'Bred Cow',            intakeRate: 2.2,  hasCalf: false, icon: '🐄' },
  { id: 'open_cow',        label: 'Open Cow',            intakeRate: 2.0,  hasCalf: false, icon: '🐄' },
  { id: 'dry_cow',         label: 'Dry Cow',             intakeRate: 2.0,  hasCalf: false, icon: '🐄' },
  { id: 'bull',            label: 'Bull',                intakeRate: 1.8,  hasCalf: false, icon: '🐂' },
  { id: 'yearling_steer',  label: 'Yearling Steer',      intakeRate: 2.8,  hasCalf: false, icon: '🐃' },
  { id: 'yearling_heifer', label: 'Yearling Heifer',     intakeRate: 2.8,  hasCalf: false, icon: '🐃' },
  { id: 'stocker_calf',    label: 'Stocker Calf',        intakeRate: 3.0,  hasCalf: false, icon: '🐮' },
  { id: 'weaned_calf',     label: 'Weaned Calf',         intakeRate: 3.2,  hasCalf: false, icon: '🐮' },
  { id: 'custom',          label: 'Custom',              intakeRate: 2.5,  hasCalf: false, icon: '🐄' },
]

const emptyClass = {
  id: '',
  classType: 'cow_calf_pair',
  count: 1,
  avgWeight: 1200,
  calfAvgWeight: 350,
  customIntakeRate: 2.5,
  entryBcs: 5,
  targetBcs: 6,
  targetAdg: 0,
  notes: '',
}

// ── Per-class calculations ─────────────────────────────────────────────────────
function calcClass(cls) {
  const def = ANIMAL_CLASSES.find(a => a.id === cls.classType) || ANIMAL_CLASSES[0]
  const intakeRate = cls.classType === 'custom' ? cls.customIntakeRate : def.intakeRate
  const calfRate   = def.calfRate || 0

  const cowLW    = cls.count * cls.avgWeight
  const calfLW   = def.hasCalf ? cls.count * (cls.calfAvgWeight || 350) : 0
  const totalLW  = cowLW + calfLW

  const cowDM    = cowLW * intakeRate / 100
  const calfDM   = def.hasCalf ? calfLW * calfRate / 100 : 0
  const totalDM  = cowDM + calfDM

  const headCount = def.hasCalf ? cls.count * 2 : cls.count

  return {
    def, intakeRate, calfRate,
    cowLW, calfLW, totalLW,
    cowDM, calfDM, totalDM,
    headCount,
  }
}

// ── Herd totals ────────────────────────────────────────────────────────────────
function calcHerdTotals(classes) {
  const calcs = classes.map(c => calcClass(c))
  const totalLW     = calcs.reduce((s, c) => s + c.totalLW, 0)
  const totalDM     = calcs.reduce((s, c) => s + c.totalDM, 0)
  const totalHead   = calcs.reduce((s, c) => s + c.headCount, 0)
  const avgIntake   = totalLW > 0 ? (totalDM / totalLW) * 100 : 0
  return { calcs, totalLW, totalDM, totalHead, avgIntake }
}

export default function HerdsTab() {
  const { data: herds, insert, update, remove, loading } = useHerds()
  const { data: animals } = useAnimals()
  const { data: weightRecords } = useWeightRecords()

  // Map weight records by animal for live herd metrics
  const weightsByAnimal = {}
  weightRecords.forEach(w => {
    if (!weightsByAnimal[w.animal_id]) weightsByAnimal[w.animal_id] = []
    weightsByAnimal[w.animal_id].push(w)
  })

  const [form, setForm]         = useState({ name: '', notes: '' })
  const [classes, setClasses]   = useState([])
  const [editing, setEditing]   = useState(null)
  const [saving, setSaving]     = useState(false)
  const [addingClass, setAddingClass] = useState(false)
  const [newClass, setNewClass] = useState({ ...emptyClass, id: Date.now().toString() })

  const setF  = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setNC = (k, v) => setNewClass(c => ({ ...c, [k]: v }))

  const totals = calcHerdTotals(classes)

  function addAnimalClass() {
    if (!newClass.count || !newClass.avgWeight) return
    setClasses(prev => [...prev, { ...newClass, id: Date.now().toString() }])
    setNewClass({ ...emptyClass, id: Date.now().toString() })
    setAddingClass(false)
  }

  function removeAnimalClass(id) {
    setClasses(prev => prev.filter(c => c.id !== id))
  }

  function updateClass(id, key, value) {
    setClasses(prev => prev.map(c => c.id === id ? { ...c, [key]: value } : c))
  }

  async function save() {
    if (!form.name.trim()) { alert('Herd name is required'); return }
    setSaving(true)
    try {
      const row = {
        name:          form.name,
        notes:         form.notes,
        classes:       JSON.stringify(classes),
        total_head:    totals.totalHead,
        total_lw:      Math.round(totals.totalLW),
        daily_dm:      Math.round(totals.totalDM),
        avg_intake_pct: +totals.avgIntake.toFixed(2),
        // Legacy fields for compatibility
        pairs:         classes.find(c => c.classType === 'cow_calf_pair')?.count || 0,
        avg_weight:    classes[0]?.avgWeight || 0,
      }
      if (editing) await update(editing, row)
      else await insert(row)
      setForm({ name: '', notes: '' })
      setClasses([])
      setEditing(null)
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  function editHerd(h) {
    setForm({ name: h.name, notes: h.notes || '' })
    const savedClasses = h.classes
      ? (typeof h.classes === 'string' ? JSON.parse(h.classes) : h.classes)
      : [{ ...emptyClass, id: Date.now().toString(), count: h.pairs || 1, avgWeight: h.avg_weight || 1200 }]
    setClasses(savedClasses)
    setEditing(h.id)
  }

  const selectedDef = ANIMAL_CLASSES.find(a => a.id === newClass.classType) || ANIMAL_CLASSES[0]

  if (loading) return <div className="text-muted text-sm" style={{ padding: '2rem' }}>Loading…</div>

  return (
    <div>
      <div className="section-heading">Herd Profiles</div>
      <div className="section-desc">
        Build herd profiles from multiple animal classes. Each class gets its own intake rate for accurate daily DM calculation.
      </div>

      <div className="grid-2">
        {/* ── Form ── */}
        <div>
          <div className="card">
            <div className="card-title mb-2">{editing ? 'Edit Herd' : 'New Herd'}</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
              <div className="field">
                <label className="label">Herd Name</label>
                <input className="input" value={form.name} onChange={e => setF('name', e.target.value)}
                  placeholder="e.g. Trevor's Summer Mix" />
              </div>
              <div className="field">
                <label className="label">Notes</label>
                <textarea className="textarea" rows={2} value={form.notes}
                  onChange={e => setF('notes', e.target.value)}
                  placeholder="Field assignment, rotation notes…" />
              </div>
            </div>

            {/* ── Assigned animals from records ── */}
            {editing && (() => {
              const assigned = animalsInHerd(editing, animals)
              if (assigned.length === 0) return (
                <div style={{ background:'var(--bark)', borderRadius:8, padding:'0.75rem', marginBottom:'1rem', fontSize:'0.78rem', color:'var(--subtext)' }}>
                  No individual animals assigned yet. Assign them from the <strong style={{color:'var(--grass)'}}>Animals</strong> tab (use the herd dropdown on each animal), or use the manual class counts below for an estimate.
                </div>
              )
              const live = calcLiveHerdMetrics(assigned, weightsByAnimal)
              const detailed = breakdownDetailed(live.breakdown)
              return (
                <div style={{ background:'rgba(58,122,40,0.08)', border:'1px solid var(--moss)', borderRadius:8, padding:'0.85rem', marginBottom:'1rem' }}>
                  <div className="card-sub mb-2" style={{ color:'var(--grass)' }}>🔗 Assigned Animals ({live.headCount} head — live from records)</div>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:'0.6rem' }}>
                    {detailed.map(d => (
                      <span key={d.sex} style={{ background:'var(--bark)', borderRadius:6, padding:'3px 10px', fontSize:'0.7rem', fontFamily:'DM Mono, monospace', color:'var(--grass)', border:'1px solid var(--moss)' }}>
                        {d.count} {d.label}
                      </span>
                    ))}
                  </div>
                  <div className="grid-4">
                    {[['Head',live.headCount],['Total LW',live.totalLiveweight.toLocaleString()+' lb'],['Avg Intake',live.avgIntakePct+'%'],['Daily DM',live.dailyDmLbs.toLocaleString()+' lb']].map(([l,v])=>(
                      <div key={l} className="stat-box" style={{ padding:'0.5rem' }}>
                        <div className="stat-val" style={{ fontSize:'0.85rem' }}>{v}</div>
                        <div className="stat-lbl" style={{ fontSize:'0.5rem' }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  {live.estimatedCount > 0 && (() => {
                    const needTags = assigned.filter(an => (weightsByAnimal[an.id]||[]).length === 0 && !an.birth_weight).map(an => an.tag)
                    return (
                      <div style={{ fontSize:'0.68rem', color:'var(--gold)', marginTop:'0.5rem' }}>
                        ⚠ {live.estimatedCount} using default weights{needTags.length?': ':''}<strong style={{fontFamily:'DM Mono, monospace'}}>{needTags.join(', ')}</strong>. In the <strong style={{color:'var(--grass)'}}>Animals</strong> tab, use the <strong>⚖ Needs Weight</strong> filter to find them, then add a weight (or just type Current Weight when editing).
                      </div>
                    )
                  })()}
                  <div style={{ fontSize:'0.68rem', color:'var(--subtext)', marginTop:'0.5rem' }}>
                    When animals are assigned, the herd uses these live numbers for grazing. The manual class counts below are only used if no animals are assigned.
                  </div>
                </div>
              )
            })()}

            {/* ── Animal classes list (manual estimate) ── */}
            <div className="card-sub mb-2">Manual Class Counts (estimate — used only if no animals assigned)</div>

            {classes.length === 0 && (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--subtext)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
                No animal classes added yet. Click below to add.
              </div>
            )}

            {classes.map((cls, idx) => {
              const calc = calcClass(cls)
              const def  = calc.def
              return (
                <div key={cls.id} style={{
                  background: 'var(--bark)', border: '1px solid var(--bark2)',
                  borderRadius: 9, padding: '0.75rem', marginBottom: '0.5rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div className="flex gap-1" style={{ alignItems: 'center' }}>
                      <span style={{ fontSize: '1.1rem' }}>{def.icon}</span>
                      <strong style={{ color: 'var(--cream)', fontSize: '0.9rem' }}>{def.label}</strong>
                      <span className="badge">{cls.count} head</span>
                    </div>
                    <button className="btn btn-danger btn-sm" onClick={() => removeAnimalClass(cls.id)}>✕</button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.4rem', marginBottom: '0.5rem' }}>
                    <div className="field">
                      <label className="label">Count</label>
                      <input className="input" type="number" min={1} value={cls.count}
                        onChange={e => updateClass(cls.id, 'count', +e.target.value)} />
                    </div>
                    <div className="field">
                      <label className="label">{def.hasCalf ? 'Cow Weight' : 'Avg Weight'} (lb)</label>
                      <input className="input" type="number" value={cls.avgWeight}
                        onChange={e => updateClass(cls.id, 'avgWeight', +e.target.value)} />
                    </div>
                    {def.hasCalf && (
                      <div className="field">
                        <label className="label">Calf Weight (lb)</label>
                        <input className="input" type="number" value={cls.calfAvgWeight || 350}
                          onChange={e => updateClass(cls.id, 'calfAvgWeight', +e.target.value)} />
                      </div>
                    )}
                    {cls.classType === 'custom' && (
                      <div className="field">
                        <label className="label">Intake %</label>
                        <input className="input" type="number" step="0.1" value={cls.customIntakeRate}
                          onChange={e => updateClass(cls.id, 'customIntakeRate', +e.target.value)} />
                      </div>
                    )}
                  </div>

                  {/* Class summary */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: '0.68rem', fontFamily: 'DM Mono, monospace' }}>
                    <span style={{ color: 'var(--subtext)' }}>
                      LW: <span style={{ color: 'var(--cream)' }}>{calc.totalLW.toLocaleString()} lb</span>
                    </span>
                    <span style={{ color: 'var(--subtext)' }}>
                      Intake: <span style={{ color: 'var(--grass)' }}>{calc.intakeRate}%{def.hasCalf ? ` cow / ${calc.calfRate}% calf` : ''}</span>
                    </span>
                    <span style={{ color: 'var(--subtext)' }}>
                      DM/day: <span style={{ color: 'var(--gold)' }}>{Math.round(calc.totalDM).toLocaleString()} lb</span>
                    </span>
                    {def.hasCalf && (
                      <span style={{ color: 'var(--subtext)' }}>
                        Head: <span style={{ color: 'var(--cream)' }}>{calc.headCount} (pairs + calves)</span>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {/* ── Add animal class ── */}
            {!addingClass ? (
              <button className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center', marginBottom: '1rem' }}
                onClick={() => setAddingClass(true)}>
                + Add Animal Class
              </button>
            ) : (
              <div style={{ background: 'rgba(15,26,10,0.6)', border: '1px solid var(--moss)', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
                <div className="card-sub mb-2">New Animal Class</div>

                {/* Class type selector */}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {ANIMAL_CLASSES.map(a => (
                    <button key={a.id} onClick={() => setNC('classType', a.id)} style={{
                      background: newClass.classType === a.id ? 'var(--moss)' : 'var(--bark2)',
                      border: `1px solid ${newClass.classType === a.id ? 'var(--grass)' : '#3a5520'}`,
                      borderRadius: 7, padding: '6px 10px', cursor: 'pointer',
                      color: newClass.classType === a.id ? 'var(--white)' : 'var(--subtext)',
                      fontFamily: 'DM Mono, monospace', fontSize: '0.68rem',
                      transition: 'all 0.15s',
                    }}>
                      {a.icon} {a.label}
                      <div style={{ fontSize: '0.55rem', color: newClass.classType === a.id ? 'var(--sprout)' : 'var(--bark2)' }}>
                        {a.intakeRate}% intake
                      </div>
                    </button>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: selectedDef.hasCalf ? 'repeat(3,1fr)' : 'repeat(2,1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div className="field">
                    <label className="label">Count</label>
                    <input className="input" type="number" min={1} value={newClass.count}
                      onChange={e => setNC('count', +e.target.value)} placeholder="e.g. 50" />
                  </div>
                  <div className="field">
                    <label className="label">{selectedDef.hasCalf ? 'Cow Weight (lb)' : 'Avg Weight (lb)'}</label>
                    <input className="input" type="number" value={newClass.avgWeight}
                      onChange={e => setNC('avgWeight', +e.target.value)} placeholder="e.g. 1200" />
                  </div>
                  {selectedDef.hasCalf && (
                    <div className="field">
                      <label className="label">Calf Weight (lb)</label>
                      <input className="input" type="number" value={newClass.calfAvgWeight}
                        onChange={e => setNC('calfAvgWeight', +e.target.value)} placeholder="e.g. 350" />
                    </div>
                  )}
                  {newClass.classType === 'custom' && (
                    <div className="field">
                      <label className="label">Custom Intake %</label>
                      <input className="input" type="number" step="0.1" value={newClass.customIntakeRate}
                        onChange={e => setNC('customIntakeRate', +e.target.value)} />
                    </div>
                  )}
                </div>

                <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
                  <div className="field">
                    <label className="label">Entry BCS (1–9)</label>
                    <input className="input" type="number" min={1} max={9} step={0.5} value={newClass.entryBcs}
                      onChange={e => setNC('entryBcs', +e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">Target ADG (lb/day)</label>
                    <input className="input" type="number" step="0.1" value={newClass.targetAdg}
                      onChange={e => setNC('targetAdg', +e.target.value)} placeholder="e.g. 2.5" />
                  </div>
                </div>

                {/* Preview */}
                {newClass.count > 0 && newClass.avgWeight > 0 && (() => {
                  const prev = calcClass(newClass)
                  return (
                    <div style={{ background: 'var(--bark)', borderRadius: 7, padding: '0.6rem', marginBottom: '0.75rem', fontSize: '0.75rem', fontFamily: 'DM Mono, monospace' }}>
                      <span style={{ color: 'var(--subtext)' }}>Preview: </span>
                      <span style={{ color: 'var(--cream)' }}>{prev.headCount} head · </span>
                      <span style={{ color: 'var(--subtext)' }}>LW: </span>
                      <span style={{ color: 'var(--cream)' }}>{prev.totalLW.toLocaleString()} lb · </span>
                      <span style={{ color: 'var(--subtext)' }}>DM: </span>
                      <span style={{ color: 'var(--gold)' }}>{Math.round(prev.totalDM).toLocaleString()} lb/day</span>
                    </div>
                  )
                })()}

                <div className="flex gap-1">
                  <button className="btn btn-primary btn-sm" onClick={addAnimalClass}>+ Add to Herd</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setAddingClass(false)}>Cancel</button>
                </div>
              </div>
            )}

            {/* ── Herd totals ── */}
            {classes.length > 0 && (
              <>
                <hr className="divider" />
                <div className="card-sub mb-2">Herd Summary</div>

                {/* Class breakdown table */}
                <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                    <thead>
                      <tr>
                        {['Class', 'Head', 'LW (lb)', 'Intake %', 'DM/day (lb)'].map(h => (
                          <th key={h} style={{ background: 'var(--bark2)', color: 'var(--harvest)', padding: '6px 10px', textAlign: 'left', fontFamily: 'DM Mono, monospace', fontSize: '0.58rem', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid #3a5520' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {classes.map((cls, i) => {
                        const calc = calcClass(cls)
                        const def  = calc.def
                        return (
                          <tr key={cls.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(46,77,28,0.2)' }}>
                            <td style={{ padding: '6px 10px', color: 'var(--cream)' }}>{def.icon} {def.label}</td>
                            <td style={{ padding: '6px 10px', color: 'var(--cream)', fontFamily: 'DM Mono, monospace' }}>
                              {calc.headCount}
                              {def.hasCalf && <span style={{ color: 'var(--subtext)', fontSize: '0.65rem' }}> ({cls.count}pr)</span>}
                            </td>
                            <td style={{ padding: '6px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--cream)' }}>{calc.totalLW.toLocaleString()}</td>
                            <td style={{ padding: '6px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--grass)' }}>
                              {calc.intakeRate}%
                              {def.hasCalf && <span style={{ color: 'var(--subtext)', fontSize: '0.65rem' }}> / {calc.calfRate}%</span>}
                            </td>
                            <td style={{ padding: '6px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--gold)', fontWeight: 600 }}>{Math.round(calc.totalDM).toLocaleString()}</td>
                          </tr>
                        )
                      })}
                      {/* Totals row */}
                      <tr style={{ borderTop: '2px solid var(--moss)', background: 'rgba(58,122,40,0.15)' }}>
                        <td style={{ padding: '7px 10px', color: 'var(--grass)', fontWeight: 600, fontFamily: 'DM Mono, monospace', fontSize: '0.72rem' }}>TOTAL</td>
                        <td style={{ padding: '7px 10px', color: 'var(--grass)', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{totals.totalHead}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--grass)', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{totals.totalLW.toLocaleString()}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--grass)', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{totals.avgIntake.toFixed(2)}% avg</td>
                        <td style={{ padding: '7px 10px', color: 'var(--gold)', fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: '0.85rem' }}>{Math.round(totals.totalDM).toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Big stat boxes */}
                <div className="grid-4">
                  {[
                    ['Total Head',    totals.totalHead],
                    ['Total LW',      totals.totalLW.toLocaleString() + ' lb'],
                    ['Avg Intake',    totals.avgIntake.toFixed(2) + '%'],
                    ['Daily DM',      Math.round(totals.totalDM).toLocaleString() + ' lb'],
                  ].map(([l, v]) => (
                    <div key={l} className="stat-box">
                      <div className="stat-val" style={{ fontSize: '1rem' }}>{v}</div>
                      <div className="stat-lbl">{l}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <hr className="divider" />
            <div className="flex gap-1">
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <><span className="spinner" /> Saving…</> : editing ? '✓ Update Herd' : '+ Save Herd'}
              </button>
              {editing && (
                <button className="btn btn-secondary" onClick={() => { setForm({ name: '', notes: '' }); setClasses([]); setEditing(null) }}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Herd list ── */}
        <div>
          {herds.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🐄</div>
              <div className="text-muted text-sm">No herds saved yet.</div>
            </div>
          )}
          {herds.map(h => {
            const savedClasses = h.classes
              ? (typeof h.classes === 'string' ? JSON.parse(h.classes) : h.classes)
              : []
            const t = calcHerdTotals(savedClasses)
            const assigned = animalsInHerd(h.id, animals)
            const resolved = resolveHerdMetrics(h, animals, weightsByAnimal)
            const isLinked = resolved.source === 'records'
            return (
              <div className="list-item" key={h.id} onClick={() => editHerd(h)}>
                <div style={{ flex: 1 }}>
                  <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.3rem' }}>
                    <strong style={{ color: 'var(--cream)' }}>{h.name}</strong>
                    <span className="badge">{isLinked ? resolved.headCount : (h.total_head || t.totalHead)} head</span>
                    {isLinked
                      ? <span className="badge" style={{ borderColor:'var(--grass)', color:'var(--grass)' }}>🔗 from records</span>
                      : <span className="badge" style={{ borderColor:'var(--subtext)', color:'var(--subtext)' }}>✎ estimated</span>}
                  </div>
                  {isLinked && assigned.length > 0 && (() => {
                    const liveMetrics = calcLiveHerdMetrics(assigned, weightsByAnimal)
                    const detailed = breakdownDetailed(liveMetrics.breakdown)
                    return (
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:'0.4rem' }}>
                        {detailed.map(d => (
                          <span key={d.sex} style={{ background:'rgba(58,122,40,0.15)', borderRadius:6, padding:'3px 9px', fontSize:'0.65rem', fontFamily:'DM Mono, monospace', color:'var(--grass)', border:'1px solid var(--moss)' }}>
                            {d.count} {d.label}
                          </span>
                        ))}
                        {liveMetrics.estimatedCount > 0 && (() => {
                          const needTags = assigned.filter(an => (weightsByAnimal[an.id]||[]).length === 0 && !an.birth_weight).map(an => an.tag)
                          return (
                            <span style={{ background:'rgba(240,192,64,0.1)', borderRadius:6, padding:'3px 9px', fontSize:'0.6rem', fontFamily:'DM Mono, monospace', color:'var(--gold)', border:'1px solid rgba(240,192,64,0.3)' }}
                              title={needTags.length ? 'Need weights: ' + needTags.join(', ') : ''}>
                              ⚖ {needTags.length ? needTags.slice(0,6).join(', ') + (needTags.length>6?` +${needTags.length-6}`:'') : liveMetrics.estimatedCount + ' need weights'}
                            </span>
                          )
                        })()}
                      </div>
                    )
                  })()}

                  {/* Class pills */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                    {savedClasses.map((cls, i) => {
                      const def = ANIMAL_CLASSES.find(a => a.id === cls.classType) || ANIMAL_CLASSES[0]
                      return (
                        <span key={i} style={{ background: 'var(--bark2)', borderRadius: 5, padding: '2px 7px', fontSize: '0.62rem', fontFamily: 'DM Mono, monospace', color: 'var(--subtext)', border: '1px solid #3a5520' }}>
                          {def.icon} {cls.count} {def.label}
                        </span>
                      )
                    })}
                  </div>

                  <div style={{ fontSize: '0.72rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
                    LW: {(isLinked ? resolved.totalLiveweight : (h.total_lw || t.totalLW)).toLocaleString()} lb
                    {' · '}Avg intake: {(isLinked ? resolved.avgIntakePct : (h.avg_intake_pct || t.avgIntake)).toFixed(2)}%
                    {' · '}DM: {(isLinked ? resolved.dailyDmLbs : (h.daily_dm || Math.round(t.totalDM))).toLocaleString()} lb/day
                  </div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); remove(h.id) }}>✕</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
