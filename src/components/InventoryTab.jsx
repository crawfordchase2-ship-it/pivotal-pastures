// ─── Inventory & Growth Model ──────────────────────────────────────────────────
// Conservative forage inventory with seasonal awareness

// ── Grass types ───────────────────────────────────────────────────────────────
export const GRASS_TYPES = {
  cool_season: {
    label: 'Cool Season (Fescue / Orchard / Brome / Bluegrass)',
    peakMonths: [5, 6],       // May, June
    fallFlushMonths: [9, 10], // Sep, Oct
    dormantMonths: [1, 2, 12],
    monthlyModifiers: {
      1: 0.0, 2: 0.0, 3: 0.2, 4: 0.7,
      5: 1.0, 6: 1.0, 7: 0.6, 8: 0.3,
      9: 0.75, 10: 0.8, 11: 0.4, 12: 0.1,
    },
  },
  warm_season: {
    label: 'Warm Season (Bermuda / Native / Switchgrass)',
    peakMonths: [7, 8],
    fallFlushMonths: [],
    dormantMonths: [1, 2, 3, 11, 12],
    monthlyModifiers: {
      1: 0.0, 2: 0.0, 3: 0.0, 4: 0.2,
      5: 0.5, 6: 0.8, 7: 1.0, 8: 1.0,
      9: 0.7, 10: 0.4, 11: 0.1, 12: 0.0,
    },
  },
  mixed: {
    label: 'Mixed Stand',
    peakMonths: [5, 6, 7],
    fallFlushMonths: [9],
    dormantMonths: [1, 2, 12],
    monthlyModifiers: {
      1: 0.0, 2: 0.0, 3: 0.15, 4: 0.55,
      5: 0.9, 6: 0.95, 7: 0.85, 8: 0.55,
      9: 0.7, 10: 0.65, 11: 0.3, 12: 0.05,
    },
  },
}

// ── Growth stage detection ─────────────────────────────────────────────────────
export const GROWTH_STAGES = {
  vegetative:    { label: 'Vegetative',    color: 'var(--grass)',   icon: '🌱', urgency: 0 },
  transition:    { label: 'Transition',    color: 'var(--gold)',    icon: '🌿', urgency: 1 },
  reproductive:  { label: 'Reproductive', color: 'var(--alert)',   icon: '🌾', urgency: 2 },
  dormant:       { label: 'Dormant',       color: 'var(--subtext)', icon: '🍂', urgency: 0 },
}

export function detectGrowthStage(heightInches, month, grassType = 'cool_season') {
  const modifier = GRASS_TYPES[grassType]?.monthlyModifiers[month] || 1.0
  if (modifier < 0.1) return 'dormant'
  if (heightInches < 6)  return 'vegetative'
  if (heightInches < 10) return 'vegetative'
  if (heightInches < 14) return 'transition'
  return 'reproductive'
}

// ── Seasonal alerts ────────────────────────────────────────────────────────────
export function getSeasonalAlerts(month, grassType, inventoryTrend) {
  const alerts = []
  const grass = GRASS_TYPES[grassType] || GRASS_TYPES.cool_season

  if (grass.peakMonths.includes(month)) {
    alerts.push({
      type: 'growth',
      level: 'info',
      msg: 'Peak growth period — monitor for heading. Speed up rotation if grass getting ahead.',
    })
  }
  if (month === 7 && grassType === 'cool_season') {
    alerts.push({
      type: 'slump',
      level: 'warn',
      msg: 'Summer slump approaching for cool season grass. Plan to extend rest periods 20-30% in August.',
    })
  }
  if (month === 8 && grassType === 'cool_season') {
    alerts.push({
      type: 'slump',
      level: 'warn',
      msg: 'Summer slump — cool season grass near dormant. Extend rest periods. Watch cattle condition.',
    })
  }
  if (grass.fallFlushMonths.includes(month)) {
    alerts.push({
      type: 'stockpile',
      level: 'info',
      msg: 'Fall flush starting — consider stockpiling acres for winter grazing. Defer now, graze when dormant.',
    })
  }
  if (month === 11) {
    alerts.push({
      type: 'dormancy',
      level: 'warn',
      msg: 'Final rotation before dormancy — leave 4-6" residual for winter root protection.',
    })
  }
  return alerts
}

