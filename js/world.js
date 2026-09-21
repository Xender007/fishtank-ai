// =============================================================================
// world.js - the tank, and everything in it.
// =============================================================================
// This class owns the STATE and advances it. It never draws. Not once.
// render.js reads this object and never writes to it.
//
// Keeping that line clean is what lets Stage 4 evolve 200 generations in a few
// seconds: we simply call world.update() thousands of times and skip drawing
// entirely. A simulation that secretly depended on being rendered could not do
// that.
// =============================================================================

class World {

  constructor() {
    this.w = CONFIG.tank.w;
    this.h = CONFIG.tank.h;

    // The world owns the random generator. Everything random in the sim pulls
    // from THIS, never from Math.random(), so one seed reproduces one universe.
    this.rng = new Rng(CONFIG.seed);

    // Innovation numbering is global and must start fresh with each run, or a
    // reloaded world would inherit serial numbers from the previous one.
    //
    // The trainer sets World.keepInnovation because it builds thousands of
    // throwaway worlds to evaluate brains in, and resetting the numbering
    // between them would destroy the shared history that crossover and
    // speciation depend on.
    if (!World.keepInnovation) Innovation.reset();

    // Which brain is driving. Lives on the WORLD and not in main.js view
    // state, because unlike the mouse cursor it genuinely changes what the
    // fish do. If it changes the sim, it belongs to the sim.
    //   "network" - Stage 3: a random 7 -> 6 -> 2 network per fish
    //   "neuron"  - Stage 2: the hand-wired single neuron
    //   "wander"  - Stage 0: random drift
    this.mode = CONFIG.brain.enabled ? "network" : "wander";

    this.generation = 1;

    // One summary row per completed generation: { generation, best, mean }.
    // This is what chart.js draws, and it is the only place you can actually
    // SEE learning happen - individual fish tell you nothing.
    this.history = [];
    this.lastSummary = null;

    // Plain-English record of every structural change, newest last. This is
    // where you watch brains actually grow: "+node splitting ray +40 -> turn".
    this.mutationLog = [];
    this.speciesCount = 1;
    // Continuous-life bookkeeping. `births` and `deepestGeneration` are what
    // replace a generation counter when the clock never resets.
    this.births = 0;
    this.deepestGeneration = 1;
    this.nextFishId = 0;
    this.extinct = false;
    this.lastSample = 0;

    this.bestBrain = null;
    this.bestFitness = 0;

    // The brain the sharks in THIS tank run, or null for the brainless chaser.
    // It lives on the world because it changes the simulation. See
    // setSharkBrain(). Starved sharks become corpses and are replaced.
    this.sharkBrain = null;
    this.sharkCorpses = [];
    this.sharkRespawns = [];    // times (world.time) at which to add a shark
    this.starvations = 0;       // across all rounds, like totalKills

    // Set on the shark trainer's private tanks: simulate only. No generation
    // flip, no breeding, no respawn - a starved shark simply ends the trial.
    this.evaluationOnly = false;

    // Which repeat of the current generation we are on. See nextGeneration().
    this.trial = 1;
    this.totalKills = 0; // across ALL rounds. Note the shark itself is rebuilt
                         // by spawn() each round, so shark.kills is per-round;
                         // this one survives, which is what you want to watch.

    // We count TICKS (a whole number) and derive seconds from them, rather
    // than accumulating seconds directly. Reason: 1/60 cannot be stored
    // exactly in binary, so adding it 1800 times gives 29.999999999999996,
    // not 30 - and a round that is meant to end at exactly 30s silently
    // does not. Integers do not drift. In Stage 4 this same counter decides
    // when a GENERATION ends, so it has to be exact.
    this.ticks = 0;
    this.time = 0;       // seconds elapsed in the current round (display only)
    this.generationTicks = Math.round(CONFIG.sim.generationSeconds / CONFIG.sim.dt);
    this.spawn();
  }

