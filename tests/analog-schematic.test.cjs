'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describe } = require('../assets/js/analog-core.js');
const { render } = require('../assets/js/analog-schematic.js');

const types = ['cs', 'cg', 'cascode', 'follower', 'diff-five', 'diff-cg', 'diff-cascode', 'folded-cascode'];
const selectableLoads = new Set(['cs', 'cg', 'cascode', 'diff-cg']);
const differential = type => type.startsWith('diff-') || type === 'folded-cascode';
const twoOutputs = type => differential(type) && type !== 'diff-five';
const commonGate = type => type === 'cg' || type === 'diff-cg';
const swapSupply = net => net === 'VDD' ? 'VSS' : net === 'VSS' ? 'VDD' : net;
const complementKind = kind => kind === 'nmos' ? 'pmos' : kind === 'pmos' ? 'nmos' : kind;
const escapeXml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const sortedNames = devices => devices.map(device => device.name).sort();

function checkSvg({ svg, width, height, devices }, forDownload) {
  assert.equal(typeof svg, 'string');
  assert.ok(Number.isInteger(width) && width > 0);
  assert.ok(Number.isInteger(height) && height > 0);
  assert.match(svg, /^<svg\s/);
  assert.match(svg, /<\/svg>$/);
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes(`width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`));
  const background = svg.match(/<rect\b[^>]*\bfill="([^"]+)"/);
  assert.ok(background, 'a background rectangle is present');
  assert.equal(background[1], forDownload ? '#ffffff' : '#0d1322');
  assert.doesNotMatch(svg, /\b(?:NaN|Infinity|undefined)\b/);

  // Lexical checks do not replace browser XML parsing or geometric connectivity checks.
  assert.doesNotMatch(svg, /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/);
  const text = svg.replace(/<\/?[A-Za-z][\w:-]*(?:\s+[\w:-]+="[^"<]*")*\s*\/?>/g, '');
  assert.doesNotMatch(text, /[<>"']/, 'text/attributes must escape XML metacharacters');
  const allowedTags = new Set(['svg', 'title', 'desc', 'defs', 'pattern', 'circle', 'rect', 'text', 'tspan', 'polyline', 'polygon', 'g']);
  for (const [, tag] of svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g)) {
    assert.ok(allowedTags.has(tag), `unexpected SVG element: ${tag}`);
  }
  assert.doesNotMatch(svg, /<!|<\?|\s(?:on[\w:-]+|(?:xlink:)?href|src)\s*=|(?:javascript|data):|@import/i);
  for (const [, url] of svg.matchAll(/url\(([^)]*)\)/g)) {
    assert.equal(url, '#analog-grid', 'only the local grid pattern may be referenced');
  }
  assert.doesNotMatch(svg.replace('xmlns="http://www.w3.org/2000/svg"', ''), /(?:https?:)?\/\//i);

  const groups = [...svg.matchAll(/<g data-device="([^"]+)" data-kind="([^"]+)">/g)]
    .map(([, name, kind]) => ({ name, kind }));
  assert.deepEqual(groups, devices.map(({ name, kind }) => ({ name, kind })), 'SVG groups match legend devices');
  for (const device of devices) {
    assert.ok(svg.includes(`<title>${escapeXml(device.name + ' — ' + device.description)}</title>`),
      `${device.name}: escaped legend description appears in SVG`);
  }
}

function checkInventory({ config, parameters }, devices) {
  const { type, polarity, load } = config;
  const byName = Object.fromEntries(devices.map(device => [device.name, device]));
  assert.equal(Object.keys(byName).length, devices.length, 'device names are unique');
  const activeCount = load === 'active' ? (type === 'diff-cg' ? 2 : 1) : 0;
  const baseCounts = {
    cs: [1, 0], cg: [1, 0], cascode: [2, 0], follower: [1, 0],
    'diff-five': [3, 2], 'diff-cg': [2, 0], 'diff-cascode': [5, 4], 'folded-cascode': [7, 4]
  };
  const [samePolarity, oppositePolarity] = baseCounts[type];
  const mosCount = samePolarity + oppositePolarity + activeCount;
  assert.equal(devices.filter(device => device.kind === polarity).length, samePolarity);
  assert.equal(devices.filter(device => device.kind === complementKind(polarity)).length, oppositePolarity + activeCount);
  assert.deepEqual(sortedNames(devices.filter(device => /^(?:nmos|pmos)$/.test(device.kind))),
    Array.from({ length: mosCount }, (_, i) => 'M' + (i + 1)).sort());

  const expected = { resistor: [], capacitor: [] };
  for (const { key } of parameters) {
    const kind = ['RL', 'RS'].includes(key) ? 'resistor' : ['CL', 'CX', 'CF', 'CGS'].includes(key) ? 'capacitor' : null;
    if (!kind) continue;
    const paired = key === 'RS' ? differential(type) : twoOutputs(type);
    expected[kind].push(...(paired ? [key + '1', key + '2'] : [key]));
  }
  for (const kind of ['resistor', 'capacitor']) {
    assert.deepEqual(sortedNames(devices.filter(device => device.kind === kind)), expected[kind].sort(),
      `exact ${kind} names/counts correspond to model parameters, without discrete ro resistors`);
  }
  const biasNames = type === 'diff-cg' ? ['IB1', 'IB2'] : ['cg', 'follower'].includes(type) ? ['IB'] : [];
  assert.deepEqual(sortedNames(devices.filter(device => device.kind === 'current-source')), biasNames);
  assert.equal(devices.length, mosCount + expected.resistor.length + expected.capacitor.length + biasNames.length);
  return byName;
}

function checkLegend({ config, parameters }, devices) {
  const { type } = config;
  for (const { key } of parameters.filter(parameter => /^(?:gm|ro)/.test(parameter.key))) {
    const token = new RegExp('\\b' + key + '\\b');
    const matches = devices.filter(device => token.test(device.description));
    let expected;
    if (key === 'roL') {
      // roL denotes the collapsed load, not a transistor with an index "L".
      expected = type === 'diff-cg' ? ['M3', 'M4'] : [type === 'cascode' ? 'M3' : 'M2'];
      for (const device of matches) assert.match(device.description, /\bload\b/i);
    } else {
      const index = Number(key.match(/\d+$/)[0]);
      expected = differential(type) ? ['M' + index, 'M' + (index + 1)] : ['M' + index];
    }
    assert.deepEqual(sortedNames(matches), expected.sort(), `${key} maps to the correct legend device(s)`);
  }
  const parameterKeys = new Set(parameters.map(parameter => parameter.key));
  for (const device of devices) {
    for (const [key] of device.description.matchAll(/\b(?:gm\d+|ro\d+|roL)\b/g)) {
      assert.ok(parameterKeys.has(key), `${device.name}: ${key} exists in the model`);
    }
  }
}

function checkMetadata(config, byName) {
  const { type, polarity, sourceResistance } = config;
  const net = name => polarity === 'pmos' ? swapSupply(name) : name;
  const nodes = (name, expected) => {
    assert.ok(byName[name], `${name} exists`);
    assert.deepEqual(byName[name].nodes, Object.fromEntries(Object.entries(expected).map(([pin, value]) => [pin, net(value)])),
      `${name}: declared terminal-to-net mapping`);
  };
  const mos = (name, d, g, s, opposite = false) => {
    nodes(name, { d, g, s });
    assert.equal(byName[name].kind, opposite ? complementKind(polarity) : polarity, `${name}: MOS polarity`);
  };
  const source = i => sourceResistance ? `RS${i}_source` : 'tail';

  // These assertions establish metadata topology, not drawn-wire connectivity.
  if (type === 'diff-five') {
    mos('M1', 'x', 'vin+', source(1));
    mos('M2', 'out', 'vin-', source(2));
    mos('M3', 'x', 'x', 'VDD', true);
    mos('M4', 'out', 'x', 'VDD', true);
    mos('M5', 'tail', 'VB_T', 'VSS');
  } else if (type === 'diff-cascode' || type === 'folded-cascode') {
    for (let i = 1; i <= 2; i++) {
      const suffix = i === 1 ? '+' : '-';
      mos('M' + i, 'x' + i, 'vin' + suffix, source(i));
      if (type === 'diff-cascode') {
        mos('M' + (i + 2), 'out' + suffix, 'VB_C', 'x' + i);
        mos('M' + (i + 4), 'out' + suffix, 'VB_LC', 'load' + i, true);
        mos('M' + (i + 6), 'load' + i, 'VB_L', 'VDD', true);
      } else {
        mos('M' + (i + 2), 'x' + i, 'VB_B', 'VDD', true);
        mos('M' + (i + 4), 'out' + suffix, 'VB_F', 'x' + i, true);
        mos('M' + (i + 6), 'out' + suffix, 'VB_OC', 'sink' + i);
        mos('M' + (i + 8), 'sink' + i, 'VB_O', 'VSS');
      }
    }
    mos(type === 'diff-cascode' ? 'M9' : 'M11', 'tail', 'VB_T', 'VSS');
  }

  for (const device of Object.values(byName)) {
    if (/^RS/.test(device.name)) {
      const suffix = device.name.slice(2);
      const input = type === 'diff-cg' ? 'vin' + (suffix === '1' ? '+' : '-') : 'vin';
      nodes(device.name, commonGate(type)
        ? { p: input, n: 'source' + suffix }
        : { p: device.name + '_source', n: differential(type) ? 'tail' : 'VSS' });
      const inputMos = byName['M' + (suffix || '1')];
      assert.equal(inputMos.nodes.s, commonGate(type) ? device.nodes.n : device.nodes.p,
        `${device.name} is attached to the input source in metadata`);
    } else if (/^RL/.test(device.name)) {
      const out = type === 'diff-cg' ? 'out' + (device.name === 'RL1' ? '+' : '-') : 'out';
      nodes(device.name, type === 'follower' ? { p: 'out', n: 'VSS' } : { p: 'VDD', n: out });
    } else if (/^C[XL]/.test(device.name)) {
      const internal = device.name.startsWith('CX');
      const suffix = device.name.slice(2);
      const capNet = internal ? (commonGate(type) ? 'source' : 'x') + suffix
        : twoOutputs(type) ? 'out' + (suffix === '1' ? '+' : '-') : 'out';
      nodes(device.name, { p: capNet, n: 'AC ground' });
    } else if (device.name === 'CF' || device.name === 'CGS') {
      nodes(device.name, { p: 'vin', n: 'out' });
    }
  }
}

const rawCases = types.flatMap(type => ['nmos', 'pmos'].flatMap(polarity =>
  [false, true].flatMap(sourceResistance => ['resistor', 'active'].map(load =>
    ({ type, polarity, sourceResistance, load })))));

test('matrix contains all 64 distinct raw type/polarity/RS/load combinations', () => {
  assert.equal(rawCases.length, 64);
  assert.equal(new Set(rawCases.map(raw => JSON.stringify(raw))).size, 64);
});

for (const raw of rawCases) {
  test(`${raw.type} / ${raw.polarity} / RS=${raw.sourceResistance} / ${raw.load}: normalized screen and export`, () => {
    const description = describe(raw);
    const { config } = description;
    assert.deepEqual(config, {
      ...raw,
      sourceResistance: raw.type !== 'follower' && raw.sourceResistance,
      load: selectableLoads.has(raw.type) ? raw.load : 'resistor'
    });
    Object.freeze(config);
    const screen = render(config);
    const exported = render(config, true);
    assert.deepEqual(exported.devices, screen.devices, 'export preserves legend and metadata topology');
    assert.deepEqual([exported.width, exported.height], [screen.width, screen.height]);
    assert.notEqual(exported.svg, screen.svg, 'export has a distinct palette');

    for (const [result, forDownload] of [[screen, false], [exported, true]]) {
      checkSvg(result, forDownload);
      const byName = checkInventory(description, result.devices);
      checkLegend(description, result.devices);
      checkMetadata(config, byName);
      if (config.polarity === 'pmos') {
        const nmosConfig = describe({ ...raw, polarity: 'nmos' }).config;
        const nmos = render(nmosConfig, forDownload);
        assert.deepEqual([result.width, result.height], [nmos.width, nmos.height]);
        const complemented = nmos.devices.map(device => ({
          ...device,
          kind: complementKind(device.kind),
          nodes: Object.fromEntries(Object.entries(device.nodes).map(([pin, value]) => [pin, swapSupply(value)]))
        }));
        assert.deepEqual(result.devices, complemented,
          'PMOS flips every MOS kind and supply node, preserving all other declared connectivity and descriptions');
        assert.ok(nmos.devices.some(device => Object.values(device.nodes).includes('VDD')));
        assert.ok(nmos.devices.some(device => Object.values(device.nodes).includes('VSS')));
      }
    }
  });
}

test('ideal bias arrows carry conventional current downward for both polarities', () => {
  for (const type of ['cg', 'follower', 'diff-cg']) {
    for (const polarity of ['nmos', 'pmos']) {
      const { svg } = render(describe({ type, polarity }).config);
      const sources = [...svg.matchAll(/<g data-device="IB\d*" data-kind="current-source">([\s\S]*?)<\/g>/g)];
      assert.equal(sources.length, type === 'diff-cg' ? 2 : 1);
      for (const [, source] of sources) {
        const circle = source.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="20"/);
        assert.ok(circle);
        const x = Number(circle[1]);
        const y = Number(circle[2]);
        assert.ok(source.includes(`points="${x},${y - 10} ${x},${y + 10}"`));
        assert.ok(source.includes(`points="${x - 5},${y + 4} ${x},${y + 10} ${x + 5},${y + 4}"`));
      }
    }
  }
});

