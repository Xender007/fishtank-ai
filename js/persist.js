// =============================================================================
// persist.js - saving a good brain, and getting it back.
// =============================================================================
// Evolution takes real time, and a page refresh has so far thrown away every
// generation of it. This makes a brain into text: a JSON file you can keep,
// send to someone, or load back in months later.
//
// It is also the clearest possible demonstration of what a trained network
// actually IS. Open the saved file in a text editor. There is no intelligence
// in there, no rules, no if-statements about sharks. There is a list of numbers
// and a list of which node feeds which. That is the entire learned behaviour.
// =============================================================================

const Persist = {

  KEY: 'fish-shark-best-brain',

  // ---------------------------------------------------------------------------
  // A brain, as plain data.
  // ---------------------------------------------------------------------------
  toJSON(brain, meta) {
    const base = { version: 1, saved: new Date().toISOString(), meta: meta || {} };

    if (brain.conns) {
      return Object.assign(base, {
        kind: 'genome',
        hue: brain.hue,
        nodes: brain.nodes.map(n => ({ id: n.id, type: n.type, bias: n.bias })),
        conns: brain.conns.map(c => ({ inn: c.inn, from: c.from, to: c.to,
                                       recurrent: !!c.recurrent,
                               plasticity: c.plasticity || 0,
                                       plasticity: c.plasticity || 0,
                                       w: c.w, enabled: c.enabled })),
      });
    }

    return Object.assign(base, {
      kind: 'layered',
      hue: brain.hue,
      layers: brain.layers.map(l => ({
        inputCount: l.inputCount,
        size: l.size,
        weights: Array.from(l.weights),
        biases: Array.from(l.biases),
      })),
    });
  },

  // ---------------------------------------------------------------------------
  // ...and back again.
  // ---------------------------------------------------------------------------
  // Note the validation. A file on disk is input from outside the program, and
  // a half-loaded brain would fail later, somewhere confusing, rather than
  // here where the cause is obvious.
  fromJSON(data) {
    if (!data || typeof data !== 'object') throw new Error('not a brain file');

    if (data.kind === 'genome') {
      if (!Array.isArray(data.nodes) || !Array.isArray(data.conns)) {
        throw new Error('genome file is missing nodes or conns');
      }
      const inputs = data.nodes.filter(n => n.type === NODE_INPUT).length;
      if (inputs !== Senses.COUNT) {
        throw new Error('that brain expects ' + inputs + ' senses, this fish has ' +
                        Senses.COUNT + ' - the sense layout has changed since it was saved');
      }
      const g = new Genome(
        data.nodes.map(n => ({ id: n.id, type: n.type, bias: n.bias })),
        data.conns.map(c => ({ inn: c.inn, from: c.from, to: c.to,
                               recurrent: !!c.recurrent,
                               w: c.w, enabled: c.enabled !== false }))
      );
      g.hue = typeof data.hue === 'number' ? data.hue : 200;
      return g;
    }

    if (data.kind === 'layered') {
      if (!Array.isArray(data.layers)) throw new Error('layered file is missing layers');
      const rng = new Rng(1);
      const layers = data.layers.map(l => {
        const layer = new Layer(l.inputCount, l.size, rng);
        layer.weights.set(l.weights);
        layer.biases.set(l.biases);
        return layer;
      });
      const net = new Network(layers);
      net.hue = typeof data.hue === 'number' ? data.hue : 200;
      return net;
    }

    throw new Error('unknown brain kind: ' + data.kind);
  },

  // The best brain of the last completed generation.
  bestBrain(world) {
    // The champion of the last completed generation, if there has been one.
    // Falling back to the living fish only matters before generation 1 ends,
    // when every age is still climbing.
    if (world.bestBrain) return { brain: world.bestBrain, fitness: world.bestFitness };

    let best = null, bestFit = -Infinity;
    for (const f of world.fish) {
      const fit = Evolution.fitness(f);
      if (f.net && fit > bestFit) { bestFit = fit; best = f.net; }
    }
    return best ? { brain: best, fitness: bestFit } : null;
  },

  // ---------------------------------------------------------------------------
  // To a file you can keep.
  // ---------------------------------------------------------------------------
  download(world) {
    const pick = this.bestBrain(world);
    if (!pick) return 'nothing to save yet';

    const data = this.toJSON(pick.brain, {
      generation: world.generation,
      fitness: Number(pick.fitness.toFixed(2)),
      params: pick.brain.paramCount(),
      hidden: pick.brain.hiddenCount(),
    });

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fish-brain-gen' + world.generation + '.json';
    a.click();
    URL.revokeObjectURL(url);
    return 'saved generation ' + world.generation;
  },

  // ---------------------------------------------------------------------------
  // Quietly, to the browser, every generation.
  // ---------------------------------------------------------------------------
  // Wrapped in try/catch because localStorage is not always available - a
  // file:// page, a private window or blocked site data can all make it throw.
  // Losing an autosave must never take the simulation down with it.
  autosave(world) {
    try {
      const pick = this.bestBrain(world);
      if (!pick) return;
      localStorage.setItem(this.KEY, JSON.stringify(this.toJSON(pick.brain, {
        generation: world.generation,
        fitness: Number(pick.fitness.toFixed(2)),
      })));
    } catch (err) { /* storage unavailable - not worth interrupting anything for */ }
  },

  restore() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      return { data: JSON.parse(raw), brain: this.fromJSON(JSON.parse(raw)) };
    } catch (err) { return null; }
  },
};
