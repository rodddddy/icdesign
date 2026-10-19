'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const corePath = path.resolve(__dirname, '../assets/js/analog-core.js');
const analog = require(corePath);
const TAU = 2 * Math.PI;
const ids = ['cs', 'cg', 'cascode', 'follower', 'diff-five', 'diff-cg', 'diff-cascode', 'folded-cascode'];

function close(actual, expected, tolerance = 3e-10, message = '') {
  assert.ok(Number.isFinite(actual), message + ': finite actual value');
  assert.ok(Number.isFinite(expected), message + ': finite expected value');
  const error = Math.abs(actual - expected);
  assert.ok(error <= tolerance * Math.max(Math.abs(actual), Math.abs(expected), 1e-290), message + ': ' + actual + ' != ' + expected);
}

function defaults(config = {}, overrides = {}) {
  return Object.assign(Object.fromEntries(analog.describe(config).parameters.map(p => [p.key, p.default])), overrides);
}

function varied(config) {
  const all = { gm1: 0.0031, ro1: 72000, gm2: 0.0042, ro2: 131000, gm3: 0.0017, ro3: 93000, gm5: 0.0037, ro5: 152000, gm7: 0.0019, ro7: 116000, ro9: 203000, RL: 22500, roL: 184000, RS: 137, CL: 3.8e-12, CX: 0.7e-12, CF: 0.13e-12, CGS: 0.64e-12 };
  return Object.fromEntries(analog.describe(config).parameters.map(p => [p.key, all[p.key]]));
}

