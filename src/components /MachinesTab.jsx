import { useState } from 'react'
import { useMachines } from '../hooks/useData'
import { calcPivotArea, calcLinearArea } from '../lib/grazing'

const empty = { name: '', type: 'pivot', spans: 8, span_length: 130, run_length: 1320, move_dist: 50 }

export default function MachinesTab() {
  const { data: machines, insert, update, remove, loading } = useMachines()
  const [form, setForm] = useState({ ...empty })
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const isPivot = form.type === 'pivot'
  const totalLength = form.spans * form.span_length
  const previewArea = isPivot
    ? calcPivotArea(form.spans, form.span_length)
    : calcLinearArea(form.spans, form.span_length, form.run_length)

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await update(editing, form)
      } else {
        await insert(form)
      }
      setForm({ ...empty })
      setEditing(null)
    } catch (e) {
      alert('Error saving: ' + e.message)
    }
    setSaving(false)
  }

  function editMachine(m) {
    setForm({ name: m.name, type: m.type, spans: m.spans, span_length: m.span_length, run_length: m.run_length, move_dist: m.move_dist })
    setEditing(m.id)
  }

  async function deleteMachine(id) {
    if (!confirm('Delete this machine?')) return
    await remove(id)
    if (editing === id) { setForm({ ...empty }); setEditing(null) }
  }

  if (loading) return <div className="text-muted text-sm" style={{ padding: '2rem' }}>Loading…</div>

  return (
    <div>
      <div className="section-heading">Machine Profiles</div>
      <div className="section-desc">Configure pivot and linear irrigation machines used for grazing.</div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">{editing ? 'Edit Machine' : 'Add Machine'}</div>
              <div className="card-sub">Pivot & Linear Systems</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="field">
              <label className="label">Machine Name</label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. North Pivot 1" />
            </div>
            <div className="field">
              <label className="label">Type</label>
              <select className="select" value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="pivot">Center Pivot</option>
                <option value="linear">Linear / Lateral Move</option>
              </select>
            </div>
            <div className="grid-2">
              <div className="field">
                <label className="label">Spans (#)</label>
                <input className="input" type="number" min={1} value={form.spans} onChange={e => set('spans', +e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Span Length (ft)</label>
                <input className="input" type="number" value={form.span_length} onChange={e => set('span_length', +e.target.value)} />
              </div>
            </div>
            {!isPivot && (
              <div className="field">
                <label className="label">Run Length (ft)</label>
                <input className="input" type="number" value={form.run_length} onChange={e => set('run_length', +e.target.value)} />
              </div>
            )}
            <div className="field">
              <label className="label">Default Move Distance (ft)</label>
              <input className="input" type="number" value={form.move_dist} onChange={e => set('move_dist', +e.target.value)} />
            </div>
          </div>

          <div className="grid-2 mb-2">
            <div className="stat-box">
              <div className="stat-val">{totalLength.toLocaleString()}</div>
              <div className="stat-lbl">Total Length (ft)</div>
              <div className="text-sm text-muted mt-1">{form.spans} × {form.span_length} ft</div>
            </div>
            <div className="stat-box">
              <div className="stat-val">{previewArea}</div>
              <div className="stat-lbl">Total Area (ac)</div>
            </div>
          </div>

          <div className="flex gap-1">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : editing ? '✓ Update' : '+ Save Machine'}
            </button>
            {editing && (
              <button className="btn btn-secondary" onClick={() => { setForm({ ...empty }); setEditing(null) }}>Cancel</button>
            )}
          </div>
        </div>

        <div>
          {machines.length === 0 && <div className="text-muted text-sm">No machines saved yet.</div>}
          {machines.map(m => (
            <div className="list-item" key={m.id} onClick={() => editMachine(m)}>
              <div>
                <div className="flex gap-1" style={{ alignItems: 'center' }}>
                  <span>{m.type === 'pivot' ? '🔄' : '➡️'}</span>
                  <strong>{m.name}</strong>
                  <span className="badge">{m.type}</span>
                </div>
                <div className="text-sm text-muted mt-1">
                  {m.spans} spans × {m.span_length} ft = <span className="mono text-sage">{m.spans * m.span_length} ft</span>
                  {m.type === 'pivot'
                    ? ` | ${calcPivotArea(m.spans, m.span_length)} ac`
                    : ` | ${calcLinearArea(m.spans, m.span_length, m.run_length)} ac`}
                </div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); deleteMachine(m.id) }}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
