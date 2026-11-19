(function () {
  'use strict';

  const FONT = 'Helvetica,Arial,sans-serif';
  const X = 176, TAP_END = 300, WIDTH = 420;
  const CELL = { R: 44, dots: 22, P: 52 };
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
    let canvasWidth = WIDTH;
    const line = (points, color = colors.wire, width = 1.4, net) => {
      const shape = {
        points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': width,
        'stroke-linecap': 'square', 'stroke-linejoin': 'miter'
      };
      if (net) shape['data-net'] = net;
      content.push(tag('polyline', shape));
      // A transparent, thicker twin gives the hover highlight a comfortable hit area.
      if (net && !forDownload) content.push(tag('polyline', {
        points: shape.points, fill: 'none', stroke: 'transparent', 'stroke-width': 10, 'data-hit': net
      }));
    };
    const dot = (x, y, r = 2.6, color = colors.wire, net) => content.push(tag('circle', {
      cx: x, cy: y, r, fill: color, ...(net ? { 'data-net': net } : {})
    }));
    const nodeNet = y => 'N' + y;
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
    const text = (x, y, value, { anchor = 'start', size = 12, color = colors.text, italic = false, bold = false, net } = {}) => {
      const available = anchor === 'end' ? x - 12 : anchor === 'middle' ? 2 * Math.min(x - 12, WIDTH - x - 12) : canvasWidth - x - 12;
      const measured = textWidth(value, size);
      const fittedSize = Math.min(size, Math.max(8, size * available / (measured || 1)));
      content.push(tag('text', {
        x, y, fill: color, 'text-anchor': anchor, 'font-size': fittedSize, 'dominant-baseline': 'middle',
        ...(measured * fittedSize / size > available ? { textLength: available, lengthAdjust: 'spacingAndGlyphs' } : {}),
        ...(italic ? { 'font-style': 'italic' } : {}), ...(bold ? { 'font-weight': 600 } : {}),
        ...(net ? { 'data-net': net } : {})
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

    const switches = Array.isArray(solution.switches) ? solution.switches : [];
    const tapLabelWidth = solution.taps.reduce((width, tap) => {
      const detail = tap.selectCode ? solution.selectBus + ' = ' + tap.selectCode : '';
      return Math.max(width, textWidth(tap.name, 13),
        textWidth(format(tap.vRef, 'V') + ' @ ' + format(tap.tripActual, 'V'), 11),
        textWidth('k = ' + tap.num + '/' + tap.den, 11),
        detail ? textWidth(detail, 10) : 0);
    }, 0);
    let tapEnd = TAP_END;

    let y = 28;
    content.push(tag('circle', { cx: X, cy: y, r: 3, fill: colors.bg, stroke: colors.wire, 'stroke-width': 1.4 }));
    text(X + 10, y, 'VIN', { italic: true, bold: true, size: 13 });
    y += 3;
    const tapsByName = new Map(solution.taps.map(tap => [tap.name, tap]));
    const nodeY = new Map([['VIN', 31]]);
    const tapAnchors = [];

    solution.segments.forEach((segment, index) => {
      content.push('<g ' + attr({ 'data-segment': segment.name }) + '><title>' + escape(segment.name + ': ' + segment.composition + ' = ' + format(segment.resistance, 'Ω')) + '</title>');
      const start = y, widest = halfWidth(segment), labelX = X - widest - 16;
      const runs = cellsFor(segment);
      const compositionLines = wrapText(segment.composition, labelX - 12, 11);
      const seriesLines = runs.filter(run => run.kind === 'R' && run.collapsed).map(run => '×' + run.count + ' in series');
      const parallelLines = segment.groups.filter(group => group.parallel > 4).map(group => '×' + group.parallel + ' parallel');
      const labelLines = [...compositionLines, ...seriesLines, ...parallelLines];
      const cellsHeight = runs.reduce((height, run) => height + run.cells.reduce((sum, kind) => sum + CELL[kind], 0), 0);
      const lead = LEAD + Math.max(0, (labelLines.length + 1) * 15 + 18 - cellsHeight - 2 * LEAD) / 2;
      line([[X, y], [X, y + lead]], colors.wire, 1.4, nodeNet(y));
      y += lead;
      runs.forEach(run => {
        run.cells.forEach(kind => {
          if (kind === 'R') zigzag(X, y, y + CELL.R);
          else if (kind === 'dots') [6, 11, 16].forEach(offset => dot(X, y + offset, 1.4));
          else {
            const collapsedParallel = run.parallel > 4;
            const half = parallelHalf(run.parallel);
            const topNet = nodeNet(y), bottomNet = nodeNet(y + CELL.P);
            content.push('<g ' + attr({ 'data-parallel': run.parallel }) + '>' + (collapsedParallel
              ? '<title>' + escape('×' + run.parallel + ' parallel: collapsed parallel branches; two left resistors, an ellipsis and one right resistor.') + '</title>' : ''));
            line([[X, y], [X, y + 8]], colors.wire, 1.4, topNet);
            line([[X - half, y + 8], [X + half, y + 8]], colors.wire, 1.4, topNet);
            line([[X - half, y + 44], [X + half, y + 44]], colors.wire, 1.4, bottomNet);
            const slots = collapsedParallel ? [0, 1, 3] : Array.from({ length: run.parallel }, (_, b) => b);
            if (collapsedParallel) {
              slots.forEach(slot => zigzag(X - half + slot * BRANCH, y + 8, y + 44));
              [-4, 0, 4].forEach(offset => dot(X - half + 2 * BRANCH + offset, y + 26, 1.4, colors.muted));
            } else {
              slots.forEach(slot => zigzag(X - half + slot * BRANCH, y + 8, y + 44));
            }
            // Both rails stop at the outer branches, so those ends are corners, not
            // junctions. Only inner branches and the centre feed are three-way.
            const slotXs = slots.map(slot => X - half + slot * BRANCH);
            const railMin = Math.min(...slotXs), railMax = Math.max(...slotXs);
            slotXs.forEach(branchX => {
              if (branchX === railMin || branchX === railMax) return;
              dot(branchX, y + 8, 2.6, colors.wire, topNet);
              dot(branchX, y + 44, 2.6, colors.wire, bottomNet);
            });
            line([[X, y + 44], [X, y + 52]], colors.wire, 1.4, bottomNet);
            if (!slotXs.includes(X)) {
              dot(X, y + 8, 2.6, colors.wire, topNet);
              dot(X, y + 44, 2.6, colors.wire, bottomNet);
            }
            content.push('</g>');
          }
          y += CELL[kind];
        });
      });
      line([[X, y], [X, y + lead]], colors.wire, 1.4, nodeNet(y + lead));
      y += lead;
      const middle = (start + y) / 2, labelOffset = (labelLines.length + 1) * 15 / 2;
      text(labelX, middle - labelOffset, segment.name, { anchor: 'end', italic: true, bold: true, size: 13 });
      labelLines.forEach((value, row) => text(labelX, middle - labelOffset + (row + 1) * 15, value, { anchor: 'end', color: colors.muted, size: 11 }));
      text(labelX, middle + labelOffset, format(segment.resistance, 'Ω'), { anchor: 'end', color: colors.muted, size: 11 });
      if (segment.bypass) {
        content.push('<g ' + attr({ 'data-bypass': segment.bypass.join(' ') }) + '><title>' + escape(segment.name + ' is shorted by ' + segment.bypass.join(', ')) + '</title>');
        text(labelX, middle + labelOffset + 15, 'shorted by ' + segment.bypass.join(', '), { anchor: 'end', color: colors.device, size: 10 });
        content.push('</g>');
      }
      content.push('</g>');
      nodeY.set(segment.bottom, y);

      // Only real taps get an output stub; internal switch nodes stay anonymous.
      const tap = tapsByName.get(segment.bottom);
      if (tap) tapAnchors.push({ tap, node: segment.bottom, y });
    });
    nodeY.set('GND', y);
    const tapNodeYs = tapAnchors.map(anchor => anchor.y);
    const isTapNode = value => tapNodeYs.includes(value);

    const lanes = [];
    const lanePlacements = [];
    switches.forEach(sw => {
      const yTo = nodeY.get(sw.to), yFrom = nodeY.get(sw.from);
      if (yTo === undefined || yFrom === undefined || !(yTo < yFrom)) return;
      let lane = 0;
      while (lane < 8 && lanes[lane] && !lanes[lane].every(([top, bottom]) => yTo > bottom + 6 || yFrom < top - 6)) lane++;
      if (lane >= 8) lane = lanes.reduce((best, spans, index) => {
        const overlap = spans.reduce((count, [top, bottom]) => count + (yTo <= bottom && yFrom >= top ? 1 : 0), 0);
        return overlap < best.overlap ? { index, overlap } : best;
      }, { index: 0, overlap: Infinity }).index;
      (lanes[lane] = lanes[lane] || []).push([yTo, yFrom]);
      lanePlacements.push({ sw, yTo, yFrom, sx: X + 52 + lane * 24, mid: (yTo + yFrom) / 2 });
    });
    // Lanes run unbroken beside the string. At a crossing without a dot the wires are
    // not connected, so the lane never needs gaps.
    lanePlacements.forEach(({ sw, yTo, yFrom, sx, mid }) => {
      const net = 'SW:' + sw.name;
      const topNet = nodeNet(yTo), bottomNet = nodeNet(yFrom);
      content.push('<g ' + attr({ 'data-switch': sw.name }) + '><title>'
        + escape(sw.name + ' shorts ' + sw.from + ' to ' + sw.to + ' (' + sw.segments.join(' + ') + ', '
          + format(sw.bypassResistance, 'Ω') + '). Effective string: ' + format(sw.effectiveValue * solution.unit, 'Ω')
          + (sw.selectSignal ? '. Closed when ' + sw.selectSignal + ' = 1' : '') + '.')
        + '</title>');
      // The lane wires belong to the string nodes they connect; only the switch symbol
      // itself answers to the select net, so hovering a tap lights the whole node.
      line([[X, yTo], [sx, yTo]], colors.wire, 1.4, topNet);
      line([[X, yFrom], [sx, yFrom]], colors.wire, 1.4, bottomNet);
      // A tap stub runs on past the lane corner, so the drop is a T junction.
      if (isTapNode(yTo)) dot(sx, yTo, 2.6, colors.wire, topNet);
      if (isTapNode(yFrom)) dot(sx, yFrom, 2.6, colors.wire, bottomNet);
      line([[sx, yTo], [sx, mid - 7]], colors.wire, 1.4, topNet);
      line([[sx, mid + 7], [sx, yFrom]], colors.wire, 1.4, bottomNet);
      line([[sx, mid + 7], [sx + 8, mid - 7]], colors.device, 1.4, net);
      dot(sx, mid - 7, 2, colors.device, net);
      dot(sx, mid + 7, 2, colors.device, net);
      content.push('</g>');
    });
    // A string node earns a solid dot only where a tap stub or a switch branch joins
    // it, since a plain series continuation is not a junction.
    const junctionRows = new Set(tapNodeYs);
    lanePlacements.forEach(({ yTo, yFrom }) => { junctionRows.add(yTo); junctionRows.add(yFrom); });
    junctionRows.forEach(row => dot(X, row, 2.6, colors.wire, nodeNet(row)));
    // All control labels share one column just right of every lane, so no label or
    // leader is ever drawn on top of another wire. Tap outputs stay rightmost.
    const labelColumn = lanePlacements.reduce((right, lane) => Math.max(right, lane.sx + 15), 0);
    const controlBlocks = [];
    // Stack labels by their switch's height so every leader stays short.
    lanePlacements.slice().sort((a, b) => a.mid - b.mid).forEach(({ sw, sx, mid }) => {
      if (!sw.selectSignal) return;
      const width = Math.max(textWidth(sw.name, 9), textWidth(sw.selectSignal, 10)) + 10;
      const previous = controlBlocks[controlBlocks.length - 1];
      let labelY = previous ? Math.max(mid, previous.y + 30) : mid;
      while (tapNodeYs.some(tapY => Math.abs(tapY - labelY) < 21)) labelY += 4;
      controlBlocks.push({
        sw, sx, mid, left: labelColumn, right: labelColumn + width,
        top: labelY - 13, bottom: labelY + 13, y: labelY
      });
    });
    const controlRight = controlBlocks.reduce((right, block) => Math.max(right, block.right), 0);
    if (controlBlocks.length) tapEnd = Math.max(TAP_END, controlRight + 14);
    canvasWidth = Math.max(WIDTH, tapEnd + 9 + tapLabelWidth + 12);

    controlBlocks.forEach(({ sw, sx, mid, left, y: labelY }) => {
      const net = 'SW:' + sw.name;
      if (labelY === mid) {
        line([[sx + 8, mid], [left, mid]], colors.device, 1, net);
      } else {
        // The vertical jog stays in the switch's own lane slot so leaders never merge.
        const jogX = sx + 12;
        line([[sx + 8, mid], [jogX, mid]], colors.device, 1, net);
        line([[jogX, mid], [jogX, labelY]], colors.device, 1, net);
        line([[jogX, labelY], [left, labelY]], colors.device, 1, net);
      }
      text(left + 5, labelY - 7, sw.name, { color: colors.muted, size: 9, net });
      text(left + 5, labelY + 8, sw.selectSignal, { color: colors.device, size: 10, bold: true, net });
    });

    tapAnchors.forEach(({ tap, node, y: tapY }) => {
      const net = nodeNet(tapY);
      content.push('<g ' + attr({ 'data-tap': node }) + '>');
      line([[X, tapY], [tapEnd - 3, tapY]], colors.wire, 1.4, net);
      content.push(tag('circle', { cx: tapEnd, cy: tapY, r: 3, fill: colors.bg, stroke: colors.wire, 'stroke-width': 1.4, 'data-net': net }));
      text(tapEnd + 9, tapY - 13, tap.name, { bold: true, size: 13, net });
      text(tapEnd + 9, tapY + 1, format(tap.vRef, 'V') + ' @ ' + format(tap.tripActual, 'V'), { color: colors.muted, size: 11, net });
      text(tapEnd + 9, tapY + 15, 'k = ' + tap.num + '/' + tap.den, { color: colors.muted, size: 11, net });
      const detail = tap.selectCode ? solution.selectBus + ' = ' + tap.selectCode : '';
      if (detail) text(tapEnd + 9, tapY + 29, detail, { color: colors.device, size: 10, bold: true, net });
      content.push('</g>');
    });

    [8, 5, 2].forEach((half, i) => line([[X - half, y + i * 4], [X + half, y + i * 4]], colors.wire, 1.6, 'GND'));
    const controlBottom = controlBlocks.reduce((bottom, block) => Math.max(bottom, block.bottom), 0);
    const height = Math.ceil(Math.max(y + 22, controlBottom + 12));
    const hasCollapsedParallel = solution.segments.some(segment => segment.groups.some(group => group.parallel > 4));
    const switchCount = switches.length;
    const title = 'Resistor divider string · ' + solution.units + ' unit resistors'
      + (switchCount ? ' · ' + switchCount + ' bypass switch' + (switchCount === 1 ? '' : 'es') : '')
      + (hasCollapsedParallel ? ' · collapsed parallel branches' : '');
    const svg = '<svg ' + attr({ xmlns: 'http://www.w3.org/2000/svg', width: canvasWidth, height, viewBox: '0 0 ' + canvasWidth + ' ' + height, role: 'img', 'aria-label': title, 'font-family': FONT }) + '>'
      + '<title>' + escape(title) + '</title><desc>' + escape('Ru is the unit resistor. Collapsed serial runs are marked ×n in series; Ru/p is p unit resistors in parallel. Groups above four use collapsed parallel branches: two left resistors, a horizontal ellipsis with no branch wire, and one right resistor, connected by top and bottom rails. The ×p parallel label gives the actual parallel count, separate from the serial ×n label. Labels sit to the left of the string so switch lanes on the right never cross them. Only real taps draw an output stub; internal nodes exist solely as switch terminals.'
        + (switchCount ? ' Bypass switches short their highlighted segment; only one switch is closed at a time and the resulting string still meets the resistance range.'
          + (solution.selectBus ? ' Each switch is driven by its own single select bit and closes when that bit is 1. Select bits are numbered top to bottom, so the topmost switch carries the highest bit; its label sits in a column right of the switch lanes. The code under each tap is the full bus value that selects that tap.' : '') : '')
        + ' On the page, hovering a wire highlights its net.') + '</desc>'
      + tag('rect', { width: canvasWidth, height, fill: colors.bg })
      + content.join('')
      + '</svg>';
    return { svg, width: canvasWidth, height };
  }

  const api = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.ICDividerSchematic = api;
})();
