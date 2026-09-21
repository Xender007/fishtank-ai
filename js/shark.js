// =============================================================================
// shark.js - the predator.
// =============================================================================
// The shark is intentionally STUPID: point at the nearest fish, swim flat out.
// No planning, no anticipation, no cutting off escape routes.
//
// It has to be stupid at first, for two reasons:
//   1. If the predator is already perfect, no fish ever survives long enough
//      for evolution to get any signal at all. Learning needs survivors.
//   2. A FIXED opponent is a fair measuring stick. If the shark improved while
//      the fish improved, a rising fitness score would be ambiguous - are the
//      fish better, or did the shark just have a bad generation?
//
// By default it remains brainless. The only extra rule breaks repeated
// circular pursuit. An OPTIONAL brain (js/sharkbrain.js) can take over steering;
// a brained shark also carries the survival instinct - it starves if it goes
// CONFIG.sharkBrain.starveSeconds without eating.
// =============================================================================

class Shark {

  constructor(x, y, heading, brain) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = CONFIG.shark.maxSpeed;   // always flat out
    this.kills = 0;
    this.age = 0;                         // seconds. Only drives the tail beat.
    this.circleTurn = 0;
    this.circleSign = 0;
    this.straightTime = 0;
    this.breakRemaining = 0;
    this.breakSign = 0;
    this.circleBreaks = 0;
    // null = the classic brainless chaser. See setBrain().
    this.brain = null;
    this.alive = true;
    this.hunger = 0;          // seconds since the last meal; only a brain starves
    this.senses = new Float64Array(SharkSenses.COUNT);
    this.lastTurn = 0;
    this.lastThrust = 1;
    if (brain) this.setBrain(brain);
  }

  // Swap the driver without touching the body. A brainless shark always swims
  // flat out, so switching the brain off restores that speed.
  setBrain(brain) {
    // Swapping one brain for another (a newer trained generation) keeps the
    // hunger clock running - otherwise every swap would be a free meal. Only
    // switching between brainless and brained starts it afresh.
    if (!this.brain || !brain) this.hunger = 0;
    this.brain = brain || null;
    if (!this.brain) this.speed = CONFIG.shark.maxSpeed;
  }

  // The brain's version of update(): read the senses, run the network, apply
  // the SAME physical limits as the brainless shark - it can choose to turn,
  // never to turn faster than turnRate or swim faster than maxSpeed.
  think(dt, world) {
    const cfg = CONFIG.sharkBrain;
    SharkSenses.read(this, world, this.senses);
    const d = this.brain.decide(this.senses);
    this.lastTurn = V.clamp(d.turn, -1, 1);
    this.lastThrust = V.clamp(d.thrust, 0, 1);
    this.heading = V.wrapAngle(this.heading + this.lastTurn * CONFIG.shark.turnRate * dt);
    this.speed = CONFIG.shark.maxSpeed * (cfg.minSpeedFraction + (1 - cfg.minSpeedFraction) * this.lastThrust);
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;
    world.keepInsideTank(this, CONFIG.shark.radius);
    this.age += dt;

    // THE SURVIVAL INSTINCT. world.resolveEating() resets hunger on a catch.
    this.hunger += dt;
    if (this.hunger >= cfg.starveSeconds) { this.alive = false; this.starved = true; }
  }

  update(dt, world) {
    if (this.brain) { this.think(dt, world); return; }
    const target = world.nearestLivingFish(this.x, this.y);
    let actualTurn = 0;

    if (this.breakRemaining > 0) {
      actualTurn = this.breakSign * CONFIG.shark.turnRate * dt;
      this.breakRemaining = Math.max(0, this.breakRemaining - dt);
    } else if (target) {
      // The direction the shark WISHES it were pointing.
      const desired = V.angleTo(this.x, this.y, target.x, target.y);

      // How far it must turn to get there, taking the short way round.
      const needed = V.angleDiff(desired, this.heading);

      // ...and here is the shark's entire weakness, in one line.
      // It may only turn turnRate * dt radians this tick. If the fish is
      // directly behind it, `needed` is PI, but the shark can only chip away
      // at that a little each tick - it must swing round in a wide arc.
      //
      // A fish that learns to break across the shark's nose at the right
      // moment exploits exactly this. Nobody programs that. Evolution finds it.
      const maxStep = CONFIG.shark.turnRate * dt;
      actualTurn = V.clamp(needed, -maxStep, maxStep);
      const sign = Math.sign(actualTurn);
      if (Math.abs(actualTurn) < 0.05 * dt) {
        this.straightTime += dt;
        if (this.straightTime > 0.5) { this.circleTurn = 0; this.circleSign = 0; }
      } else {
        this.straightTime = 0;
        if (sign !== this.circleSign) this.circleTurn = 0;
        this.circleSign = sign;
        this.circleTurn += Math.abs(actualTurn);
        if (this.circleTurn > CONFIG.shark.circleLimit * Math.PI * 2) {
          this.breakSign = -sign;
          this.breakRemaining = CONFIG.shark.circleBreakSeconds;
          this.circleBreaks++;
          this.circleTurn = 0;
          this.circleSign = 0;
          actualTurn = this.breakSign * maxStep;
        }
      }
    } else {
      this.circleTurn = 0;
      this.circleSign = 0;
    }
    this.heading = V.wrapAngle(this.heading + actualTurn);

    // Move forward. Same rule as the fish: nose-first, no strafing.
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;

    // The shark is stuck in the same tank as its dinner.
    world.keepInsideTank(this, CONFIG.shark.radius);

    this.age += dt;
  }
}
