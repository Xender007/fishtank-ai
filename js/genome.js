// =============================================================================
// genome.js - a brain that can GROW.
// =============================================================================
// Up to Stage 6 a brain was a fixed 7-6-2 sandwich, and evolution could only
// change the 62 numbers inside it. The SHAPE was decided by me, in advance, by
// guessing.
//
// A genome throws that away. A brain is now just:
//
//     NODES        7 inputs, 2 outputs, and however many hidden neurons
//                  evolution has decided to grow
//     CONNECTIONS  each says: take node A's value, multiply by w, add it into
//                  node B
//
// Generation 1 starts with the SMALLEST brain that can work at all: seven
// inputs wired straight to two outputs, no hidden neurons whatsoever.
// Complexity only appears when a mutation adds it AND that mutation earns its
// keep. Nobody guesses the architecture; it gets discovered.
//
// This is a hand-rolled NEAT (NeuroEvolution of Augmenting Topologies). The two
// ideas below - innovation numbers and speciation - are what make it work
// instead of collapse.
// =============================================================================

const NODE_INPUT = 0, NODE_OUTPUT = 1, NODE_HIDDEN = 2;

// =============================================================================
// INNOVATION NUMBERS - what makes structural crossover possible at all.
// =============================================================================
// Stage 5 ran into "competing conventions": hidden neuron #3 in one brain may
// mean something entirely different from #3 in another, so mixing them by
// INDEX produces nonsense.
//
// Innovation numbers fix it properly. The first time a connection between two
// particular nodes appears anywhere, it is stamped with a permanent serial
// number. If that same connection arises later in a different lineage it gets
// the SAME number - because historically it is the same innovation.
//
// Now two genomes can be aligned by shared HISTORY instead of by position.
// Genes with matching numbers are the same feature in both parents and can be
// mixed safely; genes in only one parent are that parent's own invention and
// are inherited whole.
// =============================================================================

const Innovation = {
  nextInnovation: 0,
  nextNodeId: 0,
  connections: new Map(),   // "from>to"             -> innovation number
  splits: new Map(),        // connection innovation -> the node id it became

  reset() {
    this.nextInnovation = 0;
    this.nextNodeId = Senses.COUNT + 2;   // after the inputs and the two outputs
    this.connections.clear();
    this.splits.clear();
  },

  forConnection(from, to) {
    const key = from + '>' + to;
    if (!this.connections.has(key)) this.connections.set(key, this.nextInnovation++);
    return this.connections.get(key);
  },

  // Splitting a given connection always produces the same node id, everywhere,
  // forever. Without this, two lineages that both split connection #12 would
  // end up with differently numbered nodes for the same idea, and crossover
  // could never recognise them as equivalent.
  // Take on board the numbering of a genome loaded from a file. Without this,
  // a saved brain's innovation numbers could collide with ones this run has
  // already issued for different connections, and crossover would start
  // matching up genes that have nothing to do with each other.
  absorb(genome) {
    for (const c of genome.conns) {
      this.connections.set(c.from + '>' + c.to, c.inn);
      if (c.inn >= this.nextInnovation) this.nextInnovation = c.inn + 1;
    }
    for (const nd of genome.nodes) {
      if (nd.id >= this.nextNodeId) this.nextNodeId = nd.id + 1;
    }
  },

  forSplit(connInnovation) {
    if (!this.splits.has(connInnovation)) this.splits.set(connInnovation, this.nextNodeId++);
    return this.splits.get(connInnovation);
  },
};

// =============================================================================
// GENOME
// =============================================================================

class Genome {

  constructor(nodes, conns) {
    this.nodes = nodes;   // [{ id, type, bias }]
    this.conns = conns;   // [{ inn, from, to, w, enabled }]
    this.hue = 0;
    this.rebuild();
  }

  // The starting brain: every input wired straight to both outputs.
  // 14 connections + 2 biases = 16 parameters, against the layered net's 62.
  static minimal(rng) {
    const nodes = [];
    for (let i = 0; i < Senses.COUNT; i++) nodes.push({ id: i, type: NODE_INPUT, bias: 0 });

    const turnId = Senses.COUNT, thrustId = Senses.COUNT + 1;
    nodes.push({ id: turnId,   type: NODE_OUTPUT, bias: rng.range(-0.5, 0.5) });
    nodes.push({ id: thrustId, type: NODE_OUTPUT, bias: rng.range(-0.5, 0.5) });

    const conns = [];
    const range = 1 / Math.sqrt(Senses.COUNT);   // same reasoning as Stage 3
    for (let i = 0; i < Senses.COUNT; i++) {
      for (const out of [turnId, thrustId]) {
        conns.push({
          inn: Innovation.forConnection(i, out),
          from: i, to: out,
          w: rng.range(-range, range),
          enabled: true,
        });
      }
    }

    const g = new Genome(nodes, conns);
    g.hue = rng.next() * 360;
    return g;
  }

