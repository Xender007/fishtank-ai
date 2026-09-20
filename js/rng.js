// =============================================================================
// rng.js - a random number generator we control.
// =============================================================================
// Math.random() is seeded by the browser and cannot be reset. That is fine for
// a game, and useless for us: when a generation of fish evolves into something
// interesting, you want to be able to RUN IT AGAIN and see the same thing.
//
// So we use our own generator ("mulberry32"). Give it the same seed number and
// it produces the same sequence of numbers forever. Change CONFIG.seed and you
// get a completely different ocean.
//
// You do not need to understand the bit-twiddling inside next(). It is a
// standard recipe for turning one integer into a well-scrambled next integer.
// =============================================================================

class Rng {
  constructor(seed) {
    this.state = seed >>> 0;          // >>> 0 forces it to an unsigned 32-bit int
  }

  // The core: a number in [0, 1), like Math.random().
  next() {
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Everything below is convenience built on next().
  range(lo, hi) { return lo + this.next() * (hi - lo); }   // a float in [lo, hi)
  int(n)        { return Math.floor(this.next() * n); }    // an int in [0, n)
  angle()       { return this.next() * Math.PI * 2; }      // a random direction
  sign()        { return this.next() < 0.5 ? -1 : 1; }
}

// -----------------------------------------------------------------------------
// A bell-curve random number (mean 0, standard deviation 1), by the Box-Muller
// transform: two uniform numbers in, one normally distributed number out.
//
// Mutation uses this rather than a uniform range because the two do very
// different jobs. Uniform noise makes a tiny tweak exactly as likely as a
// wild swing. A bell curve makes most mutations small - refining a brain that
// already half works - while still occasionally throwing a big one that
// explores somewhere genuinely new. Evolution needs both, in that proportion.
// -----------------------------------------------------------------------------
Rng.prototype.gaussian = function () {
  let u = 0, v = 0;
  while (u === 0) u = this.next();        // log(0) is -Infinity, so reject 0
  while (v === 0) v = this.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
