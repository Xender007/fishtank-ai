// =============================================================================
// senses.js - turning a world into numbers.
// =============================================================================
// This file answers one question: what does a fish KNOW?
//
// It produces seven numbers, every one of them in the range 0..1:
//
//     [0..4]  five vision rays, fanned left to right across the fish's nose.
//             0 = that ray sees nothing, 1 = the shark is right on top of it.
//     [5]     wall straight ahead. 0 = open water, 1 = nose against the glass.
//     [6]     own speed. 0 = stopped, 1 = flat out.
//
// In Stage 3 these seven numbers become the seven INPUT NEURONS. Nothing else
// about the world reaches that neural network. The newer Schooling controller
// separately reads bounded social perception and keeps short-lived memories.
//
// -----------------------------------------------------------------------------
// TWO DESIGN CHOICES WORTH UNDERSTANDING
// -----------------------------------------------------------------------------
// 1. EVERYTHING IS EGOCENTRIC. Not one of these numbers is an absolute
//    coordinate. Ray 0 always means "40 degrees off my left shoulder",
//    wherever the fish is and whichever way it faces. That is what lets a
//    single learned reflex work everywhere in the tank. Feed a network
//    absolute positions instead and it has to learn the same lesson over and
//    over for every spot on the map.
//
// 2. EVERYTHING IS NORMALISED TO 0..1. Raw values would put ray distance on a
//    0..170 scale and speed on 0..1, so the network would have to discover
//    wildly different weight magnitudes for inputs that matter equally. Same
//    scale in, comparable weights out.
// -----------------------------------------------------------------------------
// =============================================================================

