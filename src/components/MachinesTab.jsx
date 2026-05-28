import { useState } from 'react'
import { useMachines } from '../hooks/useData'
import { getEndTowerRadius } from '../lib/grazing'

const defaultSpan = (n, len = 158) => ({ number: n, length_ft: len, label: `Span ${n}` })

const emptyMachine = {
  name: '', type: 'pivot', ipm: 20,
  total_spans: 6, run_length_ft: '',
  notes: '',
}

export default function MachinesTab() {
  const { data: machines, insert, update, remove, loading } = useMachines()
  const [form, setForm]       = useState({ ...emptyMachine })
  const [spans, setSpans]     = useState(Array.from({ length: 6 }, (_, i) => defaultSpan(i + 1)))
  const [editing, setEditing] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [showForm, setShowForm] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function updateSpanCount(n) {
    const count = Math.max(1, Math.min(20, parseInt(n) || 1))
    set('total_spans', count)
    setSpans(prev => {
      if (count > prev.length) {
        const last = prev[prev.length - 1]?.length_ft || 158
        return [...prev, ...Array.from({ length: count - prev.length }, (_, i) => defaultSpan(prev.length + i + 1, last))]
      }
      return prev.slice(0, count)
    })
  }

  function updateSpanLength(index, value) {
    setSpans(prev => prev.map((s, i) => i === index ? { ...s, length_ft: parseFloat(value) || 0 } : s))
  }

  function setAllSame(len) {
    setSpans(prev => prev.map(s => ({ ...s, length_ft: parseFloat(len) || 0 })))
  }

  const endTowerRadius = getEndTowerRadius(spans)

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const row = {
        name: form.name, type: form.type, ipm: form.ipm,
        spans: JSON.stringify(spans),
        total_spans: spans.length,
        end_tower_radius_ft: endTowerRadius,
        field_width_ft: endTowerRadius,
        run_length_ft: form.run_length_ft ? +form.run_length_ft : null,
        notes: form.notes,
      }
      if (editing) await update(editing, row)
      else await insert(row)
      resetForm()
      setShowForm(false)
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  function resetForm() {
    setForm({ ...emptyMachine })
    setSpans(Array.from({ length: 6 }, (_, i) => defaultSpan(i + 1)))
    setEditing(null)
  }

  function editMachine(m) {
    setForm({
      name: m.name, type: m.type, ipm: m.ipm,
      total_spans: m.total_spans,
      run_length_ft: m.run_length_ft || '',
      notes: m.notes || '',
    })
    const savedSpans = typeof m.spans === 'string' ? JSON.parse(m.spans || '[]') : (m.spans || [])
    setSpans(savedSpans.length > 0 ? savedSpans : Array.from({ length: m.total_spans || 6 }, (_, i) => defaultSpan(i + 1)))
    setEditing(m.id)
    setShowForm(true)
    window.scrollTo(0, 0)
  }

  if (loading) return <div className="text-muted text-sm" style={{ padding: '2rem' }}>Loading…</div>

  return (
    <div>
      <div className="section-heading">Machines</div>
      <div className="section-desc">Configure pivot and linear machines. Spans labeled from center outward.</div>

      {/* Machine list */}
      {!showForm && (
        <>
          <button className="btn btn-primary mb-2" onClick={() => { resetForm(); setShowForm(true) }}>
            + Add Machine
          </button>

          {machines.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚙️</div>
              <div className="text-muted text-sm">No machines saved yet. Add your first machine to get started.</div>
            </div>
          )}

          {machines.map(m => {
            const mSpans = typeof m.spans === 'string' ? JSON.parse(m.spans || '[]') : (m.spans || [])
            const r = getEndTowerRadius(mSpans)
            return (
              <div className="card" key={m.id} style={{ cursor: 'pointer' }} onClick={() => editMachine(m)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '1.3rem' }}>{m.type === 'pivot' ? '🔄' : '➡️'}</span>
                      <strong style={{ color: 'var(--cream)', fontFamily: 'Satisfy, cursive', fontSize: '1.1rem' }}>{m.name}</strong>
                      <span className="badge">{m.type}</span>
                      <span className="badge" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>{m.ipm} ipm</span>
                    </div>

                    <div className="grid-4" style={{ marginBottom: '0.75rem' }}>
                      {[
                        ['Spans', m.total_spans],
                        [m.type === 'pivot' ? 'End Tower' : 'Total Width', r + ' ft'],
                        m.type === 'linear' ? ['Run Length', (m.run_length_ft || '—') + ' ft'] : ['IPM', m.ipm],
                        ['Type', m.type === 'pivot' ? 'Center Pivot' : 'Linear'],
                      ].map(([l, v]) => (
                        <div key={l} className="stat-box" style={{ padding: '0.6rem' }}>
                          <div className="stat-val" style={{ fontSize: '0.9rem' }}>{v}</div>
                          <div className="stat-lbl" style={{ fontSize: '0.55rem' }}>{l}</div>
                        </div>
                      ))}
                    </div>

                    {/* Span summary */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {mSpans.map((s, i) => (
                        <div key={i} style={{
                          background: i === mSpans.length - 1 ? 'rgba(240,192,64,0.15)' : 'var(--bark2)',
                          border: `1px solid ${i === mSpans.length - 1 ? 'rgba(240,192,64,0.5)' : '#3a5520'}`,
                          borderRadius: 5, padding: '2px 7px',
                          fontSize: '0.6rem', fontFamily: 'DM Mono, monospace',
                          color: i === mSpans.length - 1 ? 'var(--gold)' : 'var(--subtext)',
                        }}>
                          S{s.number}: {s.length_ft}ft
                          {i === mSpans.length - 1 && ' ★'}
                        </div>
                      ))}
                    </div>
                  </div>

                  <button className="btn btn-danger btn-sm" style={{ marginLeft: '0.75rem' }}
                    onClick={e => { e.stopPropagation(); if (confirm('Delete this machine?')) remove(m.id) }}>✕</button>
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* Form */}
      {showForm && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div className="card-title">{editing ? 'Edit Machine' : 'New Machine'}</div>
            <button className="btn btn-secondary btn-sm" onClick={() => { resetForm(); setShowForm(false) }}>← Back</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="field">
              <label className="label">Machine Name</label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g. Trevor's North Pivot" />
            </div>

            <div className="grid-2">
              <div className="field">
                <label className="label">Type</label>
                <select className="select" value={form.type} onChange={e => set('type', e.target.value)}>
                  <option value="pivot">Center Pivot</option>
                  <option value="linear">Linear / Lateral</option>
                </select>
              </div>
              <div className="field">
                <label className="label">Desired Grazing IPM</label>
                <input className="input" type="number" value={form.ipm}
                  onChange={e => set('ipm', +e.target.value)} placeholder="e.g. 20" />
              </div>
            </div>

            {form.type === 'linear' && (
              <div className="field">
                <label className="label">Run Length (ft)</label>
                <input className="input" type="number" value={form.run_length_ft}
                  onChange={e => set('run_length_ft', e.target.value)} placeholder="e.g. 4300" />
              </div>
            )}
          </div>

          {/* Span builder */}
          <div style={{ background: 'var(--bark)', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
            <div className="card-sub" style={{ marginBottom: '0.75rem' }}>
              Spans — {form.type === 'pivot' ? 'Span 1 = center, Span N = end tower' : 'Span 1 = start end, Span N = far end'}
            </div>

            <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
              <div className="field">
                <label className="label">Number of Spans</label>
                <input className="input" type="number" min={1} max={20} value={form.total_spans}
                  onChange={e => updateSpanCount(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Set All Same Length (ft)</label>
                <input className="input" type="number" placeholder="e.g. 158"
                  onChange={e => setAllSame(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 300, overflowY: 'auto' }}>
              {spans.map((span, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    fontFamily: 'DM Mono, monospace', fontSize: '0.68rem',
                    color: i === spans.length - 1 ? 'var(--gold)' : 'var(--grass)',
                    minWidth: 80, padding: '4px 8px',
                    background: i === spans.length - 1 ? 'rgba(240,192,64,0.1)' : 'var(--bark2)',
                    borderRadius: 5,
                    border: `1px solid ${i === spans.length - 1 ? 'rgba(240,192,64,0.3)' : 'transparent'}`,
                  }}>
                    Span {span.number}
                    <div style={{ fontSize: '0.55rem', color: 'var(--subtext)' }}>
                      {i === 0 ? (form.type === 'pivot' ? 'center' : 'start') : i === spans.length - 1 ? 'end tower' : ''}
                    </div>
                  </div>
                  <input className="input" type="number" value={span.length_ft}
                    onChange={e => updateSpanLength(i, e.target.value)}
                    placeholder="ft" style={{ maxWidth: 90 }} />
                  <span style={{ fontSize: '0.72rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>ft</span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
                    r={getEndTowerRadius(spans.slice(0, i + 1))}ft
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="grid-2 mb-2">
            <div className="stat-box">
              <div className="stat-val">{endTowerRadius.toLocaleString()}</div>
              <div className="stat-lbl">{form.type === 'pivot' ? 'End Tower Radius (ft)' : 'Total Width (ft)'}</div>
            </div>
            <div className="stat-box">
              <div className="stat-val">{spans.length}</div>
              <div className="stat-lbl">Total Spans</div>
            </div>
          </div>

          <div style={{ background: 'rgba(110,192,64,0.08)', border: '1px solid rgba(110,192,64,0.2)', borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--subtext)' }}>
            📍 Set GPS location in the <strong style={{ color: 'var(--grass)' }}>Field Map</strong> tab after saving.
          </div>

          <div className="flex gap-1">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : editing ? '✓ Update Machine' : '+ Save Machine'}
            </button>
            <button className="btn btn-secondary" onClick={() => { resetForm(); setShowForm(false) }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
