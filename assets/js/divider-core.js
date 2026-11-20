(function () {
  'use strict';

  const MAX_UNITS = 2000;
  const MAX_TAPS = 8;
  const MAX_SOLUTIONS = 8;
  const NEAREST = 8;
  const IN_TOLERANCE = 16;
  const EPS = 1e-12;

  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const lcmUpTo = p => { let l = 1; for (let i = 2; i <= p; i++) l = l * i / gcd(l, i); return l; };

  const prefixes = new Map([[-15, 'f'], [-12, 'p'], [-9, 'n'], [-6, 'µ'], [-3, 'm'], [0, ''], [3, 'k'], [6, 'M'], [9, 'G'], [12, 'T']]);

  function formatValue(value, unit = '', digits = 4) {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return '0' + (unit ? ' ' + unit : '');
    let exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
    let scaled = Number((Math.abs(value) / 10 ** exponent).toPrecision(digits));
    if (scaled >= 1000) { exponent += 3; scaled /= 1000; }
    if (!prefixes.has(exponent)) return (value < 0 ? '−' : '') + Math.abs(value).toPrecision(digits) + (unit ? ' ' + unit : '');
    const suffix = prefixes.get(exponent) + unit;
    return (value < 0 ? '−' : '') + String(scaled) + (suffix ? ' ' + suffix : '');
  }

  function composition(segment) {
    const parts = [];
    if (segment.n) parts.push(segment.n === 1 ? 'Ru' : segment.n + ' Ru');
    segment.groups.forEach(({ count, parallel }) => {
      parts.push((count === 1 ? '' : count + '·') + 'Ru/' + parallel);
    });
    return parts.join(' + ');
  }

  function searchGrids(maxParallel) {
    const base = lcmUpTo(Math.min(4, maxParallel));
    const grids = new Set([base]);
    for (let p = 5; p <= maxParallel; p++) {
      grids.add(p);
      for (let q = 2; q < p; q++) {
        const L = p * q / gcd(p, q);
        if (L <= 120) grids.add(L);
      }
    }
    return [base, ...Array.from(grids).filter(L => L !== base).sort((a, b) => a - b)];
  }

  function* totalCandidates(lo, hi, sampled) {
    if (!sampled || hi - lo < 512) {
      for (let G = lo; G <= hi; G++) yield G;
      return;
    }
    const points = new Set();
    for (let i = 0; i < 128; i++) points.add(lo + i);
    for (let i = 0; i < 384; i++) points.add(Math.round(lo + (hi - lo) * i / 383));
    yield* Array.from(points).sort((a, b) => a - b);
  }

  function segmentTable(L, maxParallel, maxD) {
    const costs = new Float64Array(maxD + 1).fill(Infinity);
    const parallel = new Uint8Array(maxD + 1);
    const sizes = Array.from({ length: maxParallel }, (_, i) => i + 1).filter(p => L % p === 0);
    costs[0] = 0;
    for (let d = 1; d <= maxD; d++) {
      for (const p of sizes) {
        const step = L / p;
        if (step <= d && costs[d - step] + p < costs[d]) {
          costs[d] = costs[d - step] + p;
          parallel[d] = p;
        }
      }
    }
    return { costs, parallel };
  }

  // Convergents and best semiconvergents of x with denominator at most maxDen.
  function approximations(x, maxDen) {
    const out = [];
    const seen = new Set();
    const push = (p, q) => {
      if (q < 2 || q > maxDen || p < 0 || p >= q) return;
      const key = p + '/' + q;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ p, q });
    };
    let prevP = 1, prevQ = 0, curP = Math.floor(x), curQ = 1;
    let frac = x - curP;
    for (let level = 0; level < 40 && frac > 1e-12; level++) {
      const next = 1 / frac;
      const a = Math.floor(next + 1e-12);
      const last = Math.min(a, Math.max(1, Math.floor((maxDen - prevQ) / curQ)));
      const ts = new Set([2, last - 1, last, a]);
      Array.from(ts).sort((u, v) => u - v).forEach(t => {
        if (t >= 1 && t <= a) push(t * curP + prevP, t * curQ + prevQ);
      });
      if (last < a) break;
      const np = a * curP + prevP, nq = a * curQ + prevQ;
      if (nq > maxDen) break;
      prevP = curP; prevQ = curQ;
      curP = np; curQ = nq;
      const rest = next - a;
      if (rest <= 1e-12) break;
      frac = rest;
    }
    return out;
  }

  // Lower bound for the relative error of any e/D with D <= maxDen.
  function minApproxError(x, maxDen) {
    if (!(maxDen >= 2)) return Infinity;
    let best = Infinity;
    for (const { p, q } of approximations(x, maxDen)) best = Math.min(best, Math.abs(x - p / q));
    return best;
  }

  // A switch at node p bypasses the block [e, p], so the tap sees e / (G - b).
  function switchCandidates(ratio, G, tolerance, gLo) {
    const Dhi = G - 1;
    const Dlo = Math.max(2, gLo);
    if (Dlo > Dhi) return [];
    const found = new Map();
    const offer = (D, e) => {
      if (D < Dlo || D > Dhi || e < 1 || e > D - 1) return;
      found.set(D + ':' + e, { D, e, p: e + G - D });
    };
    for (const { p: a, q } of approximations(ratio, Dhi)) {
      if (a < 1 || a >= q) continue;
      const mMin = Math.ceil(Dlo / q), mMax = Math.floor(Dhi / q);
      if (mMin > mMax) continue;
      offer(mMin * q, mMin * a);
      if (mMax !== mMin) offer(mMax * q, mMax * a);
    }
    for (let D = Dlo; D <= Math.min(Dhi, Dlo + 23); D++) offer(D, Math.round(ratio * D));
    for (let D = Math.max(Dlo, Dhi - 15); D <= Dhi; D++) offer(D, Math.round(ratio * D));
    const options = Array.from(found.values()).map(option => {
      const achieved = option.e / option.D;
      const error = ratio / achieved - 1;
      return {
        p: option.p, e: option.e, D: option.D, b: G - option.D,
        switch: true, achieved, error, abs: Math.abs(error),
        inTol: Math.abs(error) <= tolerance + EPS, near: false
      };
    }).sort((a, b) => a.abs - b.abs);
    const list = [];
    let tolerated = 0;
    options.forEach((option, rank) => {
      if (rank < NEAREST) { option.near = true; list.push(option); }
      else if (option.inTol && tolerated < IN_TOLERANCE) { tolerated++; list.push(option); }
    });
    return list;
  }

  function candidates(ratio, G, L, tolerance) {
    const x = ratio * G;
    const set = new Set();
    const add = p => { if (p >= 1 && p <= G - 1) set.add(p); };
    const centre = Math.round(x);
    for (let o = -NEAREST; o <= NEAREST; o++) add(centre + o);
    add(L * Math.floor(x / L));
    add(L * Math.ceil(x / L));
    const lo = Math.ceil(x / (1 + tolerance) - 1e-9);
    const hi = Math.floor(tolerance < 1 ? x / (1 - tolerance) + 1e-9 : G - 1);
    const integerCentre = Math.round(x / L);
    for (let o = -MAX_TAPS; o <= MAX_TAPS; o++) {
      const p = (integerCentre + o) * L;
      if (p >= lo && p <= hi) add(p);
    }
    for (let o = 0, taken = 0; taken < IN_TOLERANCE && (centre - o >= lo || centre + o <= hi); o++) {
      (o ? [centre - o, centre + o] : [centre]).forEach(p => {
        if (p >= lo && p <= hi && taken < IN_TOLERANCE) { add(p); taken++; }
      });
    }
    const nearest = Array.from(set).sort((a, b) => Math.abs(a - x) - Math.abs(b - x));
    return nearest.map((p, rank) => {
      const error = x / p - 1;
      return { p, e: null, switch: false, error, abs: Math.abs(error), inTol: Math.abs(error) <= tolerance + EPS, near: rank < NEAREST };
    }).filter(c => c.inTol || c.near || c.p % L === 0);
  }

  function better(mode, a, b) {
    if (!b) return true;
    if (mode === 'units') {
      if (a.units !== b.units) return a.units < b.units;
      if (a.switches !== b.switches) return a.switches < b.switches;
      return a.err < b.err - EPS;
    }
    if (Math.abs(a.err - b.err) > EPS) return a.err < b.err;
    if (a.units !== b.units) return a.units < b.units;
    return a.switches < b.switches;
  }

  // Taps are ordered top-down; state per stage is the chosen candidate position.
  // Hybrid mode also tracks how many plain taps were chosen (0, 1 or 2+) and only
  // accepts a solution with exactly one plain tap, so every other tap uses a switch.
  function optimise(stages, G, costs, mode, exactlyOnePlain = false) {
    const allowed = stages.map(list => list.filter(c => mode !== 'units' || c.inTol));
    if (allowed.some(list => !list.length)) return null;
    const buckets = exactlyOnePlain ? 3 : 1;
    const startState = (c) => {
      const cost = costs[G - c.p];
      const row = new Array(buckets).fill(null);
      if (!Number.isFinite(cost)) return row;
      const bucket = exactlyOnePlain && !c.switch ? 1 : 0;
      row[bucket] = { units: cost, err: c.abs, switches: c.switch ? 1 : 0, back: -1, backBucket: -1 };
      return row;
    };
    let previous = allowed[0].map(startState);
    const history = [previous];
    for (let s = 1; s < allowed.length; s++) {
      const current = allowed[s].map(c => {
        const row = new Array(buckets).fill(null);
        allowed[s - 1].forEach((pc, j) => {
          if (pc.p <= c.p) return;
          const cost = pc.switch
            ? pc.e >= c.p ? costs[pc.p - pc.e] + costs[pc.e - c.p] : costs[pc.p - c.p]
            : costs[pc.p - c.p];
          if (!Number.isFinite(cost)) return;
          const plainStep = c.switch ? 0 : 1;
          for (let k = 0; k < buckets; k++) {
            const state = previous[j][k];
            if (!state) continue;
            const bucket = exactlyOnePlain ? Math.min(2, k + plainStep) : 0;
            const next = {
              units: state.units + cost, err: Math.max(state.err, c.abs),
              switches: state.switches + (c.switch ? 1 : 0), back: j, backBucket: k
            };
            if (better(mode, next, row[bucket])) row[bucket] = next;
          }
        });
        return row;
      });
      history.push(current);
      previous = current;
    }
    const last = allowed.length - 1;
    let best = null, bestIndex = -1, bestBucket = -1;
    previous.forEach((row, j) => {
      const c = allowed[last][j];
      const cost = c.switch ? costs[c.p - c.e] + costs[c.e] : costs[c.p];
      if (!Number.isFinite(cost)) return;
      for (let k = 0; k < buckets; k++) {
        const state = row[k];
        if (!state || (exactlyOnePlain && k !== 1)) continue;
        const total = { units: state.units + cost, err: state.err, switches: state.switches };
        if (better(mode, total, best)) { best = total; bestIndex = j; bestBucket = k; }
      }
    });
    if (!best) return null;
    const positions = new Array(allowed.length);
    const picked = new Array(allowed.length);
    for (let s = last, j = bestIndex, k = bestBucket; s >= 0; s--) {
      picked[s] = allowed[s][j];
      positions[s] = allowed[s][j].p;
      const state = history[s][j][k];
      j = state ? state.back : -1;
      k = state ? state.backBucket : -1;
    }
    return { units: best.units, err: best.err, switches: best.switches, positions, picked };
  }

  function buildSolution(found, G, L, table, context) {
    const { taps, order, ratios, unit, vMin, vMax, maxParallel } = context;
    const picked = found.picked;
    const tapNodes = new Map();
    order.forEach((index, stage) => {
      const p = picked[stage].p;
      if (!tapNodes.has(p)) tapNodes.set(p, taps[index].name);
    });
    const cutSet = new Set([0, G]);
    picked.forEach(c => { cutSet.add(c.p); if (c.switch) cutSet.add(c.e); });
    const cuts = Array.from(cutSet).sort((a, b) => b - a);
    const named = new Map();
    let anonymous = 0;
    const nodeAt = grid => {
      if (grid === G) return 'VIN';
      if (grid === 0) return 'GND';
      if (tapNodes.has(grid)) return tapNodes.get(grid);
      if (!named.has(grid)) named.set(grid, 'N' + (++anonymous));
      return named.get(grid);
    };
    cuts.forEach(grid => nodeAt(grid));

    const segments = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const top = cuts[i], bottom = cuts[i + 1], d = top - bottom;
      const counts = new Array(maxParallel + 1).fill(0);
      for (let remaining = d; remaining > 0;) {
        const p = table.parallel[remaining];
        counts[p]++;
        remaining -= L / p;
      }
      const groups = counts.flatMap((count, parallel) => count && parallel > 1 ? [{ count, parallel }] : []);
      const segment = {
        name: 'R' + (i + 1), top: nodeAt(top), bottom: nodeAt(bottom),
        topGrid: top, bottomGrid: bottom,
        n: counts[1], groups,
        value: d / L, resistance: d / L * unit,
        units: table.costs[d]
      };
      segment.composition = composition(segment);
      segments.push(segment);
    }

    const byOriginal = new Array(taps.length);
    const switches = [];
    order.forEach((index, stage) => {
      const c = picked[stage];
      const bypass = c.switch ? c.p - c.e : 0;
      const effectiveUnits = G - bypass;
      const achieved = c.switch ? c.e / effectiveUnits : c.p / G;
      const divisor = gcd(c.switch ? c.e : c.p, effectiveUnits);
      const tripActual = taps[index].vRef / achieved;
      const stateR = effectiveUnits / L * unit;
      let sw = null;
      if (c.switch) {
        sw = {
          name: null, tap: taps[index].name, bit: null,
          from: nodeAt(c.e), to: nodeAt(c.p),
          gridFrom: c.e, gridTo: c.p,
          fromValue: c.e / L, toValue: c.p / L,
          bypassGrid: bypass, bypassValue: bypass / L,
          effectiveGrid: effectiveUnits, effectiveValue: effectiveUnits / L,
          bypassResistance: bypass / L * unit,
          effectiveR: stateR,
          segments: []
        };
        switches.push(sw);
      }
      byOriginal[index] = {
        index, name: taps[index].name, vTrip: taps[index].vTrip, vRef: taps[index].vRef,
        ratio: ratios[index], achieved,
        num: (c.switch ? c.e : c.p) / divisor, den: effectiveUnits / divisor,
        tripActual, error: tripActual / taps[index].vTrip - 1,
        position: c.p / L, node: nodeAt(c.p), currentAtTrip: tripActual / stateR,
        switch: sw
      };
    });

    const selectWidth = switches.length;
    const selectBus = selectWidth > 1 ? 'SEL<' + selectWidth + ':1>' : selectWidth === 1 ? 'SEL' : null;
    const selectCode = bit => Array.from({ length: selectWidth }, (_, i) => i === bit ? '1' : '0').reverse().join('');
    // Taps are ordered top to bottom, so the first switch takes the highest bit and
    // select bits descend down the string.
    switches.forEach((sw, index) => {
      sw.bit = selectWidth - 1 - index;
      sw.name = 'SW' + (sw.bit + 1);
      sw.selectCode = selectCode(sw.bit);
      sw.selectSignal = selectWidth > 1 ? 'SEL<' + (sw.bit + 1) + '>' : 'SEL';
    });
    byOriginal.forEach(tap => {
      if (tap) tap.selectCode = selectWidth ? (tap.switch ? tap.switch.selectCode : '0'.repeat(selectWidth)) : null;
    });

    segments.forEach(segment => {
      switches.forEach(sw => {
        if (segment.topGrid <= sw.gridTo && segment.bottomGrid >= sw.gridFrom) {
          (segment.bypass || (segment.bypass = [])).push(sw.name);
          sw.segments.push(segment.name);
        }
      });
    });

    const totalUnits = G / L;
    const totalR = totalUnits * unit;
    const stateTotals = [G, ...switches.map(sw => sw.effectiveGrid)];
    const totalRMax = Math.max(...stateTotals) / L * unit;
    const totalRMin = Math.min(...stateTotals) / L * unit;
    const units = segments.reduce((sum, segment) => sum + segment.units, 0);
    return {
      key: G + ':' + picked.map(c => c.p + (c.switch ? 'e' + c.e : '')).join(','),
      units, maxError: found.err, switchCount: switches.length, selectWidth, selectBus,
      grid: L, unit, totalUnits, totalR, totalRMin, totalRMax,
      currentMin: vMin / totalRMax, current: vMax / totalRMin, power: vMax * vMax / totalRMin,
      taps: byOriginal, order: order.slice(), segments, switches
    };
  }

  function spread(list, count) {
    if (list.length <= count) return list;
    const picked = new Set();
    for (let i = 0; i < count; i++) picked.add(Math.round(i * (list.length - 1) / (count - 1)));
    return Array.from(picked).sort((a, b) => a - b).map(i => list[i]);
  }

  function solve(input) {
    const errors = [];
    const warnings = [];
    // Each error and warning is tagged with the input area that produced it, so the
    // UI can show it next to those inputs instead of only in the results area.
    const errorTags = [];
    const warningTags = [];
    const fail = (tag, message) => { errors.push(message); errorTags.push(tag); };
    const rawTaps = Array.isArray(input && input.taps) ? input.taps : [];
    // Tap names are user-editable; fall back to TAP<n> and keep them unique so node
    // names in the solution stay unambiguous.
    const usedNames = new Set();
    const reservedName = /^(?:vin|gnd|n\d+)$/i;
    const taps = rawTaps.map((tap, i) => {
      const fallback = 'TAP' + (i + 1);
      const base = typeof tap.name === 'string' ? tap.name.trim().slice(0, 16) : '';
      let name = base || fallback;
      for (let suffix = 2; usedNames.has(name) || reservedName.test(name); suffix++) name = (base || fallback) + ' ' + suffix;
      usedNames.add(name);
      return { ...tap, name };
    });
    const unit = Number(input && input.unit);
    const maxParallel = Number(input && input.maxParallel);
    const tolerance = Number(input && input.tolerance);
    const constraint = (input && input.constraint) || {};
    const topology = input && ['taps', 'hybrid'].includes(input.topology) ? input.topology : 'taps';

    // 'range' covers the VIN, current and resistance range settings; 'unit' covers
    // the unit resistor, parallel limit and tolerance settings.
    const tapsTag = { section: 'taps' };
    const rangeTag = { section: 'range' };
    const unitTag = { section: 'unit' };
    if (!taps.length) fail(tapsTag, 'Add at least one tap.');
    if (taps.length > MAX_TAPS) fail(tapsTag, 'Use at most ' + MAX_TAPS + ' taps.');
    taps.forEach((tap, i) => {
      if (!(tap.vRef > 0 && tap.vTrip > tap.vRef && Number.isFinite(tap.vTrip))) {
        fail(tapsTag, 'Tap ' + (i + 1) + ': the reference voltage must be greater than 0 and lower than the target voltage.');
      }
    });
    const ratios = taps.map(tap => tap.vRef / tap.vTrip);
    if (!errors.length) {
      for (let i = 0; i < taps.length; i++) {
        for (let j = i + 1; j < taps.length; j++) {
          if (Math.abs(ratios[i] - ratios[j]) <= 1e-9 * ratios[i]) {
            fail(tapsTag, 'Taps ' + (i + 1) + ' and ' + (j + 1) + ' need the same division ratio. Remove one of them.');
          }
        }
      }
    }
    if (!(unit > 0 && Number.isFinite(unit))) fail(unitTag, 'The unit resistor must be greater than 0.');
    if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 100) fail(unitTag, 'Max units in parallel must be an integer from 1 to 100.');
    if (!(tolerance >= 0 && tolerance < 1)) fail(unitTag, 'The ratio tolerance must be from 0 to 100%.');
    const min = Number(constraint.min), max = Number(constraint.max);
    if (!(min > 0 && max > 0 && Number.isFinite(max))) fail(rangeTag, 'Range limits must be greater than 0.');
    else if (min > max) fail(rangeTag, 'The range minimum must not exceed the maximum.');
    const byCurrent = constraint.mode === 'current';
    const useVin = byCurrent || constraint.vMin !== undefined || constraint.vMax !== undefined;
    const vMin = useVin ? Number(constraint.vMin) : Math.min(...taps.map(tap => tap.vTrip));
    const vMax = useVin ? Number(constraint.vMax) : Math.max(...taps.map(tap => tap.vTrip));
    if (useVin) {
      if (!(vMin > 0 && vMax > 0 && Number.isFinite(vMax))) fail(rangeTag, 'VIN operating voltages must be greater than 0.');
      else if (vMin > vMax) fail(rangeTag, 'Minimum VIN must not exceed maximum VIN.');
    }
    if (errors.length) return { errors, errorTags, warnings, warningTags, solutions: [] };

    const rMin = byCurrent ? vMax / max : min;
    const rMax = byCurrent ? vMin / min : max;
    const tMin = rMin / unit, tMax = rMax / unit;
    const base = { errors, errorTags, warnings, warningTags, solutions: [], vMin, vMax, rMin, rMax, tMin, tMax, maxParallel, topology };
    if (rMin > rMax * (1 + EPS)) {
      fail({ section: 'range', cause: 'current-conflict' }, 'No total resistance satisfies the current limits over this VIN range. Lower the minimum current, raise the maximum current, or narrow the voltage range.');
      return base;
    }
    if (tMin > MAX_UNITS) {
      fail(unitTag, 'The minimum total resistance needs more than ' + MAX_UNITS + ' unit resistors. Use a larger unit resistor or a lower resistance.');
      return base;
    }
    if (tMax > MAX_UNITS) {
      warnings.push('The search stops at a total of ' + MAX_UNITS + ' Ru; higher total resistances were not explored.');
      warningTags.push(unitTag);
    }

    const order = taps.map((_, i) => i).sort((a, b) => ratios[b] - ratios[a]);
    const context = { taps, order, ratios, unit, vMin, vMax, maxParallel };
    const pool = [];
    const bestErrorAtCost = new Float64Array(MAX_UNITS + 1).fill(Infinity);
    let exactUnits = Infinity;
    // The hybrid topology has a much larger discrete space; cap the explored
    // unit count once a solution is known and trim the grid list.
    let unitCeiling = MAX_UNITS;
    const grids = searchGrids(maxParallel);
    const activeGrids = topology === 'taps' ? grids : grids.slice(0, 24);
    for (const L of activeGrids) {
      const gLo = Math.max(1, Math.ceil(tMin * L - 1e-9));
      const gHi = Math.floor(Math.min(tMax, MAX_UNITS, exactUnits) * L + 1e-9);
      if (gLo > gHi) continue;
      const table = segmentTable(L, maxParallel, gHi);
      for (const G of totalCandidates(gLo, gHi, L !== grids[0])) {
        const T = G / L;
        if (T >= exactUnits || T > unitCeiling) break;
        const bestErrBelow = bestErrorAtCost[Math.floor(T + EPS)];
        let bound = 0;
        for (const index of order) {
          const x = ratios[index] * G, f = Math.max(1, Math.floor(x)), c = Math.min(G - 1, Math.ceil(x));
          let stageBound = Math.min(Math.abs(x / f - 1), Math.abs(x / c - 1));
          if (topology !== 'taps') stageBound = Math.min(stageBound, minApproxError(ratios[index], G - 1) * 0.5);
          bound = Math.max(bound, stageBound);
          if (bound >= bestErrBelow - EPS) break;
        }
        if (bound >= bestErrBelow - EPS) continue;
        const stages = order.map(index => {
          const list = candidates(ratios[index], G, L, tolerance);
          if (topology !== 'taps') list.push(...switchCandidates(ratios[index], G, tolerance, gLo));
          return list;
        });
        for (const mode of ['units', 'error']) {
          const found = optimise(stages, G, table.costs, mode, topology === 'hybrid');
          if (!found) continue;
          if (pool.some(s => s.units <= found.units && s.maxError <= found.err + EPS && s.switchCount <= found.switches)) continue;
          const built = buildSolution(found, G, L, table, context);
          if (topology !== 'taps') unitCeiling = Math.min(unitCeiling, Math.max(64, built.units * 4));
          if (pool.some(s => s.units <= built.units && s.maxError <= built.maxError + EPS && s.switchCount <= built.switchCount)) continue;
          pool.push(built);
          for (let cost = built.units; cost <= MAX_UNITS; cost++) {
            if (bestErrorAtCost[cost] <= built.maxError) break;
            bestErrorAtCost[cost] = built.maxError;
          }
          if (built.maxError <= EPS) exactUnits = Math.min(exactUnits, built.units);
        }
      }
    }
    if (!pool.length) {
      fail(unitTag, 'No realizable string fits this total resistance range. Use a smaller unit resistor or widen the range.');
      return base;
    }

    const entries = pool.sort((a, b) => a.units - b.units || a.switchCount - b.switchCount || a.maxError - b.maxError);
    const front = [];
    let bestErr = Infinity;
    entries.forEach(entry => {
      if (entry.maxError < bestErr - EPS) { front.push(entry); bestErr = entry.maxError; }
    });
    const feasible = front.filter(entry => entry.maxError <= tolerance + EPS);
    const withinTolerance = feasible.length > 0;
    base.solutions = withinTolerance ? spread(feasible, MAX_SOLUTIONS) : spread(front, MAX_SOLUTIONS);
    base.withinTolerance = withinTolerance;
    base.selected = withinTolerance ? 0 : base.solutions.length - 1;
    return base;
  }

  const api = { solve, formatValue, composition, MAX_UNITS, MAX_TAPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.ICDivider = api;
})();