const z = (re, im = 0) => ({ re, im });
const add = (a, b) => z(a.re + b.re, a.im + b.im);
const sub = (a, b) => z(a.re - b.re, a.im - b.im);
const mul = (a, b) => z(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => z((a.re * b.re + a.im * b.im) / (b.re * b.re + b.im * b.im), (a.im * b.re - a.re * b.im) / (b.re * b.re + b.im * b.im));
const abs = a => Math.hypot(a.re, a.im);

function complexClose(actual, expected, message = '') {
  const error = abs(sub(actual, expected));
  assert.ok(error < 2e-9 * Math.max(abs(actual), abs(expected), 1e-290), message + ': complex KCL mismatch ' + JSON.stringify({ actual, expected }));
}

function transfer(result, omega) {
  return div(z(result.numerator[0], omega * result.numerator[1]), z(result.denominator[0] - omega * omega * result.denominator[2], omega * result.denominator[1]));
}

function solve2(matrix, drive) {
  const [[a, b], [c, d]] = matrix;
  const determinant = sub(mul(a, d), mul(b, c));
  return [div(sub(mul(d, drive[0]), mul(b, drive[1])), determinant), div(sub(mul(a, drive[1]), mul(c, drive[0])), determinant)];
}

function solveLinear(matrix, drive) {
  const rows = matrix.map((row, index) => [...row, drive[index]]);
  for (let col = 0; col < rows.length; col++) {
    let pivot = col;
    for (let row = col + 1; row < rows.length; row++) if (abs(rows[row][col]) > abs(rows[pivot][col])) pivot = row;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    rows[col] = rows[col].map(value => div(value, divisor));
    for (let row = 0; row < rows.length; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      rows[row] = rows[row].map((value, index) => sub(value, mul(factor, rows[col][index])));
    }
  }
  return rows.map(row => row.at(-1));
}

function reference(config, v, omega, outputTest = false) {
  const { type, sourceResistance, load } = analog.describe(config).config;
  const commonGate = type === 'cg' || type === 'diff-cg';
  const rs = sourceResistance ? v.RS : 0;
  const degeneration = commonGate || type === 'follower' ? 1 : 1 + (v.gm1 + 1 / v.ro1) * rs;
  const g = v.gm1 / degeneration;
  const go = (1 / v.ro1) / degeneration;
  let l = 1 / (load === 'active' ? v.roL : v.RL);
  if (type === 'cs') return div(outputTest ? z(1) : z(-g, omega * v.CF), z(go + l, omega * (v.CL + v.CF)));
  if (type === 'follower') return div(outputTest ? z(1) : z(v.gm1, omega * v.CGS), z(v.gm1 + 1 / v.ro1 + 1 / v.RL, omega * (v.CL + v.CGS)));
  if (commonGate && rs === 0) return div(z(outputTest ? 1 : v.gm1 + 1 / v.ro1), z(1 / v.ro1 + l, omega * v.CL));
  let matrix;
  let drive;
  if (type === 'diff-five') {
    const u = go / 2;
    const m = v.gm3;
    const mirror = 1 / v.ro3;
    matrix = [[z(u + m + mirror, omega * v.CX), z(-u)], [z(m - u), z(u + mirror, omega * v.CL)]];
    drive = [z(-g / 2), z(g / 2)];
  } else {
    let k;
    let o;
    let x;
    if (commonGate) {
      o = 1 / v.ro1;
      k = v.gm1 + o;
      x = 1 / rs + k;
      drive = [z(1 / rs), z(0)];
    } else {
      const suffix = type === 'cascode' ? '2' : type === 'diff-cascode' ? '3' : '5';
      o = 1 / v['ro' + suffix];
      k = v['gm' + suffix] + o;
      x = go + k;
      if (type === 'diff-cascode') l = 1 / (v.ro5 + v.ro7 + v.gm5 * v.ro5 * v.ro7);
      if (type === 'folded-cascode') {
        l = 1 / (v.ro7 + v.ro9 + v.gm7 * v.ro7 * v.ro9);
        x += 1 / v.ro3;
      }
      drive = [z(-g), z(0)];
    }
    matrix = [[z(x, omega * v.CX), z(-o)], [z(-k), z(o + l, omega * v.CL)]];
  }
  return solve2(matrix, outputTest ? [z(0), z(1)] : drive)[1];
}

function checkResult(result, config) {
  assert.deepEqual(Object.keys(result).sort(), ['denominator', 'metrics', 'numerator', 'poles', 'warnings', 'zeros']);
  assert.deepEqual(Object.keys(result.metrics).sort(), ['bandwidth', 'gain', 'gainDb', 'gbw', 'rout', 'unity']);
  assert.equal(result.numerator.length, 2);
  assert.equal(result.denominator.length, 3);
  assert.equal(result.denominator[0], 1);
  result.numerator.concat(result.denominator).forEach(value => assert.ok(Number.isFinite(value)));
  Object.entries(result.metrics).forEach(([key, value]) => assert.ok(Number.isFinite(value) || (value === null && ['bandwidth', 'unity'].includes(key)), config.type + ' finite metric ' + key));
  assert.ok(result.metrics.rout > 0);
  assert.ok(result.metrics.gbw > 0);
  result.poles.forEach(pole => {
    assert.ok(Number.isFinite(pole.re) && pole.re < 0);
    assert.ok(Number.isFinite(pole.im));
  });
  result.zeros.forEach(zero => assert.ok(Number.isFinite(zero.re) && Number.isFinite(zero.im)));
  assert.ok(result.warnings.every(warning => typeof warning === 'string'));
  assert.ok(result.warnings.some(warning => /uncancelled/.test(warning)));
}

function assertCrossing(result, key) {
  const frequency = result.metrics[key];
  if (frequency === null) return;
  const target = key === 'bandwidth' ? Math.abs(result.metrics.gain) / Math.SQRT2 : 1;
  close(abs(transfer(result, TAU * frequency)), target, 3e-8, key + ' exact magnitude');
  assert.ok(abs(transfer(result, TAU * frequency * (1 - 1e-5))) > target, key + ' enters from above');
  assert.ok(abs(transfer(result, TAU * frequency * (1 + 1e-5))) < target, key + ' exits below');
}

function numericalCrossing(result, target) {
  const rates = result.poles.map(abs).concat(result.zeros.map(abs));
  const low = Math.min(...rates) * 1e-7;
  const high = Math.max(...rates) * 1e7;
  let before = low;
  let previous = abs(transfer(result, before)) - target;
  for (let step = 1; step <= 3000; step++) {
    const current = Math.exp(Math.log(low) + step / 3000 * Math.log(high / low));
    const residual = abs(transfer(result, current)) - target;
    if (previous > 0 && residual <= 0) {
      let left = before;
      let right = current;
      for (let iteration = 0; iteration < 70; iteration++) {
        const mid = (left + right) / 2;
        if (abs(transfer(result, mid)) > target) left = mid;
        else right = mid;
      }
      return (left + right) / 2 / TAU;
    }
    before = current;
    previous = residual;
  }
  return null;
}

test('public catalog and dual global/CommonJS export', () => {
  assert.equal(globalThis.ICAnalog, analog);
  assert.deepEqual(Object.keys(analog).sort(), ['calculate', 'catalog', 'describe']);
  assert.deepEqual(analog.catalog.map(item => item.id), ids);
  assert.ok(Object.isFrozen(analog.catalog));
  analog.catalog.forEach(entry => {
    assert.deepEqual(Object.keys(entry).sort(), ['description', 'id', 'label', 'loadOption', 'sourceOption']);
    assert.ok(entry.label.length > 15 && entry.description.length > 20);
    assert.equal(entry.sourceOption, entry.id !== 'follower');
    assert.equal(entry.loadOption, ['cs', 'cg', 'cascode', 'diff-cg'].includes(entry.id));
  });
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(corePath, 'utf8'), sandbox, { timeout: 1000 });
  assert.equal(typeof sandbox.ICAnalog.calculate, 'function');
  close(sandbox.ICAnalog.calculate({}, defaults()).metrics.gain, analog.calculate({}, defaults()).metrics.gain);
});