const pointsOf = element => element.match(/\bpoints="([^"]+)"/)[1].split(' ').map(point => point.split(',').map(Number));
const normalizeNet = net => net?.replace(/^vout(?=[+-]?$)/, 'out');
const segmentsOf = line => line.points.slice(1).map((end, i) => [line.points[i], end]);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const onSegment = ([x, y], [[ax, ay], [bx, by]]) =>
  (x - ax) * (by - ay) === (y - ay) * (bx - ax)
  && x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
  && y >= Math.min(ay, by) && y <= Math.max(ay, by);

function geometryOf({ svg, devices }) {
  const groups = new Map(devices.map(device => [device.name, { ...device, lines: [] }]));
  const stack = [], lines = [], wires = [];
  // Track group ownership, including nested wrappers, rather than counting MOS leads as wires.
  for (const [tag] of svg.matchAll(/<\/?g\b[^>]*>|<polyline\b[^>]*>/g)) {
    if (tag.startsWith('</g')) stack.pop();
    else if (tag.startsWith('<g')) {
      const name = tag.match(/\bdata-device="([^"]+)"/)?.[1];
      if (name) assert.ok(groups.has(name), `${name}: SVG device has metadata`);
      stack.push(name ? groups.get(name) : stack.at(-1));
    } else {
      const line = { points: pointsOf(tag), net: normalizeNet(tag.match(/\bdata-net="([^"]+)"/)?.[1]) };
      lines.push(line);
      if (stack.at(-1)) stack.at(-1).lines.push(line);
      else wires.push(line);
    }
  }
  return { groups: [...groups.values()], lines, wires };
}

