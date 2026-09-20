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

  /* Cover minterms with primes: essentials first, then greedy. */
  function coverSOP(primes, on) {
    const need = new Set(on);
    const chosen = [];
    for (const m of on) {
      const ps = primes.filter(p => p.cov.has(m));
      if (ps.length === 1 && !chosen.includes(ps[0])) chosen.push(ps[0]);
    }
    chosen.forEach(p => p.cov.forEach(m => need.delete(m)));
    while (need.size) {
      let best = null, bestCnt = 0;
      for (const p of primes) {
        if (chosen.includes(p)) continue;
        let c = 0;
        for (const m of need) if (p.cov.has(m)) c++;
        if (c > bestCnt) { bestCnt = c; best = p; }
      }
      if (!best) break;
      chosen.push(best);
      best.cov.forEach(m => need.delete(m));
    }
    return chosen;
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
    if (firsts.length === 1) {
      const t = firsts[0];
      if (t === b.const1()) return b.const1();
      return b.nand([t, t]); // AND via NAND pair
    }
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
      else if (lib.has('MUX')) out = b.mux2(x, b.const1(), b.const0());
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

    // 1) direct AND/OR
    if (lib.has('AND') && lib.has('OR')) {
      try {
        const id = displayTerms
          ? buildMergedTerms(b, displayTerms, n, inIds, lib)
          : cubesToSop(b, chosen, n, inIds, lib);
        return finish(id, 'two-level AND/OR');
      } catch (e) { reasons.push('AND/OR mapping: ' + reasonText(e, lib)); }
    }
    // 2) NAND-NAND (NAND alone is complete)
    if (lib.has('NAND')) {
      try { return finish(nandPath(b, chosen, n, inIds, lib), 'NAND-NAND'); }
      catch (e) { reasons.push('NAND mapping: ' + reasonText(e, lib)); }
    }
    // 3) NOR-NOR (NOR alone is complete)
    if (lib.has('NOR')) {
      try { return finish(norPath(b, compCubes, n, inIds, lib), 'NOR-NOR'); }
      catch (e) { reasons.push('NOR mapping: ' + reasonText(e, lib)); }
    }
    // 4) De Morgan with AND+INV
    if (lib.has('AND') && lib.has('INV')) {
      try { return finish(dmAndPath(b, compCubes, n, inIds, lib), 'AND + INV (De Morgan)'); }
      catch (e) { reasons.push('AND+INV mapping: ' + reasonText(e, lib)); }
    }
    // 5) De Morgan with OR+INV
    if (lib.has('OR') && lib.has('INV')) {
      try { return finish(dmOrPath(b, compCubes, n, inIds, lib), 'OR + INV (De Morgan)'); }
      catch (e) { reasons.push('OR+INV mapping: ' + reasonText(e, lib)); }
    }
    // 6) ANF: XOR (+AND for higher-order terms); pure parity works with XOR alone
    if (lib.has('XOR')) {
      try { return finish(anfPath(b, on, n, inIds, lib), 'XOR/AND (ANF)'); }
      catch (e) { reasons.push('XOR/AND mapping: ' + reasonText(e, lib)); }
    }
    // 7) MUX tree (uses 4:1 nodes when possible, falls back to 2:1)
    if (lib.has('MUX')) {
      try { return finish(muxTree(b, inIds, vals, lib, {}), 'MUX tree'); }
      catch (e) { reasons.push('MUX mapping: ' + reasonText(e, lib)); }
    }

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
    const nodes = builder.nodes;
    const reach = reachable(nodes, roots.map(r => r.id));
    const ids = [...reach].sort((a, b) => a - b);
    const level = computeLevels(nodes, ids);

    const maxLevel = Math.max(1, ...ids.map(id => level.get(id)));
    const COL_X_IN = 30, COL_W = 148, GATE_X0 = 118;

    /* group by level */
    const byLevel = new Map();
    ids.forEach(id => {
      const lv = level.get(id);
      if (!byLevel.has(lv)) byLevel.set(lv, []);
      byLevel.get(lv).push(id);
    });

    /* layout */
    const pos = new Map(); // id -> {x, y, h, w}
    const colX = lv => lv === 0 ? COL_X_IN : GATE_X0 + (lv - 1) * COL_W;

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
    let yCursor = 30;
    lv0.forEach(id => {
      const nd = nodes[id];
      const isIn = nd.type === 'IN';
      pos.set(id, { x: colX(0), y: yCursor, w: isIn ? 0 : 26, h: 20, label: labelOf(id) });
      if (isIn) inOrder.push(id);
      yCursor += 34;
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
      let y = 30;
      col.forEach(id => {
        const nd = nodes[id];
        const g = GATE[nd.type];
        const h = nodeHeight(nd.type, dataPinCount(nd));
        const w = g.w + (g.bubble ? 10 : 0) + (g.xorCurve ? 10 : 0);
        pos.set(id, { x: colX(lv), y: y + h / 2, w, h, gate: true });
        y += h + 22;
      });
    }

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
        if (i < nSel) return selPin(id, nSel - 1 - i);
        const ys = pinYs(nd.type, nd.ins.length - nSel);
        return { x: p.x, y: p.y + ys[i - nSel] };
      }
      const ys = pinYs(nd.type, nd.ins.length);
      const px = isOrType(nd.type) ? p.x + (GATE[nd.type].xorCurve ? 10 : 0) : p.x;
      return { x: px, y: p.y + ys[i] };
    }
    function selPin(id, which) {
      const p = pos.get(id), nd = nodes[id];
      const nSel = muxSelCount(nd);
      const y = p.y + p.h / 2;
      if (nSel === 1) return { x: p.x + p.w / 2, y };
      return which === 0
        ? { x: p.x + p.w * 0.32, y }
        : { x: p.x + p.w * 0.68, y };
    }
    function outPin(id) {
      const p = pos.get(id), nd = nodes[id];
      if (nd.type === 'IN') return { x: p.x + 6, y: p.y };
      if (nd.type === 'CONST0' || nd.type === 'CONST1') return { x: p.x + p.w, y: p.y };
      return { x: p.x + p.w, y: p.y };
    }

    /* canvas size */
    let maxY = 0;
    pos.forEach(p => maxY = Math.max(maxY, p.y + p.h / 2 + (p.gate ? 16 : 0)));
    const width = colX(maxLevel) + 150 + 90;
    const height = maxY + 40;

    const f = v => Math.round(v * 10) / 10;
    const svg = [];
    svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" font-family="Consolas,Menlo,monospace" font-size="12">');
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
    /* gate bodies a horizontal wire at y must not cross */
    const blockers = (y, x1, x2) => {
      const rs = [];
      ids.forEach(id => {
        const p = pos.get(id), nd = nodes[id];
        if (!p || nd.type === 'IN') return;
        const gy1 = p.y - p.h / 2, gy2 = p.y + p.h / 2;
        if (y > gy1 + 2 && y < gy2 - 2 && p.x + p.w > x1 + 4 && p.x < x2 - 4) {
          rs.push([p.x, gy1, p.x + p.w, gy2]);
        }
      });
      return rs;
    };
    const wires = [];
    const dots = [];
    const dotKeys = new Set();
    const addDot = (x, y) => {
      const k = f(x) + ',' + f(y);
      if (dotKeys.has(k)) return;
      dotKeys.add(k);
      dots.push([x, y]);
    };
    bySrc.forEach((list, src) => {
      const s = outPin(src);
      if (!s) return;
      const lane = laneOf.get(src) || 0;
      const ts = list.map(e => e.pin).filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x);
      if (!ts.length) return;
      if (ts.length === 1) {
        const t = ts[0];
        if (Math.abs(s.y - t.y) < 0.6) {
          const rs = blockers(s.y, s.x, t.x);
          if (!rs.length) {
            wires.push('M ' + f(s.x) + ' ' + f(s.y) + ' H ' + f(t.x));
          } else {
            /* detour above the blocking gate bodies, drop back near the pin */
            const bx1 = Math.min.apply(null, rs.map(r => r[0])) - 8;
            const dy = Math.min.apply(null, rs.map(r => r[1])) - 12;
            wires.push('M ' + f(s.x) + ' ' + f(s.y) + ' H ' + f(bx1)
              + ' V ' + f(dy) + ' H ' + f(t.x - 14)
              + ' V ' + f(t.y) + ' H ' + f(t.x));
          }
        } else {
          const mx = f(s.x + 10 + lane * 8);
          wires.push('M ' + f(s.x) + ' ' + f(s.y) + ' H ' + mx + ' V ' + f(t.y) + ' H ' + f(t.x));
        }
      } else {
        const trunkX = s.x + 14 + lane * 9;
        const yMin = Math.min(s.y, ts[0].y), yMax = Math.max(s.y, ts[ts.length - 1].y);
        const flat = Math.abs(yMax - yMin) < 0.6;
        wires.push('M ' + f(s.x) + ' ' + f(s.y) + ' H ' + f(trunkX) + ' V ' + f(yMin) + ' V ' + f(yMax));
        ts.forEach(t => {
          const rs = blockers(t.y, trunkX, t.x);
          if (rs.length) {
            const bx1 = Math.min.apply(null, rs.map(r => r[0])) - 8;
            const dy = Math.min.apply(null, rs.map(r => r[1])) - 12;
            wires.push('M ' + f(trunkX) + ' ' + f(t.y) + ' H ' + f(bx1)
              + ' V ' + f(dy) + ' H ' + f(t.x - 14)
              + ' V ' + f(t.y) + ' H ' + f(t.x));
          } else {
            wires.push('M ' + f(trunkX) + ' ' + f(t.y) + ' H ' + f(t.x));
          }
          if (!flat) addDot(trunkX, t.y);
        });
      }
    });
    if (wires.length) svg.push('<path class="gl" d="' + wires.join(' ') + '"/>');
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

    /* output labels */
    roots.forEach(r => {
      const p = pos.get(r.id);
      if (!p) return;
      const op = outPin(r.id);
      svg.push('<line class="gl" x1="' + f(op.x) + '" y1="' + f(op.y) + '" x2="' + f(op.x + 14) + '" y2="' + f(op.y) + '"/>');
      svg.push('<circle class="term" cx="' + f(op.x + 14) + '" cy="' + f(op.y) + '" r="3.2"/>');
      svg.push('<text x="' + f(op.x + 24) + '" y="' + f(op.y + 4) + '" class="olbl">' + esc(r.label) + '</text>');
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
        s += '<path class="gb" d="M ' + f(x) + ' ' + f(top) + ' L ' + f(x + bw - ra) + ' ' + f(top) + ' A ' + f(ra) + ' ' + f(ra) + ' 0 0 1 ' + f(x + bw - ra) + ' ' + f(top + h) + ' L ' + f(x) + ' ' + f(top + h) + ' Z"/>';
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
  const CORE = { bitsOf, minimizeSOP, coverSOP, anfCoefficients, mergeXorPair, makeBuilder, synthesize };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof window !== 'undefined') window.ICLogic = CORE;

  if (typeof document === 'undefined') return;

  const MAX_IO = 8;
  const GATE_LIST = ['NAND', 'NOR', 'INV', 'BUF', 'AND', 'OR', 'XOR', 'XNOR', 'MUX'];

  const state = {
    inputs: ['A', 'B'],
    outputs: ['F'],
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
    $('#generate').addEventListener('click', onGenerate);
    $('#dl-svg').addEventListener('click', downloadSvg);
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
    let i = arr.length;
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

  function downloadSvg() {
    if (!lastResult) return;
    const rendered = renderSvg(lastResult.builder, lastResult.roots, lastResult.inNames, { forDownload: true });
    const blob = new Blob([rendered.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'circuit.svg';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
