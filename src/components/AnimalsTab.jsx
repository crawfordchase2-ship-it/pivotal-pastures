// ─── Animal Records Library ─────────────────────────────────────────────────────
// Complete multi-year herd record system
// Core principle: nothing deleted, only archived. Records build value over years.

// ── Year-letter tag scheme ──────────────────────────────────────────────────────
// 2024=A, 2025=B, 2026=C, 2027=D...
export function yearToLetter(year) {
  const base = 2024 // A
  const offset = year - base
  if (offset < 0) return 'Z'
  if (offset < 26) return String.fromCharCode(65 + offset)
  // After Z, go AA, AB...
  const first = Math.floor(offset / 26) - 1
  const second = offset % 26
  return String.fromCharCode(65 + first) + String.fromCharCode(65 + second)
}

export function letterToYear(letter) {
  const base = 2024
  if (letter.length === 1) return base + (letter.charCodeAt(0) - 65)
  const first = letter.charCodeAt(0) - 65 + 1
  const second = letter.charCodeAt(1) - 65
  return base + first * 26 + second
}

// Suggest next tag for a birth year given existing tags
export function suggestNextTag(existingTags, birthYear) {
  const letter = yearToLetter(birthYear)
  const sameYear = existingTags
    .filter(t => t.startsWith(letter))
    .map(t => parseInt(t.slice(letter.length)))
    .filter(n => !isNaN(n))
  const maxNum = sameYear.length > 0 ? Math.max(...sameYear) : 100
  return `${letter}${maxNum + 1}`
}

// ── Animal classes & sexes ──────────────────────────────────────────────────────
export const SEXES = {
  cow:     { label: 'Cow',     icon: '🐄', breeding: true,  intakePct: 2.0 },
  bull:    { label: 'Bull',    icon: '🐂', breeding: true,  intakePct: 1.8 },
  heifer:  { label: 'Heifer',  icon: '🐄', breeding: true,  intakePct: 2.8 },
  steer:   { label: 'Steer',   icon: '🐃', breeding: false, intakePct: 2.8 },
  calf:    { label: 'Calf',    icon: '🐮', breeding: false, intakePct: 0 }, // age-based
}

export const STATUSES = {
  active:   { label: 'Active',   color: 'var(--grass)' },
  sold:     { label: 'Sold',     color: 'var(--sky)' },
  died:     { label: 'Died',     color: 'var(--alert)' },
  culled:   { label: 'Culled',   color: 'var(--gold)' },
  archived: { label: 'Archived', color: 'var(--subtext)' },
}

export const BREEDS = [
  'South Poll', 'Angus', 'Red Angus', 'Hereford', 'Black Baldy', 'Charolais',
  'Simmental', 'Gelbvieh', 'Limousin', 'Shorthorn', 'Brangus',
  'Brahman', 'Wagyu', 'Holstein', 'Red Devon', 'Pineywoods',
  'Corriente', 'Crossbred', 'Composite', 'Other',
]

// ── Gestation & calving ─────────────────────────────────────────────────────────
export const GESTATION_DAYS = 285

export function expectedCalvingDate(bredDate) {
  const d = new Date(bredDate)
  d.setDate(d.getDate() + GESTATION_DAYS)
  return d.toISOString().slice(0, 10)
}

export function daysUntilCalving(bredDate, today = new Date()) {
  const due = new Date(expectedCalvingDate(bredDate))
  return Math.floor((due - new Date(today)) / 86400000)
}

export function calvingAlert(bredDate, today = new Date()) {
  const days = daysUntilCalving(bredDate, today)
  if (days < -5)  return { level: 'overdue', color: 'var(--alert)', msg: `Overdue by ${Math.abs(days)} days`, days }
  if (days < 0)   return { level: 'due',     color: 'var(--alert)', msg: `Due now (${Math.abs(days)} days past)`, days }
  if (days <= 14) return { level: 'alert',   color: 'var(--alert)', msg: `Due in ${days} days — watch closely`, days }
  if (days <= 30) return { level: 'warn',    color: 'var(--gold)',  msg: `Due in ${days} days`, days }
  return { level: 'ok', color: 'var(--subtext)', msg: `Due in ${days} days`, days }
}

