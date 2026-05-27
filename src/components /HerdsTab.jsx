import { useState } from 'react'
import { useHerds } from '../hooks/useData'

const empty = { name: '', pairs: 100, avg_weight: 1200 }

export default function HerdsTab() {
  const { data: herds, insert, update, remove, loading } = useHerds()
  const [form, setForm] = useState({ ...empty })
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const totalLW = form.pairs * form.avg_weight * 2

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editing) await update(editing, form)
      else await insert(form)
      setForm({ ...empty })
      setEditing(null)
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  function editHerd(h) {
    setForm({ name: h.name, pairs: h.pairs, avg_weight: h.avg_weight })
    setEditing(h.id)
  }

  if (loading) return <div className="text-muted text-sm" style={{ padding: '2rem' }}>Loading…</div>

  return (
    <div>
      <div className="section-heading">Herd Profiles</div>
      <div className="section-desc">Record cow-calf pairs and calculate total liveweight for stock density.</div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">{editing ? 'Edit Herd' : 'Add Herd'}</div>
              <div className="card-sub">Cow-Calf Pairs</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="field">
              <label className="label">Herd Name</label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Spring Pairs" />
            </div>
            <div className="grid-2">
              <div className="field">
                <label className="label">Pairs / Head</label>
                <input className="input" type="number" min={1} value={form.pairs} onChange={e => set('pairs', +e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Avg Cow Weight (lb)</label>
                <input className="input" type="number" value={form.avg_weight} onChange={e => set('avg_weight', +e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid-2 mb-2">
            <div className="stat-box">
              <div className="stat-val">{form.pairs}</div>
              <div className="stat-lbl">Pairs</div>
            </div>
            <div className="stat-box">
              <div className="stat-val">{totalLW.toLocaleString()}</div>
              <div className="stat-lbl">Total Liveweight (lb)</div>
            </div>
          </div>

          <div className="flex gap-1">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : editing ? '✓ Update' : '+ Save Herd'}
            </button>
            {editing && <button className="btn btn-secondary" onClick={() => { setForm({ ...empty }); setEditing(null) }}>Cancel</button>}
          </div>
        </div>

        <div>
          {herds.length === 0 && <div className="text-muted text-sm">No herds saved yet.</div>}
          {herds.map(h => (
            <div className="list-item" key={h.id} onClick={() => editHerd(h)}>
              <div>
                <div className="flex gap-1" style={{ alignItems: 'center' }}>
                  <span>🐄</span>
                  <strong>{h.name}</strong>
                </div>
                <div className="text-sm text-muted mt-1">
                  {h.pairs} pairs · {h.avg_weight} lb avg · {h.total_lw?.toLocaleString()} lb total
                </div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); remove(h.id) }}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
