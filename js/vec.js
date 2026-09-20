// =============================================================================
// vec.js - small 2D maths helpers.
// =============================================================================
// Note there is no Vector CLASS here, just loose functions that take plain
// numbers. That is deliberate. A Vector class would mean allocating a new
// object every time a fish moves - 60 fish x 60 ticks/sec x 50x fast-forward is
// 180,000 objects a second for the garbage collector to clean up. Plain numbers
// cost nothing. Speed matters later: evolution is just "run the sim a lot".
// =============================================================================

const V = {

  // Force a number to stay inside [lo, hi]. Used constantly - to keep fish in
  // the tank, to stop a brain output from being absurd, to cap turn rates.
  clamp(value, lo, hi) {
    return value < lo ? lo : (value > hi ? hi : value);
  },

  // Straight-line distance between two points.
  dist(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  },

  // Distance SQUARED. Skipping the square root is meaningfully faster, and when
  // you only want to know "which of these is nearest?" the comparison gives the
  // same answer either way. We use this in the shark's target search.
  dist2(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  },

  // The angle you would have to face at point A to be looking at point B.
  // Returns radians. 0 = pointing right, PI/2 = pointing DOWN (canvas Y grows
  // downward, which trips everyone up at least once).
  angleTo(ax, ay, bx, by) {
    return Math.atan2(by - ay, bx - ax);
  },

  // Fold any angle into the range [-PI, PI].
  // Without this, a fish that keeps turning left builds up a heading of 400
  // radians, and comparisons start behaving strangely.
  wrapAngle(a) {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  },

  // The SHORTEST turn that takes you from heading `from` to heading `to`.
  // Sign tells you which way: negative = turn left, positive = turn right.
  // This is why the shark turns the short way around instead of spinning 350
  // degrees the wrong way.
  angleDiff(to, from) {
    return V.wrapAngle(to - from);
  },

  lerp(a, b, t) { return a + (b - a) * t; },
};