// ── Strip inventory model ──────────────────────────────────────────────────────
// The "circle" — every strip at a different stage of recovery
export function buildStripInventory({
  totalAcres,
  acresPerDay,
  rotationStartDate,
  today,
  residualsByDay,     // { dayNum: residualInches }
  regrowthRatePerDay, // inches/day from recovery photos
  entryDmPerAcre,
  dmPerInch = 250,    // lb DM per inch per acre
  grassType = 'cool_season',
}) {
  const todayDate  = new Date(today)
  const startDate  = new Date(rotationStartDate)
  const daysIn     = Math.floor((todayDate - startDate) / 86400000)
  const strips     = []
  const month      = todayDate.getMonth() + 1
  const modifier   = GRASS_TYPES[grassType]?.monthlyModifiers[month] || 1.0
  const adjRate    = regrowthRatePerDay * modifier

  // Grazed strips — recovering
  for (let day = 1; day <= daysIn; day++) {
    const daysRecovering = daysIn - day
    const residual = residualsByDay[day] || 4.5
    const estHeight = residual + (daysRecovering * adjRate)
    const estDm     = estHeight * dmPerInch
    const stage     = detectGrowthStage(estHeight, month, grassType)
    strips.push({
      day, status: 'recovering', daysRecovering,
      residualInches: residual,
      estHeightInches: +estHeight.toFixed(1),
      estDmPerAcre:    Math.round(estDm),
      acres:           acresPerDay,
      stage,
    })
  }

  // Today's graze strip
  strips.push({
    day: daysIn + 1, status: 'grazing_today',
    estHeightInches: 0, // from today's pre-graze photo
    estDmPerAcre: entryDmPerAcre,
    acres: acresPerDay, stage: 'vegetative',
  })

  // Ungrazed strips ahead — still growing
  const stripsAhead = Math.ceil((totalAcres - (daysIn + 1) * acresPerDay) / acresPerDay)
  for (let i = 1; i <= stripsAhead; i++) {
    const daysOfGrowth = daysIn + i
    const estHeight = (entryDmPerAcre / dmPerInch) + (daysOfGrowth * adjRate * 0.3) // slower ungrazed growth
    const estDm     = Math.min(entryDmPerAcre + (daysOfGrowth * adjRate * dmPerInch * 0.3), entryDmPerAcre * 1.8)
    const stage     = detectGrowthStage(estHeight, month, grassType)
    strips.push({
      day: daysIn + 1 + i, status: 'ungrazed',
      estHeightInches: +estHeight.toFixed(1),
      estDmPerAcre:    Math.round(estDm),
      acres:           acresPerDay, stage,
    })
  }

  return strips
}

// ── Total inventory calculation ────────────────────────────────────────────────
export function calcTotalInventory(strips, dailyIntakeLbs) {
  const recovering = strips.filter(s => s.status === 'recovering')
  const ungrazed   = strips.filter(s => s.status === 'ungrazed')
  const all        = [...recovering, ...ungrazed]

  const totalDm    = all.reduce((s, strip) => s + strip.estDmPerAcre * strip.acres, 0)
  const conservDm  = totalDm * 0.90  // 90% conservative for inventory display only
  const daysRemaining = conservDm / dailyIntakeLbs

  const headingRisk = ungrazed.filter(s => s.stage === 'reproductive').length > 0

  return {
    totalDmEstimate:    Math.round(totalDm),
    conservativeDm:     Math.round(conservDm),
    daysRemaining:      +daysRemaining.toFixed(1),
    recoveringAcres:    +(recovering.reduce((s,x) => s + x.acres, 0)).toFixed(1),
    ungrazedAcres:      +(ungrazed.reduce((s,x) => s + x.acres, 0)).toFixed(1),
    avgRecoveringDm:    recovering.length ? Math.round(recovering.reduce((s,x) => s + x.estDmPerAcre, 0) / recovering.length) : 0,
    avgUngrazedDm:      ungrazed.length ? Math.round(ungrazed.reduce((s,x) => s + x.estDmPerAcre, 0) / ungrazed.length) : 0,
    headingRisk,
    stripsHeading:      ungrazed.filter(s => s.stage === 'reproductive').map(s => s.day),
  }
}