  // ---------------------------------------------------------------------------
  // Fill the tank.
  // ---------------------------------------------------------------------------
  // `brains` is an array of networks to install, one per fish, or null to make
  // fresh random ones. Generation 1 passes null; every generation after that
  // passes the children bred from the generation before. That single argument
  // is the difference between a simulation and a learning system.
  spawn(brains) {
    // Spawn with a margin so nobody starts jammed into a wall. Declared HERE,
    // outside the loop, because the shark spawn below needs it too.
    const m = 40;

    this.fish = [];
    for (let i = 0; i < CONFIG.fish.count; i++) {
      this.fish.push(new Fish(
        this.rng.range(m, this.w - m),
        this.rng.range(m, this.h - m),
        this.rng.angle(),
        this.rng.angle(),          // tail-beat offset, cosmetic only
        brains ? brains[i] : World.newBrain(this.rng)
      ));
    }

    // Sharks spawn at RANDOM positions each time, not a fixed corner. A fixed
    // start lets fish evolve against one specific opening move instead of
    // learning to escape, and it correlates every trial with every other.
    this.sharks = [];
    for (let i = 0; i < CONFIG.shark.count; i++) {
      this.sharks.push(new Shark(
        this.rng.range(m, this.w - m),
        this.rng.range(m, this.h - m),
        this.rng.angle(),
        this.sharkBrain ? this.sharkBrain.clone() : null
      ));
    }
    this.sharkCorpses = [];
    this.sharkRespawns = [];
    // Kept so older code and the readouts can still say "the shark".
    this.shark = this.sharks[0];
    this.nextFishId = 0;
    this.fish.forEach(f => { f.id = this.nextFishId++; });
    this.packs = [];
    if (Schooling.active(this)) Schooling.organise(this);
  }

  // ---------------------------------------------------------------------------
  // One fixed slice of time. dt is ALWAYS CONFIG.sim.dt.
  // ---------------------------------------------------------------------------
  update(dt) {
    Schooling.prepare(this);
    for (const f of this.fish) f.update(dt, this);
    for (const s of this.sharks) s.update(dt, this);
    if (this.sharkBrain) this.handleStarvation();
    // Packs only change when somebody is eaten. organise() filters, sorts and
    // re-elects an alpha for every pack, and running it unconditionally meant
    // doing all of that TWICE per tick - once here and once inside prepare()
    // at the top of the next tick - on a population that had not changed.
    const caught = this.resolveEating();
    if (caught && Schooling.active(this)) Schooling.organise(this);

    this.ticks++;
    this.time = this.ticks * dt;
    if (this.evaluationOnly) return;

    // ---- continuous mode: no generation boundary at all ----
    if (CONFIG.life.continuous) {
      this.breedContinuously(dt);
      if (caught && Schooling.active(this)) Schooling.organise(this);

      if (this.time - this.lastSample >= CONFIG.life.sampleSeconds) {
        this.lastSample = this.time;
        this.sampleContinuous();
      }
      return;   // the clock keeps running; nothing is culled on a schedule
    }

    // A round ends when everyone is eaten, or the clock runs out. The clock
    // matters: without it, one lucky fish hiding in a corner could stall the
    // whole simulation forever, and in Stage 4 that would stall EVOLUTION.
    if (this.aliveCount() === 0 || this.ticks >= this.generationTicks) {
      this.nextGeneration();
    }
  }

  // ---------------------------------------------------------------------------
  // THE SHARK'S BRAIN - install, replace or remove it.
  // ---------------------------------------------------------------------------
  // null restores the brainless chaser. Live sharks keep their bodies and only
  // swap drivers; each gets its own clone so their live activations differ.
  setSharkBrain(brain) {
    this.sharkBrain = brain || null;
    for (const s of this.sharks) s.setBrain(brain ? brain.clone() : null);
    // Switching the brain off also switches off starvation, so anybody who
    // was waiting to be replaced comes back now.
    if (!brain) while (this.sharks.length < CONFIG.shark.count) this.addShark();
    if (!brain) this.sharkRespawns = [];
  }

