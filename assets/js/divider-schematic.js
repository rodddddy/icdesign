(function () {
  'use strict';

  const FONT = 'Helvetica,Arial,sans-serif';
  const X = 176, TAP_END = 300, WIDTH = 420;
  const CELL = { R: 36, dots: 22, P: 52 };
  const BRANCH = 20, LEAD = 10;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const attr = values => Object.entries(values).map(([key, value]) => key + '="' + escape(value) + '"').join(' ');
  const tag = (name, values, text) => '<' + name + ' ' + attr(values) + '>' + (text === undefined ? '' : text) + '</' + name + '>';

  function cellsFor(segment) {
    const run = (count, kind) => count <= 0 ? [] : count <= (kind === 'R' ? 4 : 2)
      ? [{ cells: Array(count).fill(kind), count, kind }]
      : [{ cells: kind === 'R' ? ['R', 'R', 'dots', 'R'] : ['P', 'dots', 'P'], count, kind, collapsed: true }];
    return [...run(segment.n, 'R'), ...segment.groups.flatMap(group =>
      run(group.count, 'P').map(item => ({ ...item, parallel: group.parallel })))];
  }

  function render(solution, forDownload = false, format = String) {
    if (!solution || !Array.isArray(solution.segments) || !solution.segments.length) throw new Error('No divider solution to draw.');
    const colors = forDownload
      ? { bg: '#ffffff', wire: '#1a1a1a', device: '#000000', text: '#000000', muted: '#555555' }
      : { bg: '#0d1322', wire: '#b8c6da', device: '#e2e8f0', text: '#e2e8f0', muted: '#8b9bb4' };
    const content = [];
    const line = (points, color = colors.wire, width = 1.4) => content.push(tag('polyline', {
      points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': width,
      'stroke-linecap': 'square', 'stroke-linejoin': 'miter'
    }));
    const dot = (x, y, r = 2.6, color = colors.wire) => content.push(tag('circle', { cx: x, cy: y, r, fill: color }));
    const richText = text => escape(text).replace(/R(u|\d+)/g, (_, sub) => 'R' + tag('tspan', { 'baseline-shift': 'sub', 'font-size': '72%' }, sub));
    // Conservative glyph widths keep labels inside the canvas without browser-only measurements.
    const textWidth = (value, size) => Array.from(String(value)).reduce((width, char) => width +
      (/\s/.test(char) ? 0.4 : /[ilI.,:;!'|\/]/.test(char) ? 0.4 : /[MWmw@%&]/.test(char) ? 1.1 :
        /[A-Z]/.test(char) ? 0.8 : /[a-z0-9]/.test(char) ? 0.65 : 1.1), 0) * size;
    const wrapText = (value, maxWidth, size) => {
      const source = String(value);
      if (textWidth(source, size) <= maxWidth) return [source];
      const lines = [];
      let current = '';
      source.replace(/\s*\+\s*/g, ' + ').trim().split(/\s+/).forEach(word => {
        const candidate = current ? current + ' ' + word : word;
        if (current && textWidth(candidate, size) > maxWidth) {
          lines.push(current);
          current = '';
        }
        if (textWidth(word, size) > maxWidth) {
          Array.from(word).forEach(char => {
            if (current && textWidth(current + char, size) > maxWidth) {
              lines.push(current);
              current = '';
            }
            current += char;
          });
        } else current = current ? current + ' ' + word : word;
      });
      if (current) lines.push(current);
      return lines.length ? lines : [''];
    };
    const text = (x, y, value, { anchor = 'start', size = 12, color = colors.text, italic = false, bold = false } = {}) => {
      const available = anchor === 'end' ? x - 12 : anchor === 'middle' ? 2 * Math.min(x - 12, WIDTH - x - 12) : WIDTH - x - 12;
      const measured = textWidth(value, size);
      const fittedSize = Math.min(size, Math.max(8, size * available / (measured || 1)));
      content.push(tag('text', {
        x, y, fill: color, 'text-anchor': anchor, 'font-size': fittedSize, 'dominant-baseline': 'middle',
        ...(measured * fittedSize / size > available ? { textLength: available, lengthAdjust: 'spacingAndGlyphs' } : {}),
        ...(italic ? { 'font-style': 'italic' } : {}), ...(bold ? { 'font-weight': 600 } : {})
      }, richText(value)));
    };
    const zigzag = (x, y1, y2) => {
      const length = y2 - y1, centre = length / 2, half = 15;
      const points = [[x, y1], [x, y1 + centre - half]];
      for (let i = 0; i < 6; i++) points.push([x + (i % 2 ? -5 : 5), y1 + centre - half + (i + 0.5) * half / 3]);
      points.push([x, y1 + centre + half], [x, y2]);
      line(points, colors.device);
    };
    const parallelHalf = parallel => (Math.min(parallel, 4) - 1) * BRANCH / 2;
    const halfWidth = segment => Math.max(segment.n ? 6 : 0,
      ...segment.groups.map(group => parallelHalf(group.parallel) + 6));

    let y = 28;
    content.push(tag('circle', { cx: X, cy: y, r: 3, fill: colors.bg, stroke: colors.wire, 'stroke-width': 1.4 }));
    text(X + 10, y, 'VIN', { italic: true, bold: true, size: 13 });
    y += 3;
    const tapsByName = new Map(solution.taps.map(tap => [tap.name, tap]));

    solution.segments.forEach((segment, index) => {
      content.push('<g ' + attr({ 'data-segment': segment.name }) + '><title>' + escape(segment.name + ': ' + segment.composition + ' = ' + format(segment.resistance, 'Ω')) + '</title>');
      const start = y, widest = halfWidth(segment), labelX = X - widest - 16;
      const runs = cellsFor(segment);
      const compositionLines = wrapText(segment.composition, labelX - 12, 11);
      const cellsHeight = runs.reduce((height, run) => height + run.cells.reduce((sum, kind) => sum + CELL[kind], 0), 0);
      const lead = LEAD + Math.max(0, (compositionLines.length + 1) * 15 + 18 - cellsHeight - 2 * LEAD) / 2;
      line([[X, y], [X, y + lead]]);
      y += lead;
      runs.forEach(run => {
        const runStart = y;
        run.cells.forEach(kind => {
          if (kind === 'R') zigzag(X, y, y + CELL.R);
          else if (kind === 'dots') [6, 11, 16].forEach(offset => dot(X, y + offset, 1.4));
          else {
            const collapsedParallel = run.parallel > 4;
            const half = parallelHalf(run.parallel);
            content.push('<g ' + attr({ 'data-parallel': run.parallel }) + '>' + (collapsedParallel
              ? '<title>' + escape('×' + run.parallel + ' parallel: collapsed parallel branches; two left resistors, an ellipsis and one right resistor.') + '</title>' : ''));
            line([[X, y], [X, y + 8]]);
            line([[X - half, y + 8], [X + half, y + 8]]);
            line([[X - half, y + 44], [X + half, y + 44]]);
            if (collapsedParallel) {
              [0, 1, 3].forEach(slot => zigzag(X - half + slot * BRANCH, y + 8, y + 44));
              [-4, 0, 4].forEach(offset => dot(X - half + 2 * BRANCH + offset, y + 26, 1.4, colors.muted));
              text(X + widest + 18, y + 26, '×' + run.parallel + ' parallel', { color: colors.muted, size: 11 });
            } else {
              for (let b = 0; b < run.parallel; b++) zigzag(X - half + b * BRANCH, y + 8, y + 44);
            }
            line([[X, y + 44], [X, y + 52]]);
            dot(X, y + 8); dot(X, y + 44);
            content.push('</g>');
          }
          y += CELL[kind];
        });
        if (run.collapsed) {
          const bx = X + widest + 12;
          line([[bx - 4, runStart + 2], [bx, runStart + 2], [bx, y - 2], [bx - 4, y - 2]], colors.muted, 1.2);
          text(bx + 6, (runStart + y) / 2, '×' + run.count, { color: colors.muted });
        }
      });
      line([[X, y], [X, y + lead]]);
      y += lead;
      const middle = (start + y) / 2, labelOffset = (compositionLines.length + 1) * 15 / 2;
      text(labelX, middle - labelOffset, segment.name, { anchor: 'end', italic: true, bold: true, size: 13 });
      compositionLines.forEach((value, row) => text(labelX, middle - labelOffset + (row + 1) * 15, value, { anchor: 'end', color: colors.muted, size: 11 }));
      text(labelX, middle + labelOffset, format(segment.resistance, 'Ω'), { anchor: 'end', color: colors.muted, size: 11 });
      content.push('</g>');

      if (index < solution.segments.length - 1) {
        const tap = tapsByName.get(segment.bottom);
        content.push('<g ' + attr({ 'data-tap': segment.bottom }) + '>');
        dot(X, y);
        line([[X, y], [TAP_END - 3, y]]);
        content.push(tag('circle', { cx: TAP_END, cy: y, r: 3, fill: colors.bg, stroke: colors.wire, 'stroke-width': 1.4 }));
        text(TAP_END + 9, y - 13, segment.bottom, { bold: true, size: 13 });
        if (tap) {
          text(TAP_END + 9, y + 2, format(tap.vRef, 'V') + ' @ ' + format(tap.tripActual, 'V'), { color: colors.muted, size: 11 });
          text(TAP_END + 9, y + 16, 'k = ' + tap.num + '/' + tap.den, { color: colors.muted, size: 11 });
        }
        content.push('</g>');
      }
    });

    [8, 5, 2].forEach((half, i) => line([[X - half, y + i * 4], [X + half, y + i * 4]], colors.wire, 1.6));
    const height = Math.ceil(y + 22);
    const hasCollapsedParallel = solution.segments.some(segment => segment.groups.some(group => group.parallel > 4));
    const title = 'Resistor divider string · ' + solution.units + ' unit resistors'
      + (hasCollapsedParallel ? ' · collapsed parallel branches' : '');
    const svg = '<svg ' + attr({ xmlns: 'http://www.w3.org/2000/svg', width: WIDTH, height, viewBox: '0 0 ' + WIDTH + ' ' + height, role: 'img', 'aria-label': title, 'font-family': FONT }) + '>'
      + '<title>' + escape(title) + '</title><desc>' + escape('Ru is the unit resistor. Collapsed serial runs are marked ×n; Ru/p is p unit resistors in parallel. Groups above four use collapsed parallel branches: two left resistors, a horizontal ellipsis with no branch wire, and one right resistor, connected by top and bottom rails. The ×p parallel label gives the actual parallel count, separate from the serial ×n label.') + '</desc>'
      + tag('rect', { width: WIDTH, height, fill: colors.bg })
      + content.join('')
      + '</svg>';
    return { svg, width: WIDTH, height };
  }

  const api = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.ICDividerSchematic = api;
})();