test('default configuration, option normalization, and boundary validation', () => {
  assert.deepEqual(analog.describe().config, { type: 'cs', polarity: 'nmos', sourceResistance: false, load: 'resistor' });
  assert.deepEqual(analog.describe({ type: 'follower', polarity: 'pmos', sourceResistance: true, load: 'active' }).config, { type: 'follower', polarity: 'pmos', sourceResistance: false, load: 'resistor' });
  for (const type of ['diff-five', 'diff-cascode', 'folded-cascode']) assert.equal(analog.describe({ type, load: 'active' }).config.load, 'resistor');
  for (const config of [null, '', 4, [], false, { type: '' }, { type: 'unknown' }, { type: '__proto__' }, { type: null }, { polarity: 'NMOS' }, { polarity: '' }, { polarity: null }, { sourceResistance: 0 }, { sourceResistance: 'false' }, { sourceResistance: null }, { load: '' }, { load: 'ideal' }, { type: 'follower', load: 'bad' }, { type: 'follower', sourceResistance: 'true' }, { unsupported: true }]) {
    assert.throws(() => analog.describe(config), /Configuration|Unknown|Polarity|sourceResistance|Load/);
    assert.throws(() => analog.calculate(config, {}));
  }
});

test('fixed-load models warn only when a requested active-load option is overridden', () => {
  for (const type of ['follower', 'diff-five', 'diff-cascode', 'folded-cascode']) {
    const config = analog.describe({ type }).config;
    const values = defaults(config);
    assert.ok(!analog.calculate(config, values).warnings.some(warning => /selectable load option/.test(warning)));
    assert.ok(analog.calculate({ ...config, load: 'active' }, values).warnings.some(warning => /selectable load option/.test(warning)));
  }
});

test('parameter keys include only devices and capacitors relevant to each topology', () => {
  const expected = {
    cs: ['gm1', 'ro1', 'RL', 'CL', 'CF'],
    cg: ['gm1', 'ro1', 'RL', 'CL'],
    cascode: ['gm1', 'ro1', 'gm2', 'ro2', 'RL', 'CL', 'CX'],
    follower: ['gm1', 'ro1', 'RL', 'CL', 'CGS'],
    'diff-five': ['gm1', 'ro1', 'gm3', 'ro3', 'CL', 'CX'],
    'diff-cg': ['gm1', 'ro1', 'RL', 'CL'],
    'diff-cascode': ['gm1', 'ro1', 'gm3', 'ro3', 'gm5', 'ro5', 'ro7', 'CL', 'CX'],
    'folded-cascode': ['gm1', 'ro1', 'gm5', 'ro5', 'ro3', 'gm7', 'ro7', 'ro9', 'CL', 'CX']
  };
  for (const type of ids) {
    assert.deepEqual(analog.describe({ type }).parameters.map(p => p.key).sort(), expected[type].sort());
    const selected = analog.describe({ type, sourceResistance: true, load: 'active' }).parameters.map(p => p.key);
    assert.equal(selected.includes('RS'), type !== 'follower');
    assert.equal(selected.includes('CX'), !['cs', 'follower'].includes(type));
    assert.equal(selected.includes('roL'), ['cs', 'cg', 'cascode', 'diff-cg'].includes(type));
    assert.equal(selected.includes('RL'), type === 'follower');
  }
});

test('metadata uses base-SI defaults and display factors with explicit limitations', () => {
  for (const type of ids) {
    const description = analog.describe({ type, sourceResistance: true, load: 'active' });
    assert.match(description.title, /reduced-order model/);
    assert.match(description.title, /NMOS/);
    assert.ok(description.parameters.every(p => ['key', 'symbol', 'label', 'unit', 'scale', 'default', 'positive', 'group'].every(key => Object.hasOwn(p, key))));
    for (const p of description.parameters) {
      assert.ok(Number.isFinite(p.default) && p.default > 0);
      assert.ok(typeof p.symbol === 'string' && typeof p.label === 'string' && typeof p.group === 'string');
      if (p.key.startsWith('gm')) {
        assert.equal(p.scale, 1e-3);
        assert.equal(p.unit, 'mS');
        assert.equal(p.default, 2e-3);
      } else if (p.key.startsWith('C')) {
        assert.equal(p.scale, 1e-12);
        assert.equal(p.unit, 'pF');
        assert.equal(p.positive, p.key === 'CL');
      } else if (p.key === 'RS') {
        assert.equal(p.scale, 1);
        assert.equal(p.unit, 'Ω');
        assert.equal(p.positive, false);
      } else {
        assert.equal(p.scale, 1e3);
        assert.equal(p.unit, 'kΩ');
        assert.equal(p.positive, true);
      }
    }
    for (const key of ['gain', 'gainDb', 'rout', 'gbw', 'bandwidth', 'unity', 'poles', 'zeros', 'transfer']) assert.equal(description.formulas.filter(f => f.key === key).length, 1);
    description.formulas.forEach(f => {
      ['label', 'unit', 'note'].forEach(key => assert.equal(typeof f[key], 'string'));
      assert.ok(Array.isArray(f.math));
      assert.equal(typeof f.detail, 'boolean');
    });
    const text = description.assumptions.join(' ');
    for (const pattern of [/saturation/, /body effect/, /AC-grounded/, /ideal small-signal input voltage drive/i, /Cgs/, /Cgd/, /Cdb/, /not generally the actual/, /rad\/s/]) assert.match(text, pattern);
    if (type.startsWith('diff-') || type === 'folded-cascode') {
      assert.match(text, /Matched differential pairs/);
      assert.match(text, /no CMFB/);
    }
    if (type === 'diff-five') assert.match(text, /shared tail source is eliminated exactly/);
    if (type === 'folded-cascode' || type === 'diff-cascode') assert.match(text, /internal capacitances are omitted/);
  }
});

