import { useState, useMemo, useEffect, useRef } from 'react'
import {
  useAnimals, useBreedingRecords, useWeightRecords, useBcsRecords, useHealthRecords, useHerds, useMachines,
} from '../hooks/useData'
import {
  SEXES, STATUSES, BREEDS, yearToLetter, suggestNextTag,
  expectedCalvingDate, calvingAlert, daysUntilCalving, ageDisplay, ageInDays, effectiveLactating, isLactating,
  estimateCalfWeight, calcADG, latestWeight, currentWeight,
  cowBreedingSummary, getOffspring, getDam, getSire,
  withdrawalStatus, upcomingVaccinations, bcsTrend, bcsColor, BCS_LABELS,
  calfPerformanceByYear, compositionValid, compositionTotal, compositionDisplay,
  compositionShort, compositionPercent, calcCalfComposition, isCalfSex, promotionSuggestion, PROMOTION_MAP, CALF_SEXES,
} from '../lib/animals.js'

const today = () => new Date().toISOString().slice(0,10)
const curYear = new Date().getFullYear()

export default function AnimalsTab() {
  const { data: animals, insert: insertAnimal, update: updateAnimal, remove: removeAnimal, loading } = useAnimals()
  const { data: breeding, insert: insertBreeding, update: updateBreeding, remove: removeBreeding } = useBreedingRecords()
  const { data: weights, insert: insertWeight, remove: removeWeight } = useWeightRecords()
  const { data: bcs, insert: insertBcs, remove: removeBcs } = useBcsRecords()
  const { data: health, insert: insertHealth, remove: removeHealth } = useHealthRecords()
  const { data: herds } = useHerds()
  const { data: machines } = useMachines()

  const [view, setView]       = useState('list')   // list | detail | add
  const [selId, setSelId]     = useState(null)
  const [filter, setFilter]   = useState('active')  // active | all | cow | bull | calf
  const [search, setSearch]   = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkHerd, setBulkHerd] = useState('')
  const [saving, setSaving]   = useState(false)
  const [subForm, setSubForm] = useState(null)      // breeding | weight | bcs | health

  const allTags = animals.map(a => a.tag)

  const emptyAnimal = {
    tag: '', name: '', breed: 'Angus', sex: 'cow', color: '',
    birth_date: '', birth_weight: '', current_weight: '', sire_tag: '', dam_tag: '',
    registration_number: '', status: 'active', lactating: false, lactating_override: '', notes: '', current_herd_id: '',
    breed_composition: [],
  }
  const [form, setForm] = useState(emptyAnimal)
  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  // Breed composition handlers — auto-split evenly when adding/removing breeds
  const comp = form.breed_composition || []
  // Even split: n breeds → 100/n each, last row absorbs rounding so total = 100
  const evenSplit = rows => {
    const n = rows.length
    if (n === 0) return []
    const each = Math.floor((100 / n) * 10) / 10        // one decimal, e.g. 33.3
    return rows.map((r, i) => ({
      ...r,
      pct: i === n - 1 ? +(100 - each * (n - 1)).toFixed(1) : each,
    }))
  }
  const addCompRow = () => setForm(f => {
    const rows = [...(f.breed_composition||[]), {breed:'South Poll', pct:0}]
    return {...f, breed_composition: evenSplit(rows)}
  })
  const updateCompRow = (i,k,v) => setForm(f => ({...f, breed_composition:(f.breed_composition||[]).map((r,idx)=>idx===i?{...r,[k]:k==='pct'?(parseFloat(v)||0):v}:r)}))
  const removeCompRow = (i) => setForm(f => {
    const rows = (f.breed_composition||[]).filter((_,idx)=>idx!==i)
    // re-balance evenly after removal
    return {...f, breed_composition: evenSplit(rows)}
  })
  const compTotal = compositionTotal(comp)

  // Compute calf composition from current dam/sire tags
  function calcFromParents() {
    const dam = animals.find(a => a.tag === form.dam_tag)
    const sire = animals.find(a => a.tag === form.sire_tag)
    const damComp = dam?.breed_composition ? (typeof dam.breed_composition==='string'?JSON.parse(dam.breed_composition):dam.breed_composition) : (dam?.breed?[{breed:dam.breed,pct:100}]:null)
    const sireComp = sire?.breed_composition ? (typeof sire.breed_composition==='string'?JSON.parse(sire.breed_composition):sire.breed_composition) : (sire?.breed?[{breed:sire.breed,pct:100}]:null)
    return calcCalfComposition(damComp, sireComp)
  }

  // Manual button — calc from parents, alert if not possible
  function suggestCalfComposition() {
    const suggested = calcFromParents()
    if (suggested) {
      setForm(f => ({...f, breed_composition: suggested, breed: suggested[0].breed}))
    } else {
      alert('Set breed composition on the dam and/or sire first to auto-calculate.')
    }
  }

  // Auto-fill calf composition when BOTH parents are entered (new animals only).
  // Tracks the last dam/sire we auto-filled for, so manual edits aren't clobbered
  // unless a parent tag actually changes.
  const autoFilledFor = useRef('')
  useEffect(() => {
    // Only when adding (no selId) and both parents present
    if (selId) return
    if (!form.dam_tag || !form.sire_tag) return
    const key = `${form.dam_tag}|${form.sire_tag}`
    if (autoFilledFor.current === key) return   // already handled this pair
    const suggested = calcFromParents()
    if (suggested) {
      autoFilledFor.current = key
      setForm(f => ({...f, breed_composition: suggested, breed: suggested[0].breed}))
    }
  }, [form.dam_tag, form.sire_tag, selId])

  const selAnimal = animals.find(a => a.id === selId)

  // Records for selected animal
  const animalBreeding = useMemo(() => breeding.filter(b => b.animal_id === selId), [breeding, selId])
  const animalWeights  = useMemo(() => weights.filter(w => w.animal_id === selId).sort((a,b)=>new Date(b.date)-new Date(a.date)), [weights, selId])
  const animalBcs      = useMemo(() => bcs.filter(b => b.animal_id === selId).sort((a,b)=>new Date(b.date)-new Date(a.date)), [bcs, selId])
  const animalHealth   = useMemo(() => health.filter(h => h.animal_id === selId).sort((a,b)=>new Date(b.date)-new Date(a.date)), [health, selId])

  // Filtered list
  const filtered = useMemo(() => {
    let list = animals
    if (filter === 'active') list = list.filter(a => a.status === 'active')
    else if (filter === 'losses') list = list.filter(a => a.status === 'died')
    else if (filter === 'needs_weight') list = list.filter(a => a.status === 'active' && (weights.filter(w => w.animal_id === a.id).length === 0) && !a.birth_weight)
    else if (filter === 'calf') list = list.filter(a => isCalfSex(a.sex) && a.status === 'active')
    else if (['cow','bull','heifer','steer'].includes(filter)) list = list.filter(a => a.sex === filter && a.status === 'active')
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(a => a.tag?.toLowerCase().includes(s) || a.name?.toLowerCase().includes(s))
    }
    return list
  }, [animals, filter, search])

  // Promotions due (calves past weaning)
  const promotionsDue = useMemo(() => {
    return animals
      .filter(a => a.status === 'active')
      .map(a => ({ animal: a, promo: promotionSuggestion(a) }))
      .filter(x => x.promo)
  }, [animals])

  // Calving alerts across herd
  const calvingAlerts = useMemo(() => {
    return breeding
      .filter(b => b.bred_date && !b.actual_calving_date)
      .map(b => {
        const animal = animals.find(a => a.id === b.animal_id)
        const alert = calvingAlert(b.bred_date)
        return { animal, breeding: b, alert }
      })
      .filter(x => x.animal && (x.alert.level === 'alert' || x.alert.level === 'warn' || x.alert.level === 'overdue' || x.alert.level === 'due'))
      .sort((a,b) => a.alert.days - b.alert.days)
  }, [breeding, animals])

  // ALL bred cows still to calve (no actual calving recorded), sorted by due date.
  // Keeps only the most recent breeding record per cow so re-breds don't double-list.
  const toCalve = useMemo(() => {
    const open = breeding.filter(b => b.bred_date && !b.actual_calving_date)
    // most recent bred_date per animal
    const latestByAnimal = {}
    open.forEach(b => {
      const cur = latestByAnimal[b.animal_id]
      if (!cur || new Date(b.bred_date) > new Date(cur.bred_date)) latestByAnimal[b.animal_id] = b
    })
    return Object.values(latestByAnimal)
      .map(b => {
        const animal = animals.find(a => a.id === b.animal_id)
        const due = expectedCalvingDate(b.bred_date)
        const days = daysUntilCalving(b.bred_date)
        return { animal, breeding: b, due, days }
      })
      .filter(x => x.animal && x.animal.status === 'active')
      .sort((a,b) => a.days - b.days)   // soonest/overdue first
  }, [breeding, animals])

  async function saveAnimal() {
    if (!form.tag.trim()) { alert('Tag is required'); return }
    setSaving(true)
    try {
      // current_weight is a form-only field (not an animals column) — pull it out
      const { current_weight, ...animalForm } = form
      const row = {
        ...animalForm,
        birth_weight: form.birth_weight ? +form.birth_weight : null,
        birth_date: form.birth_date || null,
        current_herd_id: form.current_herd_id || null,
        breed_composition: form.breed_composition && form.breed_composition.length ? JSON.stringify(form.breed_composition) : null,
      }
      if (selId && view === 'add') {
        await updateAnimal(selId, row)
        // If a current weight was entered while editing, log it as today's weight
        if (current_weight) {
          await insertWeight({ animal_id: selId, date: today(), weight: +current_weight, event_type: 'routine' })
        }
      } else {
        const created = await insertAnimal(row)
        // Auto-create birth weight record if provided
        if (form.birth_weight && form.birth_date) {
          await insertWeight({ animal_id: created.id, date: form.birth_date, weight: +form.birth_weight, event_type: 'birth' })
        }
        // Log current weight as a dated weight record (today)
        if (current_weight) {
          await insertWeight({ animal_id: created.id, date: today(), weight: +current_weight, event_type: 'routine' })
        }
      }
      setForm(emptyAnimal); setView('list'); setSelId(null)
    } catch(e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  function openEdit(a) {
    setForm({
      tag:a.tag, name:a.name||'', breed:a.breed||'Angus', sex:a.sex,
      color:a.color||'', birth_date:a.birth_date||'', birth_weight:a.birth_weight||'', current_weight:'',
      sire_tag:a.sire_tag||'', dam_tag:a.dam_tag||'', registration_number:a.registration_number||'',
      status:a.status, lactating:a.lactating||false, lactating_override:a.lactating_override||'', notes:a.notes||'', current_herd_id:a.current_herd_id||'',
      breed_composition: a.breed_composition ? (typeof a.breed_composition==='string'?JSON.parse(a.breed_composition):a.breed_composition) : [],
    })
    setSelId(a.id); setView('add'); window.scrollTo(0,0)
  }

  // Mark an animal as died (with cause), update dam's breeding record if calf
  const [deathModal, setDeathModal] = useState(null)  // animal being marked dead
  async function markDied(animal, date, cause) {
    try {
      await updateAnimal(animal.id, { status:'died', status_date:date, status_notes:cause })
      // If this is a calf with a dam, flag the loss on the dam's breeding record
      if (isCalfSex(animal.sex) && animal.dam_tag) {
        const dam = animals.find(x => x.tag === animal.dam_tag)
        if (dam) {
          const damBreeding = breeding.filter(b => b.animal_id === dam.id && b.calf_tag === animal.tag)
          for (const br of damBreeding) {
            await updateBreeding(br.id, { calf_lost: true })
          }
        }
      }
      setDeathModal(null)
      setView('list'); setSelId(null)
    } catch(e) { alert('Error: ' + e.message) }
  }

  // Promote a calf to its grown classification
  async function promoteAnimal(animalId, newSex) {
    try { await updateAnimal(animalId, { sex: newSex }) }
    catch(e) { alert('Error: ' + e.message) }
  }

  // Quick herd assignment (no edit needed)
  async function quickAssignHerd(animalId, herdId) {
    try { await updateAnimal(animalId, { current_herd_id: herdId || null }) }
    catch(e) { alert('Error: ' + e.message) }
  }

  // Quick sex change (no edit needed)
  async function quickSetSex(animalId, sex) {
    try { await updateAnimal(animalId, { sex }) }
    catch(e) { alert('Error: ' + e.message) }
  }

  // Export all animals to CSV, grouped by type
  function exportCSV() {
    const herdName = id => herds.find(h=>h.id===id)?.name || ''
    const cols = ['Tag','Name','Sex','Breed','Composition','Status','Birth Date','Birth Wt','Current Wt','Dam','Sire','Herd','Lactating','Notes']
    const esc = v => {
      const s = (v==null?'':String(v))
      return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s
    }
    const rowFor = a => {
      const wr = weights.filter(w=>w.animal_id===a.id)
      const wt = currentWeight(a, wr) || ''
      const comp = a.breed_composition ? (typeof a.breed_composition==='string'?(()=>{try{return JSON.parse(a.breed_composition)}catch{return null}})():a.breed_composition) : null
      return [
        a.tag, a.name, SEXES[a.sex]?.label||a.sex, a.breed,
        comp&&comp.length?compositionDisplay(comp):'', STATUSES[a.status]?.label||a.status,
        a.birth_date||'', a.birth_weight||'', wt, a.dam_tag||'', a.sire_tag||'',
        herdName(a.current_herd_id), a.lactating?'Yes':'', a.notes||'',
      ].map(esc).join(',')
    }

    // Group by type in a sensible order
    const groups = [
      ['COWS', animals.filter(a=>a.sex==='cow')],
      ['BULLS', animals.filter(a=>a.sex==='bull')],
      ['HEIFERS', animals.filter(a=>a.sex==='heifer')],
      ['STEERS', animals.filter(a=>a.sex==='steer')],
      ['HEIFER CALVES', animals.filter(a=>a.sex==='heifer_calf')],
      ['BULL CALVES', animals.filter(a=>a.sex==='bull_calf')],
      ['STEER CALVES', animals.filter(a=>a.sex==='steer_calf')],
      ['CALVES (unspecified)', animals.filter(a=>a.sex==='calf')],
    ]

    const lines = []
    lines.push(`Pivotal Pastures — Animal Records Export,${new Date().toLocaleDateString()}`)
    lines.push('')
    groups.forEach(([label, list]) => {
      if (list.length === 0) return
      const active = list.filter(a=>a.status==='active').length
      lines.push(`${label} (${list.length} total, ${active} active)`)
      lines.push(cols.join(','))
      // sort by tag, numeric-aware
      const sorted = [...list].sort((a,b)=>(a.tag||'').localeCompare(b.tag||'', undefined, {numeric:true}))
      sorted.forEach(a => lines.push(rowFor(a)))
      lines.push('')
    })
    // Summary footer
    lines.push('SUMMARY')
    lines.push('Type,Total,Active')
    groups.forEach(([label,list])=>{ if(list.length) lines.push(`${label},${list.length},${list.filter(a=>a.status==='active').length}`) })
    lines.push(`ALL,${animals.length},${animals.filter(a=>a.status==='active').length}`)

    const csv = lines.join('\n')
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `pivotal-pastures-animals-${new Date().toISOString().slice(0,10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function bulkMoveToHerd() {
    if (selectedIds.size === 0) { alert('Select animals first'); return }
    try {
      for (const id of selectedIds) {
        await updateAnimal(id, { current_herd_id: bulkHerd || null })
      }
      setSelectedIds(new Set()); setSelectMode(false); setBulkHerd('')
    } catch(e) { alert('Error: ' + e.message) }
  }

  // Wean a group of calves at once → their dams auto-switch to dry
  async function bulkWean() {
    if (selectedIds.size === 0) { alert('Select calves first'); return }
    const calfIds = [...selectedIds].filter(id => {
      const a = animals.find(x => x.id === id)
      return a && isCalfSex(a.sex)
    })
    if (calfIds.length === 0) { alert('None of the selected animals are calves.'); return }
    if (!confirm(`Wean ${calfIds.length} calf/calves? Their dams will switch to dry.`)) return
    try {
      for (const id of calfIds) {
        await updateAnimal(id, { weaned: true, weaned_date: today() })
      }
      setSelectedIds(new Set()); setSelectMode(false)
    } catch(e) { alert('Error: ' + e.message) }
  }

  async function bulkUnwean() {
    if (selectedIds.size === 0) return
    try {
      for (const id of selectedIds) {
        const a = animals.find(x => x.id === id)
        if (a && isCalfSex(a.sex)) await updateAnimal(id, { weaned: false, weaned_date: null })
      }
      setSelectedIds(new Set()); setSelectMode(false)
    } catch(e) { alert('Error: ' + e.message) }
  }

  function startAdd(presetSex) {
    const sex = presetSex || 'cow'
    const birthYear = ['calf','bull_calf','heifer_calf','steer_calf'].includes(sex) ? curYear : curYear - 2
    setForm({ ...emptyAnimal, sex, tag: suggestNextTag(allTags, birthYear) })
    setSelId(null); setView('add'); window.scrollTo(0,0)
  }

  // ════ LIST VIEW ════
  if (loading) return <div className="text-muted text-sm" style={{padding:'2rem'}}>Loading…</div>

  if (view === 'list') {
    const cowCount = animals.filter(a=>a.sex==='cow'&&a.status==='active').length
    const bullCount= animals.filter(a=>a.sex==='bull'&&a.status==='active').length
    const calfCount= animals.filter(a=>isCalfSex(a.sex)&&a.status==='active').length
    const totalActive = animals.filter(a=>a.status==='active').length

    // Diagnostic: full breakdown + data-quality checks
    const byStatus = {}
    animals.forEach(a => { byStatus[a.status||'(none)'] = (byStatus[a.status||'(none)']||0)+1 })
    const bySex = {}
    animals.filter(a=>a.status==='active').forEach(a => { bySex[a.sex||'(none)'] = (bySex[a.sex||'(none)']||0)+1 })
    // Duplicate tags
    const tagCounts = {}
    animals.forEach(a => { const tg=(a.tag||'').trim(); if(tg) tagCounts[tg]=(tagCounts[tg]||0)+1 })
    const dupTags = Object.entries(tagCounts).filter(([t,n])=>n>1).map(([t,n])=>`${t} (${n}×)`)
    // Calving records with no calf created
    const calvingsNoCalf = breeding.filter(b => b.actual_calving_date && (!b.calf_tag || !animals.find(a=>a.tag===b.calf_tag)))

    return (
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
          <div>
            <div className="section-heading">Animal Records</div>
            <div className="section-desc">Individual records from birth to exit. Breeding, weights, health, and pedigree — building value every year.</div>
          </div>
          {animals.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={exportCSV} style={{ flexShrink:0, marginTop:4 }}>⤓ Export CSV</button>
          )}
        </div>

        {/* Calving alerts */}
        {calvingAlerts.length > 0 && (
          <div className="card" style={{ border:'1px solid var(--gold)', background:'rgba(240,192,64,0.06)' }}>
            <div className="card-sub mb-2" style={{ color:'var(--gold)' }}>🐮 Calving Watch</div>
            {calvingAlerts.slice(0,5).map((x,i) => (
              <div key={i} className="list-item" style={{ cursor:'pointer' }} onClick={()=>{setSelId(x.animal.id);setView('detail')}}>
                <div>
                  <span style={{ fontFamily:'DM Mono, monospace', color:'var(--cream)', fontWeight:600 }}>{x.animal.tag}</span>
                  {x.animal.name && <span style={{ color:'var(--subtext)', marginLeft:6 }}>{x.animal.name}</span>}
                  <div style={{ fontSize:'0.72rem', color:x.alert.color, marginTop:2 }}>{x.alert.msg} · due {x.breeding.expected_calving_date || expectedCalvingDate(x.breeding.bred_date)}</div>
                </div>
                <span style={{ color:x.alert.color, fontSize:'1.1rem' }}>{x.alert.level==='overdue'||x.alert.level==='due'?'🔴':x.alert.level==='alert'?'🟠':'🟡'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Still to calve — full list of bred cows with no calving yet */}
        {toCalve.length > 0 && (
          <details className="card" style={{ border:'1px solid var(--sky)', background:'rgba(74,144,200,0.05)' }}>
            <summary style={{ cursor:'pointer', color:'var(--sky)', fontFamily:'DM Mono, monospace', fontSize:'0.82rem', fontWeight:600 }}>
              🤰 Still to Calve — {toCalve.length} bred {toCalve.length===1?'cow':'cows'}
            </summary>
            <div style={{ marginTop:'0.6rem' }}>
              {toCalve.map((x,i) => {
                const overdue = x.days < 0
                const soon = x.days >= 0 && x.days <= 14
                const color = overdue ? 'var(--alert)' : soon ? 'var(--gold)' : 'var(--subtext)'
                return (
                  <div key={i} className="list-item" style={{ cursor:'pointer' }} onClick={()=>{setSelId(x.animal.id);setView('detail')}}>
                    <div>
                      <span style={{ fontFamily:'DM Mono, monospace', color:'var(--cream)', fontWeight:600 }}>{x.animal.tag}</span>
                      {x.animal.name && <span style={{ color:'var(--subtext)', marginLeft:6 }}>{x.animal.name}</span>}
                      <div style={{ fontSize:'0.72rem', color, marginTop:2 }}>
                        due {x.due}
                        {overdue ? ` · ${Math.abs(x.days)}d overdue` : x.days===0 ? ' · due today' : ` · in ${x.days}d`}
                      </div>
                    </div>
                    <span style={{ color, fontSize:'0.7rem', fontFamily:'DM Mono, monospace' }}>{overdue?'OVERDUE':soon?'SOON':''}</span>
                  </div>
                )
              })}
            </div>
          </details>
        )}

        {/* Promotions due */}
        {promotionsDue.length > 0 && (
          <div className="card" style={{ border:'1px solid var(--grass)', background:'rgba(110,192,64,0.05)' }}>
            <div className="card-sub mb-2" style={{ color:'var(--grass)' }}>🐄 Ready to Promote (past weaning)</div>
            {promotionsDue.slice(0,8).map(({animal,promo},i)=>(
              <div key={i} className="list-item" style={{ padding:'0.5rem 0' }}>
                <div onClick={()=>{setSelId(animal.id);setView('detail')}} style={{ cursor:'pointer', flex:1 }}>
                  <span style={{ fontFamily:'DM Mono, monospace', color:'var(--cream)', fontWeight:600 }}>{animal.tag}</span>
                  <span style={{ color:'var(--subtext)', marginLeft:6, fontSize:'0.72rem' }}>{promo.fromLabel} · {promo.age}d old</span>
                </div>
                <div className="flex gap-1">
                  {promo.options.map((opt,oi)=>(
                    <button key={opt} className="btn btn-primary btn-sm" onClick={()=>promoteAnimal(animal.id, opt)}>→ {promo.optionLabels[oi]}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary stats */}
        <div className="grid-4 mb-2">
          {[['Cows',cowCount],['Bulls',bullCount],['Calves',calfCount],['Total Active',totalActive]].map(([l,v])=>(
            <div key={l} className="stat-box"><div className="stat-val">{v}</div><div className="stat-lbl">{l}</div></div>
          ))}
        </div>

        {/* Count diagnostic — helps find missing/miscounted animals */}
        <details className="card" style={{ marginBottom:'0.75rem' }}>
          <summary style={{ cursor:'pointer', fontSize:'0.78rem', color:'var(--grass)', fontFamily:'DM Mono, monospace' }}>
            🔎 Count Check — {animals.length} total records
          </summary>
          <div style={{ marginTop:'0.6rem', fontSize:'0.72rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace', lineHeight:1.7 }}>
            <div><strong style={{color:'var(--cream)'}}>By status:</strong> {Object.entries(byStatus).map(([s,n])=>`${s}: ${n}`).join('  ·  ')}</div>
            <div><strong style={{color:'var(--cream)'}}>Active by sex:</strong> {Object.entries(bySex).map(([s,n])=>`${(SEXES[s]?.label||s)}: ${n}`).join('  ·  ')}</div>
            {dupTags.length > 0 && (
              <div style={{ color:'var(--alert)', marginTop:'0.4rem' }}>⚠ Duplicate tags: {dupTags.join(', ')}</div>
            )}
            {calvingsNoCalf.length > 0 && (
              <div style={{ color:'var(--gold)', marginTop:'0.4rem' }}>
                ⚠ {calvingsNoCalf.length} calving record{calvingsNoCalf.length>1?'s':''} with no matching calf animal.
              </div>
            )}

            {/* Every calf-ish animal listed with status + herd, flagging non-counters */}
            {(() => {
              const calfish = animals.filter(a => isCalfSex(a.sex))
              const activeCalves = calfish.filter(a => a.status === 'active')
              const notCounted = calfish.filter(a => a.status !== 'active')
              const noHerd = activeCalves.filter(a => !a.current_herd_id)
              const herdName = id => herds.find(h=>h.id===id)?.name || '—'
              return (
                <div style={{ marginTop:'0.6rem', borderTop:'1px solid var(--bark2)', paddingTop:'0.5rem' }}>
                  <div style={{ color:'var(--cream)' }}>Calf-type records: {calfish.length} total · {activeCalves.length} active</div>
                  {notCounted.length > 0 && (
                    <div style={{ color:'var(--alert)', marginTop:'0.3rem' }}>
                      ⚠ {notCounted.length} calf record(s) NOT active (won't count): {notCounted.map(a=>`${a.tag} [${a.status}]`).join(', ')}
                    </div>
                  )}
                  {noHerd.length > 0 && (
                    <div style={{ color:'var(--gold)', marginTop:'0.3rem' }}>
                      ⚠ {noHerd.length} active calf(s) with NO herd (counts in total, not in any herd): {noHerd.map(a=>a.tag).join(', ')}
                    </div>
                  )}
                  <div style={{ color:'var(--subtext)', marginTop:'0.3rem', fontSize:'0.66rem' }}>
                    Herd box counts only calves assigned to that herd. The Calves stat counts all active calves.
                  </div>
                  <div style={{ marginTop:'0.5rem', borderTop:'1px solid var(--bark2)', paddingTop:'0.5rem' }}>
                    <div style={{ color:'var(--cream)', marginBottom:'0.3rem' }}>All calf tags (sorted) — compare to your sheet:</div>
                    <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                      {[...calfish].sort((a,b)=>(a.tag||'').localeCompare(b.tag||'', undefined, {numeric:true})).map(a=>(
                        <span key={a.id} style={{
                          background: a.status==='active'?'rgba(58,122,40,0.15)':'rgba(224,64,48,0.12)',
                          borderRadius:5, padding:'2px 7px', fontSize:'0.62rem', fontFamily:'DM Mono, monospace',
                          color: a.status==='active'?'var(--grass)':'var(--alert)',
                          border:`1px solid ${a.status==='active'?'var(--moss)':'rgba(224,64,48,0.3)'}`,
                        }}>{a.tag||'(no tag)'}{a.status!=='active'?' ✝':''}</span>
                      ))}
                    </div>
                    <div style={{ color:'var(--subtext)', marginTop:'0.3rem', fontSize:'0.62rem' }}>
                      Green = active, red ✝ = dead. {calfish.length} calf tags shown. Scan for the one on your sheet that's not here.
                    </div>
                  </div>
                </div>
              )
            })()}

            {dupTags.length===0 && calvingsNoCalf.length===0 && (
              <div style={{ color:'var(--grass)', marginTop:'0.4rem' }}>✓ No duplicate tags, no orphan calvings.</div>
            )}
          </div>
        </details>

        {/* Add buttons */}
        <div className="flex gap-1 mb-2" style={{ flexWrap:'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={()=>startAdd('cow')}>+ Cow</button>
          <button className="btn btn-primary btn-sm" onClick={()=>startAdd('bull')}>+ Bull</button>
          <button className="btn btn-primary btn-sm" onClick={()=>startAdd('heifer')}>+ Heifer</button>
          <button className="btn btn-primary btn-sm" onClick={()=>startAdd('heifer_calf')}>+ Calf</button>
          <button className="btn btn-secondary btn-sm" onClick={()=>startAdd('steer')}>+ Steer</button>
        </div>

        {/* Select mode toggle + bulk bar */}
        <div className="flex gap-1 mb-2" style={{ flexWrap:'wrap', alignItems:'center' }}>
          <button className={`btn btn-sm ${selectMode?'btn-amber':'btn-secondary'}`} onClick={()=>{setSelectMode(!selectMode);setSelectedIds(new Set())}}>
            {selectMode ? '✕ Cancel Select' : '☑ Select & Move'}
          </button>
          {selectMode && (
            <>
              <span style={{ fontSize:'0.75rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace' }}>{selectedIds.size} selected</span>
              <select className="select" value={bulkHerd} onChange={e=>setBulkHerd(e.target.value)} style={{ maxWidth:170, fontSize:'0.78rem', padding:'5px 10px' }}>
                <option value="">Move to… (herd)</option>
                <option value="">— Remove from herd —</option>
                {herds.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" onClick={bulkMoveToHerd} disabled={selectedIds.size===0}>
                Move {selectedIds.size>0?selectedIds.size:''}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={bulkWean} disabled={selectedIds.size===0} title="Mark selected calves weaned — dams switch to dry">
                🍼 Wean {selectedIds.size>0?selectedIds.size:''}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={bulkUnwean} disabled={selectedIds.size===0} title="Undo weaning">
                ↩ Un-wean
              </button>
            </>
          )}
        </div>

        {/* Filters */}
        <div className="card" style={{ padding:'0.6rem 0.85rem', marginBottom:'0.75rem' }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            {['active','cow','bull','heifer','calf','needs_weight','losses','all'].map(f=>(
              <button key={f} onClick={()=>setFilter(f)} style={{
                background: filter===f?'var(--moss)':'var(--bark)',
                border:`1px solid ${filter===f?'var(--grass)':'var(--bark2)'}`,
                borderRadius:6, padding:'4px 11px', cursor:'pointer',
                color: filter===f?'var(--white)':'var(--subtext)',
                fontFamily:'DM Mono, monospace', fontSize:'0.68rem', textTransform:'capitalize',
              }}>{f==='needs_weight'?'⚖ Needs Weight':f}</button>
            ))}
            <input className="input" placeholder="Search tag/name…" value={search} onChange={e=>setSearch(e.target.value)}
              style={{ maxWidth:160, marginLeft:'auto', fontSize:'0.78rem', padding:'5px 10px' }} />
          </div>
        </div>

        {/* Animal list */}
        {filtered.length === 0 && (
          <div className="card" style={{ textAlign:'center', padding:'2.5rem' }}>
            <div style={{ fontSize:'2.5rem', marginBottom:'0.5rem' }}>🐄</div>
            <div className="text-muted">No animals {filter!=='all'?`(${filter})`:''} yet. Add your first one above.</div>
          </div>
        )}

        {filtered.map(a => {
          const wr = weights.filter(w=>w.animal_id===a.id)
          const wt = currentWeight(a, wr)
          const sexInfo = SEXES[a.sex] || SEXES.cow
          const age = ageDisplay(a.birth_date)
          const animalBreed = breeding.filter(b=>b.animal_id===a.id && b.bred_date && !b.actual_calving_date)
          const pendingCalving = animalBreed.length > 0 ? calvingAlert(animalBreed[0].bred_date) : null
          const isSelected = selectedIds.has(a.id)
          return (
            <div key={a.id} className="list-item" style={{ background: isSelected?'rgba(58,122,40,0.12)':undefined }}>
              {selectMode && (
                <input type="checkbox" checked={isSelected} onChange={()=>toggleSelect(a.id)}
                  style={{ width:18, height:18, marginRight:8, cursor:'pointer', accentColor:'var(--grass)' }} />
              )}
              <div style={{ flex:1, cursor: selectMode?'pointer':'pointer' }}
                onClick={()=> selectMode ? toggleSelect(a.id) : (setSelId(a.id),setView('detail'))}>
                <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'0.2rem', flexWrap:'wrap' }}>
                  <span style={{ fontSize:'1.05rem' }}>{sexInfo.icon}</span>
                  <strong style={{ color:'var(--cream)', fontFamily:'DM Mono, monospace' }}>{a.tag}</strong>
                  {a.name && <span style={{ color:'var(--subtext)' }}>{a.name}</span>}
                  <span className="badge">{sexInfo.label}</span>
                  {a.status!=='active' && <span className="badge" style={{ borderColor:STATUSES[a.status]?.color, color:STATUSES[a.status]?.color }}>{a.status}</span>}
                  {(a.sex==='cow'||a.sex==='heifer') && effectiveLactating(a, animals) && <span className="badge" style={{ borderColor:'var(--sky)', color:'var(--sky)' }}>lactating</span>}
                  {isCalfSex(a.sex) && a.weaned && <span className="badge" style={{ borderColor:'var(--subtext)', color:'var(--subtext)' }}>weaned</span>}
                  {pendingCalving && (pendingCalving.level==='alert'||pendingCalving.level==='overdue'||pendingCalving.level==='due') &&
                    <span className="badge" style={{ borderColor:'var(--gold)', color:'var(--gold)' }}>🐮 {pendingCalving.days<=0?'due':pendingCalving.days+'d'}</span>}
                </div>
                <div style={{ fontSize:'0.7rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace' }}>
                  {(() => {
                    const ac = a.breed_composition ? (typeof a.breed_composition==='string'?JSON.parse(a.breed_composition):a.breed_composition) : null
                    return ac && ac.length ? compositionShort(ac, a.breed) : a.breed
                  })()} {age!=='—'&&`· ${age}`} {wt&&`· ${wt} lb`} {a.dam_tag&&`· dam ${a.dam_tag}`}
                </div>
              </div>
              {!selectMode && a.status === 'died' && (
                <div style={{ textAlign:'right', fontSize:'0.62rem', color:'var(--alert)', fontFamily:'DM Mono, monospace', maxWidth:160 }}>
                  ⚰ {a.status_date||'—'}
                  {a.status_notes && <div style={{ color:'var(--subtext)', marginTop:2 }}>{a.status_notes}</div>}
                </div>
              )}
              {!selectMode && a.status !== 'died' && (
                <div style={{ display:'flex', flexDirection:'column', gap:4, alignItems:'flex-end' }}>
                  <select
                    value={a.sex}
                    onClick={e=>e.stopPropagation()}
                    onChange={e=>{ e.stopPropagation(); quickSetSex(a.id, e.target.value) }}
                    title="Change sex / class"
                    style={{ background:'var(--bark)', border:'1px solid var(--bark2)', borderRadius:6, color:'var(--cream)', fontFamily:'DM Mono, monospace', fontSize:'0.66rem', padding:'4px 6px', maxWidth:130, cursor:'pointer' }}
                  >
                    {Object.entries(SEXES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                  <select
                    value={a.current_herd_id || ''}
                    onClick={e=>e.stopPropagation()}
                    onChange={e=>{ e.stopPropagation(); quickAssignHerd(a.id, e.target.value) }}
                    title="Assign to herd"
                    style={{ background:'var(--bark)', border:`1px solid ${a.current_herd_id?'var(--moss)':'var(--bark2)'}`, borderRadius:6, color:a.current_herd_id?'var(--grass)':'var(--subtext)', fontFamily:'DM Mono, monospace', fontSize:'0.66rem', padding:'4px 6px', maxWidth:130, cursor:'pointer' }}
                  >
                    <option value="">— No herd —</option>
                    {herds.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ════ ADD/EDIT VIEW ════
  if (view === 'add') {
    const isCalf = form.sex === 'calf'
    const suggestedTag = suggestNextTag(allTags, isCalf ? curYear : curYear-2)
    return (
      <div>
        <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'1rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={()=>{setView(selId?'detail':'list');setForm(emptyAnimal)}}>← Back</button>
          <div className="section-heading" style={{ fontSize:'1.3rem', margin:0 }}>{selId?'Edit Animal':'New Animal'}</div>
        </div>

        <div className="card">
          <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
            <div className="field">
              <label className="label">Tag / ID *</label>
              <input className="input" value={form.tag} onChange={e=>set('tag',e.target.value)} placeholder={suggestedTag} />
              {!selId && <div style={{ fontSize:'0.62rem', color:'var(--subtext)', marginTop:3 }}>Suggested: {suggestedTag} ({yearToLetter(isCalf?curYear:curYear-2)}-series)</div>}
            </div>
            <div className="field">
              <label className="label">Name (optional)</label>
              <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} />
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
            <div className="field">
              <label className="label">Sex</label>
              <select className="select" value={form.sex} onChange={e=>set('sex',e.target.value)}>
                {Object.entries(SEXES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Primary Breed</label>
              <select className="select" value={form.breed} onChange={e=>set('breed',e.target.value)}>
                {BREEDS.map(b=><option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          {/* Breed composition builder */}
          <div style={{ background:'var(--bark)', borderRadius:9, padding:'0.85rem', marginBottom:'0.75rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
              <div className="card-sub" style={{ margin:0 }}>Breed Composition {comp.length>0 && <span style={{ color: Math.abs(compTotal-100)<0.5?'var(--grass)':'var(--alert)', fontFamily:'DM Mono, monospace', fontSize:'0.7rem' }}>({compTotal}%)</span>}</div>
              <div className="flex gap-1">
                {(form.dam_tag || form.sire_tag) && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={suggestCalfComposition}>↯ From parents</button>
                )}
                <button type="button" className="btn btn-primary btn-sm" onClick={addCompRow}>+ Breed</button>
              </div>
            </div>

            {comp.length === 0 && (
              <div style={{ fontSize:'0.72rem', color:'var(--subtext)', padding:'0.3rem 0' }}>
                Optional. Add breeds with percentages for crossbred/composite tracking (e.g. ¾ South Poll, ¼ Angus). Must total 100%. Leave empty to just use primary breed.
              </div>
            )}

            {comp.map((row,i)=>(
              <div key={i} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:'0.4rem' }}>
                <select className="select" value={row.breed} onChange={e=>updateCompRow(i,'breed',e.target.value)} style={{ flex:1 }}>
                  {BREEDS.map(b=><option key={b} value={b}>{b}</option>)}
                </select>
                <input className="input" type="number" min="0" max="100" step="0.5" value={row.pct}
                  onChange={e=>updateCompRow(i,'pct',e.target.value)} style={{ maxWidth:75 }} />
                <span style={{ fontSize:'0.72rem', color:'var(--subtext)' }}>%</span>
                <button type="button" className="btn btn-danger btn-sm" onClick={()=>removeCompRow(i)}>✕</button>
              </div>
            ))}

            {comp.length>0 && (
              <div style={{ marginTop:'0.5rem', fontSize:'0.75rem' }}>
                {Math.abs(compTotal-100)<0.5
                  ? <span style={{ color:'var(--grass)' }}>✓ {compositionDisplay(comp)}</span>
                  : <span style={{ color:'var(--alert)' }}>⚠ Must total 100% (currently {compTotal}%)</span>}
              </div>
            )}
          </div>

          <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
            <div className="field">
              <label className="label">Birth Date</label>
              <input className="input" type="date" value={form.birth_date} onChange={e=>set('birth_date',e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Birth Weight (lb)</label>
              <input className="input" type="number" value={form.birth_weight} onChange={e=>set('birth_weight',e.target.value)} placeholder="e.g. 82" />
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
            <div className="field">
              <label className="label">Current Weight (lb){selId?' — adds today':''}</label>
              <input className="input" type="number" value={form.current_weight} onChange={e=>set('current_weight',e.target.value)} placeholder="e.g. 1250" />
              <div style={{ fontSize:'0.6rem', color:'var(--subtext)', marginTop:3 }}>Recorded as a weight entry dated today. Feeds herd weight.</div>
            </div>
            <div className="field"></div>
          </div>

          <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
            <div className="field">
              <label className="label">Dam Tag (mother)</label>
              <input className="input" value={form.dam_tag} onChange={e=>set('dam_tag',e.target.value)} placeholder="e.g. A201" list="dam-tags" />
              <datalist id="dam-tags">
                {animals.filter(a=>a.sex==='cow').map(a=><option key={a.id} value={a.tag} />)}
              </datalist>
            </div>
            <div className="field">
              <label className="label">Sire Tag (father)</label>
              <input className="input" value={form.sire_tag} onChange={e=>set('sire_tag',e.target.value)} placeholder="e.g. B01" list="sire-tags" />
              <datalist id="sire-tags">
                {animals.filter(a=>a.sex==='bull').map(a=><option key={a.id} value={a.tag} />)}
              </datalist>
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
            <div className="field">
              <label className="label">Color / Markings</label>
              <input className="input" value={form.color} onChange={e=>set('color',e.target.value)} placeholder="e.g. Black" />
            </div>
            <div className="field">
              <label className="label">Registration #</label>
              <input className="input" value={form.registration_number} onChange={e=>set('registration_number',e.target.value)} />
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
            <div className="field">
              <label className="label">Status</label>
              <select className="select" value={form.status} onChange={e=>set('status',e.target.value)}>
                {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Assign to Herd</label>
              <select className="select" value={form.current_herd_id} onChange={e=>set('current_herd_id',e.target.value)}>
                <option value="">— No herd —</option>
                {herds.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
            {(form.sex==='cow'||form.sex==='heifer') && (
              <div className="field">
                <label className="label">Lactation</label>
                <select className="select" value={form.lactating_override||'auto'} onChange={e=>set('lactating_override', e.target.value==='auto'?'':e.target.value)}>
                  <option value="auto">Auto (calf at side = lactating)</option>
                  <option value="yes">Force lactating</option>
                  <option value="no">Force dry</option>
                </select>
                <div style={{ fontSize:'0.6rem', color:'var(--subtext)', marginTop:3 }}>Auto detects from her calves.</div>
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom:'1rem' }}>
            <label className="label">Notes</label>
            <textarea className="textarea" rows={2} value={form.notes} onChange={e=>set('notes',e.target.value)} />
          </div>

          <div className="flex gap-1">
            <button className="btn btn-primary" onClick={saveAnimal} disabled={saving}>
              {saving?<><span className="spinner"/> Saving…</>:selId?'✓ Update':'✓ Save Animal'}
            </button>
            <button className="btn btn-secondary" onClick={()=>{setView(selId?'detail':'list');setForm(emptyAnimal)}}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  // ════ DETAIL VIEW ════
  if (view === 'detail' && selAnimal) {
    const a = selAnimal
    const sexInfo = SEXES[a.sex] || SEXES.cow
    const wt = currentWeight(a, animalWeights)
    const adg = calcADG(animalWeights)
    const dam = getDam(a, animals)
    const sire = getSire(a, animals)
    const offspring = getOffspring(a.tag, animals)
    const breedSummary = cowBreedingSummary(animalBreeding)
    const wd = withdrawalStatus(animalHealth)
    const upcomingVax = upcomingVaccinations(animalHealth)
    const bcsT = bcsTrend(animalBcs)
    const latestBcs = animalBcs[0]
    const promo = promotionSuggestion(a)

    return (
      <div>
        <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'1rem', flexWrap:'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={()=>{setView('list');setSelId(null)}}>← Back</button>
          <span style={{ fontSize:'1.4rem' }}>{sexInfo.icon}</span>
          <div className="section-heading" style={{ fontSize:'1.3rem', margin:0, fontFamily:'DM Mono, monospace' }}>{a.tag}</div>
          {a.name && <span style={{ color:'var(--subtext)', fontFamily:'Satisfy, cursive', fontSize:'1.2rem' }}>{a.name}</span>}
          {(a.sex==='cow'||a.sex==='heifer') && (
            <button className="btn btn-primary btn-sm" style={{ marginLeft:'auto' }} onClick={()=>setSubForm('breeding')}>🐮 Record Calving</button>
          )}
          <button className="btn btn-secondary btn-sm" style={{ marginLeft:(a.sex==='cow'||a.sex==='heifer')?0:'auto' }} onClick={()=>openEdit(a)}>✎ Edit</button>
        </div>

        {(a.sex==='cow'||a.sex==='heifer') && (
          <div style={{ fontSize:'0.78rem', marginBottom:'0.75rem', color: isLactating(a, animals)?'var(--sky)':'var(--subtext)' }}>
            {isLactating(a, animals)
              ? '🍼 Lactating — has a calf at side (switches to dry when the calf is weaned)'
              : '○ Dry — no nursing calf'}
          </div>
        )}

        {/* Withdrawal warning */}
        {wd && !wd.clear && (
          <div style={{ background:'rgba(224,64,48,0.15)', border:'1px solid var(--alert)', borderRadius:8, padding:'0.7rem 1rem', marginBottom:'0.75rem', color:'var(--alert)', fontSize:'0.82rem' }}>
            ⚠ {wd.msg}
          </div>
        )}

        {/* Promotion suggestion */}
        {promo && (
          <div style={{ background:'rgba(110,192,64,0.1)', border:'1px solid var(--grass)', borderRadius:8, padding:'0.7rem 1rem', marginBottom:'0.75rem' }}>
            <div style={{ color:'var(--grass)', fontSize:'0.82rem', marginBottom:'0.5rem' }}>
              🐄 This {promo.fromLabel.toLowerCase()} is {promo.age} days old (past weaning). Promote to:
            </div>
            <div className="flex gap-1" style={{ flexWrap:'wrap' }}>
              {promo.options.map((opt,i)=>(
                <button key={opt} className="btn btn-primary btn-sm" onClick={()=>promoteAnimal(a.id, opt)}>
                  → {promo.optionLabels[i]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Vitals */}
        <div className="card">
          <div className="grid-4">
            {[
              ['Sex', sexInfo.label],
              ['Breed', (() => {
                const ac = a.breed_composition ? (typeof a.breed_composition==='string'?JSON.parse(a.breed_composition):a.breed_composition) : null
                return ac && ac.length ? compositionShort(ac, a.breed) : (a.breed||'—')
              })()],
              ['Age', ageDisplay(a.birth_date)],
              ['Born', a.birth_date||'—'],
              ['Current Wt', wt?`${wt} lb`:'—'],
              ['ADG', adg?`${adg} lb/d`:'—'],
              ['BCS', latestBcs?`${latestBcs.score}`:'—'],
              ['Status', STATUSES[a.status]?.label],
            ].map(([l,v])=>(
              <div key={l} className="stat-box" style={{ padding:'0.6rem' }}>
                <div className="stat-val" style={{ fontSize:'0.88rem' }}>{v}</div>
                <div className="stat-lbl" style={{ fontSize:'0.52rem' }}>{l}</div>
              </div>
            ))}
          </div>
          {/* Full breed composition breakdown */}
          {(() => {
            const ac = a.breed_composition ? (typeof a.breed_composition==='string'?(()=>{try{return JSON.parse(a.breed_composition)}catch{return null}})():a.breed_composition) : null
            if (!ac || ac.length <= 1) return null
            return (
              <div style={{ marginTop:'0.6rem', paddingTop:'0.6rem', borderTop:'1px solid var(--bark2)' }}>
                <div style={{ fontSize:'0.6rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace', marginBottom:'0.3rem' }}>BREED COMPOSITION</div>
                <div style={{ fontSize:'0.85rem', color:'var(--cream)' }}>{compositionPercent(ac, a.breed)}</div>
              </div>
            )
          })()}
        </div>

        {/* Pedigree */}
        {(dam||sire||offspring.length>0) && (
          <div className="card">
            <div className="card-sub mb-2">Pedigree</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom: offspring.length?'0.75rem':0 }}>
              {dam && <button className="badge" style={{ cursor:'pointer', borderColor:'var(--sky)', color:'var(--sky)' }} onClick={()=>{setSelId(dam.id)}}>Dam: {dam.tag}{dam.name?` (${dam.name})`:''}</button>}
              {sire && <button className="badge" style={{ cursor:'pointer', borderColor:'var(--gold)', color:'var(--gold)' }} onClick={()=>{setSelId(sire.id)}}>Sire: {sire.tag}{sire.name?` (${sire.name})`:''}</button>}
              {!dam && a.dam_tag && <span className="badge">Dam: {a.dam_tag}</span>}
              {!sire && a.sire_tag && <span className="badge">Sire: {a.sire_tag}</span>}
            </div>
            {offspring.length > 0 && (
              <div>
                <div style={{ fontSize:'0.7rem', color:'var(--subtext)', marginBottom:'0.4rem', fontFamily:'DM Mono, monospace' }}>OFFSPRING ({offspring.length})</div>
                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                  {offspring.map(o=>(
                    <button key={o.id} className="badge" style={{ cursor:'pointer' }} onClick={()=>setSelId(o.id)}>
                      {SEXES[o.sex]?.icon} {o.tag} {o.birth_date&&`(${new Date(o.birth_date).getFullYear()})`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Breeding summary for cows */}
        {(a.sex==='cow'||a.sex==='heifer') && breedSummary.calvesBorn > 0 && (
          <div className="card">
            <div className="card-sub mb-2">Breeding Record</div>
            <div className="grid-4">
              {[
                ['Calves Born', breedSummary.calvesBorn],
                ['Weaned', `${breedSummary.calvesWeaned}${breedSummary.calvesLost?` (${breedSummary.calvesLost} lost)`:''}`],
                ['Weaning %', breedSummary.weaningRate!=null?`${breedSummary.weaningRate}%`:'—'],
                ['Avg Interval', breedSummary.avgInterval?`${breedSummary.avgInterval}d`:'—'],
              ].map(([l,v])=>(
                <div key={l} className="stat-box" style={{ padding:'0.6rem' }}>
                  <div className="stat-val" style={{ fontSize:'0.82rem' }}>{v}</div>
                  <div className="stat-lbl" style={{ fontSize:'0.52rem' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Records sections with add buttons */}
        <RecordSection
          title="Breeding"
          records={animalBreeding}
          onAdd={()=>setSubForm('breeding')}
          renderRecord={b=>(
            <div>
              <div style={{ fontSize:'0.75rem', color:'var(--cream)' }}>
                Bred {b.bred_date} {b.bull_tag&&`to ${b.bull_tag}`} {b.breeding_method&&`(${b.breeding_method})`}
              </div>
              <div style={{ fontSize:'0.68rem', color:'var(--subtext)' }}>
                {b.actual_calving_date ? `Calved ${b.actual_calving_date}${b.calf_tag?` → ${b.calf_tag}`:''}${b.calving_ease?` · ease ${b.calving_ease}`:''}` : `Due ${b.expected_calving_date||expectedCalvingDate(b.bred_date)}`}
              </div>
            </div>
          )}
          onRemove={removeBreeding}
        />

        <RecordSection
          title="Weights"
          records={animalWeights}
          onAdd={()=>setSubForm('weight')}
          renderRecord={(w,i)=>{
            const next = animalWeights[i-1]
            const adgVal = next ? calcADG([w,next]) : null
            return (
              <div>
                <div style={{ fontSize:'0.75rem', color:'var(--cream)' }}>{w.date}: <strong>{w.weight} lb</strong> <span className="badge" style={{ fontSize:'0.55rem' }}>{w.event_type}</span></div>
                {adgVal && <div style={{ fontSize:'0.68rem', color:'var(--grass)' }}>ADG to next: {adgVal} lb/day</div>}
              </div>
            )
          }}
          onRemove={removeWeight}
        />

        <RecordSection
          title="Body Condition (BCS)"
          records={animalBcs}
          onAdd={()=>setSubForm('bcs')}
          renderRecord={b=>(
            <div style={{ fontSize:'0.75rem', color:'var(--cream)' }}>
              {b.date}: <strong style={{ color:bcsColor(b.score) }}>{b.score}</strong> — {BCS_LABELS[Math.round(b.score)]}
            </div>
          )}
          onRemove={removeBcs}
        />

        <RecordSection
          title="Health"
          records={animalHealth}
          onAdd={()=>setSubForm('health')}
          renderRecord={h=>(
            <div>
              <div style={{ fontSize:'0.75rem', color:'var(--cream)' }}>{h.date}: {h.product||h.condition} <span className="badge" style={{ fontSize:'0.55rem' }}>{h.record_type}</span></div>
              {h.withdrawal_date && <div style={{ fontSize:'0.68rem', color:'var(--gold)' }}>Withdrawal until {h.withdrawal_date}</div>}
              {h.next_due_date && <div style={{ fontSize:'0.68rem', color:'var(--subtext)' }}>Next due {h.next_due_date}</div>}
            </div>
          )}
          onRemove={removeHealth}
        />

        {a.notes && (
          <div className="card">
            <div className="card-sub mb-1">Notes</div>
            <div style={{ fontSize:'0.82rem', color:'var(--cream)' }}>{a.notes}</div>
          </div>
        )}

        <div className="flex gap-1" style={{ flexWrap:'wrap' }}>
          {a.status === 'active' && (
            <button className="btn btn-secondary btn-sm" onClick={()=>setDeathModal(a)}>⚰ Mark as Died</button>
          )}
          <button className="btn btn-danger btn-sm" onClick={()=>{if(confirm(`Delete ${a.tag}? This permanently removes all records. To keep history, use 'Mark as Died' instead.`)){removeAnimal(a.id);setView('list');setSelId(null)}}}>
            Delete Animal
          </button>
        </div>

        {/* Death modal */}
        {deathModal && (
          <DeathModal animal={deathModal} onClose={()=>setDeathModal(null)} onConfirm={markDied} />
        )}

        {/* Sub-record modals */}
        {subForm && (
          <SubRecordModal
            type={subForm}
            animal={a}
            animals={animals}
            onClose={()=>setSubForm(null)}
            onSave={async (data)=>{
              try {
                if (subForm==='breeding') {
                  const rec = { ...data, animal_id:a.id, expected_calving_date: data.bred_date?expectedCalvingDate(data.bred_date):null, season_year: curYear }
                  const created = await insertBreeding(rec)
                  // Auto-create calf if calving recorded
                  if (data.actual_calving_date && data.calf_tag) {
                    // Compute calf breed composition from dam + sire
                    const damComp = a.breed_composition ? (typeof a.breed_composition==='string'?JSON.parse(a.breed_composition):a.breed_composition) : (a.breed?[{breed:a.breed,pct:100}]:null)
                    const sireAnimal = animals.find(x => x.tag === data.bull_tag)
                    const sireComp = sireAnimal?.breed_composition ? (typeof sireAnimal.breed_composition==='string'?JSON.parse(sireAnimal.breed_composition):sireAnimal.breed_composition) : (sireAnimal?.breed?[{breed:sireAnimal.breed,pct:100}]:null)
                    const calfComp = calcCalfComposition(damComp, sireComp)
                    await insertAnimal({
                      tag: data.calf_tag, sex: data.calf_sex || 'calf', breed: calfComp?calfComp[0].breed:a.breed,
                      breed_composition: calfComp ? JSON.stringify(calfComp) : null,
                      birth_date: data.actual_calving_date,
                      birth_weight: data.calf_birth_weight ? +data.calf_birth_weight : null,
                      dam_tag: a.tag, sire_tag: data.bull_tag||'',
                      current_herd_id: a.current_herd_id || null,
                      status:'active', lactating:false,
                    })
                    if (a.sex==='cow') await updateAnimal(a.id, { lactating:true })
                  }
                }
                if (subForm==='weight') await insertWeight({ ...data, animal_id:a.id })
                if (subForm==='bcs')    await insertBcs({ ...data, animal_id:a.id })
                if (subForm==='health') await insertHealth({ ...data, animal_id:a.id })
                setSubForm(null)
              } catch(e) { alert('Error: '+e.message) }
            }}
          />
        )}
      </div>
    )
  }

  return null
}

// ── Record section component ──────────────────────────────────────────────────
function RecordSection({ title, records, onAdd, renderRecord, onRemove }) {
  return (
    <div className="card">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: records.length?'0.5rem':0 }}>
        <div className="card-sub">{title} ({records.length})</div>
        <button className="btn btn-primary btn-sm" onClick={onAdd}>+ Add</button>
      </div>
      {records.map((r,i)=>(
        <div key={r.id} className="list-item" style={{ padding:'0.5rem 0' }}>
          {renderRecord(r,i)}
          <button className="btn btn-danger btn-sm" onClick={()=>{if(confirm('Delete this record?'))onRemove(r.id)}}>✕</button>
        </div>
      ))}
    </div>
  )
}

// ── Sub-record modal ────────────────────────────────────────────────────────────
function SubRecordModal({ type, animal, animals, onClose, onSave }) {
  const [d, setD] = useState({
    date: today(),
    bred_date: today(), breeding_method:'natural', bull_tag:'', actual_calving_date:'', calf_tag:'', calf_sex:'heifer_calf', calf_birth_weight:'', calving_ease:'', preg_result:'',
    weight:'', event_type:'routine',
    score:'5',
    record_type:'vaccination', product:'', dose:'', condition:'', withdrawal_date:'', next_due_date:'',
  })
  const s = (k,v)=>setD(p=>({...p,[k]:v}))
  const bulls = animals.filter(a=>a.sex==='bull')

  const titles = { breeding:'Breeding Record', weight:'Weight', bcs:'Body Condition Score', health:'Health Record' }

  function handleSave() {
    if (type==='breeding') onSave({ bred_date:d.bred_date||null, breeding_method:d.breeding_method, bull_tag:d.bull_tag, preg_result:d.preg_result||null, actual_calving_date:d.actual_calving_date||null, calf_tag:d.calf_tag, calf_sex:d.calf_sex, calf_birth_weight:d.calf_birth_weight, calving_ease:d.calving_ease?+d.calving_ease:null })
    if (type==='weight') { if(!d.weight){alert('Weight required');return} onSave({ date:d.date, weight:+d.weight, event_type:d.event_type }) }
    if (type==='bcs') onSave({ date:d.date, score:+d.score })
    if (type==='health') onSave({ date:d.date, record_type:d.record_type, product:d.product, dose:d.dose, condition:d.condition, withdrawal_date:d.withdrawal_date||null, next_due_date:d.next_due_date||null })
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'1rem' }} onClick={onClose}>
      <div className="card" style={{ maxWidth:480, width:'100%', maxHeight:'85vh', overflowY:'auto', margin:0 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
          <div className="card-title">{titles[type]} — {animal.tag}</div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        {type==='breeding' && (
          <>
            <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
              <div className="field"><label className="label">Bred Date</label><input className="input" type="date" value={d.bred_date} onChange={e=>s('bred_date',e.target.value)} /></div>
              <div className="field"><label className="label">Method</label><select className="select" value={d.breeding_method} onChange={e=>s('breeding_method',e.target.value)}><option value="natural">Natural</option><option value="AI">AI</option></select></div>
            </div>
            <div className="field" style={{ marginBottom:'0.75rem' }}>
              <label className="label">Bull Used</label>
              <input className="input" value={d.bull_tag} onChange={e=>s('bull_tag',e.target.value)} list="modal-bulls" placeholder="Bull tag" />
              <datalist id="modal-bulls">{bulls.map(b=><option key={b.id} value={b.tag} />)}</datalist>
            </div>
            {d.bred_date && <div style={{ fontSize:'0.72rem', color:'var(--grass)', marginBottom:'0.75rem' }}>Expected calving: {expectedCalvingDate(d.bred_date)}</div>}
            <hr className="divider" />
            <div style={{ fontSize:'0.7rem', color:'var(--subtext)', marginBottom:'0.5rem' }}>If already calved, fill below (auto-creates calf record):</div>
            <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
              <div className="field"><label className="label">Actual Calving</label><input className="input" type="date" value={d.actual_calving_date} onChange={e=>s('actual_calving_date',e.target.value)} /></div>
              <div className="field"><label className="label">Calf Tag</label><input className="input" value={d.calf_tag} onChange={e=>s('calf_tag',e.target.value)} placeholder={suggestNextTag(animals.map(x=>x.tag), curYear)} /></div>
            </div>
            <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
              <div className="field"><label className="label">Calf Sex</label>
                <select className="select" value={d.calf_sex} onChange={e=>s('calf_sex',e.target.value)}>
                  <option value="heifer_calf">🐮 Heifer Calf</option>
                  <option value="bull_calf">🐮 Bull Calf</option>
                  <option value="steer_calf">🐮 Steer Calf</option>
                </select>
              </div>
              <div className="field"><label className="label">Calf Birth Weight (lb)</label><input className="input" type="number" value={d.calf_birth_weight} onChange={e=>s('calf_birth_weight',e.target.value)} placeholder="e.g. 82" /></div>
            </div>
            <div className="field" style={{ marginBottom:'1rem' }}><label className="label">Calving Ease (1=easy, 5=hard)</label><select className="select" value={d.calving_ease} onChange={e=>s('calving_ease',e.target.value)}><option value="">—</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></div>
          </>
        )}

        {type==='weight' && (
          <>
            <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
              <div className="field"><label className="label">Date</label><input className="input" type="date" value={d.date} onChange={e=>s('date',e.target.value)} /></div>
              <div className="field"><label className="label">Weight (lb)</label><input className="input" type="number" value={d.weight} onChange={e=>s('weight',e.target.value)} /></div>
            </div>
            <div className="field" style={{ marginBottom:'1rem' }}>
              <label className="label">Event Type</label>
              <select className="select" value={d.event_type} onChange={e=>s('event_type',e.target.value)}>
                {['routine','birth','weaning','yearling','breeding','sale','preg-check'].map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </>
        )}

        {type==='bcs' && (
          <>
            <div className="field" style={{ marginBottom:'0.75rem' }}><label className="label">Date</label><input className="input" type="date" value={d.date} onChange={e=>s('date',e.target.value)} /></div>
            <div className="field" style={{ marginBottom:'1rem' }}>
              <label className="label">Score (1-9): {d.score} — {BCS_LABELS[Math.round(+d.score)]}</label>
              <input type="range" min="1" max="9" step="0.5" value={d.score} onChange={e=>s('score',e.target.value)} style={{ width:'100%' }} />
            </div>
          </>
        )}

        {type==='health' && (
          <>
            <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
              <div className="field"><label className="label">Date</label><input className="input" type="date" value={d.date} onChange={e=>s('date',e.target.value)} /></div>
              <div className="field"><label className="label">Type</label><select className="select" value={d.record_type} onChange={e=>s('record_type',e.target.value)}>{['vaccination','treatment','vet','repro'].map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            </div>
            <div className="grid-2" style={{ marginBottom:'0.75rem' }}>
              <div className="field"><label className="label">Product</label><input className="input" value={d.product} onChange={e=>s('product',e.target.value)} placeholder="e.g. Vision 7" /></div>
              <div className="field"><label className="label">Dose</label><input className="input" value={d.dose} onChange={e=>s('dose',e.target.value)} placeholder="e.g. 2cc" /></div>
            </div>
            <div className="field" style={{ marginBottom:'0.75rem' }}><label className="label">Condition / Reason</label><input className="input" value={d.condition} onChange={e=>s('condition',e.target.value)} /></div>
            <div className="grid-2" style={{ marginBottom:'1rem' }}>
              <div className="field"><label className="label">Withdrawal Until</label><input className="input" type="date" value={d.withdrawal_date} onChange={e=>s('withdrawal_date',e.target.value)} /></div>
              <div className="field"><label className="label">Next Due</label><input className="input" type="date" value={d.next_due_date} onChange={e=>s('next_due_date',e.target.value)} /></div>
            </div>
          </>
        )}

        <div className="flex gap-1">
          <button className="btn btn-primary" onClick={handleSave}>✓ Save</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Death / loss modal ──────────────────────────────────────────────────────────
function DeathModal({ animal, onClose, onConfirm }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0,10))
  const [cause, setCause] = useState('')
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'1rem' }} onClick={onClose}>
      <div className="card" style={{ maxWidth:420, width:'100%', margin:0 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
          <div className="card-title">⚰ Mark {animal.tag} as Died</div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="field" style={{ marginBottom:'0.75rem' }}>
          <label className="label">Date of Death</label>
          <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom:'1rem' }}>
          <label className="label">Cause / Notes</label>
          <textarea className="textarea" rows={3} value={cause} onChange={e=>setCause(e.target.value)}
            placeholder="e.g. stillborn, scours, predator, weather, unknown…" />
        </div>
        {isCalfSex(animal.sex) && animal.dam_tag && (
          <div style={{ fontSize:'0.72rem', color:'var(--gold)', marginBottom:'1rem' }}>
            This calf's dam ({animal.dam_tag}) will be marked as having lost this calf (born but not weaned).
          </div>
        )}
        <div style={{ fontSize:'0.7rem', color:'var(--subtext)', marginBottom:'1rem' }}>
          The record is kept permanently and will appear under the Losses filter.
        </div>
        <div className="flex gap-1">
          <button className="btn btn-danger" onClick={()=>onConfirm(animal, date, cause)}>⚰ Confirm Death</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