function passiveTerminals(groups) {
  return groups.flatMap(({ kind, nodes, lines }) => {
    if (kind === 'resistor') {
      return [{ net: normalizeNet(nodes.p), point: lines[0].points[0] },
        { net: normalizeNet(nodes.n), point: lines[0].points.at(-1) }];
    }
    if (kind !== 'capacitor') return [];
    const leads = lines.filter(line => line.net !== undefined);
    // A shunt exposes only its first lead; plates and ground bars are not terminals.
    const ports = [{ net: normalizeNet(nodes.p), point: leads[0].points[0] }];
    if (nodes.n !== 'AC ground') {
      ports.push({ net: normalizeNet(nodes.n), point: leads[1].points.at(-1) });
    }
    return ports;
  });
}

function checkGeometryMatrix(check) {
  const failures = [];
  for (const raw of rawCases) {
    const config = describe(raw).config;
    for (const forDownload of [false, true]) {
      try {
        check(render(config, forDownload), config);
      } catch (error) {
        failures.push(`${raw.type}/${raw.polarity}/RS=${raw.sourceResistance}/${raw.load}`
          + `/${forDownload ? 'export' : 'screen'}: ${error.message}`);
      }
    }
  }
  assert.equal(failures.length, 0, failures.join('\n'));
}

