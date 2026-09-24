/* Descriptor-driven UI for the typical digital circuit generator. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const GATES = ['NAND', 'NOR', 'INV', 'AND', 'OR', 'XOR', 'XNOR'];
  const NS = 'http://www.w3.org/2000/svg';
  const workerUrl = new URL('typical-worker.js', document.currentScript.src);
  let core;
  let logic;
  let fields = [];
  let controls = new Map();
  const gates = new Map();
  const requests = new Map();
  let worker = null;
  let requestId = 0;
  let generation = 0;
  let settledBits;
  let lastResult = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function clearError() {
    $('typical-error').hidden = true;
    $('typical-error').replaceChildren();
  }

  function showError(title, error) {
    const box = element('div', 'error-box');
    box.append(element('div', 'error-title', title));
    box.append(element('div', 'error-msg', error.message || String(error)));
    if (Array.isArray(error.reasons) && error.reasons.length) {
      const reasons = element('ul', 'error-reasons');
      error.reasons.forEach(reason => reasons.append(element('li', '', reason)));
      box.append(reasons);
    }
    $('typical-error').replaceChildren(box);
    $('typical-error').hidden = false;
  }

  function abortError() {
    return new DOMException('The circuit options changed.', 'AbortError');
  }

  function stopWorker(error = abortError()) {
    if (worker) worker.terminate();
    worker = null;
    requests.forEach(request => request.reject(error));
    requests.clear();
  }

  function workerError(message) {
    return new Error('Circuit processing failed. Generate again or reload this page, and check that your browser allows Web Workers and typical-worker.js.' + (message ? ' ' + message : ''));
  }

  function startWorker() {
    let instance;
    try {
      instance = new Worker(workerUrl);
    } catch (error) {
      throw workerError(error.message);
    }
    worker = instance;
    instance.onmessage = ({ data }) => {
      if (worker !== instance) return;
      const request = requests.get(data.id);
      if (!request) return;
      requests.delete(data.id);
      if (data.error) {
        const error = new Error(data.error.message || 'Circuit processing failed. Generate again to retry.');
        error.reasons = data.error.reasons;
        request.reject(error);
      } else {
        request.resolve(data);
      }
    };
    const fail = event => {
      if (worker !== instance) return;
      event.preventDefault();
      const error = workerError(event.message || 'The worker script could not be loaded or its response could not be read.');
      stopWorker(error);
      showError('Circuit worker unavailable', error);
      $('typical-generate-status').textContent = 'Generate again or reload this page to retry.';
    };
    instance.addEventListener('error', fail);
    instance.addEventListener('messageerror', fail);
    return instance;
  }

  function requestWorker(payload) {
    return new Promise((resolve, reject) => {
      const instance = payload.action === 'generate' ? startWorker() : worker;
      if (!instance) {
        reject(new Error('The circuit worker is no longer available. Generate the circuit again before exporting.'));
        return;
      }
      const id = ++requestId;
      requests.set(id, { resolve, reject });
      try {
        instance.postMessage({ id, ...payload });
      } catch (error) {
        stopWorker(workerError(error.message));
      }
    });
  }

  function assertCurrentResult(result) {
    if (lastResult !== result) throw abortError();
  }

  function invalidate() {
    generation++;
    stopWorker();
    lastResult = null;
    clearError();
    $('typical-results').hidden = true;
    $('typical-combinational').hidden = true;
    $('typical-timing').hidden = true;
    ['typical-expressions', 'typical-table', 'typical-stats', 'typical-circuit', 'typical-wave'].forEach(id => $(id).replaceChildren());
    $('typical-results').querySelectorAll('button').forEach(button => { button.disabled = true; });
    $('typical-generate').disabled = false;
    $('typical-generate-status').textContent = 'Options changed. Generate to see current results.';
  }

  function readValues() {
    const values = {};
    fields.forEach(field => {
      const input = controls.get(field.key);
      values[field.key] = field.type === 'checkbox' ? input.checked
        : field.type === 'number' ? (input.value.trim() === '' ? '' : input.valueAsNumber)
          : input.value;
    });
    return values;
  }

  function descriptorValues(values) {
    // Empty numeric fields are omitted for descriptor discovery, never converted to zero.
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && !(typeof value === 'number' && !Number.isFinite(value))));
  }

  function fieldValue(field, previous) {
    const hasValue = Object.prototype.hasOwnProperty.call(previous, field.key);
    const value = hasValue ? previous[field.key] : field.default;
    if (field.type === 'select') {
      const options = field.options || [];
      return options.some(option => String(option.value) === String(value)) ? String(value) : String(field.default);
    }
    if (field.type === 'checkbox') return hasValue ? value === true : Boolean(field.default);
    return value;
  }

  function rebuildFields(reset = false, widthChanged = false) {
    const focusKey = document.activeElement && document.activeElement.dataset.fieldKey;
    let values = reset ? {} : readValues();
    if (widthChanged) {
      delete values.modulus;
      delete values.initial;
    }
    // Resolve defaults again when an obsolete option is replaced; no synthesis occurs here.
    for (let pass = 0; pass < 4; pass++) {
      fields = core.getFields($('typical-type').value, descriptorValues(values));
      const next = Object.fromEntries(fields.map(field => [field.key, fieldValue(field, values)]));
      const stable = JSON.stringify(values) === JSON.stringify(next);
      values = next;
      if (stable) break;
    }
    controls = new Map();
    const fragment = document.createDocumentFragment();
    fields.forEach((field, index) => {
      const wrap = element('div', 'typical-field');
      const id = 'typical-field-' + index;
      const label = element('label', field.type === 'checkbox' ? 'typical-checkbox-label' : '', field.label);
      label.htmlFor = id;
      const input = element(field.type === 'select' ? 'select' : 'input');
      input.id = id;
      input.name = field.key;
      input.dataset.fieldKey = field.key;
      if (field.type === 'select') {
        (field.options || []).forEach(option => {
          const item = element('option', '', option.label);
          item.value = String(option.value);
          input.append(item);
        });
        input.required = true;
        input.value = values[field.key];
      } else if (field.type === 'checkbox') {
        input.type = 'checkbox';
        input.checked = values[field.key];
      } else {
        input.type = 'number';
        input.required = true;
        input.step = '1';
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        input.value = values[field.key] === undefined ? '' : String(values[field.key]);
        input.addEventListener('input', () => {
          invalidate();
          updatePreview();
        });
      }
      if (field.type === 'checkbox') {
        label.prepend(input);
        wrap.append(label);
      } else {
        wrap.append(label, input);
      }
      if (field.hint) {
        const hint = element('p', 'hint', field.hint);
        hint.id = id + '-hint';
        input.setAttribute('aria-describedby', hint.id);
        wrap.append(hint);
      }
      controls.set(field.key, input);
      input.addEventListener('change', () => {
        invalidate();
        try {
          const widthChanged = field.key === 'bits' && input.validity.valid && String(readValues().bits) !== String(settledBits);
          if (input.validity.valid) rebuildFields(false, widthChanged);
          updatePreview();
        } catch (error) {
          showOptionError(error.message || String(error));
        }
      });
      fragment.append(wrap);
    });
    $('typical-fields').replaceChildren(fragment);
    settledBits = values.bits;
    if (!reset && focusKey && controls.has(focusKey)) controls.get(focusKey).focus({ preventScroll: true });
  }

  function showOptionError(message) {
    $('typical-summary').hidden = true;
    $('typical-option-status').textContent = message;
    $('typical-option-status').classList.add('is-invalid');
  }

  function updatePreview() {
    const invalid = fields.find(field => !controls.get(field.key).validity.valid);
    fields.forEach(field => {
      const input = controls.get(field.key);
      input.setAttribute('aria-invalid', String(!input.validity.valid));
    });
    if (invalid) {
      const input = controls.get(invalid.key);
      showOptionError(invalid.label + ': ' + (input.validity.valueMissing ? 'A value is required.' : input.validationMessage));
      return;
    }
    try {
      const detail = core.describe({ type: $('typical-type').value, ...readValues() });
      $('typical-summary-title').textContent = detail.title;
      $('typical-kind').textContent = detail.kind === 'combinational' ? 'Combinational' : detail.needsDff ? 'Edge-triggered sequential' : 'Sequential · latch';
      $('typical-inputs').textContent = detail.externalInputs.join(', ') || 'None';
      $('typical-outputs').textContent = detail.outNames.join(', ') || 'None';
      $('typical-notes').replaceChildren(...detail.notes.map(note => element('li', '', note)));
      $('typical-summary').hidden = false;
      $('typical-option-status').textContent = '';
      $('typical-option-status').classList.remove('is-invalid');
    } catch (error) {
      showOptionError(error.message || String(error));
    }
  }

  function syncDff() {
    const family = core.catalog.find(item => item.id === $('typical-type').value);
    const required = Boolean(family && family.clocked);
    $('typical-dff-chip').hidden = !required;
    $('typical-dff').checked = required;
    $('typical-dff').disabled = true;
  }

  function buildGates() {
    GATES.forEach(type => {
      const chip = element('div', 'gate-chip');
      const label = element('label', 'gate-type');
      const parent = element('input');
      parent.type = 'checkbox';
      parent.id = 'typical-gate-' + type;
      parent.checked = true;
      label.htmlFor = parent.id;
      const name = element('span', '', type);
      name.id = parent.id + '-label';
      chip.setAttribute('role', 'group');
      chip.setAttribute('aria-labelledby', name.id);
      label.append(parent, name);
      chip.append(label);
      const specs = [];
      if (type === 'INV') {
        chip.append(element('div', 'gate-unary', '1 input'));
      } else {
        const counts = element('div', 'gate-inputs');
        counts.setAttribute('role', 'group');
        counts.setAttribute('aria-label', type + ' input counts');
        [2, 3, 4].forEach(count => {
          const option = element('label', 'gate-input-option');
          const input = element('input');
          input.type = 'checkbox';
          input.checked = true;
          input.value = String(count);
          input.id = parent.id + '-' + count;
          input.setAttribute('aria-label', type + ': ' + count + ' inputs');
          option.htmlFor = input.id;
          option.append(input, element('span', '', count));
          counts.append(option);
          specs.push(input);
          input.addEventListener('change', () => {
            const countChecked = specs.filter(spec => spec.checked).length;
            parent.checked = countChecked > 0;
            parent.indeterminate = countChecked > 0 && countChecked < specs.length;
            invalidate();
          });
        });
        chip.append(counts);
      }
      parent.addEventListener('change', () => {
        parent.indeterminate = false;
        specs.forEach(spec => { spec.checked = parent.checked; });
        invalidate();
      });
      gates.set(type, { parent, specs });
      $('typical-gates').insertBefore(chip, $('typical-dff-chip'));
    });
  }

  function selectGates(checked) {
    gates.forEach(({ parent, specs }) => {
      parent.checked = checked;
      parent.indeterminate = false;
      specs.forEach(spec => { spec.checked = checked; });
    });
    syncDff();
    invalidate();
  }

  function gateSelection() {
    const lib = new Set();
    const gateInputs = {};
    gates.forEach(({ parent, specs }, type) => {
      if (parent.checked) lib.add(type);
      if (type !== 'INV') gateInputs[type] = specs.filter(spec => spec.checked).map(spec => Number(spec.value));
    });
    return { lib, gateInputs };
  }

  function renderExpressions(result) {
    const fragment = document.createDocumentFragment();
    result.exprRows.forEach(({ name, res, onCount }) => {
      const row = element('div', 'expr-row');
      const constant = onCount === 0 ? '0' : onCount === result.vals.length ? '1' : null;
      const html = element('div', 'expr-html');
      // Only the shared, trusted expression formatter supplies markup.
      html.innerHTML = constant === null ? logic.exprHtml(res.display, result.inNames.map(escapeHtml)) : constant;
      const text = constant === null ? logic.exprText(res.display, result.inNames) : constant;
      row.append(element('div', 'expr-name', name), element('div', 'expr-eq', '='), html,
        element('div', 'expr-ascii', text), element('div', 'expr-path', res.path || 'constant'));
      fragment.append(row);
    });
    $('typical-expressions').replaceChildren(fragment);
  }

  function renderStats(stats) {
    const chips = ['gates', 'wires', 'levels'].map(key => element('span', 'stat-chip', key + ': ' + stats[key]));
    Object.keys(stats.types).sort().forEach(type => chips.push(element('span', 'stat-chip', type + ' × ' + stats.types[type])));
    $('typical-stats').replaceChildren(...chips);
  }

  async function onGenerate(event) {
    event.preventDefault();
    invalidate();
    const currentGeneration = generation;
    try {
      const bits = controls.get('bits');
      if (bits && bits.validity.valid && String(readValues().bits) !== String(settledBits)) rebuildFields(false, true);
    } catch (error) {
      showError('Invalid circuit options', error);
      return;
    }
    updatePreview();
    if (!$('typical-form').reportValidity()) return;
    const button = $('typical-generate');
    button.disabled = true;
    $('typical-generate-status').textContent = 'Generating… Large circuits may take longer. You can change options to cancel.';
    try {
      const { lib, gateInputs } = gateSelection();
      const family = core.catalog.find(item => item.id === $('typical-type').value);
      const config = { type: family.id, ...readValues() };
      const { result, rendered } = await requestWorker({
        action: 'generate', config, lib: [...lib], gateInputs,
        dffSelected: Boolean(family.clocked && $('typical-dff').checked)
      });
      if (generation !== currentGeneration) return;
      $('typical-result-title').textContent = result.title;
      const combinational = result.kind === 'combinational';
      if (combinational) {
        renderExpressions(result);
        $('typical-table').innerHTML = logic.tableHtml(result.vals, result.inNames, result.outNames, false);
      }
      $('typical-combinational').hidden = !combinational;
      renderStats(rendered.stats);
      $('typical-circuit').innerHTML = rendered.svg;
      $('typical-schematic-caption').textContent = combinational
        ? 'Hover a signal or wire to highlight its net. Only selected gate types and input counts are used.'
        : 'Repeated instances of a signal label are connected feedback aliases, not additional external inputs. Q and Q′ (or Q_BAR) are distinct nets. Hover a signal or wire to highlight all matching aliases.';
      if (result.waveform) {
        const wave = renderWaveform(result, false);
        $('typical-wave').innerHTML = wave.svg;
        const svg = $('typical-wave').querySelector('svg');
        svg.style.width = '100%';
        svg.style.minWidth = wave.width + 'px';
        svg.style.height = 'auto';
        $('typical-wave-caption').textContent = result.waveform.caption;
      }
      $('typical-timing').hidden = !result.waveform;
      lastResult = result;
      $('typical-results').querySelectorAll('button').forEach(exportButton => { exportButton.disabled = false; });
      $('typical-results').hidden = false;
      $('typical-generate-status').textContent = 'Generated ' + result.title + '.';
      $('typical-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (generation !== currentGeneration || error.name === 'AbortError') return;
      invalidate();
      showError('Cannot generate circuit', error);
      $('typical-generate-status').textContent = 'Review the error and circuit options, then generate again.';
    } finally {
      if (generation === currentGeneration) button.disabled = false;
    }
  }

  function bindCircuitHover() {
    const box = $('typical-circuit');
    const highlight = target => {
      const svg = box.querySelector('svg');
      if (!svg) return;
      const item = target instanceof Element ? target.closest('[data-net]') : null;
      const canonical = net => {
        const aliases = lastResult && lastResult.feedback;
        const seen = new Set();
        while (aliases && Object.prototype.hasOwnProperty.call(aliases, net) && !seen.has(net)) {
          seen.add(net);
          net = String(aliases[net]);
        }
        return net;
      };
      const net = item && svg.contains(item) ? canonical(item.dataset.net) : null;
      svg.querySelectorAll('[data-net]').forEach(node => {
        node.classList.toggle('net-active', canonical(node.dataset.net) === net);
      });
    };
    box.addEventListener('pointerover', event => highlight(event.target));
    box.addEventListener('pointerout', event => highlight(event.relatedTarget));
    box.addEventListener('pointerleave', () => highlight(null));
  }

  function svgElement(tag, attrs = {}, text) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, String(value)));
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function wrapText(text, maxChars) {
    const lines = [];
    let line = '';
    String(text).split(/\s+/).forEach(word => {
      if (line && line.length + word.length + 1 > maxChars) {
        lines.push(line);
        line = '';
      }
      line += (line ? ' ' : '') + word;
    });
    if (line) lines.push(line);
    return lines;
  }

  function renderWaveform(result, forDownload) {
    const waveform = result.waveform;
    const count = waveform.sampleLabels.length;
    if (!count || !waveform.channels.length) throw new Error('The waveform contains no samples.');
    const color = forDownload
      ? { bg: '#ffffff', text: '#162033', muted: '#526079', grid: '#dbe1e9', signal: '#087f95', output: '#6944a3', unknown: '#6944a3' }
      : { bg: '#0d1322', text: '#e2e8f0', muted: '#8b9bb4', grid: '#25324b', signal: '#22d3ee', output: '#a78bfa', unknown: '#a78bfa' };
    const left = Math.max(108, ...waveform.channels.map(channel => String(channel.name).length * 8 + 34));
    const labelStride = result.needsDff ? 4 : 2;
    const labels = waveform.sampleLabels.filter((_, index) => index % labelStride === 0).map(label => String(label).replace(/\.0$/, ''));
    const cell = Math.max(24, ...labels.map(label => (label.length * 7 + 18) / labelStride));
    const width = Math.max(900, left + cell * count + 24);
    const step = (width - left - 24) / count;
    const top = 90;
    const rowHeight = 54;
    const bottom = top + waveform.channels.length * rowHeight;
    const captions = wrapText(waveform.caption + ' Logical samples only; no physical propagation delays or setup/hold effects.', Math.floor((width - 48) / 7.2));
    const height = bottom + 66 + captions.length * 18;
    const svg = svgElement('svg', { xmlns: NS, width, height, viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': result.title + ': ideal illustrative waveform', 'font-family': 'Consolas,Menlo,monospace', 'font-size': 12 });
    svg.append(svgElement('title', {}, result.title + ' — ideal illustrative waveform (no physical delays)'));
    svg.append(svgElement('desc', {}, waveform.caption));
    svg.append(svgElement('rect', { width, height, fill: color.bg }));
    const defs = svgElement('defs');
    const pattern = svgElement('pattern', { id: 'typical-wave-hatch', width: 8, height: 8, patternUnits: 'userSpaceOnUse' });
    pattern.append(svgElement('path', { d: 'M-2 2L2-2M0 8L8 0M6 10L10 6', stroke: color.unknown, 'stroke-width': 1, opacity: 0.35 }));
    defs.append(pattern);
    svg.append(defs);
    svg.append(svgElement('text', { x: 24, y: 27, fill: color.text, 'font-weight': 'bold', 'font-size': 14 }, 'Ideal illustrative waveform — no physical delays'));
    svg.append(svgElement('text', { x: 24, y: 48, fill: color.muted }, result.title));
    svg.append(svgElement('text', { x: left - 14, y: 74, fill: color.muted, 'text-anchor': 'end', 'font-size': 11 }, result.needsDff ? 'Cycle' : 'Phase'));
    for (let index = 0; index <= count; index++) {
      const x = left + index * step;
      svg.append(svgElement('line', { x1: x, x2: x, y1: top - 8, y2: bottom, stroke: color.grid, 'stroke-width': 1 }));
      if (index < count && index % labelStride === 0) {
        svg.append(svgElement('text', { x: x + step * labelStride / 2, y: 74, fill: color.muted, 'text-anchor': 'middle', 'font-size': 11 }, labels[index / labelStride]));
      }
    }
    (waveform.activeEdges || []).forEach(index => {
      if (!Number.isFinite(index) || index < 0 || index > count) return;
      const x = left + index * step;
      svg.append(svgElement('line', { x1: x, x2: x, y1: top - 8, y2: bottom, stroke: color.output, opacity: 0.5, 'stroke-dasharray': '4 5' }));
      svg.append(svgElement('path', { d: 'M' + (x - 3) + ' ' + (top - 9) + 'h6l-3 5z', fill: color.output, opacity: 0.65 }));
    });
    waveform.channels.forEach((channel, row) => {
      const yHigh = top + row * rowHeight + 5;
      const yLow = yHigh + 25;
      const stroke = result.outNames.includes(channel.name) || channel.name === 'CLK' ? color.output : color.signal;
      svg.append(svgElement('text', { x: left - 14, y: yHigh + 17, 'text-anchor': 'end', fill: stroke }, channel.name));
      svg.append(svgElement('line', { x1: 20, x2: width - 20, y1: yLow + 12, y2: yLow + 12, stroke: color.grid, opacity: 0.55 }));
      for (let index = 0; index < count; index++) {
        const value = channel.values[index];
        const known = value === 0 || value === 1;
        const x = left + index * step;
        if (!known) {
          svg.append(svgElement('rect', { x, y: yHigh, width: step, height: yLow - yHigh, fill: 'url(#typical-wave-hatch)', stroke: color.unknown, 'stroke-width': 1 }));
          svg.append(svgElement('text', { x: x + step / 2, y: yHigh + 17, 'text-anchor': 'middle', fill: color.unknown, 'font-weight': 'bold' }, 'X'));
          continue;
        }
        const y = value === 1 ? yHigh : yLow;
        let path = 'M' + x + ' ' + y + 'H' + (x + step);
        const next = channel.values[index + 1];
        if (index + 1 < count && (next === 0 || next === 1) && next !== value) path += 'V' + (next === 1 ? yHigh : yLow);
        svg.append(svgElement('path', { d: path, fill: 'none', stroke, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
        svg.append(svgElement('text', { x: x + step / 2, y: yHigh + 17, 'text-anchor': 'middle', fill: color.muted, 'font-size': 10 }, value));
      }
    });
    svg.append(svgElement('text', { x: 24, y: bottom + 24, fill: color.muted, 'font-size': 11 }, '0 / 1 = known logic    X + hatching = unknown / invalid    Dashed guides = active clock edges (if present)'));
    captions.forEach((line, index) => svg.append(svgElement('text', { x: 24, y: bottom + 48 + index * 18, fill: color.muted, 'font-size': 12 }, line)));
    return { svg: new XMLSerializer().serializeToString(svg), width, height };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = element('a');
    try {
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function circuitForDownload(result) {
    assertCurrentResult(result);
    const { rendered } = await requestWorker({ action: 'export' });
    assertCurrentResult(result);
    return rendered;
  }

  function exportCsv(result) {
    if (result.kind !== 'combinational' || !result.vals) return;
    const quote = value => {
      const text = String(value);
      const safe = /^\s*[=+\-@]/.test(text) ? "'" + text : text;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const rows = [[...result.inNames, ...result.outNames]];
    result.vals.forEach((values, index) => {
      const bits = result.inNames.map((_, bit) => (index >> (result.inNames.length - bit - 1)) & 1);
      rows.push([...bits, ...values]);
    });
    const csv = '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'typical-truth-table.csv');
  }

  async function exportPng(result, forWaveform = false) {
    assertCurrentResult(result);
    const rendered = forWaveform ? renderWaveform(result, true) : await circuitForDownload(result);
    assertCurrentResult(result);
    const url = URL.createObjectURL(new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The image could not be rendered. Try downloading SVG.'));
        image.src = url;
      });
      assertCurrentResult(result);
      const canvas = element('canvas');
      canvas.width = Math.ceil(rendered.width * 2);
      canvas.height = Math.ceil(rendered.height * 2);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('A canvas is not available in this browser. Try downloading SVG.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      assertCurrentResult(result);
      if (!blob) throw new Error('The image is too large or could not be encoded. Try downloading SVG.');
      downloadBlob(blob, forWaveform ? 'typical-waveform.png' : 'typical-circuit.png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function bindExport(id, action) {
    $(id).addEventListener('click', async event => {
      const button = event.currentTarget;
      const result = lastResult;
      if (!result || button.disabled) return;
      button.disabled = true;
      clearError();
      try {
        await action(result);
      } catch (error) {
        if (lastResult === result && error.name !== 'AbortError') showError('Export failed', error);
      } finally {
        if (lastResult === result) button.disabled = false;
      }
    });
  }

  function init() {
    if (!$('typical-form')) return;
    core = window.ICTypical;
    logic = window.ICLogic;
    try {
      if (!core || !logic) throw new Error('The circuit engine could not be loaded. Reload this page and try again.');
      core.catalog.forEach(item => {
        const option = element('option', '', item.label);
        option.value = item.id;
        $('typical-type').append(option);
      });
      buildGates();
      $('typical-type').addEventListener('change', () => {
        invalidate();
        syncDff();
        try {
          rebuildFields(true);
          updatePreview();
        } catch (error) {
          showOptionError(error.message || String(error));
        }
      });
      $('typical-select-all').addEventListener('click', () => selectGates(true));
      $('typical-select-none').addEventListener('click', () => selectGates(false));
      $('typical-form').addEventListener('submit', onGenerate);
      window.addEventListener('pagehide', invalidate);
      bindCircuitHover();
      bindExport('typical-download-csv', exportCsv);
      bindExport('typical-download-svg', async result => {
        const rendered = await circuitForDownload(result);
        assertCurrentResult(result);
        downloadBlob(new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' }), 'typical-circuit.svg');
      });
      bindExport('typical-download-png', exportPng);
      bindExport('typical-download-wave', result => {
        if (result.waveform) downloadBlob(new Blob([renderWaveform(result, true).svg], { type: 'image/svg+xml;charset=utf-8' }), 'typical-waveform.svg');
      });
      bindExport('typical-download-wave-png', result => {
        if (result.waveform) return exportPng(result, true);
      });
      syncDff();
      rebuildFields(true);
      updatePreview();
    } catch (error) {
      showError('Unable to initialize generator', error);
      $('typical-generate').disabled = true;
      $('typical-generate-status').textContent = 'Circuit engine unavailable.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
