(function () {
  'use strict';

  const titles = {
    cs: 'Common-source amplifier', cg: 'Common-gate amplifier', cascode: 'Common-source / common-gate cascode',
    follower: 'Source follower', 'diff-five': 'Five-transistor differential amplifier',
    'diff-cg': 'Differential common-gate amplifier', 'diff-cascode': 'Differential telescopic cascode',
    'folded-cascode': 'Differential folded cascode'
  };
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function render(raw, forDownload = false) {
    const config = { type: 'cs', polarity: 'nmos', sourceResistance: false, load: 'resistor', ...raw };
    if (!Object.hasOwn(titles, config.type) || !['nmos', 'pmos'].includes(config.polarity)) throw new Error('Unknown schematic configuration.');
    const type = config.type;
    const mirror = config.polarity === 'pmos';
    const dimensions = type === 'folded-cascode' ? [900, 670] : type === 'diff-cascode' ? [680, config.sourceResistance ? 830 : 770]
      : type === 'diff-five' ? [640, config.sourceResistance ? 620 : 560] : type === 'diff-cg' ? [700, 500]
      : type === 'cascode' ? [480, config.sourceResistance ? 580 : 510] : type === 'follower' ? [500, 380]
      : type === 'cg' ? [480, 460] : [460, config.sourceResistance ? 440 : 380];
    const [width, height] = dimensions;
    const colors = forDownload
      ? { bg: '#ffffff', wire: '#35455b', device: '#162033', muted: '#5e7088', input: '#007d91', output: '#6944a3' }
      : { bg: '#0d1322', wire: '#a8b9d1', device: '#e2e8f0', muted: '#8b9bb4', input: '#22d3ee', output: '#b9a0ff' };
    const devices = [];
    const content = [];
    const Y = y => mirror ? height - y : y;
    const nodeName = name => mirror && name === 'VDD' ? 'VSS' : mirror && name === 'VSS' ? 'VDD' : name;
    const attr = values => Object.entries(values).map(([key, value]) => key + '="' + escape(value) + '"').join(' ');
    const tag = (name, values, text) => '<' + name + ' ' + attr(values) + '>' + (text === undefined ? '' : escape(text)) + '</' + name + '>';
    const textScreen = (x, y, text, anchor = 'start', color = colors.muted, size = 13, baseline) => {
      const attributes = { x, y, fill: color, 'text-anchor': anchor, 'font-size': size,
        ...(baseline ? { 'dominant-baseline': baseline } : {}) };
      const identifier = /^([MCRIV])([A-Z0-9]+(?:_[A-Z0-9]+)*)$/.exec(text)
        || /^(v)(in|out)([+-])?$/.exec(text) || /^(x)(\d*)$/.exec(text);
      if (!identifier) {
        content.push(tag('text', attributes, text));
        return;
      }
      const [, base, subscript, superscript] = identifier;
      content.push('<text ' + attr({ ...attributes, 'font-family': 'Cambria Math,STIX Two Math,Times New Roman,serif', 'aria-label': text }) + '>'
        + escape(base)
        + (subscript ? tag('tspan', { 'baseline-shift': 'sub', 'font-size': '75%' }, subscript.replace(/_/g, ',')) : '')
        + (superscript ? tag('tspan', { 'baseline-shift': 'super', 'font-size': '75%' }, superscript) : '')
        + '</text>');
    };
    const label = (x, y, text, anchor = 'start', color = colors.muted) => textScreen(x, Y(y) + (mirror ? 22 : -14), text, anchor, color);
    const lineScreen = (points, color = colors.wire, net) => content.push(tag('polyline', {
      points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...(net ? { 'data-net': nodeName(net) } : {})
    }));
    const wire = (points, net) => lineScreen(points.map(([x, y]) => [x, Y(y)]), colors.wire, net);
    const dot = (x, y, net) => content.push(tag('circle', { cx: x, cy: Y(y), r: 3.4, fill: colors.wire, 'data-net': nodeName(net) }));
    const addDevice = (name, description, kind, nodes) => {
      devices.push({ name, description, kind, nodes: Object.fromEntries(Object.entries(nodes).map(([pin, net]) => [pin, nodeName(net)])) });
      content.push('<g ' + attr({ 'data-device': name, 'data-kind': kind }) + '><title>' + escape(name + ' — ' + description) + '</title>');
    };
    const rail = (y, name, ...connections) => {
      const left = Math.min(...connections), right = Math.max(...connections);
      wire([[left - 12, y], [right + 12, y]], name);
      textScreen(right + 22, Y(y) + 4, nodeName(name), 'start', colors.device, 14);
    };
    const port = (x, y, endX, name, output = false) => {
      wire([[x, y], [endX, y]], name);
      content.push(tag('circle', { cx: x, cy: Y(y), r: 4, fill: colors.bg, stroke: output ? colors.output : colors.input, 'stroke-width': 2 }));
      textScreen(x, Y(y) + (mirror && !output ? 24 : -18), name, x < endX ? 'start' : 'end', output ? colors.output : colors.input, 14);
    };
    const mos = (name, x, y, baseP, sourceTop, gateSide, description, nodes) => {
      const pmos = mirror ? !baseP : baseP;
      const side = gateSide === 'right' ? 1 : -1;
      const X = offset => x + side * offset;
      addDevice(name, description, pmos ? 'pmos' : 'nmos', nodes);
      wire([[x, y - 48], [x, y - 20], [X(32), y - 20]], sourceTop ? nodes.s : nodes.d);
      wire([[x, y + 48], [x, y + 20], [X(32), y + 20]], sourceTop ? nodes.d : nodes.s);
      lineScreen([[X(32), Y(y - 28)], [X(32), Y(y + 28)]], colors.device);
      lineScreen([[X(40), Y(y - 22)], [X(40), Y(y + 22)]], colors.device);
      wire([[X(66), y], [X(40), y]], nodes.g);
      const sourceY = Y(y + (sourceTop ? -20 : 20));
      const tipX = X(pmos ? 28 : 4), baseX = X(pmos ? 12 : 20);
      content.push(tag('polygon', {
        points: [[tipX, sourceY], [baseX, sourceY - 7], [baseX, sourceY + 7]].map(point => point.join(',')).join(' '),
        fill: colors.device
      }));
      const labelX = x - side * 18;
      const anchor = side === -1 ? 'start' : 'end';
      textScreen(labelX, Y(y), name, anchor, colors.device, 15, 'middle');
      content.push('</g>');
    };
    const resistor = (name, x1, y1, x2, y2, description, nodes) => {
      addDevice(name, description, 'resistor', nodes);
      const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
      const center = length / 2, half = Math.min(18, length * 0.3), points = [[x1, y1], [x1 + ux * (center - half), y1 + uy * (center - half)]];
      for (let i = 0; i < 6; i++) {
        const distance = center - half + (i + 0.5) * half / 3;
        const offset = i % 2 ? -10 : 10;
        points.push([x1 + ux * distance - uy * offset, y1 + uy * distance + ux * offset]);
      }
      points.push([x1 + ux * (center + half), y1 + uy * (center + half)], [x2, y2]);
      wire(points);
      textScreen((x1 + x2) / 2 + (dx === 0 ? 18 : 0), Y((y1 + y2) / 2) + (dx === 0 ? 0 : mirror ? 28 : -23), name, dx === 0 ? 'start' : 'middle', colors.device);
      content.push('</g>');
    };
    const capacitorBetween = (name, x1, y, x2, description, nodes) => {
      addDevice(name, description, 'capacitor', nodes);
      const middle = (x1 + x2) / 2;
      wire([[x1, y], [middle - 5, y]], nodes.p);
      wire([[middle + 5, y], [x2, y]], nodes.n);
      wire([[middle - 5, y - 13], [middle - 5, y + 13]]);
      wire([[middle + 5, y - 13], [middle + 5, y + 13]]);
      textScreen(middle, Y(y) + (mirror ? 31 : -26), name, 'middle', colors.device);
      content.push('</g>');
    };
    const shuntCap = (name, x, y, description, net, length = 50) => {
      addDevice(name, description, 'capacitor', { p: net, n: 'AC ground' });
      const start = Y(y), middle = start + length / 2, end = start + length;
      lineScreen([[x, start], [x, middle - 5]], colors.wire, net);
      lineScreen([[x - 13, middle - 5], [x + 13, middle - 5]], colors.device);
      lineScreen([[x - 13, middle + 5], [x + 13, middle + 5]], colors.device);
      lineScreen([[x, middle + 5], [x, end]]);
      [12, 8, 4].forEach((half, i) => lineScreen([[x - half, end + i * 5], [x + half, end + i * 5]]));
      textScreen(x + 20, middle + 4, name, 'start', colors.device);
      content.push('</g>');
    };
    const currentSource = (name, x, y1, y2, description, net) => {
      addDevice(name, description, 'current-source', { p: net, n: 'VSS' });
      const mid = (y1 + y2) / 2;
      wire([[x, y1], [x, mid - 20]], net);
      wire([[x, mid + 20], [x, y2]], 'VSS');
      content.push(tag('circle', { cx: x, cy: Y(mid), r: 20, fill: colors.bg, stroke: colors.device, 'stroke-width': 2 }));
      lineScreen([[x, Y(mid) - 10], [x, Y(mid) + 10]], colors.device);
      lineScreen([[x - 5, Y(mid) + 4], [x, Y(mid) + 10], [x + 5, Y(mid) + 4]], colors.device);
      textScreen(x + 29, Y(mid) - 2, name, 'start', colors.device);
      content.push('</g>');
    };
    const sourceLeg = (x, y1, y2, name, tail = 'VSS') => {
      if (config.sourceResistance) resistor(name, x, y1, x, y2, 'Source degeneration resistance RS.', { p: name + '_source', n: tail });
      else wire([[x, y1], [x, y2]], tail);
    };
    const load = (x, outY, name, mosName, gateSide = 'left') => {
      if (config.load === 'active') {
        const y = (60 + outY) / 2;
        mos(mosName, x, y, true, true, gateSide, 'AC-grounded current-source load; output resistance roL.', { d: name === 'RL' ? 'out' : name === 'RL1' ? 'out+' : 'out-', g: 'VB_L', s: 'VDD' });
        wire([[x, 60], [x, y - 48]], 'VDD');
        wire([[x, y + 48], [x, outY]], name === 'RL' ? 'out' : name === 'RL1' ? 'out+' : 'out-');
        const direction = gateSide === 'left' ? -1 : 1;
        port(x + direction * 100, y, x + direction * 66, 'VB_L');
      } else resistor(name, x, 60, x, outY, 'Load resistance RL' + (name === 'RL' ? '.' : ' per branch.'), { p: 'VDD', n: name === 'RL' ? 'out' : name === 'RL1' ? 'out+' : 'out-' });
    };

    if (['cs', 'cg', 'follower'].includes(type)) {
      const x = type === 'follower' ? 210 : 220, bottom = height - 55;
      rail(60, 'VDD', x);
      if (type === 'follower') {
        rail(bottom, 'VSS', x, 300);
        mos('M1', x, 150, false, false, 'left', 'Input follower; gm1, ro1. Body effect neglected.', { d: 'VDD', g: 'vin', s: 'out' });
        wire([[x, 60], [x, 102]], 'VDD');
        wire([[x, 198], [x, 225]], 'out');
        port(55, 150, x - 66, 'vin');
        wire([[100, 150], [100, 225]], 'vin'); dot(100, 150, 'vin');
        capacitorBetween('CGS', 100, 225, x, 'Gate-source feedforward capacitance; zero omits this branch.', { p: 'vin', n: 'out' });
        currentSource('IB', x, 225, bottom, 'Ideal DC bias current; infinite small-signal resistance.', 'out');
        resistor('RL', 300, 225, 300, bottom, 'Source load resistance RL.', { p: 'out', n: 'VSS' });
        dot(x, 225, 'out'); dot(300, 225, 'out'); dot(385, 225, 'out');
        port(440, 225, x, 'vout', true);
        shuntCap('CL', 385, 225, 'Output capacitance excluding CGS.', 'out');
      } else {
        rail(bottom, 'VSS', x);
        load(x, 180, 'RL', 'M2');
        mos('M1', x, 240, false, false, 'left', 'Input device; gm1 and ro1.', { d: 'out', g: type === 'cg' ? 'VB_G' : 'vin', s: type === 'cg' ? 'source' : config.sourceResistance ? 'RS_source' : 'VSS' });
        wire([[x, 180], [x, 192]], 'out');
        dot(x, 180, 'out'); dot(340, 180, 'out');
        port(width - 40, 180, x, 'vout', true);
        shuntCap('CL', 340, 180, type === 'cs' ? 'Output capacitance excluding CF.' : 'Output lumped capacitance.', 'out');
        port(type === 'cg' ? 120 : 55, 240, x - 66, type === 'cg' ? 'VB_G' : 'vin');
        if (type === 'cs') {
          wire([[100, 240], [100, 180]], 'vin'); dot(100, 240, 'vin');
          capacitorBetween('CF', 100, 180, x, 'Direct gate-drain feedforward capacitance; zero omits this branch.', { p: 'vin', n: 'out' });
          wire([[x, 288], [x, 300]], config.sourceResistance ? 'RS_source' : 'VSS');
          sourceLeg(x, 300, config.sourceResistance ? 360 : bottom, 'RS');
          if (config.sourceResistance) wire([[x, 360], [x, bottom]], 'VSS');
        } else {
          wire([[x, 288], [x, 315]], 'source'); dot(x, 315, 'source');
          if (config.sourceResistance) {
            port(55, 315, 100, 'vin');
            resistor('RS', 100, 315, 170, 315, 'Input series source resistance, not a shunt degeneration resistor.', { p: 'vin', n: 'source' });
            wire([[170, 315], [320, 315]], 'source');
            shuntCap('CX', 320, 315, 'Lumped source-node capacitance; shorted by ideal drive when RS = 0.', 'source');
          } else port(55, 315, x, 'vin');
          currentSource('IB', x, 315, bottom, 'Ideal source-node DC bias current; AC open circuit.', 'source');
        }
      }
    } else if (type === 'cascode') {
      const x = 220, bottom = height - 55;
      rail(60, 'VDD', x); rail(bottom, 'VSS', x);
      load(x, 180, 'RL', 'M3');
      mos('M2', x, 240, false, false, 'left', 'Common-gate cascode; gm2, ro2.', { d: 'out', g: 'VB_C', s: 'x' });
      mos('M1', x, 380, false, false, 'left', 'Input common-source device; gm1, ro1.', { d: 'x', g: 'vin', s: config.sourceResistance ? 'RS_source' : 'VSS' });
      port(120, 240, x - 66, 'VB_C'); port(55, 380, x - 66, 'vin');
      wire([[x, 180], [x, 192]], 'out');
      wire([[x, 288], [x, 332]], 'x'); dot(x, 310, 'x');
      wire([[x, 310], [335, 310]], 'x'); label(270, 310, 'x', 'middle');
      shuntCap('CX', 335, 310, 'Cascode source / input drain lumped capacitance.', 'x', 46);
      dot(x, 180, 'out'); dot(385, 180, 'out');
      port(440, 180, x, 'vout', true); shuntCap('CL', 385, 180, 'Output lumped capacitance.', 'out');
      wire([[x, 428], [x, 440]], config.sourceResistance ? 'RS_source' : 'VSS');
      sourceLeg(x, 440, config.sourceResistance ? 500 : bottom, 'RS');
      if (config.sourceResistance) wire([[x, 500], [x, bottom]], 'VSS');
    } else if (type === 'diff-five') {
      const tailY = config.sourceResistance ? 435 : 375, tailMosY = tailY + 60, bottom = height - 55;
      rail(60, 'VDD', 200, 440); rail(bottom, 'VSS', 320);
      mos('M3', 200, 130, true, true, 'right', 'Diode-connected reference mirror; gm3, ro3 matched to M4.', { d: 'x', g: 'x', s: 'VDD' });
      mos('M4', 440, 130, true, true, 'left', 'Output mirror; gm3, ro3 matched to M3.', { d: 'out', g: 'x', s: 'VDD' });
      wire([[200, 60], [200, 82]], 'VDD'); wire([[440, 60], [440, 82]], 'VDD');
      wire([[266, 130], [374, 130]], 'x');
      wire([[290, 130], [290, 215], [200, 215]], 'x'); dot(290, 130, 'x'); dot(200, 215, 'x');
      label(330, 130, 'mirror', 'middle');
      mos('M1', 200, 300, false, false, 'left', 'Positive input; matched gm1, ro1 pair.', { d: 'x', g: 'vin+', s: config.sourceResistance ? 'RS1_source' : 'tail' });
      mos('M2', 440, 300, false, false, 'right', 'Negative input; matched gm1, ro1 pair.', { d: 'out', g: 'vin-', s: config.sourceResistance ? 'RS2_source' : 'tail' });
      wire([[200, 178], [200, 252]], 'x'); wire([[440, 178], [440, 252]], 'out');
      port(55, 300, 134, 'vin+'); port(585, 300, 506, 'vin-');
      wire([[200, 215], [100, 215]], 'x'); shuntCap('CX', 100, 215, 'Mirror/reference-node lumped capacitance.', 'x');
      dot(440, 215, 'out'); dot(540, 215, 'out');
      port(585, 215, 440, 'vout', true); shuntCap('CL', 540, 215, 'Single-ended output lumped capacitance.', 'out');
      [200, 440].forEach((x, i) => {
        wire([[x, 348], [x, 360]], config.sourceResistance ? 'RS' + (i + 1) + '_source' : 'tail');
        sourceLeg(x, 360, config.sourceResistance ? 420 : tailY, 'RS' + (i + 1), 'tail');
        if (config.sourceResistance) wire([[x, 420], [x, tailY]], 'tail');
      });
      wire([[200, tailY], [440, tailY]], 'tail'); dot(320, tailY, 'tail');
      mos('M5', 320, tailMosY, false, false, 'left', 'Tail bias transistor idealized as an AC current source (ro → ∞).', { d: 'tail', g: 'VB_T', s: 'VSS' });
      wire([[320, tailY], [320, tailMosY - 48]], 'tail'); wire([[320, tailMosY + 48], [320, bottom]], 'VSS'); port(220, tailMosY, 254, 'VB_T');
    } else if (type === 'diff-cg') {
      rail(60, 'VDD', 220, 480); rail(445, 'VSS', 220, 480);
      [220, 480].forEach((x, i) => {
        const suffix = i === 0 ? '+' : '-', out = 'out' + suffix, source = 'source' + (i + 1);
        load(x, 200, 'RL' + (i + 1), 'M' + (i + 3), i === 0 ? 'left' : 'right');
        mos('M' + (i + 1), x, 270, false, false, i === 0 ? 'right' : 'left', 'Common-gate input; gm1, ro1 matched in both branches.', { d: out, g: 'VB_G', s: source });
        wire([[x, 200], [x, 222]], out); wire([[x, 318], [x, 355]], source);
        const outputX = i === 0 ? 55 : 645, capX = i === 0 ? 110 : 590;
        port(outputX, 200, x, 'vout' + suffix, true); dot(x, 200, out); dot(capX, 200, out);
        shuntCap('CL' + (i + 1), capX, 200, 'CL per output, not a capacitor between outputs.', out, 48);
        const inputX = i === 0 ? 55 : 645, inner = i === 0 ? 180 : 520, outer = i === 0 ? 100 : 600;
        if (config.sourceResistance) {
          port(inputX, 355, outer, 'vin' + suffix);
          resistor('RS' + (i + 1), outer, 355, inner, 355, 'Series input source resistance RS per branch.', { p: 'vin' + suffix, n: source });
          wire([[inner, 355], [x, 355]], source);
          const cap = i === 0 ? 290 : 410;
          wire([[x, 355], [cap, 355]], source);
          shuntCap('CX' + (i + 1), cap, 355, 'Lumped capacitance per source node.', source);
        } else port(inputX, 355, x, 'vin' + suffix);
        dot(x, 355, source); currentSource('IB' + (i + 1), x, 355, 445, 'Ideal DC bias; no small-signal admittance.', source);
      });
      wire([[286, 270], [414, 270]], 'VB_G'); wire([[350, 242], [350, 270]], 'VB_G'); dot(350, 270, 'VB_G');
      textScreen(350, Y(242) + (mirror ? 22 : -14), 'VB_G', 'middle', colors.input);
    } else if (type === 'diff-cascode') {
      const tailY = config.sourceResistance ? 650 : 590, tailMosY = tailY + 60, bottom = height - 55;
      rail(60, 'VDD', 220, 460); rail(bottom, 'VSS', 340);
      [220, 460].forEach((x, i) => {
        const suffix = i === 0 ? '+' : '-', side = i === 0 ? 'right' : 'left', out = 'out' + suffix, internal = 'x' + (i + 1);
        mos('M' + (i + 7), x, 120, true, true, side, 'Outer load bias device; ro7 per device.', { d: 'load' + (i + 1), g: 'VB_L', s: 'VDD' });
        mos('M' + (i + 5), x, 228, true, true, side, 'Load cascode; gm5, ro5. Its internal capacitance is omitted.', { d: out, g: 'VB_LC', s: 'load' + (i + 1) });
        mos('M' + (i + 3), x, 374, false, false, side, 'Signal-path cascode; gm3, ro3.', { d: out, g: 'VB_C', s: internal });
        mos('M' + (i + 1), x, 514, false, false, i === 0 ? 'left' : 'right', 'Input pair; matched gm1, ro1.', { d: internal, g: 'vin' + suffix, s: config.sourceResistance ? 'RS' + (i + 1) + '_source' : 'tail' });
        wire([[x, 60], [x, 72]], 'VDD'); wire([[x, 168], [x, 180]], 'load' + (i + 1));
        wire([[x, 276], [x, 326]], out); wire([[x, 422], [x, 466]], internal);
        const outputX = i === 0 ? 55 : 625, capX = i === 0 ? 100 : 580;
        port(outputX, 302, x, 'vout' + suffix, true); dot(x, 302, out); dot(capX, 302, out);
        shuntCap('CL' + (i + 1), capX, 302, 'CL per output to AC ground.', out, 44);
        const cx = i === 0 ? 120 : 560;
        wire([[x, 442], [cx, 442]], internal); dot(x, 442, internal);
        shuntCap('CX' + (i + 1), cx, 442, 'Signal cascode source-node capacitance per half circuit.', internal, 34);
        port(i === 0 ? 55 : 625, 514, x + (i === 0 ? -66 : 66), 'vin' + suffix);
        wire([[x, 562], [x, 574]], config.sourceResistance ? 'RS' + (i + 1) + '_source' : 'tail');
        sourceLeg(x, 574, config.sourceResistance ? 634 : tailY, 'RS' + (i + 1), 'tail');
        if (config.sourceResistance) wire([[x, 634], [x, tailY]], 'tail');
      });
      [[120, 'VB_L'], [228, 'VB_LC'], [374, 'VB_C']].forEach(([y, name]) => {
        wire([[286, y], [394, y]], name); dot(340, y, name); label(340, y, name, 'middle', colors.input);
      });
      wire([[220, tailY], [460, tailY]], 'tail'); dot(340, tailY, 'tail');
      mos('M9', 340, tailMosY, false, false, 'left', 'Tail bias; ideal AC source in matched differential mode. CMFB is not modeled.', { d: 'tail', g: 'VB_T', s: 'VSS' });
      wire([[340, tailY], [340, tailMosY - 48]], 'tail'); wire([[340, tailMosY + 48], [340, bottom]], 'VSS'); port(240, tailMosY, 274, 'VB_T');
    } else {
      const tailY = config.sourceResistance ? 475 : 415, tailMosY = tailY + 60;
      rail(60, 'VDD', 330, 570); rail(tailMosY + 68, 'VSS', 450);
      [0, 1].forEach(i => {
        const suffix = i === 0 ? '+' : '-', inputX = i === 0 ? 330 : 570, foldX = i === 0 ? 170 : 730;
        const out = 'out' + suffix, internal = 'x' + (i + 1), sink = 'sink' + (i + 1), facing = i === 0 ? 'left' : 'right';
        rail(615, 'VSS', foldX);
        mos('M' + (i + 3), inputX, 120, true, true, facing, 'Folding-node bias current source; ro3 per device.', { d: internal, g: 'VB_B', s: 'VDD' });
        mos('M' + (i + 1), inputX, 335, false, false, i === 0 ? 'right' : 'left', 'Differential input; gm1, ro1 matched.', { d: internal, g: 'vin' + suffix, s: config.sourceResistance ? 'RS' + (i + 1) + '_source' : 'tail' });
        mos('M' + (i + 5), foldX, 275, true, true, facing, 'Opposite-polarity folding common-gate device; gm5, ro5.', { d: out, g: 'VB_F', s: internal });
        mos('M' + (i + 7), foldX, 438, false, false, i === 0 ? 'right' : 'left', 'Output sink cascode; gm7, ro7. Internal load capacitance omitted.', { d: out, g: 'VB_OC', s: sink });
        mos('M' + (i + 9), foldX, 546, false, false, i === 0 ? 'right' : 'left', 'Output sink bias device; ro9 per device.', { d: sink, g: 'VB_O', s: 'VSS' });
        wire([[inputX, 60], [inputX, 72]], 'VDD'); wire([[inputX, 168], [inputX, 287]], internal);
        wire([[inputX, 205], [foldX, 205], [foldX, 227]], internal); dot(inputX, 205, internal);
        wire([[foldX, 323], [foldX, 390]], out); wire([[foldX, 486], [foldX, 498]], sink); wire([[foldX, 594], [foldX, 615]], 'VSS');
        const dir = i === 0 ? -1 : 1;
        port(inputX + dir * 100, 120, inputX + dir * 66, 'VB_B');
        port(foldX + dir * 100, 275, foldX + dir * 66, 'VB_F');
        port(foldX - dir * 110, 438, foldX - dir * 66, 'VB_OC');
        port(foldX - dir * 110, 546, foldX - dir * 66, 'VB_O');
        port(i === 0 ? 430 : 470, 335, inputX - dir * 66, 'vin' + suffix);
        const cx = i === 0 ? 245 : 650;
        dot(cx, 205, internal); shuntCap('CX' + (i + 1), cx, 205, 'Input drain / folding source lumped capacitance per half circuit.', internal, 40);
        const capX = i === 0 ? 70 : 830;
        port(i === 0 ? 40 : 860, 350, foldX, 'vout' + suffix, true); dot(foldX, 350, out); dot(capX, 350, out);
        shuntCap('CL' + (i + 1), capX, 350, 'CL per output; folded branches are independent in differential mode.', out, 46);
        wire([[inputX, 383], [inputX, 395]], config.sourceResistance ? 'RS' + (i + 1) + '_source' : 'tail');
        sourceLeg(inputX, 395, config.sourceResistance ? 455 : tailY, 'RS' + (i + 1), 'tail');
        if (config.sourceResistance) wire([[inputX, 455], [inputX, tailY]], 'tail');
      });
      wire([[330, tailY], [570, tailY]], 'tail'); dot(450, tailY, 'tail');
      mos('M11', 450, tailMosY, false, false, 'left', 'Input tail bias, idealized in differential mode. CMFB and bias generators are external.', { d: 'tail', g: 'VB_T', s: 'VSS' });
      wire([[450, tailY], [450, tailMosY - 48]], 'tail'); wire([[450, tailMosY + 48], [450, tailMosY + 68]], 'VSS'); port(350, tailMosY, 384, 'VB_T');
    }

    const title = (mirror ? 'PMOS' : 'NMOS') + ' input · ' + titles[type];
    const caption = 'All VB ports and supplies are AC ground. All capacitor ground symbols denote AC ground. CL / CX are lumped small-signal capacitances; ideal bias and body-effect assumptions apply.';
    const svg = '<svg ' + attr({ xmlns: 'http://www.w3.org/2000/svg', width, height, viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': title, 'font-family': 'Consolas,Menlo,monospace' }) + '>'
      + '<title>' + escape(title) + '</title><desc>' + escape(caption) + '</desc>'
      + tag('rect', { width, height, fill: colors.bg })
      + tag('text', { x: 24, y: 29, fill: colors.device, 'font-size': 14 }, title)
      + content.join('')
      + tag('text', { x: 24, y: height - 17, fill: colors.muted, 'font-size': 10 }, 'Source arrows indicate polarity. Capacitor grounds: AC ground.')
      + '</svg>';
    return { svg, width, height, devices };
  }

  const api = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.ICAnalogSchematic = api;
})();