function externalConductors(result, config) {
  const { groups, wires } = geometryOf(result);
  const electricalNet = name => {
    const net = normalizeNet(name);
    if (commonGate(config.type) && !config.sourceResistance) {
      if (config.type === 'cg' && net === 'vin') return 'source';
      if (config.type === 'diff-cg' && /^vin[+-]$/.test(net)) return net === 'vin+' ? 'source1' : 'source2';
    }
    return net;
  };
  const conductors = [];
  const add = (line, net, owner) => {
    assert.equal(typeof net, 'string', `${owner}: external conductor has a net`);
    conductors.push({ points: line.points, net: electricalNet(net), owner });
  };
  wires.forEach((line, i) => add(line, line.net, `wire ${i}`));
  for (const { name, kind, nodes, lines } of groups) {
    if (/^(nmos|pmos)$/.test(kind)) {
      // The D/S branches and gate lead are conductors, not the channel or gate plate.
      for (const i of [0, 1, 4]) add(lines[i], lines[i].net, `${name} lead ${i}`);
    } else if (kind === 'resistor') {
      // Only the straight terminal leads; the zigzag must not short p to n.
      add({ points: lines[0].points.slice(0, 2) }, nodes.p, `${name}.p`);
      add({ points: lines[0].points.slice(-2) }, nodes.n, `${name}.n`);
    } else if (kind === 'capacitor') {
      lines.filter(line => line.net !== undefined).forEach((line, i) => add(line, line.net, `${name} lead ${i}`));
      // Shunt ground leads are unlabeled in the SVG. Do not bridge the plate gap.
      if (nodes.n === 'AC ground') add(lines[3], nodes.n, `${name}.n`);
    } else if (kind === 'current-source') {
      // Exclude the enclosing circle and current arrow.
      for (const i of [0, 1]) add(lines[i], lines[i].net, `${name} lead ${i}`);
    } else assert.fail(`${name}: unhandled device kind ${kind}`);
  }
  return conductors;
}