  addShark() {
    const m = 40;
    const s = new Shark(this.rng.range(m, this.w - m), this.rng.range(m, this.h - m),
                        this.rng.angle(), this.sharkBrain ? this.sharkBrain.clone() : null);
    this.sharks.push(s);
    this.shark = this.sharks[0];
    return s;
  }

  // A starved shark leaves the hunt: it is taken out of world.sharks, so no fish
  // sense, alarm or planner ever reacts to a dead predator, and kept as a
  // fading corpse for the renderer. A replacement arrives after a short pause.
  handleStarvation() {
    for (let i = this.sharks.length - 1; i >= 0; i--) {
      const s = this.sharks[i];
      if (s.alive) continue;
      this.sharks.splice(i, 1);
      this.starvations++;
      if (this.evaluationOnly) continue;
      this.sharkCorpses.push({ x: s.x, y: s.y, heading: s.heading, age: s.age,
                               kills: s.kills, diedAt: this.time });
      if (this.sharkCorpses.length > 6) this.sharkCorpses.shift();
      this.sharkRespawns.push(this.time + CONFIG.sharkBrain.respawnSeconds);
    }
    this.shark = this.sharks[0] || null;
    for (let i = this.sharkRespawns.length - 1; i >= 0; i--) {
      if (this.time < this.sharkRespawns[i]) continue;
      this.sharkRespawns.splice(i, 1);
      this.addShark();
    }
  }

  // A fresh brain of whichever kind is configured. "genome" starts as small as
  // a brain can be - inputs wired straight to outputs, no hidden neurons - and
  // grows. "layered" is the fixed 7-6-2 network from Stage 3.
  static newBrain(rng) {
    return CONFIG.genome.kind === 'genome' ? Genome.minimal(rng) : Network.random(rng);
  }

  // Restart the population from a single brain: one untouched copy, and the
  // rest mutated children of it. Used when loading a saved fish, so a good
  // brain becomes the ancestor of a whole new run rather than one lucky
  // individual lost in a crowd of strangers.
  seedFrom(brain, mutate) {
    if (brain.conns) Innovation.absorb(brain);

    // MEASURED: jittering the children of a trained champion costs it dearly.
    // 16 fish over 60s, share of the tank eaten:
    //   mutation 0    -> 29%      mutation 0.15 -> 49%
    //   mutation 0.05 -> 34%      mutation 0.35 -> 48%
    // So when we are DISPLAYING a trained brain we clone it exactly; only when
    // we are about to evolve from it do the children get jittered.
    const cfg = CONFIG.evolution;
    const brains = [brain.clone()];
    while (brains.length < CONFIG.fish.count) {
      const child = brain.clone();
      if (mutate !== false) child.mutate(this.rng, cfg.mutationRate, cfg.mutationStrength);
      brains.push(child);
    }

    this.generation = 1;
    this.ticks = 0;
    this.time = 0;
    this.history = [];
    this.mutationLog = [];
    this.lastSummary = null;
    Evolution.threshold = null;
    this.spawn(brains);
  }