test('describe and calculate do not mutate caller data or leak mutable descriptions', () => {
  const config = Object.freeze({ type: 'cs', sourceResistance: true, load: 'active', polarity: 'pmos' });
  const values = Object.freeze(varied(config));
  assert.doesNotThrow(() => analog.calculate(config, values));
  const first = analog.describe(config);
  first.config.type = 'follower';
  first.parameters[0].default = 7;
  first.formulas.length = 0;
  const second = analog.describe(config);
  assert.equal(second.config.type, 'cs');
  assert.equal(second.parameters[0].default, 0.002);
  assert.equal(second.formulas.filter(f => f.key !== null).length, 9);
});

function evaluateEquation(tree, values, equations, frequency = z(0)) {
  if (typeof tree === 'number') return z(tree);
  if (typeof tree === 'string') {
    if (tree === 's') return frequency;
    if (tree === 'π') return z(Math.PI);
    if (Object.hasOwn(values, tree)) return z(values[tree]);
    assert.ok(equations.has(tree), 'Defined physical quantity: ' + tree);
    return evaluateEquation(equations.get(tree), values, equations, frequency);
  }
  const [op, ...args] = tree;
  if (op === 'call') {
    assert.equal(args[0], 'D');
    return evaluateEquation(equations.get('D'), values, equations, evaluateEquation(args[1], values, equations, frequency));
  }
  const evaluated = args.map(arg => evaluateEquation(arg, values, equations, frequency));
  if (op === 'add') return evaluated.reduce(add, z(0));
  if (op === 'mul') return evaluated.reduce(mul, z(1));
  if (op === 'div') return div(...evaluated);
  if (op === 'neg') return mul(z(-1), evaluated[0]);
  if (op === 'parallel') return div(z(1), evaluated.map(value => div(z(1), value)).reduce(add, z(0)));
  if (op === 'pow') {
    assert.equal(evaluated[1].re, 2);
    return mul(evaluated[0], evaluated[0]);
  }
  if (op === 'abs') return z(abs(evaluated[0]));
  throw new Error('Unsupported equation operation: ' + op);
}

test('displayed physical equations equal the solver across every option and parameter limits', () => {
  let seed = 192837;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const type of ids) for (const polarity of ['nmos', 'pmos']) {
    for (const sourceResistance of [false, true]) for (const load of ['resistor', 'active']) {
      const config = { type, polarity, sourceResistance, load };
      const description = analog.describe(config);
      const equations = new Map(description.formulas.filter(f => f.math[0] === 'eq').map(f => [
        Array.isArray(f.math[1]) ? f.math[1][1] : f.math[1], f.math[2]
      ]));
      const mainText = JSON.stringify(description.formulas.filter(f => !f.detail).map(f => f.math));
      assert.doesNotMatch(mainText, /"(?:den|g|go|gL|N0|N1|D0|D1|D2|a1|a2)"/);
      assert.equal(description.formulas.find(f => f.key === 'transfer').detail, true);
      assert.ok(description.formulas.filter(f => !f.detail && f.key === null).length <= 3);
      for (let trial = 0; trial < 6; trial++) {
        const values = trial === 0 ? defaults(config) : varied(config);
        if (trial >= 2) Object.keys(values).forEach(key => { values[key] *= 10 ** (4 * random() - 2); });
        if (trial === 4 && sourceResistance) values.RS = 0;
        if (trial === 5) ['CF', 'CGS', 'CX'].forEach(key => { if (key in values) values[key] = 0; });
        const result = analog.calculate(config, values);
        const evaluate = (symbol, omega = 0) => evaluateEquation(equations.get(symbol), values, equations, z(0, omega));
        close(evaluate('Av').re, result.metrics.gain, 1e-10, type + ' displayed gain');
        close(evaluate('Rout').re, result.metrics.rout, 1e-10, type + ' displayed resistance');
        close(evaluate('GBW').re, result.metrics.gbw, 1e-10, type + ' displayed GBW');
        if (equations.has('a1')) {
          close(evaluate('a1').re, result.denominator[1], 1e-10, type + ' displayed a1');
          close(evaluate('a2').re, result.denominator[2], 1e-10, type + ' displayed a2');
        } else close(evaluate('p1').re, result.poles[0].re, 1e-10, type + ' displayed pole');
        if (result.zeros.length) close(evaluate('z1').re, result.zeros[0].re, 1e-10, type + ' displayed zero');
        for (const omega of [0, 3e4, 8e7, 2e10]) complexClose(evaluate('H', omega), transfer(result, omega), type + ' displayed transfer function');
      }
    }
  }
});