function segmentContact([a, b], [c, d]) {
  const cross = ([x, y], [u, v]) => x * v - y * u;
  const subtract = (p, q) => [p[0] - q[0], p[1] - q[1]];
  const r = subtract(b, a), s = subtract(d, c), offset = subtract(c, a);
  const denominator = cross(r, s);
  if (denominator === 0) {
    if (cross(offset, r) !== 0) return [];
    const shared = [a, b, c, d].filter(point => onSegment(point, [a, b]) && onSegment(point, [c, d]))
      .filter((point, i, points) => points.findIndex(other => samePoint(point, other)) === i)
      .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    return shared.length > 1 ? [shared[0], shared.at(-1)] : shared;
  }
  const t = cross(offset, s) / denominator, u = cross(offset, r) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [[a[0] + t * r[0], a[1] + t * r[1]]] : [];
}

test('conductor contact distinguishes crossovers, endpoint touches, overlaps, and component gaps', () => {
  const cases = [
    [[[0, 0], [10, 0]], [[5, -5], [5, 5]], [[5, 0]]],
    [[[0, 0], [10, 0]], [[10, 0], [10, 5]], [[10, 0]]],
    [[[0, 0], [10, 0]], [[5, 0], [5, 5]], [[5, 0]]],
    [[[0, 0], [10, 0]], [[15, 0], [5, 0]], [[5, 0], [10, 0]]],
    [[[0, 0], [0, 10]], [[0, 8], [0, 2]], [[0, 2], [0, 8]]],
    [[[0, 0], [10, 10]], [[0, 10], [10, 0]], [[5, 5]]],
    [[[0, 0], [10, 10]], [[5, 5], [15, 15]], [[5, 5], [10, 10]]],
    [[[0, 0], [10, 0]], [[11, 0], [20, 0]], []],
    [[[0, 0], [10, 0]], [[0, 1], [10, 1]], []],
    [[[0, 0], [10, 0]], [[15, -5], [15, 5]], []]
  ];
  for (const [a, b, expected] of cases) {
    assert.deepEqual(segmentContact(a, b), expected);
    assert.deepEqual(segmentContact(b, a), expected, 'contact is independent of conductor order');
  }
});

test('all drawn polyline, polygon, and circle bounds fit the canvas across the full matrix', () => {
  checkGeometryMatrix(({ svg, width, height }) => {
    const outside = [];
    for (const [tag, kind] of svg.matchAll(/<(polyline|polygon|circle)\b[^>]*>/g)) {
      const number = name => Number(tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]);
      const stroke = /\bstroke="(?!none")/.test(tag)
        ? (tag.includes('stroke-width=') ? number('stroke-width') : 1) / 2 : 0;
      const points = kind === 'circle' ? [[number('cx'), number('cy')]] : pointsOf(tag);
      const radius = kind === 'circle' ? number('r') : 0;
      assert.ok(Number.isFinite(radius) && radius >= 0 && Number.isFinite(stroke) && stroke >= 0);
      assert.ok(points.length >= (kind === 'circle' ? 1 : kind === 'polygon' ? 3 : 2));
      for (const [x, y] of points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `${kind}: finite coordinates`);
        const extent = radius + stroke;
        if (x - extent < 0 || x + extent > width || y - extent < 0 || y + extent > height) {
          outside.push(`${kind} at (${x},${y}), extent ${extent}, outside ${width}x${height}`);
        }
      }
    }
    assert.equal(outside.length, 0, outside.join('; '));
  });
});

test('different electrical nets have no external conductor intersections or overlaps across the full matrix', () => {
  checkGeometryMatrix((result, config) => {
    const conductors = externalConductors(result, config);
    const contacts = new Set();
    for (let i = 0; i < conductors.length; i++) {
      const a = conductors[i];
      for (const b of conductors.slice(i + 1)) {
        // Repeated local VDD/VSS bars are the same named net, even if disconnected.
        if (a.net === b.net) continue;
        for (const first of segmentsOf(a)) {
          for (const second of segmentsOf(b)) {
            const contact = segmentContact(first, second);
            if (!contact.length) continue;
            // These layouts intend no crossovers: a missing junction dot is not an exemption.
            contacts.add(`${a.net} (${a.owner}) / ${b.net} (${b.owner}): `
              + `${contact.length === 1 ? 'intersection' : 'overlap'} at `
              + contact.map(point => `(${point.join(',')})`).join(' to '));
          }
        }
      }
    }
    assert.equal(contacts.size, 0, [...contacts].join('; '));
  });
});