  // ---------------------------------------------------------------------------
  // CONTINUOUS LIFE - breeding without a generation boundary.
  // ---------------------------------------------------------------------------
  // Every mature fish has a small chance each tick of producing one offspring:
  // a child of itself and the nearest mature neighbour, born small and clumsy
  // beside its parent. The chance shrinks as the tank fills (carrying capacity).
  //
  // Note what is NOT here. Nothing scores anybody, nothing is culled, no
  // tournament is run. Selection happens because fish that survive longer get
  // more chances to breed, and fish that are eaten get none. That
  // is the whole mechanism, and it is a good deal closer to how selection
  // actually works than a synchronised cull on a timer.
  // ---------------------------------------------------------------------------
  breedContinuously(dt) {
    const cfg = CONFIG.life;
    this.clearOldCorpses();
    const evoCfg = CONFIG.evolution;
    const live = [];
    for (const f of this.fish) if (f.alive) live.push(f);

    if (live.length === 0) {
      // Everything died. There is no next generation and nothing to breed from.
      if (!this.extinct) {
        this.extinct = true;
        this.extinctAt = this.time;
      }
      return;
    }
    this.extinct = false;

    if (live.length >= cfg.maxPopulation) return;

    // CARRYING CAPACITY - logistic growth, the textbook model of a population
    // meeting the limits of its habitat. Each adult breeds at random, at a rate
    // that shrinks as the tank fills and reaches zero at maxPopulation.
    //
    // This replaced banked breeding energy. Energy built at full rate right up
    // to the cap, so dozens of adults sat on a stored pregnancy and every fish
    // the shark ate was replaced within a tick: the count read 70/70 and looked
    // frozen. And because a colony started with every adult on zero energy,
    // they all filled up in lockstep and bred in the same half-second, 41 -> 70
    // at once. A per-tick chance has no memory, so neither can happen: losses
    // show, and the colony recovers over seconds.
    const crowding = 1 - live.length / cfg.maxPopulation;
    const chance = dt * crowding / cfg.breedEnergy;

    for (const parent of live) {
      if (parent.maturity() < cfg.breedMaturity) continue;
      if (this.rng.next() >= chance) continue;

      // Nearest mature neighbour, if there is one in range.
      let mate = null, best = cfg.breedRange * cfg.breedRange;
      for (const other of live) {
        if (other === parent || other.maturity() < cfg.breedMaturity) continue;
        const d = V.dist2(parent.x, parent.y, other.x, other.y);
        if (d < best) { best = d; mate = other; }
      }

      let brain;
      if (mate && CONFIG.crossover.enabled && this.rng.next() < CONFIG.crossover.rate) {
        // The fitter parent goes first - here that means the one that has
        // survived longer, since nothing else has scored them.
        const [a, b] = parent.age >= mate.age ? [parent, mate] : [mate, parent];
        brain = a.net.crossover(b.net, this.rng, CONFIG.crossover.scheme);
      } else {
        brain = parent.net.clone();
      }
      brain.mutate(this.rng, evoCfg.mutationRate, evoCfg.mutationStrength);

      const m = 12;
      const child = new Fish(
        V.clamp(parent.x + this.rng.range(-20, 20), m, this.w - m),
        V.clamp(parent.y + this.rng.range(-20, 20), m, this.h - m),
        this.rng.angle(),
        this.rng.angle(),
        brain
      );
      child.generation = parent.generation + 1;
      child.id = this.nextFishId++;

      this.fish.push(child);
      this.births++;
      if (child.generation > this.deepestGeneration) this.deepestGeneration = child.generation;

      // One birth per tick keeps the population curve smooth and stops a
      // synchronised cohort forming, which would quietly reinvent generations.
      break;
    }
  }

  // A continuous colony is never respawned, so the dead must be removed or they
  // accumulate forever. Checked every tick but only rebuilds the array when
  // something is actually old enough to go.
  clearOldCorpses() {
    const keep = CONFIG.life.corpseSeconds;
    let stale = false;
    for (const f of this.fish) if (!f.alive && this.time - (f.diedAt || 0) > keep) { stale = true; break; }
    if (stale) this.fish = this.fish.filter(f => f.alive || this.time - (f.diedAt || 0) <= keep);
  }

  // With no generation boundaries there is nothing to hang a chart point on, so
  // the population is sampled on a timer instead.
  sampleContinuous() {
    const live = [];
    for (const f of this.fish) if (f.alive) live.push(f);
    if (!live.length) return;

    let age = 0, params = 0, hidden = 0, gen = 0, best = 0;
    for (const f of live) {
      age += f.age;
      params += f.net.paramCount();
      hidden += f.net.hiddenCount();
      gen += f.generation;
      if (f.age > best) best = f.age;
    }

    this.lastSummary = {
      generation: Math.round(gen / live.length),
      mean: age / live.length,
      best,
      params: params / live.length,
      hidden: hidden / live.length,
      species: this.speciesCount,
      population: live.length,
    };
    this.history.push(this.lastSummary);
    if (this.history.length > 500) this.history.shift();
  }