// ── Age & weight ──────────────────────────────────────────────────────────────
export function ageInDays(birthDate, asOf = new Date()) {
  if (!birthDate) return null
  return Math.floor((new Date(asOf) - new Date(birthDate)) / 86400000)
}

export function ageDisplay(birthDate, asOf = new Date()) {
  const days = ageInDays(birthDate, asOf)
  if (days == null) return '—'
  if (days < 60)  return `${days} days`
  if (days < 730) return `${Math.floor(days / 30.4)} months`
  return `${(days / 365).toFixed(1)} years`
}

// Calf weight estimate from birth weight + ADG
export function estimateCalfWeight(birthWeight, ageDays, adg = 2.0) {
  if (ageDays == null || birthWeight == null) return null
  return Math.round(birthWeight + (ageDays * adg))
}

// Age-based calf intake rate (% of body weight in DM)
export function calfIntakeRate(ageDays) {
  if (ageDays == null) return 0
  if (ageDays <= 30) return 0.0    // nursing only
  if (ageDays <= 60) return 0.015  // starting to graze
  if (ageDays <= 90) return 0.025  // grazing well
  return 0.030                     // full grazer
}

// ── ADG calculation ─────────────────────────────────────────────────────────────
export function calcADG(weightRecords) {
  if (!weightRecords || weightRecords.length < 2) return null
  const sorted = [...weightRecords].sort((a, b) => new Date(a.date) - new Date(b.date))
  const first = sorted[0], last = sorted[sorted.length - 1]
  const days = Math.floor((new Date(last.date) - new Date(first.date)) / 86400000)
  if (days <= 0) return null
  return +((last.weight - first.weight) / days).toFixed(2)
}

// ADG between two specific consecutive records
export function adgBetween(rec1, rec2) {
  const days = Math.floor((new Date(rec2.date) - new Date(rec1.date)) / 86400000)
  if (days <= 0) return null
  return +((rec2.weight - rec1.weight) / days).toFixed(2)
}

// 205-day adjusted weaning weight (industry standard)
export function adjustedWeaningWeight(birthWeight, weaningWeight, weaningAgeDays) {
  if (!birthWeight || !weaningWeight || !weaningAgeDays) return null
  const adg = (weaningWeight - birthWeight) / weaningAgeDays
  return Math.round(birthWeight + (adg * 205))
}

// 365-day adjusted yearling weight
export function adjustedYearlingWeight(weaningWeight, yearlingWeight, daysBetween) {
  if (!weaningWeight || !yearlingWeight || !daysBetween) return null
  const adg = (yearlingWeight - weaningWeight) / daysBetween
  const daysFromWeanTo365 = 365 - 205
  return Math.round(weaningWeight + (adg * daysFromWeanTo365))
}

// Latest weight from records
export function latestWeight(weightRecords, birthWeight = null) {
  if (!weightRecords || weightRecords.length === 0) return birthWeight
  const sorted = [...weightRecords].sort((a, b) => new Date(b.date) - new Date(a.date))
  return sorted[0].weight
}

// Current estimated weight (use latest record, or estimate from birth + ADG)
export function currentWeight(animal, weightRecords, asOf = new Date()) {
  const latest = latestWeight(weightRecords)
  if (latest) {
    // If we have a recent weight + ADG, project forward
    if (weightRecords.length >= 2) {
      const adg = calcADG(weightRecords)
      const sorted = [...weightRecords].sort((a, b) => new Date(b.date) - new Date(a.date))
      const daysSince = Math.floor((new Date(asOf) - new Date(sorted[0].date)) / 86400000)
      if (adg && daysSince > 0 && daysSince < 120) {
        return Math.round(latest + adg * daysSince)
      }
    }
    return latest
  }
  // No weight records — estimate from birth weight if calf
  if (animal.birth_weight && animal.birth_date) {
    const age = ageInDays(animal.birth_date, asOf)
    return estimateCalfWeight(animal.birth_weight, age, 2.0)
  }
  return null
}

// ── BCS (Body Condition Score 1-9) ──────────────────────────────────────────────
export const BCS_LABELS = {
  1: 'Emaciated', 2: 'Very thin', 3: 'Thin', 4: 'Borderline',
  5: 'Moderate', 6: 'Good', 7: 'Fleshy', 8: 'Fat', 9: 'Obese',
}

