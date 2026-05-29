import { useState, useEffect, useRef, useCallback } from 'react'
import { useMachines, useFieldPositions, useGrazingPlans, usePasses } from '../hooks/useData'
import { getEndTowerRadius, pivotPositionToGPS, linearPositionToGPS } from '../lib/grazing'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

// Load Google Maps script once
let mapsLoaded = false
let mapsLoading = false
const mapsCallbacks = []

function loadGoogleMaps(callback) {
  if (mapsLoaded) { callback(); return }
  mapsCallbacks.push(callback)
  if (mapsLoading) return
  mapsLoading = true
  const script = document.createElement('script')
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry`
  script.onload = () => {
    mapsLoaded = true
    mapsLoading = false
    mapsCallbacks.forEach(cb => cb())
    mapsCallbacks.length = 0
  }
  document.head.appendChild(script)
}

// Convert feet to meters
const ftToM = ft => ft * 0.3048

export default function FieldMapTab() {
  const { data: machines, update: updateMachine } = useMachines()
  const { data: fieldPositions }  = useFieldPositions()
  const { data: plans }           = useGrazingPlans()

  const [selMachineId, setSelMachineId] = useState('')
  const [mapReady, setMapReady]         = useState(false)
  const [pinMode, setPinMode]           = useState(null) // 'center' | 'start' | 'end' | null
  const [savingPin, setSavingPin]       = useState(false)

  // Keep ref in sync with state so map listener always has latest value
  useEffect(() => { pinModeRef.current = pinMode }, [pinMode])

  const mapRef      = useRef(null)
  const mapInstance = useRef(null)
  const overlays    = useRef([]) // store drawn shapes for cleanup
  const pinModeRef  = useRef(null) // always has latest pinMode for map listener

  const selMachine = machines.find(m => m.id === selMachineId)
  const machineSpans = selMachine
    ? (typeof selMachine.spans === 'string' ? JSON.parse(selMachine.spans) : selMachine.spans) || []
    : []
  const endTowerRadius = getEndTowerRadius(machineSpans)

  // Get current position for selected machine
  const fieldPos = fieldPositions.find(p => p.machine_id === selMachineId)
  const activePlan = plans.find(p => p.machine_id === selMachineId && p.status === 'active')

  // Load Google Maps
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return
    loadGoogleMaps(() => setMapReady(true))
  }, [])

  // Initialize map
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstance.current) return
    mapInstance.current = new window.google.maps.Map(mapRef.current, {
      zoom: 15,
      center: { lat: 41.5, lng: -99.5 },
      mapTypeId: 'satellite',
      tilt: 0,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    })

    mapInstance.current.addListener('click', (e) => {
      if (!pinModeRef.current) return
      const lat = e.latLng.lat()
      const lng = e.latLng.lng()
      handlePinDrop(lat, lng)
    })
  }, [mapReady])

  // Draw machine on map when selection changes
  useEffect(() => {
    if (!mapInstance.current || !selMachine) return
    drawMachine()
  }, [selMachineId, selMachine, fieldPos, mapReady])

  function clearOverlays() {
    overlays.current.forEach(o => o.setMap(null))
    overlays.current = []
  }

  function drawMachine() {
    if (!mapInstance.current || !selMachine) return
    clearOverlays()
    const map = mapInstance.current

    if (selMachine.type === 'pivot' && selMachine.center_lat && selMachine.center_lng) {
      const center = { lat: Number(selMachine.center_lat), lng: Number(selMachine.center_lng) }

      // Center point marker
      const centerMarker = new window.google.maps.Marker({
        position: center, map,
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#f0c040', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        title: 'Pivot Center',
        zIndex: 10,
      })
      overlays.current.push(centerMarker)

      // Full field circle
      const fieldCircle = new window.google.maps.Circle({
        map, center, radius: ftToM(endTowerRadius),
        strokeColor: '#6ec040', strokeOpacity: 0.8, strokeWeight: 2,
        fillColor: '#6ec040', fillOpacity: 0.08,
      })
      overlays.current.push(fieldCircle)

      // Draw each span ring
      machineSpans.forEach((span, i) => {
        const r = machineSpans.slice(0, i + 1).reduce((s, x) => s + x.length_ft, 0)
        const ring = new window.google.maps.Circle({
          map, center, radius: ftToM(r),
          strokeColor: i === machineSpans.length - 1 ? '#f0c040' : '#3a7a28',
          strokeOpacity: i === machineSpans.length - 1 ? 0.9 : 0.4,
          strokeWeight: i === machineSpans.length - 1 ? 2 : 1,
          fillColor: 'transparent', fillOpacity: 0,
        })
        overlays.current.push(ring)
      })

      // Draw grazed wedge if we have position
      if (fieldPos && fieldPos.current_position != null) {
        const pos = Number(fieldPos.current_position)
        const grazedWedge = buildWedgePath(center, endTowerRadius, 0, pos)
        if (grazedWedge) {
          const wedge = new window.google.maps.Polygon({
            map, paths: grazedWedge,
            strokeColor: '#92d455', strokeOpacity: 0.6, strokeWeight: 1,
            fillColor: '#52a035', fillOpacity: 0.25,
          })
          overlays.current.push(wedge)
        }

        // Current position line
        const posRad = pos * Math.PI / 180
        const lineEnd = {
          lat: center.lat + (ftToM(endTowerRadius) / 111320) * Math.cos(posRad),
          lng: center.lng + (ftToM(endTowerRadius) / (111320 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(posRad),
        }
        const posLine = new window.google.maps.Polyline({
          map, path: [center, lineEnd],
          strokeColor: '#f0c040', strokeOpacity: 1, strokeWeight: 3,
        })
        overlays.current.push(posLine)

        // Machine position marker
        const machineMarker = new window.google.maps.Marker({
          position: lineEnd, map,
          icon: { path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 5, fillColor: '#f0c040', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1, rotation: pos },
          title: `Position: ${pos.toFixed(1)}°`,
          zIndex: 20,
        })
        overlays.current.push(machineMarker)
      }

      // Pan to machine
      map.panTo(center)
      map.setZoom(15)

    } else if (selMachine.type === 'linear' && selMachine.start_lat && selMachine.start_lng) {
      const start = { lat: Number(selMachine.start_lat), lng: Number(selMachine.start_lng) }
      const end   = selMachine.end_lat ? { lat: Number(selMachine.end_lat), lng: Number(selMachine.end_lng) } : null

      // Start marker
      const startMarker = new window.google.maps.Marker({
        position: start, map,
        label: { text: 'S', color: 'white', fontWeight: 'bold' },
        title: 'Field Start',
        zIndex: 10,
      })
      overlays.current.push(startMarker)

      if (end) {
        // End marker
        const endMarker = new window.google.maps.Marker({
          position: end, map,
          label: { text: 'E', color: 'white', fontWeight: 'bold' },
          title: 'Field End',
          zIndex: 10,
        })
        overlays.current.push(endMarker)

        // Field rectangle outline
        const totalWidth = machineSpans.reduce((s, x) => s + x.length_ft, 0)
        // Simple line for now - full rectangle would need bearing calculation
        const fieldLine = new window.google.maps.Polyline({
          map, path: [start, end],
          strokeColor: '#6ec040', strokeOpacity: 0.9, strokeWeight: 3,
        })
        overlays.current.push(fieldLine)

        // Grazed portion
        if (fieldPos && fieldPos.current_position != null) {
          const pos    = Number(fieldPos.current_position)
          const runLen = selMachine.run_length_ft || 1
          const frac   = Math.min(1, pos / runLen)
          const grazedEnd = {
            lat: start.lat + (end.lat - start.lat) * frac,
            lng: start.lng + (end.lng - start.lng) * frac,
          }
          const grazedLine = new window.google.maps.Polyline({
            map, path: [start, grazedEnd],
            strokeColor: '#52a035', strokeOpacity: 1, strokeWeight: 6,
          })
          overlays.current.push(grazedLine)

          // Machine position marker
          const machineMarker = new window.google.maps.Marker({
            position: grazedEnd, map,
            icon: { path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: '#f0c040', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1 },
            title: `Position: ${pos} ft`,
            zIndex: 20,
          })
          overlays.current.push(machineMarker)
        }
      }

      map.panTo(start)
      map.setZoom(15)
    }
  }

  // Build wedge polygon path for pivot grazed area
  function buildWedgePath(center, radiusFt, startDeg, endDeg) {
    if (endDeg <= 0) return null
    const points = [center]
    const steps  = Math.max(2, Math.round(endDeg / 2))
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

  async function handlePinDrop(lat, lng) {
    if (!selMachine || !pinMode) return
    setSavingPin(true)
    try {
      const updates = {}
      if (pinMode === 'center') { updates.center_lat = lat; updates.center_lng = lng }
      if (pinMode === 'start')  { updates.start_lat  = lat; updates.start_lng  = lng }
      if (pinMode === 'end')    { updates.end_lat    = lat; updates.end_lng    = lng }
      await updateMachine(selMachine.id, updates)
      setPinMode(null)
    } catch (e) { alert('Error saving pin: ' + e.message) }
    setSavingPin(false)
  }

  const hasPins = selMachine && (
    (selMachine.type === 'pivot' && selMachine.center_lat) ||
    (selMachine.type === 'linear' && selMachine.start_lat)
  )

  return (
    <div>
      <div className="section-heading">Field Map</div>
      <div className="section-desc">View machine position in real time. Drop pins to set field location on satellite map.</div>

      {!GOOGLE_MAPS_API_KEY && (
        <div style={{ background: 'rgba(224,64,48,0.15)', border: '1px solid var(--alert)', borderRadius: 10, padding: '1rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: 'var(--cream)' }}>
          ⚠ Google Maps API key not set. Add <code style={{ fontFamily: 'DM Mono, monospace', background: 'var(--bark)', padding: '1px 5px', borderRadius: 3 }}>VITE_GOOGLE_MAPS_API_KEY</code> to your Vercel environment variables.
          <br /><span style={{ color: 'var(--subtext)', fontSize: '0.75rem' }}>Get a key at console.cloud.google.com → Enable Maps JavaScript API</span>
        </div>
      )}

      <div className="card">
        <div className="grid-2" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label className="label">Select Machine</label>
            <select className="select" value={selMachineId} onChange={e => { setSelMachineId(e.target.value); setPinMode(null) }}>
              <option value="">Select machine…</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.type})</option>)}
            </select>
          </div>
          {selMachine && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', justifyContent: 'flex-end' }}>
              {selMachine.type === 'pivot' ? (
                <button
                  className={`btn ${pinMode === 'center' ? 'btn-amber' : 'btn-secondary'} btn-sm`}
                  onClick={() => setPinMode(pinMode === 'center' ? null : 'center')}
                >
                  {pinMode === 'center' ? '📍 Click map to set center…' : '📍 Set Pivot Center Point'}
                </button>
              ) : (
                <>
                  <button
                    className={`btn ${pinMode === 'start' ? 'btn-amber' : 'btn-secondary'} btn-sm`}
                    onClick={() => setPinMode(pinMode === 'start' ? null : 'start')}
                  >
                    {pinMode === 'start' ? '📍 Click map for start…' : '📍 Set Field Start'}
                  </button>
                  <button
                    className={`btn ${pinMode === 'end' ? 'btn-amber' : 'btn-secondary'} btn-sm`}
                    onClick={() => setPinMode(pinMode === 'end' ? null : 'end')}
                  >
                    {pinMode === 'end' ? '📍 Click map for end…' : '📍 Set Field End'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Pin mode instructions */}
        {pinMode && (
          <div style={{ background: 'rgba(240,192,64,0.15)', border: '1px solid rgba(240,192,64,0.4)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--gold)' }}>
            📍 Click anywhere on the map to drop the {pinMode === 'center' ? 'pivot center' : pinMode === 'start' ? 'field start' : 'field end'} pin.
            {savingPin && <span style={{ marginLeft: 8 }}><span className="spinner" /> Saving…</span>}
          </div>
        )}

        {/* Machine info bar */}
        {selMachine && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <span className="badge">{selMachine.type}</span>
            <span className="badge badge-amber">{selMachine.ipm} ipm desired</span>
            <span className="badge">{selMachine.total_spans} spans</span>
            <span className="badge" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>End tower: {endTowerRadius} ft</span>
            {fieldPos && (
              <span className="badge" style={{ borderColor: 'var(--grass)', color: 'var(--grass)' }}>
                Position: {Number(fieldPos.current_position).toFixed(1)}{selMachine.type === 'pivot' ? '°' : ' ft'}
              </span>
            )}
            {!hasPins && <span style={{ fontSize: '0.72rem', color: 'var(--subtext)', padding: '2px 0' }}>📍 Drop a pin to show on map</span>}
          </div>
        )}

        {/* Map */}
        {GOOGLE_MAPS_API_KEY ? (
          <div ref={mapRef} style={{ width: '100%', height: 480, borderRadius: 10, border: '1px solid var(--bark2)', background: 'var(--bark)' }} />
        ) : (
          <div style={{ width: '100%', height: 360, borderRadius: 10, border: '2px dashed var(--bark2)', background: 'var(--bark)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <div style={{ fontSize: '2.5rem' }}>🗺</div>
            <div style={{ color: 'var(--subtext)', fontSize: '0.85rem' }}>Google Maps will appear here once API key is configured</div>
            <div style={{ color: 'var(--bark2)', fontSize: '0.72rem' }}>Add VITE_GOOGLE_MAPS_API_KEY to Vercel environment variables</div>
          </div>
        )}
      </div>

      {/* All machines overview */}
      <div className="card">
        <div className="card-title mb-2">All Fields</div>
        {machines.length === 0 && <div className="text-muted text-sm">No machines saved.</div>}
        {machines.map(m => {
          const pos  = fieldPositions.find(p => p.machine_id === m.id)
          const plan = plans.find(p => p.machine_id === m.id && p.status === 'active')
          const mSpans = typeof m.spans === 'string' ? JSON.parse(m.spans || '[]') : (m.spans || [])
          const r    = getEndTowerRadius(mSpans)
          const hasPinsM = m.type === 'pivot' ? m.center_lat : m.start_lat
          return (
            <div key={m.id} className="list-item" onClick={() => setSelMachineId(m.id)}>
              <div>
                <div className="flex gap-1" style={{ alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span>{m.type === 'pivot' ? '🔄' : '➡️'}</span>
                  <strong style={{ color: 'var(--cream)' }}>{m.name}</strong>
                  {plan ? (
                    <span className="badge" style={{ borderColor: 'var(--grass)', color: 'var(--grass)' }}>Active</span>
                  ) : (
                    <span className="badge" style={{ borderColor: 'var(--subtext)', color: 'var(--subtext)' }}>Resting</span>
                  )}
                  {!hasPinsM && <span style={{ fontSize: '0.65rem', color: 'var(--subtext)' }}>📍 No pin set</span>}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--subtext)', fontFamily: 'DM Mono, monospace' }}>
                  {m.total_spans} spans · {r} ft · {m.ipm} ipm
                  {pos && ` · Position: ${Number(pos.current_position).toFixed(1)}${m.type === 'pivot' ? '°' : ' ft'}`}
                  {plan && ` · ${plan.total_cycle_days}d cycle`}
                </div>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--grass)' }}>View →</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
