import { useState, useEffect } from 'react'
import { useMachines, useHerds, useGrazingPlans, useRotations } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function RotationsTab() {
  const { user }           = useAuth()
  const { data: machines } = useMachines()
  const { data: herds }    = useHerds()
  const { data: plans }    = useGrazingPlans()
  const { data: rotations, insert, update, remove } = useRotations()

  const [selYear, setSelYear]     = useState(new Date().getFullYear())
  const [selMachine, setSelMachine] = useState('')
  const [selRotation, setSelRotation] = useState(null)
  const [view, setView]           = useState('history') // history | detail

  // Group rotations by year then machine
  const years = [...new Set(rotations.map(r => new Date(r.created_at).getFullYear()))].sort((a,b)=>b-a)
  if (!years.includes(new Date().getFullYear())) years.unshift(new Date().getFullYear())

  const filteredRotations = rotations
    .filter(r => new Date(r.created_at).getFullYear() === selYear)
    .filter(r => !selMachine || r.machine_id === selMachine)
    .sort((a,b) => new Date(b.start_date||b.created_at) - new Date(a.start_date||a.created_at))

  // Group by machine
  const byMachine = {}
  filteredRotations.forEach(r => {
    const mid = r.machine_id || 'unknown'
    if (!byMachine[mid]) byMachine[mid] = []
    byMachine[mid].push(r)
  })

  async function closeRotation(id) {
    await update(id, { status: 'completed', end_date: new Date().toISOString().slice(0,10) })
  }

  if (view === 'detail' && selRotation) {
    const machine = machines.find(m => m.id === selRotation.machine_id)
    const herd    = herds.find(h => h.id === selRotation.herd_id)
    const plan    = plans.find(p => p.id === selRotation.plan_id)
    return (
      <div>
        <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'1rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setView('history')}>← Back</button>
          <div className="section-heading" style={{ fontSize:'1.3rem', margin:0 }}>Rotation Detail</div>
        </div>

        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem' }}>
            <div>
              <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'0.3rem' }}>
                <span style={{ fontSize:'1.3rem' }}>{machine?.type==='pivot'?'🔄':'➡️'}</span>
                <strong style={{ color:'var(--cream)', fontFamily:'Satisfy, cursive', fontSize:'1.2rem' }}>{machine?.name}</strong>
                <span className="badge" style={{ borderColor:selRotation.status==='active'?'var(--grass)':'var(--subtext)', color:selRotation.status==='active'?'var(--grass)':'var(--subtext)' }}>{selRotation.status}</span>
              </div>
              <div style={{ fontSize:'0.75rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace' }}>
                {herd?.name} · Rotation #{selRotation.rotation_number} · {new Date(selRotation.start_date||selRotation.created_at).getFullYear()}
              </div>
            </div>
          </div>

          <div className="grid-4 mb-2">
            {[
              ['Start Date',    selRotation.start_date || '—'],
              ['End Date',      selRotation.end_date || 'In progress'],
              ['Total Days',    selRotation.end_date ? Math.floor((new Date(selRotation.end_date)-new Date(selRotation.start_date))/86400000) : '—'],
              ['Goal',          selRotation.goal || '—'],
            ].map(([l,v]) => (
              <div key={l} className="stat-box">
                <div className="stat-val" style={{ fontSize:'0.9rem' }}>{v}</div>
                <div className="stat-lbl">{l}</div>
              </div>
            ))}
          </div>

          {plan && (
            <div style={{ background:'var(--bark)', borderRadius:8, padding:'0.75rem', marginBottom:'0.75rem' }}>
              <div className="card-sub mb-1">Grazing Plan</div>
              <div style={{ fontSize:'0.75rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace' }}>
                {plan.total_passes} passes · {plan.total_cycle_days}d planned cycle ·
                {plan.forage_dm_per_acre} lb/ac entry · {plan.target_acres_per_day?.toFixed(2)} ac/day target
              </div>
            </div>
          )}

          {selRotation.notes && (
            <div style={{ fontSize:'0.82rem', color:'var(--cream)', background:'var(--bark)', borderRadius:7, padding:'0.6rem 0.75rem' }}>
              {selRotation.notes}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="section-heading">Rotation History</div>
      <div className="section-desc">Complete record of every rotation by year and field. Track forage improvement over time.</div>

      {/* Year + Machine filter */}
      <div className="card" style={{ padding:'0.75rem 1rem', marginBottom:'0.75rem' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:5 }}>
            {years.slice(0,5).map(y => (
              <button key={y} onClick={() => setSelYear(y)} style={{
                background: selYear===y?'var(--moss)':'var(--bark)',
                border:`1px solid ${selYear===y?'var(--grass)':'var(--bark2)'}`,
                borderRadius:6, padding:'5px 12px', cursor:'pointer',
                color: selYear===y?'var(--white)':'var(--subtext)',
                fontFamily:'DM Mono, monospace', fontSize:'0.72rem',
              }}>{y}</button>
            ))}
          </div>
          <select className="select" value={selMachine} onChange={e => setSelMachine(e.target.value)} style={{ maxWidth:200 }}>
            <option value="">All machines</option>
            {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      {filteredRotations.length === 0 && (
        <div className="card" style={{ textAlign:'center', padding:'2.5rem' }}>
          <div style={{ fontSize:'2.5rem', marginBottom:'0.75rem' }}>📋</div>
          <div className="text-muted">No rotations recorded for {selYear}.</div>
          <div style={{ fontSize:'0.78rem', color:'var(--subtext)', marginTop:'0.5rem' }}>
            Rotations are created automatically when you set a grazing plan to Active.
          </div>
        </div>
      )}

      {Object.entries(byMachine).map(([machineId, rots]) => {
        const machine = machines.find(m => m.id === machineId)
        return (
          <div key={machineId} className="card">
            <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'1rem' }}>
              <span style={{ fontSize:'1.2rem' }}>{machine?.type==='pivot'?'🔄':'➡️'}</span>
              <strong style={{ color:'var(--cream)', fontFamily:'Satisfy, cursive', fontSize:'1.1rem' }}>{machine?.name || 'Unknown Machine'}</strong>
              <span className="badge">{rots.length} rotation{rots.length!==1?'s':''}</span>
            </div>

            {rots.map((rot, idx) => {
              const herd = herds.find(h => h.id === rot.herd_id)
              const plan = plans.find(p => p.id === rot.plan_id)
              const days = rot.start_date && rot.end_date
                ? Math.floor((new Date(rot.end_date)-new Date(rot.start_date))/86400000)
                : rot.start_date ? Math.floor((new Date()-new Date(rot.start_date))/86400000) : null
              const statusColor = { active:'var(--grass)', completed:'var(--sky)', paused:'var(--gold)' }

              return (
                <div key={rot.id} style={{
                  background:'var(--bark)', border:'1px solid var(--bark2)',
                  borderRadius:9, padding:'0.75rem', marginBottom:'0.5rem',
                  cursor:'pointer',
                }} onClick={() => { setSelRotation(rot); setView('detail') }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div style={{ flex:1 }}>
                      <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'0.3rem' }}>
                        <span style={{ fontFamily:'DM Mono, monospace', color:'var(--grass)', fontSize:'0.8rem', fontWeight:600 }}>
                          Rotation {rot.rotation_number || idx+1}
                        </span>
                        <span className="badge" style={{ borderColor:statusColor[rot.status]||'var(--subtext)', color:statusColor[rot.status]||'var(--subtext)' }}>
                          {rot.status}
                        </span>
                        <span className="badge badge-amber">{rot.goal || 'production'}</span>
                      </div>
                      <div style={{ fontSize:'0.72rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace', marginBottom:'0.3rem' }}>
                        {rot.start_date} {rot.end_date ? `→ ${rot.end_date}` : '→ present'}
                        {days != null && ` · ${days} days`}
                        {herd && ` · ${herd.name}`}
                      </div>
                      {plan && (
                        <div style={{ fontSize:'0.68rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace' }}>
                          {plan.total_passes} passes · {plan.target_acres_per_day?.toFixed(2)} ac/day · {plan.forage_dm_per_acre} lb/ac entry
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      {rot.status === 'active' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => closeRotation(rot.id)}>
                          ✓ Close
                        </button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => { if(confirm('Delete?')) remove(rot.id) }}>✕</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {/* Year summary */}
      {filteredRotations.length > 0 && (
        <div className="card" style={{ background:'rgba(15,26,10,0.6)', border:'1px solid var(--moss)' }}>
          <div className="card-sub mb-2">{selYear} Summary</div>
          <div className="grid-4">
            {[
              ['Total Rotations',   filteredRotations.length],
              ['Fields Active',     Object.keys(byMachine).length],
              ['Completed',         filteredRotations.filter(r=>r.status==='completed').length],
              ['In Progress',       filteredRotations.filter(r=>r.status==='active').length],
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
  )
}
