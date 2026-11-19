'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { solve, formatValue, composition } = require('../assets/js/divider-core.js');
const { render } = require('../assets/js/divider-schematic.js');

const base = (extra = {}) => ({
  taps: [{ vTrip: 5, vRef: 1.2 }, { vTrip: 4, vRef: 1.2 }],
  constraint: { mode: 'current', min: 1e-6, max: 2e-6, vMin: 5, vMax: 5 },
  unit: 1e5, maxParallel: 2, tolerance: 0.001, ...extra
});

function checkConsistency(result, input) {
  for (const s of result.solutions) {
    const sum = s.segments.reduce((total, g) => total + g.value, 0);
    assert.ok(Math.abs(sum - s.totalUnits) < 1e-9, 'segments add up to the total');
    assert.equal(s.units, s.segments.reduce((total, g) => total + g.units, 0));
    assert.ok(s.totalR >= result.rMin * (1 - 1e-9) && s.totalR <= result.rMax * (1 + 1e-9), 'total within range');
    for (const g of s.segments) {
      assert.ok(g.value > 0);
      const value = g.groups.reduce((sum, group) => sum + group.count / group.parallel, g.n);
      const units = g.groups.reduce((sum, group) => sum + group.count * group.parallel, g.n);
      assert.ok(g.groups.every(group => Number.isInteger(group.count) && group.count > 0 && group.parallel <= result.maxParallel));
      assert.ok(Math.abs(g.value - value) < 1e-9);
      assert.equal(g.units, units);
      assert.ok(Number.isInteger(g.n) && g.n >= 0);
    }
    s.taps.forEach((tap, i) => {
      assert.equal(tap.vRef, input.taps[i].vRef);
      const below = s.segments.slice(s.segments.findIndex(g => g.top === tap.name)).reduce((t, g) => t + g.value, 0);
      assert.ok(Math.abs(below / s.totalUnits - tap.achieved) < 1e-12, 'tap ratio matches the string');
      assert.ok(Math.abs(tap.tripActual - tap.vRef / tap.achieved) < 1e-9);
      assert.ok(Math.abs(tap.currentAtTrip - tap.tripActual / s.totalR) < 1e-12);
      assert.ok(Math.abs(tap.error) <= s.maxError + 1e-15);
    });
  }
}

test('default case is exact with a half-unit parallel pair', () => {
  const input = base();
  const r = solve(input);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rMin, 2.5e6);
  assert.equal(r.rMax, 5e6);
  assert.equal(r.withinTolerance, true);
  const s = r.solutions[r.selected];
  assert.equal(s.units, 28);
  assert.equal(s.totalR, 2.5e6);
  assert.equal(s.maxError, 0);
  assert.deepEqual(s.segments.map(g => g.composition), ['17 Ru + Ru/2', 'Ru + Ru/2', '6 Ru']);
  assert.deepEqual(s.segments.map(g => [g.top, g.bottom]), [['VIN', 'TAP2'], ['TAP2', 'TAP1'], ['TAP1', 'GND']]);
  assert.equal(s.taps[0].num + '/' + s.taps[0].den, '6/25');
  checkConsistency(r, input);
});

test('series-only search uses integer unit counts', () => {
  const input = base({ maxParallel: 1 });
  const r = solve(input);
  const s = r.solutions[r.selected];
  assert.equal(s.units, 50);
  assert.ok(s.segments.every(g => g.groups.length === 0));
  checkConsistency(r, input);
});

test('resistance mode and solution front ordering', () => {
  const input = base({
    taps: [{ vTrip: 5, vRef: 1.23 }, { vTrip: 3.3, vRef: 1.23 }, { vTrip: 2.7, vRef: 1.23 }],
    constraint: { mode: 'resistance', min: 1e6, max: 2e6 }, unit: 1e4, maxParallel: 4, tolerance: 0.0005
  });
  const r = solve(input);
  assert.equal(r.rMin, 1e6);
  assert.ok(r.solutions.length > 1 && r.solutions.length <= 8);
  for (let i = 1; i < r.solutions.length; i++) {
    assert.ok(r.solutions[i].units > r.solutions[i - 1].units);
    assert.ok(r.solutions[i].maxError < r.solutions[i - 1].maxError);
  }
  assert.ok(r.solutions.every(s => s.maxError <= 0.0005));
  checkConsistency(r, input);
});

