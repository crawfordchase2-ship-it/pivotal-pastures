import { useState } from 'react'
import { useSchedules, useMachines, useHerds } from '../hooks/useData'

export default function ReportsTab() {
  const { data: schedules } = useSchedules()
  const { data: machines }  = useMachines()
  const { data: herds }     = useHerds()

  const [selId,    setSelId]    = useState('')
  const [dateFrom, setDateFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [dateTo,   setDateTo]   = useState(new Date().toISOString().slice(0, 10))
  const [selMachineId, setSelMachineId] = useState('all')
  const [selHerdId,    setSelHerdId]    = useState('all')

  const detail  = schedules.find(s => s.id === selId)
  const detailM = detail ? machines.find(m => m.id === detail.machine_id) : null
  const detailH = detail ? herds.find(h => h.id === detail.herd_id) : null
  const detailSchedule = detail?.move_schedule
    ? (typeof detail.move_schedule === 'string' ? JSON.parse(detail.move_schedule) : detail.move_schedule)
    : []

  const filtered = schedules.filter(s => {
    if (s.date < dateFrom || s.date > dateTo) return false
    if (selMachineId !== 'all' && s.machine_id !== selMachineId) return false
    if (selHerdId    !== 'all' && s.herd_id    !== selHerdId)    return false
    return true
  }).sort((a, b) => a.date < b.date ? -1 : 1)

  const totalAcres = filtered.reduce((s, r) => s + parseFloat(r.acres_per_day || 0), 0).toFixed(2)
  const avgDensity = filtered.length
    ? Math.round(filtered.reduce((s, r) => s + (r.alloc_stock_density || 0), 0) / filtered.length)
    : 0

  return (
    <div>
      <div className="section-heading">Grazing Reports</div>
      <div className="section-desc">Generate printable PDF reports with full move schedules and grazing data.</div>

      <div className="card no-print">
        <div className="card-title mb-2">Single Schedule Report</div>
        <div className="field mb-2">
          <label className="label">Select Schedule</label>
          <select className="select" value={selId} onChange={e => setSelId(e.target.value)}>
            <option value="">— Choose a saved schedule —</option>
            {schedules.sort((a,b) => a.date > b.date ? -1 : 1).map(s => {
              const m = machines.find(x => x.id === s.machine_id)
              const h = herds.find(x => x.id === s.herd_id)
              return <option key={s.id} value={s.id}>{s.date} · {m?.name} · {h?.name}</option>
            })}
          </select>
        </div>
        <hr className="divider" />
        <div className="card-title mb-2">Summary Filters</div>
        <div className="grid-4">
          <div className="field"><label className="label">From</label><input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
          <div className="field"><label className="label">To</label><input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
          <div className="field"><label className="label">Machine</label>
            <select className="select" value={selMachineId} onChange={e => setSelMachineId(e.target.value)}>
              <option value="all">All Machines</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
          <div className="field"><label className="label">Herd</label>
            <select className="select" value={selHerdId} onChange={e => setSelHerdId(e.target.value)}>
              <option value="all">All Herds</option>
              {herds.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select></div>
        </div>
        <div className="flex gap-1 mt-2">
          <button className="btn btn-amber" onClick={() => setTimeout(() => window.print(), 120)}>🖨 Print / Save PDF</button>
        </div>
      </div>

      {/* Printable report */}
      <div style={{ background: 'white', borderRadius: 10, padding: '1.5rem', color: '#111', fontFamily: 'Georgia, serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>🌾 Pivotal Pastures</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#555' }}>GRAZING MANAGER · OFFICIAL RECORD</div>
          </div>
          <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.68rem', color: '#555' }}>
            Generated: {new Date().toLocaleDateString()}<br />{new Date().toLocaleTimeString()}
          </div>
        </div>
        <hr style={{ borderColor: '#2d4a1a', borderWidth: 2, marginBottom: '1rem' }} />

        {detail && detailM && detailH && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ background: '#f0f5ea', borderRadius: 6, padding: '0.75rem' }}>
                <div style={{ fontWeight: 'bold', color: '#2d4a1a', marginBottom: 4 }}>Machine</div>
                <div><strong>{detailM.name}</strong> · {detailM.type}</div>
                <div style={{ fontSize: '0.78rem', color: '#555' }}>{detailM.spans} spans · {detailM.span_length} ft/span · {detailM.spans * detailM.span_length} ft total</div>
              </div>
              <div style={{ background: '#f0f5ea', borderRadius: 6, padding: '0.75rem' }}>
                <div style={{ fontWeight: 'bold', color: '#2d4a1a', marginBottom: 4 }}>Herd</div>
                <div><strong>{detailH.name}</strong></div>
                <div style={{ fontSize: '0.78rem', color: '#555' }}>{detailH.pairs} pairs · {detailH.avg_weight} lb avg · {detailH.total_lw?.toLocaleString()} lb total</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.4rem', marginBottom: '1rem' }}>
              {[
                ['Date', detail.date], ['Spans Grazed', detail.spans_grazed],
                ['Speed (IPM)', detail.ipm], ['Min/Move', detail.mins_per_move],
                ['Acres/Move', detail.acres_per_move], ['Acres/Day', detail.acres_per_day],
                ['Alloc Density', (detail.alloc_stock_density?.toLocaleString() || '—') + ' lb/ac'], ['Hrs/Rotation', detail.hrs_per_rotation],
                ['Days/Pass', detail.days_per_pass], ['Passes', detail.num_passes],
                ['Full Rotation', detail.full_rotation_days + ' days'], ['Residual', detail.post_graze_residual ? detail.post_graze_residual + '"' : '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ background: '#eef5e8', borderRadius: 4, padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}>
                  <div style={{ color: '#555', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
                  <div style={{ fontWeight: 'bold', color: '#1a3a0a' }}>{v}</div>
                </div>
              ))}
            </div>

            {detailSchedule.length > 0 && (
              <>
                <div style={{ fontWeight: 'bold', color: '#2d4a1a', marginBottom: '0.4rem', fontSize: '0.85rem' }}>Move Schedule</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginBottom: '1rem' }}>
                  <thead>
                    <tr>{['Move #','Start','Stop','Run','Rest','Cycle','Period'].map(h => (
                      <th key={h} style={{ background: '#2d4a1a', color: 'white', padding: '5px 8px', textAlign: 'left' }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {detailSchedule.map(mv => (
                      <tr key={mv.moveNum} style={{ borderBottom: '1px solid #ddd' }}>
                        <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>#{mv.moveNum}</td>
                        <td style={{ padding: '5px 8px' }}>{mv.startTime}</td>
                        <td style={{ padding: '5px 8px' }}>{mv.stopTime}</td>
                        <td style={{ padding: '5px 8px' }}>{mv.runTime} min</td>
                        <td style={{ padding: '5px 8px' }}>{mv.restToNext != null ? mv.restToNext + ' min' : '—'}</td>
                        <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>{mv.cycleTime} min</td>
                        <td style={{ padding: '5px 8px', fontSize: '0.7rem' }}>{mv.period?.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {(detail.notes || detail.observations) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div><div style={{ fontWeight: 'bold', color: '#2d4a1a', marginBottom: 3, fontSize: '0.82rem' }}>Notes</div>
                  <div style={{ background: '#f9f9f5', border: '1px solid #ddd', borderRadius: 4, padding: '0.5rem', minHeight: 50, fontSize: '0.78rem' }}>{detail.notes || <span style={{ color: '#aaa' }}>None</span>}</div></div>
                <div><div style={{ fontWeight: 'bold', color: '#2d4a1a', marginBottom: 3, fontSize: '0.82rem' }}>Observations</div>
                  <div style={{ background: '#f9f9f5', border: '1px solid #ddd', borderRadius: 4, padding: '0.5rem', minHeight: 50, fontSize: '0.78rem' }}>{detail.observations || <span style={{ color: '#aaa' }}>None</span>}</div></div>
              </div>
            )}
            <hr style={{ borderColor: '#ccc', margin: '1rem 0' }} />
          </>
        )}

        <div style={{ fontWeight: 'bold', color: '#2d4a1a', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
          Summary: {dateFrom} — {dateTo}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
          {[['Entries', filtered.length], ['Total Acres', totalAcres + ' ac'], ['Avg Density', avgDensity.toLocaleString() + ' lb/ac']].map(([l, v]) => (
            <div key={l} style={{ background: '#eef5e8', borderRadius: 6, padding: '0.6rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#2d4a1a' }}>{v}</div>
              <div style={{ fontSize: '0.65rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
            </div>
          ))}
        </div>

        {filtered.length === 0
          ? <div style={{ textAlign: 'center', color: '#999', padding: '1rem' }}>No entries for selected range.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead><tr>{['Date','Machine','Herd','Spans','IPM','Moves','Min/Mv','Ac/Mv','Ac/Day','lb/ac','Days/Pass','Rotation','Residual'].map(h => (
                <th key={h} style={{ background: '#2d4a1a', color: 'white', padding: '4px 7px', textAlign: 'left' }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {filtered.map(s => {
                  const m = machines.find(x => x.id === s.machine_id)
                  const h = herds.find(x => x.id === s.herd_id)
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid #ddd' }}>
                      <td style={{ padding: '4px 7px' }}>{s.date}</td>
                      <td style={{ padding: '4px 7px' }}>{m?.name || '—'}</td>
                      <td style={{ padding: '4px 7px' }}>{h?.name || '—'}</td>
                      <td style={{ padding: '4px 7px' }}>{s.spans_grazed}</td>
                      <td style={{ padding: '4px 7px' }}>{s.ipm}</td>
                      <td style={{ padding: '4px 7px' }}>{s.moves_per_rotation}</td>
                      <td style={{ padding: '4px 7px' }}>{s.mins_per_move}</td>
                      <td style={{ padding: '4px 7px' }}>{s.acres_per_move}</td>
                      <td style={{ padding: '4px 7px', fontWeight: 'bold' }}>{s.acres_per_day}</td>
                      <td style={{ padding: '4px 7px', fontWeight: 'bold' }}>{s.alloc_stock_density?.toLocaleString()}</td>
                      <td style={{ padding: '4px 7px' }}>{s.days_per_pass}</td>
                      <td style={{ padding: '4px 7px' }}>{s.full_rotation_days}d</td>
                      <td style={{ padding: '4px 7px' }}>{s.post_graze_residual ? s.post_graze_residual + '"' : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

        <div style={{ marginTop: '1.25rem', fontSize: '0.65rem', color: '#999', textAlign: 'center', fontFamily: 'monospace' }}>
          Pivotal Pastures Grazing Manager · {new Date().toLocaleDateString()}
        </div>
      </div>
    </div>
  )
}
