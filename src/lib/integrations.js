// ─── External Integration Library ─────────────────────────────────────────────
// WeatherLink v2 API + Phytech stub + Dropbox polling

// ─── WEATHERLINK ──────────────────────────────────────────────────────────────
const WL_BASE = 'https://api.weatherlink.com/v2'

export async function wlGetStations(apiKey, apiSecret) {
  const res = await fetch(`${WL_BASE}/stations?api-key=${apiKey}`, {
    headers: { 'X-Api-Secret': apiSecret }
  })
  if (!res.ok) throw new Error(`WeatherLink error: ${res.status}`)
  const data = await res.json()
  return data.stations || []
}

export async function wlGetCurrent(apiKey, apiSecret, stationId) {
  const res = await fetch(`${WL_BASE}/current/${stationId}?api-key=${apiKey}`, {
    headers: { 'X-Api-Secret': apiSecret }
  })
  if (!res.ok) throw new Error(`WeatherLink error: ${res.status}`)
  const data = await res.json()
  return parseWLData(data)
}

export async function wlGetHistoric(apiKey, apiSecret, stationId, startUnix, endUnix) {
  const res = await fetch(
    `${WL_BASE}/historic/${stationId}?api-key=${apiKey}&start-timestamp=${startUnix}&end-timestamp=${endUnix}`,
    { headers: { 'X-Api-Secret': apiSecret } }
  )
  if (!res.ok) throw new Error(`WeatherLink error: ${res.status}`)
  const data = await res.json()
  return data
}

function parseWLData(raw) {
  const result = {
    stationId:    raw.station_id,
    timestamp:    raw.generated_at,
    tempF:        null, humidity: null,
    windMph:      null, windDir: null,
    rainInDay:    null, rainInMonth: null,
    soilMoisture: null, soilTempF: null,
    baroPressure: null, dewPointF: null,
    heatIndex:    null, uvIndex: null,
    solarRad:     null,
  }
  const sensors = raw.sensors || []
  sensors.forEach(sensor => {
    const d = sensor.data?.[0] || {}
    // ISS / temp-humidity sensor
    if (d.temp !== undefined)         result.tempF        = +d.temp.toFixed(1)
    if (d.hum !== undefined)          result.humidity     = +d.hum.toFixed(1)
    if (d.wind_speed_last !== undefined) result.windMph   = +d.wind_speed_last.toFixed(1)
    if (d.wind_dir_last !== undefined)   result.windDir   = d.wind_dir_last
    if (d.rainfall_day_in !== undefined) result.rainInDay = +d.rainfall_day_in.toFixed(2)
    if (d.rainfall_month_in !== undefined) result.rainInMonth = +d.rainfall_month_in.toFixed(2)
    if (d.dew_point !== undefined)    result.dewPointF    = +d.dew_point.toFixed(1)
    if (d.heat_index !== undefined)   result.heatIndex    = +d.heat_index.toFixed(1)
    if (d.uv_index !== undefined)     result.uvIndex      = d.uv_index
    if (d.solar_rad !== undefined)    result.solarRad     = d.solar_rad
    if (d.bar_sea_level !== undefined) result.baroPressure = +d.bar_sea_level.toFixed(2)
    // Soil sensors
    if (d.moist_soil_last !== undefined) result.soilMoisture = +d.moist_soil_last.toFixed(1)
    if (d.temp_soil_last !== undefined)  result.soilTempF    = +d.temp_soil_last.toFixed(1)
  })
  return result
}

