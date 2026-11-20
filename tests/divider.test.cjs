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

test('each solver error reports the input panel it belongs to', () => {
  const tags = input => {
    const r = solve(input);
    assert.ok(r.errors.length > 0);
    assert.equal(r.errorTags.length, r.errors.length);
    return r.errorTags.map(tag => tag.section);
  };
  assert.deepEqual(tags(base({ taps: [{ vTrip: 1, vRef: 1.2 }] })), ['taps']);
  assert.deepEqual(tags(base({ taps: [{ vTrip: 5, vRef: 0 }] })), ['taps']);
  assert.deepEqual(tags(base({ taps: [{ vTrip: 5, vRef: 1 }, { vTrip: 2.5, vRef: 0.5 }] })), ['taps']);
  assert.deepEqual(tags(base({ constraint: { mode: 'current', min: 3e-6, max: 2e-6, vMin: 5, vMax: 5 } })), ['range']);
  assert.deepEqual(tags(base({ constraint: { mode: 'current', min: 1e-6, max: 2e-6, vMin: 6, vMax: 3.2 } })), ['range']);
  assert.deepEqual(tags(base({ maxParallel: 0 })), ['unit']);
  assert.deepEqual(tags(base({ unit: 1 })), ['unit']);
  assert.deepEqual(tags(base({ unit: 1e7 })), ['unit']);
  const conflict = solve(base({ constraint: { mode: 'current', min: 2e-6, max: 2e-6, vMin: 3.2, vMax: 6 } }));
  assert.deepEqual(conflict.errorTags, [{ section: 'range', cause: 'current-conflict' }]);
  const capped = solve(base({ unit: 2e3 }));
  assert.equal(capped.warnings.length, 1);
  assert.deepEqual(capped.warningTags, [{ section: 'unit' }]);
  const ok = solve(base());
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.errorTags, []);
  assert.deepEqual(ok.warningTags, []);
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

test('resistance mode reports string current over the given VIN range', () => {
  const input = base({ constraint: { mode: 'resistance', min: 1.2e6, max: 32e6, vMin: 3.2, vMax: 6 }, maxParallel: 20 });
  const r = solve(input);
  assert.deepEqual(r.errors, []);
  assert.equal(r.vMin, 3.2);
  assert.equal(r.vMax, 6);
  const s = r.solutions[r.selected];
  assert.ok(Math.abs(s.currentMin - 3.2 / s.totalR) < 1e-15);
  assert.ok(Math.abs(s.current - 6 / s.totalR) < 1e-15);
  assert.match(solve(base({ constraint: { mode: 'resistance', min: 1e6, max: 2e6, vMin: 6, vMax: 3.2 } })).errors[0], /Minimum VIN/);
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
    const rails = svg.match(/<g data-parallel="100">[\s\S]*?<\/g>/)[0];
    const junctionXs = Array.from(rails.matchAll(/<circle cx="(-?\d+(?:\.\d+)?)"[^>]*r="2\.6"/g), match => Number(match[1]));
    assert.deepEqual([...new Set(junctionXs)].sort((a, b) => a - b), [166, 176],
      'outer rail ends are corners; only inner branches and the centre feed are three-way junctions');
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
    const braces = Array.from(svg.matchAll(/<path[^>]*data-brace="([^"]+)"[^>]*>/g));
    assert.deepEqual(braces.map(match => match[1]), s.segments.map(segment => segment.name),
      'every segment gets one brace');
    for (const [element] of braces) {
      const coordinates = element.match(/ d="([^"]+)"/)[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
      for (let i = 0; i < coordinates.length; i += 2) {
        assert.ok(coordinates[i] < 176, 'brace stays left of the string');
        assert.ok(coordinates[i] >= 0 && coordinates[i] <= width);
        assert.ok(coordinates[i + 1] >= 0 && coordinates[i + 1] <= height);
      }
    }
    for (const [, name] of svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g)) {
      assert.ok(['svg', 'desc', 'rect', 'g', 'path', 'polyline', 'circle', 'text', 'tspan'].includes(name), name);
    }
  }
  assert.throws(() => render(null));
});

const example = (topology) => ({
  taps: [{ vTrip: 1, vRef: 0.3 }, { vTrip: 1, vRef: 0.24 }],
  constraint: { mode: 'resistance', min: 1.2e6, max: 6e6 },
  unit: 1e5, maxParallel: 1, tolerance: 0.001, topology
});