  // ---------------------------------------------------------------------------
  // REBUILD - recompute everything derived from the wiring.
  // ---------------------------------------------------------------------------
  // Called only when the structure changes. The forward pass runs 60 times a
  // second per fish; the structure changes once per generation. So all of the
  // graph work belongs here and none of it belongs in forward().
  // ---------------------------------------------------------------------------
  rebuild() {
    const n = this.nodes.length;

    // Node ids are global and sparse, so we need id -> position.
    this.index = new Map();
    for (let i = 0; i < n; i++) this.index.set(this.nodes[i].id, i);

    this.values = new Float64Array(n);
    this.incoming = [];
    for (let i = 0; i < n; i++) this.incoming.push([]);

    this.prev = new Float64Array(n);   // last tick's values, for memory edges

    // One Hebbian trace per connection. NOT inherited and NOT part of the
    // genome: this is what the brain learned during THIS life, and it starts
    // empty every time. Reallocating here also means a structural mutation
    // wipes the traces, which is correct - the wiring it learned against is
    // no longer the wiring it has.
    this.traces = new Float64Array(this.conns.length);

    this.conns.forEach((c, k) => {
      c.slot = k;                       // where this connection's trace lives
      if (!this.index.has(c.from) || !this.index.has(c.to)) return;
      this.incoming[this.index.get(c.to)].push(c);
    });

    // DEPTH: 0 for inputs, otherwise one more than the deepest predecessor.
    // This gives us both the evaluation order and the columns that the brain
    // inspector draws. Computed by repeated relaxation - simple, and correct
    // on a graph this small.
    this.depth = new Int32Array(n);
    for (let pass = 0; pass < n; pass++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (this.nodes[i].type === NODE_INPUT) continue;
        let d = 0;
        for (const c of this.incoming[i]) {
          // A recurrent edge reads LAST tick, so it imposes no ordering on
          // this one. Excluding it here is what keeps the graph sortable even
          // though it now contains loops.
          if (c.recurrent) continue;
          const fi = this.index.get(c.from);
          if (this.depth[fi] + 1 > d) d = this.depth[fi] + 1;
        }
        if (d !== this.depth[i]) { this.depth[i] = d; changed = true; }
      }
      if (!changed) break;
    }

    this.maxDepth = 0;
    for (let i = 0; i < n; i++) if (this.depth[i] > this.maxDepth) this.maxDepth = this.depth[i];

    // Evaluation order: shallowest first, so every node's inputs are ready
    // before it is computed.
    this.order = [];
    for (let i = 0; i < n; i++) if (this.nodes[i].type !== NODE_INPUT) this.order.push(i);
    this.order.sort((a, b) => this.depth[a] - this.depth[b]);

