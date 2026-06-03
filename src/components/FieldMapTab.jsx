import { useState, useEffect, useRef, useCallback } from 'react'
import { useMachines, useFieldPositions, useGrazingPlans } from '../hooks/useData'
import { getEndTowerRadius } from '../lib/grazing'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  ungrazed: '#2e6b1c',   // dark green — full, waiting to be grazed
  ungrazedFill: '#3a8a22',
  current:  '#f0c040',   // gold — machine position today
  grazed:   '#e8d44d',   // yellow — grazed this rotation, recovering
  grazedFill: '#d4c030',
  boundary: '#6ec040',   // bright green — field outline
  center:   '#f0c040',   // gold — pivot center
}

// ── Google Maps loader ────────────────────────────────────────────────────────
let mapsLoaded = false, mapsLoading = false
const mapsCallbacks = []
function loadGoogleMaps(cb) {
  if (mapsLoaded) { cb(); return }
  mapsCallbacks.push(cb)
  if (mapsLoading) return
  mapsLoading = true
  const s = document.createElement('script')
  s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry`
  s.onload = () => { mapsLoaded = true; mapsLoading = false; mapsCallbacks.forEach(c => c()); mapsCallbacks.length = 0 }
  document.head.appendChild(s)
}

// ── Acre calculation ──────────────────────────────────────────────────────────
function calcPolygonAcres(points) {
  if (!points || points.length < 3) return 0
  const centerLat = points.reduce((s, p) => s + p.lat, 0) / points.length
  const latFt = 364007
  const lngFt = latFt * Math.cos(centerLat * Math.PI / 180)
  const pts = points.map(p => ({ x: (p.lng - points[0].lng) * lngFt, y: (p.lat - points[0].lat) * latFt }))
  let area = 0
  const n = pts.length
  for (let i = 0; i < n; i++) { const j = (i+1)%n; area += pts[i].x*pts[j].y - pts[j].x*pts[i].y }
  return Math.abs(area/2) / 43560
}

const ftToM = ft => ft * 0.3048

export default function FieldMapTab() {
  const { data: machines, update: updateMachine } = useMachines()
  const { data: fieldPositions } = useFieldPositions()
  const { data: plans }          = useGrazingPlans()

  const [selMachineId, setSelMachineId] = useState('')
  const [mapReady, setMapReady]         = useState(false)
  const [mode, setMode]                 = useState(null) // 'boundary'|'start'|'end'|null
  const [boundary, setBoundary]         = useState([])
  const [saving, setSaving]             = useState(false)
  const [savedMsg, setSavedMsg]         = useState('')

  const mapRef       = useRef(null)
  const mapInstance  = useRef(null)
  const overlays     = useRef([])
  const modeRef      = useRef(null)
  const boundaryRef  = useRef([])
  const nextIdRef    = useRef(1)

  // Keep refs in sync
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { boundaryRef.current = boundary }, [boundary])

  const selMachine   = machines.find(m => m.id === selMachineId)
  const machineSpans = selMachine
    ? (typeof selMachine.spans === 'string' ? JSON.parse(selMachine.spans) : selMachine.spans) || []
    : []
  const endTowerRadius = getEndTowerRadius(machineSpans)
  const fieldPos     = fieldPositions.find(p => p.machine_id === selMachineId)
  const activePlan   = plans.find(p => p.machine_id === selMachineId && p.status === 'active')
  const isPivot      = selMachine?.type === 'pivot'

  // Load boundary from machine when selected
  useEffect(() => {
    if (!selMachine) return
    const saved = selMachine.boundary_points
      ? (typeof selMachine.boundary_points === 'string' ? JSON.parse(selMachine.boundary_points) : selMachine.boundary_points)
      : []
    setBoundary(saved || [])
    nextIdRef.current = (saved?.length || 0) + 1
  }, [selMachineId])

  // Load Google Maps
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return
    loadGoogleMaps(() => setMapReady(true))
  }, [])

  // Init map
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstance.current) return
    mapInstance.current = new window.google.maps.Map(mapRef.current, {
      zoom: 15, center: { lat: 41.5, lng: -99.5 },
      mapTypeId: 'satellite', tilt: 0,
      mapTypeControl: true, streetViewControl: false, fullscreenControl: true,
    })
  }, [mapReady])

  // Re-register click listener when mode changes
  useEffect(() => {
    if (!mapInstance.current) return
    const listener = mapInstance.current.addListener('click', (e) => {
      const m = modeRef.current
      if (!m) return
      const lat = e.latLng.lat(), lng = e.latLng.lng()
      if (m === 'boundary') {
        const pt = { id: nextIdRef.current++, lat, lng }
        setBoundary(prev => [...prev, pt])
      } else {
        handlePinDrop(lat, lng, m)
      }
    })
    return () => window.google?.maps?.event?.removeListener(listener)
  }, [mapReady, mode])

  // Redraw whenever anything changes
  useEffect(() => {
    if (!mapInstance.current || !mapReady) return
    drawAll()
  }, [selMachineId, selMachine, boundary, fieldPos, mapReady])

  function clearOverlays() {
    overlays.current.forEach(o => { try { o.setMap(null) } catch {} })
    overlays.current = []
  }

  function drawAll() {
    if (!mapInstance.current) return
    clearOverlays()
    const map = mapInstance.current

    // ── Draw boundary polygon ──
    if (boundary.length >= 3) {
      const path = boundary.map(p => ({ lat: p.lat, lng: p.lng }))
      const poly = new window.google.maps.Polygon({
        map, paths: path,
        strokeColor: C.boundary, strokeOpacity: 0.9, strokeWeight: 2,
        fillColor: C.boundary, fillOpacity: 0.06,
      })
      overlays.current.push(poly)
    } else if (boundary.length >= 2) {
      // Draw line while building
      const line = new window.google.maps.Polyline({
        map, path: boundary.map(p => ({ lat: p.lat, lng: p.lng })),
        strokeColor: C.boundary, strokeOpacity: 0.8, strokeWeight: 2, strokeDashPattern: [5, 5],
      })
      overlays.current.push(line)
    }

    // Draw boundary vertex markers
    boundary.forEach((pt, i) => {
      const marker = new window.google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng }, map,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 7, fillColor: i === 0 ? C.current : C.boundary,
          fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2,
        },
        title: `Point ${i+1} — click to remove`,
        zIndex: 20,
      })
      marker.addListener('click', (e) => {
        e.stop()
        removeBoundaryPoint(pt.id)
      })
      overlays.current.push(marker)
    })

    if (!selMachine) return

    // ── Draw machine position ──
    if (isPivot) drawPivot(map)
    else drawLinear(map)
  }

  function drawPivot(map) {
    const m = selMachine
    if (!m.center_lat || !m.center_lng) {
      // Show instruction if no center
      return
    }
    const center = { lat: Number(m.center_lat), lng: Number(m.center_lng) }
    const currentDeg = fieldPos ? Number(fieldPos.current_position) : 0

    // Grazed wedge (yellow) — 0° to current position
    if (currentDeg > 0) {
      const grazedPath = buildWedgePath(center, endTowerRadius, 0, currentDeg)
      if (grazedPath) {
        const grazed = new window.google.maps.Polygon({
          map, paths: grazedPath,
          strokeColor: C.grazed, strokeOpacity: 0.6, strokeWeight: 1,
          fillColor: C.grazedFill, fillOpacity: 0.35,
        })
        overlays.current.push(grazed)
      }
    }

    // Ungrazed wedge (dark green) — current to 360°
    if (currentDeg < 360) {
      const ungrazedPath = buildWedgePath(center, endTowerRadius, currentDeg, 360)
      if (ungrazedPath) {
        const ungrazed = new window.google.maps.Polygon({
          map, paths: ungrazedPath,
          strokeColor: C.ungrazed, strokeOpacity: 0.7, strokeWeight: 1,
          fillColor: C.ungrazedFill, fillOpacity: 0.25,
        })
        overlays.current.push(ungrazed)
      }
    }

    // Span rings
    machineSpans.forEach((span, i) => {
      const r = machineSpans.slice(0, i+1).reduce((s, x) => s + x.length_ft, 0)
      const ring = new window.google.maps.Circle({
        map, center, radius: ftToM(r),
        strokeColor: i === machineSpans.length-1 ? C.current : '#3a7a28',
        strokeOpacity: i === machineSpans.length-1 ? 0.9 : 0.35,
        strokeWeight: i === machineSpans.length-1 ? 2 : 1,
        fillColor: 'transparent', fillOpacity: 0,
      })
      overlays.current.push(ring)
    })

    // Current arm (gold line)
    const posRad = currentDeg * Math.PI / 180
    const lineEnd = {
      lat: center.lat + (ftToM(endTowerRadius) / 111320) * Math.cos(posRad),
      lng: center.lng + (ftToM(endTowerRadius) / (111320 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(posRad),
    }
    const arm = new window.google.maps.Polyline({
      map, path: [center, lineEnd],
      strokeColor: C.current, strokeOpacity: 1, strokeWeight: 3,
    })
    overlays.current.push(arm)

    // Center marker
    const centerMarker = new window.google.maps.Marker({
      position: center, map,
      icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: C.center, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      title: 'Pivot Center', zIndex: 30,
    })
    overlays.current.push(centerMarker)

    // Machine head marker
    const head = new window.google.maps.Marker({
      position: lineEnd, map,
      icon: { path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: C.current, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1, rotation: currentDeg },
      title: `Position: ${currentDeg.toFixed(1)}°`, zIndex: 25,
    })
    overlays.current.push(head)

    map.panTo(center)
    map.setZoom(14)
  }

  function drawLinear(map) {
    const m = selMachine
    if (!m.start_lat || !m.start_lng) return
    const start = { lat: Number(m.start_lat), lng: Number(m.start_lng) }
    const end   = m.end_lat ? { lat: Number(m.end_lat), lng: Number(m.end_lng) } : null
    const progressFt = fieldPos ? Number(fieldPos.current_position) : 0
    const totalFt = Number(m.run_length_ft) || 4300

    if (!end) {
      // Just show start marker
      const sm = new window.google.maps.Marker({
        position: start, map,
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: C.current, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        title: 'Field Start', zIndex: 30,
      })
      overlays.current.push(sm)
      map.panTo(start)
      return
    }

    // Interpolate current position along the run
    const pct = Math.min(1, Math.max(0, progressFt / totalFt))
    const curLat = start.lat + (end.lat - start.lat) * pct
    const curLng = start.lng + (end.lng - start.lng) * pct
    const currentPos = { lat: curLat, lng: curLng }

    // Width offset for rectangle display
    const widthFt = endTowerRadius || 790
    const widthDeg = ftToM(widthFt) / 111320 * 0.5
    // Perpendicular direction
    const dLat = end.lat - start.lat
    const dLng = end.lng - start.lng
    const len = Math.sqrt(dLat*dLat + dLng*dLng)
    const perpLat = -dLng/len * widthDeg
    const perpLng =  dLat/len * widthDeg

    // Grazed rectangle (yellow) — start to current
    if (pct > 0.01) {
      const grazedRect = [
        { lat: start.lat + perpLat, lng: start.lng + perpLng },
        { lat: curLat  + perpLat, lng: curLng  + perpLng },
        { lat: curLat  - perpLat, lng: curLng  - perpLng },
        { lat: start.lat - perpLat, lng: start.lng - perpLng },
      ]
      const grazed = new window.google.maps.Polygon({
        map, paths: grazedRect,
        strokeColor: C.grazed, strokeOpacity: 0.6, strokeWeight: 1,
        fillColor: C.grazedFill, fillOpacity: 0.4,
      })
      overlays.current.push(grazed)
    }

    // Ungrazed rectangle (dark green) — current to end
    if (pct < 0.99) {
      const ungrazedRect = [
        { lat: curLat + perpLat, lng: curLng + perpLng },
        { lat: end.lat + perpLat, lng: end.lng + perpLng },
        { lat: end.lat - perpLat, lng: end.lng - perpLng },
        { lat: curLat - perpLat, lng: curLng - perpLng },
      ]
      const ungrazed = new window.google.maps.Polygon({
        map, paths: ungrazedRect,
        strokeColor: C.ungrazed, strokeOpacity: 0.8, strokeWeight: 1,
        fillColor: C.ungrazedFill, fillOpacity: 0.35,
      })
      overlays.current.push(ungrazed)
    }

    // Current position line (gold) — perpendicular strip
    const stripLine = new window.google.maps.Polyline({
      map,
      path: [
        { lat: curLat + perpLat*2, lng: curLng + perpLng*2 },
        { lat: curLat - perpLat*2, lng: curLng - perpLng*2 },
      ],
      strokeColor: C.current, strokeOpacity: 1, strokeWeight: 4,
    })
    overlays.current.push(stripLine)

    // Start marker
    const startMarker = new window.google.maps.Marker({
      position: start, map,
      icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: C.boundary, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      title: 'Field Start', zIndex: 30,
    })
    overlays.current.push(startMarker)

    // End marker
    const endMarker = new window.google.maps.Marker({
      position: end, map,
      icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#c84030', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      title: 'Field End', zIndex: 30,
    })
    overlays.current.push(endMarker)

    // Machine head marker
    const head = new window.google.maps.Marker({
      position: currentPos, map,
      icon: { path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 7, fillColor: C.current, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1, rotation: Math.atan2(dLng, dLat) * 180/Math.PI },
      title: `Position: ${progressFt.toFixed(0)}ft`, zIndex: 25,
    })
    overlays.current.push(head)

    // Center the map
    const midLat = (start.lat + end.lat) / 2
    const midLng = (start.lng + end.lng) / 2
    map.panTo({ lat: midLat, lng: midLng })
    map.setZoom(14)
  }

  function buildWedgePath(center, radiusFt, startDeg, endDeg) {
    if (endDeg <= startDeg) return null
    const points = [center]
    const steps  = Math.max(2, Math.round((endDeg - startDeg) / 2))
    for (let i = 0; i <= steps; i++) {
      const deg = startDeg + (endDeg - startDeg) * (i / steps)
      const rad = deg * Math.PI / 180
      const r   = ftToM(radiusFt)
      points.push({
        lat: center.lat + (r / 111320) * Math.cos(rad),
        lng: center.lng + (r / (111320 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(rad),
      })
    }
    points.push(center)
    return [points]
  }

  const handlePinDrop = useCallback(async (lat, lng, pinType) => {
    if (!selMachine) return
    setSaving(true)
    try {
      const updates = {}
      if (pinType === 'center') { updates.center_lat = lat; updates.center_lng = lng }
      if (pinType === 'start')  { updates.start_lat  = lat; updates.start_lng  = lng }
      if (pinType === 'end')    { updates.end_lat    = lat; updates.end_lng    = lng }
      await updateMachine(selMachine.id, updates)
      setMode(null)
      setSavedMsg(`${pinType} pin saved`)
      setTimeout(() => setSavedMsg(''), 2000)
    } catch(e) { alert('Error: ' + e.message) }
    setSaving(false)
  }, [selMachine, updateMachine])

  function removeBoundaryPoint(id) {
    setBoundary(prev => prev.filter(p => p.id !== id))
  }

  async function saveBoundary() {
    if (!selMachine || boundary.length < 3) return
    setSaving(true)
    try {
      const acres = calcPolygonAcres(boundary)
      await updateMachine(selMachine.id, {
        boundary_points: JSON.stringify(boundary),
        boundary_acres: +acres.toFixed(1),
      })
      setSavedMsg(`Boundary saved — ${acres.toFixed(1)} acres`)
      setTimeout(() => setSavedMsg(''), 3000)
      setMode(null)
    } catch(e) { alert('Error: ' + e.message) }
    setSaving(false)
  }

  async function clearBoundary() {
    if (!selMachine) return
    setBoundary([])
    await updateMachine(selMachine.id, { boundary_points: '[]', boundary_acres: null })
  }

  async function clearPin(pinType) {
    if (!selMachine) return
    const updates = {}
    if (pinType === 'center') { updates.center_lat = null; updates.center_lng = null }
    if (pinType === 'start')  { updates.start_lat  = null; updates.start_lng  = null }
    if (pinType === 'end')    { updates.end_lat    = null; updates.end_lng    = null }
    await updateMachine(selMachine.id, updates)
  }

  const boundaryAcres = calcPolygonAcres(boundary)
  const hasBoundary   = boundary.length >= 3
  const hasStart      = !!(selMachine?.start_lat || selMachine?.center_lat)
  const hasEnd        = !!selMachine?.end_lat
  const currentPos    = fieldPos ? Number(fieldPos.current_position) : 0
  const totalFt       = Number(selMachine?.run_length_ft) || 4300
  const pctComplete   = isPivot ? +(currentPos / 360 * 100).toFixed(1) : +(currentPos / totalFt * 100).toFixed(1)

  return (
    <div>
      <div className="section-heading">Field Map</div>
      <div className="section-desc">Draw field boundaries, set machine positions, and track grazing progress.</div>

      {!GOOGLE_MAPS_API_KEY && (
        <div style={{ background:'rgba(224,64,48,0.15)', border:'1px solid var(--alert)', borderRadius:10, padding:'1rem', marginBottom:'1.25rem', fontSize:'0.85rem', color:'var(--cream)' }}>
          ⚠ Google Maps API key not configured.
        </div>
      )}

      {/* Machine selector */}
      <div className="card" style={{ marginBottom:'0.75rem' }}>
        <div className="field">
          <label className="label">Select Machine</label>
          <select className="select" value={selMachineId} onChange={e => { setSelMachineId(e.target.value); setMode(null) }}>
            <option value="">Select machine…</option>
            {machines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.type})</option>)}
          </select>
        </div>
      </div>

      {selMachine && (
        <div className="card" style={{ marginBottom:'0.75rem' }}>
          {/* Status bar */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:'0.75rem' }}>
            <span className="badge">{selMachine.type}</span>
            <span className="badge badge-amber">{endTowerRadius} ft {isPivot ? 'radius' : 'wide'}</span>
            {hasBoundary && (
              <span className="badge" style={{ borderColor:'var(--grass)', color:'var(--grass)' }}>
                📐 {(selMachine.boundary_acres || boundaryAcres).toFixed(1)} acres
              </span>
            )}
            {fieldPos && (
              <span className="badge" style={{ borderColor:'var(--gold)', color:'var(--gold)' }}>
                {isPivot ? `${currentPos.toFixed(1)}° (${pctComplete}%)` : `${currentPos.toFixed(0)}ft (${pctComplete}%)`}
              </span>
            )}
            {activePlan && <span className="badge" style={{ borderColor:'var(--grass)', color:'var(--grass)' }}>● Active</span>}
          </div>

          {/* Tool buttons */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:'0.75rem' }}>
            {/* Boundary */}
            <button
              className={`btn btn-sm ${mode==='boundary' ? 'btn-amber' : 'btn-secondary'}`}
              onClick={() => setMode(mode==='boundary' ? null : 'boundary')}
            >
              {mode==='boundary' ? '✏ Drawing boundary…' : '✏ Draw Boundary'}
            </button>
            {hasBoundary && mode==='boundary' && (
              <button className="btn btn-primary btn-sm" onClick={saveBoundary} disabled={saving}>
                {saving ? <><span className="spinner"/> Saving…</> : `✓ Save Boundary (${boundaryAcres.toFixed(1)} ac)`}
              </button>
            )}
            {hasBoundary && mode!=='boundary' && (
              <button className="btn btn-danger btn-sm" onClick={clearBoundary}>✕ Clear Boundary</button>
            )}

            {/* Pivot center / Linear start */}
            <button
              className={`btn btn-sm ${mode==='center'||mode==='start' ? 'btn-amber' : 'btn-secondary'}`}
              onClick={() => setMode(mode===(isPivot?'center':'start') ? null : (isPivot?'center':'start'))}
            >
              {(mode==='center'||mode==='start') ? '📍 Click map…' : isPivot ? '📍 Set Center' : '📍 Set Start'}
            </button>
            {hasStart && (
              <button className="btn btn-danger btn-sm" onClick={() => clearPin(isPivot?'center':'start')}>
                ✕ {isPivot ? 'Clear Center' : 'Clear Start'}
              </button>
            )}

            {/* Linear end */}
            {!isPivot && (
              <>
                <button
                  className={`btn btn-sm ${mode==='end' ? 'btn-amber' : 'btn-secondary'}`}
                  onClick={() => setMode(mode==='end' ? null : 'end')}
                >
                  {mode==='end' ? '📍 Click map for end…' : '📍 Set End'}
                </button>
                {hasEnd && (
                  <button className="btn btn-danger btn-sm" onClick={() => clearPin('end')}>✕ Clear End</button>
                )}
              </>
            )}

            {/* Clear all */}
            {(hasBoundary || hasStart || hasEnd) && (
              <button className="btn btn-danger btn-sm" onClick={async () => {
                if (!confirm('Clear everything for this machine?')) return
                setBoundary([])
                await updateMachine(selMachine.id, {
                  boundary_points:'[]', boundary_acres:null,
                  center_lat:null, center_lng:null,
                  start_lat:null, start_lng:null,
                  end_lat:null, end_lng:null,
                })
              }}>✕ Clear All</button>
            )}
          </div>

          {/* Mode instruction */}
          {mode && (
            <div style={{ background:'rgba(240,192,64,0.12)', border:'1px solid rgba(240,192,64,0.4)', borderRadius:7, padding:'8px 12px', marginBottom:'0.75rem', fontSize:'0.8rem', color:'var(--gold)' }}>
              {mode === 'boundary' && `✏ Click points around your field perimeter. First point is green — click it to close, or click Save when done. Click any vertex to remove it. ${boundary.length > 0 ? `(${boundary.length} points — ${boundary.length >= 3 ? boundaryAcres.toFixed(1)+' ac' : 'need 3+ to close'})` : ''}`}
              {mode === 'start'    && '📍 Click the map where your linear machine starts.'}
              {mode === 'end'      && '📍 Click the map where your linear machine ends (far end of run).'}
              {mode === 'center'   && '📍 Click the map on your pivot center point.'}
              {saving && <span style={{ marginLeft:8 }}><span className="spinner"/> Saving…</span>}
            </div>
          )}

          {/* Saved confirmation */}
          {savedMsg && (
            <div style={{ background:'rgba(110,192,64,0.15)', border:'1px solid var(--grass)', borderRadius:7, padding:'7px 12px', marginBottom:'0.75rem', fontSize:'0.78rem', color:'var(--grass)' }}>
              ✓ {savedMsg}
            </div>
          )}

          {/* Legend */}
          {(hasStart || hasBoundary) && (
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:'0.75rem', fontSize:'0.68rem', fontFamily:'DM Mono, monospace' }}>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:12, height:12, borderRadius:2, background:'#2e6b1c', display:'inline-block' }} />
                <span style={{ color:'var(--subtext)' }}>Ungrazed — full stand</span>
              </span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:12, height:12, borderRadius:2, background:'#f0c040', display:'inline-block' }} />
                <span style={{ color:'var(--subtext)' }}>Current position</span>
              </span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:12, height:12, borderRadius:2, background:'#e8d44d', display:'inline-block' }} />
                <span style={{ color:'var(--subtext)' }}>Grazed this rotation</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Map */}
      {GOOGLE_MAPS_API_KEY ? (
        <div ref={mapRef} style={{ width:'100%', height:500, borderRadius:12, border:'1px solid var(--bark2)', background:'var(--bark)' }} />
      ) : (
        <div style={{ width:'100%', height:400, borderRadius:12, border:'2px dashed var(--bark2)', background:'var(--bark)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'0.5rem' }}>
          <div style={{ fontSize:'2.5rem' }}>🗺</div>
          <div style={{ color:'var(--subtext)', fontSize:'0.85rem' }}>Google Maps appears here once API key is configured</div>
        </div>
      )}

      {/* Boundary point list */}
      {boundary.length > 0 && (
        <div className="card" style={{ marginTop:'0.75rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
            <div className="card-sub">Boundary Points ({boundary.length})</div>
            <div className="flex gap-1">
              {boundary.length >= 3 && (
                <span style={{ fontSize:'0.72rem', color:'var(--grass)', fontFamily:'DM Mono, monospace' }}>
                  {boundaryAcres.toFixed(1)} acres
                </span>
              )}
              <button className="btn btn-danger btn-sm" onClick={() => setBoundary([])}>Clear All Points</button>
            </div>
          </div>
          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
            {boundary.map((pt, i) => (
              <div key={pt.id} style={{
                background:'var(--bark)', border:`1px solid ${i===0?'var(--gold)':'var(--bark2)'}`,
                borderRadius:6, padding:'3px 9px', fontSize:'0.62rem', fontFamily:'DM Mono, monospace',
                color:i===0?'var(--gold)':'var(--subtext)',
                display:'flex', alignItems:'center', gap:5,
              }}>
                {i===0?'START':i+1} {pt.lat.toFixed(4)}, {pt.lng.toFixed(4)}
                <button onClick={() => removeBoundaryPoint(pt.id)} style={{ background:'none', border:'none', color:'var(--alert)', cursor:'pointer', fontSize:10, padding:0 }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All machines list */}
      <div className="card" style={{ marginTop:'0.75rem' }}>
        <div className="card-title mb-2">All Fields</div>
        {machines.length === 0 && <div className="text-muted text-sm">No machines saved.</div>}
        {machines.map(m => {
          const pos  = fieldPositions.find(p => p.machine_id === m.id)
          const plan = plans.find(p => p.machine_id === m.id && p.status === 'active')
          const mSpans = typeof m.spans === 'string' ? JSON.parse(m.spans||'[]') : (m.spans||[])
          const r = getEndTowerRadius(mSpans)
          const hasBound = m.boundary_acres > 0
          const hasPins  = m.type === 'pivot' ? m.center_lat : m.start_lat
          return (
            <div key={m.id} className="list-item" onClick={() => setSelMachineId(m.id)}>
              <div>
                <div className="flex gap-1" style={{ alignItems:'center', marginBottom:'0.25rem' }}>
                  <span>{m.type==='pivot'?'🔄':'➡️'}</span>
                  <strong style={{ color:'var(--cream)' }}>{m.name}</strong>
                  {plan && <span className="badge" style={{ borderColor:'var(--grass)', color:'var(--grass)' }}>● Active</span>}
                  {hasBound && <span className="badge" style={{ borderColor:'var(--sky)', color:'var(--sky)' }}>📐 {m.boundary_acres} ac</span>}
                  {!hasPins && <span style={{ fontSize:'0.62rem', color:'var(--subtext)' }}>📍 No pins set</span>}
                </div>
                <div style={{ fontSize:'0.7rem', color:'var(--subtext)', fontFamily:'DM Mono, monospace' }}>
                  {m.total_spans} spans · {r}ft · {m.ipm} ipm
                  {pos && ` · Position: ${Number(pos.current_position).toFixed(1)}${m.type==='pivot'?'°':' ft'}`}
                </div>
              </div>
              <span style={{ fontSize:'0.72rem', color:'var(--grass)' }}>View →</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