test('infeasible tolerance falls back to the most accurate solution', () => {
  const input = base({ taps: [{ vTrip: 5, vRef: 1.2345 }], constraint: { mode: 'resistance', min: 1e5, max: 3e5 }, tolerance: 0 });
  const r = solve(input);
  assert.equal(r.withinTolerance, false);
  assert.equal(r.selected, r.solutions.length - 1);
  assert.ok(r.solutions[r.selected].maxError > 0);
  checkConsistency(r, input);
});

test('mixed parallel groups realize an exact fractional segment', () => {
  const input = base({ taps: [{ vTrip: 7, vRef: 2 }], constraint: { mode: 'resistance', min: 7, max: 7 }, unit: 6, maxParallel: 3, tolerance: 0 });
  const r = solve(input);
  assert.deepEqual(r.errors, []);
  assert.equal(r.withinTolerance, true);
  const s = r.solutions[r.selected];
  assert.equal(s.units, 8);
  assert.deepEqual(s.segments.map(g => g.composition), ['Ru/2 + Ru/3', 'Ru/3']);
  assert.equal(s.taps[0].tripActual, 7);
  checkConsistency(r, input);
  const { svg } = render(s, true, formatValue);
  assert.ok(svg.includes('data-segment="R1"'));
  assert.ok(svg.includes('k = 2/7'));
  assert.doesNotMatch(svg, /\b(?:NaN|Infinity|undefined)\b/);
  const resistorPaths = Array.from(svg.matchAll(/<polyline[^>]*points="([^"]+)"/g)).filter(match => match[1].split(' ').length === 10);
  assert.equal(resistorPaths.length, 8);
});

test('actual trip current uses the achieved trip voltage', () => {
  const input = base({ taps: [{ vTrip: 5, vRef: 1.2 }], constraint: { mode: 'resistance', min: 3000, max: 3000 }, unit: 1000, maxParallel: 1, tolerance: 0.3 });
  const r = solve(input);
  const s = r.solutions[r.selected];
  assert.ok(Math.abs(s.taps[0].tripActual - 3.6) < 1e-12);
  assert.ok(Math.abs(s.taps[0].currentAtTrip - 0.0012) < 1e-12);
  assert.ok(render(s, true, formatValue).svg.includes('1.2 V @ 3.6 V'));
  checkConsistency(r, input);
});

test('close taps can use nearby integer series positions within tolerance', () => {
  const input = base({ taps: [0.501, 0.502, 0.503, 0.504].map(vRef => ({ vTrip: 1, vRef })), constraint: { mode: 'resistance', min: 100, max: 100 }, unit: 1, maxParallel: 4, tolerance: 0.1 });
  const r = solve(input);
  assert.equal(r.solutions[r.selected].units, 100);
  assert.equal(r.withinTolerance, true);
  checkConsistency(r, input);
});

test('validation messages', () => {
  assert.match(solve(base({ taps: [{ vTrip: 1, vRef: 1.2 }] })).errors[0], /^Tap 1: /);
  assert.match(solve(base({ taps: [{ vTrip: 5, vRef: 1 }, { vTrip: 2.5, vRef: 0.5 }] })).errors[0], /^Taps 1 and 2 /);
  assert.match(solve(base({ constraint: { mode: 'current', min: 3e-6, max: 2e-6 } })).errors[0], /minimum must not exceed/);
  assert.match(solve(base({ unit: 1 })).errors[0], /more than 2000 unit resistors/);
  assert.match(solve(base({ unit: 1e7 })).errors[0], /No realizable string/);
  assert.equal(solve(base({ unit: 2e3 })).warnings.length, 1);
});