export function bcsColor(score) {
  if (score <= 3) return 'var(--alert)'
  if (score <= 4) return 'var(--gold)'
  if (score <= 7) return 'var(--grass)'
  return 'var(--gold)'
}

export function bcsTrend(bcsRecords) {
  if (!bcsRecords || bcsRecords.length < 2) return null
  const sorted = [...bcsRecords].sort((a, b) => new Date(a.date) - new Date(b.date))
  const first = sorted[0].score, last = sorted[sorted.length - 1].score
  if (last > first) return { dir: 'improving', delta: +(last - first).toFixed(1) }
  if (last < first) return { dir: 'declining', delta: +(last - first).toFixed(1) }
  return { dir: 'stable', delta: 0 }
}

// ── Live herd weight & DM (drives grazing math) ──────────────────────────────────
export function calcLiveHerdMetrics(animals, weightRecordsByAnimal, asOf = new Date()) {
  let totalLW = 0
  let totalDM = 0
  let headCount = 0
  const breakdown = { cow: 0, bull: 0, heifer: 0, steer: 0, calf: 0 }

  animals.filter(a => a.status === 'active').forEach(animal => {
    const records = weightRecordsByAnimal[animal.id] || []
    let weight = currentWeight(animal, records, asOf)

    if (animal.sex === 'calf') {
      const age = ageInDays(animal.birth_date, asOf)
      weight = weight || estimateCalfWeight(animal.birth_weight, age, 2.0)
      const rate = calfIntakeRate(age)
      if (weight) {
        totalLW += weight
        totalDM += weight * rate
      }
    } else {
      const sexInfo = SEXES[animal.sex] || SEXES.cow
      // Lactating cow gets higher rate
      let rate = sexInfo.intakePct / 100
      if (animal.sex === 'cow' && animal.lactating) rate = 0.031
      if (weight) {
        totalLW += weight
        totalDM += weight * rate
      }
    }

    if (weight) {
      headCount++
      breakdown[animal.sex] = (breakdown[animal.sex] || 0) + 1
    }
  })

  return {
    totalLiveweight: Math.round(totalLW),
    dailyDmLbs: Math.round(totalDM),
    headCount,
    avgIntakePct: totalLW > 0 ? +((totalDM / totalLW) * 100).toFixed(2) : 0,
    breakdown,
  }
}

// ── Breeding summary per cow (lifetime productivity) ──────────────────────────────
export function cowBreedingSummary(breedingRecords) {
  const calved = breedingRecords.filter(b => b.actual_calving_date)
  if (calved.length === 0) return { totalCalves: 0, avgInterval: null, calvingEaseAvg: null }

  const sorted = calved.sort((a, b) => new Date(a.actual_calving_date) - new Date(b.actual_calving_date))
  const intervals = []
  for (let i = 1; i < sorted.length; i++) {
    const days = Math.floor((new Date(sorted[i].actual_calving_date) - new Date(sorted[i-1].actual_calving_date)) / 86400000)
    intervals.push(days)
  }
  const avgInterval = intervals.length > 0 ? Math.round(intervals.reduce((s, d) => s + d, 0) / intervals.length) : null
  const easeScores = calved.filter(b => b.calving_ease).map(b => b.calving_ease)
  const calvingEaseAvg = easeScores.length > 0 ? +(easeScores.reduce((s, e) => s + e, 0) / easeScores.length).toFixed(1) : null

  return {
    totalCalves: calved.length,
    avgInterval,          // days between calvings (365 ideal)
    calvingEaseAvg,       // 1-5 (1 = unassisted)
    intervalRating: avgInterval ? (avgInterval <= 370 ? 'excellent' : avgInterval <= 400 ? 'good' : 'needs improvement') : null,
  }
}

// ── Sire/dam pedigree linkage ─────────────────────────────────────────────────────
export function getOffspring(animalTag, allAnimals) {
  return allAnimals.filter(a => a.dam_tag === animalTag || a.sire_tag === animalTag)
}

export function getDam(animal, allAnimals) {
  return allAnimals.find(a => a.tag === animal.dam_tag)
}

export function getSire(animal, allAnimals) {
  return allAnimals.find(a => a.tag === animal.sire_tag)
}

