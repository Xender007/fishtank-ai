// =============================================================================
// fish.js - one small fish.
// =============================================================================
// The body accepts just turn and thrust. The network supplies a learned reflex;
// Schooling adds shared warnings, remembered threats and route planning. The
// older neuron and wander modes are retained for comparison.
// =============================================================================

class Fish {

  // `net` arrives from outside rather than being built in here. In Stage 3 the
  // world hands over a random one; in Stage 4 it hands over an INHERITED one.
  // Nothing else about this class has to change for that to work.
  constructor(x, y, heading, wigglePhase = 0, net = null) {
    this.x = x;
    this.y = y;
    this.heading = heading;    // radians. Which way the nose points.

    // Purely cosmetic: where this fish is in its tail-beat cycle. Without a
    // per-fish offset all 60 fish flick their tails in perfect unison, which
    // looks like a screensaver rather than a shoal. render.js reads this; the
    // simulation never does.
    this.wigglePhase = wigglePhase;
    this.speed = 0;            // current pixels/second

    this.alive = true;

    // Lineage depth. In continuous mode there are no generation boundaries,
    // so this is what 'generation' means: how many ancestors deep this fish
    // is, which keeps climbing while the clock never resets.
    this.generation = 1;
    this.energy = 0;           // spent on offspring; see World.breedContinuously
    this.age = 0;              // seconds survived. In Stage 4 this becomes
                               // FITNESS - the number evolution optimises.

    this.touchingWall = false; // set by the tank each tick; drawn in Stage 0,
                               // fed to the brain as a SENSE in Stage 1.

    // ---- what this fish perceives, refreshed every tick ----
    // Allocated ONCE here and overwritten in place, never reallocated. See the
    // note in senses.js about why that matters when evolution runs the
    // simulation hundreds of thousands of times.
    this.senses = new Float64Array(Senses.COUNT);   // the 7 numbers, all 0..1
    this.rayHit = new Float64Array(CONFIG.senses.rayCount).fill(-1);
                                                    // hit distance per ray,
                                                    // -1 = saw nothing. Purely
                                                    // so render.js can draw it.

    // ---- the brain (Stage 2) ----
    // One neuron, steering only. Every fish gets its OWN Neuron object even
    // though they all share the same weights array from CONFIG - because each
    // one needs to remember its own last sum for the readout panel.
    // In Stage 4 that shared array is exactly what stops being shared: each
    // fish inherits its own mutated copy, and they stop being identical.
    this.net = net;                       // the Stage 3 network: 7 -> 6 -> 2
    this.handNeuron = new Neuron(CONFIG.brain.turnWeights, CONFIG.brain.turnBias);
                                          // the Stage 2 hand-wired one, kept
                                          // so you can A/B the two with B

    // The last decision made, whichever brain made it. render.js reads these
    // rather than reaching into a particular brain, so the rudder indicator
    // works in every mode.
    this.lastTurn = 0;
    this.lastThrust = 0;

    this._wanderTurn = 0;      // the old random wander, kept for comparison
    this.id = -1;
    this.pack = null;
    this.packId = null;
    this.isAlpha = false;
    this.threat = null;
    this.alarm = 0;
    this.behaviour = 'schooling';
    this.socialDecision = null;
    this.escapeDecision = null;
    this.escapePlan = null;    // last evaluated route, read-only to the inspector
  }