    this.outTurn   = this.index.get(Senses.COUNT);
    this.outThrust = this.index.get(Senses.COUNT + 1);
  }

  // ---------------------------------------------------------------------------
  // FORWARD - the same arithmetic as Stage 2, following edges instead of
  // marching through layers. Multiply, sum, add bias, squash. Still that.
  // ---------------------------------------------------------------------------
  forward(inputs) {
    const val = this.values;

    // Snapshot the whole network BEFORE anything is recomputed. Recurrent
    // edges read from this copy, so a memory connection delivers the value its
    // source held one tick ago - never the value it is about to take this
    // tick. Without the snapshot, whether a loop saw old or new data would
    // depend on evaluation order, and the same genome would behave differently
    // depending on how its nodes happened to be numbered.
    this.prev.set(val);

    for (let i = 0; i < Senses.COUNT; i++) val[i] = inputs[i];

    const plastic = CONFIG.genome.plasticity.enabled;

    for (const i of this.order) {
      let sum = this.nodes[i].bias;
      for (const c of this.incoming[i]) {
        if (!c.enabled) continue;
        const fi = this.index.get(c.from);
        const pre = c.recurrent ? this.prev[fi] : val[fi];
        // The EFFECTIVE weight: what was inherited, plus whatever this life has
        // learned on top of it.
        sum += pre * (c.w + (plastic ? this.traces[c.slot] || 0 : 0));
      }
      val[i] = Math.tanh(sum);
    }

    if (plastic) this.learn(val);
    return val;
  }

  decide(senses) {
    const val = this.forward(senses);
    return { turn: val[this.outTurn], thrust: (val[this.outThrust] + 1) / 2 };
  }

  // Enabled weights plus non-input biases. THIS is the number that climbs.
  paramCount() {
    let n = 0;
    for (const c of this.conns) if (c.enabled) n++;
    for (const node of this.nodes) if (node.type !== NODE_INPUT) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // LEARN - one Hebbian step, run after every forward pass.
  // ---------------------------------------------------------------------------
  // Neurons that fire together wire together. For each connection, nudge its
  // trace by the product of the neuron it comes FROM and the neuron it feeds,
  // scaled by that connection's own evolved learning rate. Then bleed the
  // trace back toward zero.
  //
  // The decay is not a detail. Without it, any pair that keeps co-firing grows
  // without bound until tanh saturates and the neuron stops responding to
  // anything - the same dead-neuron failure measured back in Stage 3, reached
  // by a different route. Decay makes the trace a memory of the RECENT past
  // rather than an accumulator over the whole life.
  // ---------------------------------------------------------------------------
  learn(val) {
    const cfg = CONFIG.genome.plasticity;
    const keep = 1 - cfg.decay;
    const cap = cfg.maxTrace;

    for (const c of this.conns) {
      const eta = c.plasticity;
      if (!eta || !c.enabled) continue;

      const fi = this.index.get(c.from), ti = this.index.get(c.to);
      if (fi === undefined || ti === undefined) continue;

      const pre = c.recurrent ? this.prev[fi] : val[fi];
      const post = val[ti];

      let t = this.traces[c.slot] * keep + eta * pre * post;
      if (t > cap) t = cap; else if (t < -cap) t = -cap;
      this.traces[c.slot] = t;
    }
  }

  // How many connections are allowed to learn during life. Zero means the
  // brain is entirely fixed at birth.
  plasticCount() {
    let n = 0;
    for (const c of this.conns) if (c.enabled && c.plasticity) n++;
    return n;
  }

  memoryCount() {
    let n = 0;
    for (const c of this.conns) if (c.recurrent && c.enabled) n++;
    return n;
  }

  hiddenCount() {
    let n = 0;
    for (const node of this.nodes) if (node.type === NODE_HIDDEN) n++;
    return n;
  }

  clone() {
    const g = new Genome(
      this.nodes.map(nd => ({ id: nd.id, type: nd.type, bias: nd.bias })),
      this.conns.map(c => ({ inn: c.inn, from: c.from, to: c.to, w: c.w,
                             enabled: c.enabled, recurrent: c.recurrent,
                             plasticity: c.plasticity }))
    );
    g.hue = this.hue;
    return g;
  }
}

// =============================================================================
// MUTATION - four ways a brain can change. Only the first one is Stage 4.
// =============================================================================

// A readable name for a node, used by the mutation log and the inspector.
Genome.nodeName = function (id) {
  if (id < Senses.COUNT) return Senses.labels()[id];
  if (id === Senses.COUNT) return 'turn';
  if (id === Senses.COUNT + 1) return 'thrust';
  return 'h' + id;
};

// Would connecting from -> to create a loop? We walk forwards from `to` and
// see whether we can get back to `from`. Disabled connections count, because a
// later toggle could switch one back on and the cycle would appear then.
Genome.prototype.wouldCycle = function (from, to) {
  const stack = [to];
  const seen = new Set();
  while (stack.length) {
    const at = stack.pop();
    if (at === from) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const c of this.conns) if (c.from === at) stack.push(c.to);
  }
  return false;
};

// --- 2. ADD CONNECTION -------------------------------------------------------
// Wire two nodes that were not previously wired. Cheap, and often useful: it
// gives an existing feature a new place to act.
Genome.prototype.mutateAddConnection = function (rng) {
  const sources = this.nodes.filter(n => n.type !== NODE_OUTPUT);
  const targets = this.nodes.filter(n => n.type !== NODE_INPUT);

  // Recurrent targets include the sources, so a neuron can feed itself - the
  // cheapest possible memory cell, and the one evolution reaches for first.
  const loopTargets = this.nodes.filter(n => n.type !== NODE_INPUT);

  for (let attempt = 0; attempt < 24; attempt++) {
    const wantMemory = rng.next() < CONFIG.genome.recurrentRate;
    const pool = wantMemory ? loopTargets : targets;
    const a = sources[rng.int(sources.length)];
    const b = pool[rng.int(pool.length)];

    if (this.conns.some(c => c.from === a.id && c.to === b.id)) continue;

    // A self-loop, or an edge that would close a cycle, becomes a RECURRENT
    // edge instead of being thrown away. That is the whole trick: the
    // candidates this function used to reject are exactly the ones that give
    // the network memory.
    const cyclic = a.id === b.id || this.wouldCycle(a.id, b.id);
    if (cyclic && !wantMemory) continue;

    this.conns.push({
      inn: Innovation.forConnection(a.id, b.id),
      from: a.id, to: b.id,
      w: rng.gaussian() * 0.5,
      enabled: true,
      recurrent: cyclic,
    });
    this.rebuild();
    return (cyclic ? '+memory ' : '+conn ') + Genome.nodeName(a.id) + ' \u2192 ' + Genome.nodeName(b.id);
  }
  return null;    // the graph was too dense to find a legal new edge
};

