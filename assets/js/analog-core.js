(function (root) {
  'use strict';

  const catalog = Object.freeze([
    { id: 'cs', label: 'Common-source amplifier', description: 'Inverting common-source stage with optional resistive source degeneration and explicit gate-drain feedforward capacitance.', sourceOption: true, loadOption: true },
    { id: 'cg', label: 'Common-gate amplifier', description: 'Noninverting source-driven, AC-grounded-gate stage with optional series input resistance.', sourceOption: true, loadOption: true },
    { id: 'cascode', label: 'Common-source cascode amplifier', description: 'Inverting common-source/common-gate stack with one retained internal node.', sourceOption: true, loadOption: true },
    { id: 'follower', label: 'Common-drain source follower', description: 'Source-loaded voltage follower with ideal DC current bias and explicit gate-source feedforward capacitance.', sourceOption: false, loadOption: false },
    { id: 'diff-five', label: 'Five-transistor current-mirror differential amplifier', description: 'Matched input pair and current mirror with an ideal shared tail; positive differential-to-single-ended gain at the right output.', sourceOption: true, loadOption: false },
    { id: 'diff-cg', label: 'Differential common-gate amplifier', description: 'Matched source-driven common-gate branches with differential input and output; optional series input resistors.', sourceOption: true, loadOption: true },
    { id: 'diff-cascode', label: 'Telescopic cascode differential amplifier', description: 'Matched differential cascode branches with opposite-polarity cascoded active loads collapsed to resistances.', sourceOption: true, loadOption: false },
    { id: 'folded-cascode', label: 'Folded-cascode differential amplifier', description: 'Matched input pair, opposite-polarity folding devices, and cascoded output sinks collapsed to resistances.', sourceOption: true, loadOption: false }
  ].map(Object.freeze));

  const TWO_PI = 2 * Math.PI;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const isObject = object => object !== null && typeof object === 'object' && !Array.isArray(object);
  const isCG = type => type === 'cg' || type === 'diff-cg';
  const isDifferential = type => type.startsWith('diff-') || type === 'folded-cascode';

  function normalize(raw) {
    if (!isObject(raw)) throw new TypeError('Configuration must be an object.');
    const fields = ['type', 'polarity', 'sourceResistance', 'load'];
    for (const key of Object.keys(raw)) {
      if (!fields.includes(key)) throw new TypeError('Unknown configuration field: ' + key + '.');
    }
    const type = raw.type === undefined ? 'cs' : raw.type;
    const polarity = raw.polarity === undefined ? 'nmos' : raw.polarity;
    const sourceResistance = raw.sourceResistance === undefined ? false : raw.sourceResistance;
    const load = raw.load === undefined ? 'resistor' : raw.load;
    const entry = catalog.find(item => item.id === type);
    if (!entry) throw new RangeError('Unknown circuit type: ' + String(type) + '.');
    if (polarity !== 'nmos' && polarity !== 'pmos') throw new RangeError('Polarity must be nmos or pmos.');
    if (typeof sourceResistance !== 'boolean') throw new TypeError('sourceResistance must be a boolean.');
    if (load !== 'resistor' && load !== 'active') throw new RangeError('Load must be resistor or active, even when the load option is unused.');
    return { type, polarity, sourceResistance: entry.sourceOption && sourceResistance, load: entry.loadOption ? load : 'resistor' };
  }

  function parameter(key, label, group) {
    const cap = ['CL', 'CX', 'CF', 'CGS'].includes(key);
    const gm = key.startsWith('gm');
    const defaults = { RS: 100, RL: 10000, CL: 2e-12, CX: 0.2e-12, CF: 0.05e-12, CGS: 0.2e-12 };
    return {
      key, symbol: key, label,
      unit: cap ? 'pF' : gm ? 'mS' : key === 'RS' ? 'Ω' : 'kΩ',
      scale: cap ? 1e-12 : gm ? 1e-3 : key === 'RS' ? 1 : 1e3,
      default: own(defaults, key) ? defaults[key] : gm ? 2e-3 : 100e3,
      positive: key !== 'RS' && (!cap || key === 'CL'),
      group
    };
  }

  function describe(raw = {}) {
    const config = normalize(raw);
    const { type, sourceResistance, load, polarity } = config;
    const entry = catalog.find(item => item.id === type);
    const differential = isDifferential(type);
    const cg = isCG(type);
    const parameters = [];
    const add = (key, label, group = 'Devices') => parameters.push(parameter(key, label, group));
    const pair = differential ? 'matched M1/M2 input pair, per device' : 'M1';
    add('gm1', 'Transconductance of ' + pair);
    add('ro1', 'Output resistance of ' + pair);
    if (type === 'cascode') {
      add('gm2', 'Transconductance of M2 signal common-gate cascode');
      add('ro2', 'Output resistance of M2 signal common-gate cascode');
    }
    if (type === 'diff-five' || type === 'diff-cascode') {
      const devices = type === 'diff-five' ? 'matched M3/M4 current mirror' : 'matched M3/M4 signal cascodes';
      add('gm3', 'Transconductance of ' + devices + ', per device');
      add('ro3', 'Output resistance of ' + devices + ', per device');
    }
    if (type === 'diff-cascode' || type === 'folded-cascode') {
      const devices = type === 'diff-cascode' ? 'matched M5/M6 load cascodes' : 'matched M5/M6 folding common-gate devices';
      add('gm5', 'Transconductance of ' + devices + ', per device');
      add('ro5', 'Output resistance of ' + devices + ', per device');
      if (type === 'diff-cascode') add('ro7', 'Output resistance of matched M7/M8 outer load bias devices, per device');
      else {
        add('ro3', 'Output resistance of matched M3/M4 folding-node bias devices, per device');
        add('gm7', 'Transconductance of matched M7/M8 output sink cascodes, per device');
        add('ro7', 'Output resistance of matched M7/M8 output sink cascodes, per device');
        add('ro9', 'Output resistance of matched M9/M10 output sink bias devices, per device');
      }
    }
    if (entry.loadOption) add(load === 'active' ? 'roL' : 'RL', load === 'active' ? 'Collapsed active-load output resistance' : 'Output load resistance', 'Load');
    if (type === 'follower') add('RL', 'Source load resistance; DC current bias IB is ideal', 'Load');
    if (sourceResistance) add('RS', cg ? 'Series source-input resistance, per branch' : 'Resistive source degeneration, per input device', 'Source resistance');
    add('CL', differential && type !== 'diff-five' ? 'Lumped output-to-AC-ground capacitance, per output branch' : 'Lumped output-to-AC-ground capacitance', 'Capacitances');
    const internal = ['cascode', 'diff-cascode', 'folded-cascode', 'diff-five'].includes(type) || (cg && sourceResistance);
    if (internal) {
      let node = 'input-drain / signal-cascode-source node';
      if (type === 'folded-cascode') node = 'folding node (input drain / M5 or M6 source)';
      if (type === 'diff-five') node = 'M3 diode-connected mirror/reference node';
      if (cg) node = 'source-input node after RS (shorted by ideal drive when RS = 0)';
      add('CX', 'Lumped capacitance to AC ground at ' + node + (differential && type !== 'diff-five' ? ', per branch' : ''), 'Capacitances');
    }
    if (type === 'cs') add('CF', 'Direct M1 gate-drain feedforward capacitance, excluded from CL', 'Capacitances');
    if (type === 'follower') add('CGS', 'Direct M1 gate-source feedforward capacitance, excluded from CL', 'Capacitances');

    const assumptions = [
      'Reduced-order small-signal model, not a full transistor or SPICE pole model.',
      'Ideal small-signal input voltage drive; all devices are assumed biased in saturation. Transconductances are positive magnitudes, body effect is neglected, and supply and bias voltages are AC-grounded.',
      'CL includes only the specified lumped output-to-AC-ground loading; CX, when present, includes only the specified internal-node-to-AC-ground loading. Neither includes the other node or explicit feedforward capacitances. Individual transistor Cgs, Cgd and Cdb are not inferred or separately modeled, except the explicit CS CF and follower CGS.',
      'Changing NMOS to PMOS complements device polarities without changing gain signs for the same small-signal magnitudes and voltage conventions.',
      'GBW is the dominant-output-pole estimate |gain| / (2π Rout CL), not generally the actual model unity crossing. Returned pole and zero coordinates are in s-plane rad/s, not Hz.'
    ];
    if (differential) {
      assumptions.push('Matched differential pairs and equal per-branch values are assumed. vi = vi+ − vi− with the left input positive; common mode is fixed, the tail is ideal in AC, and there is no CMFB or stability prediction.');
      assumptions.push(type === 'diff-five'
        ? 'vo is the single right output, giving positive differential gain. M3/M4 form the opposite-polarity mirror and M5 is the ideal tail. The shared tail source is eliminated exactly, not blindly AC-grounded; CL is at the output and CX is at the mirror/reference node, not the tail.'
        : 'vo = left vo+ − right vo−. CL and CX are per branch, not a capacitance bridging the two branches; differential gain has no extra factor of two.');
    }
    if (sourceResistance) assumptions.push(cg
      ? 'RS is series input resistance at each driven source, not source degeneration to ground. CX is ineffective when RS = 0 because the source is ideally voltage-driven; resistor parasitic capacitances are omitted.'
      : 'RS is resistive source degeneration. Its effect on input transconductance and output resistance includes finite ro1; matched shared-tail symmetry is retained. Resistor parasitic capacitances are omitted.');
    if (type === 'follower') assumptions.push('RL is the source load; IB is an ideal DC bias current source with infinite small-signal resistance. The bulk is tied to the source for this model. No independent RS option or roL is used.');
    if (type === 'diff-cascode') assumptions.push('M5/M6 are opposite-polarity load cascodes over M7/M8 outer bias devices (PMOS for NMOS inputs); M9 is the ideal tail. Load-stack internal capacitances are omitted and the load is collapsed to Rload = ro5 + ro7 + gm5 ro5 ro7.');
    if (type === 'folded-cascode') assumptions.push('M5/M6 are opposite-polarity folding devices; M3/M4 supply folding-node bias. M7/M8 output sink cascodes sit over M9/M10 bias devices; M11 is the ideal tail. Output-load internal capacitances are omitted and the load is collapsed to Rload = ro7 + ro9 + gm7 ro7 ro9.');
    if (entry.loadOption && load === 'active') assumptions.push('The active load is a resistance roL to AC ground; its internal dynamics are omitted.');

    const sum = (...args) => ['add', ...args];
    const mul = (...args) => ['mul', ...args];
    const frac = (a, b) => ['div', a, b];
    const neg = a => ['neg', a];
    const parallel = (...args) => ['parallel', ...args];
    const abs = a => ['abs', a];
    const formulas = [];
    const definitions = [];
    const formula = (key, label, math, unit = '', note = '', detail = false) => formulas.push({ key, label, math, unit, note, detail });
    const define = (symbol, label, value, note) => definitions.push({ key: null, label, math: ['eq', symbol, value], unit: 'Ω', note, detail: false });
    const degenerated = sourceResistance ? sum('ro1', mul(sum(1, mul('gm1', 'ro1')), 'RS')) : 'ro1';
    const complex = ['cascode', 'diff-five', 'diff-cascode', 'folded-cascode'].includes(type);
    const rd = complex && sourceResistance ? 'Rdeg' : degenerated;
    if (complex && sourceResistance) define('Rdeg', 'Degenerated input branch', degenerated, 'Resistance looking into an input drain with its gate at AC ground; not an extra component.');
    const gm = sourceResistance ? frac(mul('gm1', 'ro1'), rd) : 'gm1';
    let loadR = load === 'active' ? 'roL' : 'RL';
    let gain;
    let rout;
    let zero = null;
    let zeroCap = '';
    let time1;
    let time2 = null;
    let outputCap = 'CL';
    if (type === 'cs' || cg) {
      rout = parallel(degenerated, loadR);
      gain = sourceResistance
        ? frac(mul(type === 'cs' ? neg(mul('gm1', 'ro1')) : sum(1, mul('gm1', 'ro1')), loadR), sum(degenerated, loadR))
        : mul(type === 'cs' ? neg('gm1') : sum('gm1', frac(1, 'ro1')), parallel('ro1', loadR));
      if (type === 'cs') {
        outputCap = sum('CL', 'CF');
        zero = sourceResistance ? frac(mul('gm1', 'ro1'), mul(degenerated, 'CF')) : frac('gm1', 'CF');
        zeroCap = 'CF';
      } else if (sourceResistance) {
        time1 = frac(sum(mul(degenerated, loadR, 'CL'), mul(sum('ro1', loadR), 'RS', 'CX')), sum(degenerated, loadR));
        time2 = frac(mul('ro1', loadR, 'RS', 'CX', 'CL'), sum(degenerated, loadR));
      }
    } else if (type === 'follower') {
      rout = parallel(frac(1, 'gm1'), 'ro1', 'RL');
      gain = frac(parallel('ro1', 'RL'), sum(frac(1, 'gm1'), parallel('ro1', 'RL')));
      outputCap = sum('CL', 'CGS');
      zero = neg(frac('gm1', 'CGS'));
      zeroCap = 'CGS';
    } else if (type === 'diff-five') {
      const mirrorGain = sum(1, mul('gm3', 'ro3'));
      gain = mul(gm, parallel(rd, 'ro3'), frac(sum(1, mul(2, 'gm3', 'ro3')), mul(2, mirrorGain)));
      rout = mul(parallel(rd, 'ro3'), sum(1, frac('ro3', mul(2, rd, mirrorGain))));
      const mirrorNode = sum('ro3', mul(2, rd, mirrorGain));
      time1 = mul('Rout', sum('CL', mul(frac(sum('ro3', mul(2, rd)), mirrorNode), 'CX')));
      time2 = frac(mul(2, 'Rout', rd, 'ro3', 'CX', 'CL'), mirrorNode);
      zero = neg(frac(sum(mul(2, 'gm3'), frac(1, 'ro3')), 'CX'));
      zeroCap = 'CX';
    } else {
      const c = type === 'cascode' ? '2' : type === 'diff-cascode' ? '3' : '5';
      const rc = 'ro' + c;
      const boost = sum(1, mul('gm' + c, rc));
      const rx = type === 'folded-cascode' ? parallel(rd, 'ro3') : rd;
      define('Rsig', 'Signal-path output branch', sum(rc, mul(boost, rx)), 'Output resistance looking into the signal cascode, before paralleling the load.');
      if (type === 'diff-cascode' || type === 'folded-cascode') {
        const inner = type === 'diff-cascode' ? '5' : '7';
        const outer = type === 'diff-cascode' ? '7' : '9';
        loadR = 'Rload';
        define(loadR, 'Load-stack output branch', sum('ro' + inner, mul(sum(1, mul('gm' + inner, 'ro' + inner)), 'ro' + outer)), 'Equivalent resistance of the output load stack; its internal capacitances are omitted.');
      }
      rout = parallel('Rsig', loadR);
      gain = neg(mul(gm, frac(mul(boost, rx), 'Rsig'), 'Rout'));
      time1 = mul('Rout', sum('CL', mul(frac(mul(sum(rc, loadR), rx), mul(loadR, 'Rsig')), 'CX')));
      time2 = frac(mul('Rout', rc, rx, 'CX', 'CL'), 'Rsig');
    }
    if (time1 === undefined) time1 = mul('Rout', outputCap);
    formula('gain', 'DC voltage gain', ['eq', 'Av', gain], 'V/V', type === 'diff-five' ? 'Positive differential-to-single-ended gain at the right output; finite mirror resistance is retained.' : 'Signed gain, including finite transistor output resistances.');
    formula('rout', 'Output resistance', ['eq', 'Rout', rout], 'Ω', 'Input voltage set to zero; the load is included. ∥ denotes parallel resistance.');
    formulas.push(...definitions);
    formula('gbw', 'Gain–bandwidth estimate', ['eq', 'GBW', frac(abs('Av'), mul(2, 'π', 'Rout', 'CL'))], 'Hz', 'Dominant-output-pole estimate only; not the actual unity-gain crossing.');
    formula('poles', 'Poles', time2 === null
      ? ['eq', 'p1', neg(frac(1, time1))]
      : ['eq', ['call', 'D', 'p'], 0], 'rad/s', time2 === null
      ? 'Signed s-plane pole; divide its magnitude by 2π for Hz.'
      : 'Roots of the transfer-function denominator D(s), defined in the details below. Complex pairs are retained; no pole-zero cancellation.');
    formula('zeros', 'Zeros', zero ? ['eq', 'z1', zero] : ['text', 'No finite zero'], 'rad/s', zero
      ? 'For ' + zeroCap + ' > 0; no finite zero when it is zero. ' + (type === 'cs' ? 'Right-half-plane zero.' : 'Left-half-plane zero.') : 'No feedforward zero in this reduced model.');
    formula('bandwidth', '−3 dB bandwidth', ['eq', abs(['call', 'H', mul('j', 2, 'π', 'f3dB')]), frac(abs('Av'), ['sqrt', 2])], 'Hz', 'First descending crossing relative to the DC gain magnitude.');
    formula('unity', 'Unity-gain frequency', ['eq', abs(['call', 'H', mul('j', 2, 'π', 'fu')]), 1], 'Hz', 'First descending unity crossing. A source follower normally has none.');
    const numerator = type === 'cs' ? sum('Av', mul('s', 'Rout', 'CF'))
      : type === 'follower' ? sum('Av', mul('s', 'Rout', 'CGS'))
      : type === 'diff-five' ? mul('Av', sum(1, frac(mul('s', 'CX'), sum(mul(2, 'gm3'), frac(1, 'ro3'))))) : 'Av';
    const denominator = time2 === null ? sum(1, mul('s', time1)) : ['call', 'D', 's'];
    formula('transfer', 'Transfer function', ['eq', ['call', 'H', 's'], frac(numerator, denominator)], 'V/V', 'Exact within the stated reduced model. Numeric coefficients are rounded to four significant digits; s is in rad/s.', true);
    if (time2 !== null) {
      formula(null, 'Denominator', ['eq', ['call', 'D', 's'], sum(1, mul('a1', 's'), mul('a2', ['pow', 's', 2]))], '', 'Only two frequency coefficients are needed; they are not extra circuit parameters.', true);
      formula(null, 'First-order coefficient', ['eq', 'a1', time1], 's', '', true);
      formula(null, 'Second-order coefficient', ['eq', 'a2', time2], 's²', cg ? 'Valid also at RS = 0: a2 = 0 and CX drops out.' : '', true);
      formula(null, 'Pole locations', ['eq', 'p12', frac(['pm', neg('a1'), ['sqrt', sum(['pow', 'a1', 2], neg(mul(4, 'a2')))]], mul(2, 'a2'))], 'rad/s', 'For a2 > 0; if a2 = 0, the single pole is p1 = −1/a1.', true);
    }
    formula('gainDb', 'Gain in decibels', ['eq', 'AdB', mul(20, ['call', 'log10', abs('Av')])], 'dB', '', true);
    return { config, title: polarity.toUpperCase() + ' ' + entry.label + ' — reduced-order model', parameters, formulas, assumptions };
  }

  function range(value, label, positive = false) {
    if (!Number.isFinite(value) || (positive && value <= 0)) {
      throw new RangeError('Numerical range exceeded while computing ' + label + ': overflow, underflow, or loss of a positive coefficient. Use less extreme parameter values.');
    }
    return value;
  }

  function product(a, b, label) {
    return range(a * b, label, a > 0 && b > 0);
  }

  function characteristicRoots(b, c) {
    if (c === 0) return [{ re: -range(1 / b, 'first-order pole frequency', true), im: 0 }];
    const sqrtC = Math.sqrt(c);
    const scale = Math.max(b, 2 * sqrtC);
    const p = b / scale;
    const q = 2 * sqrtC / scale;
    const discriminant = (p - q) * (p + q);
    if (discriminant < 0) {
      const beta = b / (2 * sqrtC);
      const re = -range(beta / sqrtC, 'complex pole damping', true);
      const im = range(Math.sqrt((1 - beta) * (1 + beta)) / sqrtC, 'complex pole frequency', true);
      return [{ re, im }, { re, im: -im }];
    }
    const stableQ = range(scale * ((p + Math.sqrt(discriminant)) / 2), 'stable quadratic pole coefficient', true);
    const slow = -range(1 / stableQ, 'slow pole frequency', true);
    const fast = -range(stableQ / c, 'fast pole frequency', true);
    return [{ re: slow, im: 0 }, { re: fast, im: 0 }];
  }

  function crossing(numerator, denominator, signalWeight, targetWeight) {
    const b = denominator[1];
    const sqrtC = Math.sqrt(denominator[2]);
    const zeroTime = range(Math.abs(numerator[1] / numerator[0]), 'zero time constant');
    const time = Math.max(b, sqrtC, zeroTime);
    const bs = range(b / time, 'scaled linear denominator', true);
    const cs = product(sqrtC / time, sqrtC / time, 'scaled quadratic denominator');
    if (denominator[2] > 0 && cs === 0) range(0, 'scaled quadratic denominator', true);
    const zs = zeroTime / time;
    const sw = product(signalWeight, signalWeight, 'squared signal magnitude');
    const tw = product(targetWeight, targetWeight, 'squared target magnitude');
    const a = product(tw, product(cs, cs, 'squared quadratic denominator'), 'crossing quadratic coefficient');
    const linear = product(tw, product(bs, bs, 'squared linear denominator'), 'crossing damping term') - 2 * product(tw, cs, 'crossing resonant term') - product(sw, product(zs, zs, 'squared zero time'), 'crossing numerator term');
    const constant = tw - sw;
    const norm = Math.max(a, Math.abs(linear), Math.abs(constant));
    if (norm === 0) return null;
    const A = a / norm;
    const B = linear / norm;
    const C = constant / norm;
    let top;
    let bottom;
    if (A === 0) {
      if (a !== 0) range(0, 'normalized crossing coefficient', true);
      if (B <= 0 || C >= 0) return null;
      top = -C;
      bottom = B;
    } else {
      const discriminant = B * B - 4 * A * C;
      if (discriminant <= 0) return null;
      const stableQ = -0.5 * (B + (B < 0 ? -1 : 1) * Math.sqrt(discriminant));
      // An upward-opening magnitude residual descends through the target at its larger root.
      if (B < 0) {
        top = stableQ;
        bottom = A;
      } else if (C < 0) {
        top = -C;
        bottom = -stableQ;
      } else return null;
    }
    range(top, 'positive crossing numerator', true);
    range(bottom, 'positive crossing denominator', true);
    return range(Math.exp(0.5 * (Math.log(top) - Math.log(bottom)) - Math.log(time) - Math.log(TWO_PI)), 'crossing frequency', true);
  }

  function calculate(raw, values) {
    const description = describe(raw);
    const config = description.config;
    if (!isObject(values)) throw new TypeError('Parameter values must be an object containing every described parameter in base SI units.');
    const v = Object.create(null);
    for (const p of description.parameters) {
      if (!own(values, p.key)) throw new TypeError('Missing parameter: ' + p.key + ' (base SI units).');
      const value = values[p.key];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Parameter ' + p.key + ' must be a finite number in base SI units.');
      if (p.positive ? value <= 0 : value < 0) throw new RangeError('Parameter ' + p.key + ' must be ' + (p.positive ? 'strictly positive' : 'nonnegative') + '.');
      v[p.key] = value;
    }
    const { type } = config;
    const cg = isCG(type);
    const rs = config.sourceResistance ? v.RS : 0;
    const o1 = range(1 / v.ro1, 'input output conductance', true);
    const den = !cg && type !== 'follower' && rs > 0 ? range(1 + (v.gm1 + o1) * rs, 'Norton denominator', true) : 1;
    const g = range(v.gm1 / den, 'Norton transconductance', true);
    const go = range(o1 / den, 'Norton output conductance', true);
    let loadConductance = 0;
    if (own(v, 'RL') || own(v, 'roL')) loadConductance = range(1 / (own(v, 'RL') ? v.RL : v.roL), 'load conductance', true);
    const warnings = ['Poles are uncancelled reduced-model characteristic roots, not full SPICE poles; coincident numerator zeros are not cancelled.'];
    if (raw && raw.sourceResistance === true && !config.sourceResistance) warnings.push('The source follower has no independent source-resistance option; it was ignored.');
    if (raw && raw.load === 'active' && !catalog.find(item => item.id === type).loadOption) warnings.push('The selectable load option is unused for this topology and was ignored.');
    if (config.load === 'active' || type === 'diff-cascode' || type === 'folded-cascode') warnings.push('Active-load internal capacitances are omitted; load stacks are collapsed to resistances.');
    let n0;
    let n1 = 0;
    let d0;
    let d1;
    let d2 = 0;
    let routNumerator = 1;
    let expectedSecondOrder = false;
    if (type === 'cs') {
      n0 = -g;
      n1 = v.CF;
      d0 = go + loadConductance;
      d1 = v.CL + v.CF;
    } else if (type === 'follower') {
      n0 = v.gm1;
      n1 = v.CGS;
      d0 = v.gm1 + o1 + loadConductance;
      d1 = v.CL + v.CGS;
    } else if (cg && rs === 0) {
      n0 = v.gm1 + o1;
      d0 = o1 + loadConductance;
      d1 = v.CL;
      if (config.sourceResistance && v.CX > 0) warnings.push('RS = 0 shorts the source-input node to ideal drive, so CX is ignored.');
    } else if (type === 'diff-five') {
      const u = go / 2;
      const m = v.gm3;
      const mirror = range(1 / v.ro3, 'mirror output conductance', true);
      const a = range(u + m + mirror, 'mirror reference conductance', true);
      const d = range(u + mirror, 'mirror output-node conductance', true);
      // Factoring a*d - b*c avoids subtracting the common u*u term.
      d0 = product(go + mirror, m + mirror, 'mirror nodal determinant');
      d1 = range(product(a, v.CL, 'output time coefficient') + product(d, v.CX, 'mirror time coefficient'), 'linear denominator', true);
      d2 = product(v.CX, v.CL, 'quadratic denominator');
      n0 = product(g, m + mirror / 2, 'mirror DC numerator');
      n1 = product(g / 2, v.CX, 'mirror feedforward numerator');
      routNumerator = a;
      expectedSecondOrder = v.CX > 0;
    } else {
      let k;
      let internalConductance;
      let outputConductance;
      let lowerConductance;
      if (cg) {
        k = range(v.gm1 + o1, 'common-gate transconductance', true);
        lowerConductance = range(1 / rs, 'series input conductance', true);
        internalConductance = range(lowerConductance + k, 'input-node conductance', true);
        outputConductance = range(o1 + loadConductance, 'output-node conductance', true);
        n0 = product(k, lowerConductance, 'common-gate DC numerator');
      } else {
        const device = type === 'cascode' ? '2' : type === 'diff-cascode' ? '3' : '5';
        const oc = range(1 / v['ro' + device], 'signal cascode output conductance', true);
        k = range(v['gm' + device] + oc, 'signal cascode transconductance', true);
        lowerConductance = go;
        if (type === 'diff-cascode' || type === 'folded-cascode') {
          const outer = type === 'diff-cascode' ? v.ro7 : v.ro9;
          const inner = type === 'diff-cascode' ? v.ro5 : v.ro7;
          const gm = type === 'diff-cascode' ? v.gm5 : v.gm7;
          const loadResistance = range(inner + outer + product(product(gm, inner, 'load cascode intrinsic gain'), outer, 'load cascode resistance'), 'collapsed load resistance', true);
          loadConductance = range(1 / loadResistance, 'collapsed load conductance', true);
        }
        if (type === 'folded-cascode') lowerConductance = range(go + range(1 / v.ro3, 'folding bias conductance', true), 'folding-node shunt conductance', true);
        internalConductance = range(lowerConductance + k, 'internal-node conductance', true);
        outputConductance = range(oc + loadConductance, 'output-node conductance', true);
        n0 = -product(g, k, 'cascode DC numerator');
      }
      // This positive expansion equals x*d - o*k without cancellation of the large cascode terms.
      d0 = range(product(lowerConductance, outputConductance, 'lower-device determinant term') + product(k, loadConductance, 'load determinant term'), 'nodal determinant', true);
      d1 = range(product(internalConductance, v.CL, 'output time coefficient') + product(outputConductance, v.CX, 'internal time coefficient'), 'linear denominator', true);
      d2 = product(v.CX, v.CL, 'quadratic denominator');
      routNumerator = internalConductance;
      expectedSecondOrder = v.CX > 0;
    }
    range(Math.abs(n0), 'DC numerator', true);
    range(n1, 'feedforward numerator');
    range(d0, 'constant denominator', true);
    range(d1, 'linear denominator', true);
    range(d2, 'quadratic denominator', expectedSecondOrder);
    const numerator = [range(n0 / d0, 'normalized DC numerator'), range(n1 / d0, 'normalized feedforward numerator', n1 > 0)];
    const denominator = [1, range(d1 / d0, 'normalized linear denominator', true), range(d2 / d0, 'normalized quadratic denominator', expectedSecondOrder)];
    const gain = numerator[0];
    const magnitude = range(Math.abs(gain), 'DC gain magnitude', true);
    const gainDb = range(20 * Math.log10(magnitude), 'DC gain in decibels');
    const rout = range(routNumerator / d0, 'output resistance', true);
    const gbw = range(Math.exp(Math.log(magnitude) - Math.log(TWO_PI) - Math.log(rout) - Math.log(v.CL)), 'dominant-output-pole GBW estimate', true);
    const poles = characteristicRoots(denominator[1], denominator[2]);
    const zeros = numerator[1] === 0 ? [] : [{ re: range(-numerator[0] / numerator[1], 'finite zero frequency'), im: 0 }];
    const bandwidth = crossing(numerator, denominator, 1, Math.SQRT1_2);
    const weightScale = Math.max(magnitude, 1);
    const unity = crossing(numerator, denominator, magnitude / weightScale, 1 / weightScale);
    if (bandwidth === null) warnings.push('The reduced model has no finite descending −3 dB crossing relative to DC; bandwidth is null.');
    return { metrics: { gain, gainDb, rout, gbw, bandwidth, unity }, poles, zeros, numerator, denominator, warnings };
  }

  const api = Object.freeze({ catalog, describe, calculate });
  root.ICAnalog = api;
  if (typeof module === 'object' && module !== null && module.exports) module.exports = api;
})(globalThis);
