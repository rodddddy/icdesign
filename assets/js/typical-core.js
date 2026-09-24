/* Typical digital circuits: pure descriptions, netlists and logical waveforms. */
(function () {
  'use strict';

  function logic() {
    if (typeof self !== 'undefined' && self.ICLogic) return self.ICLogic;
    if (typeof require === 'function') return require('./logic-gen.js');
    throw new Error('Load logic-gen.js before generating a typical circuit.');
  }

  const catalog = [
    { id: 'sr-latch', label: 'SR latch', kind: 'sequential', clocked: false },
    { id: 'adder', label: 'Adder', kind: 'combinational', clocked: false },
    { id: 'decoder', label: 'Decoder', kind: 'combinational', clocked: false },
    { id: 'encoder', label: 'Priority encoder', kind: 'combinational', clocked: false },
    { id: 'counter', label: 'Synchronous counter', kind: 'sequential', clocked: true },
    { id: 'shift-register', label: 'Shift register', kind: 'sequential', clocked: true },
    { id: 'mux', label: 'Multiplexer', kind: 'combinational', clocked: false },
    { id: 'demux', label: 'Demultiplexer', kind: 'combinational', clocked: false },
    { id: 'code-converter', label: 'Code converter', kind: 'combinational', clocked: false }
  ];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const names = (prefix, count) => Array.from({ length: count }, (_, i) => prefix + (count - 1 - i));
  const bitsOf = (value, count) => Array.from({ length: count }, (_, i) => (value >> (count - 1 - i)) & 1);
  const word = values => values.reduce((n, v) => n * 2 + v, 0);
  const select = (key, label, value, choices, hint) => Object.assign({
    key, label, type: 'select', default: value,
    options: choices.map(c => ({ value: c[0], label: c[1] }))
  }, hint ? { hint } : {});
  const number = (key, label, value, min, max, hint) => Object.assign({
    key, label, type: 'number', default: value, min, max
  }, hint ? { hint } : {});
  const safeInteger = (value, min, max, fallback) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  const edgeField = () => select('edge', 'Active clock edge', 'rising', [['rising', 'Rising'], ['falling', 'Falling']]);
  const resetField = () => select('reset', 'Reset', 'sync', [['sync', 'Synchronous active-high'], ['none', 'None']]);

  function family(type) {
    const result = catalog.find(item => item.id === type);
    if (!result) throw new Error('Unknown circuit type: ' + String(type));
    return result;
  }

  function getFields(type = 'decoder', values = {}) {
    family(type);
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Field values must be an object.');
    switch (type) {
      case 'adder': return [select('mode', 'Adder type', 'half', [['half', 'Half adder'], ['full', 'Full adder']])];
      case 'decoder': return [
        select('mode', 'Decoder mode', 'onehot', [
          ['onehot', 'Binary to one-hot'], ['thermometer', 'Binary to thermometer code']
        ]),
        number('bits', 'Address bits', 2, 1, 4),
        { key: 'enable', label: 'Enable input (EN)', type: 'checkbox', default: false },
        select('polarity', 'Output polarity', 'high', [['high', 'Active-high'], ['low', 'Active-low']])
      ];
      case 'encoder': return [
        select('inputs', 'Input count', '4', [['2', '2'], ['4', '4'], ['8', '8']]),
        select('priority', 'Priority', 'highest', [['highest', 'Highest index first'], ['lowest', 'Lowest index first']])
      ];
      case 'mux': return [select('inputs', 'Data inputs', '4', [['2', '2:1'], ['4', '4:1']])];
      case 'demux': return [select('outputs', 'Output count', '4', [['2', '1-to-2'], ['4', '1-to-4'], ['8', '1-to-8']])];
      case 'code-converter': {
        const fields = [select('conversion', 'Conversion', 'binary-gray', [
          ['binary-gray', 'Binary to Gray'], ['gray-binary', 'Gray to binary'],
          ['bcd-excess3', 'BCD to excess-3'], ['excess3-bcd', 'Excess-3 to BCD']
        ])];
        if (values.conversion !== 'bcd-excess3' && values.conversion !== 'excess3-bcd') {
          fields.push(number('bits', 'Word bits', 4, 2, 8));
        }
        return fields;
      }
      case 'counter': {
        const bits = safeInteger(values.bits, 2, 6, 3);
        const modulus = safeInteger(values.modulus, 2, 2 ** bits, 2 ** bits);
        return [
          number('bits', 'State bits', 3, 2, 6, 'Limited to 2-6 bits to bound complete next-state truth-table synthesis.'),
          select('direction', 'Count direction', 'up', [['up', 'Up'], ['down', 'Down']]),
          number('modulus', 'Modulus', 2 ** bits, 2, 2 ** bits), edgeField(), resetField(),
          number('initial', 'Initial waveform state', 0, 0, modulus - 1, 'Simulation only; this does not initialize physical flip-flops.')
        ];
      }
      case 'shift-register': {
        const bits = safeInteger(values.bits, 2, 8, 4);
        return [
          number('bits', 'Register bits', 4, 2, 8),
          select('direction', 'Shift direction', 'left', [['left', 'Left (toward MSB)'], ['right', 'Right (toward LSB)']]),
          select('mode', 'Input mode', 'serial', [['serial', 'Serial shift'], ['parallel', 'Parallel load and serial shift']]),
          edgeField(), resetField(),
          number('initial', 'Initial waveform state', 0, 0, 2 ** bits - 1, 'Simulation only; this does not initialize physical flip-flops.')
        ];
      }
      case 'sr-latch': return [select('topology', 'Latch gates', 'nor', [['nor', 'NOR (active-high S, R)'], ['nand', 'NAND (active-low S_N, R_N)']])];
    }
  }

  function describe(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Circuit configuration must be an object.');
    const type = raw.type === undefined ? 'decoder' : raw.type;
    const item = family(type);
    const config = { type };
    for (const field of getFields(type, raw)) {
      const value = raw[field.key] === undefined ? field.default : raw[field.key];
      if (field.type === 'number' && (!Number.isInteger(value) || value < field.min || value > field.max)) {
        throw new Error(field.label + ' must be an integer from ' + field.min + ' to ' + field.max + '.');
      }
      if (field.type === 'select' && !field.options.some(option => option.value === value)) {
        throw new Error(field.label + ' must be one of: ' + field.options.map(option => option.value).join(', ') + '.');
      }
      if (field.type === 'checkbox' && typeof value !== 'boolean') throw new Error(field.label + ' must be true or false.');
      config[field.key] = value;
    }
    const c = config;
    let title = item.label, externalInputs = [], outNames = [];
    const notes = ['Multi-bit signals are listed most-significant bit first; index 0 is the least-significant bit (LSB).'];
    switch (type) {
      case 'adder':
        title = c.mode === 'half' ? 'Half adder' : 'Full adder';
        externalInputs = ['A', 'B'].concat(c.mode === 'full' ? ['CIN'] : []);
        outNames = ['SUM', 'COUT'];
        notes.push('Adds two one-bit inputs A and B' + (c.mode === 'full' ? ' plus carry-in CIN' : '') + '. SUM is the sum bit; COUT is the carry-out. 2 × COUT + SUM = A + B' + (c.mode === 'full' ? ' + CIN.' : '.'));
        break;
      case 'decoder': {
        const thermometer = c.mode === 'thermometer';
        title = c.bits + '-to-' + (2 ** c.bits - (thermometer ? 1 : 0)) + (thermometer ? ' thermometer decoder' : ' decoder');
        externalInputs = names('A', c.bits).concat(c.enable ? ['EN'] : []);
        outNames = names('Y', 2 ** c.bits - (thermometer ? 1 : 0));
        if (thermometer) {
          notes.push('Thermometer code has 2^N - 1 output bits: Yk is active when A > k, so A = 0 activates none and A = k activates the lowest k bits, starting at Y0. Active outputs are ' + (c.polarity === 'high' ? '1; all others are 0.' : '0; all others are 1.'));
        } else {
          notes.push('Yk is selected when A = k. Selected outputs are ' + (c.polarity === 'high' ? '1; all other outputs are 0.' : '0; all other outputs are 1.'));
        }
        if (c.enable) notes.push('EN = 0 disables every output to its inactive level; EN = 1 enables decoding.');
        break;
      }
      case 'encoder': {
        const count = Number(c.inputs);
        title = count + '-input priority encoder';
        externalInputs = names('I', count);
        outNames = names('Y', Math.log2(count)).concat('VALID');
        notes.push('Active-high inputs: the ' + c.priority + ' asserted index wins. Y encodes that index; VALID = 1. With no asserted input, Y = 0 and VALID = 0.');
        break;
      }
      case 'mux': {
        const count = Number(c.inputs);
        title = count + ':1 multiplexer';
        externalInputs = names('D', count).concat(names('S', Math.log2(count)));
        outNames = ['Y'];
        notes.push('One-bit data: Y = Dk when the binary selector S = k.');
        break;
      }
      case 'demux': {
        const count = Number(c.outputs);
        title = '1-to-' + count + ' demultiplexer';
        externalInputs = ['D'].concat(names('S', Math.log2(count)));
        outNames = names('Y', count);
        notes.push('Yk = D when selector S = k; every unselected output is 0.');
        break;
      }
      case 'code-converter': {
        const fixed = c.conversion === 'bcd-excess3' || c.conversion === 'excess3-bcd';
        if (fixed) {
          if (raw.bits !== undefined && raw.bits !== 4) throw new Error('BCD and excess-3 conversions require exactly 4 bits.');
          c.bits = 4;
        }
        const prefixes = { 'binary-gray': ['B', 'G'], 'gray-binary': ['G', 'B'], 'bcd-excess3': ['B', 'E'], 'excess3-bcd': ['E', 'B'] }[c.conversion];
        title = getFields(type)[0].options.find(option => option.value === c.conversion).label;
        externalInputs = names(prefixes[0], c.bits);
        outNames = names(prefixes[1], c.bits).concat(fixed ? ['VALID'] : []);
        if (c.conversion === 'binary-gray') notes.push('The MSB is unchanged; each lower Gray bit is the XOR of adjacent binary bits. Every input code is valid.');
        if (c.conversion === 'gray-binary') notes.push('The MSB is unchanged; each binary bit is the cumulative XOR from the Gray MSB down to that bit. Every input code is valid.');
        if (fixed) notes.push('Fixed 4-bit words: bit 3 is the MSB. ' + (c.conversion === 'bcd-excess3' ? 'BCD inputs 0000-1001 (0-9) map to input + 3.' : 'Excess-3 inputs 0011-1100 (3-12) map to input - 3.') + ' Valid codes give VALID = 1; invalid input codes give 0000 and VALID = 0.');
        break;
      }
      case 'counter':
        title = c.bits + '-bit modulo-' + c.modulus + ' ' + c.direction + ' counter';
        externalInputs = ['CLK'].concat(c.reset === 'sync' ? ['RST'] : []);
        outNames = names('Q', c.bits);
        notes.push('All DFFs update simultaneously on the ' + c.edge + ' CLK edge. Counting wraps modulo ' + c.modulus + '; unused states Q >= modulus recover to 0 on the next active edge.');
        break;
      case 'shift-register':
        title = c.bits + '-bit ' + c.direction + ' shift register';
        externalInputs = ['CLK'].concat(c.reset === 'sync' ? ['RST'] : [], ['SI'], c.mode === 'parallel' ? ['LOAD'].concat(names('P', c.bits)) : []);
        outNames = names('Q', c.bits).concat('SO');
        notes.push('On each ' + c.edge + ' CLK edge, bits shift ' + c.direction + '; SI enters Q' + (c.direction === 'left' ? '0' : c.bits - 1) + '. SO is the current outgoing Q' + (c.direction === 'left' ? c.bits - 1 : '0') + ', the bit discarded at the next shift edge. After an edge SO follows the new end bit.');
        if (c.mode === 'parallel') notes.push('Priority at the active edge: ' + (c.reset === 'sync' ? 'RST clears first, then ' : '') + 'LOAD = 1 loads Q from P; otherwise shift SI. LOAD is active-high.');
        else notes.push('Every active edge shifts SI' + (c.reset === 'sync' ? ' unless RST = 1 clears the register first.' : '.'));
        break;
      case 'sr-latch':
        title = c.topology.toUpperCase() + ' SR latch';
        externalInputs = c.topology === 'nor' ? ['S', 'R'] : ['S_N', 'R_N'];
        outNames = ['Q', 'Q_BAR'];
        notes.push('Two actual cross-coupled ' + c.topology.toUpperCase() + ' gates; no clock and no DFF. Q and Q_BAR input aliases denote feedback, not external inputs.');
        notes.push(c.topology === 'nor' ? 'S = 1 sets Q; R = 1 resets Q; S = R = 0 holds. S = R = 1 is forbidden and forces both outputs to 0.' : 'S_N = 0 sets Q; R_N = 0 resets Q; S_N = R_N = 1 holds. S_N = R_N = 0 is forbidden and forces both outputs to 1.');
        notes.push('Release of the forbidden condition directly into hold leaves both outputs X (indeterminate) until a valid set or reset resolves the state.');
        break;
    }
    if (item.clocked) {
      notes.push(c.reset === 'sync' ? 'RST connects directly to each DFF synchronous active-high reset pin. RST = 1 clears Q only at the selected clock edge, with priority over D.' : 'Every DFF RST pin is tied to GND; there is no external reset or hardware initialization.');
      notes.push('Each DFF provides Q and Q′ (the complement of Q). Q / Q′ labels are connected feedback aliases, not additional external inputs; Q′ is used directly when it simplifies the logic.');
      notes.push('Initial state ' + c.initial + ' is a waveform-only assumption, not a power-up preset.');
      notes.push('Waveforms are ideal logical samples without physical propagation delay; controls change away from active clock edges.');
    }
    return { config, title, kind: item.kind, needsDff: item.clocked, externalInputs, outNames, notes };
  }

  // State values terminate feedback traversal instead of recursing through a cycle.
  function evaluate(builder, id, inputValues = {}) {
    const memo = new Map();
    const lookup = node => {
      let v;
      if (inputValues instanceof Map) v = inputValues.has(node.id) ? inputValues.get(node.id) : inputValues.get(node.label);
      else v = own(inputValues, node.id) ? inputValues[node.id] : inputValues[node.label];
      if (v === undefined || v === 'X') return 'X';
      if (v === 0 || v === '0' || v === false) return 0;
      if (v === 1 || v === '1' || v === true) return 1;
      throw new Error('Invalid logical value for ' + (node.label || node.id) + '.');
    };
    const inv = v => v === 'X' ? 'X' : 1 - v;
    const visit = nodeId => {
      if (memo.has(nodeId)) return memo.get(nodeId);
      const node = builder.nodes[nodeId];
      if (!node) throw new Error('Unknown netlist node: ' + nodeId);
      let result;
      if (node.type === 'IN' && node.invertedFrom !== undefined) result = inv(visit(node.invertedFrom));
      else if (node.type === 'IN' || node.type === 'DFF') result = lookup(node);
      else if (node.type === 'CONST0' || node.type === 'CONST1') result = node.type === 'CONST0' ? 0 : 1;
      else {
        const ins = node.ins.map(visit);
        switch (node.type) {
          case 'BUF': result = ins[0]; break;
          case 'INV': result = inv(ins[0]); break;
          case 'AND': case 'NAND':
            result = ins.includes(0) ? 0 : ins.includes('X') ? 'X' : 1;
            if (node.type === 'NAND') result = inv(result);
            break;
          case 'OR': case 'NOR':
            result = ins.includes(1) ? 1 : ins.includes('X') ? 'X' : 0;
            if (node.type === 'NOR') result = inv(result);
            break;
          case 'XOR': case 'XNOR':
            result = ins.includes('X') ? 'X' : ins.reduce((a, b) => a ^ b, 0);
            if (node.type === 'XNOR') result = inv(result);
            break;
          case 'MUX': {
            // ICLogic MUX pins: [S,D1,D0] or [S1,S0,D3,D2,D1,D0].
            const count = ins.length === 3 ? 1 : ins.length === 6 ? 2 : 0;
            if (!count) throw new Error('Unsupported MUX pin count.');
            const candidates = [];
            for (let index = 0; index < 2 ** count; index++) {
              if (bitsOf(index, count).every((bit, k) => ins[k] === 'X' || bit === ins[k])) candidates.push(ins[count + (2 ** count - 1 - index)]);
            }
            result = candidates.every(v => v === candidates[0]) ? candidates[0] : 'X';
            break;
          }
          default: throw new Error('Unsupported node type: ' + node.type);
        }
      }
      memo.set(nodeId, result);
      return result;
    };
    return visit(id);
  }

  function table(namesIn, compute) {
    return Array.from({ length: 2 ** namesIn.length }, (_, row) => {
      const values = bitsOf(row, namesIn.length);
      return compute(Object.fromEntries(namesIn.map((name, i) => [name, values[i]]))).map(String);
    });
  }

  function combination(c, input) {
    const read = (prefix, count) => word(names(prefix, count).map(name => input[name]));
    switch (c.type) {
      case 'adder': {
        const total = input.A + input.B + (c.mode === 'full' ? input.CIN : 0);
        return [total & 1, total >> 1];
      }
      case 'decoder': {
        const address = read('A', c.bits);
        const thermometer = c.mode === 'thermometer';
        return names('Y', 2 ** c.bits - (thermometer ? 1 : 0)).map(name => {
          const active = (!c.enable || input.EN === 1) && (thermometer ? address > Number(name.slice(1)) : Number(name.slice(1)) === address);
          return c.polarity === 'high' ? Number(active) : Number(!active);
        });
      }
      case 'encoder': {
        const asserted = Array.from({ length: Number(c.inputs) }, (_, i) => i).filter(i => input['I' + i]);
        const index = asserted.length ? asserted[c.priority === 'highest' ? asserted.length - 1 : 0] : 0;
        return bitsOf(index, Math.log2(Number(c.inputs))).concat(Number(asserted.length > 0));
      }
      case 'mux': return [input['D' + read('S', Math.log2(Number(c.inputs)))]];
      case 'demux': {
        const address = read('S', Math.log2(Number(c.outputs)));
        return names('Y', Number(c.outputs)).map(name => Number(name.slice(1)) === address ? input.D : 0);
      }
      case 'code-converter': {
        const prefix = c.conversion === 'gray-binary' ? 'G' : c.conversion === 'excess3-bcd' ? 'E' : 'B';
        const value = read(prefix, c.bits);
        if (c.conversion === 'binary-gray') return bitsOf(value ^ (value >> 1), c.bits);
        if (c.conversion === 'gray-binary') {
          let binary = 0;
          for (let g = value; g; g >>= 1) binary ^= g;
          return bitsOf(binary, c.bits);
        }
        const valid = c.conversion === 'bcd-excess3' ? value <= 9 : value >= 3 && value <= 12;
        return bitsOf(valid ? value + (c.conversion === 'bcd-excess3' ? 3 : -3) : 0, 4).concat(Number(valid));
      }
    }
    throw new Error('Not a combinational family.');
  }

  function synthesize(core, builder, inNames, vals, output, lib, gateInputs) {
    const on = [];
    vals.forEach((row, i) => { if (row[output] === '1') on.push(i); });
    const inIds = inNames.map(name => builder.input(name));
    try {
      return { res: core.synthesize(on, inNames.length, inIds, lib, builder, inNames, gateInputs), onCount: on.length };
    } catch (error) {
      // Wires and built-in complementary outputs need no selected logic gates.
      for (let bit = 0; bit < inNames.length; bit++) {
        for (const polarity of [1, 0]) {
          const id = polarity ? inIds[bit] : builder.nodes[inIds[bit]].complement;
          if (id === undefined || !vals.every((row, i) => Number(row[output]) === (((i >> (inNames.length - 1 - bit)) & 1) ^ (1 - polarity)))) continue;
          const t = Array(inNames.length).fill(-1); t[bit] = polarity;
          return { res: { id, path: 'wire', display: { cubes: [{ t, cov: new Set(on) }], xorTerms: null } }, onCount: on.length };
        }
      }
      throw error;
    }
  }

  function verifyNet(builder, roots, lib, gateInputs) {
    const visited = new Set();
    const visit = id => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = builder.nodes[id];
      node.ins.forEach(visit);
      if (['IN', 'CONST0', 'CONST1', 'DFF'].includes(node.type)) return;
      if (!lib.has(node.type)) throw new Error('Generated net requires unselected gate ' + node.type + '.');
      if (['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR'].includes(node.type)) {
        if (!(gateInputs[node.type] || [2, 3, 4]).includes(node.ins.length)) throw new Error('Generated ' + node.type + ' does not match selected input counts.');
      }
    };
    roots.forEach(root => visit(root.id));
  }

  function clockWaveform(result, stateIds) {
    const c = result.config, b = result.builder;
    const stateNames = names('Q', c.bits);
    let state = bitsOf(c.initial, c.bits);
    const channels = result.externalInputs.concat(result.outNames).map(name => ({ name, values: [] }));
    const sampleLabels = [], activeEdges = [];
    const cycles = c.type === 'counter' ? Math.min(20, Math.max(8, c.modulus + 2)) : Math.min(16, c.bits + 5);
    const pattern = [1, 0, 1, 1, 0, 0, 1, 0];
    for (let cycle = 0; cycle < cycles; cycle++) {
      const controls = {};
      if (c.reset === 'sync') controls.RST = Number(cycle === 0);
      if (c.type === 'shift-register') {
        controls.SI = pattern[cycle % pattern.length];
        if (c.mode === 'parallel') {
          controls.LOAD = Number(cycle === 2 || cycle === 6);
          names('P', c.bits).forEach((name, i) => { controls[name] = (i + Math.floor(cycle / 4)) % 2; });
        }
      }
      for (let phase = 0; phase < 4; phase++) {
        const input = Object.assign({}, controls, { CLK: phase === 1 || phase === 2 ? 1 : 0 });
        stateNames.forEach((name, i) => { input[name] = state[i]; input[stateIds[i]] = state[i]; });
        if (phase === (c.edge === 'rising' ? 1 : 3)) {
          // Evaluate all DFFs against the same pre-edge state, then commit together.
          state = stateIds.map(id => {
            const [data, , reset] = b.nodes[id].ins;
            return evaluate(b, reset, input) === 1 ? 0 : evaluate(b, data, input);
          });
          stateNames.forEach((name, i) => { input[name] = state[i]; input[stateIds[i]] = state[i]; });
          activeEdges.push(sampleLabels.length);
        }
        const outputs = Object.fromEntries(result.roots.map(root => [root.label, evaluate(b, root.id, input)]));
        sampleLabels.push(cycle + '.' + phase);
        channels.forEach(channel => channel.values.push(own(outputs, channel.name) ? outputs[channel.name] : input[channel.name]));
      }
    }
    return {
      sampleLabels, channels, activeEdges,
      caption: 'Ideal logical samples (4 per cycle), no physical propagation delay. CLK starts low; rising edges are phase 1, falling edges phase 3. Controls change at phase 0. Initial Q = ' + c.initial + ' is a waveform-only assumption, not hardware initialization. ' + (c.reset === 'sync' ? 'RST is asserted for the entire first cycle and clears Q only at its active edge.' : 'No reset is present; the assumed initial state is not guaranteed at power-up.')
    };
  }

  function latchWaveform(result) {
    const nand = result.config.topology === 'nand';
    const phases = ['hold', 'set', 'hold', 'reset', 'hold', 'forbidden', 'hold', 'hold', 'set', 'hold', 'reset', 'hold'];
    const channels = result.externalInputs.concat(result.outNames).map(name => ({ name, values: [] }));
    const sampleLabels = [];
    let state = ['X', 'X'];
    for (const phase of phases) {
      const set = phase === 'set' || phase === 'forbidden';
      const reset = phase === 'reset' || phase === 'forbidden';
      const input = nand ? { S_N: Number(!set), R_N: Number(!reset) } : { S: Number(set), R: Number(reset) };
      let settled = false;
      for (let iteration = 0; iteration < 8; iteration++) {
        const values = Object.assign({}, input, { Q: state[0], Q_BAR: state[1] });
        const next = result.roots.map(root => evaluate(result.builder, root.id, values));
        if (next.every((value, i) => value === state[i])) { settled = true; break; }
        state = next;
      }
      // Symmetric forbidden-to-hold release has no defined stable choice.
      if (!settled) state = ['X', 'X'];
      for (let repeat = 0; repeat < 2; repeat++) {
        sampleLabels.push(phase + '.' + repeat);
        const values = Object.assign({}, input, { Q: state[0], Q_BAR: state[1] });
        channels.forEach(channel => channel.values.push(values[channel.name]));
      }
    }
    return { sampleLabels, channels, caption: 'Unclocked ideal logical settling, not propagation timing. Initial state is unknown (X). Both asserted controls force the forbidden equal-output state; release into hold is indeterminate (X) until a valid set/reset resolves it.' };
  }

  function generate(raw, lib, gateInputs = {}, dffSelected = false) {
    const result = describe(raw);
    if (!(lib instanceof Set)) throw new Error('The selected gate library must be a Set.');
    if (!gateInputs || typeof gateInputs !== 'object' || Array.isArray(gateInputs)) throw new Error('Gate input specifications must be an object.');
    const selected = new Set(lib);
    selected.delete('DFF');
    const specs = {};
    selected.forEach(type => {
      if (!['INV', 'BUF', 'AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR', 'MUX'].includes(type)) throw new Error('Unknown gate type: ' + String(type));
      if (own(gateInputs, type) && !['INV', 'BUF', 'MUX'].includes(type)) {
        const allowed = gateInputs[type];
        if (!Array.isArray(allowed) || allowed.some(count => ![2, 3, 4].includes(count))) throw new Error(type + ' input counts must be selected from 2, 3 and 4.');
        specs[type] = [...new Set(allowed)].sort((a, b) => a - b);
      }
    });
    if (result.needsDff && dffSelected !== true) throw new Error('Select DFF to generate a counter or shift register.');
    const core = logic(), builder = core.makeBuilder(), c = result.config;
    if (result.needsDff && typeof builder.dff !== 'function') throw new Error('This circuit requires the DFF-capable version of logic-gen.js.');
    Object.assign(result, { builder, roots: [], inNames: result.externalInputs.slice(), vals: null, exprRows: [], feedback: {}, waveform: null });
    result.externalInputs.forEach(name => builder.input(name));

    if (result.kind === 'combinational') {
      result.vals = table(result.inNames, input => combination(c, input));
      result.outNames.forEach((name, output) => {
        const row = synthesize(core, builder, result.inNames, result.vals, output, selected, specs);
        result.exprRows.push(Object.assign({ name }, row));
        result.roots.push({ id: row.res.id, label: name });
      });
    } else if (c.type === 'sr-latch') {
      const type = c.topology.toUpperCase();
      if (!selected.has(type)) throw new Error('The ' + type + ' SR latch requires selected ' + type + ' gates; choose that gate type or change latch topology.');
      const allowed = specs[type] || [2, 3, 4];
      if (!allowed.length) throw new Error('Select at least one input count for ' + type + '.');
      const q = builder.input('Q'), qb = builder.input('Q_BAR');
      result.inNames.push('Q', 'Q_BAR');
      const gate = pins => {
        while (pins.length < allowed[0]) pins.push(type === 'NOR' ? builder.const0() : builder.const1());
        return builder.gate(type, pins);
      };
      const qRoot = gate([builder.input(type === 'NOR' ? 'R' : 'S_N'), qb]);
      const qbRoot = gate([builder.input(type === 'NOR' ? 'S' : 'R_N'), q]);
      result.roots = [{ id: qRoot, label: 'Q' }, { id: qbRoot, label: 'Q_BAR' }];
      result.feedback[q] = qRoot; result.feedback[qb] = qbRoot;
      result.waveform = latchWaveform(result);
    } else {
      const stateNames = names('Q', c.bits);
      const aliases = stateNames.map(name => builder.input(name));
      const invertedAliases = stateNames.map((name, i) => {
        const id = builder.input(name + '′');
        builder.nodes[aliases[i]].complement = id;
        builder.nodes[id].complement = aliases[i];
        return id;
      });
      result.inNames.push(...stateNames, ...stateNames.map(name => name + '′'));
      const dataIds = [];
      if (c.type === 'counter') {
        const localNames = stateNames;
        const vals = table(localNames, input => {
          const current = word(stateNames.map(name => input[name]));
          const next = current >= c.modulus ? 0 : (current + (c.direction === 'up' ? 1 : c.modulus - 1)) % c.modulus;
          return bitsOf(next, c.bits);
        });
        stateNames.forEach((name, i) => dataIds.push(synthesize(core, builder, localNames, vals, i, selected, specs).res.id));
      } else {
        stateNames.forEach(name => {
          const bit = Number(name.slice(1));
          const source = c.direction === 'left' ? (bit === 0 ? 'SI' : 'Q' + (bit - 1)) : (bit === c.bits - 1 ? 'SI' : 'Q' + (bit + 1));
          const parallel = 'P' + bit;
          const localNames = [source].concat(c.mode === 'parallel' ? ['LOAD', parallel] : []);
          const vals = table(localNames, input => [c.mode === 'parallel' && input.LOAD === 1 ? input[parallel] : input[source]]);
          dataIds.push(synthesize(core, builder, localNames, vals, 0, selected, specs).res.id);
        });
      }
      const clockId = builder.input('CLK');
      const resetId = c.reset === 'sync' ? builder.input('RST') : builder.const0();
      const stateIds = dataIds.map((id, i) => {
        const root = builder.dff(id, clockId, resetId, c.edge);
        builder.nodes[root].label = stateNames[i];
        builder.nodes[root].complement = invertedAliases[i];
        builder.nodes[invertedAliases[i]].invertedFrom = root;
        result.feedback[aliases[i]] = root;
        result.feedback[invertedAliases[i]] = root + ':Q_BAR';
        result.roots.push({ id: root, label: stateNames[i] });
        return root;
      });
      if (c.type === 'shift-register') result.roots.push({ id: stateIds[c.direction === 'left' ? 0 : c.bits - 1], label: 'SO' });
      result.waveform = clockWaveform(result, stateIds);
    }
    verifyNet(builder, result.roots, selected, specs);
    return result;
  }

  const api = { catalog, getFields, describe, generate, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.ICTypical = api;
})();
