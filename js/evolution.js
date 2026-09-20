// =============================================================================
// evolution.js - where dying fish turn into better fish.
// =============================================================================
// The entire algorithm is four steps, repeated forever:
//
//     1. SCORE    give every fish a single number saying how well it did
//     2. SELECT   pick parents, biased towards the better scores
//     3. COPY     children start as exact copies of a parent's brain
//     4. MUTATE   jitter a few of each child's weights
//
// There is no gradient here, no backpropagation, no calculus at all. That is
// not a simplification - it is the reason this approach FITS this problem.
// Backprop needs a differentiable path from each weight to the loss. Here the
// "loss" is being eaten nine seconds later by a physics simulation, through a
// discrete event. There is no derivative to take. Evolution does not need one;
// it only needs to be able to say which of two fish did better.
// =============================================================================

const Evolution = {

  // ---------------------------------------------------------------------------
  // 1. FITNESS - one number per fish. The most consequential line in the file.
  // ---------------------------------------------------------------------------
  // Seconds survived, and nothing else.
  //
  // It is worth saying why it is NOT "average distance from the shark", which
  // sounds more informative. Stage 2 measured that idea and it is actively
  // wrong: fish that flee stay further from the shark on average (518px
  // against 437px) and get eaten MORE, because in a closed tank running away
  // means running out of room. Rewarding a proxy rewards the proxy. If what
  // you want is survival, score survival.
  //
  // This is still not a perfect fitness function, and the flaw is deliberate.
  // Watch what the population does with it.
  // ---------------------------------------------------------------------------
  fitness(fish) {
    if (!CONFIG.evolution.exposureWeighting) return fish.age;

    // ---------------------------------------------------------------------
    // EXPOSURE WEIGHTING - only count survival that was actually tested.
    // ---------------------------------------------------------------------
    // In a crowd one shark chases the nearest fish and everyone else is safe
    // for free, so raw survival time mostly measures whether somebody else
    // was closer. Measured: sixty copies of ONE brain scored with the same
    // spread as sixty different brains - selection was reading pure luck, and
    // twelve generations of it cut a champion from 48.3s to 17.3s.
    //
    // So survival is scaled by the fraction of its life the fish spent with a
    // predator in sensing range. Survive 60s untouched and you score like a
    // 15s fish; survive 60s under constant pursuit and you score the lot.
    //
    // The floor matters: at zero, never meeting a shark would score zero and
    // evolution would select for fish that CHASE sharks to be scored at all.
    // A quarter keeps untested survival worth something without letting it
    // outrank tested survival.
    const ticks = Math.max(1, fish.age / CONFIG.sim.dt);
    const exposure = Math.min(1, (fish.threatTicks || 0) / ticks);
    const floor = CONFIG.evolution.exposureFloor;
    return fish.age * (floor + (1 - floor) * exposure);
  },

  // ---------------------------------------------------------------------------
  // 2. SELECTION - a tournament.
  // ---------------------------------------------------------------------------
  // Pick `size` fish completely at random, return whichever scored best.
  //
  // Compare the textbook alternative, roulette wheel selection, where the
  // chance of being picked is proportional to fitness. Roulette fails at both
  // ends of the range:
  //
  //   - when every fish scores about the same (say 28.1, 28.4, 29.0 seconds)
  //     the probabilities are nearly equal and there is no pressure at all;
  //   - when one fish scores hugely more than the rest, it wins nearly every
  //     draw and the whole population collapses onto one brain in a single
  //     generation, losing all the variation evolution needs.
  //
  // A tournament never looks at the NUMBERS, only at which is bigger. It
  // behaves identically whether the scores are [9.9, 10.0] or [1, 100], which
  // makes it far harder to accidentally break.
  // ---------------------------------------------------------------------------
  tournament(scored, rng, size) {
    let best = scored[rng.int(scored.length)];
    for (let i = 1; i < size; i++) {
      const challenger = scored[rng.int(scored.length)];
      if (challenger.fitness > best.fitness) best = challenger;
    }
    return best;
  },

  // ---------------------------------------------------------------------------
  // 3 + 4. BREED - build the next generation's brains.
  // ---------------------------------------------------------------------------
  // Returns an array of networks, same length as the population.
  // ---------------------------------------------------------------------------
  breed(scored, rng) {
    const cfg = CONFIG.evolution;
    const n = scored.length;

    // Best first. Note the comparator returns b - a, so this is DESCENDING.
    const ranked = scored.slice().sort((a, b) => b.fitness - a.fitness);

    const brains = [];

    // ---- ELITES: the very best, copied with no mutation at all ----
    // This is what turns the best-so-far into a ratchet. Without it, the best
    // brain the population has ever found can be wiped out by a single bad
    // roll, and the fitness curve wanders downwards as often as up.
    for (let i = 0; i < cfg.elites && i < n; i++) {
      brains.push(ranked[i].brain.clone());
    }

    // ---- EVERYONE ELSE ----
    // Each child comes from either two parents (crossover) or one (a mutated
    // clone). Keeping both routes matters: crossover on neural networks is
    // genuinely risky because of competing conventions (see brain.js), so a
    // steady supply of plain clones means a bad crossover cannot wipe out a
    // working lineage in one generation.
    while (brains.length < n) {
      const parent = this.tournament(ranked, rng, cfg.tournamentSize);
      let child;

      if (CONFIG.crossover.enabled && rng.next() < CONFIG.crossover.rate) {
        // A second tournament, run independently - so the mate is also biased
        // towards being good, but is not necessarily the same fish. Note that
        // it CAN be the same fish, in which case the child is just a clone.
        // That is fine and happens in real populations too.
        const mate = this.tournament(ranked, rng, cfg.tournamentSize);
        child = parent.brain.crossover(mate.brain, rng, CONFIG.crossover.scheme);
      } else {
        child = parent.brain.clone();
      }

      child.mutate(rng, cfg.mutationRate, cfg.mutationStrength);
      brains.push(child);
    }

    return brains;
  },

  // A small summary of how a generation went, for the chart and the HUD.
  summarise(scored, generation) {
    let best = -Infinity, sum = 0;
    for (const s of scored) {
      if (s.fitness > best) best = s.fitness;
      sum += s.fitness;
    }
    return { generation, best, mean: sum / scored.length };
  },
  // ---------------------------------------------------------------------------
  // LINEAGE DIVERSITY - how many distinct families are still in the game.
  // ---------------------------------------------------------------------------
  // Hues are angles, so they have to be averaged as vectors. The length of the
  // mean vector is 1 when every fish shares a colour and 0 when they are spread
  // evenly around the wheel, so 1 minus that length is a diversity score.
  //
  // Watch it fall. A population that converges to a single colour has lost the
  // variation evolution needs, and improvement stops - "premature convergence".
  // If it hits zero early, lower tournamentSize or raise mutationStrength.
  // ---------------------------------------------------------------------------
  diversity(fish) {
    let x = 0, y = 0, n = 0;
    for (const f of fish) {
      if (!f.net) continue;
      const a = f.net.hue * Math.PI / 180;
      x += Math.cos(a); y += Math.sin(a); n++;
    }
    if (n === 0) return 0;
    return 1 - Math.sqrt(x * x + y * y) / n;
  },
  // ---------------------------------------------------------------------------
  // GENETIC SPREAD - real variation, measured on the weights themselves.
  // ---------------------------------------------------------------------------
  // diversity() above counts LINEAGE colours, and it is honest only when
  // children are clones. The moment crossover blends two parents' hues, the
  // colours converge towards the population average whether or not the genes
  // do - so under crossover that number reads near zero even while the
  // population is still genuinely varied. It measures the proxy, not the thing.
  //
  // This measures the thing: for every parameter in the network, the standard
  // deviation of that parameter across the whole population, averaged. Zero
  // means every fish is carrying an identical brain and evolution has nothing
  // left to select between.
  //
  // The lesson generalises well beyond fish: if an operator in your system can
  // move your metric directly, the metric has stopped measuring the world.
  // ---------------------------------------------------------------------------
  geneticSpread(fish) {
    const brains = [];
    for (const f of fish) if (f.net) brains.push(f.net);
    if (brains.length < 2) return 0;

    // Gather every parameter into buckets keyed by IDENTITY, then take the
    // standard deviation within each bucket and average those.
    //
    // What counts as "the same parameter" differs by brain kind, and getting
    // this wrong is what made the page freeze once already:
    //   layered  - position in the weight array. Every brain has the same shape.
    //   genome   - the INNOVATION NUMBER for a weight, and the node id for a
    //              bias. Genomes have different genes from one another, so
    //              position means nothing and only shared history lines up.
    const buckets = new Map();
    const push = (key, v) => {
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(v);
    };

    for (const b of brains) {
      if (b.layers) {
        b.layers.forEach((layer, li) => {
          for (let i = 0; i < layer.weights.length; i++) push('w' + li + '.' + i, layer.weights[i]);
          for (let i = 0; i < layer.biases.length; i++)  push('b' + li + '.' + i, layer.biases[i]);
        });
      } else {
        for (const c of b.conns) push('w' + c.inn, c.w);
        for (const nd of b.nodes) if (nd.type !== NODE_INPUT) push('b' + nd.id, nd.bias);
      }
    }

    let total = 0, counted = 0;
    for (const values of buckets.values()) {
      // A gene only one fish carries has no spread to measure.
      if (values.length < 2) continue;
      let mean = 0;
      for (const v of values) mean += v;
      mean /= values.length;

      let variance = 0;
      for (const v of values) { const d = v - mean; variance += d * d; }
      total += Math.sqrt(variance / values.length);
      counted++;
    }
    return counted ? total / counted : 0;
  },

  // ---------------------------------------------------------------------------
  // SPECIATION (Stage 7) - sheltering new ideas until they are good.
  // ---------------------------------------------------------------------------
  // Here is the problem it solves. A fish that has just grown a new neuron is
  // almost always WORSE than its parent: the new node inserts an extra tanh
  // into a path that used to work, and nothing has tuned around it yet. Judged
  // against the whole population, it dies in the generation it was born, every
  // time. Brains could never grow.
  //
  // So we sort genomes into species by how similar their WIRING is, and each
  // fish mainly competes with its own species. Grow a neuron and you land in a
  // species of your own, where the bar is set by fish like you - which buys a
  // few generations to make the idea work.
  //
  // FITNESS SHARING is the second half. A species is allocated offspring in
  // proportion to its MEAN fitness, not its total. A species of one excellent
  // fish therefore gets the same share as a species of thirty equally excellent
  // ones, so a large early-winning species cannot simply swallow the
  // population. Being numerous stops being an advantage in itself.
  // ---------------------------------------------------------------------------
  // The live threshold, which drifts to keep the species count near target.
  threshold: null,

  speciate(scored) {
    if (this.threshold === null) this.threshold = CONFIG.genome.compatibilityThreshold;
    const threshold = this.threshold;
    const species = [];

    for (const s of scored) {
      let placed = false;
      for (const sp of species) {
        if (s.brain.distance(sp.rep) < threshold) { sp.members.push(s); placed = true; break; }
      }
      if (!placed) species.push({ rep: s.brain, members: [s] });
    }
    return species;
  },

  // The Stage 7 breeder. Same four steps as before - score, select, copy,
  // mutate - but selection happens WITHIN a species, and how many children
  // each species gets depends on its mean fitness.
  breedSpeciated(scored, rng) {
    const cfg = CONFIG.evolution;
    const gcfg = CONFIG.genome;
    const n = scored.length;

    const species = this.speciate(scored);

    // Nudge the threshold towards the target species count. Too many species
    // means the bar for "different" is too low, so raise it, and vice versa.
    const gc = CONFIG.genome;
    if (species.length > gc.targetSpecies) this.threshold += gc.thresholdStep;
    else if (species.length < gc.targetSpecies) this.threshold = Math.max(0.03, this.threshold - gc.thresholdStep);

    for (const sp of species) {
      sp.members.sort((a, b) => b.fitness - a.fitness);
      // Mean, not total: this IS the fitness sharing.
      sp.score = sp.members.reduce((a, m) => a + m.fitness, 0) / sp.members.length;
    }

    const totalScore = species.reduce((a, sp) => a + sp.score, 0) || 1;

    const brains = [];
    const events = [];

    for (const sp of species) {
      let quota = Math.round(n * sp.score / totalScore);
      if (quota <= 0) continue;

      // Each species keeps its own champion untouched.
      for (let i = 0; i < gcfg.speciesElites && i < sp.members.length && quota > 0; i++) {
        brains.push(sp.members[i].brain.clone());
        quota--;
      }

      while (quota-- > 0 && brains.length < n) {
        const a = this.tournament(sp.members, rng, cfg.tournamentSize);
        let child;

        if (CONFIG.crossover.enabled && sp.members.length > 1 &&
            rng.next() < CONFIG.crossover.rate) {
          const b = this.tournament(sp.members, rng, cfg.tournamentSize);
          // The fitter parent goes first - it is the one whose private genes
          // the child inherits whole.
          const [fit, other] = a.fitness >= b.fitness ? [a, b] : [b, a];
          child = fit.brain.crossover(other.brain, rng, CONFIG.crossover.scheme);
        } else {
          child = a.brain.clone();
        }

        const changes = child.mutate(rng, cfg.mutationRate, cfg.mutationStrength);
        if (changes && changes.length) for (const c of changes) events.push(c);
        brains.push(child);
      }
    }

    // Rounding can leave us a little short or long. Top up from the overall
    // best, and trim from the end if we overshot.
    const ranked = scored.slice().sort((a, b) => b.fitness - a.fitness);
    while (brains.length < n) {
      const child = ranked[brains.length % ranked.length].brain.clone();
      const changes = child.mutate(rng, cfg.mutationRate, cfg.mutationStrength);
      if (changes && changes.length) for (const c of changes) events.push(c);
      brains.push(child);
    }
    brains.length = n;

    return { brains, events, speciesCount: species.length };
  },
  // ---------------------------------------------------------------------------
  // SHOALING - mean distance from each fish to its nearest neighbour.
  // ---------------------------------------------------------------------------
  // Lower means tighter grouping. Nothing in this project rewards grouping, and
  // nothing implements it; if this number falls as generations pass, the fish
  // discovered that staying near others helps them survive. If it does not
  // fall, they did not, and saying so is the whole point of measuring it.
  // ---------------------------------------------------------------------------
  shoaling(fish) {
    const live = [];
    for (const f of fish) if (f.alive) live.push(f);
    if (live.length < 2) return 0;

    let total = 0;
    for (const a of live) {
      let best = Infinity;
      for (const b of live) {
        if (a === b) continue;
        const d = V.dist2(a.x, a.y, b.x, b.y);
        if (d < best) best = d;
      }
      total += Math.sqrt(best);
    }
    return total / live.length;
  },
};