for (const type of ids) {
  for (const polarity of ['nmos', 'pmos']) {
    for (const sourceResistance of [false, true]) {
      for (const load of ['resistor', 'active']) {
        const config = { type, polarity, sourceResistance, load };
        test('all-options KCL reference: ' + JSON.stringify(config), () => {
          const values = varied(config);
          const result = analog.calculate(config, values);
          checkResult(result, config);
          close(result.metrics.gain, reference(config, values, 0).re, 2e-9, type + ' DC gain');
          close(result.metrics.rout, reference(config, values, 0, true).re, 2e-9, type + ' output test current');
          close(result.metrics.gainDb, 20 * Math.log10(Math.abs(result.metrics.gain)));
          close(result.metrics.gbw, Math.abs(result.metrics.gain) / (TAU * result.metrics.rout * values.CL));
          for (const omega of [0, 13, 2e4, 6e6, 9e8, 4e10]) complexClose(transfer(result, omega), reference(config, values, omega), type + ' at ' + omega + ' rad/s');
          assertCrossing(result, 'bandwidth');
          assertCrossing(result, 'unity');
          assert.equal(Math.sign(result.metrics.gain), ['cg', 'diff-cg', 'follower', 'diff-five'].includes(type) ? 1 : -1);
        });
      }
    }
  }
}

test('polarity complementation leaves every numerical result invariant', () => {
  for (const type of ids) {
    const config = { type, sourceResistance: true, load: 'active' };
    const values = varied(config);
    assert.deepEqual(analog.calculate({ ...config, polarity: 'nmos' }, values), analog.calculate({ ...config, polarity: 'pmos' }, values));
  }
});

test('RS = 0 is equivalent to source-resistance option off for every supported topology', () => {
  for (const type of ids.filter(id => id !== 'follower')) {
    const off = { type, load: 'active' };
    const on = { ...off, sourceResistance: true };
    const base = varied(off);
    const resultOff = analog.calculate(off, base);
    const resultOn = analog.calculate(on, { ...varied(on), ...base, RS: 0 });
    for (const key of ['metrics', 'numerator', 'denominator', 'poles', 'zeros']) assert.deepEqual(resultOn[key], resultOff[key], type + ': ' + key);
    if (type === 'cg' || type === 'diff-cg') assert.ok(resultOn.warnings.some(warning => /CX is ignored/.test(warning)));
  }
});

test('textbook common-source gain, Norton degeneration, pole, RHP zero, and GBW distinction', () => {
  const config = { type: 'cs', sourceResistance: true };
  const values = defaults(config, { gm1: 0.002, ro1: 1e5, RL: 2e4, RS: 200, CL: 3e-12, CF: 0 });
  const r = values.ro1 + (1 + values.gm1 * values.ro1) * values.RS;
  const go = 1 / r;
  const g = values.gm1 / (1 + (values.gm1 + 1 / values.ro1) * values.RS);
  const rout = 1 / (go + 1 / values.RL);
  const result = analog.calculate(config, values);
  close(result.metrics.gain, -g * rout);
  close(result.metrics.rout, rout);
  close(result.metrics.bandwidth, 1 / (TAU * rout * values.CL));
  close(result.poles[0].re, -1 / (rout * values.CL));
  close(result.metrics.unity, Math.sqrt(result.metrics.gain ** 2 - 1) / (TAU * rout * values.CL));
  assert.deepEqual(result.zeros, []);
  const feedforward = analog.calculate(config, { ...values, CF: 4e-12 });
  close(feedforward.zeros[0].re, g / 4e-12);
  assert.ok(feedforward.zeros[0].re > 0);
  assert.notEqual(feedforward.metrics.unity, feedforward.metrics.gbw);
  assert.notEqual(feedforward.metrics.bandwidth, 1 / (TAU * rout * values.CL));
});

