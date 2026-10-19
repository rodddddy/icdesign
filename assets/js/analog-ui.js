(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const ui = {
    type: byId('analog-type'),
    polarity: byId('analog-polarity'),
    source: byId('analog-source-resistance'),
    sourceControl: byId('analog-source-control'),
    load: byId('analog-load'),
    loadControl: byId('analog-load-control'),
    description: byId('analog-description'),
    title: byId('analog-circuit-title'),
    parameters: byId('analog-parameters'),
    schematic: byId('analog-schematic'),
    schematicSize: byId('analog-schematic-size'),
    formulas: byId('analog-formulas'),
    frequencyFormulas: byId('analog-frequency-formulas'),
    assumptions: byId('analog-assumptions'),
    status: byId('analog-status'),
    results: byId('analog-results'),
    warnings: byId('analog-warnings'),
    reset: byId('analog-reset'),
    download: byId('analog-download-svg'),
    downloadStatus: byId('analog-download-status'),
    legend: byId('analog-legend'),
    devices: byId('analog-devices')
  };
  if (!ui.type) return;

  const core = window.ICAnalog;
  const metricNodes = Array.from(ui.results.querySelectorAll('[data-metric]'));
  const fields = new Map();
  let formulaOutputs = [];
  let model = null;
  let schematicAvailable = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function status(text, state) {
    ui.status.textContent = text;
    ui.status.dataset.state = state;
  }

  function clearNumericResults() {
    metricNodes.forEach(node => {
      node.textContent = '—';
      node.classList.remove('analog-no-value');
    });
    formulaOutputs.forEach(({ node }) => { node.textContent = '—'; });
    ui.warnings.replaceChildren();
    ui.warnings.hidden = true;
    ui.results.dataset.valid = 'false';
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function significant(value) {
    return value.toPrecision(4).replace(/^-/, '−');
  }

  const prefixes = new Map([
    [-24, 'y'], [-21, 'z'], [-18, 'a'], [-15, 'f'], [-12, 'p'], [-9, 'n'],
    [-6, 'µ'], [-3, 'm'], [0, ''], [3, 'k'], [6, 'M'], [9, 'G'],
    [12, 'T'], [15, 'P'], [18, 'E'], [21, 'Z'], [24, 'Y']
  ]);

  function engineering(value, unit = '') {
    if (!finite(value)) return 'Unavailable in this model';
    if (value === 0) return `0${unit ? ` ${unit}` : ''}`;
    const magnitude = Math.abs(value);
    let exponent = Math.floor(Math.log10(magnitude) / 3) * 3;
    if (!prefixes.has(exponent)) return `${significant(value)}${unit ? ` ${unit}` : ''}`;
    let scaled = Number((magnitude / (10 ** exponent)).toPrecision(4));
    if (scaled >= 1000) {
      exponent += 3;
      scaled /= 1000;
    }
    if (!prefixes.has(exponent)) return `${significant(value)}${unit ? ` ${unit}` : ''}`;
    const suffix = `${prefixes.get(exponent)}${unit}`;
    return `${value < 0 ? '−' : ''}${scaled.toPrecision(4)}${suffix ? ` ${suffix}` : ''}`;
  }

  function metricValue(key, metrics) {
    const value = metrics && metrics[key];
    if (key === 'bandwidth' || key === 'unity' || key === 'gbw') {
      if (value === null) return 'No crossing in this model';
      return engineering(value, 'Hz');
    }
    if (!finite(value)) return 'Unavailable in this model';
    if (key === 'gainDb') return `${significant(value)} dB`;
    if (key === 'gain') return engineering(value, 'V/V');
    if (key === 'rout') return engineering(value, 'Ω');
    return engineering(value);
  }

  function rootValues(roots, kind) {
    if (!Array.isArray(roots)) return 'Unavailable in this model';
    if (roots.length === 0) return kind === 'zeros' ? 'No finite zero in this model' : 'No finite pole in this model';
    const prefix = kind === 'zeros' ? 'z' : 'p';
    return roots.map((root, index) => {
      if (!root || !finite(root.re) || !finite(root.im)) return `${prefix}${index + 1}: unavailable`;
      let location = engineering(root.re, 'rad/s');
      if (root.im !== 0) {
        location += ` ${root.im < 0 ? '−' : '+'} j${engineering(Math.abs(root.im), 'rad/s')}`;
      }
      const frequency = Math.hypot(root.re / (2 * Math.PI), root.im / (2 * Math.PI));
      return `${prefix}${index + 1} = ${location}  (|s|/2π = ${engineering(frequency, 'Hz')})`;
    }).join('\n');
  }

  function mathElement(tag, ...children) {
    const node = document.createElementNS('http://www.w3.org/1998/Math/MathML', tag);
    children.forEach(child => node.append(typeof child === 'string' ? document.createTextNode(child) : child));
    return node;
  }

  function mathSymbol(name) {
    const special = { Av: ['A', 'v'], AdB: ['A', 'dB'], p12: ['p', '1,2'], f3dB: ['f', '−3dB'], log10: ['log', '10'] };
    const match = special[name] || (/^(gm|ro)(.+)$/.test(name)
      ? [name[0], name.slice(1)] : name.match(/^([RCMIfpza])(.+)$/)?.slice(1));
    if (match) return mathElement('msub', mathElement('mi', match[0]), mathElement('mn', match[1]));
    return mathElement('mi', name);
  }

  function mathTree(tree, parentPrecedence = 0) {
    if (typeof tree === 'number') return mathElement('mn', String(tree));
    if (typeof tree === 'string') return mathSymbol(tree);
    const [op, ...args] = tree;
    const mo = value => mathElement('mo', value);
    const bracket = node => mathElement('mrow', mo('('), node, mo(')'));
    const precedence = { eq: 1, approx: 1, pm: 2, add: 2, parallel: 3, mul: 4, neg: 5, pow: 6 };
    let node;
    if (op === 'div') node = mathElement('mfrac', ...args.map(arg => mathTree(arg)));
    else if (op === 'sqrt') node = mathElement('msqrt', mathTree(args[0]));
    else if (op === 'pow') node = mathElement('msup', mathTree(args[0], 6), mathTree(args[1]));
    else if (op === 'neg') node = mathElement('mrow', mo('−'), mathTree(args[0], 4));
    else if (op === 'abs') node = mathElement('mrow', mo('|'), mathTree(args[0]), mo('|'));
    else if (op === 'call') node = mathElement('mrow', mathSymbol(args[0]), bracket(mathTree(args[1])));
    else if (op === 'text') node = mathElement('mtext', args[0]);
    else if (op === 'number') {
      const [mantissa, exponent] = args[0].split('e');
      node = exponent === undefined ? mathElement('mn', mantissa)
        : mathElement('mrow', mathElement('mn', mantissa), mo('×'), mathElement('msup', mathElement('mn', '10'), mathElement('mn', String(Number(exponent)).replace('-', '−'))));
    } else {
      const operators = { eq: '=', approx: '≈', pm: '±', add: '+', parallel: '∥', mul: '⁢' };
      if (!Object.hasOwn(operators, op)) throw new Error('Unknown math operation: ' + op);
      node = mathElement('mrow');
      args.forEach((arg, index) => {
        if (op === 'add' && index > 0 && Array.isArray(arg) && arg[0] === 'neg') {
          node.append(mo('−'), mathTree(arg[1], precedence[op]));
        } else {
          if (index > 0) node.append(mo(operators[op]));
          node.append(mathTree(arg, precedence[op]));
        }
      });
    }
    return (precedence[op] || 7) < parentPrecedence ? bracket(node) : node;
  }

  function mathDisplay(tree) {
    const wrapper = element('div', 'analog-expression');
    wrapper.tabIndex = 0;
    wrapper.setAttribute('aria-label', 'Equation; scroll horizontally if needed');
    const math = mathElement('math', mathTree(tree));
    math.setAttribute('display', 'block');
    wrapper.append(math);
    return wrapper;
  }

  function polynomial(coefficients) {
    const terms = [];
    coefficients.forEach((coefficient, power) => {
      if (coefficient === 0) return;
      let term = ['number', significant(Math.abs(coefficient))];
      if (power > 0) term = ['mul', term, power === 1 ? 's' : ['pow', 's', power]];
      terms.push(coefficient < 0 ? ['neg', term] : term);
    });
    return terms.length ? ['add', ...terms] : 0;
  }

  function resultValue(key, result, unit) {
    if (key === 'poles' || key === 'zeros') return rootValues(result[key], key);
    if (['gain', 'gainDb', 'rout', 'gbw', 'bandwidth', 'unity'].includes(key)) return metricValue(key, result.metrics);
    return engineering(result.metrics && result.metrics[key], unit || '');
  }

  function buildFormulas() {
    formulaOutputs = [];
    ui.formulas.replaceChildren();
    ui.frequencyFormulas.replaceChildren();
    model.formulas.forEach(formula => {
      const row = element('div');
      const label = element('dt', '', formula.label);
      const detail = element('dd');
      detail.append(mathDisplay(formula.math));
      if (formula.key !== null) {
        const output = element('output', 'analog-derived-value', '—');
        output.dataset.result = formula.key;
        detail.append(output);
        formulaOutputs.push({ key: formula.key, unit: formula.unit, node: output });
      }
      if (formula.note) detail.append(element('p', 'analog-formula-note', formula.note));
      row.append(label, detail);
      (formula.detail ? ui.frequencyFormulas : ui.formulas).append(row);
    });
  }

  function updateAssumptions() {
    const fragment = document.createDocumentFragment();
    (model.assumptions || []).forEach(assumption => fragment.append(element('li', '', assumption)));
    ui.assumptions.replaceChildren(fragment);
  }

  function inputString(value) {
    return finite(value) ? String(Number(value.toPrecision(15))) : '';
  }

  function rememberParameters() {
    const previous = new Map();
    fields.forEach(({ input, parameter }, key) => {
      previous.set(key, { raw: input.value, scale: parameter.scale });
    });
    return previous;
  }

  function buildParameters(previous) {
    fields.clear();
    const fragment = document.createDocumentFragment();
    const groups = new Map();
    model.parameters.forEach((parameter, index) => {
      const groupName = parameter.group || 'Model parameters';
      if (!groups.has(groupName)) {
        const group = element('fieldset', 'analog-parameter-group');
        group.append(element('legend', '', groupName));
        groups.set(groupName, group);
        fragment.append(group);
      }
      const field = element('div', 'analog-field');
      const label = element('label');
      const id = `analog-param-${index}`;
      label.htmlFor = id;
      const symbol = element('span', 'analog-symbol');
      symbol.append(mathElement('math', mathSymbol(parameter.symbol)));
      label.append(symbol, element('span', '', parameter.label));
      const inputRow = element('div', 'analog-input-row');
      const input = element('input');
      input.type = 'number';
      input.step = 'any';
      input.min = '0';
      input.required = true;
      input.autocomplete = 'off';
      input.id = id;
      input.dataset.param = parameter.key;
      const saved = previous && previous.get(parameter.key);
      if (saved) {
        input.value = saved.raw;
        if (saved.scale !== parameter.scale && saved.raw.trim() !== '' && Number.isFinite(Number(saved.raw))) {
          input.value = inputString(Number(saved.raw) * saved.scale / parameter.scale);
        }
      } else {
        input.value = inputString(parameter.default / parameter.scale);
      }
      const unit = element('span', 'analog-unit', parameter.unit || '1');
      unit.id = `${id}-unit`;
      const hint = element('p', 'analog-field-hint');
      hint.id = `${id}-hint`;
      input.setAttribute('aria-describedby', `${unit.id} ${hint.id}`);
      inputRow.append(input, unit);
      field.append(label, inputRow, hint);
      groups.get(groupName).append(field);
      fields.set(parameter.key, { input, parameter, field, hint });
    });
    ui.parameters.replaceChildren(fragment);
  }

  function readValues() {
    const values = Object.create(null);
    const invalid = [];
    fields.forEach(({ input, parameter, field, hint }) => {
      const raw = input.value.trim();
      const displayed = raw === '' ? NaN : Number(raw);
      const value = displayed * parameter.scale;
      const valid = raw !== '' && !input.validity.badInput && finite(displayed) && finite(value)
        && (parameter.positive ? value > 0 : value >= 0);
      const constraint = parameter.positive ? 'greater than 0' : '0 or greater';
      input.setCustomValidity(valid ? '' : `Enter a finite value ${constraint}.`);
      input.setAttribute('aria-invalid', String(!valid));
      field.classList.toggle('invalid', !valid);
      hint.textContent = valid ? (parameter.positive ? 'Must be > 0.' : 'May be 0.') : `Enter a finite value ${constraint}.`;
      if (valid) values[parameter.key] = value;
      else invalid.push(parameter.symbol || parameter.label || parameter.key);
    });
    return { values, invalid };
  }

  function calculate() {
    if (!model) return;
    const { values, invalid } = readValues();
    clearNumericResults();
    if (invalid.length) {
      status(`Complete or correct: ${invalid.join(', ')}. All numeric results are cleared; equations and the schematic remain available.`, 'invalid');
      return;
    }
    try {
      const result = core.calculate(model.config, values);
      if (!result || !result.metrics) throw new Error('The calculator returned no metrics.');
      metricNodes.forEach(node => {
        const key = node.dataset.metric;
        node.textContent = metricValue(key, result.metrics);
        node.classList.toggle('analog-no-value', !finite(result.metrics[key]));
      });
      formulaOutputs.forEach(({ key, unit, node }) => {
        if (key === 'transfer') {
          node.replaceChildren(mathDisplay(['approx', ['call', 'H', 's'], ['div', polynomial(result.numerator), polynomial(result.denominator)]]));
        } else node.textContent = resultValue(key, result, unit);
      });
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      warnings.forEach(warning => ui.warnings.append(element('li', '', warning)));
      ui.warnings.hidden = warnings.length === 0;
      ui.results.dataset.valid = 'true';
      let message = 'Updated automatically from the current small-signal values. These estimates do not verify bias or saturation.';
      if (warnings.length) message += ' Review the model warnings below.';
      if (!schematicAvailable) message += ' The schematic renderer is unavailable; calculations are still shown.';
      status(message, 'valid');
    } catch (error) {
      clearNumericResults();
      status('Calculation unavailable for these values. Check parameter magnitudes and model limits; equations and the schematic remain available.', 'error');
      console.error('Analog calculation failed:', error);
    }
  }

  function updateSchematic() {
    schematicAvailable = false;
    ui.download.disabled = true;
    ui.schematicSize.disabled = true;
    ui.downloadStatus.textContent = '';
    ui.legend.hidden = true;
    ui.devices.replaceChildren();
    try {
      const renderer = window.ICAnalogSchematic;
      if (!renderer || typeof renderer.render !== 'function') throw new Error('Schematic renderer is not loaded.');
      const rendered = renderer.render(model.config);
      if (!rendered || typeof rendered.svg !== 'string' || !rendered.svg.trim()) throw new Error('Schematic renderer returned no SVG.');
      ui.schematic.innerHTML = rendered.svg;
      const svg = ui.schematic.querySelector('svg');
      if (!svg) throw new Error('Schematic renderer returned no SVG element.');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `${model.title} schematic`);
      svg.style.setProperty('--analog-svg-width', `${rendered.width}px`);
      ui.schematic.scrollLeft = 0;
      ui.schematic.scrollTop = 0;
      const devices = Array.isArray(rendered.devices) ? rendered.devices : [];
      devices.forEach(device => {
        const row = element('div');
        row.append(element('dt', '', device.name), element('dd', '', device.description));
        ui.devices.append(row);
      });
      ui.legend.hidden = devices.length === 0;
      schematicAvailable = true;
      ui.download.disabled = false;
      ui.schematicSize.disabled = false;
    } catch (error) {
      ui.schematic.replaceChildren(element('p', 'analog-placeholder', 'The schematic could not be loaded. Equations and parameter calculations are available independently.'));
      console.error('Analog schematic failed:', error);
    }
  }

  function rawConfig() {
    return {
      type: ui.type.value,
      polarity: ui.polarity.value,
      sourceResistance: ui.source.checked,
      load: ui.load.value
    };
  }

  function updateConfiguration(resetParameters) {
    const previous = resetParameters ? null : rememberParameters();
    clearNumericResults();
    try {
      model = core.describe(rawConfig());
      const config = model.config;
      const entry = core.catalog.find(item => item.id === config.type);
      ui.type.value = config.type;
      ui.polarity.value = config.polarity;
      ui.source.checked = Boolean(config.sourceResistance);
      ui.load.value = config.load;
      ui.sourceControl.hidden = !entry || !entry.sourceOption || config.type === 'follower';
      ui.source.disabled = ui.sourceControl.hidden;
      ui.loadControl.hidden = !entry || !entry.loadOption;
      ui.load.disabled = ui.loadControl.hidden;
      ui.description.textContent = entry ? entry.description : '';
      ui.title.textContent = model.title;
      ui.reset.disabled = false;
      buildParameters(previous);
      buildFormulas();
      updateAssumptions();
      updateSchematic();
      calculate();
    } catch (error) {
      model = null;
      fields.clear();
      formulaOutputs = [];
      ui.parameters.replaceChildren();
      ui.formulas.replaceChildren();
      ui.frequencyFormulas.replaceChildren();
      ui.assumptions.replaceChildren();
      ui.schematic.replaceChildren(element('p', 'analog-placeholder', 'This circuit configuration is unavailable.'));
      ui.legend.hidden = true;
      ui.title.textContent = 'Circuit unavailable';
      ui.description.textContent = '';
      ui.reset.disabled = true;
      ui.download.disabled = true;
      ui.schematicSize.disabled = true;
      clearNumericResults();
      status('The circuit model could not be loaded. Choose another topology or reload the page.', 'error');
      console.error('Analog configuration failed:', error);
    }
  }

  function downloadSchematic() {
    if (!model || !schematicAvailable) return;
    let url = null;
    let link = null;
    try {
      // The white-theme export is independently rendered; no user input is concatenated into SVG.
      const rendered = window.ICAnalogSchematic.render(model.config, true);
      if (!rendered || typeof rendered.svg !== 'string' || !rendered.svg.trim()) throw new Error('No SVG to download.');
      const blob = new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' });
      url = URL.createObjectURL(blob);
      const config = model.config;
      const name = ['analog', config.type, config.polarity, config.load, config.sourceResistance ? 'source-r' : ''].filter(Boolean).join('-');
      link = element('a');
      link.download = `${name.replace(/[^a-z0-9-]/gi, '-')}.svg`;
      link.href = url;
      link.hidden = true;
      document.body.append(link);
      link.click();
      ui.downloadStatus.textContent = 'SVG download requested. The export uses a white background.';
    } catch (error) {
      ui.downloadStatus.textContent = 'SVG download could not be prepared. Please try again.';
      console.error('Analog SVG download failed:', error);
    } finally {
      if (link) link.remove();
      // Allow the browser to consume the Blob before releasing its URL.
      if (url) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  if (!core || !Array.isArray(core.catalog) || !core.catalog.length
      || typeof core.describe !== 'function' || typeof core.calculate !== 'function') {
    clearNumericResults();
    status('The analog calculation module is unavailable. Reload the page after all tool assets have loaded.', 'error');
    ui.schematic.replaceChildren(element('p', 'analog-placeholder', 'The circuit model is not loaded.'));
    [ui.type, ui.polarity, ui.source, ui.load].forEach(control => { control.disabled = true; });
    return;
  }

  const options = document.createDocumentFragment();
  core.catalog.forEach(entry => {
    const option = element('option', '', entry.label);
    option.value = entry.id;
    options.append(option);
  });
  ui.type.replaceChildren(options);
  ui.type.value = core.catalog.some(entry => entry.id === 'cs') ? 'cs' : core.catalog[0].id;
  ui.type.addEventListener('change', () => updateConfiguration(true));
  [ui.polarity, ui.source, ui.load].forEach(control => {
    control.addEventListener('change', () => updateConfiguration(false));
  });
  // Input changes update validation and outputs only, never replace parameter nodes or focus.
  ui.parameters.addEventListener('input', event => {
    if (event.target.matches('input[data-param]')) calculate();
  });
  ui.reset.addEventListener('click', () => {
    if (!model) return;
    fields.forEach(({ input, parameter }) => { input.value = inputString(parameter.default / parameter.scale); });
    calculate();
  });
  ui.download.addEventListener('click', downloadSchematic);
  ui.schematicSize.addEventListener('click', () => {
    const actualSize = ui.schematic.classList.toggle('analog-actual-size');
    ui.schematicSize.textContent = actualSize ? 'Fit diagram' : 'Actual size';
    ui.schematicSize.setAttribute('aria-pressed', String(actualSize));
    ui.schematic.scrollLeft = 0;
    ui.schematic.scrollTop = 0;
  });
  updateConfiguration(true);
})();