// Wind direction degrees to compass
export function windDirLabel(deg) {
  if (deg == null) return '—'
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

// Growth modifier from temperature
export function tempGrowthModifier(soilTempF) {
  if (soilTempF == null) return 1.0
  if (soilTempF < 40)  return 0.0
  if (soilTempF < 50)  return 0.3
  if (soilTempF < 60)  return 0.7
  if (soilTempF <= 75) return 1.0
  if (soilTempF <= 85) return 0.9
  return 0.75
}

// Rain alert thresholds
export function checkWeatherAlerts(wx) {
  const alerts = []
  if (!wx) return alerts
  if (wx.rainInDay > 0.25) alerts.push({ type: 'rain',   level: 'info',  msg: `${wx.rainInDay}" rain today — monitor soil conditions` })
  if (wx.rainInDay > 0.5)  alerts.push({ type: 'rain',   level: 'warn',  msg: `${wx.rainInDay}" rain today — check soil before moving cattle, bloat risk up` })
  if (wx.rainInDay > 1.0)  alerts.push({ type: 'rain',   level: 'alert', msg: `${wx.rainInDay}" rain today — delay moves, soil damage risk, bloat elevated` })
  if (wx.tempF < 32)       alerts.push({ type: 'frost',  level: 'alert', msg: 'Frost conditions — graze harder now before quality drops' })
  if (wx.tempF > 95)       alerts.push({ type: 'heat',   level: 'warn',  msg: 'Heat stress conditions — extend midday loaf window' })
  if (wx.humidity > 85 && wx.tempF > 65) alerts.push({ type: 'bloat', level: 'warn', msg: 'High humidity + warm temps — elevated bloat risk on lush grass' })
  return alerts
}

// ─── PHYTECH STUB ─────────────────────────────────────────────────────────────
// Full implementation pending API credentials from Phytech (321) 428-3385
// Data structure matches known Phytech API response format

export async function phytechGetFields(apiKey) {
  // STUB — replace with real endpoint when Phytech provides API access
  console.log('Phytech API stub — awaiting credentials')
  return []
}

export async function phytechGetCurrentData(apiKey, fieldId) {
  // STUB — returns mock data structure matching expected Phytech format
  return {
    fieldId,
    timestamp: new Date().toISOString(),
    plantStress: null,        // 'green' | 'yellow' | 'red'
    mdsValue: null,           // Maximum Daily Shrinkage value
    dailyGrowthRate: null,    // cm/day
    soilMoisture: {
      depth6in:  null,        // % volumetric
      depth12in: null,
      depth24in: null,
    },
    soilTemp: {
      depth6in:  null,        // °F
      depth12in: null,
    },
    tensiometer: {
      depth12in: null,        // cbar
      depth24in: null,
    },
    weatherStation: {
      tempF:    null,
      humidity: null,
      windMph:  null,
      rainIn:   null,
    },
    connected: false,
    stubMessage: 'Contact Phytech at (321) 428-3385 to request API access',
  }
}

export function phytechStressModifier(stressStatus) {
  if (!stressStatus) return 1.0
  switch (stressStatus) {
    case 'green':  return 1.0
    case 'yellow': return 0.75
    case 'red':    return 0.5
    default:       return 1.0
  }
}

export function phytechSoilModifier(soilMoisturePct) {
  if (!soilMoisturePct) return 1.0
  if (soilMoisturePct < 15) return 0.5   // dry stress
  if (soilMoisturePct < 25) return 0.8   // mild dry
  if (soilMoisturePct > 60) return 0.85  // wet stress
  return 1.0                              // optimal
}

// ─── FIELD GROWTH MODEL ───────────────────────────────────────────────────────
export function predictHeightAtReturn({
  residualInches,
  restDays,
  baseRegrowthRate,    // inches/day from camera observations
  soilTempF,          // from WeatherLink
  phytechStress,      // 'green' | 'yellow' | 'red'
  soilMoisturePct,    // from WeatherLink soil sensor or Phytech
  season,             // 'spring' | 'summer' | 'fall' | 'winter'
}) {
  const seasonModifiers = {
    spring: 1.3, summer: 0.9, fall: 0.75, winter: 0.0,
  }
  const tempMod    = tempGrowthModifier(soilTempF)
  const stressMod  = phytechStressModifier(phytechStress)
  const moistMod   = phytechSoilModifier(soilMoisturePct)
  const seasonMod  = seasonModifiers[season] || 1.0

  const adjustedRate = baseRegrowthRate * tempMod * stressMod * moistMod * seasonMod
  const predicted    = residualInches + (restDays * adjustedRate)

  return {
    predicted:      +predicted.toFixed(1),
    adjustedRate:   +adjustedRate.toFixed(3),
    tempMod, stressMod, moistMod, seasonMod,
    modifiers: { tempMod, stressMod, moistMod, seasonMod },
  }
}

export function predictDMAtHeight(heightInches, densityFactor = 250) {
  // Approximate: 250 lb DM per inch per acre for mixed grass stand
  return Math.round(heightInches * densityFactor)
}

// ─── DROPBOX ──────────────────────────────────────────────────────────────────
// Dropbox integration — OAuth handled by Supabase Edge Function
// These helpers process photo data pulled from Dropbox

export function parseDropboxPhotoPath(path) {
  // Expected: /PivotalPastures/{MachineName}/{CameraType}/{filename}
  // e.g. /PivotalPastures/TrevorNorthPivot/Camera1-PreGraze/2025-06-14_0610_move1.jpg
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 3) return null
  return {
    machineName: parts[1],
    cameraType:  parseCameraType(parts[2]),
    filename:    parts[3] || '',
    timestamp:   parseTimestampFromFilename(parts[3] || ''),
  }
}

function parseCameraType(folderName) {
  const lower = folderName.toLowerCase()
  if (lower.includes('pregraze') || lower.includes('pre-graze') || lower.includes('pre_graze')) return 'pre_graze'
  if (lower.includes('postgraze') || lower.includes('post-graze') || lower.includes('post_graze')) return 'post_graze'
  if (lower.includes('recovery') || lower.includes('rest')) return 'recovery'
  return 'manual'
}

function parseTimestampFromFilename(filename) {
  // Try to extract date/time from filename like 2025-06-14_0610_move1.jpg
  const match = filename.match(/(\d{4}-\d{2}-\d{2})_(\d{4})/)
  if (!match) return null
  const [_, date, time] = match
  return `${date}T${time.slice(0,2)}:${time.slice(2,4)}:00`
}

// ─── SEASON DETECTION ─────────────────────────────────────────────────────────
export function getCurrentSeason(lat = 41.5) {
  const month = new Date().getMonth() + 1 // 1-12
  // Northern hemisphere
  if (lat > 0) {
    if (month >= 3  && month <= 5)  return 'spring'
    if (month >= 6  && month <= 8)  return 'summer'
    if (month >= 9  && month <= 11) return 'fall'
    return 'winter'
  }
  // Southern hemisphere
  if (month >= 9  && month <= 11) return 'spring'
  if (month >= 12 || month <= 2)  return 'summer'
  if (month >= 3  && month <= 5)  return 'fall'
  return 'winter'
}