function checkStates(result) {
  for (const s of result.solutions) {
    assert.equal(s.units, s.segments.reduce((total, g) => total + g.units, 0));
    const sum = s.segments.reduce((total, g) => total + g.value, 0);
    assert.ok(Math.abs(sum - s.totalUnits) < 1e-9);
    for (const [name, resistance] of [['string', s.totalR], ...s.switches.map(sw => [sw.name, sw.effectiveR])]) {
      assert.ok(resistance >= result.rMin * (1 - 1e-9), name + ' resistance at least rMin');
      assert.ok(resistance <= result.rMax * (1 + 1e-9), name + ' resistance at most rMax');
    }
    s.taps.forEach(tap => {
      assert.ok(Math.abs(tap.tripActual - tap.vRef / tap.achieved) < 1e-9);
      const stateR = tap.switch ? tap.switch.effectiveR : s.totalR;
      assert.ok(Math.abs(tap.currentAtTrip - tap.tripActual / stateR) < 1e-12);
      assert.ok(Math.abs(tap.error) <= s.maxError + 1e-15);
      if (tap.switch) {
        const sw = tap.switch;
        assert.equal(sw.to, tap.node);
        assert.equal(sw.effectiveGrid, s.totalUnits * s.grid - sw.bypassGrid);
        assert.ok(Math.abs(sw.effectiveR - sw.effectiveGrid / s.grid * s.unit) < 1e-6 * sw.effectiveR);
        assert.ok(sw.gridFrom < sw.gridTo);
        assert.ok(sw.bypassGrid > 0);
        assert.ok(Math.abs(sw.bypassValue + sw.effectiveValue - s.totalUnits) < 1e-9);
        const bypassed = s.segments.filter(g => g.bypass && g.bypass.includes(sw.name));
        assert.deepEqual(sw.segments, bypassed.map(g => g.name));
        assert.ok(Math.abs(bypassed.reduce((total, g) => total + g.value, 0) - sw.bypassValue) < 1e-9);
      }
    });
  }
}

const switchedExample = {
  taps: [{ vTrip: 1, vRef: 0.149 }, { vTrip: 1, vRef: 0.35 }, { vTrip: 1, vRef: 0.584 }],
  constraint: { mode: 'resistance', min: 1.2e6, max: 6e6 },
  unit: 1e5, maxParallel: 4, tolerance: 0.001, topology: 'hybrid'
};

test('two topologies trade unit resistors for switches', () => {
  const taps = solve(example('taps')).solutions[0];
  const hybrid = solve(example('hybrid')).solutions[0];
  assert.equal(taps.units, 50);
  assert.equal(taps.switchCount, 0);
  assert.equal(hybrid.units, 25);
  assert.equal(hybrid.switchCount, 1);
  assert.equal(hybrid.maxError, 0);
  assert.ok(hybrid.units < taps.units);
});

test('hybrid switch sits below its tap and shorts the block to the lower tap', () => {
  const input = example('hybrid');
  const r = solve(input);
  const s = r.solutions[0];
  const upper = s.taps[0], lower = s.taps[1];
  assert.ok(upper.switch);
  assert.equal(upper.switch.name, 'SW1');
  assert.equal(upper.switch.gridTo, upper.switch.gridFrom + upper.switch.bypassGrid);
  assert.equal(upper.switch.from, lower.node);
  assert.equal(upper.switch.effectiveGrid, s.totalUnits * s.grid - upper.switch.bypassGrid);
  assert.ok(Math.abs(upper.switch.effectiveGrid - 20) < 1e-12);
  assert.equal(upper.switch.bypassGrid, 5);
  assert.equal(upper.achieved, 0.3);
  assert.equal(lower.achieved, 0.24);
  assert.equal(upper.switch.to, upper.node);
  assert.equal(upper.switch.gridTo, 11);
  assert.equal(upper.switch.gridFrom, 6);
  assert.equal(upper.switch.fromValue, 6);
  assert.equal(upper.switch.toValue, 11);
  assert.deepEqual(s.switches.map(sw => sw.segments), [['R2']]);
  assert.deepEqual(s.segments[1].bypass, ['SW1']);
  checkStates(r);
});