test('worst-case search stays fast', () => {
  const started = Date.now();
  const r = solve({
    taps: Array.from({ length: 8 }, (_, i) => ({ vTrip: 2 + i * 0.37, vRef: 1.2345 })),
    constraint: { mode: 'resistance', min: 1e3, max: 1e9 }, unit: 1e3, maxParallel: 4, tolerance: 0
  });
  assert.ok(r.solutions.length > 0);
  assert.ok(Date.now() - started < 2000);
});

test('current limits cover the entire default VIN operating range', () => {
  const input = base({ constraint: { mode: 'current', min: 1e-6, max: 2e-6, vMin: 3.2, vMax: 6 }, maxParallel: 20 });
  const r = solve(input);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rMin, 3e6);
  assert.ok(Math.abs(r.rMax - 3.2e6) < 1e-9);
  assert.equal(r.vMin, 3.2);
  assert.equal(r.vMax, 6);
  assert.equal(r.withinTolerance, true);
  for (const s of r.solutions) {
    assert.equal(s.currentMin, 3.2 / s.totalR);
    assert.equal(s.current, 6 / s.totalR);
    assert.equal(s.power, 36 / s.totalR);
    for (const voltage of [3.2, 4, 5, 6]) {
      const current = voltage / s.totalR;
      assert.ok(current >= input.constraint.min * (1 - 1e-12));
      assert.ok(current <= input.constraint.max * (1 + 1e-12));
    }
  }
  checkConsistency(r, input);
});

test('custom VIN voltages determine resistance independently of target voltages', () => {
  const input = base({ constraint: { mode: 'current', min: 1e-6, max: 4e-6, vMin: 8, vMax: 12 }, maxParallel: 20 });
  const r = solve(input);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rMin, 3e6);
  assert.equal(r.rMax, 8e6);
  assert.equal(r.vMax, 12);
  checkConsistency(r, input);
});

test('nonintersecting current constraints explain how to recover', () => {
  const r = solve(base({ constraint: { mode: 'current', min: 2e-6, max: 2e-6, vMin: 3.2, vMax: 6 } }));
  assert.match(r.errors[0], /No total resistance satisfies/);
  assert.equal(r.solutions.length, 0);
});

test('VIN operating range validation', () => {
  for (const [vMin, vMax] of [[0, 6], [-1, 6], [3.2, 0], [NaN, 6], [3.2, Infinity], [Infinity, Infinity]]) {
    const r = solve(base({ constraint: { mode: 'current', min: 1e-6, max: 2e-6, vMin, vMax } }));
    assert.match(r.errors[0], /VIN operating voltages/);
    assert.equal(r.solutions.length, 0);
  }
  assert.match(solve(base({ constraint: { mode: 'current', min: 1e-6, max: 2e-6, vMin: 6, vMax: 3.2 } })).errors[0], /Minimum VIN/);
});

test('parallel count requires an integer from one to one hundred', () => {
  for (const maxParallel of [0, -1, 1.5, 20.5, 101, NaN, Infinity]) {
    const r = solve(base({ maxParallel }));
    assert.match(r.errors[0], /integer from 1 to 100/);
    assert.equal(r.solutions.length, 0);
  }
  for (const maxParallel of [1, 20, 100]) assert.deepEqual(solve(base({ maxParallel })).errors, []);
});

test('twenty, ninety-seven and one hundred parallel units are actually realizable', () => {
  for (const p of [20, 97, 100]) {
    const input = base({ taps: [{ vTrip: p + 1, vRef: 1 }], constraint: { mode: 'resistance', min: 1 + 1 / p, max: 1 + 1 / p }, unit: 1, maxParallel: p, tolerance: 0 });
    const r = solve(input);
    assert.deepEqual(r.errors, []);
    assert.equal(r.withinTolerance, true);
    const s = r.solutions[r.selected];
    assert.equal(s.units, p + 1);
    assert.ok(s.maxError < 1e-12);
    assert.deepEqual(s.segments.map(g => g.composition), ['Ru', 'Ru/' + p]);
    checkConsistency(r, input);
  }
});

