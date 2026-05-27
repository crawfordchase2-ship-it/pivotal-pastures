// ─── Grazing Calculation Engine ───────────────────────────────────────────────

export function calcPivotArea(spans, spanLength) {
  const radius = spans * spanLength;
  return ((Math.PI * radius * radius) / 43560).toFixed(2);
}

export function calcLinearArea(spans, spanLength, runLength) {
  const width = spans * spanLength;
  return ((width * runLength) / 43560).toFixed(2);
}

// ─── Time helpers ─────────────────────────────────────────────────────────────
export function toMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
export function roundTo15(mins) {
  return Math.round(mins / 15) * 15;
}
export function minsToTime24(mins) {
  const h = Math.floor(((mins % 1440) + 1440) % 1440 / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function fmt12(mins24) {
  const [h, m] = mins24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Behavior weight function ─────────────────────────────────────────────────
const LOAF_START    = 11 * 60;
const LOAF_END      = 16 * 60;
const EVENING_START = 17 * 60;

export function gapWeight(clockMins) {
  if (clockMins >= LOAF_START && clockMins < LOAF_END)      return 2.2;
  if (clockMins >= LOAF_END   && clockMins < EVENING_START) return 1.2;
  if (clockMins >= EVENING_START)                            return 0.55;
  return 1.0;
}

export function behaviorLabel(clockMins) {
  if (clockMins < LOAF_START)    return { label: 'Morning graze',  color: 'var(--sky)' };
  if (clockMins < LOAF_END)      return { label: 'Midday loaf',    color: 'var(--amber)' };
  if (clockMins < EVENING_START) return { label: 'Transition',     color: 'var(--straw)' };
  return                                { label: 'Evening intake',  color: 'var(--meadow)' };
}

// ─── Move schedule generator ──────────────────────────────────────────────────
export function generateMoveSchedule(sunriseStr, sunsetStr, movesPerRotation, minsPerMove) {
  const sunrise = toMins(sunriseStr);
  const sunset  = toMins(sunsetStr);
  const n = movesPerRotation;

  if (n < 2) {
    return [{
      moveNum: 1, startMins: sunrise,
      startTime: fmt12(minsToTime24(sunrise)),
      stopTime:  fmt12(minsToTime24(sunrise + minsPerMove)),
      runTime: minsPerMove, restToNext: null, cycleTime: minsPerMove,
      period: behaviorLabel(sunrise),
    }];
  }

  const totalSpan = sunset - sunrise;
  let positions = [sunrise];
  for (let i = 1; i < n - 1; i++) {
    positions.push(sunrise + (totalSpan * i) / (n - 1));
  }
  positions.push(sunset);

  // Iterative refinement — 8 passes
  for (let iter = 0; iter < 8; iter++) {
    const weights = [];
    for (let i = 0; i < n - 1; i++) {
      const midpoint = (positions[i] + positions[i + 1]) / 2;
      weights.push(gapWeight(midpoint));
    }
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let cursor = sunrise;
    const newPos = [sunrise];
    for (let i = 0; i < n - 2; i++) {
      cursor += (weights[i] / totalWeight) * totalSpan;
      newPos.push(cursor);
    }
    newPos.push(sunset);
    positions = newPos;
  }

  const roundedPositions = positions.map((p, i) => {
    if (i === 0) return sunrise;
    if (i === n - 1) return sunset;
    return roundTo15(p);
  });

  return roundedPositions.map((startMins, i) => {
    const stopMins   = startMins + minsPerMove;
    const restToNext = i < n - 1 ? Math.max(0, roundedPositions[i + 1] - stopMins) : null;
    const cycleTime  = restToNext !== null ? minsPerMove + restToNext : minsPerMove;
    return {
      moveNum: i + 1,
      startMins,
      startTime: fmt12(minsToTime24(startMins)),
      stopTime:  fmt12(minsToTime24(stopMins)),
      runTime:   minsPerMove,
      restToNext,
      cycleTime,
      period: behaviorLabel(startMins),
    };
  });
}

// ─── Full schedule calculator ─────────────────────────────────────────────────
export function calcSchedule({ machine, herd, spansGrazed, ipm, movesPerRotation, moveDist, sunriseTime, sunsetTime }) {
  if (!machine || !herd) return null;

  const spanLen      = Number(machine.span_length || machine.spanLength);
  const runLength    = Number(machine.run_length  || machine.runLength);
  const totalSpans   = Number(machine.spans);
  const totalLW      = Number(herd.total_lw || herd.totalLW);

  const minsPerMove       = (moveDist * 12) / ipm;
  const grazingWidth      = spansGrazed * spanLen;
  const acresPerMove      = (grazingWidth * moveDist) / 43560;
  const acresPerDay       = acresPerMove * movesPerRotation;
  const dailyTravelFt     = movesPerRotation * moveDist;
  const daysPerPass       = runLength / dailyTravelFt;
  const numPasses         = totalSpans / spansGrazed;
  const fullRotationDays  = daysPerPass * numPasses;
  const allocStockDensity = totalLW / acresPerMove;
  const hrsPerRotation    = (minsPerMove * movesPerRotation) / 60;
  const moveSchedule      = generateMoveSchedule(sunriseTime, sunsetTime, movesPerRotation, minsPerMove);

  return {
    minsPerMove:       +minsPerMove.toFixed(1),
    grazingWidth,
    acresPerMove:      +acresPerMove.toFixed(3),
    acresPerDay:       +acresPerDay.toFixed(3),
    dailyTravelFt,
    daysPerPass:       +daysPerPass.toFixed(1),
    numPasses:         +numPasses.toFixed(1),
    fullRotationDays:  +fullRotationDays.toFixed(1),
    allocStockDensity: Math.round(allocStockDensity),
    hrsPerRotation:    +hrsPerRotation.toFixed(2),
    moveSchedule,
  };
}

// ─── Recommendation engine ────────────────────────────────────────────────────
export function validateRecommendation(aiAssessment, goal, currentMoves) {
  const { confidence, recommended_action, recommended_move_change,
          estimated_post_graze_residual_inches: residual,
          trampling_score_1_to_10: trampling,
          bare_soil_visibility: bareSoil,
          bloat_risk: bloat } = aiAssessment;

  const warnings = [];
  let action    = recommended_action;
  let moveChange = recommended_move_change || 0;

  if (confidence === 'low') {
    return { action: 'need_more_info', moveChange: 0, newMoves: currentMoves, warnings: ['Low AI confidence. Upload a clearer photo.'] };
  }

  if (residual != null) {
    if (goal === 'production') {
      if (residual < 4)                     { action = 'add_move';    moveChange = 1; }
      else if (residual <= 5)               { action = 'hold';        moveChange = 0; }
      else if (residual <= 7)               { action = 'remove_move'; moveChange = -1; }
      else                                  { action = 'remove_move'; moveChange = -1; }
    } else if (goal === 'topping') {
      if (residual < 6)                     { action = 'add_move';    moveChange = 1; }
      else                                  { action = 'hold';        moveChange = 0; }
    }
  }

  if (trampling >= 7 || bareSoil === 'moderate' || bareSoil === 'high') {
    if (action !== 'add_move') { action = 'flag_risk'; moveChange = 1; }
    warnings.push('Soil damage detected. Increasing movement speed recommended.');
  }

  if (bloat === 'high') {
    action = 'flag_risk';
    warnings.push('Elevated bloat risk. Consider hay access or delay first move 1–2 hours.');
  }

  const newMoves = Math.min(20, Math.max(1, currentMoves + moveChange));
  return { action, moveChange: newMoves - currentMoves, newMoves, warnings };
}

// ─── Fetch sun times ──────────────────────────────────────────────────────────
export async function fetchSunTimes(date, lat = 41.5, lng = -99.5) {
  try {
    const res = await fetch(
      `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${date}&formatted=0`
    );
    const data = await res.json();
    if (data.status === 'OK') {
      const toLocal = (utcStr) => {
        const d = new Date(utcStr);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      };
      return { sunrise: toLocal(data.results.sunrise), sunset: toLocal(data.results.sunset) };
    }
  } catch {}
  return { sunrise: '06:00', sunset: '20:30' };
}