  // ---------------------------------------------------------------------------
  // THINK: senses in, decision out.
  // ---------------------------------------------------------------------------
  // Returns exactly two numbers:
  //     turn   in [-1, +1]   -1 = hard left, 0 = straight, +1 = hard right
  //     thrust in [ 0, +1]    0 = coast,     1 = full speed
  //
  // These two numbers are the ONLY control a fish has over its own fate.
  // In Stage 3 they become the two output neurons of a neural network, and
  // this method becomes roughly: `return this.brain.forward(this.senses())`.
  //
  // As of Stage 1 the senses ARE available here, in this.senses - seven
  // numbers, already normalised, already egocentric. Everything a brain will
  // ever need is sitting in that array right now.
  //
  // And this method still ignores it completely and wanders at random. That is
  // deliberate: senses without a brain change nothing, which is worth seeing
  // with your own eyes before we add the brain in Stage 3. It also gives us a
  // baseline of "no intelligence at all" to measure learning against - you
  // cannot see improvement without a "before".
  // ---------------------------------------------------------------------------
  // 0 at birth, 1 when fully grown. Everything a fish is worse at as a baby
  // derives from this one number.
  maturity() {
    if (!CONFIG.life.continuous) return 1;
    return V.clamp(this.age / CONFIG.life.matureSeconds, 0, 1);
  }

  // Babies are smaller, which matters for collisions as well as drawing: a
  // small fish is a smaller target, which is the one advantage it has.
  radius() {
    const m = this.maturity();
    if (m >= 1) return CONFIG.fish.radius;
    const b = CONFIG.life.babySize;
    return CONFIG.fish.radius * (b + (1 - b) * m);
  }

  think(world) {
    // Press B in the browser to cycle the three brains and compare them
    // directly. Being able to A/B them is most of the value of having built
    // all three.
    switch (world.mode) {

      // Run the learned network every tick for a candidate escape turn and
      // live inspector activations; the social controller selects movement.
      case "network":
        return Schooling.decide(this, world, this.net.decide(this.senses));

      // STAGE 2: the hand-wired single neuron. Measured to be worse than the
      // drunkard below - see the table in config.js.
      case "neuron":
        return { turn: this.handNeuron.fire(this.senses), thrust: 1 };

      // STAGE 0: the drunkard. Still, embarrassingly, the one to beat.
      default:
        if (world.rng.next() < 0.02) {
          this._wanderTurn = world.rng.range(-1, 1);
        }
        return { turn: this._wanderTurn, thrust: 1 };
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE: one fixed slice of time. `dt` is ALWAYS CONFIG.sim.dt (1/60 s).
  // ---------------------------------------------------------------------------
  update(dt, world) {
    if (!this.alive) return;   // corpses do not swim

    // PERCEIVE, then decide. Always this order: the decision must be made from
    // senses read this tick, not last tick.
    Senses.read(this, world);

    const decision = this.think(world);

    // 1. TURN. Note how the decision is clamped and then scaled by turnRate.
    //    A brain can ask for anything; physics decides what it actually gets.
    //    Multiplying by dt is what makes turnRate mean "radians per SECOND"
    //    rather than "radians per frame" - so the fish behaves identically
    //    whether your monitor runs at 60Hz or 144Hz.
    // Remember what was decided, for the rudder indicator and the panel.
    this.lastTurn = decision.turn;
    this.lastThrust = decision.thrust;

    const turn = V.clamp(decision.turn, -1, 1);
    // A baby's body cannot do what its brain asks. It inherits the reflexes
    // of its parents and none of the power to execute them, which is exactly
    // why it needs the school.
    const m = this.maturity();
    const turnScale = m >= 1 ? 1 : CONFIG.life.babyTurn + (1 - CONFIG.life.babyTurn) * m;
    const speedScale = m >= 1 ? 1 : CONFIG.life.babySpeed + (1 - CONFIG.life.babySpeed) * m;

    this.heading = V.wrapAngle(this.heading + turn * CONFIG.fish.turnRate * turnScale * dt);

    // 2. THRUST.
    this.speed = V.clamp(decision.thrust, 0, 1) * CONFIG.fish.maxSpeed * speedScale;

    // 3. MOVE - forwards along the nose, and only ever forwards.
    //    This is the "no strafing" rule that makes the control problem real.
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;

    // 4. The tank pushes back. See world.keepInsideTank() for why this
    //    produces a GLIDE along the wall rather than a bounce off it.
    world.keepInsideTank(this, this.radius());

    this.age += dt;
  }
}