test('hybrid leaves exactly one tap plain and switches the rest', () => {
  const r = solve(switchedExample);
  const s = r.solutions[0];
  assert.equal(s.taps.filter(tap => !tap.switch).length, 1);
  assert.equal(s.taps.filter(tap => tap.switch).length, 2);
  assert.equal(s.switchCount, s.taps.length - 1);
  assert.ok(s.switches.every(sw => sw.to !== 'VIN'));
  assert.ok(s.switches.every(sw => sw.gridTo < s.totalUnits * s.grid));
  checkStates(r);
  const twoTaps = solve(example('hybrid')).solutions[0];
  assert.equal(twoTaps.taps.filter(tap => !tap.switch).length, 1);
  assert.equal(twoTaps.switchCount, 1);
});

test('switch states stay inside the resistance range at every position', () => {
  const input = {
    taps: [{ vTrip: 5, vRef: 1.2 }, { vTrip: 4, vRef: 1.2 }, { vTrip: 10, vRef: 1.2 }],
    constraint: { mode: 'current', min: 0.1e-6, max: 5e-6, vMin: 3.2, vMax: 12 },
    unit: 1e6, maxParallel: 20, tolerance: 0.01
  };
  for (const topology of ['taps', 'hybrid']) {
    const r = solve({ ...input, topology });
    assert.deepEqual(r.errors, []);
    assert.equal(r.topology, topology);
    assert.equal(r.withinTolerance, true);
    for (const s of r.solutions) {
      assert.ok(s.totalRMin >= r.rMin * (1 - 1e-9));
      assert.ok(s.totalRMax <= r.rMax * (1 + 1e-9));
      assert.ok(s.totalRMin <= s.totalRMax);
    }
    checkStates(r);
  }
  const hybrid = solve({ ...input, topology: 'hybrid' }).solutions[0];
  assert.equal(hybrid.taps.filter(tap => !tap.switch).length, 1);
  assert.equal(hybrid.switchCount, hybrid.taps.length - 1);
});

test('solutions are ordered by units then by switch count', () => {
  const r = solve({
    taps: Array.from({ length: 5 }, (_, i) => ({ vTrip: 2 + i * 0.37, vRef: 1.2345 })),
    constraint: { mode: 'resistance', min: 1e4, max: 1e8 }, unit: 1e3, maxParallel: 10, tolerance: 0.002, topology: 'hybrid'
  });
  assert.ok(r.solutions.length > 1);
  for (let i = 1; i < r.solutions.length; i++) {
    const a = r.solutions[i - 1], b = r.solutions[i];
    assert.ok(a.units < b.units || (a.units === b.units && a.switchCount <= b.switchCount));
  }
});

test('invalid topologies fall back to plain taps', () => {
  for (const topology of ['unknown', 'switch']) {
    const plain = solve(base({ topology }));
    assert.equal(plain.topology, 'taps');
    assert.deepEqual(plain.errors, []);
  }
});

test('hybrid searches stay interactive', () => {
  const input = {
    taps: Array.from({ length: 8 }, (_, i) => ({ vTrip: 2 + i * 0.37, vRef: 1.2345 })),
    constraint: { mode: 'resistance', min: 1e3, max: 1e9 }, unit: 1e3, maxParallel: 20, tolerance: 0.001
  };
  const started = Date.now();
  const r = solve({ ...input, topology: 'hybrid' });
  assert.ok(r.solutions.length > 0);
  assert.ok(Date.now() - started < 3000, 'hybrid search must finish within three seconds');
});

test('one-hot select codes cover switches and taps', () => {
  const twoSwitches = solve(switchedExample).solutions[0];
  assert.equal(twoSwitches.selectWidth, twoSwitches.switchCount);
  assert.equal(twoSwitches.selectBus, 'SEL<2:1>');
  assert.deepEqual(twoSwitches.switches.map(sw => sw.selectSignal), ['SEL<2>', 'SEL<1>']);
  assert.deepEqual(twoSwitches.switches.map(sw => sw.name), ['SW2', 'SW1'], 'the topmost switch takes the highest bit');
  assert.deepEqual(twoSwitches.switches.map(sw => sw.selectCode), ['10', '01']);
  for (const sw of twoSwitches.switches) assert.equal(sw.selectCode.split('1').length - 1, 1);
  assert.equal(new Set(twoSwitches.switches.map(sw => sw.selectCode)).size, 2);
  twoSwitches.taps.forEach(tap => assert.equal(tap.selectCode, tap.switch ? tap.switch.selectCode : '0'.repeat(2)));

  const hybrid = solve(example('hybrid')).solutions[0];
  assert.equal(hybrid.selectBus, 'SEL');
  assert.equal(hybrid.switches[0].selectCode, '1');
  assert.equal(hybrid.switches[0].selectSignal, 'SEL');
  hybrid.taps.forEach(tap => assert.equal(tap.selectCode, tap.switch ? '1' : '0'));

  const plain = solve(example('taps')).solutions[0];
  assert.equal(plain.selectWidth, 0);
  assert.equal(plain.selectBus, null);
  plain.taps.forEach(tap => assert.equal(tap.selectCode, null));
});