test('textbook common-gate gain and series input resistance are not CS degeneration', () => {
  const config = { type: 'cg' };
  const values = defaults(config, { gm1: 0.003, ro1: 80000, RL: 15000, CL: 2e-12 });
  const ideal = analog.calculate(config, values);
  const k = values.gm1 + 1 / values.ro1;
  close(ideal.metrics.gain, k / (1 / values.ro1 + 1 / values.RL));
  const finite = analog.calculate({ type: 'cg', sourceResistance: true }, { ...values, RS: 120, CX: 1e-12 });
  const x = 1 / 120 + k;
  const d = 1 / values.ro1 + 1 / values.RL;
  const D0 = x * d - k / values.ro1;
  close(finite.metrics.rout, x / D0);
  close(finite.metrics.gain, k / 120 / D0);
  assert.ok(finite.metrics.rout > ideal.metrics.rout);
  close(analog.calculate({ type: 'diff-cg' }, values).metrics.gain, ideal.metrics.gain);
});

test('textbook unloaded cascode resistance and finite resistor load', () => {
  const config = { type: 'cascode', sourceResistance: true };
  const values = defaults(config, { RS: 170, RL: 3e6, CX: 0 });
  const lower = values.ro1 + (1 + values.gm1 * values.ro1) * values.RS;
  const stack = lower + values.ro2 + values.gm2 * lower * values.ro2;
  const result = analog.calculate(config, values);
  close(result.metrics.rout, 1 / (1 / stack + 1 / values.RL));
  assert.equal(result.poles.length, 1);
  close(result.metrics.bandwidth, 1 / (TAU * result.metrics.rout * values.CL));
});

test('telescopic and folded load resistances use the assigned device indices', () => {
  for (const type of ['diff-cascode', 'folded-cascode']) {
    const config = { type, sourceResistance: true };
    const v = varied(config);
    const result = analog.calculate(config, v);
    const lower = v.ro1 + (1 + v.gm1 * v.ro1) * v.RS;
    let signal;
    let load;
    if (type === 'diff-cascode') {
      signal = lower + v.ro3 + v.gm3 * lower * v.ro3;
      load = v.ro5 + v.ro7 + v.gm5 * v.ro5 * v.ro7;
    } else {
      const foldedLower = 1 / (1 / lower + 1 / v.ro3);
      signal = foldedLower + v.ro5 + v.gm5 * foldedLower * v.ro5;
      load = v.ro7 + v.ro9 + v.gm7 * v.ro7 * v.ro9;
    }
    close(result.metrics.rout, 1 / (1 / signal + 1 / load));
  }
});

test('source follower textbook gain, LHP zero, ideal bias, and no unity crossing', () => {
  const config = { type: 'follower', sourceResistance: true, load: 'active' };
  const v = defaults(config, { gm1: 0.002, ro1: 100000, RL: 10000, CL: 2e-12, CGS: 0.5e-12 });
  const result = analog.calculate(config, v);
  const t = v.gm1 + 1 / v.ro1 + 1 / v.RL;
  close(result.metrics.gain, v.gm1 / t);
  close(result.metrics.rout, 1 / t);
  close(result.zeros[0].re, -v.gm1 / v.CGS);
  close(result.poles[0].re, -t / (v.CL + v.CGS));
  assert.equal(result.metrics.unity, null);
  assert.ok(result.metrics.gain > 0 && result.metrics.gain < 1);
  const zero = analog.calculate(config, { ...v, CGS: 0 });
  assert.deepEqual(zero.zeros, []);
  close(zero.metrics.bandwidth, t / (TAU * v.CL));
});

test('five-transistor model matches an independent three-node KCL retaining shared tail', () => {
  for (const rs of [0, 180, 2400]) {
    const config = { type: 'diff-five', sourceResistance: true };
    const v = varied(config);
    v.RS = rs;
    const den = 1 + (v.gm1 + 1 / v.ro1) * rs;
    const g = v.gm1 / den;
    const go = 1 / v.ro1 / den;
    const mirror = 1 / v.ro3;
    const result = analog.calculate(config, v);
    for (const omega of [0, 1e4, 3e7, 9e9]) {
      const matrix = [
        [z(go + v.gm3 + mirror, omega * v.CX), z(0), z(-(g + go))],
        [z(v.gm3), z(go + mirror, omega * v.CL), z(-(g + go))],
        [z(-go), z(-go), z(2 * (g + go))]
      ];
      complexClose(transfer(result, omega), solveLinear(matrix, [z(-g / 2), z(g / 2), z(0)])[1], 'shared-tail KCL');
      if (omega === 0) close(result.metrics.rout, solveLinear(matrix, [z(0), z(1), z(0)])[1].re, 2e-9);
    }
    close(result.zeros[0].re, -(2 * v.gm3 + 1 / v.ro3) / v.CX);
    assert.ok(result.metrics.gain > 0);
  }
});

