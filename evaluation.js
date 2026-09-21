// =============================================================================
// evaluation.js - scoring one brain, in whichever thread happens to run it.
// =============================================================================
// Training is almost entirely THIS: build a private tank, drop a brain in, run
// the physics, read a number off. Every brain in a generation is independent
// of every other, so the work spreads across CPU cores perfectly - that is
// what parallel.js does with it.
//
// The one rule that makes that safe: a score must depend ONLY on the job - the
// brain, the seed and the settings - and never on which thread ran it, what it
// ran before, or the order jobs finished in. So:
//
//   - every fish gets a FRESH clone of the brain (no leftover memory or
//     Hebbian traces from an earlier evaluation - a brain object that has
//     already swum carries state);
//   - every job carries the full CONFIG it must run under;
//   - brains cross the thread boundary as JSON, and Persist round-trips every
//     number that affects behaviour (tests/parallel_test.js checks the
//     results agree to the last bit with an in-thread run).
// =============================================================================

// Copy plain settings over CONFIG, section by section. Only data crosses a
// thread boundary, so this is deliberately dumb: numbers, booleans, strings,
// arrays and nested plain objects.
function applyConfig(target, source) {
  for (const key of Object.keys(source)) {
    const v = source[key];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[key] && typeof target[key] === 'object') {
      applyConfig(target[key], v);
    } else {
      target[key] = v;
    }
  }
}

function snapshotConfig(CONFIG) {
  return JSON.parse(JSON.stringify(CONFIG));
}

function makeEvaluator(S) {
  const { CONFIG, World, Persist, SharkBrain, SharkTrainer } = S;
  const asFish = b => (b && typeof b.clone === 'function' ? b : Persist.fromJSON(b));
  const asShark = b => (b && typeof b.clone === 'function' ? b : SharkBrain.fromJSON(b));

  // ---------------------------------------------------------------------------
  // FISH: mean seconds survived by a shoal of `clones` copies of one brain,
  // averaged over `trials` tanks. Trial t uses seed seedBase + t * 7919 and
  // the shark brain opponents[t % n] (null = the brainless chaser).
  // ---------------------------------------------------------------------------
  function fish(job) {
    const brain = asFish(job.brain);
    const opponents = (job.sharkBrains || []).map(b => (b ? asShark(b) : null));
    const saved = [CONFIG.fish.count, CONFIG.sim.generationSeconds, CONFIG.shark.count, CONFIG.seed];
    CONFIG.fish.count = job.clones;
    CONFIG.sim.generationSeconds = job.seconds;
    CONFIG.shark.count = job.sharks;
    try {
      let total = 0, starved = 0, eaten = 0;
      const maxTicks = Math.round(job.seconds / CONFIG.sim.dt) - 1;
      for (let t = 0; t < job.trials; t++) {
        CONFIG.seed = job.seedBase + t * 7919;          // a prime, to avoid seed patterns
        const w = new World();
        w.evaluationOnly = true;                        // invariant #6: never evolve here
        w.respawnStarvedSharks = true;                  // a starved shark is replaced, as in the page
        const opponent = opponents.length ? opponents[t % opponents.length] : null;
        if (opponent) w.setSharkBrain(opponent);
        // Hold references (invariant #5) and give every fish its own fresh copy.
        const watched = w.fish.slice();
        for (const f of watched) f.net = brain.clone();
        let ticks = 0;
        while (ticks < maxTicks && watched.some(f => f.alive)) { w.update(CONFIG.sim.dt); ticks++; }
        // The MEAN across the shoal. Scoring the best fish instead would let one
        // lucky survivor hide a massacre.
        let sum = 0;
        for (const f of watched) {
          sum += f.age;
          if (!f.alive) { if (f.starved) starved++; else eaten++; }
        }
        total += sum / watched.length;
      }
      return { fitness: total / job.trials, starved: starved / job.trials, eaten: eaten / job.trials };
    } finally {
      [CONFIG.fish.count, CONFIG.sim.generationSeconds, CONFIG.shark.count, CONFIG.seed] = saved;
    }
  }

  // ---------------------------------------------------------------------------
  // SHARK: one candidate through every trial of one generation, exactly as
  // SharkTrainer would score it inside its own loop.
  // ---------------------------------------------------------------------------
  function shark(job) {
    const trainer = new SharkTrainer({
      fishBrain: asFish(job.fishBrain),
      seed: job.baseSeed,
      startGeneration: job.generation,
      settings: Object.assign({}, job.settings, { population: 1 }),
    });
    return trainer.scoreCandidate(asShark(job.brain));
  }

  // ---------------------------------------------------------------------------
  // THE PAGE, MEASURED: `fish` copies of a fish brain against `sharks` sharks
  // (brained or not) for `seconds`, one seed. How many were eaten, how many
  // starved, how many sharks starved. Used for the co-evolution scoreboard.
  // ---------------------------------------------------------------------------
  function match(job) {
    const brain = asFish(job.brain);
    const opponent = job.sharkBrain ? asShark(job.sharkBrain) : null;
    const saved = [CONFIG.fish.count, CONFIG.shark.count, CONFIG.seed, CONFIG.sim.generationSeconds];
    CONFIG.fish.count = job.fish;
    CONFIG.shark.count = job.sharks || 1;
    CONFIG.seed = job.seed;
    CONFIG.sim.generationSeconds = job.seconds + 1;
    try {
      const w = new World();
      w.evaluationOnly = true;
      w.respawnStarvedSharks = true;
      if (opponent) w.setSharkBrain(opponent);
      const watched = w.fish.slice();
      for (const f of watched) f.net = brain.clone();
      const ticks = Math.round(job.seconds / CONFIG.sim.dt);
      // Optional: how SCHOOLED the fish are - the share of living fish with at
      // least six packmates within 140px, sampled every second after the
      // first 10s. The same definition the social-v1/v2 benchmarks used.
      let groupedSum = 0, groupedN = 0;
      for (let t = 0; t < ticks && watched.some(f => f.alive); t++) {
        w.update(CONFIG.sim.dt);
        if (job.grouped && w.ticks >= 600 && w.ticks % 60 === 0) {
          for (const f of watched) {
            if (!f.alive || !f.pack) continue;
            let near = 0;
            for (const m of f.pack.members) if (m !== f && m.alive && (m.x - f.x) ** 2 + (m.y - f.y) ** 2 <= 140 * 140) near++;
            groupedSum += near >= 6 ? 1 : 0; groupedN++;
          }
        }
      }
      let eaten = 0, starved = 0;
      for (const f of watched) if (!f.alive) { if (f.starved) starved++; else eaten++; }
      return { eaten, starved, sharkStarvations: w.starvations, fish: watched.length,
               grouped: groupedN ? groupedSum / groupedN : null, pellets: w.pelletsEaten };
    } finally {
      [CONFIG.fish.count, CONFIG.shark.count, CONFIG.seed, CONFIG.sim.generationSeconds] = saved;
    }
  }

  return { fish, shark, match };
}

module.exports = { makeEvaluator, applyConfig, snapshotConfig };