// ── Health record helpers ─────────────────────────────────────────────────────────
export function withdrawalStatus(healthRecords, asOf = new Date()) {
  const active = healthRecords
    .filter(h => h.withdrawal_date && new Date(h.withdrawal_date) > new Date(asOf))
    .sort((a, b) => new Date(b.withdrawal_date) - new Date(a.withdrawal_date))
  if (active.length === 0) return null
  const latest = active[0]
  const daysLeft = Math.ceil((new Date(latest.withdrawal_date) - new Date(asOf)) / 86400000)
  return {
    clear: false,
    daysLeft,
    product: latest.product,
    withdrawalDate: latest.withdrawal_date,
    msg: `Withdrawal active — ${daysLeft} days until clear (${latest.product})`,
  }
}

export function upcomingVaccinations(healthRecords, asOf = new Date(), daysAhead = 30) {
  return healthRecords
    .filter(h => h.next_due_date)
    .filter(h => {
      const days = Math.floor((new Date(h.next_due_date) - new Date(asOf)) / 86400000)
      return days >= 0 && days <= daysAhead
    })
    .sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date))
}

// ── Year-over-year calf performance ───────────────────────────────────────────────
export function calfPerformanceByYear(animals, weightRecordsByAnimal) {
  const byYear = {}
  animals.filter(a => a.sex === 'calf' || a.birth_date).forEach(animal => {
    if (!animal.birth_date) return
    const year = new Date(animal.birth_date).getFullYear()
    if (!byYear[year]) byYear[year] = { births: [], weanings: [], adgs: [] }
    if (animal.birth_weight) byYear[year].births.push(animal.birth_weight)
    const records = weightRecordsByAnimal[animal.id] || []
    const weaning = records.find(r => r.event_type === 'weaning')
    if (weaning) byYear[year].weanings.push(weaning.weight)
    const adg = calcADG(records)
    if (adg) byYear[year].adgs.push(adg)
  })

  return Object.entries(byYear).map(([year, data]) => ({
    year: +year,
    avgBirthWeight: data.births.length ? Math.round(data.births.reduce((s, w) => s + w, 0) / data.births.length) : null,
    avgWeaningWeight: data.weanings.length ? Math.round(data.weanings.reduce((s, w) => s + w, 0) / data.weanings.length) : null,
    avgADG: data.adgs.length ? +(data.adgs.reduce((s, a) => s + a, 0) / data.adgs.length).toFixed(2) : null,
    calfCount: data.births.length,
  })).sort((a, b) => a.year - b.year)
}

// ── Herd ↔ Animal linkage ─────────────────────────────────────────────────────
// Get all animals assigned to a herd
export function animalsInHerd(herdId, allAnimals) {
  return allAnimals.filter(a => a.current_herd_id === herdId && a.status === 'active')
}

// Calculate herd metrics from assigned animals (real weights)
// Returns null if no animals assigned — caller falls back to class counts
export function herdMetricsFromAnimals(herdId, allAnimals, weightRecordsByAnimal, asOf = new Date()) {
  const assigned = animalsInHerd(herdId, allAnimals)
  if (assigned.length === 0) return null   // fall back to class counts

  const metrics = calcLiveHerdMetrics(assigned, weightRecordsByAnimal, asOf)
  return {
    ...metrics,
    source: 'records',          // vs 'estimated'
    animalCount: assigned.length,
  }
}

// Decide which metrics to use: real records if available, else class counts
export function resolveHerdMetrics(herd, allAnimals, weightRecordsByAnimal, asOf = new Date()) {
  const fromRecords = herdMetricsFromAnimals(herd.id, allAnimals, weightRecordsByAnimal, asOf)
  if (fromRecords) {
    return {
      source: 'records',
      totalLiveweight: fromRecords.totalLiveweight,
      dailyDmLbs: fromRecords.dailyDmLbs,
      headCount: fromRecords.headCount,
      avgIntakePct: fromRecords.avgIntakePct,
      breakdown: fromRecords.breakdown,
    }
  }
  // Fall back to stored class-count estimates
  return {
    source: 'estimated',
    totalLiveweight: herd.total_lw || 0,
    dailyDmLbs: herd.daily_dm || 0,
    headCount: herd.total_head || 0,
    avgIntakePct: herd.avg_intake_pct || 0,
    breakdown: null,
  }
}


