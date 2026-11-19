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
      return { p, error, abs: Math.abs(error), inTol: Math.abs(error) <= tolerance + EPS, near: rank < NEAREST };
    }).filter(c => c.inTol || c.near || c.p % L === 0);
  }

  function better(mode, a, b) {
    if (!b) return true;
    if (mode === 'units') {
      if (a.units !== b.units) return a.units < b.units;
      return a.err < b.err - EPS;
    }
    if (Math.abs(a.err - b.err) > EPS) return a.err < b.err;
    return a.units < b.units;
  }

  // Taps are ordered top-down; state per stage is the chosen candidate position.
  function optimise(stages, G, costs, mode) {
    const allowed = stages.map(list => list.filter(c => mode !== 'units' || c.inTol));
    if (allowed.some(list => !list.length)) return null;
    let previous = allowed[0].map(c => {
      const cost = costs[G - c.p];
      return Number.isFinite(cost) ? { units: cost, err: c.abs, back: -1 } : null;
    });
    const history = [previous];
    for (let s = 1; s < allowed.length; s++) {
      const current = allowed[s].map(c => {
        let best = null;
        allowed[s - 1].forEach((pc, j) => {
          const state = previous[j];
          if (!state || pc.p <= c.p) return;
          const cost = costs[pc.p - c.p];
          if (!Number.isFinite(cost)) return;
          const next = { units: state.units + cost, err: Math.max(state.err, c.abs), back: j };
          if (better(mode, next, best)) best = next;
        });
        return best;
      });
      history.push(current);
      previous = current;
    }
    const last = allowed.length - 1;
    let best = null, bestIndex = -1;
    previous.forEach((state, j) => {
      if (!state) return;
      const cost = costs[allowed[last][j].p];
      if (!Number.isFinite(cost)) return;
      const total = { units: state.units + cost, err: state.err };
      if (better(mode, total, best)) { best = total; bestIndex = j; }
    });
    if (!best) return null;
    const positions = new Array(allowed.length);
    for (let s = last, j = bestIndex; s >= 0; s--) {
      positions[s] = allowed[s][j].p;
      j = history[s][j].back;
    }
    return { units: best.units, err: best.err, positions };
  }

  function buildSolution(found, G, L, table, context) {
    const { taps, order, ratios, unit, vMin, vMax, maxParallel } = context;
    const totalUnits = G / L;
    const totalR = totalUnits * unit;
    const byOriginal = new Array(taps.length);
    order.forEach((index, stage) => {
      const p = found.positions[stage];
      const g = gcd(p, G);
      const tripActual = taps[index].vRef * G / p;
      byOriginal[index] = {
        index, name: 'TAP' + (index + 1), vTrip: taps[index].vTrip, vRef: taps[index].vRef,
        ratio: ratios[index], achieved: p / G, num: p / g, den: G / g,
        tripActual, error: tripActual / taps[index].vTrip - 1,
        position: p / L, currentAtTrip: tripActual / totalR
      };
    });
    const nodes = ['VIN', ...order.map(index => 'TAP' + (index + 1)), 'GND'];
    const cuts = [G, ...found.positions, 0];
    const segments = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const d = cuts[i] - cuts[i + 1];
      const counts = new Array(maxParallel + 1).fill(0);
      for (let remaining = d; remaining > 0;) {
        const p = table.parallel[remaining];
        counts[p]++;
        remaining -= L / p;
      }
      const groups = counts.flatMap((count, parallel) => count && parallel > 1 ? [{ count, parallel }] : []);
      const segment = {
        name: 'R' + (i + 1), top: nodes[i], bottom: nodes[i + 1],
        n: counts[1], groups,
        value: d / L, resistance: d / L * unit,
        units: table.costs[d]
      };
      segment.composition = composition(segment);
      segments.push(segment);
    }
    return {
      key: G + ':' + found.positions.join(','),
      units: found.units, maxError: found.err, totalUnits, totalR,
      currentMin: vMin / totalR, current: vMax / totalR, power: vMax * vMax / totalR,
      taps: byOriginal, order: order.slice(), segments
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
    const taps = Array.isArray(input && input.taps) ? input.taps : [];
    const unit = Number(input && input.unit);
    const maxParallel = Number(input && input.maxParallel);
    const tolerance = Number(input && input.tolerance);
    const constraint = (input && input.constraint) || {};

    if (!taps.length) errors.push('Add at least one tap.');
    if (taps.length > MAX_TAPS) errors.push('Use at most ' + MAX_TAPS + ' taps.');
    taps.forEach((tap, i) => {
      if (!(tap.vRef > 0 && tap.vTrip > tap.vRef && Number.isFinite(tap.vTrip))) {
        errors.push('Tap ' + (i + 1) + ': the reference voltage must be greater than 0 and lower than the target voltage.');
      }
    });
    const ratios = taps.map(tap => tap.vRef / tap.vTrip);
    if (!errors.length) {
      for (let i = 0; i < taps.length; i++) {
        for (let j = i + 1; j < taps.length; j++) {
          if (Math.abs(ratios[i] - ratios[j]) <= 1e-9 * ratios[i]) {
            errors.push('Taps ' + (i + 1) + ' and ' + (j + 1) + ' need the same division ratio. Remove one of them.');
          }
        }
      }
    }
    if (!(unit > 0 && Number.isFinite(unit))) errors.push('The unit resistor must be greater than 0.');
    if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 100) errors.push('Max units in parallel must be an integer from 1 to 100.');
    if (!(tolerance >= 0 && tolerance < 1)) errors.push('The ratio tolerance must be from 0 to 100%.');
    const min = Number(constraint.min), max = Number(constraint.max);
    if (!(min > 0 && max > 0 && Number.isFinite(max))) errors.push('Range limits must be greater than 0.');
    else if (min > max) errors.push('The range minimum must not exceed the maximum.');
    const byCurrent = constraint.mode === 'current';
    const vMin = byCurrent ? Number(constraint.vMin) : Math.min(...taps.map(tap => tap.vTrip));
    const vMax = byCurrent ? Number(constraint.vMax) : Math.max(...taps.map(tap => tap.vTrip));
    if (byCurrent) {
      if (!(vMin > 0 && vMax > 0 && Number.isFinite(vMax))) errors.push('VIN operating voltages must be greater than 0.');
      else if (vMin > vMax) errors.push('Minimum VIN must not exceed maximum VIN.');
    }
    if (errors.length) return { errors, warnings, solutions: [] };

    const rMin = byCurrent ? vMax / max : min;
    const rMax = byCurrent ? vMin / min : max;
    const tMin = rMin / unit, tMax = rMax / unit;
    const base = { errors, warnings, solutions: [], vMin, vMax, rMin, rMax, tMin, tMax, maxParallel };
    if (rMin > rMax * (1 + EPS)) {
      errors.push('No total resistance satisfies the current limits over this VIN range. Lower the minimum current, raise the maximum current, or narrow the voltage range.');
      return base;
    }
    if (tMin > MAX_UNITS) {
      errors.push('The minimum total resistance needs more than ' + MAX_UNITS + ' unit resistors. Use a larger unit resistor or a lower resistance.');
      return base;
    }
    if (tMax > MAX_UNITS) warnings.push('The search stops at a total of ' + MAX_UNITS + ' Ru; higher total resistances were not explored.');

    const order = taps.map((_, i) => i).sort((a, b) => ratios[b] - ratios[a]);
    const context = { taps, order, ratios, unit, vMin, vMax, maxParallel };
    const pool = [];
    const bestErrorAtCost = new Float64Array(MAX_UNITS + 1).fill(Infinity);
    let exactUnits = Infinity;
    const grids = searchGrids(maxParallel);
    for (const L of grids) {
      const gLo = Math.max(1, Math.ceil(tMin * L - 1e-9));
      const gHi = Math.floor(Math.min(tMax, MAX_UNITS, exactUnits) * L + 1e-9);
      if (gLo > gHi) continue;
      const table = segmentTable(L, maxParallel, gHi);
      for (const G of totalCandidates(gLo, gHi, L !== grids[0])) {
        const T = G / L;
        if (T >= exactUnits) break;
        const bestErrBelow = bestErrorAtCost[Math.floor(T + EPS)];
        let bound = 0;
        for (const index of order) {
          const x = ratios[index] * G, f = Math.max(1, Math.floor(x)), c = Math.min(G - 1, Math.ceil(x));
          bound = Math.max(bound, Math.min(Math.abs(x / f - 1), Math.abs(x / c - 1)));
          if (bound >= bestErrBelow - EPS) break;
        }
        if (bound >= bestErrBelow - EPS) continue;
        const stages = order.map(index => candidates(ratios[index], G, L, tolerance));
        for (const mode of ['units', 'error']) {
          const found = optimise(stages, G, table.costs, mode);
          if (!found) continue;
          if (pool.some(s => s.units <= found.units && s.maxError <= found.err + EPS)) continue;
          pool.push(buildSolution(found, G, L, table, context));
          for (let cost = found.units; cost <= MAX_UNITS; cost++) {
            if (bestErrorAtCost[cost] <= found.err) break;
            bestErrorAtCost[cost] = found.err;
          }
          if (found.err <= EPS) exactUnits = Math.min(exactUnits, found.units);
        }
      }
    }
    if (!pool.length) {
      errors.push('No realizable string fits this total resistance range. Use a smaller unit resistor or widen the range.');
      return base;
    }

    const entries = pool.sort((a, b) => a.units - b.units || a.maxError - b.maxError);
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