test('large parallel multi-tap searches stay interactive', () => {
  for (const [maxParallel, tolerance] of [[20, 0], [100, 0], [20, 0.001], [100, 0.001]]) {
    const input = base({ taps: Array.from({ length: 8 }, (_, i) => ({ vTrip: 2 + i * 0.37, vRef: 1.2345 })), constraint: { mode: 'resistance', min: 1e3, max: 1e9 }, unit: 1e3, maxParallel, tolerance });
    const started = Date.now();
    const r = solve(input);
    assert.deepEqual(r.errors, []);
    assert.ok(r.solutions.length > 0);
    assert.ok(Date.now() - started < 2000, 'wide range search must finish within two seconds');
    checkConsistency(r, input);
  }
});

test('one hundred parallel branches collapse without expanding the canvas', () => {
  const input = base({ taps: [{ vTrip: 101, vRef: 1 }], constraint: { mode: 'resistance', min: 1.01, max: 1.01 }, unit: 1, maxParallel: 100, tolerance: 0 });
  const s = solve(input).solutions[0];
  for (const forDownload of [false, true]) {
    const { svg, width, height } = render(s, forDownload, formatValue);
    assert.equal(width, 420);
    assert.ok(svg.includes('data-parallel="100"'));
    assert.ok(svg.includes('×100 parallel'));
    assert.ok(svg.includes('collapsed parallel branches'));
    assert.doesNotMatch(svg, /\b(?:NaN|Infinity|undefined)\b/);
    const paths = Array.from(svg.matchAll(/<polyline[^>]*points="([^"]+)"/g));
    assert.equal(paths.filter(match => match[1].split(' ').length === 10).length, 4);
    for (const path of paths) {
      for (const point of path[1].split(' ')) {
        const [x, y] = point.split(',').map(Number);
        assert.ok(x >= 0 && x <= width);
        assert.ok(y >= 0 && y <= height);
      }
    }
  }
});

test('formatting helpers', () => {
  assert.equal(formatValue(2.5e6, 'Ω'), '2.5 MΩ');
  assert.equal(formatValue(1.2, 'V'), '1.2 V');
  assert.equal(formatValue(1.7857e-6, 'A'), '1.786 µA');
  assert.equal(formatValue(999.96, 'Ω'), '1 kΩ');
  assert.equal(composition({ n: 1, groups: [{ count: 2, parallel: 3 }] }), 'Ru + 2·Ru/3');
  assert.equal(composition({ n: 0, groups: [{ count: 1, parallel: 4 }] }), 'Ru/4');
  assert.equal(composition({ n: 0, groups: [{ count: 1, parallel: 2 }, { count: 1, parallel: 3 }] }), 'Ru/2 + Ru/3');
});

test('schematic renders taps, segments and collapsed runs safely', () => {
  const s = solve(base()).solutions[0];
  for (const forDownload of [false, true]) {
    const { svg, width, height } = render(s, forDownload, formatValue);
    assert.match(svg, /^<svg\s[\s\S]*<\/svg>$/);
    assert.ok(svg.includes(`viewBox="0 0 ${width} ${height}"`));
    assert.ok(svg.includes(forDownload ? 'fill="#ffffff"' : 'fill="#0d1322"'));
    assert.doesNotMatch(svg, /\b(?:NaN|Infinity|undefined)\b/);
    assert.equal((svg.match(/data-segment=/g) || []).length, 3);
    assert.equal((svg.match(/data-tap=/g) || []).length, 2);
    assert.ok(svg.includes('×17'), 'long series run is collapsed');
    assert.ok(svg.includes('k = 6/25'));
    for (const [, name] of svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g)) {
      assert.ok(['svg', 'title', 'desc', 'rect', 'g', 'polyline', 'circle', 'text', 'tspan'].includes(name), name);
    }
  }
  assert.throws(() => render(null));
});
