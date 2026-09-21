// =============================================================================
// sharktrainer.js - the shark teaches itself, against the champion fish.
// =============================================================================
// The same loop that trained the fish, pointed the other way:
//
//   1. A population of shark brains.
//   2. Each one hunts, alone, in a private tank full of CLONES OF THE CHAMPION
//      FISH - the best escape brain this project has produced, running the
//      same schooling planner the visible tank uses.
//      Even trials face the champion's bare neural reflex, odd trials face the
//      full schooling planner (see reflexTrial below for why).
//   3. Score = fish eaten, plus small tie-breakers. The survival instinct is
//      live here too: a shark that goes starveSeconds without a meal dies,
//      and its trial ends right there.
//   4. The best breed. Repeat.
//
// Lessons from the fish, applied from the start rather than rediscovered:
//   - Every candidate in a generation faces the SAME seeds (same spawn points,
//     same fish), so differences in score are differences in brains, not luck
//     (finding #2). The seeds change every generation so nothing overfits one
//     opening.
//   - Elites are re-scored every generation on the new seeds instead of
//     keeping an old lucky score.
//   - The evaluation tanks never evolve anything (invariant #6): they are
//     flagged evaluationOnly and cannot flip a generation.
//
// Runs identically in Node (train-shark.js) and in the page, where it gets a
// few milliseconds of every animation frame.
// =============================================================================

class SharkTrainer {

  // opts: { fishBrain, startBrain?, startGeneration?, seed?, settings? }
  constructor(opts) {
    this.cfg = Object.assign({}, CONFIG.sharkBrain.train, opts.settings || {});
    this.fishBrain = opts.fishBrain;
    this.rng = new Rng(opts.seed || 20260921);
    this.baseSeed = opts.seed || 20260921;
    this.generation = opts.startGeneration || 0;     // last COMPLETED generation
    this.onGeneration = opts.onGeneration || null;

    const c = this.cfg;
    this.population = [];
    for (let i = 0; i < c.population; i++) {
      if (!opts.startBrain) this.population.push(SharkBrain.random(this.rng));
      else if (i === 0) this.population.push(opts.startBrain.clone());   // keep the parent intact
      else this.population.push(opts.startBrain.clone().mutate(this.rng, c.mutationRate, c.mutationStrength));
    }
    this.resetScores();
    this.world = null;
    this.depth = 0;
    this.pageSchooling = CONFIG.schooling.enabled;
  }

  resetScores() {
    this.scores = new Float64Array(this.cfg.population);
    this.kills = new Float64Array(this.cfg.population);
    this.index = 0;
    this.trial = 0;
  }

  // Changes every generation, identical for every candidate within one.
  seedFor(trial) {
    return (this.baseSeed + (this.generation + 1) * 7919 + trial * 104729) >>> 0;
  }

  // ---------------------------------------------------------------------------
  // CONFIG is global, and the evaluation tank needs a different fish count and
  // a single shark. Every touch is synchronous and restored in `finally`, so
  // the visible tank never sees the swap.
  // ---------------------------------------------------------------------------
  withTankConfig(fn) {
    const saved = [CONFIG.fish.count, CONFIG.shark.count, World.keepInnovation,
                   CONFIG.seed, CONFIG.life.continuous, CONFIG.schooling.enabled];
    // The page's own schooling setting, read only OUTSIDE any swap. Reading
    // CONFIG.schooling.enabled inside one returns the previous trial's
    // override - which once made every trial reflex-only.
    if (this.depth === 0) this.pageSchooling = CONFIG.schooling.enabled;
    this.depth++;
    try {
      CONFIG.fish.count = this.cfg.fish;
      CONFIG.shark.count = 1;
      World.keepInnovation = true;          // never reset the FISH innovation numbering
      CONFIG.life.continuous = false;       // adult fish, generational rules
      if (this.world) CONFIG.schooling.enabled = this.schoolingThisTrial;
      return fn();
    } finally {
      this.depth--;
      [CONFIG.fish.count, CONFIG.shark.count, World.keepInnovation,
       CONFIG.seed, CONFIG.life.continuous, CONFIG.schooling.enabled] = saved;
    }
  }