test('compact canvases use at most 75% of their former area across the full matrix', () => {
  const oldSizes = {
    cs: [820, 680], cg: [820, 680], follower: [820, 680], cascode: [900, 800],
    'diff-five': [1120, 820], 'diff-cg': [1140, 780],
    'diff-cascode': [1240, 1080], 'folded-cascode': [1380, 1120]
  };
  checkGeometryMatrix(({ width, height }, { type }) => {
    const [oldWidth, oldHeight] = oldSizes[type];
    assert.ok(width * height <= oldWidth * oldHeight * 0.75,
      `${width}x${height} must use at most 75% of ${oldWidth}x${oldHeight}, without prescribing aspect ratio`);
  });
});

test('compact routing has no zero-length polyline segments across the full matrix', () => {
  checkGeometryMatrix(result => {
    for (const line of geometryOf(result).lines) {
      assert.ok(line.points.length >= 2, 'each polyline contains a segment');
      for (const [a, b] of segmentsOf(line)) {
        assert.ok(!samePoint(a, b), `${line.net || 'symbol'}: zero-length segment at ${a}`);
      }
    }
  });
});

test('every MOS D/S/G pin meets a matching external wire or passive terminal across the full matrix', () => {
  checkGeometryMatrix(result => {
    const { groups, wires } = geometryOf(result);
    const terminals = passiveTerminals(groups);
    const missing = [];
    for (const device of groups.filter(group => /^(nmos|pmos)$/.test(group.kind))) {
      for (const pin of ['d', 's', 'g']) {
        const net = normalizeNet(device.nodes[pin]);
        const lead = pin === 'g' ? device.lines[4]
          : device.lines.slice(0, 2).find(line => line.net === net);
        assert.ok(lead && lead.net === net, `${device.name}.${pin}: internally labeled external pin`);
        const point = lead.points[0];
        const connected = wires.some(wire => wire.net === net
          && segmentsOf(wire).some(segment => !samePoint(...segment) && onSegment(point, segment)))
          || terminals.some(terminal => terminal.net === net && samePoint(point, terminal.point));
        if (!connected) missing.push(`${device.name}.${pin} (${net}) at ${point}`);
      }
    }
    assert.equal(missing.length, 0, `unconnected MOS pins: ${missing.join('; ')}`);
  });
});

test('MOS symbols have continuous channels and source arrows with preserved pin geometry', () => {
  const orientations = new Set();
  for (const raw of rawCases) {
    for (const forDownload of [false, true]) {
      const { svg, devices } = render(describe(raw).config, forDownload);
      for (const [, name, kind, body] of svg.matchAll(/<g data-device="([^"]+)" data-kind="(nmos|pmos)">([\s\S]*?)<\/g>/g)) {
        const device = devices.find(item => item.name === name);
        const lines = [...body.matchAll(/<polyline\b[^>]*>/g)].map(match => match[0]);
        assert.equal(lines.length, 5, `${name}: two terminal branches, channel, gate, and gate lead`);
        assert.doesNotMatch(body, /<circle\b/, 'neither a gate bubble nor an enclosing circle');
        const terminals = lines.slice(0, 2).map(pointsOf);
        const [channel, gate, gateLead] = lines.slice(2).map(pointsOf);
        const x = terminals[0][0][0], y = (terminals[0][0][1] + terminals[1][0][1]) / 2;
        assert.equal(terminals[1][0][0], x);
        assert.equal(Math.abs(terminals[1][0][1] - terminals[0][0][1]), 96);
        assert.equal(Math.abs(gateLead[0][0] - x), 66);
        assert.equal(gateLead[0][1], y);
        assert.deepEqual(gateLead[1], [gate[0][0], y]);
        for (const branch of terminals) {
          assert.equal(branch.length, 3);
          assert.equal(branch[1][0], x);
          assert.equal(branch[1][1], branch[2][1]);
          assert.equal(branch[2][0], channel[0][0]);
          assert.equal(Math.abs(branch[1][1] - y), 20);
        }
        for (const [line, length] of [[channel, 56], [gate, 44]]) {
          assert.equal(line.length, 2);
          assert.equal(line[0][0], line[1][0]);
          assert.equal(Math.abs(line[1][1] - line[0][1]), length);
          assert.equal((line[0][1] + line[1][1]) / 2, y);
        }
        assert.equal(Math.abs(channel[0][0] - gate[0][0]), 8, 'gate is isolated from the channel');
        const sourceIndex = lines.slice(0, 2).findIndex(line => line.includes(`data-net="${escapeXml(device.nodes.s)}"`));
        assert.notEqual(sourceIndex, -1);
        const source = terminals[sourceIndex];
        const sourceY = source[1][1];
        assert.equal(Math.sign(sourceY - y), kind === 'pmos' ? -1 : 1);
        const arrows = [...body.matchAll(/<polygon\b[^>]*>/g)].map(match => match[0]);
        assert.equal(arrows.length, 1, `${name}: exactly one source arrow`);
        assert.ok(arrows[0].includes(`fill="${forDownload ? '#162033' : '#e2e8f0'}"`));
        const [tip, base1, base2] = pointsOf(arrows[0]);
        assert.equal(tip[1], sourceY);
        assert.equal(base1[0], base2[0]);
        assert.equal((base1[1] + base2[1]) / 2, sourceY);
        assert.equal(Math.abs(base2[1] - base1[1]), 14);
        const inward = Math.sign(channel[0][0] - x);
        assert.equal(Math.sign(tip[0] - base1[0]), kind === 'pmos' ? inward : -inward);
        for (const [arrowX] of [tip, base1, base2]) {
          assert.ok(arrowX > Math.min(x, channel[0][0]) && arrowX < Math.max(x, channel[0][0]));
        }
        orientations.add(`${kind}/${inward}`);
      }
    }
  }
  assert.deepEqual([...orientations].sort(), ['nmos/-1', 'nmos/1', 'pmos/-1', 'pmos/1']);
});