  // ---------------------------------------------------------------------------
  // THE LEARNING STEP. Everything else in this project exists to reach here.
  // ---------------------------------------------------------------------------
  nextGeneration() {
    // Evolution only means anything when the networks are actually driving.
    // In the Stage 0 and Stage 2 comparison modes we just reset the tank.
    const evolving = CONFIG.evolution.enabled && this.mode === "network";

    // DISPLAY MODE. With evolution switched off we re-run the same brains from
    // new positions rather than rolling fresh random ones. Without this, a
    // trained champion survived one generation on screen and was then thrown
    // away - and worse, leaving evolution ON degraded it outright: measured
    // 48.3s of solo survival before, 17.3s after only 12 generations on the
    // page. The page's crowd fitness rewards "do not be the nearest fish",
    // which is not escaping, so watching a champion evolve here un-trains it.
    if (!evolving && this.mode === "network") {
      const same = this.fish.map(f => f.net);
      this.generation++;
      this.ticks = 0;
      this.time = 0;
      this.spawn(same);
      return;
    }

    let brains = null;

    if (evolving) {
      // -----------------------------------------------------------------------
      // TRIAL AVERAGING - the fix for a score made of luck.
      // -----------------------------------------------------------------------
      // MEASURED: sixty copies of ONE brain scored with a standard deviation of
      // 24.5s - identical to sixty DIFFERENT brains. Every scrap of the spread
      // selection was reading came from where a fish happened to spawn and
      // whether a shark happened to come at it. Selection was sorting luck.
      //
      // So each brain is now run several times, from fresh positions with the
      // sharks somewhere new, and its fitness is the MEAN. Averaging n
      // independent trials cuts the noise by a factor of sqrt(n) while leaving
      // real skill untouched - which is the whole point, because skill is the
      // part that repeats.
      //
      // It costs exactly what it sounds like: trials times the compute per
      // generation. That is the trade. A noisy score is not cheaper than an
      // expensive one; it just fails later and less obviously.
      // -----------------------------------------------------------------------
      for (const f of this.fish) {
        f.net.scoreSum = (f.net.scoreSum || 0) + Evolution.fitness(f);
      }

      if (this.trial < CONFIG.evolution.trials) {
        this.trial++;
        const again = this.fish.map(f => f.net);   // the SAME brains
        this.ticks = 0;
        this.time = 0;
        this.spawn(again);                         // ...new positions, new sharks
        return;                                    // not a new generation yet
      }
      this.trial = 1;
      // SCORE. Note this includes the dead - their final `age` is their score,
      // and in evolution the dead are most of your data.
      const trials = CONFIG.evolution.trials;
      const scored = this.fish.map(f => ({
        brain: f.net,
        fitness: f.net.scoreSum / trials,
      }));
      // Clear the accumulator. Children get a fresh one anyway, since clone()
      // builds a new object, but the elites are these very brains carried over.
      for (const f of this.fish) f.net.scoreSum = 0;

      // Keep the champion of the generation we just scored, BEFORE the tank is
      // repopulated. A moment later every fish here is a newborn with an age of
      // zero, and this brain would be unfindable.
      let bb = null, bf = -Infinity;
      for (const s of scored) if (s.fitness > bf) { bf = s.fitness; bb = s.brain; }
      this.bestBrain = bb;
      this.bestFitness = bf;

      const summary = Evolution.summarise(scored, this.generation);

      // Average brain SIZE, so the chart can show whether growing parameters
      // is actually buying anything.
      let params = 0, hidden = 0;
      for (const s of scored) { params += s.brain.paramCount(); hidden += s.brain.hiddenCount(); }
      summary.params = params / scored.length;
      summary.hidden = hidden / scored.length;

      // SELECT, COPY, MUTATE.
      if (CONFIG.genome.kind === 'genome' && CONFIG.genome.useSpecies) {
        const result = Evolution.breedSpeciated(scored, this.rng);
        brains = result.brains;
        this.speciesCount = result.speciesCount;
        for (const e of result.events) {
          this.mutationLog.push({ generation: this.generation, text: e });
        }
        if (this.mutationLog.length > 400) this.mutationLog.splice(0, this.mutationLog.length - 400);
      } else {
        brains = Evolution.breed(scored, this.rng);
        this.speciesCount = 1;
      }

      summary.species = this.speciesCount;
      this.lastSummary = summary;
      this.history.push(summary);
      if (this.history.length > 500) this.history.shift();
    }

    this.generation++;
    this.ticks = 0;
    this.time = 0;
    this.spawn(brains);
  }