test('tap names are editable, default numbered and kept unique', () => {
  const input = {
    taps: [{ name: '  VREF_HI ', vTrip: 5, vRef: 1.2 }, { name: 'VREF_LO', vTrip: 4, vRef: 1.2 }],
    constraint: { mode: 'current', min: 0.1e-6, max: 5e-6, vMin: 3.2, vMax: 12 },
    unit: 1e6, maxParallel: 20, tolerance: 0.01
  };
  const named = solve(input);
  assert.deepEqual(named.errors, []);
  const s = named.solutions[0];
  assert.deepEqual(s.taps.map(tap => tap.name), ['VREF_HI', 'VREF_LO']);
  assert.deepEqual(s.segments.map(segment => [segment.top, segment.bottom]), [['VIN', 'VREF_LO'], ['VREF_LO', 'VREF_HI'], ['VREF_HI', 'GND']]);
  const svg = render(s, true, formatValue).svg;
  assert.ok(svg.includes('>VREF_HI<'));
  assert.ok(svg.includes('>VREF_LO<'));
  assert.ok(!svg.includes('TAP1'), 'custom names replace the defaults');

  const defaults = solve(base()).solutions[0];
  assert.deepEqual(defaults.taps.map(tap => tap.name), ['TAP1', 'TAP2']);

  const duplicates = solve({ ...input, taps: [{ name: 'A', vTrip: 5, vRef: 1.2 }, { name: 'A', vTrip: 4, vRef: 1.2 }] }).solutions[0];
  assert.deepEqual(duplicates.taps.map(tap => tap.name), ['A', 'A 2'], 'duplicate names get a suffix');

  const reserved = solve({ ...input, taps: [{ name: 'VIN', vTrip: 5, vRef: 1.2 }, { name: '  ', vTrip: 4, vRef: 1.2 }] }).solutions[0];
  assert.deepEqual(reserved.taps.map(tap => tap.name), ['VIN 2', 'TAP2'], 'reserved node names and blanks fall back');

  const hybrid = solve({ ...input, topology: 'hybrid' }).solutions[0];
  for (const sw of hybrid.switches) {
    assert.ok(['VREF_HI', 'VREF_LO'].includes(sw.to) || ['VREF_HI', 'VREF_LO'].includes(sw.from), 'switch terminals use the custom names');
  }
});

