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
  cow:          { label: 'Cow',          icon: '🐄', breeding: true,  intakePct: 2.0, isCalf: false },
  bull:         { label: 'Bull',         icon: '🐂', breeding: true,  intakePct: 1.8, isCalf: false },
  heifer:       { label: 'Heifer',       icon: '🐄', breeding: true,  intakePct: 2.8, isCalf: false },
  steer:        { label: 'Steer',        icon: '🐃', breeding: false, intakePct: 2.8, isCalf: false },
  calf:         { label: 'Calf',         icon: '🐮', breeding: false, intakePct: 0,   isCalf: true }, // legacy/unknown
  bull_calf:    { label: 'Bull Calf',    icon: '🐮', breeding: false, intakePct: 0,   isCalf: true },
  heifer_calf:  { label: 'Heifer Calf',  icon: '🐮', breeding: false, intakePct: 0,   isCalf: true },
  steer_calf:   { label: 'Steer Calf',   icon: '🐮', breeding: false, intakePct: 0,   isCalf: true },
}

// Which sexes are calf-stage (use age-based intake)
export const CALF_SEXES = ['calf', 'bull_calf', 'heifer_calf', 'steer_calf']
export function isCalfSex(sex) { return CALF_SEXES.includes(sex) }

// Promotion suggestion: what a calf becomes at weaning
export const PROMOTION_MAP = {
  bull_calf:   ['bull', 'steer'],   // you choose: keep intact or castrate
  heifer_calf: ['heifer'],
  steer_calf:  ['steer'],
  calf:        ['heifer', 'steer', 'bull'],  // unknown — pick any
}

export const WEANING_AGE_DAYS = 205

