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
// It remains brainless. The only extra rule breaks repeated circular pursuit.
// =============================================================================

class Shark {

  constructor(x, y, heading) {
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
  }

  update(dt, world) {
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