// ── Recommendation engine ──────────────────────────────────────────────────────
export const RECOMMENDATION_MIN_DAYS    = 7
export const RECOVERY_PHOTO_INTERVAL    = 7  // days

export function checkRecommendationUnlock({
  daysOfPhotos,
  hasRecoveryPhoto,
  daysSinceLastRecoveryPhoto,
}) {
  if (daysOfPhotos < RECOMMENDATION_MIN_DAYS) {
    return {
      unlocked: false,
      reason: 'baseline',
      message: `Gathering baseline — Day ${daysOfPhotos} of ${RECOMMENDATION_MIN_DAYS}. Keep taking daily pre/post graze photos.`,
      progress: daysOfPhotos / RECOMMENDATION_MIN_DAYS,
    }
  }
  if (!hasRecoveryPhoto) {
    return {
      unlocked: false,
      reason: 'recovery_needed',
      message: 'Almost ready — take a recovery photo of the first grazed section to unlock recommendations.',
      progress: 0.9,
    }
  }
  const needsRecovery = daysSinceLastRecoveryPhoto >= RECOVERY_PHOTO_INTERVAL
  return {
    unlocked: true,
    needsRecoveryPhoto: needsRecovery,
    recoveryMessage: needsRecovery
      ? `Recovery photo due — ${daysSinceLastRecoveryPhoto} days since last recovery check.`
      : null,
    confidence: daysOfPhotos >= 14 ? 'high' : daysOfPhotos >= 10 ? 'medium' : 'low',
  }
}

// ── Safety alerts (fire day 1+, no waiting) ────────────────────────────────────
export function checkSafetyAlerts({ residualInches, legumePct, trampling, seedHeads, soilWet, tempF }) {
  const alerts = []

  // CRITICAL — below 4"
  if (residualInches != null && residualInches < 4) {
    alerts.push({
      type: 'residual_critical', level: 'critical',
      title: 'RESIDUAL BELOW 4" — ADD MOVES',
      msg: `Post-graze residual ${residualInches}" is below the 4" minimum. Cattle are grazing too hard. Add 1-2 moves immediately to open more acres per day and reduce pressure per strip.`,
      action: 'add_moves', moveDelta: +2,
    })
  } else if (residualInches != null && residualInches < 4.5) {
    alerts.push({
      type: 'residual_warn', level: 'warn',
      title: 'Residual approaching minimum',
      msg: `Post-graze residual ${residualInches}" — approaching 4" minimum. Consider adding 1 move to reduce grazing pressure.`,
      action: 'add_move', moveDelta: +1,
    })
  }

  // Residual too high
  if (residualInches != null && residualInches > 7) {
    alerts.push({
      type: 'residual_high', level: 'info',
      title: 'Residual above target',
      msg: `Post-graze residual ${residualInches}" — cattle under-utilizing available grass. Consider removing 1 move to increase grazing pressure per strip.`,
      action: 'remove_move', moveDelta: -1,
    })
  }

  // Bloat risk
  if (legumePct != null && legumePct > 30 && soilWet) {
    alerts.push({
      type: 'bloat', level: 'alert',
      title: 'Elevated bloat risk',
      msg: `Legume content ${legumePct}% with wet conditions. Delay first move 2+ hours. Ensure hay access. Watch cattle closely after moves.`,
      action: 'delay_first_move',
    })
  } else if (legumePct != null && legumePct > 40) {
    alerts.push({
      type: 'bloat', level: 'warn',
      title: 'High legume content',
      msg: `Legume content ${legumePct}% — monitor for bloat. Avoid moving hungry cattle onto lush legume.`,
      action: 'monitor',
    })
  }

  // Trampling
  if (trampling === 'heavy') {
    alerts.push({
      type: 'trampling', level: 'warn',
      title: 'Heavy trampling detected',
      msg: 'Significant soil disturbance visible. Add moves to reduce time on strip and protect soil structure.',
      action: 'add_move', moveDelta: +1,
    })
  }

  // Seed heads
  if (seedHeads === true) {
    alerts.push({
      type: 'maturity', level: 'warn',
      title: 'Seed heads visible — speed up rotation',
      msg: 'Stand moving into reproductive stage. Quality declining. Speed up rotation to keep grass vegetative. Do not let it get away.',
      action: 'speed_up',
    })
  }

  return alerts
}