// Should this calf be suggested for promotion?
export function promotionSuggestion(animal, asOf = new Date()) {
  if (!isCalfSex(animal.sex)) return null
  if (!animal.birth_date) return null
  const age = Math.floor((new Date(asOf) - new Date(animal.birth_date)) / 86400000)
  if (age < WEANING_AGE_DAYS) return null
  const options = PROMOTION_MAP[animal.sex] || ['heifer', 'steer', 'bull']
  return {
    age,
    fromLabel: SEXES[animal.sex].label,
    options,                      // array of sex keys to promote to
    optionLabels: options.map(o => SEXES[o].label),
  }
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
// Default weights by class when no weight record exists (so animals still count)
export const DEFAULT_WEIGHTS = {
  cow: 1200, bull: 1800, heifer: 750, steer: 750,
  calf: 300, bull_calf: 300, heifer_calf: 300, steer_calf: 300,
}

export function calcLiveHerdMetrics(animals, weightRecordsByAnimal, asOf = new Date(), allAnimals = null) {
  const roster = allAnimals || animals
  let totalLW = 0
  let totalDM = 0
  let headCount = 0
  let estimatedCount = 0   // how many used a default weight
  const breakdown = {}     // sex → count

  animals.filter(a => a.status === 'active').forEach(animal => {
    const records = weightRecordsByAnimal[animal.id] || []
    let weight = currentWeight(animal, records, asOf)
    let isEstimate = false

    if (isCalfSex(animal.sex)) {
      const age = ageInDays(animal.birth_date, asOf)
      if (!weight) {
        weight = estimateCalfWeight(animal.birth_weight, age, 2.0) || DEFAULT_WEIGHTS[animal.sex] || 300
        isEstimate = true
      }
      const rate = calfIntakeRate(age != null ? age : 120)
      totalLW += weight
      totalDM += weight * rate
    } else {
      const sexInfo = SEXES[animal.sex] || SEXES.cow
      let rate = sexInfo.intakePct / 100
      if ((animal.sex === 'cow' || animal.sex === 'heifer') && effectiveLactating(animal, roster)) rate = 0.031
      if (!weight) {
        weight = DEFAULT_WEIGHTS[animal.sex] || 1000
        isEstimate = true
      }
      totalLW += weight
      totalDM += weight * rate
    }

    headCount++
    if (isEstimate) estimatedCount++
    breakdown[animal.sex] = (breakdown[animal.sex] || 0) + 1
  })

  return {
    totalLiveweight: Math.round(totalLW),
    dailyDmLbs: Math.round(totalDM),
    headCount,
    estimatedCount,           // animals using default weights (no record)
    avgIntakePct: totalLW > 0 ? +((totalDM / totalLW) * 100).toFixed(2) : 0,
    breakdown,
  }
}

// Human-readable breakdown: "4 cows, 3 calves, 1 bull"
export function breakdownSummary(breakdown) {
  const labels = {
    cow:'cow', bull:'bull', heifer:'heifer', steer:'steer',
    calf:'calf', bull_calf:'bull calf', heifer_calf:'heifer calf', steer_calf:'steer calf',
  }
  // Group all calf types together for a clean summary
  const grouped = {}
  Object.entries(breakdown).forEach(([sex, n]) => {
    if (!n) return
    const key = ['bull_calf','heifer_calf','steer_calf','calf'].includes(sex) ? 'calf' : sex
    grouped[key] = (grouped[key] || 0) + n
  })
  const order = ['cow','bull','heifer','steer','calf']
  return order
    .filter(k => grouped[k])
    .map(k => {
      const n = grouped[k]
      const label = labels[k]
      const plural = n === 1 ? label : (label.endsWith('f') ? label.slice(0,-1)+'ves' : label+'s')
      return `${n} ${plural}`
    })
    .join(', ')
}

// Detailed breakdown keeping calf sexes separate
export function breakdownDetailed(breakdown) {
  const labels = {
    cow:'Cows', bull:'Bulls', heifer:'Heifers', steer:'Steers',
    calf:'Calves', bull_calf:'Bull Calves', heifer_calf:'Heifer Calves', steer_calf:'Steer Calves',
  }
  const order = ['cow','bull','heifer','steer','heifer_calf','bull_calf','steer_calf','calf']
  return order
    .filter(k => breakdown[k])
    .map(k => ({ label: labels[k], count: breakdown[k], sex: k }))
}

// ── Breeding summary per cow (lifetime productivity) ──────────────────────────────
export function cowBreedingSummary(breedingRecords) {
  const calved = breedingRecords.filter(b => b.actual_calving_date)
  if (calved.length === 0) return { totalCalves: 0, calvesBorn: 0, calvesWeaned: 0, weaningRate: null, avgInterval: null, calvingEaseAvg: null }

  const sorted = calved.sort((a, b) => new Date(a.actual_calving_date) - new Date(b.actual_calving_date))
  const intervals = []
  for (let i = 1; i < sorted.length; i++) {
    const days = Math.floor((new Date(sorted[i].actual_calving_date) - new Date(sorted[i-1].actual_calving_date)) / 86400000)
    intervals.push(days)
  }
  const avgInterval = intervals.length > 0 ? Math.round(intervals.reduce((s, d) => s + d, 0) / intervals.length) : null
  const easeScores = calved.filter(b => b.calving_ease).map(b => b.calving_ease)
  const calvingEaseAvg = easeScores.length > 0 ? +(easeScores.reduce((s, e) => s + e, 0) / easeScores.length).toFixed(1) : null

  const calvesBorn = calved.length
  const calvesLost = calved.filter(b => b.calf_lost).length
  const calvesWeaned = calvesBorn - calvesLost

  return {
    totalCalves: calvesBorn,           // kept for backwards compat
    calvesBorn,
    calvesWeaned,
    calvesLost,
    weaningRate: calvesBorn > 0 ? Math.round((calvesWeaned / calvesBorn) * 100) : null,
    avgInterval,
    calvingEaseAvg,
    intervalRating: avgInterval ? (avgInterval <= 370 ? 'excellent' : avgInterval <= 400 ? 'good' : 'needs improvement') : null,
  }
}

// Herd-wide calf crop for a year: born vs weaned
export function herdCalfCrop(breedingRecords, year) {
  const inYear = breedingRecords.filter(b => b.actual_calving_date && new Date(b.actual_calving_date).getFullYear() === year)
  const born = inYear.length
  const lost = inYear.filter(b => b.calf_lost).length
  const weaned = born - lost
  return {
    year, born, weaned, lost,
    weaningRate: born > 0 ? Math.round((weaned / born) * 100) : null,
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
  animals.filter(a => isCalfSex(a.sex) || a.birth_date).forEach(animal => {
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
  if (!herdId) return []
  const target = String(herdId).trim()
  return allAnimals.filter(a => {
    if (a.status !== 'active') return false
    if (!a.current_herd_id) return false
    return String(a.current_herd_id).trim() === target
  })
}

// Calculate herd metrics from assigned animals (real weights)
// Returns null if no animals assigned — caller falls back to class counts
export function herdMetricsFromAnimals(herdId, allAnimals, weightRecordsByAnimal, asOf = new Date()) {
  const assigned = animalsInHerd(herdId, allAnimals)
  if (assigned.length === 0) return null   // fall back to class counts

  const metrics = calcLiveHerdMetrics(assigned, weightRecordsByAnimal, asOf, allAnimals)
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

// Full breakdown in percentages: "50% South Poll, 50% Red Angus"
export function compositionPercent(composition, primaryBreed = null) {
  if (!composition || composition.length === 0) return primaryBreed || '—'
  const sorted = [...composition].sort((a, b) => b.pct - a.pct)
  if (sorted.length === 1 && Math.abs(sorted[0].pct - 100) < 0.5) return sorted[0].breed
  return sorted.map(c => {
    // Show whole numbers cleanly, one decimal only when needed
    const pct = Math.abs(c.pct - Math.round(c.pct)) < 0.05 ? Math.round(c.pct) : +c.pct.toFixed(1)
    return `${pct}% ${c.breed}`
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


// ─── Auto-detect lactation (weaning-based, no age cutoff) ────────────────────────
// A cow is lactating if she has a LIVE calf at side that has NOT been weaned.
// She stays lactating until the calf is actively marked weaned.
export function isLactating(cow, allAnimals) {
  if (!cow || (cow.sex !== 'cow' && cow.sex !== 'heifer')) return false
  const calves = (allAnimals || []).filter(a =>
    a.dam_tag === cow.tag &&
    a.status === 'active' &&
    isCalfSex(a.sex) &&
    !a.weaned
  )
  return calves.length > 0
}

// Effective lactating state: auto-detect, but a manual override wins if set.
// cow.lactating_override can be 'yes' | 'no' | '' (auto)
export function effectiveLactating(cow, allAnimals) {
  if (!cow) return false
  if (cow.lactating_override === 'yes') return true
  if (cow.lactating_override === 'no') return false
  return isLactating(cow, allAnimals)
}