  // ---------------------------------------------------------------------------
  // WHY HALF THE TRIALS USE THE BARE REFLEX. MEASURED: against 12 champion fish
  // running the schooling planner, even the brainless chaser averages about
  // one catch per 30s - so with a 10s starvation clock nearly every untrained
  // brain starves with zero kills, every score ties, and selection has nothing
  // to choose between (finding #5: too hard destroys the signal exactly like
  // too easy). The same champion WITHOUT the planner is catchable, which gives
  // evolution a gradient; the schooling trials keep it honest about the fish
  // it will actually meet in the page.
  // ---------------------------------------------------------------------------
  reflexTrial(trial) { return this.cfg.mixedOpponents && trial % 2 === 0; }

  beginTrial() {
    const seed = this.seedFor(this.trial);
    this.schoolingThisTrial = this.reflexTrial(this.trial) ? false : this.pageSchooling;
    const brain = this.population[this.index];
    this.world = this.withTankConfig(() => {
      CONFIG.seed = seed;
      CONFIG.schooling.enabled = this.schoolingThisTrial;
      const w = new World();
      w.evaluationOnly = true;
      w.mode = 'network';
      w.sharkBrain = brain;
      w.rng = new Rng(seed);
      const fish = [];
      for (let i = 0; i < this.cfg.fish; i++) fish.push(this.fishBrain.clone());
      w.spawn(fish);
      return w;
    });
    this.evalShark = this.world.sharks[0];
    this.closeness = 0;
    this.samples = 0;
    this.maxTicks = Math.round(this.cfg.seconds / CONFIG.sim.dt);
  }

  // Advance up to `maxTicks` simulation ticks, stopping early at the end of a
  // generation so a caller never misses one. Returns true if one completed.
  step(maxTicks) {
    let completed = false;
    this.withTankConfig(() => {
      for (let n = 0; n < maxTicks; n++) {
        if (!this.world) {
          this.beginTrial();
          // beginTrial's own config swap has already been restored, so the
          // opponent for THIS trial must be set again for the ticks below.
          // Without this, a trial begun mid-chunk ran its reflex-only ticks
          // against schooling fish, and results depended on chunk size.
          CONFIG.schooling.enabled = this.schoolingThisTrial;
        }
        const end = this.tick();
        if (end && this.finishTrial(end.cleared)) { completed = true; break; }
      }
    });
    return completed;
  }

  // One tick of the current trial. Returns null while it runs, or
  // { cleared } when it has ended.
  tick() {
    const w = this.world;
    w.update(CONFIG.sim.dt);

    // Tie-breaker for brains that have not caught anything yet: PRESSURE,
    // how close to the nearest fish it keeps. Steep on purpose - 50px
    // matters, 300px barely registers - so near-misses outrank loitering
    // beside a school. Worth less than one real catch.
    const s = this.evalShark;
    const f = w.nearestLivingFish(s.x, s.y);
    if (f) this.closeness += Math.exp(-Math.max(0, V.dist(s.x, s.y, f.x, f.y) - CONFIG.shark.radius) / 50);
    this.samples++;

    const cleared = w.aliveCount() === 0;
    return !s.alive || cleared || w.ticks >= this.maxTicks ? { cleared } : null;
  }

  // ---------------------------------------------------------------------------
  // PARALLEL TRAINING (node, all CPU cores). A worker thread scores ONE
  // candidate with every trial of the current generation, through exactly the
  // same beginTrial/tick/trialScore code the page's time-sliced path uses, so
  // the two cannot drift apart (tests/parallel_test.js checks they agree to
  // the last bit). The main thread then hands all the scores to
  // completeGeneration(), which breeds exactly as endGeneration() always has.
  // ---------------------------------------------------------------------------
  scoreCandidate(brain) {
    const saved = [this.population, this.index, this.trial, this.world];
    let score = 0, kills = 0;
    try {
      this.population = [brain];
      for (let t = 0; t < this.cfg.trials; t++) {
        this.index = 0; this.trial = t; this.world = null;
        let end = null;
        this.withTankConfig(() => {
          this.beginTrial();
          CONFIG.schooling.enabled = this.schoolingThisTrial;
          while (!(end = this.tick())) { /* simulate */ }
        });
        const r = this.trialScore(end.cleared);
        score += r.score / this.cfg.trials;
        kills += r.kills / this.cfg.trials;
      }
    } finally {
      [this.population, this.index, this.trial, this.world] = saved;
    }
    return { score, kills };
  }