// --- 3. ADD NODE -------------------------------------------------------------
// Split an existing connection in half and drop a neuron into the gap:
//
//     before:   A ----w----> B
//     after:    A ----1----> N ----w----> B      (the original is disabled)
//
// The incoming weight is 1 and the outgoing weight is the ORIGINAL w, which
// keeps the signal roughly the same size as before. Roughly - not exactly,
// because the new neuron adds another tanh in the middle of the path. So a
// freshly grown brain is nearly always slightly WORSE than its parent.
//
// That single fact is why speciation exists. Judged against the whole
// population, every structural innovation would die in the generation it was
// born, and brains could never grow at all.
Genome.prototype.mutateAddNode = function (rng) {
  const live = this.conns.filter(c => c.enabled);
  if (live.length === 0) return null;

  const c = live[rng.int(live.length)];
  const newId = Innovation.forSplit(c.inn);
  if (this.index.has(newId)) return null;   // this split already happened here

  c.enabled = false;
  this.nodes.push({ id: newId, type: NODE_HIDDEN, bias: 0 });

  this.conns.push({ inn: Innovation.forConnection(c.from, newId),
                    from: c.from, to: newId, w: 1, enabled: true });
  // The OUTGOING half inherits the original's recurrence, so splitting a
  // memory edge preserves its one-tick delay instead of quietly turning a
  // loop into two forward edges - which would put a backwards connection in
  // the feed-forward set and break the ordering the forward pass relies on.
  this.conns.push({ inn: Innovation.forConnection(newId, c.to),
                    from: newId, to: c.to, w: c.w, enabled: true,
                    recurrent: c.recurrent });

  this.rebuild();
  return '+node splitting ' + Genome.nodeName(c.from) + ' \u2192 ' + Genome.nodeName(c.to);
};

// --- 4. TOGGLE ---------------------------------------------------------------
// Switch a connection off (or back on). Off is not deletion: the gene stays in
// the genome, keeps its innovation number, and can be switched back on later or
// inherited by a child. Evolution gets to shelve an idea without losing it.
Genome.prototype.mutateToggle = function (rng) {
  if (this.conns.length === 0) return null;
  const c = this.conns[rng.int(this.conns.length)];
  c.enabled = !c.enabled;
  this.rebuild();
  return (c.enabled ? '+on  ' : '-off ') +
         Genome.nodeName(c.from) + ' \u2192 ' + Genome.nodeName(c.to);
};

// --- 1. WEIGHTS, plus the structural rolls ----------------------------------
// Returns a list of plain-English descriptions of every STRUCTURAL change, for
// the mutation log. Weight tweaks are not logged - they happen constantly and
// would drown everything else out.
Genome.prototype.mutate = function (rng, rate, strength) {
  for (const c of this.conns) {
    if (rng.next() < rate) c.w += rng.gaussian() * strength;
  }
  for (const nd of this.nodes) {
    if (nd.type !== NODE_INPUT && rng.next() < rate) nd.bias += rng.gaussian() * strength;
  }

  // Evolve WHERE plasticity helps. Most connections should stay fixed; the
  // interesting result is which few evolution decides to let drift.
  const pc = CONFIG.genome.plasticity;
  if (pc.enabled) {
    for (const c of this.conns) {
      if (rng.next() >= pc.mutationRate) continue;
      c.plasticity = V.clamp((c.plasticity || 0) + rng.gaussian() * pc.strength, -0.6, 0.6);
      if (Math.abs(c.plasticity) < 0.01) c.plasticity = 0;   // snap to fixed
    }
  }

  const cfg = CONFIG.genome;
  const events = [];
  let e;
  if (rng.next() < cfg.addNodeRate)       { e = this.mutateAddNode(rng);       if (e) events.push(e); }
  if (rng.next() < cfg.addConnectionRate) { e = this.mutateAddConnection(rng); if (e) events.push(e); }
  if (rng.next() < cfg.toggleRate)        { e = this.mutateToggle(rng);        if (e) events.push(e); }
  return events;
};

