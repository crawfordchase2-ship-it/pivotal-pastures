// ─── Pivotal Pastures Grazing Engine v2 ──────────────────────────────────────
// Supports both pivot (wedge geometry) and linear (rectangle geometry)
// All calculations verified against real machine examples

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ─── Time helpers ─────────────────────────────────────────────────────────────
export function toMins(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
export function roundTo15(mins) {
  return Math.round(mins / 15) * 15;
}
export function minsToTime24(mins) {
  const h = Math.floor(((mins % 1440) + 1440) % 1440 / 60);
  const m = Math.round(((mins % 60) + 60) % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
export function fmt12(mins) {
  const t = minsToTime24(mins);
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}
export function fmt12str(t24) {
  const [h, m] = t24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// ─── Behavior period labels ───────────────────────────────────────────────────
export function behaviorLabel(clockMins) {
  if (clockMins < 11 * 60) return { label: 'Morning graze',  color: 'var(--sky)' };
  if (clockMins < 14 * 60) return { label: 'Midday loaf',    color: 'var(--gold)' };
  if (clockMins < 17 * 60) return { label: 'Transition',     color: 'var(--harvest)' };
  return                          { label: 'Evening intake',  color: 'var(--grass)' };
}

// ─── Gap weight tables ────────────────────────────────────────────────────────
const GAP_WEIGHTS = {
  2:  [1.0],
  3:  [0.42, 0.58],
  4:  [0.28, 0.38, 0.34],
  5:  [0.22, 0.28, 0.26, 0.24],
  6:  [0.18, 0.21, 0.27, 0.18, 0.16],
  7:  [0.15, 0.16, 0.20, 0.20, 0.15, 0.14],
  8:  [0.13, 0.14, 0.16, 0.18, 0.15, 0.13, 0.11],
  9:  [0.11, 0.12, 0.13, 0.15, 0.15, 0.13, 0.11, 0.10],
  10: [0.10, 0.10, 0.11, 0.13, 0.14, 0.12, 0.11, 0.10, 0.09],
  11: [0.09, 0.09, 0.10, 0.11, 0.12, 0.11, 0.10, 0.10, 0.09, 0.09],
  12: [0.08, 0.08, 0.09, 0.10, 0.11, 0.10, 0.09, 0.09, 0.09, 0.08, 0.08, 0.09],
};

function getWeights(n) {
  if (GAP_WEIGHTS[n]) return GAP_WEIGHTS[n];
  const gaps = n - 1;
  const raw = [];
  for (let i = 0; i < gaps; i++) {
    const frac = i / (gaps - 1 || 1);
    let w = frac < 0.4 ? 1.0 + frac * 1.5 : frac < 0.6 ? 1.6 : 1.6 - (frac - 0.6) * 2.5;
    raw.push(Math.max(0.5, w));
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(w => w / sum);
}

// ─── Schedule generator ───────────────────────────────────────────────────────
export function generateMoveSchedule(sunriseStr, sunsetStr, movesPerDay, minsPerMove) {
  const sunrise = toMins(sunriseStr);
  const sunset  = toMins(sunsetStr);
  const n = Math.max(1, Math.round(movesPerDay));

  if (n === 1) {
    return [{
      moveNum: 1, startMins: sunrise, manual: false,
      startTime: fmt12(sunrise), stopTime: fmt12(sunrise + minsPerMove),
      runTime: +minsPerMove.toFixed(1), restToNext: null,
      cycleTime: +minsPerMove.toFixed(1), period: behaviorLabel(sunrise),
    }];
  }

  const totalWindow = sunset - sunrise;
  const weights = getWeights(n);
  const startMins = [sunrise];
  let cursor = sunrise;
  for (let i = 0; i < n - 2; i++) {
    cursor += weights[i] * totalWindow;
    startMins.push(cursor);
  }
  startMins.push(sunset);

  const rounded = startMins.map((m, i) => {
    if (i === 0) return sunrise;
    if (i === n - 1) return sunset;
    return roundTo15(m);
  });

  for (let i = 1; i < rounded.length - 1; i++) {
    if (rounded[i] <= rounded[i - 1]) rounded[i] = rounded[i - 1] + 15;
    if (rounded[i] >= rounded[n - 1]) rounded[i] = rounded[n - 1] - 15 * (n - 1 - i);
  }

  return rounded.map((startMin, i) => {
    const stopMin    = startMin + minsPerMove;
    const restToNext = i < n - 1 ? Math.max(0, rounded[i + 1] - stopMin) : null;
    const cycleTime  = restToNext !== null ? minsPerMove + restToNext : minsPerMove;
    return {
      moveNum: i + 1, startMins: startMin, manual: false,
      startTime: fmt12(startMin), stopTime: fmt12(stopMin),
      runTime: +minsPerMove.toFixed(1),
      restToNext: restToNext !== null ? +restToNext.toFixed(0) : null,
      cycleTime: +cycleTime.toFixed(0),
      period: behaviorLabel(startMin),
    };
  });
}

// Manual override
export function applyManualOverride(schedule, moveIndex, newTime24, minsPerMove) {
  const updated = schedule.map(m => ({ ...m }));
  const newStart = toMins(newTime24);
  updated[moveIndex].startMins = newStart;
  updated[moveIndex].startTime = fmt12(newStart);
  updated[moveIndex].stopTime  = fmt12(newStart + minsPerMove);
  updated[moveIndex].runTime   = +minsPerMove.toFixed(1);
  updated[moveIndex].manual    = true;
  for (let i = Math.max(0, moveIndex - 1); i < updated.length; i++) {
    const stopMin = updated[i].startMins + minsPerMove;
    updated[i].stopTime = fmt12(stopMin);
    if (i < updated.length - 1) {
      const rest = Math.max(0, updated[i + 1].startMins - stopMin);
      updated[i].restToNext = +rest.toFixed(0);
      updated[i].cycleTime  = +(minsPerMove + rest).toFixed(0);
    } else {
      updated[i].restToNext = null;
      updated[i].cycleTime  = +minsPerMove.toFixed(0);
    }
  }
  return updated;
}

// ─── Machine helpers ──────────────────────────────────────────────────────────
// Get cumulative radius to end of span N (1-based)
export function getRadiusToSpan(spans, spanNumber) {
  if (!spans || spans.length === 0) return 0;
  let r = 0;
  for (let i = 0; i < spanNumber && i < spans.length; i++) {
    r += Number(spans[i].length_ft || spans[i].length || 0);
  }
  return r;
}

// Get end tower radius (sum of all spans)
export function getEndTowerRadius(spans) {
  if (!spans || spans.length === 0) return 0;
  return spans.reduce((sum, s) => sum + Number(s.length_ft || s.length || 0), 0);
}

// Get grazing width for a pass (linear)
export function getLinearWidth(spans, spanFrom, spanTo) {
  let w = 0;
  for (let i = spanFrom - 1; i < spanTo; i++) {
    w += Number(spans[i]?.length_ft || spans[i]?.length || 0);
  }
  return w;
}

// ─── PIVOT PASS CALCULATOR ────────────────────────────────────────────────────
export function calcPivotPass({ spans, spanFrom, spanTo, desiredGrazingIpm, herd, targetAcresPerDay }) {
  const endTowerRadius = getEndTowerRadius(spans);
  const innerRadius    = spanFrom > 1 ? getRadiusToSpan(spans, spanFrom - 1) : 0;
  const outerRadius    = getRadiusToSpan(spans, spanTo);

  if (outerRadius === 0) return null;

  // Scale factor: how much further end tower travels vs outer grazed span
  const scaleFactor = endTowerRadius / outerRadius;

  // TL computer ipm setting
  const tlIpmSetting = desiredGrazingIpm * scaleFactor;

  // End tower travel per move (inches)
  // Always target 50 ft at outer grazed span
  const endTowerTravelIn = 600 * scaleFactor; // 600 = 50ft × 12

  // Runtime per move
  const runtimeMinutes = endTowerTravelIn / tlIpmSetting;
  // Simplifies to: runtimeMinutes = 600 / desiredGrazingIpm (always!)

  // Degrees per move (rotation at outer grazed span = 50 ft)
  const degreesPerMove = (50 / outerRadius) * RAD_TO_DEG;

  // Acres per move (wedge geometry)
  const acresPerMove = (degreesPerMove / 360) * Math.PI * (outerRadius ** 2 - innerRadius ** 2) / 43560;

  // Moves needed to hit target acres/day
  const movesNeeded = Math.round(targetAcresPerDay / acresPerMove);
  const actualAcresPerDay = acresPerMove * movesNeeded;

  // Degrees per day
  const degreesPerDay = degreesPerMove * movesNeeded;

  // Days per rotation (full 360°)
  const daysPerRotation = 360 / degreesPerDay;

  return {
    type: 'pivot',
    spanFrom, spanTo,
    innerRadius:       +innerRadius.toFixed(1),
    outerRadius:       +outerRadius.toFixed(1),
    endTowerRadius:    +endTowerRadius.toFixed(1),
    scaleFactor:       +scaleFactor.toFixed(3),
    tlIpmSetting:      +tlIpmSetting.toFixed(1),
    endTowerTravelIn:  +endTowerTravelIn.toFixed(1),
    runtimeMinutes:    +runtimeMinutes.toFixed(1),
    degreesPerMove:    +degreesPerMove.toFixed(4),
    acresPerMove:      +acresPerMove.toFixed(3),
    movesPerDay:       movesNeeded,
    actualAcresPerDay: +actualAcresPerDay.toFixed(3),
    degreesPerDay:     +degreesPerDay.toFixed(4),
    daysPerRotation:   +daysPerRotation.toFixed(1),
  };
}

// ─── LINEAR PASS CALCULATOR ───────────────────────────────────────────────────
export function calcLinearPass({ spans, spanFrom, spanTo, ipm, herd, targetAcresPerDay, runLengthFt }) {
  const grazingWidth   = getLinearWidth(spans, spanFrom, spanTo);
  const moveDist       = 50; // always 50 ft

  // Runtime is always 600/ipm for linear (no scale factor needed)
  const runtimeMinutes = 600 / ipm;

  // Acres per move (rectangle)
  const acresPerMove = (grazingWidth * moveDist) / 43560;

  // Moves needed
  const movesNeeded = Math.round(targetAcresPerDay / acresPerMove);
  const actualAcresPerDay = acresPerMove * movesNeeded;

  // Linear travel
  const dailyTravelFt  = movesNeeded * moveDist;
  const daysPerPass    = runLengthFt / dailyTravelFt;

  return {
    type: 'linear',
    spanFrom, spanTo,
    grazingWidth:      +grazingWidth.toFixed(1),
    ipm,
    tlIpmSetting:      ipm, // same as desired — no scale factor
    scaleFactor:       1.0,
    endTowerTravelIn:  600, // always 600 inches = 50 ft
    runtimeMinutes:    +runtimeMinutes.toFixed(1),
    acresPerMove:      +acresPerMove.toFixed(3),
    movesPerDay:       movesNeeded,
    actualAcresPerDay: +actualAcresPerDay.toFixed(3),
    dailyTravelFt:     +dailyTravelFt.toFixed(1),
    daysPerPass:       +daysPerPass.toFixed(1),
  };
}

// ─── GRAZING PLAN CALCULATOR ──────────────────────────────────────────────────
export function calcGrazingPlan({ machine, herd, passes, desiredGrazingIpm, forageDmPerAcre, removalPct }) {
  const dailyDmIntake   = herd.total_lw * 0.025; // 2.5% of liveweight
  const usableDmPerAcre = forageDmPerAcre * (removalPct / 100);
  const targetAcresDay  = dailyDmIntake / usableDmPerAcre;

  const spans      = machine.spans || [];
  const isMachine  = machine.type === 'pivot';
  const runLength  = Number(machine.run_length_ft || 0);

  const calculatedPasses = passes
    .filter(p => p.status !== 'skipped')
    .map(p => {
      if (isMachine) {
        return calcPivotPass({
          spans,
          spanFrom: p.span_from,
          spanTo:   p.span_to,
          desiredGrazingIpm,
          herd,
          targetAcresPerDay: targetAcresDay,
        });
      } else {
        return calcLinearPass({
          spans,
          spanFrom: p.span_from,
          spanTo:   p.span_to,
          ipm:      desiredGrazingIpm,
          herd,
          targetAcresPerDay: targetAcresDay,
          runLengthFt: runLength,
        });
      }
    });

  const totalCycleDays = calculatedPasses.reduce((sum, p) => {
    return sum + (p?.daysPerRotation || p?.daysPerPass || 0);
  }, 0);

  return {
    dailyDmIntake:    +dailyDmIntake.toFixed(0),
    usableDmPerAcre:  +usableDmPerAcre.toFixed(0),
    targetAcresDay:   +targetAcresDay.toFixed(3),
    passes:           calculatedPasses,
    totalCycleDays:   +totalCycleDays.toFixed(1),
  };
}

// ─── POSITION TRACKING ────────────────────────────────────────────────────────
// Calculate current position based on schedule adherence
export function calcCurrentPosition({ pass, startDate, movesCompletedToday, currentDate }) {
  if (!pass || !startDate) return 0;

  const start  = new Date(startDate);
  const now    = new Date(currentDate || new Date().toISOString().slice(0,10));
  const daysElapsed = Math.floor((now - start) / 86400000);

  const movesPerDay    = pass.moves_per_day || 0;
  const degreesPerMove = pass.degrees_per_move || 0;
  const dailyTravelFt  = pass.daily_travel_ft || 0;

  if (pass.type === 'pivot' || degreesPerMove > 0) {
    const degreesPerDay = degreesPerMove * movesPerDay;
    const totalDegrees  = (daysElapsed * degreesPerDay) + (movesCompletedToday * degreesPerMove);
    return +(totalDegrees % 360).toFixed(3);
  } else {
    // Linear
    const movesPerDay2   = pass.moves_per_day || 0;
    const totalMoves     = (daysElapsed * movesPerDay2) + movesCompletedToday;
    const totalFt        = totalMoves * 50;
    const runLength      = pass.end_position || 0;
    if (pass.direction === 'reverse') {
      return Math.max(0, runLength - totalFt);
    }
    return Math.min(runLength, totalFt);
  }
}

// ─── FORAGE INTAKE FORMULA ────────────────────────────────────────────────────
export function calcTargetAcresPerDay({ totalLiveweight, forageDmPerAcre, removalPct = 50 }) {
  const dailyIntake    = totalLiveweight * 0.025;
  const usableDm       = forageDmPerAcre * (removalPct / 100);
  return {
    dailyIntakeLbs:   +dailyIntake.toFixed(0),
    usableDmPerAcre:  +usableDm.toFixed(0),
    targetAcresPerDay: +(dailyIntake / usableDm).toFixed(3),
  };
}

// ─── RECOMMENDATION ENGINE ────────────────────────────────────────────────────
export function validateRecommendation(aiAssessment, goal, currentMoves) {
  const {
    confidence, recommended_action, recommended_move_change,
    estimated_post_graze_residual_inches: residual,
    trampling_score_1_to_10: trampling,
    bare_soil_visibility: bareSoil,
    bloat_risk: bloat,
  } = aiAssessment;

  const warnings = [];
  let action    = recommended_action;
  let moveChange = recommended_move_change || 0;

  if (confidence === 'low') {
    return { action: 'need_more_info', moveChange: 0, newMoves: currentMoves, warnings: ['Low AI confidence. Upload a clearer photo.'] };
  }

  if (residual != null) {
    if (goal === 'production') {
      if      (residual < 4)  { action = 'add_move';    moveChange =  1; }
      else if (residual <= 5) { action = 'hold';        moveChange =  0; }
      else                    { action = 'remove_move'; moveChange = -1; }
    } else if (goal === 'topping') {
      if (residual < 6)       { action = 'add_move';    moveChange =  1; }
      else                    { action = 'hold';        moveChange =  0; }
    }
  }

  if (trampling >= 7 || bareSoil === 'moderate' || bareSoil === 'high') {
    if (action !== 'add_move') { action = 'flag_risk'; moveChange = 1; }
    warnings.push('Soil damage detected. Increase movement speed to reduce pressure.');
  }

  if (bloat === 'high') {
    action = 'flag_risk';
    warnings.push('Elevated bloat risk. Consider hay access or delay first move 1–2 hours.');
  }

  const newMoves = Math.min(20, Math.max(1, currentMoves + moveChange));
  return { action, moveChange: newMoves - currentMoves, newMoves, warnings };
}

// ─── SUN TIMES ────────────────────────────────────────────────────────────────
export async function fetchSunTimes(date, lat = 41.5, lng = -99.5) {
  try {
    const res  = await fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${date}&formatted=0`);
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

// ─── GPS CALCULATIONS ─────────────────────────────────────────────────────────
// Calculate GPS position from pivot center + radius + degrees
export function pivotPositionToGPS(centerLat, centerLng, radiusFt, degrees) {
  const radiusM  = radiusFt * 0.3048;
  const earthR   = 6371000;
  const bearing  = degrees * DEG_TO_RAD;
  const lat1     = centerLat * DEG_TO_RAD;
  const lng1     = centerLng * DEG_TO_RAD;
  const lat2     = Math.asin(Math.sin(lat1) * Math.cos(radiusM / earthR) +
                   Math.cos(lat1) * Math.sin(radiusM / earthR) * Math.cos(bearing));
  const lng2     = lng1 + Math.atan2(
                   Math.sin(bearing) * Math.sin(radiusM / earthR) * Math.cos(lat1),
                   Math.cos(radiusM / earthR) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * RAD_TO_DEG, lng: lng2 * RAD_TO_DEG };
}

// Calculate GPS position along a linear field
export function linearPositionToGPS(startLat, startLng, endLat, endLng, positionFt, runLengthFt) {
  const fraction = Math.min(1, Math.max(0, positionFt / runLengthFt));
  return {
    lat: startLat + (endLat - startLat) * fraction,
    lng: startLng + (endLng - startLng) * fraction,
  };
}

// ─── SIMULATION ENGINE ────────────────────────────────────────────────────────
export function runSimulation({ machine, herd, plan, passes, forageDmPerAcre, removalPct, sunriseTime, sunsetTime, daysToSimulate }) {
  const results = [];
  const { targetAcresDay } = calcTargetAcresPerDay({
    totalLiveweight: herd.total_lw,
    forageDmPerAcre, removalPct,
  });

  let currentDate = new Date();
  let totalDmConsumed = 0;

  passes.forEach((pass, passIdx) => {
    const passCalc = machine.type === 'pivot'
      ? calcPivotPass({ spans: machine.spans, spanFrom: pass.span_from, spanTo: pass.span_to, desiredGrazingIpm: machine.ipm, herd, targetAcresPerDay: targetAcresDay })
      : calcLinearPass({ spans: machine.spans, spanFrom: pass.span_from, spanTo: pass.span_to, ipm: machine.ipm, herd, targetAcresPerDay: targetAcresDay, runLengthFt: machine.run_length_ft });

    const daysInPass = passCalc.daysPerRotation || passCalc.daysPerPass;
    const schedule   = generateMoveSchedule(sunriseTime, sunsetTime, passCalc.movesPerDay, passCalc.runtimeMinutes);

    for (let day = 0; day < Math.ceil(daysInPass); day++) {
      const dayAcres   = passCalc.actualAcresPerDay;
      const dayDm      = dayAcres * forageDmPerAcre * (removalPct / 100);
      totalDmConsumed += dayDm;

      const position = machine.type === 'pivot'
        ? +((day * passCalc.degreesPerDay) % 360).toFixed(2)
        : +(day * passCalc.dailyTravelFt).toFixed(0);

      results.push({
        passNumber:    passIdx + 1,
        spanFrom:      pass.span_from,
        spanTo:        pass.span_to,
        day:           day + 1,
        date:          new Date(currentDate.getTime() + day * 86400000).toISOString().slice(0,10),
        position,
        movesPerDay:   passCalc.movesPerDay,
        acresGrazed:   +dayAcres.toFixed(3),
        dmConsumed:    +dayDm.toFixed(0),
        totalDmConsumed: +totalDmConsumed.toFixed(0),
        tlIpmSetting:  passCalc.tlIpmSetting,
        runtimeMin:    passCalc.runtimeMinutes,
        schedule:      schedule.slice(0, 3), // first 3 moves for preview
      });
    }
    currentDate = new Date(currentDate.getTime() + Math.ceil(daysInPass) * 86400000);
  });

  return results;
}