test('passives use compact zigzags and straight parallel capacitor plates', () => {
  for (const raw of rawCases) {
    for (const forDownload of [false, true]) {
      const { svg } = render(describe(raw).config, forDownload);
      for (const [, kind, body] of svg.matchAll(/<g data-device="[^"]+" data-kind="(resistor|capacitor)">([\s\S]*?)<\/g>/g)) {
        const lines = [...body.matchAll(/<polyline\b[^>]*>/g)].map(match => match[0]);
        if (kind === 'resistor') {
          assert.equal(lines.length, 1);
          const points = pointsOf(lines[0]);
          assert.equal(points.length, 10);
          const axis = points[0][0] === points.at(-1)[0] ? 1 : 0;
          const cross = 1 - axis;
          const center = points[0][cross];
          const corners = points.slice(2, -2);
          corners.forEach((point, i) => {
            assert.equal(Math.abs(point[cross] - center), 10);
            if (i) assert.equal(point[cross] - center, -(corners[i - 1][cross] - center));
          });
          assert.equal(Math.abs(points.at(-2)[axis] - points[1][axis]), 36);
        } else {
          const plates = lines.filter(line => !line.includes('data-net=')).map(pointsOf).slice(0, 2);
          const [a, b] = plates;
          assert.equal(a.length, 2);
          assert.equal(b.length, 2);
          assert.equal(Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]), 26);
          assert.deepEqual([a[1][0] - a[0][0], a[1][1] - a[0][1]], [b[1][0] - b[0][0], b[1][1] - b[0][1]]);
          assert.equal(Math.hypot(a[0][0] - b[0][0], a[0][1] - b[0][1]), 10);
        }
      }
    }
  }
});

test('identifier labels use accessible math subscripts and signal superscripts', () => {
  const expected = new Map(Object.entries({
    M1: ['M', '1'], M11: ['M', '11'], CL1: ['C', 'L1'], RS2: ['R', 'S2'],
    CF: ['C', 'F'], CGS: ['C', 'GS'], IB: ['I', 'B'], IB1: ['I', 'B1'],
    VDD: ['V', 'DD'], VSS: ['V', 'SS'], VB_C: ['V', 'B,C'],
    VB_LC: ['V', 'B,LC'], VB_OC: ['V', 'B,OC'], x: ['x', ''],
    vin: ['v', 'in'], 'vin+': ['v', 'in', '+'], 'vin-': ['v', 'in', '-'],
    vout: ['v', 'out'], 'vout+': ['v', 'out', '+'], 'vout-': ['v', 'out', '-']
  }));
  const seen = new Set();
  for (const raw of rawCases) {
    for (const forDownload of [false, true]) {
      const { svg, devices } = render(describe(raw).config, forDownload);
      const labels = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)];
      for (const device of devices) {
        assert.ok(labels.some(([, attributes]) => attributes.includes(`aria-label="${device.name}"`)),
          `${device.name}: full literal identifier remains accessible`);
      }
      for (const [, attributes, body] of labels) {
        const name = attributes.match(/\baria-label="([^"]+)"/)?.[1];
        if (!name) continue;
        assert.match(attributes, /\bfont-family="Cambria Math,STIX Two Math,Times New Roman,serif"/);
        if (!expected.has(name)) continue;
        const [base, subscript, superscript] = expected.get(name);
        assert.equal(body, escapeXml(base)
          + (subscript ? `<tspan baseline-shift="sub" font-size="75%">${escapeXml(subscript)}</tspan>` : '')
          + (superscript ? `<tspan baseline-shift="super" font-size="75%">${escapeXml(superscript)}</tspan>` : ''),
        `${name}: correct base, subscript, and optional polarity superscript`);
        seen.add(name);
      }
    }
  }
  assert.deepEqual([...seen].sort(), [...expected.keys()].sort(), 'every requested notation is exercised');
});

