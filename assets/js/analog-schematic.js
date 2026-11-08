(function () {
  'use strict';

  const titles = {
    cs: 'Common-source amplifier', cg: 'Common-gate amplifier', cascode: 'Common-source / common-gate cascode',
    follower: 'Source follower', 'diff-five': 'Five-transistor differential amplifier',
    'diff-cg': 'Differential common-gate amplifier', 'diff-cascode': 'Differential telescopic cascode',
    'folded-cascode': 'Differential folded cascode'
  };
  const biasNames = {
    cs: { VB_L: 'Vb' }, cg: { VB_G: 'Vb1', VB_L: 'Vb2' }, cascode: { VB_C: 'Vb1', VB_L: 'Vb2' }, follower: {},
    'diff-five': { VB_T: 'Vb' }, 'diff-cg': { VB_G: 'Vb1', VB_L: 'Vb2' },
    'diff-cascode': { VB_L: 'Vb1', VB_LC: 'Vb2', VB_C: 'Vb3', VB_T: 'Vb4' },
    'folded-cascode': { VB_B: 'Vb1', VB_F: 'Vb2', VB_OC: 'Vb3', VB_O: 'Vb4', VB_T: 'Vb5' }
  };
  const FONT = 'Helvetica,Arial,sans-serif';
  // MOS geometry: stubs at ±STUB, channel/gate plates, gate lead end and terminal lead end.
  const STUB = 10, CHX = 12, CHH = 14, GPX = 17, GPH = 11, GLX = 34, LEAD = 24;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function render(raw, forDownload = false) {
    const config = { type: 'cs', polarity: 'nmos', sourceResistance: false, load: 'resistor', ...raw };
    if (!Object.hasOwn(titles, config.type) || !['nmos', 'pmos'].includes(config.polarity)) throw new Error('Unknown schematic configuration.');
    const type = config.type;
    const rs = config.sourceResistance;
    const mirror = config.polarity === 'pmos';
    const dimensions = type === 'folded-cascode' ? [480, 366] : type === 'diff-cascode' ? [390, rs ? 450 : 402]
      : type === 'diff-five' ? [350, rs ? 304 : 256] : type === 'diff-cg' ? [436, 286]
      : type === 'cascode' ? [290, rs ? 292 : 244] : type === 'follower' ? [330, 174]
      : type === 'cg' ? [290, 256] : [290, rs ? 228 : 180];
    const [width, height] = dimensions;
    const colors = forDownload
      ? { bg: '#ffffff', wire: '#1a1a1a', device: '#000000', text: '#000000' }
      : { bg: '#0d1322', wire: '#b8c6da', device: '#e2e8f0', text: '#e2e8f0' };
    const devices = [];
    const content = [];
    const Y = y => mirror ? height - y : y;
    const nodeName = name => mirror && name === 'VDD' ? 'VSS' : mirror && name === 'VSS' ? 'VDD' : name;
    const attr = values => Object.entries(values).map(([key, value]) => key + '="' + escape(value) + '"').join(' ');
    const tag = (name, values, text) => '<' + name + ' ' + attr(values) + '>' + (text === undefined ? '' : escape(text)) + '</' + name + '>';
    const textScreen = (x, y, text, anchor = 'start', size = 13) => {
      const display = text.replace(/^v(in|out)/, 'V$1').replace(/-$/, '−');
      const [, base, subscript, superscript] = /^([MCRIV])([A-Za-z0-9]+)([+−])?$/.exec(display) || [null, display, '', ''];
      content.push('<text ' + attr({ x, y, fill: colors.text, 'text-anchor': anchor, 'font-size': size, 'font-style': 'italic',
        'font-weight': 600, 'dominant-baseline': 'middle', 'aria-label': text }) + '>'
        + escape(base)
        + (subscript ? tag('tspan', { 'baseline-shift': 'sub', 'font-size': '72%' }, subscript) : '')
        + (superscript ? tag('tspan', { 'baseline-shift': 'super', 'font-size': '72%' }, superscript) : '')
        + '</text>');
    };
    const label = (x, y, text, anchor = 'start') => textScreen(x, Y(y), text, anchor);
    const lineScreen = (points, color = colors.wire, net, strokeWidth = 1.4) => content.push(tag('polyline', {
      points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': strokeWidth,
      'stroke-linecap': 'square', 'stroke-linejoin': 'miter', ...(net ? { 'data-net': nodeName(net) } : {})
    }));
    const wire = (points, net) => lineScreen(points.map(([x, y]) => [x, Y(y)]), colors.wire, net);
    const dot = (x, y, net) => content.push(tag('circle', { cx: x, cy: Y(y), r: 2.6, fill: colors.wire, 'data-net': nodeName(net) }));
    const addDevice = (name, description, kind, nodes) => {
      devices.push({ name, description, kind, nodes: Object.fromEntries(Object.entries(nodes).map(([pin, net]) => [pin, nodeName(net)])) });
      content.push('<g ' + attr({ 'data-device': name, 'data-kind': kind }) + '><title>' + escape(name + ' — ' + description) + '</title>');
    };
    const ground = (x, sy, net) => [8, 5, 2].forEach((half, i) =>
      lineScreen([[x - half, sy + i * 4], [x + half, sy + i * 4]], colors.wire, net, 1.6));
    const supply = (net, y, xs, labelled = true) => {
      if (nodeName(net) === 'VDD') {
        const left = Math.min(...xs) - 12, right = Math.max(...xs) + 12;
        lineScreen([[left, Y(y)], [right, Y(y)]], colors.device, net, 3.5);
        if (labelled) textScreen(right + 6, Y(y) - 6, 'VDD');
      } else xs.forEach(x => ground(x, Y(y), net));
    };
    const bias = (net, xDot, y, xEnd) => {
      wire([[xDot, y], [xEnd, y]], net);
      dot(xDot, y, net);
      textScreen(xDot - 6, Y(y), biasNames[type][net] || net, 'end');
    };
    const terminal = (x, y, xEnd, name, place) => {
      wire([[x, y], [xEnd, y]], name);
      content.push(tag('circle', { cx: x, cy: Y(y), r: 3, fill: colors.bg, stroke: colors.wire, 'stroke-width': 1.4 }));
      if (place === 'left') textScreen(x - 6, Y(y), name, 'end');
      else if (place === 'right') textScreen(x + 6, Y(y), name);
      else if (place) textScreen(x, Y(y) - 10, place === '+' ? '+' : '−', 'middle', 11);
    };
    const mos = (name, x, y, baseP, sourceTop, gateSide, description, nodes, labelSide = 'lead', labelAt = 'source') => {
      const pmos = mirror ? !baseP : baseP;
      const side = gateSide === 'right' ? 1 : -1;
      const X = offset => x + side * offset;
      addDevice(name, description, pmos ? 'pmos' : 'nmos', nodes);
      wire([[x, y - LEAD], [x, y - STUB], [X(CHX), y - STUB]], sourceTop ? nodes.s : nodes.d);
      wire([[x, y + LEAD], [x, y + STUB], [X(CHX), y + STUB]], sourceTop ? nodes.d : nodes.s);
      lineScreen([[X(CHX), Y(y - CHH)], [X(CHX), Y(y + CHH)]], colors.device, undefined, 2.6);
      lineScreen([[X(GPX), Y(y - GPH)], [X(GPX), Y(y + GPH)]], colors.device, undefined, 2.6);
      wire([[X(GLX), y], [X(GPX), y]], nodes.g);
      const sourceY = Y(y + (sourceTop ? -STUB : STUB));
      const tipX = X(pmos ? 10 : 2), baseX = X(pmos ? 3 : 9);
      content.push(tag('polygon', {
        points: [[tipX, sourceY], [baseX, sourceY - 3.5], [baseX, sourceY + 3.5]].map(point => point.join(',')).join(' '),
        fill: colors.device
      }));
      const dy = labelAt === 'center' ? 0 : (labelAt === 'source') === sourceTop ? -1 : 1;
      if (labelSide === 'lead') label(x - side * 6, y + dy * 16, name, side === -1 ? 'start' : 'end');
      else label(X(8), y + dy * 21, name, side === -1 ? 'end' : 'start');
      content.push('</g>');
    };
    const resistor = (name, x1, y1, x2, y2, description, nodes, labelSide = 'right') => {
      addDevice(name, description, 'resistor', nodes);
      const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
      const center = length / 2, half = 15, points = [[x1, y1], [x1 + ux * (center - half), y1 + uy * (center - half)]];
      for (let i = 0; i < 6; i++) {
        const distance = center - half + (i + 0.5) * half / 3;
        const offset = i % 2 ? -5 : 5;
        points.push([x1 + ux * distance - uy * offset, y1 + uy * distance + ux * offset]);
      }
      points.push([x1 + ux * (center + half), y1 + uy * (center + half)], [x2, y2]);
      wire(points);
      if (dx === 0) label(x1 + (labelSide === 'left' ? -10 : 10), (y1 + y2) / 2, name, labelSide === 'left' ? 'end' : 'start');
      else textScreen((x1 + x2) / 2, Y(y1) - 17, name, 'middle');
      content.push('</g>');
    };
    const capacitorBetween = (name, x1, y, x2, description, nodes) => {
      addDevice(name, description, 'capacitor', nodes);
      const middle = (x1 + x2) / 2;
      wire([[x1, y], [middle - 3, y]], nodes.p);
      wire([[middle + 3, y], [x2, y]], nodes.n);
      lineScreen([[middle - 3, Y(y) - 9], [middle - 3, Y(y) + 9]], colors.device, undefined, 2);
      lineScreen([[middle + 3, Y(y) - 9], [middle + 3, Y(y) + 9]], colors.device, undefined, 2);
      textScreen(middle, Y(y) - 21, name, 'middle');
      content.push('</g>');
    };
    // Shunt capacitors always hang toward the bottom of the screen so the ground symbol stays upright.
    const shuntCap = (name, x, y, description, net, labelSide = 'right') => {
      addDevice(name, description, 'capacitor', { p: net, n: 'AC ground' });
      const start = Y(y);
      lineScreen([[x, start], [x, start + 12]], colors.wire, net);
      lineScreen([[x - 9, start + 12], [x + 9, start + 12]], colors.device, undefined, 2);
      lineScreen([[x - 9, start + 18], [x + 9, start + 18]], colors.device, undefined, 2);
      lineScreen([[x, start + 18], [x, start + 28]]);
      [8, 5, 2].forEach((half, i) => lineScreen([[x - half, start + 28 + i * 4], [x + half, start + 28 + i * 4]], colors.wire, undefined, 1.6));
      textScreen(x + (labelSide === 'right' ? 12 : -12), start + 15, name, labelSide === 'right' ? 'start' : 'end');
      content.push('</g>');
    };
    const currentSource = (name, x, y1, description, net, labelSide = 'right') => {
      addDevice(name, description, 'current-source', { p: net, n: 'VSS' });
      wire([[x, y1], [x, y1 + 21]], net);
      wire([[x, y1 + 39], [x, y1 + 56]], 'VSS');
      const cy = Y(y1 + 30);
      content.push(tag('circle', { cx: x, cy, r: 9, fill: colors.bg, stroke: colors.device, 'stroke-width': 1.4 }));
      lineScreen([[x, cy - 5], [x, cy + 5]], colors.device);
      lineScreen([[x - 3, cy + 2], [x, cy + 5], [x + 3, cy + 2]], colors.device);
      textScreen(x + (labelSide === 'right' ? 14 : -14), cy, name, labelSide === 'right' ? 'start' : 'end');
      content.push('</g>');
    };
    // Source leg from the MOS lead end y to y + 48, optionally through RS.
    const sourceLeg = (x, y, name, tail = 'VSS', labelSide = 'right') => {
      if (rs) resistor(name, x, y, x, y + 48, 'Source degeneration resistance RS.', { p: name + '_source', n: tail }, labelSide);
    };
    const outNet = name => name === 'RL' ? 'out' : name === 'RL1' ? 'out+' : 'out-';
    // Load from the VDD rail at y = 30 to y = 82.
    const load = (x, name, mosName, labelAt = 'center') => {
      if (config.load === 'active') {
        mos(mosName, x, 58, true, true, 'left', 'AC-grounded current-source load; output resistance roL.', { d: outNet(name), g: 'VB_L', s: 'VDD' }, 'lead', labelAt);
        wire([[x, 30], [x, 34]], 'VDD');
      } else resistor(name, x, 30, x, 82, 'Load resistance RL' + (name === 'RL' ? '.' : ' per branch.'), { p: 'VDD', n: outNet(name) });
    };

    if (['cs', 'cg', 'cascode'].includes(type)) {
      const x = 150, top = type === 'cascode' ? 134 : null, inY = type === 'cascode' ? 198 : 134, lower = inY + LEAD;
      supply('VDD', 30, [x]);
      load(x, 'RL', type === 'cascode' ? 'M3' : 'M2');
      if (config.load === 'active') bias('VB_L', 94, 58, x - GLX);
      wire([[x, 82], [x, 110]], 'out'); dot(x, 96, 'out'); dot(200, 96, 'out');
      terminal(250, 96, x, 'vout', 'right');
      shuntCap('CL', 200, 96, type === 'cs' ? 'Output capacitance excluding CF.' : 'Output lumped capacitance.', 'out');
      if (type === 'cascode') {
        mos('M2', x, top, false, false, 'left', 'Common-gate cascode; gm2, ro2.', { d: 'out', g: 'VB_C', s: 'x' });
        bias('VB_C', 94, top, x - GLX);
        wire([[x, 158], [x, 174]], 'x'); dot(x, 166, 'x');
        wire([[x, 166], [195, 166]], 'x'); label(x - 7, 166, 'X', 'end');
        shuntCap('CX', 195, 166, 'Cascode source / input drain lumped capacitance.', 'x');
      }
      const input = type === 'cg' ? 'VB_G' : 'vin';
      mos('M1', x, inY, false, false, 'left', type === 'cascode' ? 'Input common-source device; gm1, ro1.' : 'Input device; gm1 and ro1.',
        { d: type === 'cascode' ? 'x' : 'out', g: input, s: type === 'cg' ? 'source' : rs ? 'RS_source' : 'VSS' });
      if (type === 'cg') {
        bias('VB_G', 94, inY, x - GLX);
        wire([[x, lower], [x, 178]], 'source'); dot(x, 178, 'source');
        if (rs) {
          terminal(44, 178, 60, 'vin', 'left');
          resistor('RS', 60, 178, 108, 178, 'Input series source resistance, not a shunt degeneration resistor.', { p: 'vin', n: 'source' });
          wire([[108, 178], [x, 178]], 'source');
          wire([[x, 178], [195, 178]], 'source'); dot(195, 178, 'source');
          shuntCap('CX', 195, 178, 'Lumped source-node capacitance; shorted by ideal drive when RS = 0.', 'source');
        } else terminal(44, 178, x, 'vin', 'left');
        currentSource('IB', x, 178, 'Ideal source-node DC bias current; AC open circuit.', 'source');
        supply('VSS', 234, [x]);
      } else {
        terminal(44, inY, x - GLX, 'vin', 'left');
        if (type === 'cs') {
          dot(80, inY, 'vin'); wire([[80, inY], [80, 96]], 'vin');
          capacitorBetween('CF', 80, 96, x, 'Direct gate-drain feedforward capacitance; zero omits this branch.', { p: 'vin', n: 'out' });
        }
        sourceLeg(x, lower, 'RS');
        supply('VSS', rs ? lower + 48 : lower, [x]);
      }
    } else if (type === 'follower') {
      const x = 150;
      supply('VDD', 30, [x]); wire([[x, 30], [x, 34]], 'VDD');
      mos('M1', x, 58, false, false, 'left', 'Input follower; gm1, ro1. Body effect neglected.', { d: 'VDD', g: 'vin', s: 'out' }, 'lead', 'center');
      terminal(44, 58, x - GLX, 'vin', 'left');
      dot(80, 58, 'vin'); wire([[80, 58], [80, 100]], 'vin');
      capacitorBetween('CGS', 80, 100, x, 'Gate-source feedforward capacitance; zero omits this branch.', { p: 'vin', n: 'out' });
      wire([[x, 82], [x, 100]], 'out'); dot(x, 100, 'out'); dot(200, 100, 'out'); dot(245, 100, 'out');
      terminal(290, 100, x, 'vout', 'right');
      currentSource('IB', x, 100, 'Ideal DC bias current; infinite small-signal resistance.', 'out');
      resistor('RL', 200, 100, 200, 156, 'Source load resistance RL.', { p: 'out', n: 'VSS' });
      shuntCap('CL', 245, 100, 'Output capacitance excluding CGS.', 'out');
      supply('VSS', 156, [x, 200]);
    } else if (type === 'diff-five') {
      const xL = 110, xR = 230, mid = 170, tailY = rs ? 234 : 186;
      supply('VDD', 30, [xL, xR]); wire([[xL, 30], [xL, 34]], 'VDD'); wire([[xR, 30], [xR, 34]], 'VDD');
      mos('M3', xL, 58, true, true, 'right', 'Diode-connected reference mirror; gm3, ro3 matched to M4.', { d: 'x', g: 'x', s: 'VDD' });
      mos('M4', xR, 58, true, true, 'left', 'Output mirror; gm3, ro3 matched to M3.', { d: 'out', g: 'x', s: 'VDD' });
      wire([[xL + GLX, 58], [xR - GLX, 58]], 'x'); dot(mid, 58, 'x');
      wire([[mid, 58], [mid, 96], [xL, 96]], 'x'); dot(xL, 96, 'x');
      wire([[xL, 82], [xL, 126]], 'x'); wire([[xL, 96], [70, 96]], 'x');
      shuntCap('CX', 70, 96, 'Mirror/reference-node lumped capacitance.', 'x', 'left');
      wire([[xR, 82], [xR, 126]], 'out'); dot(xR, 96, 'out'); dot(270, 96, 'out');
      terminal(310, 96, xR, 'vout', 'right');
      shuntCap('CL', 270, 96, 'Single-ended output lumped capacitance.', 'out');
      mos('M1', xL, 150, false, false, 'left', 'Positive input; matched gm1, ro1 pair.', { d: 'x', g: 'vin+', s: rs ? 'RS1_source' : 'tail' });
      mos('M2', xR, 150, false, false, 'right', 'Negative input; matched gm1, ro1 pair.', { d: 'out', g: 'vin-', s: rs ? 'RS2_source' : 'tail' });
      terminal(44, 150, xL - GLX, 'vin+', 'left'); terminal(300, 150, xR + GLX, 'vin-', 'right');
      [xL, xR].forEach((x, i) => {
        sourceLeg(x, 174, 'RS' + (i + 1), 'tail');
        wire([[x, rs ? 222 : 174], [x, tailY]], 'tail');
      });
      wire([[xL, tailY], [xR, tailY]], 'tail'); dot(mid, tailY, 'tail');
      mos('M5', mid, tailY + LEAD, false, false, 'left', 'Tail bias transistor idealized as an AC current source (ro → ∞).', { d: 'tail', g: 'VB_T', s: 'VSS' }, 'lead', 'center');
      bias('VB_T', mid - 56, tailY + LEAD, mid - GLX);
      supply('VSS', tailY + 48, [mid]);
    } else if (type === 'diff-cg') {
      const xL = 140, xR = 300, mid = 220;
      supply('VDD', 30, [xL, xR]);
      [xL, xR].forEach((x, i) => {
        const suffix = i === 0 ? '+' : '-', out = 'out' + suffix, source = 'source' + (i + 1), inward = i === 0 ? 1 : -1;
        load(x, 'RL' + (i + 1), 'M' + (i + 3), 'source');
        wire([[x, 82], [x, 136]], out); dot(x, 106, out);
        if (i === 0) dot(x + 20, 106, out); else wire([[x, 106], [x + 20, 106]], out);
        terminal(x + inward * 44, 106, x, 'vout' + suffix, suffix);
        shuntCap('CL' + (i + 1), x + 20, 106, 'CL per output, not a capacitor between outputs.', out);
        mos('M' + (i + 1), x, 160, false, false, 'left', 'Common-gate input; gm1, ro1 matched in both branches.', { d: out, g: 'VB_G', s: source });
        wire([[x, 184], [x, 208]], source); dot(x, 208, source);
        if (rs) {
          wire([[x, 208], [x + inward * 40, 208]], source);
          shuntCap('CX' + (i + 1), x + inward * 40, 208, 'Lumped capacitance per source node.', source, i === 0 ? 'right' : 'left');
        }
        const terminalX = i === 0 ? 44 : 396;
        if (rs) {
          const outer = x - inward * 76, inner = x - inward * 28;
          terminal(terminalX, 208, outer, 'vin' + suffix, i === 0 ? 'left' : 'right');
          resistor('RS' + (i + 1), outer, 208, inner, 208, 'Series input source resistance RS per branch.', { p: 'vin' + suffix, n: source });
          wire([[inner, 208], [x, 208]], source);
        } else terminal(terminalX, 208, x, 'vin' + suffix, i === 0 ? 'left' : 'right');
        currentSource('IB' + (i + 1), x, 208, 'Ideal DC bias; no small-signal admittance.', source, i === 0 ? 'left' : 'right');
      });
      if (config.load === 'active') {
        bias('VB_L', xL - 56, 58, xL - GLX); wire([[xL - CHX, 58], [xR - GLX, 58]], 'VB_L');
        wire([[xL, 30], [xL, 34]], 'VDD'); wire([[xR, 30], [xR, 34]], 'VDD');
      }
      textScreen(mid, Y(106), 'vout', 'middle');
      bias('VB_G', xL - 56, 160, xL - GLX); wire([[xL - CHX, 160], [xR - GLX, 160]], 'VB_G');
      supply('VSS', 264, [xL, xR]);
    } else if (type === 'diff-cascode') {
      const xL = 120, xR = 280, mid = 200, tailY = rs ? 380 : 332;
      supply('VDD', 30, [xL, xR]);
      [xL, xR].forEach((x, i) => {
        const suffix = i === 0 ? '+' : '-', out = 'out' + suffix, internal = 'x' + (i + 1), inward = i === 0 ? 1 : -1;
        mos('M' + (i + 7), x, 58, true, true, 'left', 'Outer load bias device; ro7 per device.', { d: 'load' + (i + 1), g: 'VB_L', s: 'VDD' });
        mos('M' + (i + 5), x, 122, true, true, 'left', 'Load cascode; gm5, ro5. Its internal capacitance is omitted.', { d: out, g: 'VB_LC', s: 'load' + (i + 1) });
        mos('M' + (i + 3), x, 216, false, false, 'left', 'Signal-path cascode; gm3, ro3.', { d: out, g: 'VB_C', s: internal });
        mos('M' + (i + 1), x, 296, false, false, i === 0 ? 'left' : 'right', 'Input pair; matched gm1, ro1.', { d: internal, g: 'vin' + suffix, s: rs ? 'RS' + (i + 1) + '_source' : 'tail' });
        wire([[x, 30], [x, 34]], 'VDD'); wire([[x, 82], [x, 98]], 'load' + (i + 1));
        wire([[x, 146], [x, 192]], out); dot(x, 168, out);
        if (i === 0) dot(x + 20, 168, out); else wire([[x, 168], [x + 20, 168]], out);
        terminal(x + inward * 44, 168, x, 'vout' + suffix, suffix);
        shuntCap('CL' + (i + 1), x + 20, 168, 'CL per output to AC ground.', out);
        wire([[x, 240], [x, 272]], internal); dot(x, 260, internal); wire([[x, 260], [x + inward * 40, 260]], internal);
        shuntCap('CX' + (i + 1), x + inward * 40, 260, 'Signal cascode source-node capacitance per half circuit.', internal, i === 0 ? 'right' : 'left');
        terminal(i === 0 ? 44 : 340, 296, x - inward * GLX, 'vin' + suffix, i === 0 ? 'left' : 'right');
        sourceLeg(x, 320, 'RS' + (i + 1), 'tail');
        wire([[x, rs ? 368 : 320], [x, tailY]], 'tail');
      });
      [[58, 'VB_L'], [122, 'VB_LC'], [216, 'VB_C']].forEach(([y, net]) => {
        bias(net, xL - 56, y, xL - GLX); wire([[xL - CHX, y], [xR - GLX, y]], net);
      });
      textScreen(mid, Y(168), 'vout', 'middle');
      wire([[xL, tailY], [xR, tailY]], 'tail'); dot(mid, tailY, 'tail');
      mos('M9', mid, tailY + LEAD, false, false, 'left', 'Tail bias; ideal AC source in matched differential mode. CMFB is not modeled.', { d: 'tail', g: 'VB_T', s: 'VSS' }, 'lead', 'center');
      bias('VB_T', mid - 56, tailY + LEAD, mid - GLX);
      supply('VSS', tailY + 48, [mid]);
    } else {
      const xa = 110, xb = 190, xt = 150, xF1 = 290, xF2 = 420, pairY = 210, tailY = rs ? 294 : 246;
      supply('VDD', 30, [xF1, xF2]);
      [xF1, xF2].forEach((x, i) => {
        const suffix = i === 0 ? '+' : '-', out = 'out' + suffix, internal = 'x' + (i + 1), sink = 'sink' + (i + 1), inward = i === 0 ? 1 : -1;
        mos('M' + (i + 3), x, 58, true, true, 'left', 'Folding-node bias current source; ro3 per device.', { d: internal, g: 'VB_B', s: 'VDD' });
        mos('M' + (i + 5), x, 156, true, true, 'left', 'Opposite-polarity folding common-gate device; gm5, ro5.', { d: out, g: 'VB_F', s: internal });
        mos('M' + (i + 7), x, 256, false, false, 'left', 'Output sink cascode; gm7, ro7. Internal load capacitance omitted.', { d: out, g: 'VB_OC', s: sink });
        mos('M' + (i + 9), x, 320, false, false, 'left', 'Output sink bias device; ro9 per device.', { d: sink, g: 'VB_O', s: 'VSS' }, 'lead', 'drain');
        wire([[x, 30], [x, 34]], 'VDD'); wire([[x, 82], [x, 132]], internal);
        wire([[x, 180], [x, 232]], out); dot(x, 206, out);
        if (i === 0) dot(x + 18, 206, out); else wire([[x, 206], [x + 18, 206]], out);
        terminal(x + inward * 40, 206, x, 'vout' + suffix, suffix);
        shuntCap('CL' + (i + 1), x + 18, 206, 'CL per output; folded branches are independent in differential mode.', out);
        wire([[x, 280], [x, 296]], sink);
      });
      [[58, 'VB_B'], [156, 'VB_F'], [256, 'VB_OC'], [320, 'VB_O']].forEach(([y, net]) => {
        bias(net, xF1 - 56, y, xF1 - GLX); wire([[xF1 - CHX, y], [xF2 - GLX, y]], net);
      });
      textScreen((xF1 + xF2) / 2, Y(206), 'vout', 'middle');
      supply('VSS', 344, [xF1, xF2]);
      mos('M1', xa, pairY, false, false, 'left', 'Differential input; gm1, ro1 matched.', { d: 'x1', g: 'vin+', s: rs ? 'RS1_source' : 'tail' });
      mos('M2', xb, pairY, false, false, 'right', 'Differential input; gm1, ro1 matched.', { d: 'x2', g: 'vin-', s: rs ? 'RS2_source' : 'tail' });
      // Book-style routing: the vin− return and the Y track cross other nets without junction dots.
      wire([[xa, pairY - LEAD], [xa, 96], [xF1, 96]], 'x1'); dot(xF1, 96, 'x1'); dot(xt, 96, 'x1');
      wire([[xb, pairY - LEAD], [xb, 108], [xF2, 108]], 'x2'); dot(xF2, 108, 'x2'); dot(355, 108, 'x2');
      label(xF1 + 7, 96, 'X'); label(xF2 - 7, 96, 'Y', 'end');
      shuntCap('CX1', xt, 96, 'Input drain / folding source lumped capacitance per half circuit.', 'x1', 'left');
      shuntCap('CX2', 355, 108, 'Input drain / folding source lumped capacitance per half circuit.', 'x2', 'left');
      terminal(44, pairY, xa - GLX, 'vin+', 'left');
      terminal(44, 180, xb + GLX, 'vin-', 'left'); wire([[xb + GLX, 180], [xb + GLX, pairY]], 'vin-');
      [xa, xb].forEach((x, i) => {
        sourceLeg(x, pairY + LEAD, 'RS' + (i + 1), 'tail', i === 0 ? 'right' : 'left');
        wire([[x, pairY + LEAD + (rs ? 48 : 0)], [x, tailY]], 'tail');
      });
      wire([[xa, tailY], [xb, tailY]], 'tail'); dot(xt, tailY, 'tail');
      mos('M11', xt, tailY + LEAD, false, false, 'left', 'Input tail bias, idealized in differential mode. CMFB and bias generators are external.', { d: 'tail', g: 'VB_T', s: 'VSS' }, 'lead', 'center');
      bias('VB_T', xt - 56, tailY + LEAD, xt - GLX);
      supply('VSS', tailY + 48, [xt], false);
    }

    const title = (mirror ? 'PMOS' : 'NMOS') + ' input · ' + titles[type];
    const caption = 'All bias ports and supplies are AC ground. All capacitor ground symbols denote AC ground. CL / CX are lumped small-signal capacitances; ideal bias and body-effect assumptions apply.';
    const svg = '<svg ' + attr({ xmlns: 'http://www.w3.org/2000/svg', width, height, viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': title, 'font-family': FONT }) + '>'
      + '<title>' + escape(title) + '</title><desc>' + escape(caption) + '</desc>'
      + tag('rect', { width, height, fill: colors.bg })
      + content.join('')
      + '</svg>';
    return { svg, width, height, devices };
  }

  const api = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.ICAnalogSchematic = api;
})();