// ── Breed composition (fractions / composites) ────────────────────────────────
// Composition is an array: [{ breed:'South Poll', pct:75 }, { breed:'Angus', pct:25 }]

// Common fraction symbols
const FRACTIONS = [
  [100, ''], [87.5, '⅞'], [75, '¾'], [62.5, '⅝'], [50, '½'],
  [37.5, '⅜'], [33.33, '⅓'], [25, '¼'], [12.5, '⅛'], [66.67, '⅔'],
]

export function fractionSymbol(pct) {
  for (const [val, sym] of FRACTIONS) {
    if (Math.abs(pct - val) < 0.6) return sym
  }
  return null
}

// Validate a composition totals 100%
export function compositionValid(composition) {
  if (!composition || composition.length === 0) return false
  const total = composition.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)
  return Math.abs(total - 100) < 0.5
}

export function compositionTotal(composition) {
  if (!composition) return 0
  return composition.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)
}

// Display composition as readable string
export function compositionDisplay(composition, primaryBreed = null) {
  if (!composition || composition.length === 0) return primaryBreed || '—'
  // Sort by pct descending
  const sorted = [...composition].sort((a, b) => b.pct - a.pct)
  // If single breed at 100%, just the name
  if (sorted.length === 1 && Math.abs(sorted[0].pct - 100) < 0.5) return sorted[0].breed
  // Build "¾ South Poll, ¼ Angus" or "75% South Poll, 25% Angus"
  return sorted.map(c => {
    const frac = fractionSymbol(c.pct)
    return frac ? `${frac} ${c.breed}` : `${Math.round(c.pct)}% ${c.breed}`
  }).join(', ')
}

// Short display — just the dominant breed + fraction
export function compositionShort(composition, primaryBreed = null) {
  if (!composition || composition.length === 0) return primaryBreed || '—'
  const sorted = [...composition].sort((a, b) => b.pct - a.pct)
  const top = sorted[0]
  if (Math.abs(top.pct - 100) < 0.5) return top.breed
  const frac = fractionSymbol(top.pct)
  return frac ? `${frac} ${top.breed}` : `${Math.round(top.pct)}% ${top.breed}`
}

// Calculate calf composition from dam + sire blends (50/50)
export function calcCalfComposition(damComposition, sireComposition) {
  const dam = damComposition && damComposition.length ? damComposition : null
  const sire = sireComposition && sireComposition.length ? sireComposition : null
  if (!dam && !sire) return null

  const blend = {}
  if (dam) dam.forEach(c => { blend[c.breed] = (blend[c.breed] || 0) + c.pct * 0.5 })
  else if (sire) {
    // Unknown dam — can only estimate from sire half
    sire.forEach(c => { blend[c.breed] = (blend[c.breed] || 0) + c.pct * 0.5 })
    blend['Unknown'] = 50
  }
  if (sire) sire.forEach(c => { blend[c.breed] = (blend[c.breed] || 0) + c.pct * 0.5 })
  else if (dam) {
    blend['Unknown'] = (blend['Unknown'] || 0) + 50
  }

  return Object.entries(blend)
    .map(([breed, pct]) => ({ breed, pct: +pct.toFixed(2) }))
    .filter(c => c.pct > 0)
    .sort((a, b) => b.pct - a.pct)
}

// Herd average composition (for tracking progress toward a target blend)
export function herdAvgComposition(animals) {
  const active = animals.filter(a => a.status === 'active')
  if (active.length === 0) return []
  const blend = {}
  let counted = 0
  active.forEach(a => {
    let comp = a.breed_composition
    if (typeof comp === 'string') { try { comp = JSON.parse(comp) } catch { comp = null } }
    if (comp && comp.length) {
      comp.forEach(c => { blend[c.breed] = (blend[c.breed] || 0) + c.pct })
      counted++
    } else if (a.breed) {
      blend[a.breed] = (blend[a.breed] || 0) + 100
      counted++
    }
  })
  if (counted === 0) return []
  return Object.entries(blend)
    .map(([breed, total]) => ({ breed, pct: +(total / counted).toFixed(1) }))
    .sort((a, b) => b.pct - a.pct)
}