const Senses = {

  // Shared by perception AND its overlay. The display must show the actual
  // scout sweep, including the short-range sense behind the fish, not invent
  // extra vision just because it looks good on a canvas.
  socialProfile(fish, time) {
    const cfg = CONFIG.schooling;
    return {
      x: fish.x, y: fish.y,
      heading: fish.heading + (fish.isAlpha ? Math.sin(time * 2 + fish.id) * 0.65 : 0),
      range: fish.isAlpha ? cfg.scoutRange : cfg.followerRange,
      halfFov: fish.isAlpha ? Math.PI * 0.78 : CONFIG.senses.fov / 2,
      nearRange: cfg.nearSense,
    };
  },

  // How many numbers a fish perceives: the rays, wall, speed, and - as of
  // Stage 8 - three more for the company it keeps.
  COUNT: CONFIG.senses.rayCount + 3 + (CONFIG.senses.neighbours ? 3 : 0),

  // Named indices, so nothing downstream ever hardcodes a number.
  WALL:  CONFIG.senses.rayCount,
  SPEED: CONFIG.senses.rayCount + 1,
  CLOSING: CONFIG.senses.rayCount + 2,  // is the nearest shark gaining on me?
  KIN:   CONFIG.senses.rayCount + 3,   // first of three: negative, ahead, positive

  // The angle of ray i relative to the fish's nose. Ray 0 is hard left, the
  // middle ray looks dead ahead, the last ray is hard right.
  rayOffset(i) {
    const n = CONFIG.senses.rayCount;
    if (n === 1) return 0;
    const step = CONFIG.senses.fov / (n - 1);
    return -CONFIG.senses.fov / 2 + i * step;
  },

  // Human-readable labels, generated from the real angles so they can never
  // drift out of sync with the maths. Used by the readout panel.
  labels() {
    const out = [];
    for (let i = 0; i < CONFIG.senses.rayCount; i++) {
      const deg = Math.round(this.rayOffset(i) * 180 / Math.PI);
      out.push('ray ' + (deg > 0 ? '+' : '') + deg + '\u00B0');
    }
    out.push('wall ahead');
    out.push('own speed');
    out.push('closing');
    if (CONFIG.senses.neighbours) {
      out.push('kin −');      // neighbours on the negative-angle side
      out.push('kin ahead');
      out.push('kin +');
    }
    return out;
  },

  // ---------------------------------------------------------------------------
  // READ - fills fish.senses and fish.rayHit IN PLACE.
  // ---------------------------------------------------------------------------
  // Note that this writes into arrays the fish already owns rather than
  // returning fresh ones. 60 fish x 60 ticks x 50x fast-forward would be
  // 180,000 throwaway arrays a second otherwise, and evolution is mostly just
  // "run the simulation an enormous number of times".
  // ---------------------------------------------------------------------------
  read(fish, world) {
    // Readouts remain anchored to the pose at which these rays were measured.
    const pose = fish.sensorPose || (fish.sensorPose = {});
    pose.x = fish.x; pose.y = fish.y; pose.heading = fish.heading;
    this.readRays(fish, world);
    fish.senses[this.WALL]  = this.wallAhead(fish, world);
    fish.senses[this.SPEED] = fish.speed / CONFIG.fish.maxSpeed;
    fish.senses[this.CLOSING] = this.closingRate(fish, world);
    if (CONFIG.senses.neighbours) this.readNeighbours(fish, world);
  },

  // ---------------------------------------------------------------------------
  // STAGE 8: how much company, and on which side.
  // ---------------------------------------------------------------------------
  // Three sectors around the fish - the negative-angle side, dead ahead, the
  // positive side - each holding the summed closeness of the neighbours in it.
  // A neighbour right on top of you contributes ~1, one at the edge of range
  // contributes ~0, and crowdScale sets how many close neighbours read as
  // "full".
  //
  // This is O(fish squared) per tick: 60 fish means 1,770 distance checks, which
  // is nothing. At a few hundred fish it would need a spatial grid, and that is
  // the honest reason this simulation stays small rather than any deep one.
  //
  // What a fish CANNOT tell from these three numbers is worth noting: it has no
  // idea which neighbour is which, how fast any of them are going, or whether
  // they are about to be eaten. Only "there is company, roughly there". That is
  // deliberately thin, and it is still enough for shoaling - if shoaling pays.
  // ---------------------------------------------------------------------------
  readNeighbours(fish, world) {
    const range = CONFIG.senses.neighbourRange;
    const range2 = range * range;
    const sector = Math.PI / 3;          // +/-60 degrees counts as "ahead"

    let neg = 0, ahead = 0, pos = 0;

    for (const other of world.fish) {
      if (other === fish || !other.alive) continue;

      const dx = other.x - fish.x, dy = other.y - fish.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > range2) continue;

      const closeness = 1 - Math.sqrt(d2) / range;

      // Bearing RELATIVE to the nose, same sign convention as the rays: a
      // negative bearing is the same side the -40 and -80 rays look at.
      const rel = V.angleDiff(Math.atan2(dy, dx), fish.heading);

      if (rel < -sector)      neg += closeness;
      else if (rel > sector)  pos += closeness;
      else                    ahead += closeness;
    }

    const k = CONFIG.senses.crowdScale;
    fish.senses[this.KIN]     = Math.min(1, neg / k);
    fish.senses[this.KIN + 1] = Math.min(1, ahead / k);
    fish.senses[this.KIN + 2] = Math.min(1, pos / k);
  },

  // --- vision: does each ray hit the shark? ----------------------------------
  readRays(fish, world) {
    const range = CONFIG.senses.range;
    const R  = CONFIG.shark.radius;
    const R2 = R * R;

    for (let i = 0; i < CONFIG.senses.rayCount; i++) {
      const a  = fish.heading + this.rayOffset(i);
      const ux = Math.cos(a);          // unit vector along this ray
      const uy = Math.sin(a);

      let hit = -1;                    // -1 means "this ray saw nothing"

      // A ray reports the NEAREST thing it touches, so a shark behind another
      // shark is simply hidden. The fish sees a silhouette, not a census.
      for (const shark of world.sharks) {
        const dx = shark.x - fish.x;
        const dy = shark.y - fish.y;

        // t = how far along the ray this shark's CENTRE lies, found by
        // projecting d onto u. Negative means it is behind this ray entirely.
        const t = dx * ux + dy * uy;
        if (t <= 0) continue;

        // The part of d perpendicular to the ray: how far the ray passes from
        // the centre at its closest approach.
        const perpX = dx - t * ux;
        const perpY = dy - t * uy;
        const perp2 = perpX * perpX + perpY * perpY;
        if (perp2 > R2) continue;

        // The ray does pass through the circle. Step BACK from the centre to
        // find where it first entered.
        const d = t - Math.sqrt(R2 - perp2);
        if (d > range) continue;
        const contact = d > 0 ? d : 0;
        if (hit < 0 || contact < hit) hit = contact;
      }

      fish.rayHit[i] = hit;                                   // for drawing
      fish.senses[i] = hit < 0 ? 0 : 1 - hit / range;         // for thinking
    }
  },

  // --- the wall directly ahead -----------------------------------------------
  // How far can the fish swim straight before it meets glass? We intersect the
  // heading with each of the four tank edges and keep the nearest one in front.
  //
  // The 1e-9 guards matter: a fish swimming exactly horizontally has uy = 0,
  // and dividing by it would give Infinity or NaN rather than "never hits".
  wallAhead(fish, world) {
    const ux = Math.cos(fish.heading);
    const uy = Math.sin(fish.heading);
    let t = Infinity;

    if (ux >  1e-9) t = Math.min(t, (world.w - fish.x) / ux);
    if (ux < -1e-9) t = Math.min(t, (0 - fish.x) / ux);
    if (uy >  1e-9) t = Math.min(t, (world.h - fish.y) / uy);
    if (uy < -1e-9) t = Math.min(t, (0 - fish.y) / uy);

    const range = CONFIG.senses.wallRange;
    if (t >= range) return 0;          // too far to feel
    return 1 - t / range;              // 1 = nose against the glass
  },
  // ---------------------------------------------------------------------------
  // CLOSING RATE - is the nearest shark gaining on me, or falling behind?
  // ---------------------------------------------------------------------------
  // Every other sense reports a POSITION. None of them reports a CHANGE, and
  // the difference decides everything about timing: a shark 80px away closing
  // fast and a shark 80px away drifting off need opposite responses, and until
  // now they produced identical sensory input.
  //
  // A network with memory can in principle derive this itself, by holding last
  // tick's reading and subtracting. But discovering differentiation from
  // scratch is a lot to ask of evolution when the quantity can simply be
  // handed over. Cheap to compute, and it is the input that makes 'break at
  // the last moment' learnable at all.
  //
  // Scaled by the fastest possible closing speed (both animals head-on), so
  // +1 is the worst case, 0 is holding station, and negative means escaping.
  // ---------------------------------------------------------------------------
  closingRate(fish, world) {
    let nearest = Infinity;
    for (const shark of world.sharks) {
      const d = V.dist2(fish.x, fish.y, shark.x, shark.y);
      if (d < nearest) nearest = d;
    }
    nearest = Math.sqrt(nearest);

    // Ticks spent with a predator actually within sensing range. This is the
    // number that tells us whether a fish was ever TESTED, and it costs
    // nothing here because the nearest distance is already computed.
    if (nearest <= CONFIG.senses.range) fish.threatTicks = (fish.threatTicks || 0) + 1;

    const previous = fish._prevSharkDist;
    fish._prevSharkDist = nearest;

    // First tick of a life has nothing to compare against.
    if (previous === undefined || !Number.isFinite(previous)) return 0;

    // Out of range in both ticks: no information, report nothing rather than
    // a spurious rate from two meaningless numbers.
    const range = CONFIG.senses.range;
    if (nearest > range && previous > range) return 0;

    const maxClose = (CONFIG.fish.maxSpeed + CONFIG.shark.maxSpeed) * CONFIG.sim.dt;
    return V.clamp((previous - nearest) / maxClose, -1, 1);
  },
};
