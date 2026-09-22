/* ============================================================
   ICDesign Lab — Combinational Logic Generator
   Truth table -> minimized expression + gate-level netlist (SVG)
   Synthesis: Quine-McCluskey exact SOP, technology mapping to
   the selected gate library with graceful fallback paths.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------- *
   *  Pure logic core (no DOM) — testable under Node             *
   * ---------------------------------------------------------- */

  function bitsOf(i, n) {
    const a = new Array(n);
    for (let k = 0; k < n; k++) a[k] = (i >> (n - 1 - k)) & 1;
    return a;
  }

  /* Quine-McCluskey: returns all prime implicants.
     Each cube: { t:Array(-1|0|1), cov:Set(minterm indices) } */
  function minimizeSOP(on, n) {
    const onSet = new Set(on);
    if (onSet.size === 0) return [];
    const keyOf = t => t.join('');
    const mkCov = t => {
      const s = new Set();
      for (const i of onSet) {
        let ok = true;
        for (let k = 0; k < n; k++) {
          if (t[k] !== -1 && t[k] !== ((i >> (n - 1 - k)) & 1)) { ok = false; break; }
        }
        if (ok) s.add(i);
      }
      return s;
    };
    const seen = new Set();
    let cubes = [];
    for (const i of onSet) {
      const t = bitsOf(i, n), key = keyOf(t);
      if (seen.has(key)) continue;
      seen.add(key);
      cubes.push({ t, cov: mkCov(t) });
    }
    for (;;) {
      const merged = new Array(cubes.length).fill(false);
      const next = [], nseen = new Set();
      for (let a = 0; a < cubes.length; a++) {
        for (let b = a + 1; b < cubes.length; b++) {
          const A = cubes[a].t, B = cubes[b].t;
          let diff = -1, ok = true;
          for (let k = 0; k < n; k++) {
            if (A[k] !== B[k]) {
              if (diff !== -1 || A[k] === -1 || B[k] === -1) { ok = false; break; }
              diff = k;
            }
          }
          if (!ok || diff === -1) continue;
          merged[a] = merged[b] = true;
          const t = A.slice(); t[diff] = -1;
          const key = keyOf(t);
          if (nseen.has(key)) continue;
          nseen.add(key);
          next.push({ t, cov: new Set([...cubes[a].cov, ...cubes[b].cov]) });
        }
      }
      const survivors = cubes.filter((c, i) => !merged[i]);
      if (next.length === 0) return survivors; // survivors are the primes
      cubes = survivors.concat(next);
    }
  }

  /* Cover minterms with primes: essentials first, then an exact minimum
     branch-and-bound cover of the remainder (greedy fallback on big cases). */
  function coverSOP(primes, on) {
    const chosen = [];
    for (const m of on) {
      const ps = primes.filter(p => p.cov.has(m));
      if (ps.length === 1 && !chosen.includes(ps[0])) chosen.push(ps[0]);
    }
    const need0 = new Set(on);
    chosen.forEach(p => p.cov.forEach(m => need0.delete(m)));
    if (!need0.size) return chosen;

    const remMinterms = [...need0];
    const seen = new Set();
    const remPrimes = [];
    for (const p of primes) {
      if (chosen.includes(p)) continue;
      const key = p.t.join(',');
      if (seen.has(key)) continue;
      let any = false;
      for (const m of need0) if (p.cov.has(m)) { any = true; break; }
      if (any) { seen.add(key); remPrimes.push(p); }
    }

    let best = null;
    let budget = 40000;
    const search = (picked, covered) => {
      if (best && picked.length >= best.length) return;
      if (covered.size === remMinterms.length) { best = picked.slice(); return; }
      if (--budget <= 0) return;
      /* branch on the uncovered minterm with the fewest covering primes */
      let cands = null;
      for (const m of remMinterms) {
        if (covered.has(m)) continue;
        const cs = remPrimes.filter(p => !picked.includes(p) && p.cov.has(m));
        if (!cands || cs.length < cands.length) {
          cands = cs;
          if (cs.length === 1) break;
        }
      }
      if (!cands || !cands.length) return;
      for (const p of cands) {
        picked.push(p);
        const added = [];
        p.cov.forEach(m => { if (need0.has(m) && !covered.has(m)) { covered.add(m); added.push(m); } });
        search(picked, covered);
        added.forEach(m => covered.delete(m));
        picked.pop();
        if (budget <= 0) return;
      }
    };
    search([], new Set());

    if (!best) {
      /* budget exhausted: greedy fallback */
      const need = new Set(remMinterms);
      best = [];
      while (need.size) {
        let bp = null, bc = 0;
        for (const p of remPrimes) {
          if (best.includes(p)) continue;
          let c = 0;
          for (const m of need) if (p.cov.has(m)) c++;
          if (c > bc) { bc = c; bp = p; }
        }
        if (!bp) break;
        best.push(bp);
        bp.cov.forEach(m => need.delete(m));
      }
    }
    return chosen.concat(best);
  }

  /* Algebraic normal form (XOR-of-ANDs). Returns coefficient array
     indexed by mask; bit (n-1-j) of mask <-> variable j. */
  function anfCoefficients(on, n) {
    const total = 1 << n;
    const c = new Array(total).fill(0);
    for (const i of on) c[i] = 1;
    for (let k = 0; k < n; k++) {
      const bit = 1 << (n - 1 - k);
      for (let m = 0; m < total; m++) {
        if (m & bit) c[m] ^= c[m ^ bit];
      }
    }
    return c;
  }

  /* Try to merge two cubes of the form base·x·y + base·x'·y'
     (same care mask, differ in exactly 2 positions) into
     base·(x XOR y) or base·(x XNOR y). Returns term list or null. */
  function mergeXorPair(cubes, n, lib) {
    if (cubes.length < 2) return null;
    for (let a = 0; a < cubes.length; a++) {
      for (let b = a + 1; b < cubes.length; b++) {
        const A = cubes[a].t, B = cubes[b].t;
        let sameMask = true;
        for (let k = 0; k < n; k++) if ((A[k] === -1) !== (B[k] === -1)) { sameMask = false; break; }
        if (!sameMask) continue;
        const diffs = [];
        for (let k = 0; k < n; k++) if (A[k] !== -1 && A[k] !== B[k]) diffs.push(k);
        if (diffs.length !== 2) continue;
        const [x, y] = diffs;
        const pol = (A[x] === A[y]) ? 'xnor' : 'xor';
        if (pol === 'xor' && !lib.has('XOR')) continue;
        if (pol === 'xnor' && !lib.has('XNOR')) continue;
        const base = A.map((v, k) => (k === x || k === y) ? -1 : v);
        const rest = cubes.filter((_, i) => i !== a && i !== b).map(c => ({ type: 'and', t: c.t }));
        return { terms: [...rest, { type: 'xor', base, x, y, pol }], merged: true };
      }
    }
    return null;
  }

  /* ---------------------------------------------------------- *
   *  Netlist builder with hash-consing (gates shared globally)  *
   * ---------------------------------------------------------- */
  function makeBuilder() {
    const nodes = [];
    const memo = {};
    const keyOf = k => (k in memo ? memo[k] : null);
    const reg = (type, ins, extra) => {
      const id = nodes.length;
      nodes.push(Object.assign({ id, type, ins, fanout: [] }, extra));
      ins.forEach(c => nodes[c].fanout.push(id));
      return id;
    };
    const sortedKey = (p, ins) => p + ':' + ins.slice().sort((a, b) => a - b).join(',');
    const isC0 = id => nodes[id].type === 'CONST0';
    const isC1 = id => nodes[id].type === 'CONST1';

    const api = {
      nodes,
      input(name) {
        let id = keyOf('in:' + name);
        if (id == null) { id = reg('IN', [], { label: name }); memo['in:' + name] = id; }
        return id;
      },
      const0() { let id = keyOf('c0'); if (id == null) { id = reg('CONST0', []); memo['c0'] = id; } return id; },
      const1() { let id = keyOf('c1'); if (id == null) { id = reg('CONST1', []); memo['c1'] = id; } return id; },
      not(a) {
        if (nodes[a].type === 'INV') return nodes[a].ins[0];
        if (isC0(a)) return api.const1();
        if (isC1(a)) return api.const0();
        let id = keyOf('not:' + a);
        if (id == null) { id = reg('INV', [a]); memo['not:' + a] = id; }
        return id;
      },
      and(ins) {
        let list = ins.filter(x => !isC1(x));
        if (ins.length !== list.length) { /* dropped const-1s */ }
        if (list.some(isC0)) return api.const0();
        if (list.length === 0) return api.const1();
        if (list.length === 1) return list[0];
        const k = sortedKey('and', list);
        let id = keyOf(k);
        if (id == null) { id = reg('AND', list.slice().sort((a, b) => a - b)); memo[k] = id; }
        return id;
      },
      or(ins) {
        let list = ins.filter(x => !isC0(x));
        if (list.some(isC1)) return api.const1();
        if (list.length === 0) return api.const0();
        if (list.length === 1) return list[0];
        const k = sortedKey('or', list);
        let id = keyOf(k);
        if (id == null) { id = reg('OR', list.slice().sort((a, b) => a - b)); memo[k] = id; }
        return id;
      },
      xor(a, b) {
        if (a === b) return api.const0();
        if (isC0(a)) return b;
        if (isC0(b)) return a;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        let id = keyOf('xor:' + lo + ',' + hi);
        if (id == null) { id = reg('XOR', [lo, hi]); memo['xor:' + lo + ',' + hi] = id; }
        return id;
      },
      xnor(a, b) {
        if (a === b) return api.const1();
        const lo = Math.min(a, b), hi = Math.max(a, b);
        let id = keyOf('xnor:' + lo + ',' + hi);
        if (id == null) { id = reg('XNOR', [lo, hi]); memo['xnor:' + lo + ',' + hi] = id; }
        return id;
      },
      nand(ins) {
        if (ins.length === 1) return api.not(ins[0]);
        const k = sortedKey('nand', ins);
        let id = keyOf(k);
        if (id == null) { id = reg('NAND', ins.slice().sort((a, b) => a - b)); memo[k] = id; }
        return id;
      },
      nor(ins) {
        if (ins.length === 1) return api.not(ins[0]);
        const k = sortedKey('nor', ins);
        let id = keyOf(k);
        if (id == null) { id = reg('NOR', ins.slice().sort((a, b) => a - b)); memo[k] = id; }
        return id;
      },
      mux2(s, d1, d0) {
        if (d0 === d1) return d0;
        let id = keyOf('mux2:' + s + ',' + d1 + ',' + d0);
        if (id == null) { id = reg('MUX', [s, d1, d0]); memo['mux2:' + s + ',' + d1 + ',' + d0] = id; }
        return id;
      },
      /* d_index chosen by {s1,s0}: d0=00 d1=01 d2=10 d3=11 */
      mux4(s1, s0, d3, d2, d1, d0) {
        if (d0 === d1 && d1 === d2 && d2 === d3) return d0;
        let id = keyOf('mux4:' + s1 + ',' + s0 + ',' + d3 + ',' + d2 + ',' + d1 + ',' + d0);
        if (id == null) { id = reg('MUX', [s1, s0, d3, d2, d1, d0]); memo['mux4:' + s1 + ',' + s0 + ',' + d3 + ',' + d2 + ',' + d1 + ',' + d0] = id; }
        return id;
      }
    };
    return api;
  }

  /* Inversion under library constraints. */
  function makeNot(b, a, lib) {
    const nd = b.nodes[a];
    if (nd.type === 'CONST0') return b.const1();
    if (nd.type === 'CONST1') return b.const0();
    if (nd.type === 'INV') return nd.ins[0];
    if ((nd.type === 'NAND' || nd.type === 'NOR') && nd.ins.every(id => id === nd.ins[0])) return nd.ins[0];
    const opposite = { AND: 'NAND', NAND: 'AND', OR: 'NOR', NOR: 'OR', XOR: 'XNOR', XNOR: 'XOR' }[nd.type];
    if (opposite && lib.has(opposite)) {
      return opposite === 'XOR' || opposite === 'XNOR'
        ? b[opposite.toLowerCase()](...nd.ins) : b[opposite.toLowerCase()](nd.ins);
    }
    if (lib.has('INV')) return b.not(a);
    if (lib.has('NAND')) return b.nand([a, a]);
    if (lib.has('NOR')) return b.nor([a, a]);
    const err = new Error('inversion');
    err.needInv = true;
    throw err;
  }
  function litNode(b, varId, polarity, lib) {
    return polarity === 1 ? varId : makeNot(b, varId, lib);
  }

  /* ---------- technology mapping paths ---------- */

  function cubesToSop(b, chosen, n, inIds, lib) {
    const terms = chosen.map(cube => {
      const ins = [];
      for (let k = 0; k < n; k++) {
        if (cube.t[k] === -1) continue;
        ins.push(litNode(b, inIds[k], cube.t[k], lib));
      }
      if (ins.length === 0) return b.const1();
      if (ins.length === 1) return ins[0];
      if (!lib.has('AND')) { const e = new Error('need AND'); e.need = 'AND'; throw e; }
      return b.and(ins);
    });
    if (terms.length === 1) return terms[0];
    if (!lib.has('OR')) { const e = new Error('need OR'); e.need = 'OR'; throw e; }
    return b.or(terms);
  }

  function buildMergedTerms(b, terms, n, inIds, lib) {
    const built = terms.map(term => {
      if (term.type === 'and') {
        const ins = [];
        for (let k = 0; k < n; k++) {
          if (term.t[k] === -1) continue;
          ins.push(litNode(b, inIds[k], term.t[k], lib));
        }
        if (ins.length === 0) return b.const1();
        if (ins.length === 1) return ins[0];
        return b.and(ins); // direct path guarantees AND
      }
      // xor term: base AND (x XOR/XNOR y)
      const xv = inIds[term.x], yv = inIds[term.y];
      const g = term.pol === 'xor' ? b.xor(xv, yv) : b.xnor(xv, yv);
      const ins = [g];
      for (let k = 0; k < n; k++) {
        if (term.base[k] === -1) continue;
        ins.push(litNode(b, inIds[k], term.base[k], lib));
      }
      if (ins.length === 1) return g;
      return b.and(ins);
    });
    if (built.length === 1) return built[0];
    return b.or(built);
  }

  function nandPath(b, chosen, n, inIds, lib) {
    const firsts = chosen.map(cube => {
      const ins = [];
      for (let k = 0; k < n; k++) {
        if (cube.t[k] === -1) continue;
        ins.push(litNode(b, inIds[k], cube.t[k], lib)); // INV via nand(x,x) if needed
      }
      if (ins.length === 0) return b.const1();
      if (ins.length === 1) return makeNot(b, ins[0], lib); // single-literal cube: (L)' stage
      return b.nand(ins);
    });
    if (firsts.length === 1) return makeNot(b, firsts[0], lib);
    return b.nand(firsts);
  }

  function norPath(b, compCubes, n, inIds, lib) {
    // f = NOR over (NOR of polarity-flipped cube literals of f')
    const inners = compCubes.map(cube => {
      const ins = [];
      for (let k = 0; k < n; k++) {
        if (cube.t[k] === -1) continue;
        ins.push(litNode(b, inIds[k], 1 - cube.t[k], lib));
      }
      if (ins.length === 0) return b.const0(); // f' cube == 1 -> f == 0 (handled earlier)
      if (ins.length === 1) return makeNot(b, ins[0], lib); // single-input NOR == NOT
      return b.nor(ins);
    });
    if (inners.length === 1) return makeNot(b, inners[0], lib);
    return b.nor(inners);
  }

  function dmAndPath(b, compCubes, n, inIds, lib) {
    // POS with AND+INV only: f = AND_j( INV(AND(cube lits of f')) )
    const factors = compCubes.map(cube => {
      const ins = [];
      for (let k = 0; k < n; k++) {
        if (cube.t[k] === -1) continue;
        ins.push(litNode(b, inIds[k], cube.t[k], lib));
      }
      if (ins.length === 0) return b.const0();
      const a = ins.length === 1 ? ins[0] : b.and(ins);
      return makeNot(b, a, lib); // INV guaranteed in this path
    });
    return b.and(factors);
  }

  function dmOrPath(b, compCubes, n, inIds, lib) {
    // f = INV( OR_j( INV( OR(polarity-flipped literals) ) ) ), OR+INV only
    const zs = compCubes.map(cube => {
      const ins = [];
      for (let k = 0; k < n; k++) {
        if (cube.t[k] === -1) continue;
        ins.push(litNode(b, inIds[k], 1 - cube.t[k], lib));
      }
      if (ins.length === 0) return b.const1();
      const f = ins.length === 1 ? ins[0] : b.or(ins);
      return makeNot(b, f, lib);
    });
    const s = zs.length === 1 ? zs[0] : b.or(zs);
    return makeNot(b, s, lib);
  }

  function anfPath(b, on, n, inIds, lib) {
    const total = 1 << n;
    const c = anfCoefficients(on, n);
    let acc = c[0] ? b.const1() : null;
    for (let m = 1; m < total; m++) {
      if (!c[m]) continue;
      const vars = [];
      for (let j = 0; j < n; j++) if (m & (1 << (n - 1 - j))) vars.push(inIds[j]);
      let term;
      if (vars.length === 1) term = vars[0];
      else {
        if (!lib.has('AND')) { const e = new Error('need AND'); e.need = 'AND'; throw e; }
        term = b.and(vars);
      }
      if (acc == null) acc = term;
      else {
        if (!lib.has('XOR')) { const e = new Error('need XOR'); e.need = 'XOR'; throw e; }
        acc = b.xor(acc, term);
      }
    }
    return acc == null ? b.const0() : acc;
  }

  function muxTree(b, ids, vals, lib, memo) {
    if (vals.every(v => v === vals[0])) return vals[0] ? b.const1() : b.const0();
    const key = ids.join(',') + '|' + vals.join('');
    if (key in memo) return memo[key];
    let out;
    if (ids.length === 1) {
      const x = ids[0];
      if (vals[0] === 0 && vals[1] === 1) out = x;
      else if (lib.has('INV') || lib.has('NAND') || lib.has('NOR')) out = makeNot(b, x, lib);
      else if (lib.has('MUX')) out = b.mux2(x, b.const0(), b.const1());
      else { const e = new Error('inversion'); e.needInv = true; throw e; }
    } else if (lib.has('MUX') && ids.length >= 2) {
      const a = ids[0], c = ids[1], rest = ids.slice(2);
      const q = vals.length / 4;
      const c00 = muxTree(b, rest, vals.slice(0, q), lib, memo);
      const c01 = muxTree(b, rest, vals.slice(q, 2 * q), lib, memo);
      const c10 = muxTree(b, rest, vals.slice(2 * q, 3 * q), lib, memo);
      const c11 = muxTree(b, rest, vals.slice(3 * q), lib, memo);
      out = b.mux4(a, c, c11, c10, c01, c00);
    } else if (lib.has('MUX')) {
      const a = ids[0], rest = ids.slice(1);
      const h = vals.length / 2;
      const d0 = muxTree(b, rest, vals.slice(0, h), lib, memo);
      const d1 = muxTree(b, rest, vals.slice(h), lib, memo);
      out = b.mux2(a, d1, d0);
    } else {
      const e = new Error('need MUX');
      e.need = 'MUX';
      throw e;
    }
    memo[key] = out;
    return out;
  }

  function reasonText(e, lib) {
    if (e.needInv) return 'signal inversion is required but the library has no INV / NAND / NOR';
    if (e.need === 'AND') return 'an AND gate is required but AND is not selected';
    if (e.need === 'OR') return 'an OR gate is required but OR is not selected';
    if (e.need === 'XOR') return 'an XOR gate is required but XOR is not selected';
    if (e.need === 'MUX') return 'a MUX is required but MUX is not selected';
    return e.message || 'mapping failed';
  }

  /* Synthesize one output. Returns { id, path, display } or throws
     an Error whose .reasons is an array of human-readable strings. */
  function synthesize(on, n, inIds, lib, b, inNames) {
    const total = 1 << n;
    if (on.length === 0) return { id: b.const0(), path: 'constant' };
    if (on.length === total) return { id: b.const1(), path: 'constant' };

    const reasons = [];
    const primes = minimizeSOP(on, n);
    const chosen = coverSOP(primes, on);
    const comp = [];
    for (let i = 0; i < total; i++) if (!on.includes(i)) comp.push(i);
    const compCubes = coverSOP(minimizeSOP(comp, n), comp);
    const vals = new Array(total).fill(0);
    on.forEach(i => vals[i] = 1);

    // display expression (independent of mapping): minimized SOP, XOR-merged when possible
    let displayTerms = null;
    const mx = (lib.has('XOR') || lib.has('XNOR')) ? mergeXorPair(chosen, n, lib) : null;
    if (mx) displayTerms = mx.terms;

    function finish(id, path) {
      return { id, path, display: { cubes: chosen, xorTerms: displayTerms } };
    }

    const candidates = [];
    const attempt = (path, build) => {
      try {
        const id = build();
        const stats = netStats(b.nodes, reachable(b.nodes, [id]), [{ id }]);
        candidates.push({ id, path, ...stats });
      } catch (e) { reasons.push(path + ': ' + reasonText(e, lib)); }
    };
    if (lib.has('AND') && lib.has('OR')) {
      attempt('two-level AND/OR', () => cubesToSop(b, chosen, n, inIds, lib));
      if (displayTerms) attempt('XOR-merged AND/OR', () => buildMergedTerms(b, displayTerms, n, inIds, lib));
      attempt('complemented AND/OR (De Morgan)', () => makeNot(b, cubesToSop(b, compCubes, n, inIds, lib), lib));
    }
    if (lib.has('NAND')) attempt('NAND-NAND', () => nandPath(b, chosen, n, inIds, lib));
    if (lib.has('NOR')) attempt('NOR-NOR', () => norPath(b, compCubes, n, inIds, lib));
    if (lib.has('AND') && lib.has('INV')) {
      attempt('AND + INV (De Morgan)', () => dmAndPath(b, compCubes, n, inIds, lib));
    }
    if (lib.has('OR') && lib.has('INV')) {
      attempt('OR + INV (De Morgan)', () => dmOrPath(b, compCubes, n, inIds, lib));
    }
    if (lib.has('XOR')) attempt('XOR/AND (ANF)', () => anfPath(b, on, n, inIds, lib));
    if (lib.has('MUX')) attempt('MUX tree', () => muxTree(b, inIds, vals, lib, {}));
    candidates.sort((a, b) => a.gates - b.gates || a.wires - b.wires || a.levels - b.levels);
    if (candidates.length) return finish(candidates[0].id, candidates[0].path);

    // Nothing worked — assemble a helpful message.
    const err = new Error('cannot synthesize');
    const hasOnlyBufInv = ['INV', 'BUF'].filter(g => lib.has(g)).length === lib.size && lib.size > 0;
    if (lib.size === 0) {
      reasons.unshift('No gates selected. Choose at least one gate type.');
    } else if (hasOnlyBufInv) {
      reasons.unshift('The library only contains INV/BUF gates, which cannot compute any non-trivial function.');
    } else if (lib.size === 1 && lib.has('XOR')) {
      reasons.unshift('XOR alone can only implement parity (linear) functions; this truth table is not one.');
    }
    reasons.push('Hint: a complete library needs one of — AND+INV, OR+INV, NAND, NOR, XOR+AND — or MUX with (optionally) INV/NAND/NOR.');
    err.reasons = reasons;
    throw err;
  }

  /* ---------------------------------------------------------- *
   *  Expression rendering                                       *
   * ---------------------------------------------------------- */
  function exprHtml(display, inNames) {
    const n = inNames.length;
    if (display.xorTerms) {
      const parts = display.xorTerms.map(term => {
        if (term.type === 'and') return andHtml(term.t);
        const xL = litHtml(inNames[term.x], 1);
        const yL = litHtml(inNames[term.y], 1);
        const gate = term.pol === 'xor' ? ' &oplus; ' : ' &#8857; ';
        const base = [];
        for (let k = 0; k < n; k++) {
          if (term.base[k] === -1) continue;
          base.push(litHtml(inNames[k], term.base[k]));
        }
        const core = (base.length ? '(' : '') + xL + gate + yL + (base.length ? ')' : '');
        return base.length ? base.join('') + core : core;
      });
      return parts.join(' + ');
    }
    return display.cubes.map(c => andHtml(c.t)).join(' + ');

    function andHtml(t) {
      const lits = [];
      for (let k = 0; k < t.length; k++) {
        if (t[k] === -1) continue;
        lits.push(litHtml(inNames[k], t[k]));
      }
      return lits.length ? lits.join('') : '1';
    }
  }
  function litHtml(name, pol) {
    return pol === 1 ? name : '<span class="ovl">' + name + '</span>';
  }
  function exprText(display, inNames) {
    const n = inNames.length;
    const lit = (k, p) => p === 1 ? inNames[k] : inNames[k] + "'";
    if (display.xorTerms) {
      return display.xorTerms.map(term => {
        if (term.type === 'and') return andT(term.t);
        const base = [];
        for (let k = 0; k < n; k++) if (term.base[k] !== -1) base.push(lit(k, term.base[k]));
        const core = lit(term.x, 1) + (term.pol === 'xor' ? ' ^ ' : ' ~^ ') + lit(term.y, 1);
        return base.length ? base.join('') + '(' + core + ')' : core;
      }).join(' + ');
    }
    return display.cubes.map(c => andT(c.t)).join(' + ');

    function andT(t) {
      const lits = [];
      for (let k = 0; k < t.length; k++) if (t[k] !== -1) lits.push(lit(k, t[k]));
      return lits.length ? lits.join('') : '1';
    }
  }

  /* ---------------------------------------------------------- *
   *  Netlist analysis + SVG schematic                           *
   * ---------------------------------------------------------- */
  function reachable(nodes, roots) {
    const seen = new Set();
    const stack = roots.slice();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      nodes[id].ins.forEach(c => stack.push(c));
    }
    return seen;
  }

  function computeLevels(nodes, ids) {
    const level = new Map();
    const visit = id => {
      if (level.has(id)) return level.get(id);
      const nd = nodes[id];
      let lv = 0;
      nd.ins.forEach(c => lv = Math.max(lv, visit(c) + 1));
      level.set(id, lv);
      return lv;
    };
    ids.forEach(visit);
    return level;
  }

  /* gate geometry per type */
  const GATE = {
    AND:    { w: 46, base: 32, gap: 16 },
    NAND:   { w: 46, base: 32, gap: 16, bubble: true },
    OR:     { w: 50, base: 32, gap: 16 },
    NOR:    { w: 50, base: 32, gap: 16, bubble: true },
    XOR:    { w: 52, base: 32, gap: 16, xorCurve: true },
    XNOR:   { w: 52, base: 32, gap: 16, bubble: true, xorCurve: true },
    INV:    { w: 32, base: 24, gap: 16, bubble: true, tri: true },
    BUF:    { w: 32, base: 24, gap: 16, tri: true },
    MUX:    { w: 62, base: 0, gap: 18, mux: true }
  };

  function muxSelCount(nd) { return nd.ins.length >= 6 ? 2 : 1; }

  function nodeHeight(type, ins) {
    const g = GATE[type];
    if (g.mux) return ins >= 4 ? 100 : 62;
    return Math.max(g.base, ins * g.gap + 14);
  }
  /* pin offsets relative to center y (data pins only) */
  function pinYs(type, ins) {
    const h = nodeHeight(type, ins);
    const ys = [];
    for (let i = 0; i < ins; i++) ys.push(-h / 2 + (h / (ins + 1)) * (i + 1));
    return ys;
  }

  function renderSvg(builder, roots, inNames, opts) {
    const dl = !!(opts && opts.forDownload);
    const f = v => Math.round(v * 10) / 10;
    const nodes = builder.nodes;
    const reach = reachable(nodes, roots.map(r => r.id));
    const ids = [...reach].sort((a, b) => a - b);
    const level = computeLevels(nodes, ids);

    const maxLevel = Math.max(1, ...ids.map(id => level.get(id)));
    const rootIds = new Set(roots.map(r => r.id));
    const consumers = new Map(ids.map(id => [id, []]));
    ids.forEach(id => nodes[id].ins.forEach(src => consumers.get(src).push(id)));
    [...ids].reverse().forEach(id => {
      const next = consumers.get(id);
      if (level.get(id) && !rootIds.has(id) && next.length) {
        level.set(id, Math.min(...next.map(dst => level.get(dst))) - 1);
      }
    });
    const TRACK = 12;
    const colXs = [30];
    for (let lv = 1; lv <= maxLevel; lv++) {
      const crossing = ids.filter(id => level.get(id) < lv
        && consumers.get(id).some(dst => level.get(dst) >= lv)).length;
      colXs[lv] = colXs[lv - 1] + (lv === 1 ? 44 : 80) + Math.max(84, (crossing + 2) * TRACK);
    }

    /* group by level */
    const byLevel = new Map();
    ids.forEach(id => {
      const lv = level.get(id);
      if (!byLevel.has(lv)) byLevel.set(lv, []);
      byLevel.get(lv).push(id);
    });

    /* layout */
    const pos = new Map(); // id -> {x, y, h, w}
    const colX = lv => colXs[lv];

    // level 0: inputs & constants
    const lv0 = (byLevel.get(0) || []).slice().sort((a, b) => {
      const ta = nodes[a].type, tb = nodes[b].type;
      if (ta === 'IN' && tb !== 'IN') return -1;
      if (ta !== 'IN' && tb === 'IN') return 1;
      return labelOf(a).localeCompare(labelOf(b));
    });
    function labelOf(id) {
      const nd = nodes[id];
      if (nd.type === 'IN') return nd.label;
      if (nd.type === 'CONST0') return '0';
      if (nd.type === 'CONST1') return '1';
      return nd.type;
    }
    const inOrder = [];
    const topMargin = 36 + TRACK * lv0.length;
    let yCursor = topMargin;
    lv0.forEach(id => {
      const nd = nodes[id];
      const isIn = nd.type === 'IN';
      pos.set(id, { x: colX(0), y: yCursor, w: isIn ? 0 : 26, h: 20, label: labelOf(id) });
      if (isIn) inOrder.push(id);
      yCursor += 48;
    });

    // gates: column by column, order by barycenter of child y positions
    for (let lv = 1; lv <= maxLevel; lv++) {
      let col = (byLevel.get(lv) || []).slice();
      col.sort((a, b) => bary(a) - bary(b));
      function bary(id) {
        const nd = nodes[id];
        if (!nd.ins.length) return 0;
        let s = 0, c = 0;
        nd.ins.forEach(ch => { const p = pos.get(ch); if (p) { s += p.y; c++; } });
        return c ? s / c : 0;
      }
      let y = topMargin - 24;
      col.forEach(id => {
        const nd = nodes[id];
        const g = GATE[nd.type];
        const h = nodeHeight(nd.type, dataPinCount(nd));
        const w = g.w + (g.bubble ? 10 : 0) + (g.xorCurve ? 10 : 0);
        const cy = Math.max(y + h / 2, bary(id));
        pos.set(id, { x: colX(lv), y: cy, w, h, gate: true });
        y = cy + h / 2 + 52 + (g.mux ? 24 : 0);
      });
    }

    const pinOrder = new Map();
    function assignPinOrder() {
      pinOrder.clear();
      ids.forEach(id => {
        const nd = nodes[id];
        if (!['AND', 'NAND', 'OR', 'NOR', 'XOR', 'XNOR'].includes(nd.type)) return;
        const order = nd.ins.map((src, i) => i).sort((a, b) =>
          pos.get(nd.ins[a]).y - pos.get(nd.ins[b]).y || a - b);
        const slots = [];
        order.forEach((index, slot) => { slots[index] = slot; });
        pinOrder.set(id, slots);
      });
    }
    assignPinOrder();

    function dataPinCount(nd) {
      return nd.type === 'MUX' ? nd.ins.length - muxSelCount(nd) : nd.ins.length;
    }

    function isOrType(t) { return t === 'OR' || t === 'NOR' || t === 'XOR' || t === 'XNOR'; }

    /* pin coordinates (absolute); MUX ins order: [s, d1, d0] or [s1, s0, d3, d2, d1, d0] */
    function inPin(id, i) {
      const p = pos.get(id), nd = nodes[id], g = GATE[nd.type];
      if (nd.type === 'IN') return { x: p.x + 6, y: p.y };
      if (nd.type === 'CONST0' || nd.type === 'CONST1') return { x: p.x + p.w, y: p.y };
      if (g.mux) {
        const nSel = muxSelCount(nd);
        if (i < nSel) {
          const q = selPin(id, nSel - 1 - i);
          /* select pins sit on the bottom edge: wires must approach from
             below so the horizontal tap never overlaps the trapezoid edge */
          q.below = 16;
          q.edge = p.x;
          return q;
        }
        const ys = pinYs(nd.type, nd.ins.length - nSel);
        return { x: p.x, y: f(p.y + ys[i - nSel]) };
      }
      const ys = pinYs(nd.type, nd.ins.length);
      i = pinOrder.has(id) ? pinOrder.get(id)[i] : i;
      let px = p.x;
      if (isOrType(nd.type)) {
        const t = 0.5 - ys[i] / p.h;
        px = p.x + 2 * t * (1 - t) * 0.34 * g.w;
      }
      /* snap to the rendered 0.1 grid — the router's 0.4px clearances are
         checked against these values but the SVG only shows the rounded
         ones, and a 0.41px gap rounds down to a touching pair */
      return { x: f(px), y: f(p.y + ys[i]) };
    }
    function selPin(id, which) {
      const p = pos.get(id), nd = nodes[id];
      const nSel = muxSelCount(nd);
      const y = p.y + p.h / 2;
      if (nSel === 1) return { x: p.x + p.w / 2, y };
      return which === 0
        ? { x: f(p.x + p.w * 0.32), y }
        : { x: f(p.x + p.w * 0.68), y };
    }
    function outPin(id) {
      const p = pos.get(id), nd = nodes[id];
      if (nd.type === 'IN') return { x: p.x + 6, y: p.y };
      if (nd.type === 'CONST0' || nd.type === 'CONST1') return { x: p.x + p.w, y: p.y };
      return { x: p.x + p.w, y: p.y };
    }

    const labelBoxes = [];
    ids.forEach(id => {
      const p = pos.get(id), nd = nodes[id];
      if (!p.gate || nd.type === 'MUX' || nd.type === 'BUF') return;
      const cx = f(p.x + p.w / 2), baseline = f(p.y + p.h / 2 + 14);
      const half = nd.type.length * 3 + 4;
      labelBoxes.push({ x1: cx - half, x2: cx + half, y1: baseline - 13, y2: baseline + 6 });
    });
    const inputBox = (id, x, y) => ({
      x1: x - 10 - nodes[id].label.length * 7.5, x2: x + 10, y1: y - 7, y2: y + 7
    });
    const overlaps = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    inOrder.forEach(id => {
      const p = pos.get(id), next = [...new Set(consumers.get(id))];
      if (!next.length || rootIds.has(id)) return;
      const pins = next.flatMap(dst => nodes[dst].ins.flatMap((src, i) => src === id
        ? [{ ...inPin(dst, i), dst }] : []));
      const nearX = Math.min(...next.map(dst => pos.get(dst).x));
      const ys = [...new Set([p.y, ...pins.filter(pin => !pin.below).map(pin => pin.y)])];
      const candidates = [];
      for (const y of ys) {
        const box = inputBox(id, p.x, y);
        if (labelBoxes.some(b => overlaps(box, b))) continue;
        if (ids.some(other => {
          if (other === id) return false;
          const q = pos.get(other);
          return overlaps(box, nodes[other].type === 'IN' ? inputBox(other, q.x, q.y)
            : { x1: q.x - 8, x2: q.x + q.w + 8, y1: q.y - q.h / 2 - 8, y2: q.y + q.h / 2 + 8 });
        })) continue;
        const score = pins.reduce((sum, pin) => sum
          + Math.abs(pin.y + (pin.below || 0) - y) * (pin.x < nearX + 20 ? 2 : 1), 0)
          + Math.abs(y - p.y) * 0.1;
        candidates.push({ y, score });
      }
      candidates.sort((a, b) => a.score - b.score);
      if (candidates.length) p.y = candidates[0].y;
    });
    inOrder.forEach(id => {
      const p = pos.get(id), box = inputBox(id, p.x, p.y);
      labelBoxes.push({ ...box, x2: p.x - 2, input: id });
    });
    /* pins must follow the final input order — a frozen order makes the
       rails cross the gate face whenever terminals swap rows above */
    assignPinOrder();

    const outputX = Math.max(colX(maxLevel), ...ids.map(id => pos.get(id).x + pos.get(id).w))
      + Math.max(96, (roots.length + 2) * TRACK);
    let constantY = Math.max(topMargin, ...ids.filter(id => pos.get(id).gate)
      .map(id => pos.get(id).y + pos.get(id).h / 2 + 20)) + 48;
    const constantOutputs = lv0.filter(id => rootIds.has(id) && !consumers.get(id).length
      && nodes[id].type.startsWith('CONST'));
    constantOutputs.forEach(id => {
      Object.assign(pos.get(id), { x: outputX - 64, y: constantY });
      constantY += 48;
    });
    const outputPorts = roots.map((r, i) => ({ src: r.id, dst: nodes.length + i, label: r.label }))
      .sort((a, b) => outPin(a.src).y - outPin(b.src).y || a.src - b.src || a.dst - b.dst);
    const outputCounts = new Map();
    outputPorts.forEach(port => outputCounts.set(port.src, (outputCounts.get(port.src) || 0) + 1));
    const outputIndex = new Map();
    let outputY = 24;
    outputPorts.forEach(port => {
      const index = outputIndex.get(port.src) || 0;
      outputIndex.set(port.src, index + 1);
      const y = f(Math.max(outputY, outPin(port.src).y - (outputCounts.get(port.src) - 1) * 24 + index * 48));
      pos.set(port.dst, { x: outputX, y, w: 0, h: 20, output: true });
      labelBoxes.push({ x1: outputX + 7, x2: outputX + 14 + port.label.length * 7.5, y1: y - 10, y2: y + 12 });
      outputY = y + 48;
    });
    constantOutputs.forEach(id => {
      const ys = outputPorts.filter(port => port.src === id).map(port => pos.get(port.dst).y);
      pos.get(id).y = f((ys[0] + ys[ys.length - 1]) / 2);
    });

    /* canvas size */
    let maxY = 0;
    pos.forEach(p => maxY = Math.max(maxY, p.y + p.h / 2 + (p.gate ? 16 : 0)));
    const width = outputX + Math.max(90, ...roots.map(r => r.label.length * 7.5 + 20));
    const height = maxY + 40;

    const svg = [];
    svg.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" font-family="Consolas,Menlo,monospace" font-size="12">');
    if (dl) svg.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#ffffff"/>');
    svg.push('<defs><style>'
      + (dl
        ? '.gl{stroke:#000;stroke-width:1.6;fill:none}.gb{stroke:#000;stroke-width:1.6;fill:#fff}.gc{stroke:#000;stroke-width:1.6;fill:none}.bb{fill:#fff;stroke:#000;stroke-width:1.6}.term{fill:#fff;stroke:#000;stroke-width:1.4}.dot{fill:#000}.lbl{fill:#000}.olbl{fill:#000;font-weight:bold}.gt{fill:#000;font-size:9.5px}'
        : '.gl{stroke:var(--sg-wire);stroke-width:1.6;fill:none}.gb{stroke:var(--sg-gate);stroke-width:1.6;fill:var(--bg)}.gc{stroke:var(--sg-gate);stroke-width:1.6;fill:none}.bb{fill:var(--bg);stroke:var(--sg-gate);stroke-width:1.6}.term{fill:var(--bg);stroke:var(--sg-wire);stroke-width:1.4}.dot{fill:var(--sg-wire)}.lbl{fill:var(--sg-label)}.olbl{fill:var(--sg-out);font-weight:bold}.gt{fill:var(--sg-gate);opacity:.8;font-size:9.5px}')
      + '</style></defs>');

    /* wires: orthogonal (horizontal/vertical) routing, one trunk per source */
    const edges = [];
    ids.forEach(id => {
      const nd = nodes[id];
      nd.ins.forEach((src, i) => {
        if (!reach.has(src)) return;
        edges.push({ src, dst: id, pin: inPin(id, i) });
      });
    });
    outputPorts.forEach(port => {
      const p = pos.get(port.dst);
      edges.push({ src: port.src, dst: port.dst, pin: { x: p.x, y: p.y } });
    });
    const bySrc = new Map();
    edges.forEach(e => {
      if (!bySrc.has(e.src)) bySrc.set(e.src, []);
      bySrc.get(e.src).push(e);
    });
    /* stagger trunk lanes so different nets in the same column never overlap */
    const colSrcs = new Map();
    bySrc.forEach((list, src) => {
      const s = outPin(src);
      if (!s || !list.length) return;
      const key = Math.round(s.x / 4);
      if (!colSrcs.has(key)) colSrcs.set(key, []);
      colSrcs.get(key).push({ src, s, n: list.length });
    });
    const laneOf = new Map();
    colSrcs.forEach(list => {
      list.sort((a, b) => a.s.y - b.s.y);
      let lane = 0;
      list.forEach(it => { laneOf.set(it.src, lane); lane++; });
    });
    /* obstructions for a horizontal run at y between x1..x2: gate bodies,
       plus foreign pin points (a wire passing exactly through another net's
       pin would read as a short). skip = dst ids of the net being routed;
       allowDst exempts the destination gate itself — OR-family input pins
       sit on the concave back arc inside the bounding box, so the final
       approach row legitimately enters the box and ends exactly on the arc. */
    const pinPts = edges.map(e => ({ x: e.pin.x, y: e.pin.y, dst: e.dst }));
    const hBlockers = (y, x1, x2, skip, allowDst) => {
      const rs = [];
      ids.forEach(id => {
        const p = pos.get(id), nd = nodes[id];
        if (!p || nd.type === 'IN') return;
        if (allowDst && allowDst.has(id)) return;
        const gy1 = p.y - p.h / 2, gy2 = p.y + p.h / 2;
        if (y > gy1 - 8 && y < gy2 + 8
          && p.x + p.w > x1 + 0.1 && p.x < x2 - 0.1) {
          rs.push([p.x - 8, gy1 - 12, p.x + p.w + 8]);
        }
      });
      labelBoxes.forEach(b => {
        if (y > b.y1 && y < b.y2 && b.x2 > x1 + 0.1 && b.x1 < x2 - 0.1)
          rs.push([b.x1 - 8, b.y1 - 12, b.x2 + 8]);
      });
      if (skip) {
        for (let k = 0; k < pinPts.length; k++) {
          const q = pinPts[k];
          if (skip.has(q.dst)) continue;
          if (Math.abs(q.y - y) < 0.5 && q.x > x1 + 6 && q.x < x2 - 16) {
            rs.push([q.x - 8, y - 12, q.x + 8]);
          }
        }
      }
      return rs;
    };
    /* horizontal / vertical corridors already routed (per net, for
       de-confliction) */
    const usedH = [];
    const usedV = [];
    outputPorts.forEach(port => {
      const pin = pos.get(port.dst);
      usedH.push({ src: port.src, y: pin.y, x1: pin.x - 14, x2: pin.x });
    });
    let curSrc = null;
    const registerWire = (src, d) => {
      const toks = d.split(' ');
      let x = parseFloat(toks[1]), y = parseFloat(toks[2]);
      for (let i = 3; i + 1 < toks.length; i += 2) {
        const v = parseFloat(toks[i + 1]);
        if (toks[i] === 'H') {
          usedH.push({ src, y, x1: Math.min(x, v), x2: Math.max(x, v) });
          x = v;
        } else {
          usedV.push({ src, x, y1: Math.min(y, v), y2: Math.max(y, v) });
          y = v;
        }
      }
    };
    /* vertical at x between y1..y2 must not cross a gate body */
    const vCleanG = (vx, y1, y2, allowDst) => {
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      if (labelBoxes.some(b => vx > b.x1 && vx < b.x2 && Math.min(hi, b.y2) - Math.max(lo, b.y1) > 0.1)) return false;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i], p = pos.get(id), nd = nodes[id];
        if (!p || nd.type === 'IN') continue;
        if (allowDst && allowDst.has(id)) continue;
        if (vx > p.x - 0.4 && vx < p.x + p.w + 0.4) {
          const o = Math.min(hi, p.y + p.h / 2 - 2) - Math.max(lo, p.y - p.h / 2 + 2);
          if (o > 1) return false;
        }
      }
      return true;
    };
    /* a clean vertical also stays clear of other nets' verticals (wires
       merging into a parallel run read as a short) and of foreign pin
       points passed through the interior of the span */
    const vClean2 = (vx, y1, y2, allowDst, skip) => {
      if (!vCleanG(vx, y1, y2, allowDst)) return false;
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      for (let i = 0; i < usedV.length; i++) {
        const u = usedV[i];
        if (u.src === curSrc) continue;
        if (Math.abs(u.x - vx) < 1.5 && Math.min(hi, u.y2) - Math.max(lo, u.y1) > 1) return false;
      }
      for (let k = 0; k < pinPts.length; k++) {
        const q = pinPts[k];
        if (skip && skip.has(q.dst)) continue;
        if (Math.abs(q.x - vx) < 0.5 && q.y > lo + 0.5 && q.y < hi - 0.5) return false;
      }
      return true;
    };
    /* if x sits inside another net's vertical zone across part of y1..y2,
       return the x to shift to in order to leave a 1.5px gap (dir = which
       side to go); null when the position is already clean */
    const vZone = (x, y1, y2, dir) => {
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      for (let i = 0; i < usedV.length; i++) {
        const u = usedV[i];
        if (u.src === curSrc) continue;
        if (Math.abs(u.x - x) < 1.5 && Math.min(hi, u.y2) - Math.max(lo, u.y1) > 1)
          return dir > 0 ? u.x + 1.5 : u.x - 1.5;
      }
      return null;
    };
    /* lane-scan fallback: when 9px-staggered lanes are exhausted in a crowded
       column, hunt for any clean slot at 3px, then 1.5px, granularity — a
       cramped corridor still fits many more verticals, just closer together;
       without this the riser clamps onto the pin x and slices through the
       whole destination column */
    const fineSlot = (x0, x1, chk) => {
      for (let x = x0; x <= x1; x += 3) if (chk(x)) return x;
      for (let x = x0 + 1.5; x <= x1; x += 3) if (chk(x)) return x;
      return -1;
    };
    /* planting a new corner on another net's endpoint — or on a foreign
       pin point — would read as a short; keep 0.4px away from all of them */
    const epTaken = (x, y, skip) => {
      for (let i = 0; i < usedH.length; i++) {
        const u = usedH[i];
        if (u.src === curSrc) continue;
        if (Math.abs(u.y - y) < 0.4 && (Math.abs(u.x1 - x) < 0.4 || Math.abs(u.x2 - x) < 0.4)) return true;
      }
      for (let i = 0; i < usedV.length; i++) {
        const u = usedV[i];
        if (u.src === curSrc) continue;
        if (Math.abs(u.x - x) < 0.4 && (Math.abs(u.y1 - y) < 0.4 || Math.abs(u.y2 - y) < 0.4)) return true;
      }
      for (let k = 0; k < pinPts.length; k++) {
        const q = pinPts[k];
        if (skip && skip.has(q.dst)) continue;
        if (Math.abs(q.x - x) < 0.4 && Math.abs(q.y - y) < 0.4) return true;
      }
      return false;
    };
    /* a corridor row is usable when no other net's horizontal runs within
       3px of it across the span and no gate body / foreign pin blocks it */
    const rowFree = (src, y, x1, x2, skip, allowDst) => {
      if (y < 8 || y > height - 8) return false;
      for (let i = 0; i < usedH.length; i++) {
        const u = usedH[i];
        if (u.src === src) continue;
        if (Math.abs(u.y - y) < 3 && Math.min(u.x2, x2) - Math.max(u.x1, x1) > 1) return false;
      }
      return !hBlockers(y, x1, x2, skip, allowDst).length;
    };
    /* straight horizontal continuation; detour only when truly obstructed.
       dropX caps where the detour drops back so it can be kept clear of a
       target gate's left edge (used by below-approach pins). Detour corridors
       are staggered per lane, and a leg never runs within 3px of another
       net's corridor (that would read as a short). */
    const hRun = (x1, y, x2, skip, dropX, lane, allowDst) => {
      if (x2 - x1 < 0.5) return '';
      let legs = [{ x1, y, x2 }];
      const vClean = (vx, y1, y2) => vClean2(vx, y1, y2, allowDst, skip);
      const conflictAt = (yy, a, b, skipIdx) => {
        for (let i = 0; i < usedH.length; i++) {
          if (skipIdx && skipIdx.has(i)) continue;
          const u = usedH[i];
          if (u.src === curSrc) continue;
          if (Math.abs(u.y - yy) < 3) {
            const lo = Math.max(u.x1, a), hi = Math.min(u.x2, b);
            if (hi - lo > 1) return { u, lo, hi, i };
          }
        }
        return null;
      };
      const insideBody = (fx, fy) => {
        let hit = null;
        ids.forEach(id => {
          if (hit) return;
          const p = pos.get(id), nd = nodes[id];
          if (!p || nd.type === 'IN') return;
          if (allowDst && allowDst.has(id)) return;
          if (fx > p.x + 1 && fx < p.x + p.w - 1 && fy > p.y - p.h / 2 + 1 && fy < p.y + p.h / 2 - 1) hit = id;
        });
        return hit;
      };
      const deconflict = () => {
        for (let k = 0; k < legs.length; k++) {
          const L = legs[k];
          if (L.via != null) continue;
          /* try every conflicting corridor in turn — the first one found may
             be undodgeable within its window while a later one is fixable */
          const tried = new Set();
          let repl = null;
          for (;;) {
            const c = conflictAt(L.y, L.x1, L.x2, tried);
            if (!c) break;
            tried.add(c.i);
            /* grow the dodge window when every row inside the tight one is
               rejected — three nets' stubs can overlap pairwise within ±6px
               yet a ±14/±22px span still has clean rows beyond them */
            let alt = null, useL = 0, useR = 0;
            const sgn = L.y - c.u.y > 0 ? 1 : -1;
            const steps = [8, -8, 16, -16, 24, -24, 32, -32, 4, -4, 12, -12, 20, -20, 28, -28];
            for (let grow = 6; grow <= 30 && alt == null; grow += 8) {
              const left = Math.max(L.x1, c.lo - grow), right = Math.min(L.x2, c.hi + grow);
              if (right - left < 3) continue;
              for (let q = 0; q < steps.length && alt == null; q++) {
                const ay = L.y + steps[q] * sgn;
                if (ay < 8 || ay > height - 8) continue;
                if (hBlockers(ay, left, right, skip, allowDst).length) continue;
                if (conflictAt(ay, left, right)) continue;
                /* pull both jog foot points (and their verticals) out of any
                   gate body or parallel vertical zone; the residual collinear
                   stretch must stay ≤ 1px */
                let l = left, r = right, guard = 0;
                while (guard++ < 10) {
                  const gl = insideBody(l, L.y), gr = insideBody(r, L.y);
                  if (gl) l = pos.get(gl).x + pos.get(gl).w + 2;
                  if (gr) r = pos.get(gr).x - 2;
                  const zl = gl ? null : vZone(l, L.y, ay, +1);
                  const zr = gr ? null : vZone(r, L.y, ay, -1);
                  if (zl != null) l = zl;
                  if (zr != null) r = zr;
                  if (!gl && !gr && zl == null && zr == null) break;
                }
                /* a stub leg (e.g. a corridor's tail) can be only a few px
                   wide — its window is capped by the leg itself, so the
                   foot separation floor must scale down too, else the only
                   possible dodge is rejected as 'short' */
                if (r - l < Math.min(6, L.x2 - L.x1)) continue;
                const preOv = Math.min(l, c.hi) - Math.max(L.x1, c.lo);
                const retOv = Math.min(L.x2, c.hi) - Math.max(r, c.lo);
                if (preOv > 1 || retOv > 1) continue;
                if (!vClean(l, L.y, ay) || !vClean(r, L.y, ay)) continue;
                if (epTaken(l, L.y, skip) || epTaken(r, L.y, skip) || epTaken(l, ay, skip) || epTaken(r, ay, skip)) continue;
                alt = ay; useL = l; useR = r;
              }
            }
            if (alt == null) continue;
            repl = [];
            if (useL - L.x1 > 2) repl.push({ x1: L.x1, y: L.y, x2: useL });
            repl.push({ x1: useL, y: L.y, x2: useR, via: alt });
            if (L.x2 - useR > 0.5) repl.push({ x1: useR, y: L.y, x2: L.x2 });
            break;
          }
          if (repl) {
            legs.splice(k, 1, ...repl);
            k += repl.length - 1;
          }
        }
      };
      const applyBlockers = () => {
        for (let k = 0; k < legs.length; k++) {
          const L = legs[k];
          if (L.via != null) continue;
          const rs = hBlockers(L.y, L.x1, L.x2, skip, allowDst);
          if (!rs.length) continue;
          const riseX = Math.max(L.x1, Math.min.apply(null, rs.map(r => r[0])) - lane * TRACK);
          const dy0 = Math.max(8, Math.min.apply(null, rs.map(r => r[1])) - lane * TRACK);
          let drX = Math.min(L.x2 - 14, dropX == null ? Infinity : dropX) - lane * TRACK;
          // Returning before a blocker's right edge would cut through its body or label.
          drX = Math.min(L.x2, Math.max(drX, ...rs.map(r => r[2])));
          if (drX < riseX) drX = riseX;
          if (drX - riseX < 3) continue; /* no room for a corridor here */
          /* corridor rows must stay visually clear of every gate bbox —
             hBlockers' ±2 band-edge tolerance admits rows 2px inside the
             edge, which still reads as running through the gate */
          const bodyStrict = (yy, rx, dr) => {
            for (let i = 0; i < ids.length; i++) {
              const id = ids[i], p = pos.get(id), nd = nodes[id];
              if (!p || nd.type === 'IN') continue;
              if (allowDst && allowDst.has(id)) continue;
              if (Math.min(p.x + p.w, dr) - Math.max(p.x, rx) > 2
                && yy > p.y - p.h / 2 - 0.6 && yy < p.y + p.h / 2 + 0.6) return true;
            }
            return false;
          };
          /* find a corridor row near dy0 for a given (rx, dr) pair, scanning
             both directions — a one-sided upward scan dead-ends when the row
             just above the gate is taken by another net's corridor even
             though rows further up or below the wire are free; the row must
             clear bodies, pins, other nets' corridors and endpoints, and
             both detour verticals must be clean */
          const scanDy = (rx, dr) => {
            const dySeen = new Set();
            for (let st = 0; st <= 64; st += 8) {
              const sgns = st === 0 ? [1] : [1, -1];
              for (let q = 0; q < sgns.length; q++) {
                const cand = dy0 + st * sgns[q];
                if (cand < 8 || cand > height - 8 || dySeen.has(cand)) continue;
                dySeen.add(cand);
                let why = null;
                if (bodyStrict(cand, rx, dr)) why = 'bodyStrict';
                else if (hBlockers(cand, rx, dr, skip, allowDst).length) why = 'hBlockers';
                else if (conflictAt(cand, rx, dr)) why = 'conflictAt';
                else if (!vClean(rx, L.y, cand)) why = 'vCleanRise';
                else if (!vClean(dr, L.y, cand)) why = 'vCleanDrop';
                else if (epTaken(rx, L.y, skip)) why = 'epRiseY';
                else if (epTaken(dr, L.y, skip)) why = 'epDropY';
                else if (epTaken(rx, cand, skip)) why = 'epRiseC';
                else if (epTaken(dr, cand, skip)) why = 'epDropC';
                if (why) continue;
                return cand;
              }
            }
            /* fine outward fallback — stacked gates can leave a free window
               only a few px tall (e.g. bands 30..130 and 152..252 leave
               131..151) that the ±8 stride never hits; scan every row */
            const ok = (yy) => !(bodyStrict(yy, rx, dr)
              || hBlockers(yy, rx, dr, skip, allowDst).length
              || conflictAt(yy, rx, dr)
              || !vClean(rx, L.y, yy) || !vClean(dr, L.y, yy)
              || epTaken(rx, L.y, skip) || epTaken(dr, L.y, skip)
              || epTaken(rx, yy, skip) || epTaken(dr, yy, skip));
            for (let d = 0; d <= height; d++) {
              const up = dy0 + d, dn = dy0 - d;
              if (up <= height - 8 && ok(up)) return up;
              if (dn >= 8 && dn !== up && ok(dn)) return dn;
            }
            return -1;
          };
          let rx = riseX, dr = drX;
          let dy = scanDy(rx, dr);
          if (dy < 0) {
            /* the canonical riser/drop columns can be walled for every row
               by another net's long vertical sharing the same channel; nudge
               either column to a neighbour x and re-scan */
            const tries = [];
            for (const d of [0, -3, 3, -6, 6, -9, 9, -12, 12, -15, 15]) tries.push([riseX + d, drX]);
            for (const d of [3, -3, 6, -6, 9, -9, 12, -12]) tries.push([riseX, drX + d]);
            for (const dl of [-3, 3, -6, 6]) for (const ddr of [3, -3, 6, -6])
              tries.push([riseX + dl, drX + ddr]);
            for (let ti = 0; ti < tries.length && dy < 0; ti++) {
              const rx2 = tries[ti][0], dr2 = tries[ti][1];
              if (rx2 < L.x1 + 2 || dr2 > L.x2 || dr2 - rx2 < 6) continue;
              const got = scanDy(rx2, dr2);
              if (got >= 0) { rx = rx2; dr = dr2; dy = got; }
            }
          }
          if (dy < 0) continue;
          const repl = [];
          if (rx - L.x1 > 2) repl.push({ x1: L.x1, y: L.y, x2: rx });
          repl.push({ x1: rx, y: L.y, x2: dr, via: dy });
          if (L.x2 - dr > 0.5) repl.push({ x1: dr, y: L.y, x2: L.x2 });
          legs.splice(k, 1, ...repl);
          k += repl.length - 1;
        }
      };
      deconflict();
      applyBlockers();
      deconflict();
      applyBlockers();
      return legs.map(L => L.via == null
        ? 'H ' + f(L.x2)
        : 'V ' + f(L.via) + ' H ' + f(L.x2) + ' V ' + f(L.y)).join(' ');
    };
    const wires = []; // {src, d}
    const dots = [];
    const dotKeys = new Set();
    const addDot = (x, y) => {
      const k = f(x) + ',' + f(y);
      if (dotKeys.has(k)) return;
      dotKeys.add(k);
      dots.push([x, y]);
    };
    /* join path fragments, dropping empties so no dangling/blank commands
       ever reach the SVG path parser */
    const dstr = (...parts) => parts.filter(p => p && p.trim()).join(' ');
    const pushWire = (src, d) => {
      if (nodes[src].type === 'IN' && bySrc.get(src).length === 1 && !rootIds.has(src)) {
        const t = d.split(' '), p = pos.get(src), x = f(p.x + 6);
        if (t[3] === 'H' && t[5] === 'V' && t[7] === 'H' && +t[4] > x && +t[8] > +t[4]) {
          const y = +t[6], endX = +t[4], box = inputBox(src, p.x, y);
          const clear = y >= 14 && y <= height - 14
            && !labelBoxes.some(b => b.input !== src && overlaps(box, b))
            && !hBlockers(y, x, endX).length
            && !pinPts.some(q => Math.abs(q.y - y) < 4 && q.x >= x - 4 && q.x <= endX + 4)
            && !usedH.some(u => u.src !== src && (
              overlaps(box, { x1: u.x1, x2: u.x2, y1: u.y - 1, y2: u.y + 1 })
              || (Math.abs(u.y - y) < 8 && u.x2 >= x && u.x1 <= endX)))
            && !usedV.some(u => u.src !== src && (
              overlaps(box, { x1: u.x - 1, x2: u.x + 1, y1: u.y1, y2: u.y2 })
              || (u.x >= x && u.x <= endX && y >= u.y1 && y <= u.y2
                && Math.min(u.x - x, endX - u.x, y - u.y1, u.y2 - y) < 4)));
          if (clear) {
            p.y = y;
            Object.assign(labelBoxes.find(b => b.input === src), { ...box, x2: p.x - 2 });
            d = dstr('M ' + x + ' ' + y, t.slice(7).join(' '));
          }
        }
      }
      wires.push({ src, d });
      registerWire(src, d);
    };
    const compactPoints = points => {
      const out = [];
      points.forEach(p => {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.05 && Math.abs(last.y - p.y) < 0.05) return;
        while (out.length > 1) {
          const a = out[out.length - 2], b = out[out.length - 1];
          if (a.x !== b.x || b.x !== p.x) {
            if (a.y !== b.y || b.y !== p.y) break;
          }
          out.pop();
        }
        out.push(p);
      });
      return out;
    };
    const pathData = points => points.map((p, i) => i === 0
      ? 'M ' + f(p.x) + ' ' + f(p.y)
      : (p.y === points[i - 1].y ? 'H ' + f(p.x) : 'V ' + f(p.y))).join(' ');
    const simpleRoute = (src, start, t, skip, branch) => {
      const end = { x: t.x, y: t.y + t.below };
      const candidates = [];
      const consider = points => {
        if (t.below) points.push({ x: t.x, y: t.y });
        const ps = compactPoints(points);
        if (ps.length < 2) return;
        if (!branch && (ps[1].y !== start.y || ps[1].x < start.x + 12)) return;
        const last = ps[ps.length - 2];
        if (t.below ? last.x !== t.x || last.y < t.y + 12 : last.y !== t.y || last.x > pos.get(t.dst).x - 8) return;
        let length = 0, crossings = 0;
        for (let i = 1; i < ps.length; i++) {
          const a = ps[i - 1], b = ps[i], horizontal = a.y === b.y;
          const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
          const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
          const landing = i === ps.length - 1 ? new Set([t.dst]) : null;
          if (horizontal) {
            if (hBlockers(a.y, lo, hi, skip, landing).length) return;
            for (const u of usedH) {
              if (u.src !== src && Math.abs(u.y - a.y) < 8 && Math.min(hi, u.x2) - Math.max(lo, u.x1) > 0.1) return;
            }
            for (const u of usedV) {
              if (u.src === src || u.x < lo || u.x > hi || a.y < u.y1 || a.y > u.y2) continue;
              if (Math.min(u.x - lo, hi - u.x, a.y - u.y1, u.y2 - a.y) < 4) return;
              crossings++;
            }
          } else {
            if (!vClean2(a.x, lo, hi, landing, skip)) return;
            for (const u of usedV) {
              if (u.src !== src && Math.abs(u.x - a.x) < 8 && Math.min(hi, u.y2) - Math.max(lo, u.y1) > 0.1) return;
            }
            for (const u of usedH) {
              if (u.src === src || u.y < lo || u.y > hi || a.x < u.x1 || a.x > u.x2) continue;
              if (Math.min(u.y - lo, hi - u.y, a.x - u.x1, u.x2 - a.x) < 4) return;
              crossings++;
            }
          }
          if (epTaken(b.x, b.y, skip)) return;
          length += hi - lo;
          if (branch) {
            const covered = (horizontal ? usedH : usedV)
              .filter(u => u.src === src && Math.abs((horizontal ? u.y - a.y : u.x - a.x)) < 0.05)
              .map(u => [Math.max(lo, horizontal ? u.x1 : u.y1), Math.min(hi, horizontal ? u.x2 : u.y2)])
              .filter(([l, r]) => r > l).sort((u, v) => u[0] - v[0]);
            let end = lo;
            covered.forEach(([l, r]) => { length -= Math.max(0, r - Math.max(l, end)); end = Math.max(end, r); });
          }
        }
        candidates.push({ ps, score: (ps.length - 2) * 80 + length + crossings * 12 });
      };
      if (start.y === end.y) consider([start, end]);
      const xs = [];
      const left = start.x + (branch ? 0 : 18);
      const right = Math.min(t.below ? t.edge - 18 : pos.get(t.dst).x - 18, end.x - 12);
      for (let x = left; x <= right; x += TRACK) xs.push(x);
      if (right >= left) xs.push(right);
      xs.forEach(x => consider([start, { x, y: start.y }, { x, y: end.y }, end]));
      if (!candidates.length) {
        const rows = new Set([start.y, end.y]);
        pos.forEach(p => {
          rows.add(p.y - p.h / 2 - 18);
          rows.add(p.y + p.h / 2 + (p.gate ? 30 : 18));
        });
        labelBoxes.forEach(b => { rows.add(b.y1 - 8); rows.add(b.y2 + 8); });
        for (let y = 12; y < topMargin; y += TRACK) rows.add(y);
        const riseXs = xs.slice(0, 5), dropXs = xs.slice(-5);
        for (const y of rows) {
          if (y < 8 || y > height - 8) continue;
          for (const x1 of riseXs) for (const x2 of dropXs) {
            if (x2 - x1 < TRACK) continue;
            consider([start, { x: x1, y: start.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: end.y }, end]);
          }
        }
      }
      candidates.sort((a, b) => a.score - b.score);
      return candidates.length ? pathData(candidates[0].ps) : null;
    };
    bySrc.forEach((list, src) => {
      curSrc = src;
      const s = outPin(src);
      if (!s) return;
      const lane = laneOf.get(src) || 0;
      const ts = list.map(e => ({ pin: e.pin, dst: e.dst })).filter(e => e.pin)
        .map(e => ({ x: e.pin.x, y: e.pin.y, below: e.pin.below || 0, edge: e.pin.edge, dst: e.dst }))
        .sort((a, b) => (a.y + a.below) - (b.y + b.below) || a.x - b.x);
      if (!ts.length) return;
      const skip = new Set(list.map(e => e.dst));
      const cap = t => (t.below ? t.edge - 8 : null);
      if (ts.length === 1) {
        const t = ts[0];
        const simple = simpleRoute(src, s, t, skip, false);
        if (simple) { pushWire(src, simple); return; }
        const ad = new Set([t.dst]);
        const jy = t.y + t.below;
        if (Math.abs(s.y - jy) < 0.25 && rowFree(src, jy, s.x, t.x, skip, ad)) {
          pushWire(src, dstr('M ' + f(s.x) + ' ' + f(s.y), hRun(s.x, s.y, t.x, skip, cap(t), lane, ad),
            (t.below ? 'V ' + f(t.y) : '')));
        } else {
          /* the approach vertical must not slice through a gate body
             (e.g. an XNOR bounding box extends past its output pin), run
             parallel-close to another net's vertical, or pass through a
             foreign pin — step it right until clean; lane overflow in a
             crowded column can push mx past the pin, so clamp it back */
          let mx = s.x + 18 + lane * TRACK;
          const mxOk = x => vClean2(x, s.y, jy, ad, skip)
            && !epTaken(x, jy, skip) && !epTaken(x, s.y, skip);
          while (mx < t.x - 12 && !mxOk(mx)) mx += 9;
          if (mx > t.x - 12 || !mxOk(mx)) {
            const slot = fineSlot(s.x + 18, t.x - 12, mxOk);
            if (slot >= 0) mx = slot;
          }
          if (mx > t.x) mx = t.x;
          /* pick the corridor row: the pin's own approach row when it is
             clean, otherwise the nearest clean row; a final V t.y then
             guarantees the wire lands exactly on the pin */
          let Y = null;
          const offs = [0, 4, -4, 8, -8, 12, -12, 16, -16, 20, -20, 24, -24, 28, -28, 32, -32];
          for (let k = 0; k < offs.length; k++) {
            const ay = jy + offs[k];
            if (ay < 8 || ay > height - 8) continue;
            if (epTaken(mx, ay, skip)) continue;
            if (!vClean2(mx, s.y, ay, ad, skip)) continue;
            if (Math.abs(ay - t.y) > 0.05 && !vClean2(mx, ay, t.y, ad, skip)) continue;
            if (!rowFree(src, ay, mx, t.x, skip, ad)) continue;
            if (Math.abs(ay - t.y) > 0.05 && !vClean2(t.x, ay, t.y, ad, skip)) continue;
            Y = ay; break;
          }
          if (Y == null) Y = jy;
          const base = dstr('M ' + f(s.x) + ' ' + f(s.y),
            hRun(s.x, s.y, mx, skip, null, lane, ad),
            Math.abs(Y - s.y) > 0.05 ? 'V ' + f(Y) : '');
          /* left-edge pins need a horizontal landing at the pin row: a final
             vertical drop at t.x would hug the gate's edge, or slice through
             an OR-family bounding box; bottom-edge (below) pins keep the
             vertical landing, which meets the edge cleanly from underneath */
          if (Math.abs(Y - t.y) > 0.05 && !t.below) {
            let xr = null;
            const p = pos.get(t.dst);
            const fam = !p.output && isOrType(nodes[t.dst].type);
            /* fine descending scan — the shortest clean stub wins; a strided
               grid misses valid slots, e.g. when a corridor row ends just
               off the pin row so exactly one landing x keeps clearance from
               both that row's end and the next net's corner */
            for (let cx = Math.round((t.x - 4) * 2) / 2; cx >= mx + 2; cx -= 1) {
              if (fam && p && cx > p.x - 1.5) continue;
              if (!vClean2(cx, Y, t.y, ad, skip)) continue;
              if (hBlockers(t.y, cx, t.x, skip, ad).length) continue;
              if (epTaken(cx, Y, skip)) continue;
              if (epTaken(cx, t.y, skip)) continue;
              let bad = false;
              for (let i = 0; i < usedH.length && !bad; i++) {
                const u = usedH[i];
                if (u.src === src) continue;
                if (Math.abs(u.y - t.y) < 3 && Math.min(u.x2, t.x) - Math.max(u.x1, cx) > 1) bad = true;
              }
              if (bad) continue;
              xr = cx; break;
            }
            if (xr != null) {
              pushWire(src, dstr(base, hRun(mx, Y, xr, skip, null, lane, ad),
                'V ' + f(t.y), 'H ' + f(t.x)));
            } else {
              pushWire(src, dstr(base, hRun(mx, Y, t.x, skip, cap(t), lane, ad),
                'V ' + f(t.y)));
            }
          } else {
            pushWire(src, dstr(base, hRun(mx, Y, t.x, skip, cap(t), lane, ad),
              Math.abs(Y - t.y) > 0.05 ? 'V ' + f(t.y) : ''));
          }
        }
      } else {
        const jys = ts.map(t => t.y + t.below);
        const yMin = Math.min(s.y, Math.min.apply(null, jys));
        const yMax = Math.max(s.y, Math.max.apply(null, jys));
        const minTx = Math.min.apply(null, ts.map(t => t.x));
        let trunkX = list.every(e => pos.get(e.dst).output)
          ? Math.max(s.x + 18, minTx - 36 - lane * TRACK) : s.x + 18 + lane * TRACK;
        const trOk = x => vClean2(x, yMin, yMax, null, skip)
          && !usedV.some(u => u.src !== src && Math.abs(u.x - x) < TRACK
            && Math.min(yMax, u.y2) - Math.max(yMin, u.y1) > 0.1)
          && !epTaken(x, yMin, skip) && !epTaken(x, yMax, skip) && !epTaken(x, s.y, skip);
        while (trunkX < minTx - 12 && !trOk(trunkX)) trunkX += 9;
        if (trunkX > minTx - 12 || !trOk(trunkX)) {
          const slot = fineSlot(s.x + 18, minTx - 12, trOk);
          if (slot >= 0) trunkX = slot;
        }
        if (trunkX > minTx) trunkX = minTx;
        pushWire(src, dstr('M ' + f(s.x) + ' ' + f(s.y),
          hRun(s.x, s.y, trunkX, skip, null, lane, null),
          'V ' + f(yMin), 'V ' + f(yMax)));
        ts.forEach((t, k) => {
          const jy = jys[k];
          const simple = simpleRoute(src, { x: trunkX, y: jy }, t, skip, true);
          if (simple) { pushWire(src, simple); return; }
          const hr = hRun(trunkX, jy, t.x, skip, cap(t), lane, new Set([t.dst]));
          /* a fully clamped trunk can sit exactly on the tap pin's x, leaving
             no horizontal to route — the trunk vertical already passes through
             the tap point, so an M-only path would be a dangling stub */
          if (!hr && !t.below) return;
          pushWire(src, dstr('M ' + f(trunkX) + ' ' + f(jy), hr,
            (t.below ? 'V ' + f(t.y) : '')));
        });
      }
    });
    curSrc = null;

    // Prune only nonterminal leaves, so removing a detour tail cannot disconnect a pin.
    const cleaned = [];
    bySrc.forEach((list, src) => {
      const segments = [], points = new Map();
      const point = (x, y) => {
        const key = f(x) + ',' + f(y);
        if (!points.has(key)) points.set(key, { x: f(x), y: f(y), next: new Set(), terminal: false });
        return points.get(key);
      };
      wires.filter(w => w.src === src).forEach(w => {
        const toks = w.d.split(' ');
        let a = point(+toks[1], +toks[2]);
        for (let i = 3; i + 1 < toks.length; i += 2) {
          const b = toks[i] === 'H' ? point(+toks[i + 1], a.y) : point(a.x, +toks[i + 1]);
          if (a !== b) segments.push({ a, b, horizontal: a.y === b.y });
          a = b;
        }
      });
      const source = outPin(src);
      point(source.x, source.y).terminal = true;
      list.forEach(e => { point(e.pin.x, e.pin.y).terminal = true; });
      const contains = (s, p) => s.horizontal
        ? p.y === s.a.y && p.x >= Math.min(s.a.x, s.b.x) && p.x <= Math.max(s.a.x, s.b.x)
        : p.x === s.a.x && p.y >= Math.min(s.a.y, s.b.y) && p.y <= Math.max(s.a.y, s.b.y);
      segments.filter(s => s.horizontal).forEach(h => {
        segments.filter(s => !s.horizontal).forEach(v => {
          const p = { x: v.a.x, y: h.a.y };
          if (contains(h, p) && contains(v, p)) point(p.x, p.y);
        });
      });
      segments.forEach(s => {
        const ps = [...points.values()].filter(p => contains(s, p));
        ps.sort((a, b) => s.horizontal ? a.x - b.x : a.y - b.y);
        for (let i = 1; i < ps.length; i++) {
          ps[i - 1].next.add(ps[i]);
          ps[i].next.add(ps[i - 1]);
        }
      });
      const leaves = [...points.values()].filter(p => !p.terminal && p.next.size === 1);
      while (leaves.length) {
        const p = leaves.pop();
        if (p.next.size !== 1) continue;
        const q = [...p.next][0];
        p.next.clear();
        q.next.delete(p);
        if (!q.terminal && q.next.size === 1) leaves.push(q);
      }
      points.forEach(p => { if (p.next.size >= 3 && !p.terminal) addDot(p.x, p.y); });
      const drawn = new Map();
      const seen = (a, b) => drawn.get(a)?.has(b);
      const mark = (a, b) => {
        if (!drawn.has(a)) drawn.set(a, new Set());
        if (!drawn.has(b)) drawn.set(b, new Set());
        drawn.get(a).add(b);
        drawn.get(b).add(a);
      };
      points.forEach(a => a.next.forEach(b => {
        if (seen(a, b)) return;
        const ps = [a, b];
        mark(a, b);
        let prev = a, curr = b;
        while (curr.next.size === 2 && !curr.terminal) {
          const next = [...curr.next].find(p => p !== prev);
          if (seen(curr, next)) break;
          mark(curr, next);
          ps.push(next);
          prev = curr;
          curr = next;
        }
        cleaned.push({ src, d: pathData(compactPoints(ps)) });
      }));
    });
    wires.splice(0, wires.length, ...cleaned);
    if (wires.length) svg.push('<path class="gl" d="' + wires.map(w => w.d).join(' ') + '"/>');
    if (dots.length) svg.push('<g>' + dots.map(d => '<circle class="dot" cx="' + f(d[0]) + '" cy="' + f(d[1]) + '" r="2.6"/>').join('') + '</g>');

    /* nodes */
    ids.forEach(id => {
      const p = pos.get(id), nd = nodes[id];
      if (nd.type === 'IN') {
        svg.push('<circle class="term" cx="' + (p.x + 6) + '" cy="' + p.y + '" r="3.2"/>');
        svg.push('<text x="' + (p.x - 6) + '" y="' + (p.y + 4) + '" text-anchor="end" class="lbl">' + esc(nd.label) + '</text>');
      } else if (nd.type === 'CONST0' || nd.type === 'CONST1') {
        svg.push('<rect class="gb" x="' + p.x + '" y="' + (p.y - 10) + '" width="26" height="20" rx="4"/>');
        svg.push('<text x="' + (p.x + 13) + '" y="' + (p.y + 4) + '" text-anchor="middle" class="lbl">' + (nd.type === 'CONST1' ? '1' : '0') + '</text>');
      } else {
        svg.push(gateSvg(nd, p));
      }
    });

    outputPorts.forEach(port => {
      const p = pos.get(port.dst);
      svg.push('<circle class="term" cx="' + p.x + '" cy="' + p.y + '" r="3.2"/>');
      svg.push('<text x="' + (p.x + 10) + '" y="' + (p.y + 4) + '" class="olbl">' + esc(port.label) + '</text>');
    });

    svg.push('</svg>');
    return { svg: svg.join('\n'), width, height, stats: netStats(nodes, reach, roots) };
    function gateSvg(nd, p) {
      const g = GATE[nd.type];
      const x = p.x, yc = p.y, h = p.h, w = p.w;
      const bw = g.w;
      const xo = g.xorCurve ? 10 : 0;
      const top = yc - h / 2, r = h / 2;
      const isOr = isOrType(nd.type);
      let s = '';
      if (g.tri) {
        s += '<path class="gb" d="M ' + f(x) + ' ' + f(top) + ' L ' + f(x + bw) + ' ' + f(yc) + ' L ' + f(x) + ' ' + f(top + h) + ' Z"/>';
      } else if (g.mux) {
        const nSel = muxSelCount(nd);
        const dataN = nd.ins.length - nSel;
        s += '<path class="gb" d="M ' + f(x) + ' ' + f(top) + ' L ' + f(x + bw) + ' ' + f(top + 7) + ' L ' + f(x + bw) + ' ' + f(top + h - 7) + ' L ' + f(x) + ' ' + f(top + h) + ' Z"/>';
        s += '<text x="' + f(x + bw / 2) + '" y="' + f(top + 14) + '" text-anchor="middle" class="gt">MUX</text>';
        const ys = pinYs(nd.type, dataN);
        for (let j = 0; j < dataN; j++) {
          const code = (dataN - 1 - j).toString(2).padStart(nSel, '0');
          s += '<text x="' + f(x + 7) + '" y="' + f(yc + ys[j] + 3.5) + '" class="gt">' + code + '</text>';
        }
      } else if (isOr) {
        /* concave back: the left arc bows into the gate (to the right) */
        const xb = x + xo;
        s += '<path class="gb" d="M ' + f(xb) + ' ' + f(top)
          + ' Q ' + f(xb + 0.62 * bw) + ' ' + f(top) + ' ' + f(xb + bw) + ' ' + f(yc)
          + ' Q ' + f(xb + 0.62 * bw) + ' ' + f(top + h) + ' ' + f(xb) + ' ' + f(top + h)
          + ' Q ' + f(xb + 0.34 * bw) + ' ' + f(yc) + ' ' + f(xb) + ' ' + f(top) + ' Z"/>';
        if (g.xorCurve) {
          s += '<path class="gc" d="M ' + f(x) + ' ' + f(top) + ' Q ' + f(x + 0.34 * bw) + ' ' + f(yc) + ' ' + f(x) + ' ' + f(top + h) + '"/>';
        }
      } else { /* AND family */
        const ra = Math.min(r, bw - 6);
        s += '<path class="gb" d="M ' + f(x) + ' ' + f(top) + ' L ' + f(x + bw - ra) + ' ' + f(top) + ' A ' + f(ra) + ' ' + f(r) + ' 0 0 1 ' + f(x + bw - ra) + ' ' + f(top + h) + ' L ' + f(x) + ' ' + f(top + h) + ' Z"/>';
      }
      if (g.bubble) {
        s += '<circle class="bb" cx="' + f(x + xo + bw + 5) + '" cy="' + f(yc) + '" r="5"/>';
      }
      if (!g.mux && nd.type !== 'BUF') {
        s += '<text x="' + f(x + w / 2) + '" y="' + f(yc + h / 2 + 14) + '" text-anchor="middle" class="gt">' + nd.type + '</text>';
      }
      return s;
    }
    function esc(t) {
      return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  function netStats(nodes, reach, roots) {
    let gates = 0, wires = 0, maxLv = 0;
    const types = {};
    const level = computeLevels(nodes, [...reach]);
    reach.forEach(id => {
      const nd = nodes[id];
      if (nd.type === 'IN' || nd.type === 'CONST0' || nd.type === 'CONST1') return;
      gates++;
      wires += nd.ins.length;
      types[nd.type] = (types[nd.type] || 0) + 1;
      maxLv = Math.max(maxLv, level.get(id));
    });
    return { gates, wires, levels: maxLv, types };
  }

  /* ---------------------------------------------------------- *
   *  Browser UI wiring                                          *
   * ---------------------------------------------------------- */
  const CORE = { bitsOf, minimizeSOP, coverSOP, anfCoefficients, mergeXorPair, makeBuilder, synthesize, renderSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof window !== 'undefined') window.ICLogic = CORE;

  if (typeof document === 'undefined') return;

  const MAX_IO = 8;
  const GATE_LIST = ['NAND', 'NOR', 'INV', 'AND', 'OR', 'XOR', 'XNOR'];

  const state = {
    inputs: ['IN1', 'IN2'],
    outputs: ['OUT1'],
    vals: [],   // vals[row][outIdx], '0'|'1'
    nRows: 0
  };

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  function init() {
    buildGateChips();
    renderSignalList('in');
    renderSignalList('out');
    rebuildTable(true);
    $('#add-in').addEventListener('click', () => addSignal('in'));
    $('#add-out').addEventListener('click', () => addSignal('out'));
    $('#select-all-gates').addEventListener('click', () => setGateSelection(true));
    $('#clear-gates').addEventListener('click', () => setGateSelection(false));
    $('#dl-excel').addEventListener('click', downloadExcel);
    $('#generate').addEventListener('click', onGenerate);
    $('#dl-svg').addEventListener('click', downloadSvg);
    $('#dl-png').addEventListener('click', downloadPng);
  }

  /* ---- gate chips ---- */
  function buildGateChips() {
    const box = $('#gate-chips');
    box.innerHTML = '';
    GATE_LIST.forEach(g => {
      const id = 'gate-' + g;
      const wrap = document.createElement('span');
      wrap.className = 'gate-chip';
      wrap.innerHTML = '<input type="checkbox" id="' + id + '" checked>'
        + '<label for="' + id + '">' + g + '</label>';
      box.appendChild(wrap);
    });
  }
  function selectedLib() {
    const lib = new Set();
    GATE_LIST.forEach(g => {
      const el = $('#gate-' + g);
      if (el && el.checked) lib.add(g);
    });
    return lib;
  }
  function setGateSelection(checked) {
    GATE_LIST.forEach(g => { $('#gate-' + g).checked = checked; });
  }

  /* ---- signal editors ---- */
  function renderSignalList(kind) {
    const list = kind === 'in' ? $('#in-list') : $('#out-list');
    const arr = kind === 'in' ? state.inputs : state.outputs;
    list.innerHTML = '';
    arr.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'sig-row';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = name;
      inp.maxLength = 12;
      inp.spellcheck = false;
      inp.addEventListener('input', () => {
        arr[i] = inp.value;
        const thIdx = kind === 'in' ? (i + 1) : (state.inputs.length + i + 1);
        const th = document.querySelector('#tt-container thead th:nth-child(' + thIdx + ')');
        if (th) th.textContent = inp.value || '?';
      });
      const btn = document.createElement('button');
      btn.className = 'btn-mini';
      btn.textContent = '×';
      btn.title = 'Delete';
      btn.disabled = arr.length <= 1;
      btn.addEventListener('click', () => {
        arr.splice(i, 1);
        renderSignalList(kind);
        rebuildTable(true);
      });
      row.appendChild(inp);
      row.appendChild(btn);
      list.appendChild(row);
    });
  }
  function addSignal(kind) {
    const arr = kind === 'in' ? state.inputs : state.outputs;
    if (arr.length >= MAX_IO) return;
    const base = kind === 'in' ? 'IN' : 'OUT';
    let i = arr.length + 1;
    let name = base + i;
    while (arr.includes(name)) { i++; name = base + i; }
    arr.push(name);
    renderSignalList(kind);
    rebuildTable(true);
  }

  /* ---- truth table ---- */
  function syncValsFromDom() {
    const nOut = state.outputs.length;
    const vals = [];
    for (let r = 0; r < state.nRows; r++) {
      vals[r] = [];
      for (let o = 0; o < nOut; o++) vals[r][o] = '0';
    }
    $$('#tt-container button.tt-toggle').forEach(el => {
      const r = +el.dataset.row, o = +el.dataset.out;
      let v = el.textContent.trim();
      if (v !== '0' && v !== '1') v = '0';
      if (r < vals.length && o < nOut) vals[r][o] = v;
    });
    state.vals = vals;
  }

  function onCellToggle(btn) {
    const r = +btn.dataset.row, o = +btn.dataset.out;
    if (!state.vals[r]) return;
    const nv = state.vals[r][o] === '1' ? '0' : '1';
    state.vals[r][o] = nv;
    btn.textContent = nv;
    btn.classList.toggle('on', nv === '1');
  }

  function rebuildTable(preserve) {
    if (preserve) syncValsFromDom();
    const nIn = state.inputs.length;
    const nOut = state.outputs.length;
    const rows = 1 << nIn;
    const old = state.vals;
    const oldRows = old.length;
    const oldNIn = oldRows ? Math.round(Math.log2(oldRows)) : 0;
    const oldNOut = oldRows && old[0] ? old[0].length : 0;
    const vals = [];
    for (let r = 0; r < rows; r++) {
      // Map this row's input combo onto the previous table:
      // added inputs sit at the end (LSB), so they are dropped here;
      // on input deletion the combo maps as if the last input was removed.
      let src = null;
      if (preserve && oldRows) {
        if (nIn === oldNIn) src = r;
        else if (nIn > oldNIn) src = r >> (nIn - oldNIn);
        else src = r << (oldNIn - nIn);
        if (src >= oldRows) src = null;
      }
      vals[r] = [];
      for (let o = 0; o < nOut; o++) {
        vals[r][o] = (src != null && o < oldNOut && old[src][o] != null) ? old[src][o] : '0';
      }
    }
    state.vals = vals;
    state.nRows = rows;

    const hint = $('#tt-hint');
    if (hint) hint.textContent = rows + ' rows (2^' + nIn + ' input combinations). Click a cell to toggle between 0 and 1.';

    const container = $('#tt-container');
    let html = '<table class="tt"><thead><tr>';
    state.inputs.forEach(n => html += '<th class="in-col">' + esc(n || '?') + '</th>');
    state.outputs.forEach(n => html += '<th class="out-col">' + esc(n || '?') + '</th>');
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      const bits = bitsOf(r, nIn);
      bits.forEach(b => html += '<td class="in-cell">' + b + '</td>');
      for (let o = 0; o < nOut; o++) {
        html += '<td class="out-cell"><button type="button" class="tt-toggle' + (vals[r][o] === '1' ? ' on' : '') + '" data-row="' + r + '" data-out="' + o + '">' + vals[r][o] + '</button></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
    if (!container.dataset.toggleBound) {
      container.dataset.toggleBound = '1';
      container.addEventListener('click', e => {
        const btn = e.target.closest('.tt-toggle');
        if (btn) onCellToggle(btn);
      });
    }
  }

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---- validation ---- */
  function validateSignals() {
    const all = [...state.inputs, ...state.outputs];
    const names = [];
    const re = /^[A-Za-z_][A-Za-z0-9_]*$/;
    for (let i = 0; i < all.length; i++) {
      const n = all[i].trim();
      if (!n) return { ok: false, msg: 'Signal name at position ' + (i + 1) + ' is empty. Please name every signal.' };
      if (!re.test(n)) return { ok: false, msg: 'Invalid signal name "' + n + '". Use letters, digits, underscore; start with a letter or underscore.' };
      if (names.includes(n)) return { ok: false, msg: 'Duplicate signal name "' + n + '". Signal names must be unique.' };
      names.push(n);
    }
    if (state.inputs.length > MAX_IO) return { ok: false, msg: 'Too many inputs (max ' + MAX_IO + ').' };
    if (state.outputs.length > MAX_IO) return { ok: false, msg: 'Too many outputs (max ' + MAX_IO + ').' };
    return { ok: true, names };
  }

  function readTable(nOut) {
    syncValsFromDom();
    const vals = [];
    for (let r = 0; r < state.nRows; r++) {
      vals[r] = [];
      for (let o = 0; o < nOut; o++) vals[r][o] = state.vals[r][o] === '1' ? '1' : '0';
    }
    return { ok: true, vals };
  }

  /* ---- generate ---- */
  let lastResult = null;

  function onGenerate() {
    hideError();
    $('#result-panel').classList.add('hidden');
    lastResult = null;

    const sig = validateSignals();
    if (!sig.ok) return showError('Invalid signals', sig.msg, []);

    const lib = selectedLib();
    if (lib.size === 0) return showError('No gates selected', 'Choose at least one gate type in Step 2.', []);

    const table = readTable(state.outputs.length);
    if (!table.ok) return showError('Invalid truth table', table.msg, []);

    const nIn = state.inputs.length;
    const nOut = state.outputs.length;
    const inNames = state.inputs.map(s => s.trim());
    const outNames = state.outputs.map(s => s.trim());
    const rows = state.nRows;

    const b = makeBuilder();
    const inIds = inNames.map(nm => b.input(nm));
    const roots = [];
    const exprRows = [];

    try {
      for (let o = 0; o < nOut; o++) {
        const on = [];
        for (let r = 0; r < rows; r++) if (table.vals[r][o] === '1') on.push(r);
        const res = synthesize(on, nIn, inIds, lib, b, inNames);
        roots.push({ id: res.id, label: outNames[o] });
        exprRows.push({ name: outNames[o], res, onCount: on.length });
      }
    } catch (e) {
      const where = exprRows.length;
      const title = where < nOut
        ? 'Cannot generate output "' + outNames[where] + '"'
        : 'Cannot generate circuit';
      return showError(title, e.message || 'Synthesis failed.', e.reasons || []);
    }

    const rendered = renderSvg(b, roots, inNames);
    lastResult = { builder: b, roots, inNames };

    /* expressions */
    const rc = $('#result-container');
    let html = '';
    exprRows.forEach(er => {
      const body = er.onCount === 0 ? '0'
        : er.onCount === rows ? '1'
        : exprHtml(er.res.display, inNames);
      const text = er.onCount === 0 ? '0'
        : er.onCount === rows ? '1'
        : exprText(er.res.display, inNames);
      html += '<div class="expr-row"><div class="expr-name">' + esc(er.name) + '</div>'
        + '<div class="expr-eq">=</div>'
        + '<div class="expr-html">' + body + '</div>'
        + '<div class="expr-ascii">' + esc(text) + '</div>'
        + '<div class="expr-path">' + esc(er.res.path) + '</div></div>';
    });
    rc.innerHTML = html;

    /* global stats */
    const st = rendered.stats;
    const typeChips = Object.keys(st.types).sort().map(t =>
      '<span class="stat-chip">' + t + ' × ' + st.types[t] + '</span>').join('');
    $('#global-stats').innerHTML =
      '<span class="stat-chip">gates: ' + st.gates + '</span>'
      + '<span class="stat-chip">wires: ' + st.wires + '</span>'
      + '<span class="stat-chip">levels: ' + st.levels + '</span>'
      + typeChips;

    $('#circuit-box').innerHTML = rendered.svg;
    const rp = $('#result-panel');
    rp.removeAttribute('hidden');
    rp.classList.remove('hidden');
    rp.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showError(title, msg, reasons) {
    const box = $('#error-container');
    let html = '<div class="error-box"><div class="error-title">Error: ' + esc(title) + '</div>'
      + '<div class="error-msg">' + esc(msg) + '</div>';
    if (reasons && reasons.length) {
      html += '<ul class="error-reasons">' + reasons.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>';
    }
    html += '</div>';
    box.innerHTML = html;
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function hideError() {
    const box = $('#error-container');
    box.classList.add('hidden');
    box.innerHTML = '';
  }

  function downloadExcel() {
    syncValsFromDom();
    const quote = value => {
      const text = String(value);
      const safe = /^\s*[=+\-@]/.test(text) ? "'" + text : text;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const rows = [[...state.inputs, ...state.outputs]];
    state.vals.forEach((values, row) => {
      rows.push([...bitsOf(row, state.inputs.length), ...values]);
    });
    const csv = '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'truth-table.csv');
  }

  function downloadSvg() {
    if (!lastResult) return;
    const rendered = renderSvg(lastResult.builder, lastResult.roots, lastResult.inNames, { forDownload: true });
    downloadBlob(new Blob([rendered.svg], { type: 'image/svg+xml' }), 'circuit.svg');
  }

  function downloadPng() {
    if (!lastResult) return;
    const rendered = renderSvg(lastResult.builder, lastResult.roots, lastResult.inNames, { forDownload: true });
    const svgUrl = URL.createObjectURL(new Blob([rendered.svg], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = rendered.width * scale;
      canvas.height = rendered.height * scale;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob(blob => {
        if (blob) downloadBlob(blob, 'circuit.png');
        else showError('PNG export failed', 'The circuit image could not be encoded.');
      }, 'image/png');
    };
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      showError('PNG export failed', 'The circuit image could not be rendered.');
    };
    image.src = svgUrl;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