  completeGeneration(results) {
    for (let i = 0; i < this.cfg.population; i++) {
      this.scores[i] = results[i].score;
      this.kills[i] = results[i].kills;
    }
    this.endGeneration();
    return this.lastRecord;
  }

  // Budgeted version for the page: simulate until `ms` of wall clock is used.
  runFor(ms) {
    const until = performance.now() + ms;
    let completed = false;
    do { if (this.step(20)) completed = true; } while (performance.now() < until);
    return completed;
  }

  trialScore(cleared) {
    const s = this.evalShark, w = this.world;
    // Emptying the tank early counts as a full life, so a shark is never
    // punished for eating everything quickly.
    const life = cleared ? 1 : Math.min(1, w.time / this.cfg.seconds);
    return { score: s.kills + 0.8 * (this.closeness / Math.max(1, this.samples)) + 0.25 * life, kills: s.kills };
  }

  finishTrial(cleared) {
    const r = this.trialScore(cleared);
    this.scores[this.index] += r.score / this.cfg.trials;
    this.kills[this.index] += r.kills / this.cfg.trials;
    this.world = null;

    this.trial++;
    if (this.trial < this.cfg.trials) return false;
    this.trial = 0;
    this.index++;
    if (this.index < this.cfg.population) return false;
    this.endGeneration();
    return true;
  }

  // SELECT, COPY, MUTATE - exactly Stage 4 and 5.
  endGeneration() {
    const c = this.cfg, rng = this.rng;
    const order = [...this.population.keys()].sort((a, b) => this.scores[b] - this.scores[a]);
    const best = order[0];
    let mean = 0;
    for (const x of this.scores) mean += x / c.population;

    this.generation++;
    const record = {
      generation: this.generation,
      score: this.scores[best],
      kills: this.kills[best],
      mean,
      brain: this.population[best].clone(),
    };
    this.lastRecord = record;

    const pick = () => {       // tournament of three: rank only, immune to scale
      let w = rng.int(c.population);
      for (let k = 0; k < 2; k++) {
        const o = rng.int(c.population);
        if (this.scores[o] > this.scores[w]) w = o;
      }
      return this.population[w];
    };

    const next = order.slice(0, c.elites).map(i => this.population[i].clone());
    while (next.length < c.population) {
      const a = pick();
      const child = rng.next() < c.crossoverRate ? a.crossover(pick(), rng) : a.clone();
      next.push(child.mutate(rng, c.mutationRate, c.mutationStrength));
    }
    this.population = next;
    this.resetScores();
    if (this.onGeneration) this.onGeneration(record);
  }

  progress() {
    return { generation: this.generation + 1, candidate: this.index + 1,
             population: this.cfg.population, trial: this.trial + 1, trials: this.cfg.trials };
  }
}

// -----------------------------------------------------------------------------
// History of per-generation champions, as plain data. Shared by the page and
// train-shark.js so both read and write the same format.
// -----------------------------------------------------------------------------
const SharkHistory = {
  entryToJSON(r) {
    return { generation: r.generation, score: +r.score.toFixed(3), kills: +r.kills.toFixed(2),
             mean: +r.mean.toFixed(3), brain: r.brain.toJSON() };
  },

  // Returns entries with live SharkBrain objects, skipping any that no longer
  // fit the current sense layout rather than refusing the whole file.
  fromJSON(data) {
    if (!data || !Array.isArray(data.generations)) return [];
    const out = [];
    for (const e of data.generations) {
      try { out.push(Object.assign({}, e, { brain: SharkBrain.fromJSON(e.brain) })); }
      catch (err) { /* incompatible entry - skipped */ }
    }
    return out.sort((a, b) => a.generation - b.generation);
  },

  // Keep the list selectable: every generation while it is short, then the
  // first, every k-th and the most recent 20.
  thin(entries, max) {
    if (entries.length <= max) return entries;
    const recent = entries.slice(-20);
    const older = entries.slice(0, -20);
    const k = Math.ceil(older.length / (max - 20));
    return older.filter((e, i) => i % k === 0).concat(recent);
  },
};
