import { useState } from 'react'
import { useMachines } from '../hooks/useData'
import { getEndTowerRadius } from '../lib/grazing'

const defaultSpan = (n) => ({ number: n, length_ft: 158, label: `Span ${n}` })

const emptyMachine = {
  name: '', type: 'pivot', ipm: 20,
  total_spans: 6, run_length_ft: 0,
  center_lat: null, center_lng: null,
  start_lat: null, start_lng: null,
  end_lat: null, end_lng: null,
  notes: '',
}

export default function MachinesTab() {
  const { data: machines, insert, update, remove, loading } = useMachines()
  const [form, setForm] = useState({ ...emptyMachine })
  const [spans, setSpans] = useState(Array.from({ length: 6 }, (_, i) => defaultSpan(i + 1)))
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showMap, setShowMap] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function updateSpanCount(n) {
    const count = Math.max(1, Math.min(20, parseInt(n) || 1))
    set('total_spans', count)
    setSpans(prev => {
      if (count > prev.length) {
        const last = prev[prev.length - 1]?.length_ft || 158
        return [...prev, ...Array.from({ length: count - prev.length }, (_, i) => ({
          number: prev.length + i + 1,
          length_ft: last,
          label: `Span ${prev.length + i + 1}`
        }))]
      }
      return prev.slice(0, count)
    })
  }

  function updateSpanLength(index, value) {
    setSpans(prev => prev.map((s, i) => i === index ? { ...s, length_ft: parseFloat(value) || 0 } : s))
  }

  function setAllSpansSameLength(len) {
    setSpans(prev => prev.map(s => ({ ...s, length_ft: parseFloat(len) || 0 })))
  }

  const endTowerRadius = getEndTowerRadius(spans)
  const totalFieldWidth = spans.reduce((s, sp) => s + sp.length_ft, 0)

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const row = {
        ...form,
        spans: JSON.stringify(spans),
        total_spans: spans.length,
        end_tower_radius_ft: endTowerRadius,
        field_width_ft: totalFieldWidth,
      }
      if (editing) await update(editing, row)
      else await insert(row)
      setForm({ ...emptyMachine })
      setSpans(Array.from({ length: 6 }, (_, i) => defaultSpan(i + 1)))
      setEditing(null)
    } catch (e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  function editMachine(m) {
    setForm({
      name: m.name, type: m.type, ipm: m.ipm,
      total_spans: m.total_spans, run_length_ft: m.run_length_ft || 0,
      center_lat: m.center_lat, center_lng: m.center_lng,
      start_lat: m.start_lat, start_lng: m.start_lng,
      end_lat: m.end_lat, end_lng: m.end_lng,
      notes: m.notes || '',
    })
    const savedSpans = typeof m.spans === 'string' ? JSON.parse(m.spans) : m.spans
    setSpans(savedSpans || Array.from({ length: m.total_spans }, (_, i) => defaultSpan(i + 1)))
    setEditing(m.id)
  }

  if (loading) return <div className="text-muted text-sm" style={{ padding: '2rem' }}>Loading…</div>

  return (
    <div>
      <div className="section-heading">Machine Profiles</div>
      <div className="section-desc">Configure pivot and linear machines. Label spans from center (Span 1) outward.</div>

      <div className="grid-2">
        {/* ── Form ── */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: '1rem' }}>{editing ? 'Edit Machine' : 'Add Machine'}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="field">
              <label className="label">Machine Name</label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Trevor's North Pivot" />
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
                <input className="input" type="number" value={form.ipm} onChange={e => set('ipm', +e.target.value)} placeholder="e.g. 20" />
              </div>
            </div>

            {form.type === 'linear' && (
              <div className="field">
                <label className="label">Run Length (ft)</label>
                <input className="input" type="number" value={form.run_length_ft} onChange={e => set('run_length_ft', +e.target.value)} placeholder="e.g. 2000" />
              </div>
            )}
          </div>

          {/* ── Span Builder ── */}
          <div style={{ background: 'var(--bark)', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
            <div className="card-sub" style={{ marginBottom: '0.75rem' }}>
              Spans — labeled from {form.type === 'pivot' ? 'center point' : 'start end'} outward
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
                  onChange={e => setAllSpansSameLength(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 280, overflowY: 'auto' }}>
              {spans.map((span, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    fontFamily: 'DM Mono, monospace', fontSize: '0.7rem',
                    color: 'var(--grass)', minWidth: 60,
                    padding: '4px 8px', background: 'var(--bark2)', borderRadius: 5,
                  }}>
                    Span {span.number}
                    {i === 0 && <span style={{ color: 'var(--subtext)', fontSize: '0.58rem', display: 'block' }}>
                      {form.type === 'pivot' ? 'center' : 'start'}
                    </span>}
                    {i === spans.length - 1 && <span style={{ color: 'var(--gold)', fontSize: '0.58rem', display: 'block' }}>
                      end tower
                    </span>}
                  </div>
                  <input
                    className="input"
                    type="number"
                    value={span.length_ft}
                    onChange={e => updateSpanLength(i, e.target.value)}
                    placeholder="ft"
                    style={{ maxWidth: 100 }}
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>ft</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--subtext)', marginLeft: 4, fontFamily: 'DM Mono, monospace' }}>
                    r={getEndTowerRadius(spans.slice(0, i + 1))} ft
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Summary stats ── */}
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

          {/* ── GPS pin drop note ── */}
          <div style={{ background: 'rgba(110,192,64,0.1)', border: '1px solid rgba(110,192,64,0.3)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', fontSize: '0.78rem', color: 'var(--subtext)' }}>
            📍 GPS pin drop available in the <strong style={{ color: 'var(--grass)' }}>Field Map</strong> tab after saving this machine.
          </div>

          <div className="flex gap-1">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : editing ? '✓ Update' : '+ Save Machine'}
            </button>
            {editing && <button className="btn btn-secondary" onClick={() => {
              setForm({ ...emptyMachine })
              setSpans(Array.from({ length: 6 }, (_, i) => defaultSpan(i + 1)))
              setEditing(null)
            }}>Cancel</button>}
          </div>
        </div>

        {/* ── Machine list ── */}
        <div>
          {machines.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚙️</div>
              <div className="text-muted text-sm">No machines saved yet.</div>
            </div>
          )}
          {machines.map(m => {
            const mSpans = typeof m.spans === 'string' ? JSON.parse(m.spans || '[]') : (m.spans || [])
            const r = getEndTowerRadius(mSpans)
            return (
              <div className="list-item" key={m.id} onClick={() => editMachine(m)}>
                <div style={{ flex: 1 }}>
                  <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>{m.type === 'pivot' ? '🔄' : '➡️'}</span>
                    <strong style={{ color: 'var(--cream)' }}>{m.name}</strong>
                    <span className="badge">{m.type}</span>
                    <span className="badge" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>{m.ipm} ipm</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
                    {m.total_spans} spans · End tower: {r} ft
                    {m.type === 'linear' && m.run_length_ft ? ` · Run: ${m.run_length_ft} ft` : ''}
                  </div>
                  {/* Span summary */}
                  <div style={{ display: 'flex', gap: 3, marginTop: 5, flexWrap: 'wrap' }}>
                    {mSpans.slice(0, 8).map((s, i) => (
                      <div key={i} style={{
                        background: 'var(--bark2)', borderRadius: 4, padding: '2px 6px',
                        fontSize: '0.6rem', fontFamily: 'DM Mono, monospace',
                        color: i === mSpans.length - 1 ? 'var(--gold)' : 'var(--subtext)',
                        border: i === mSpans.length - 1 ? '1px solid rgba(240,192,64,0.4)' : '1px solid transparent',
                      }}>
                        S{s.number}: {s.length_ft}ft
                      </div>
                    ))}
                    {mSpans.length > 8 && <div style={{ fontSize: '0.6rem', color: 'var(--subtext)', padding: '2px 4px' }}>+{mSpans.length - 8} more</div>}
                  </div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); remove(m.id) }}>✕</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
