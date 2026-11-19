(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const ui = {
    taps: byId('dv-taps'), addTap: byId('dv-add-tap'),
    tabs: Array.from(document.querySelectorAll('.divider-page .mode-tab[data-mode]')),
    topologyTabs: Array.from(document.querySelectorAll('.divider-page [data-topology]')),
    modeNote: byId('dv-mode-note'),
    currentFields: byId('dv-current-fields'), resistanceFields: byId('dv-resistance-fields'),
    iMin: byId('dv-i-min'), iMax: byId('dv-i-max'), iUnit: byId('dv-i-unit'),
    vMin: byId('dv-v-min'), vMax: byId('dv-v-max'),
    rMin: byId('dv-r-min'), rMax: byId('dv-r-max'), rUnit: byId('dv-r-unit'),
    range: byId('dv-range'), limitWarning: byId('dv-limit-warning'),
    ru: byId('dv-ru'), ruUnit: byId('dv-ru-unit'), parallel: byId('dv-parallel'), tol: byId('dv-tol'),
    schematic: byId('dv-schematic'), downloadSvg: byId('dv-download-svg'), downloadPng: byId('dv-download-png'),
    downloadStatus: byId('dv-download-status'),
    status: byId('dv-status'), warnings: byId('dv-warnings'), output: byId('dv-output'),
    solutions: byId('dv-solutions'), summary: byId('dv-summary'), tapResults: byId('dv-tap-results'), segments: byId('dv-segments')
  };
  if (!ui.taps) return;

  const core = window.ICDivider;
  const drawer = window.ICDividerSchematic;
  const fmt = (value, unit) => core.formatValue(value, unit);
  let mode = 'current';
  let topology = 'taps';
  let result = null;
  let selected = -1;
  let timer = 0;
  let driver = 'current';
  const editedVoltageLimits = new Set();

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

  function number(input) {
    const raw = input.value.trim();
    const value = raw === '' || input.validity.badInput ? NaN : Number(raw);
    return value;
  }

  function mark(input, valid) {
    input.classList.toggle('invalid', !valid);
    input.setAttribute('aria-invalid', String(!valid));
    return valid;
  }

  const positive = input => { const v = number(input); return mark(input, Number.isFinite(v) && v > 0) ? v : NaN; };
  const ratioText = k => Number(k.toPrecision(6)).toString();

  function errorText(e) {
    if (Math.abs(e) < 1e-12) return 'exact';
    const sign = e > 0 ? '+' : '−';
    const a = Math.abs(e);
    return a >= 1e-4 ? sign + Number((a * 100).toPrecision(3)) + '%' : sign + Number((a * 1e6).toPrecision(3)) + ' ppm';
  }

  function arrangement(segment) {
    const parts = segment.n ? [segment.n + ' in series'] : [];
    segment.groups.forEach(({ count, parallel }) => parts.push(count + ' × (' + parallel + ' in parallel)'));
    return parts.join(' + ');
  }

  function renumber() {
    const rows = Array.from(ui.taps.rows);
    rows.forEach((row, i) => {
      const name = row.querySelector('.dv-tap-name');
      if (name && !name.dataset.custom) name.value = 'TAP' + (i + 1);
      row.querySelector('button').disabled = rows.length === 1;
    });
    ui.addTap.disabled = rows.length >= core.MAX_TAPS;
  }

  function updateRowRatio(row) {
    const [trip, ref] = row.querySelectorAll('input[type="number"]');
    const vt = number(trip), vr = number(ref);
    row.querySelector('output').textContent = vt > 0 && vr > 0 && vr < vt ? ratioText(vr / vt) : '—';
  }

  function addTap(vTrip, vRef) {
    const row = element('tr');
    const head = element('th');
    const name = element('input', 'dv-tap-name');
    name.type = 'text';
    name.maxLength = 16;
    name.value = 'TAP' + (ui.taps.rows.length + 1);
    name.setAttribute('aria-label', 'Tap name');
    name.addEventListener('input', () => { name.dataset.custom = '1'; schedule(); });
    name.addEventListener('change', () => {
      if (name.value.trim()) return;
      delete name.dataset.custom;
      renumber();
      schedule();
    });
    head.append(name);
    row.append(head);
    [['Target voltage', vTrip], ['Reference voltage', vRef]].forEach(([label, value]) => {
      const cell = element('td');
      const input = element('input');
      input.type = 'number'; input.step = 'any'; input.min = '0'; input.value = value;
      input.setAttribute('aria-label', label);
      cell.append(input);
      row.append(cell);
    });
    const ratio = element('td');
    ratio.append(element('output', 'dv-ratio', '—'));
    const remove = element('td');
    const button = element('button', 'btn-mini remove', '×');
    button.type = 'button';
    button.title = 'Remove tap';
    button.setAttribute('aria-label', 'Remove tap');
    button.addEventListener('click', () => { row.remove(); renumber(); schedule(); });
    remove.append(button);
    row.append(ratio, remove);
    ui.taps.append(row);
    updateRowRatio(row);
    renumber();
  }

  function setMode(next) {
    mode = next;
    ui.tabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.mode === mode)));
    ui.currentFields.hidden = mode !== 'current';
    ui.resistanceFields.hidden = mode !== 'resistance';
  }

  const topologyNotes = {
    hybrid: 'One tap is taken straight out with no switch closed; every other tap closes its own switch. The solver picks which tap stays plain, minimizing unit resistors first and switches second. Only one switch is closed at a time.'
  };

  function setTopology(next) {
    topology = ['taps', 'hybrid'].includes(next) ? next : 'taps';
    ui.topologyTabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.topology === topology)));
    ui.modeNote.hidden = topology === 'taps';
    ui.modeNote.textContent = topologyNotes[topology] || '';
  }

  function updateVoltageDefaults() {
    const targets = Array.from(ui.taps.rows).map(row => number(row.querySelector('input'))).filter(value => Number.isFinite(value) && value > 0);
    if (!targets.length) return;
    if (!editedVoltageLimits.has(ui.vMin)) ui.vMin.value = Number((Math.min(...targets) * 0.8).toPrecision(12));
    if (!editedVoltageLimits.has(ui.vMax)) ui.vMax.value = Number((Math.max(...targets) * 1.2).toPrecision(12));
  }

  const scaled = (input, select) => number(input) * Number(select.value);

  function writeRange(minInput, maxInput, select, min, max) {
    const scales = Array.from(select.options, option => Number(option.value));
    let scale = Number(select.value);
    const fits = value => value / scale >= 0.01 && value / scale < 1e4;
    if (!fits(min) || !fits(max)) {
      scale = scales.filter(s => max / s >= 1).pop() || scales[0];
      select.selectedIndex = scales.indexOf(scale);
    }
    minInput.value = Number((min / scale).toPrecision(6));
    maxInput.value = Number((max / scale).toPrecision(6));
  }

  function syncLimits() {
    const vMin = number(ui.vMin), vMax = number(ui.vMax);
    if (!(vMin > 0 && vMax > 0)) return;
    if (driver === 'current') {
      const iMin = scaled(ui.iMin, ui.iUnit), iMax = scaled(ui.iMax, ui.iUnit);
      if (iMin > 0 && iMax > 0) writeRange(ui.rMin, ui.rMax, ui.rUnit, vMax / iMax, vMin / iMin);
    } else {
      const rMin = scaled(ui.rMin, ui.rUnit), rMax = scaled(ui.rMax, ui.rUnit);
      if (rMin > 0 && rMax > 0) writeRange(ui.iMin, ui.iMax, ui.iUnit, vMin / rMax, vMax / rMin);
    }
  }

  function showLimitWarning() {
    const vMin = number(ui.vMin), vMax = number(ui.vMax);
    const iMin = scaled(ui.iMin, ui.iUnit), iMax = scaled(ui.iMax, ui.iUnit);
    const rMin = vMax / iMax, rMax = vMin / iMin;
    const conflict = vMin > 0 && vMax >= vMin && iMin > 0 && iMax >= iMin && rMin > rMax * (1 + 1e-9);
    ui.limitWarning.hidden = !conflict;
    ui.limitWarning.replaceChildren();
    if (!conflict) return false;
    const times = value => Number(value.toPrecision(3)) + '×';
    const list = element('ul');
    [
      'At VIN = ' + fmt(vMax, 'V') + ', I ≤ ' + fmt(iMax, 'A') + ' needs R ≥ ' + fmt(rMin, 'Ω') + '.',
      'At VIN = ' + fmt(vMin, 'V') + ', I ≥ ' + fmt(iMin, 'A') + ' needs R ≤ ' + fmt(rMax, 'Ω') + '.',
      'VIN varies ' + times(vMax / vMin) + ', but IMAX / IMIN is only ' + times(iMax / iMin) + '.',
      'Raise the maximum current to at least ' + fmt(iMin * vMax / vMin, 'A') + ', lower the minimum current to at most ' + fmt(iMax * vMin / vMax, 'A') + ', or narrow the VIN range.'
    ].forEach(text => list.append(element('li', '', text)));
    ui.limitWarning.append(element('strong', '', 'No total resistance meets these current limits.'), list);
    mark(ui.iMin, false);
    mark(ui.iMax, false);
    return true;
  }

  function readInput() {
    let valid = true;
    const taps = Array.from(ui.taps.rows).map(row => {
      const [trip, ref] = row.querySelectorAll('input[type="number"]');
      const vTrip = positive(trip), vRef = positive(ref);
      if (!(vTrip > 0 && vRef > 0)) valid = false;
      return { name: row.querySelector('.dv-tap-name').value.trim(), vTrip, vRef };
    });
    const pair = mode === 'current' ? [ui.iMin, ui.iMax, ui.iUnit] : [ui.rMin, ui.rMax, ui.rUnit];
    [ui.iMin, ui.iMax, ui.rMin, ui.rMax].forEach(input => { if (!pair.includes(input)) mark(input, true); });
    const scale = Number(pair[2].value);
    const min = positive(pair[0]) * scale, max = positive(pair[1]) * scale;
    const unit = positive(ui.ru) * Number(ui.ruUnit.value);
    const vMin = positive(ui.vMin), vMax = positive(ui.vMax);
    if (!(vMin > 0 && vMax > 0)) valid = false;
    const maxParallel = number(ui.parallel);
    if (!mark(ui.parallel, Number.isInteger(maxParallel) && maxParallel >= 1 && maxParallel <= 100)) valid = false;
    const tolRaw = number(ui.tol);
    const tolerance = mark(ui.tol, Number.isFinite(tolRaw) && tolRaw >= 0 && tolRaw < 100) ? tolRaw / 100 : NaN;
    if (!(min > 0 && max > 0 && unit > 0 && tolerance >= 0)) valid = false;
    return valid ? { taps, constraint: { mode, min, max, vMin, vMax }, unit, maxParallel, tolerance, topology } : null;
  }

  function clearOutput() {
    result = null;
    selected = -1;
    ui.output.hidden = true;
    ui.warnings.hidden = true;
    ui.warnings.replaceChildren();
    ui.downloadSvg.disabled = true;
    ui.downloadPng.disabled = true;
    ui.downloadStatus.textContent = '';
  }

  function placeholder(text) {
    ui.schematic.replaceChildren(element('p', 'dv-placeholder', text));
  }

  function cells(row, values) {
    values.forEach(value => row.append(element('td', '', value)));
    return row;
  }

  function chip(label, value) {
    const node = element('span', 'stat-chip');
    node.append(element('span', '', label), document.createTextNode(' '), element('b', '', value));
    return node;
  }

  function rangeText(min, max, unit) {
    return min === max ? fmt(max, unit) : fmt(min, unit) + ' – ' + fmt(max, unit);
  }

  function showSolution(index) {
    selected = index;
    const s = result.solutions[index];
    Array.from(ui.solutions.rows).forEach((row, i) => {
      row.classList.toggle('selected', i === index);
      row.querySelector('input').checked = i === index;
    });
    const chips = [
      chip('Unit resistors', s.units),
      chip('Total resistance', fmt(s.totalR, 'Ω') + ' = ' + Number(s.totalUnits.toPrecision(10)) + ' Ru'),
      chip('String current', rangeText(s.currentMin, s.current, 'A') + ' @ ' + rangeText(result.vMin, result.vMax, 'V')),
      chip('Power', fmt(s.power, 'W') + ' @ ' + fmt(result.vMax, 'V')),
      chip('Max trip error', errorText(s.maxError))
    ];
    if (s.switchCount) {
      chips.push(
        chip('Bypass switches', s.switchCount),
        chip('Switch select signals', s.switches.map(sw => sw.name + ' = ' + sw.selectSignal).join(', ')),
        chip('Resistance across states', rangeText(s.totalRMin, s.totalRMax, 'Ω'))
      );
    }
    ui.summary.replaceChildren(...chips);
    ui.tapResults.replaceChildren(...s.taps.map(tap => {
      const row = element('tr');
      row.append(element('th', '', tap.name));
      return cells(row, [fmt(tap.vTrip, 'V'), fmt(tap.vRef, 'V'), ratioText(tap.ratio),
        tap.num + '/' + tap.den + ' = ' + ratioText(tap.achieved), fmt(tap.tripActual, 'V'), errorText(tap.error), fmt(tap.currentAtTrip, 'A'),
        tap.switch ? tap.switch.name + ': ' + tap.switch.from + ' → ' + tap.switch.to + ' · ' + fmt(tap.switch.effectiveR, 'Ω') : '—',
        tap.selectCode ? s.selectBus + ' = ' + tap.selectCode : '—']);
    }));
    ui.segments.replaceChildren(...s.segments.map(segment => {
      const row = element('tr');
      row.append(element('th', '', segment.name));
      return cells(row, [segment.top + ' – ' + segment.bottom, segment.composition, arrangement(segment), segment.units, fmt(segment.resistance, 'Ω'),
        segment.bypass ? segment.bypass.join(', ') : '—']);
    }));
    try {
      const rendered = drawer.render(s, false, fmt);
      ui.schematic.innerHTML = rendered.svg;
      const svg = ui.schematic.querySelector('svg');
      svg.style.setProperty('--dv-svg-width', rendered.width + 'px');
      ui.downloadSvg.disabled = false;
      ui.downloadPng.disabled = false;
    } catch (error) {
      placeholder('The schematic could not be drawn. The tables above are still valid.');
      console.error('Divider schematic failed:', error);
    }
  }

  function solveNow() {
    timer = 0;
    ui.taps.querySelectorAll('tr').forEach(updateRowRatio);
    updateVoltageDefaults();
    syncLimits();
    const input = readInput();
    showLimitWarning();
    clearOutput();
    ui.range.textContent = '—';
    if (!input) {
      status('Complete or correct the highlighted fields. Voltages, currents and resistances must be greater than 0; parallel count must be an integer from 1 to 100; trip voltage tolerance must be from 0 to below 100%.', 'invalid');
      placeholder('Waiting for valid inputs.');
      return;
    }
    let solved;
    try {
      solved = core.solve(input);
    } catch (error) {
      status('The solver failed for these inputs. Check the values and try again.', 'error');
      placeholder('No schematic.');
      console.error('Divider solve failed:', error);
      return;
    }
    if (Number.isFinite(solved.rMin) && solved.rMin <= solved.rMax * (1 + 1e-9)) {
      ui.range.textContent = fmt(solved.rMin, 'Ω') + ' – ' + fmt(solved.rMax, 'Ω') + '  (' + Number(solved.tMin.toPrecision(6)) + ' – ' + Number(solved.tMax.toPrecision(6)) + ' Ru)';
    }
    solved.warnings.forEach(text => ui.warnings.append(element('li', '', text)));
    ui.warnings.hidden = !solved.warnings.length;
    if (solved.errors.length) {
      const list = element('ul', 'dv-errors');
      solved.errors.forEach(text => list.append(element('li', '', text)));
      status('', 'error');
      ui.status.replaceChildren(list);
      placeholder('No schematic.');
      return;
    }
    result = solved;
    ui.solutions.replaceChildren(...solved.solutions.map((s, i) => {
      const row = element('tr');
      const cell = element('th');
      const label = element('label', 'dv-pick');
      const radio = element('input');
      radio.type = 'radio'; radio.name = 'dv-solution'; radio.value = String(i);
      radio.addEventListener('change', () => showSolution(i));
      label.append(radio, element('span', '', '#' + (i + 1)));
      cell.append(label);
      row.append(cell);
      row.addEventListener('click', event => { if (!event.target.closest('label')) { radio.checked = true; showSolution(i); } });
      return cells(row, [s.units, s.switchCount, fmt(s.totalR, 'Ω'), rangeText(s.currentMin, s.current, 'A'), errorText(s.maxError)]);
    }));
    ui.output.hidden = false;
    status(solved.withinTolerance
      ? 'Updated automatically. Solutions found within the trip voltage tolerance are listed by unit resistor count, then by switch count.'
      : 'No solution was found within the trip voltage tolerance. The most accurate solutions found are listed instead.', solved.withinTolerance ? 'valid' : 'warning');
    showSolution(solved.selected);
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(solveNow, 120);
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.download = filename;
    link.href = url;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function toPng(rendered) {
    const url = URL.createObjectURL(new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The schematic image could not be rendered.'));
        image.src = url;
      });
      const canvas = element('canvas');
      canvas.width = rendered.width * 2;
      canvas.height = rendered.height * 2;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The PNG could not be encoded.');
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function download(format) {
    if (!result || selected < 0) return;
    const label = format.toUpperCase();
    try {
      const s = result.solutions[selected];
      const rendered = drawer.render(s, true, fmt);
      const blob = format === 'png' ? await toPng(rendered) : new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' });
      saveBlob(blob, 'resistor-divider-' + s.units + 'u' + (s.switchCount ? '-' + s.switchCount + 'sw' : '') + '.' + format);
      ui.downloadStatus.textContent = label + ' download requested. The export uses a white background.';
    } catch (error) {
      ui.downloadStatus.textContent = label + ' download could not be prepared. Please try again.';
      console.error('Divider ' + label + ' download failed:', error);
    }
  }

  if (!core || !drawer) {
    status('The divider solver is unavailable. Reload the page after all tool assets have loaded.', 'error');
    placeholder('No schematic.');
    return;
  }

  function bindSchematicHover() {
    const highlight = target => {
      const svg = ui.schematic.querySelector('svg');
      if (!svg) return;
      const item = target instanceof Element ? target.closest('[data-hit], [data-net]') : null;
      const net = item && svg.contains(item) ? item.dataset.hit || item.dataset.net : null;
      svg.querySelectorAll('.net-active').forEach(el => el.classList.remove('net-active'));
      if (net) svg.querySelectorAll('[data-net]').forEach(el => {
        if (el.dataset.net === net) el.classList.add('net-active');
      });
    };
    ui.schematic.addEventListener('pointerover', event => highlight(event.target));
    ui.schematic.addEventListener('pointerout', event => highlight(event.relatedTarget));
    ui.schematic.addEventListener('pointerleave', () => highlight(null));
  }

  [[5, 1.2], [4, 1.2]].forEach(([vt, vr]) => addTap(vt, vr));
  bindSchematicHover();
  ui.addTap.addEventListener('click', () => {
    const rows = ui.taps.rows;
    const numbers = rows.length ? rows[rows.length - 1].querySelectorAll('input[type="number"]') : [];
    addTap('', numbers.length ? numbers[1].value : '');
    ui.taps.rows[ui.taps.rows.length - 1].querySelector('input[type="number"]').focus();
    schedule();
  });
  ui.tabs.forEach(tab => tab.addEventListener('click', () => { setMode(tab.dataset.mode); solveNow(); }));
  ui.topologyTabs.forEach(tab => tab.addEventListener('click', () => { setTopology(tab.dataset.topology); solveNow(); }));
  document.querySelector('.dv-inputs').addEventListener('input', event => {
    if (event.target === ui.vMin || event.target === ui.vMax) editedVoltageLimits.add(event.target);
    if ([ui.iMin, ui.iMax, ui.iUnit].includes(event.target)) driver = 'current';
    if ([ui.rMin, ui.rMax, ui.rUnit].includes(event.target)) driver = 'resistance';
    schedule();
  });
  document.querySelector('.dv-inputs').addEventListener('change', event => { if (event.target.tagName === 'SELECT') solveNow(); });
  ui.downloadSvg.addEventListener('click', () => download('svg'));
  ui.downloadPng.addEventListener('click', () => download('png'));
  setMode('current');
  setTopology('taps');
  solveNow();
})();