// =============================================================================
// CROSSOVER BY INNOVATION NUMBER - the fix for competing conventions.
// =============================================================================
// `this` must be the FITTER parent. Genes are lined up by innovation number:
//
//   MATCHING   both parents have this gene. It is historically the same
//              feature in both, so taking either parent's weight is safe -
//              this is the mixing that Stage 5 could never do soundly.
//   DISJOINT   only one parent has it. It is that parent's own invention, and
//              we inherit it whole, from the fitter parent only.
//
// Inheriting structure from the fitter parent alone keeps children well-formed.
// Taking a random half of each parent's private inventions would produce
// genomes with dangling nodes and missing paths.
// =============================================================================
Genome.prototype.crossover = function (other, rng) {
  const mine = new Map(), theirs = new Map();
  for (const c of this.conns)  mine.set(c.inn, c);
  for (const c of other.conns) theirs.set(c.inn, c);

  const conns = [];
  for (const [inn, c] of mine) {
    const match = theirs.get(inn);

    if (match) {
      // MATCHING gene: take the weight from either parent at random.
      const src = rng.next() < 0.5 ? c : match;
      let enabled = c.enabled && match.enabled;
      // If either parent had it switched off, usually keep it off - but not
      // always. That occasional re-enable is how a shelved idea comes back.
      if (!enabled && rng.next() < 0.25) enabled = true;
      conns.push({ inn, from: c.from, to: c.to, w: src.w, enabled,
                   recurrent: c.recurrent, plasticity: src.plasticity });
    } else {
      // DISJOINT gene, from the fitter parent: inherited whole.
      conns.push({ inn, from: c.from, to: c.to, w: c.w, enabled: c.enabled,
                   recurrent: c.recurrent, plasticity: c.plasticity });
    }
  }

  // Nodes come from the fitter parent too, with biases mixed where shared.
  const otherNodes = new Map();
  for (const nd of other.nodes) otherNodes.set(nd.id, nd);

  const nodes = this.nodes.map(nd => {
    const mate = otherNodes.get(nd.id);
    const bias = (mate && rng.next() < 0.5) ? mate.bias : nd.bias;
    return { id: nd.id, type: nd.type, bias };
  });

  const child = new Genome(nodes, conns);
  child.hue = blendHue(this.hue, other.hue);
  return child;
};

// =============================================================================
// COMPATIBILITY DISTANCE - how different are two brains?
// =============================================================================
// Used to sort the population into species. Two components:
//
//   STRUCTURAL   how many genes one has that the other does not. Growing a
//                neuron changes this a lot, which is the point - a fish with a
//                new neuron lands in a species of its own and is sheltered
//                there while it tunes.
//   NUMERIC      how different the shared weights are. Two brains with the
//                same wiring but opposite weights are not the same brain.
// =============================================================================
Genome.prototype.distance = function (other) {
  const mine = new Map();
  for (const c of this.conns) mine.set(c.inn, c);

  let unmatched = 0, matched = 0, weightDiff = 0;
  const seen = new Set();

  for (const c of other.conns) {
    seen.add(c.inn);
    const m = mine.get(c.inn);
    if (m) { matched++; weightDiff += Math.abs(m.w - c.w); }
    else unmatched++;
  }
  for (const c of this.conns) if (!seen.has(c.inn)) unmatched++;

  // NEAT normalises by the size of the larger genome so that a big brain is
  // not automatically judged distant from everything.
  const n = Math.max(1, Math.max(this.conns.length, other.conns.length));
  const cfg = CONFIG.genome;

  return cfg.excessCoefficient * unmatched / n +
         cfg.weightCoefficient * (matched ? weightDiff / matched : 0);
};

// =============================================================================
// GRAPH - a neutral description for the brain inspector to draw.
// =============================================================================
// The inspector should not care whether it is looking at a growing genome or
// the fixed Stage 3 network, so both produce this same shape.
// =============================================================================
Genome.prototype.graph = function () {
  return {
    nodes: this.nodes.map((nd, i) => ({
      id: nd.id,
      name: Genome.nodeName(nd.id),
      type: nd.type,
      depth: this.depth[i],
      bias: nd.bias,
      value: this.values[i],
      // What this node held LAST tick. A memory edge carries this, not
      // the current value, so the arithmetic panel needs both to show
      // a sum that actually adds up.
      prevValue: this.prev[i],
    })),
    conns: this.conns.map(c => ({ from: c.from, to: c.to, w: c.w,
                                  enabled: c.enabled, recurrent: !!c.recurrent })),
    maxDepth: this.maxDepth,
  };
};