test('five-transistor mirror approaches gm1 times the parallel input/mirror output resistance', () => {
  const config = { type: 'diff-five' };
  const v = defaults(config, { gm3: 1, CX: 0 });
  const result = analog.calculate(config, v);
  close(result.metrics.gain, v.gm1 / (1 / v.ro1 + 1 / v.ro3), 1e-5);
  close(result.metrics.rout, 1 / (1 / v.ro1 + 1 / v.ro3), 1e-5);
  assert.equal(result.poles.length, 1);
  assert.deepEqual(result.zeros, []);
});

test('complex-conjugate characteristic roots satisfy the actual quadratic', () => {
  const config = { type: 'diff-five' };
  const v = defaults(config, { ro1: 1000, ro3: 1000, gm3: 0.002 });
  const a = 0.0005 + v.gm3 + 0.001;
  const d = 0.0005 + 0.001;
  v.CX = v.CL * a / d;
  const result = analog.calculate(config, v);
  assert.equal(result.poles.length, 2);
  assert.ok(result.poles[0].im > 0);
  assert.equal(result.poles[0].re, result.poles[1].re);
  assert.equal(result.poles[0].im, -result.poles[1].im);
  for (const pole of result.poles) {
    const residual = add(add(z(1), mul(z(result.denominator[1]), pole)), mul(z(result.denominator[2]), mul(pole, pole)));
    assert.ok(abs(residual) < 1e-12);
  }
  assertCrossing(result, 'bandwidth');
});

test('coincident pole and zero remain explicit uncancelled characteristic roots', () => {
  const config = { type: 'diff-five' };
  const v = defaults(config, { gm3: 5e-6, ro1: 100000, ro3: 120000 });
  const result = analog.calculate(config, v);
  assert.equal(result.poles.length, 2);
  assert.ok(result.poles.some(pole => Math.abs(pole.re / result.zeros[0].re - 1) < 1e-10));
  for (const omega of [0, 1e6, 1e9]) complexClose(transfer(result, omega), div(z(v.gm1 / 2), z(1 / (2 * v.ro1) + 1 / v.ro3, omega * v.CL)));
  assert.ok(result.warnings.some(warning => /not cancelled/.test(warning)));
});

test('zero optional capacitances reduce order without nonfinite poles or zeros', () => {
  for (const type of ids) {
    const config = { type, sourceResistance: true };
    const v = varied(config);
    for (const key of ['CX', 'CF', 'CGS']) if (key in v) v[key] = 0;
    const result = analog.calculate(config, v);
    assert.equal(result.poles.length, 1, type);
    assert.deepEqual(result.zeros, []);
    assert.equal(result.denominator[2], 0);
    checkResult(result, config);
    close(result.metrics.bandwidth, -result.poles[0].re / TAU);
  }
});

test('scaling lumped capacitances scales frequencies but not DC gain or resistance', () => {
  for (const type of ids) {
    const config = { type, sourceResistance: true, load: 'active' };
    const values = varied(config);
    const scaled = { ...values };
    const factor = 13;
    for (const key of ['CL', 'CX', 'CF', 'CGS']) if (key in scaled) scaled[key] *= factor;
    const a = analog.calculate(config, values);
    const b = analog.calculate(config, scaled);
    close(b.metrics.gain, a.metrics.gain);
    close(b.metrics.rout, a.metrics.rout);
    for (const key of ['gbw', 'bandwidth', 'unity']) {
      if (a.metrics[key] === null) assert.equal(b.metrics[key], null);
      else close(b.metrics[key], a.metrics[key] / factor);
    }
    for (const key of ['poles', 'zeros']) a[key].forEach((root, index) => {
      close(b[key][index].re, root.re / factor);
      if (root.im !== 0) close(b[key][index].im, root.im / factor);
      else assert.equal(b[key][index].im, 0);
    });
  }
});

test('analytic crossings agree with independent logarithmic bracketing and bisection', () => {
  for (const type of ids) {
    for (const sourceResistance of [false, true]) {
      const config = { type, sourceResistance, load: 'active' };
      const result = analog.calculate(config, varied(config));
      for (const key of ['bandwidth', 'unity']) {
        const target = key === 'bandwidth' ? Math.abs(result.metrics.gain) / Math.SQRT2 : 1;
        const numeric = numericalCrossing(result, target);
        if (numeric === null) assert.equal(result.metrics[key], null, type + ': ' + key);
        else close(result.metrics[key], numeric, 3e-8, type + ': ' + key);
      }
    }
  }
});

test('unity solver selects a descending resonance crossing after an ascending one', () => {
  const config = { type: 'diff-five' };
  const v = defaults(config, { gm1: 0.002, ro1: 1000, gm3: 0.002, ro3: 100000 });
  v.CX = 10 * v.CL;
  const unit = analog.calculate(config, v);
  let peak = 0;
  for (let step = 0; step <= 1000; step++) peak = Math.max(peak, abs(transfer(unit, 10 ** (5 + step * 0.006))));
  assert.ok(peak > Math.abs(unit.metrics.gain));
  const desiredDC = (1 + Math.abs(unit.metrics.gain) / peak) / 2;
  v.gm1 *= desiredDC / unit.metrics.gain;
  const result = analog.calculate(config, v);
  assert.ok(result.metrics.gain < 1);
  assert.ok(result.metrics.unity > 0);
  assertCrossing(result, 'unity');
  close(result.metrics.unity, numericalCrossing(result, 1), 1e-8);
});