test('schematic marks bypass switches, shorted segments and switch taps', () => {
  const twoSwitches = solve(switchedExample).solutions[0];
  const hybrid = solve(example('hybrid')).solutions[0];
  const plain = solve(example('taps')).solutions[0];
  const allowed = ['svg', 'desc', 'rect', 'g', 'path', 'polyline', 'circle', 'text', 'tspan'];

  for (const [solution, switches] of [[twoSwitches, 2], [hybrid, 1], [plain, 0]]) {
    for (const forDownload of [false, true]) {
      const { svg, width, height } = render(solution, forDownload, formatValue);
      assert.match(svg, /^<svg\s[\s\S]*<\/svg>$/);
      assert.ok(svg.includes(`viewBox="0 0 ${width} ${height}"`));
      assert.doesNotMatch(svg, /\b(?:NaN|Infinity|undefined)\b/);
      assert.equal((svg.match(/data-switch=/g) || []).length, switches);
      assert.equal((svg.match(/data-bypass=/g) || []).length, switches);
      // A <title> would make the browser float an opaque native tooltip over the
      // labels while the pointer is on a wire; the root aria-label and <desc> carry
      // the same wording for assistive tech without covering the drawing.
      assert.ok(!svg.includes('<title'), 'no element may trigger a native tooltip');
      for (const [, name] of svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g)) assert.ok(allowed.includes(name), name);
    }
  }

  const switchSvg = render(twoSwitches, true, formatValue).svg;
  assert.ok(switchSvg.includes('· 2 bypass switches'));
  assert.equal((switchSvg.match(/data-tap=/g) || []).length, 3, 'only real taps draw a stub');
  assert.ok(!switchSvg.includes('data-tap="N1"'), 'internal switch nodes are not tap stubs');
  assert.ok(switchSvg.includes('data-switch="SW1"'));
  assert.ok(switchSvg.includes('data-switch="SW2"'));
  assert.ok(switchSvg.includes('shorted by SW1'));
  assert.ok(switchSvg.includes('SEL&lt;2:1&gt; = 01'));
  assert.ok(switchSvg.includes('SEL&lt;2:1&gt; = 10'));
  assert.ok(switchSvg.includes('SEL&lt;2:1&gt; = 00'), 'the plain tap shows the all-zero code');
  assert.ok(!switchSvg.includes('SW1 · '), 'tap labels no longer name the switch');
  assert.ok(!switchSvg.includes('SW2 · '), 'tap labels no longer name the switch');
  assert.ok(switchSvg.includes('>SEL&lt;1&gt;<'), 'SW1 shows its single-bit control');
  assert.ok(switchSvg.includes('>SEL&lt;2&gt;<'), 'SW2 shows its single-bit control');
  assert.ok(switchSvg.includes('Each switch is driven by its own single select bit'));
  assert.ok(switchSvg.includes('closes when that bit is 1'), 'the description keeps the select-bit polarity');
  assert.ok(!switchSvg.includes('equals the code to its right'));

  const hybridSvg = render(hybrid, true, formatValue).svg;
  assert.ok(hybridSvg.includes('· 1 bypass switch"'));
  assert.ok(hybridSvg.includes('data-switch="SW1"'));
  assert.ok(hybridSvg.includes('shorted by SW1'));
  assert.ok(hybridSvg.includes('SEL = 1'));
  assert.ok(!hybridSvg.includes('SW1 · '), 'tap labels no longer name the switch');
  assert.ok(hybridSvg.includes('SEL = 0'), 'plain hybrid taps show the all-zero code');

  const plainSvg = render(plain, true, formatValue).svg;
  assert.ok(!plainSvg.includes('bypass'));
  assert.ok(!plainSvg.includes('SEL'));
});

test('hover nets link tap wires to their switch terminal and select labels to the switch', () => {
  const solution = solve(switchedExample).solutions[0];
  const { svg } = render(solution, false, formatValue);
  for (const sw of solution.switches) {
    const net = 'SW:' + sw.name;
    const group = svg.match(new RegExp('<g data-switch="' + sw.name + '"[\\s\\S]*?</g>'))[0];
    assert.ok(group.includes('data-net="' + net + '"'), 'the switch symbol answers to its select net');
    assert.equal((group.match(new RegExp('<circle[^>]*data-net="' + net + '"', 'g')) || []).length, 2,
      'both switch terminals share the select net');
    assert.match(group, /<polyline[^>]*stroke="#e2e8f0"[^>]*stroke-width="1.4"[^>]*data-net="SW:/,
      'the blade itself shares the select net');
    const nodeNets = Array.from(group.matchAll(/<polyline[^>]*data-net="(N\d+)"/g), match => match[1]);
    assert.equal(nodeNets.length, 4, 'lane wires belong to the node nets on both sides of the switch');
    assert.equal(new Set(nodeNets).size, 2, 'lane wires do not answer to the select net');
    const junction = Array.from(group.matchAll(/<circle\b([^>]*)>/g), match => match[1])
      .some(attrs => /r="2\.6"/.test(attrs) && /data-net="N\d+"/.test(attrs) && !/cx="176"/.test(attrs));
    assert.ok(junction, 'a solid dot marks the tap row where the lane drops off');
    const tap = solution.taps.find(item => item.switch && item.switch.name === sw.name);
    if (tap) {
      const stub = svg.match(new RegExp('<g data-tap="' + tap.node + '">[\\s\\S]*?</g>'))[0];
      const stubNet = stub.match(/data-net="(N\d+)"/)[1];
      assert.ok(nodeNets.includes(stubNet), 'hovering the tap wire also lights its switch lane segment');
    }
  }
});