test('MOS groups show one vertically centered name without duplicate type or terminal labels', () => {
  for (const raw of rawCases) {
    for (const forDownload of [false, true]) {
      const { svg, devices } = render(describe(raw).config, forDownload);
      for (const [, name, kind, body] of svg.matchAll(/<g data-device="([^"]+)" data-kind="(nmos|pmos)">([\s\S]*?)<\/g>/g)) {
        const labels = [...body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)];
        assert.equal(labels.length, 1, `${name}: only the device name is visible`);
        const [, attributes, text] = labels[0];
        assert.ok(attributes.includes(`aria-label="${name}"`));
        assert.equal(text.replace(/<[^>]+>/g, ''), name);
        assert.match(attributes, /\bdominant-baseline="middle"/);
        const terminals = [...body.matchAll(/<polyline\b[^>]*>/g)].slice(0, 2).map(match => pointsOf(match[0]));
        const centerY = (terminals[0][0][1] + terminals[1][0][1]) / 2;
        assert.equal(Number(attributes.match(/\by="([^"]+)"/)[1]), centerY);
        const device = devices.find(item => item.name === name);
        assert.equal(device.kind, kind, 'type remains in legend metadata');
        assert.deepEqual(Object.keys(device.nodes).sort(), ['d', 'g', 's'], 'all terminal metadata remains');
      }
      assert.doesNotMatch(svg, /<text\b[^>]*>(?:NMOS|PMOS|D|S)<\/text>/);
    }
  }
});

test('capacitor AC grounds are explained once without removing ground symbols', () => {
  for (const raw of rawCases) {
    for (const forDownload of [false, true]) {
      const { svg, devices } = render(describe(raw).config, forDownload);
      assert.doesNotMatch(svg, /AC GND|D \/ S mark device terminals/);
      assert.match(svg, /<desc>[^<]*All capacitor ground symbols denote AC ground\./);
      assert.match(svg, /Source arrows indicate polarity\. Capacitor grounds: AC ground\.<\/text>/);
      for (const [, name, body] of svg.matchAll(/<g data-device="([^"]+)" data-kind="capacitor">([\s\S]*?)<\/g>/g)) {
        assert.equal([...body.matchAll(/<text\b/g)].length, 1, `${name}: only its identifier is labeled`);
        if (devices.find(device => device.name === name).nodes.n !== 'AC ground') continue;
        const lines = [...body.matchAll(/<polyline\b[^>]*>/g)].map(match => pointsOf(match[0]));
        assert.equal(lines.length, 7, `${name}: leads, plates, and all three ground bars remain`);
        const [x, end] = lines[3][1];
        [12, 8, 4].forEach((half, i) => {
          assert.deepEqual(lines[i + 4], [[x - half, end + i * 5], [x + half, end + i * 5]],
            `${name}: unchanged ground bar geometry`);
        });
      }
    }
  }
});

test('schematic prose and headers keep their inherited non-math font', () => {
  const seen = new Set();
  for (const raw of rawCases) {
    for (const forDownload of [false, true]) {
      const { svg } = render(describe(raw).config, forDownload);
      assert.match(svg, /^<svg\b[^>]*font-family="Consolas,Menlo,monospace"/);
      const labels = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)];
      assert.match(labels[0][2], /^(?:NMOS|PMOS) input · /);
      for (const [, attributes, body] of labels) {
        if (attributes.includes('aria-label=')) continue;
        assert.doesNotMatch(attributes, /font-family|baseline-shift/);
        assert.doesNotMatch(body, /<tspan\b/);
        seen.add(body);
      }
    }
  }
  assert.ok(seen.has('mirror'));
  assert.ok(seen.has('Source arrows indicate polarity. Capacitor grounds: AC ground.'));
  assert.ok(!seen.has('ideal bias'));
});

test('normalization rejects markup-bearing enum values before rendering', () => {
  const markup = '\"><script href="https://example.invalid/payload.js">&\'</script>';
  for (const field of ['type', 'polarity', 'load']) {
    assert.throws(() => describe({ ...rawCases[0], [field]: markup }), RangeError);
  }
});