test('no finite bandwidth crossing and no unity are represented by null', () => {
  const config = { type: 'follower' };
  const v = defaults(config, { gm1: 1e-6, ro1: 1000, RL: 1000, CGS: 10e-12, CL: 1e-12 });
  const result = analog.calculate(config, v);
  assert.equal(result.metrics.bandwidth, null);
  assert.equal(result.metrics.unity, null);
  assert.ok(result.warnings.some(warning => /no finite descending/.test(warning)));
  const flat = analog.calculate(config, { ...v, CGS: v.gm1 * v.CL / (1 / v.ro1 + 1 / v.RL) });
  assert.equal(flat.metrics.bandwidth, null);
  assert.equal(flat.metrics.unity, null);
});

test('DC unity equality is not counted as a positive-frequency crossing', () => {
  const config = { type: 'cs' };
  const v = defaults(config, { ro1: 1000, RL: 1000, gm1: 0.002, CF: 0 });
  const result = analog.calculate(config, v);
  assert.equal(result.metrics.gain, -1);
  assert.equal(result.metrics.unity, null);
});

test('stable pole solving preserves widely separated real roots', () => {
  const config = { type: 'cascode' };
  const v = defaults(config, { CL: 1e-3, CX: 1e-30 });
  const result = analog.calculate(config, v);
  const [slow, fast] = result.poles.map(pole => pole.re);
  assert.ok(Math.abs(fast / slow) > 1e25);
  close(slow + fast, -result.denominator[1] / result.denominator[2]);
  close(slow * fast, 1 / result.denominator[2]);
  assertCrossing(result, 'bandwidth');
  assertCrossing(result, 'unity');
});

test('all required parameters reject missing, nonnumeric, nonfinite and negative inputs', () => {
  for (const type of ids) {
    const config = { type, sourceResistance: true, load: 'active' };
    const valid = varied(config);
    for (const p of analog.describe(config).parameters) {
      const missing = { ...valid };
      delete missing[p.key];
      assert.throws(() => analog.calculate(config, missing), /Missing parameter/);
      for (const invalid of [-1, NaN, Infinity, -Infinity, '', '1', null, undefined, false, {}, []]) assert.throws(() => analog.calculate(config, { ...valid, [p.key]: invalid }), new RegExp(p.key));
      if (p.positive) assert.throws(() => analog.calculate(config, { ...valid, [p.key]: 0 }), /strictly positive/);
      else assert.doesNotThrow(() => analog.calculate(config, { ...valid, [p.key]: 0 }));
    }
  }
  for (const values of [undefined, null, '', [], 0, false]) assert.throws(() => analog.calculate({}, values), /Parameter values/);
  assert.throws(() => analog.calculate({}, {}), /Missing parameter/);
});

test('extra value keys are ignored but inherited parameter values are not accepted', () => {
  const values = defaults();
  assert.deepEqual(analog.calculate({}, { ...values, unrelated: NaN, roL: -1, RS: -5 }), analog.calculate({}, values));
  assert.throws(() => analog.calculate({}, Object.create(values)), /Missing parameter/);
  assert.doesNotThrow(() => analog.calculate({}, Object.assign(Object.create(null), values)));
  assert.doesNotThrow(() => analog.calculate(undefined, values));
});

test('unrepresentable arithmetic raises explanatory numerical errors instead of returning NaN', () => {
  const cases = [
    [{}, { ro1: Number.MIN_VALUE }],
    [{ type: 'cs', sourceResistance: true }, { gm1: Number.MAX_VALUE, RS: Number.MAX_VALUE }],
    [{ type: 'cs' }, { CL: Number.MAX_VALUE, CF: Number.MAX_VALUE }],
    [{ type: 'cascode' }, { CL: Number.MIN_VALUE, CX: Number.MIN_VALUE }],
    [{ type: 'diff-cascode' }, { gm5: Number.MAX_VALUE, ro5: Number.MAX_VALUE }],
    [{ type: 'folded-cascode' }, { gm7: Number.MAX_VALUE, ro7: Number.MAX_VALUE }],
    [{ type: 'cg', sourceResistance: true }, { RS: Number.MIN_VALUE }],
    [{ type: 'diff-five' }, { gm1: Number.MAX_VALUE, gm3: Number.MAX_VALUE }]
  ];
  for (const [config, overrides] of cases) assert.throws(() => analog.calculate(config, defaults(config, overrides)), /Numerical range exceeded.*overflow, underflow/);
});