  // ---------------------------------------------------------------------------
  // THE TANK WALL. This is the glide.
  // ---------------------------------------------------------------------------
  // We clamp POSITION and leave HEADING completely alone. That one choice is
  // the whole behaviour:
  //
  //   - the component of motion pointing INTO the wall gets absorbed, because
  //     the clamp keeps overwriting it back to the wall,
  //   - the component running ALONG the wall is untouched, so the body keeps
  //     sliding,
  //   - and because the heading was never altered, the moment the body turns
  //     away it peels off the wall naturally.
  //
  // Adding a heading reflection here would make things BOUNCE. We do not want
  // that: a bounce is free energy, and in Stage 4 evolution would discover it
  // and build fish that pinball around the tank instead of learning to escape.
  //
  // `radius` keeps the body's edge inside the glass rather than its centre.
  // Nothing can ever leave this box, and nothing wraps to the far side.
  // ---------------------------------------------------------------------------
  keepInsideTank(body, radius) {
    const before_x = body.x, before_y = body.y;

    body.x = V.clamp(body.x, radius, this.w - radius);
    body.y = V.clamp(body.y, radius, this.h - radius);

    // Did the clamp actually have to move it? Then it is pressed against glass.
    // Stage 0 only uses this to tint the fish. Stage 1 feeds it to the brain.
    body.touchingWall = (body.x !== before_x || body.y !== before_y);
  }

  // ---------------------------------------------------------------------------
  // Did the shark catch anybody this tick?
  // ---------------------------------------------------------------------------
  // Returns how many fish were caught this tick, so callers can skip work
  // that only matters when the population actually changed.
  resolveEating() {
    let caught = 0;
    // Each fish carries its own radius now: a baby is a smaller target, which
    // is the only physical advantage it has while it grows.
    const sharkR = CONFIG.shark.radius;
          // compare squared, skip the sqrt

    for (const f of this.fish) {
      if (!f.alive) continue;
      for (const s of this.sharks) {
        const reach = sharkR + f.radius();
        if (V.dist2(f.x, f.y, s.x, s.y) >= reach * reach) continue;
        f.alive = false;
        f.diedAt = this.time;
        s.kills++;
        s.hunger = 0;            // a meal resets the starvation clock
        this.totalKills++;
        caught++;
        break;
        // NOTE: we do not remove it from the array. The corpse stays, holding
        // its final `age`. In Stage 4 that number is its fitness score - the
        // dead have to be scoreable, because in evolution the dead are most of
        // your data.
      }
    }
    return caught;
  }

  // ---------------------------------------------------------------------------
  // Helpers the shark and the renderer ask for.
  // ---------------------------------------------------------------------------
  nearestLivingFish(x, y) {
    let best = null;
    let bestD2 = Infinity;
    for (const f of this.fish) {
      if (!f.alive) continue;
      const d2 = V.dist2(x, y, f.x, f.y);
      if (d2 < bestD2) { bestD2 = d2; best = f; }
    }
    return best;   // null if the tank has been cleared
  }

  aliveCount() {
    let n = 0;
    for (const f of this.fish) if (f.alive) n++;
    return n;
  }
}