// ── Optimization recommendations (day 7+ only) ────────────────────────────────
export function buildOptimizationRec({
  avgResidual,
  avgRemovalPct,
  currentMovesPerDay,
  daysOfData,
  regrowthRate,
  daysRemaining,
  rotationDays,
  headingRisk,
  inventoryTrend, // 'growing' | 'stable' | 'shrinking'
}) {
  const confidence = daysOfData >= 14 ? 'high' : daysOfData >= 10 ? 'medium' : 'low'
  let action = 'hold', moveDelta = 0, summary = ''

  if (avgResidual < 4) {
    action = 'add_moves'; moveDelta = 2
    summary = `Residual averaging ${avgResidual}" — below minimum. Adding 2 moves to reduce grazing pressure.`
  } else if (avgResidual < 5) {
    action = 'add_move'; moveDelta = 1
    summary = `Residual averaging ${avgResidual}" — approaching minimum. Adding 1 move as precaution.`
  } else if (avgResidual > 7 && !headingRisk) {
    action = 'remove_move'; moveDelta = -1
    summary = `Residual averaging ${avgResidual}" — under-utilizing grass. Removing 1 move to increase utilization.`
  } else if (headingRisk) {
    action = 'speed_up'; moveDelta = 2
    summary = `Seed heads detected in upcoming strips. Speeding up rotation to keep grass vegetative.`
  } else {
    action = 'hold'; moveDelta = 0
    summary = `Residual ${avgResidual}" — grazing pressure on target. Hold at ${currentMovesPerDay} moves/day.`
  }

  const tomorrow = currentMovesPerDay + moveDelta

  return {
    action, moveDelta, tomorrow,
    confidence, summary,
    basedOnDays: daysOfData,
    avgResidual, avgRemovalPct,
  }
}

// ── AI calibration ─────────────────────────────────────────────────────────────
export function calcAiCalibration(aiEstimate, backCalcActual) {
  if (!aiEstimate || !backCalcActual) return null
  const error = ((backCalcActual - aiEstimate) / aiEstimate) * 100
  return {
    aiEstimate, backCalcActual,
    errorPct: +error.toFixed(1),
    direction: error > 0 ? 'underestimate' : 'overestimate',
    correctionFactor: +(backCalcActual / aiEstimate).toFixed(3),
  }
}

// ── Cold weather intake adjustment ────────────────────────────────────────────
export function coldWeatherIntakeAdj(tempF, baseIntakeLbs) {
  if (tempF == null || tempF > 50) return baseIntakeLbs
  if (tempF > 32) return Math.round(baseIntakeLbs * 1.1)  // 10% more 32-50°F
  return Math.round(baseIntakeLbs * 1.15)                  // 15% more below freezing
}
