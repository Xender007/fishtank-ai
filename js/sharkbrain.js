// =============================================================================
// sharkbrain.js - the predator's optional brain.
// =============================================================================
// For the whole of PLAN.md the shark was deliberately brainless: point at the
// nearest fish, swim flat out. That made it a fixed measuring stick. It still
// is by default (CONFIG.sharkBrain.enabled = false) - this file only matters
// when someone switches the brain on.
//
// The brain is the Stage 3 idea again, sized for a predator:
//
//     8 senses  ->  6 hidden (tanh)  ->  2 outputs (turn, speed)
//
// A FIXED shape, not a growing genome. The fish genome is wired to the fish's
// sense layout and to one global innovation counter; sharing it would make a
// shark mutation able to renumber fish genes. A separate small network keeps
// the two species' evolution completely independent.
//
// One sense is special: HUNGER. The shark starves after
// CONFIG.sharkBrain.starveSeconds without a meal (the survival instinct), and
// the brain can feel that clock. A network that learns to hunt harder as the
// number climbs has learned something no brainless shark could represent.
// =============================================================================

const SharkSenses = {
  COUNT: 8,
  LABELS: ['fish angle', 'fish close', 'fish drift', 'crowd angle',
           'crowd size', 'wall ahead', 'hunger', 'speed'],
  CROWD_RANGE: 250,
  SIGHT: 400,

  // Everything egocentric and scaled to -1..1 or 0..1, for the same reasons as
  // the fish's senses: one learned reflex has to work anywhere in the tank.
  read(shark, world, out) {
    out.fill(0);
    const target = world.nearestLivingFish(shark.x, shark.y);

    if (target) {
      const bearing = V.angleTo(shark.x, shark.y, target.x, target.y);
      const d = V.dist(shark.x, shark.y, target.x, target.y);
      out[0] = V.angleDiff(bearing, shark.heading) / Math.PI;       // -1..1
      out[1] = V.clamp(1 - d / this.SIGHT, 0, 1);
      // DRIFT: how fast the prey is sliding sideways across the line of sight.
      // A brainless shark aims where the fish IS; this is the number a shark
      // needs to aim where the fish is GOING. Same sign as the bearing.
      const ux = Math.cos(bearing), uy = Math.sin(bearing);
      const vx = Math.cos(target.heading) * target.speed;
      const vy = Math.sin(target.heading) * target.speed;
      out[2] = V.clamp((vy * ux - vx * uy) / CONFIG.fish.maxSpeed, -1, 1);
    }

    // The crowd: the centre of every living fish within reach. The nearest fish
    // is not always the best meal - a dense school is.
    let cx = 0, cy = 0, n = 0;
    const r2 = this.CROWD_RANGE * this.CROWD_RANGE;
    for (const f of world.fish) {
      if (!f.alive || V.dist2(shark.x, shark.y, f.x, f.y) > r2) continue;
      cx += f.x; cy += f.y; n++;
    }
    if (n) {
      out[3] = V.angleDiff(V.angleTo(shark.x, shark.y, cx / n, cy / n), shark.heading) / Math.PI;
      out[4] = Math.min(1, n / 12);
    }

    out[5] = Senses.wallAhead(shark, world);
    out[6] = V.clamp(shark.hunger / CONFIG.sharkBrain.starveSeconds, 0, 1);
    out[7] = shark.speed / CONFIG.shark.maxSpeed;
    return out;
  },
};

class SharkBrain {

  // w1: hidden x inputs, b1: hidden, w2: 2 x hidden, b2: 2. Flat arrays, the
  // same layout as Stage 3's Layer, so mutation is one loop over one array.
  constructor(w1, b1, w2, b2) {
    this.w1 = w1; this.b1 = b1; this.w2 = w2; this.b2 = b2;
    this.hidden = b1.length;
    this.inputs = new Float64Array(SharkSenses.COUNT);
    this.h = new Float64Array(this.hidden);
    this.out = new Float64Array(2);
  }

  static random(rng) {
    const H = CONFIG.sharkBrain.hidden, I = SharkSenses.COUNT;
    const g1 = 1 / Math.sqrt(I), g2 = 1 / Math.sqrt(H);   // Stage 3's init rule
    const fill = (n, g) => Float64Array.from({ length: n }, () => rng.range(-g, g));
    return new SharkBrain(fill(H * I, g1), fill(H, g1), fill(2 * H, g2), fill(2, g2));
  }

  forward(inputs) {
    const I = SharkSenses.COUNT, H = this.hidden;
    this.inputs.set(inputs);
    for (let j = 0; j < H; j++) {
      let s = this.b1[j];
      for (let i = 0; i < I; i++) s += inputs[i] * this.w1[j * I + i];
      this.h[j] = Math.tanh(s);
    }
    for (let k = 0; k < 2; k++) {
      let s = this.b2[k];
      for (let j = 0; j < H; j++) s += this.h[j] * this.w2[k * H + j];
      this.out[k] = Math.tanh(s);
    }
    return this.out;
  }

  // turn in -1..1; thrust rescaled to 0..1, not clamped (see Stage 3).
  decide(inputs) {
    const o = this.forward(inputs);
    return { turn: o[0], thrust: (o[1] + 1) / 2 };
  }

  paramCount() { return this.w1.length + this.b1.length + this.w2.length + this.b2.length; }
  hiddenCount() { return this.hidden; }
  memoryCount() { return 0; }

  clone() {
    return new SharkBrain(this.w1.slice(), this.b1.slice(), this.w2.slice(), this.b2.slice());
  }

  mutate(rng, rate, strength) {
    for (const arr of [this.w1, this.b1, this.w2, this.b2]) {
      for (let i = 0; i < arr.length; i++) if (rng.next() < rate) arr[i] += rng.gaussian() * strength;
    }
    return this;
  }

  // Neuron-wise crossover, the scheme that won Stage 5: a hidden neuron's
  // incoming weights, bias and outgoing weights travel together, because they
  // only mean anything as a set.
  crossover(other, rng) {
    const child = this.clone();
    const I = SharkSenses.COUNT, H = this.hidden;
    for (let j = 0; j < H; j++) {
      if (rng.next() < 0.5) continue;
      for (let i = 0; i < I; i++) child.w1[j * I + i] = other.w1[j * I + i];
      child.b1[j] = other.b1[j];
      for (let k = 0; k < 2; k++) child.w2[k * H + j] = other.w2[k * H + j];
    }
    for (let k = 0; k < 2; k++) if (rng.next() < 0.5) child.b2[k] = other.b2[k];
    return child;
  }

  // The same neutral shape the fish genome produces, so BrainView draws it
  // unchanged. Ids: inputs 0-7, outputs 8-9, hidden from 10.
  graph() {
    const I = SharkSenses.COUNT, H = this.hidden;
    const OUT = ['turn', 'speed'];
    const nodes = [], conns = [];
    const name = id => id < I ? SharkSenses.LABELS[id] : id < I + 2 ? OUT[id - I] : 'h' + id;   // matches the id drawn inside the node
    for (let i = 0; i < I; i++) {
      nodes.push({ id: i, name: name(i), type: 0, depth: 0, bias: 0, value: this.inputs[i] });
    }
    for (let j = 0; j < H; j++) {
      const id = I + 2 + j;
      nodes.push({ id, name: name(id), type: 2, depth: 1, bias: this.b1[j], value: this.h[j] });
      for (let i = 0; i < I; i++) {
        conns.push({ from: i, to: id, w: this.w1[j * I + i], enabled: true, recurrent: false,
                     fromName: name(i), toName: name(id) });
      }
    }
    for (let k = 0; k < 2; k++) {
      nodes.push({ id: I + k, name: OUT[k], type: 1, depth: 2, bias: this.b2[k], value: this.out[k] });
      for (let j = 0; j < H; j++) {
        conns.push({ from: I + 2 + j, to: I + k, w: this.w2[k * H + j], enabled: true,
                     recurrent: false, fromName: name(I + 2 + j), toName: OUT[k] });
      }
    }
    return { nodes, conns, maxDepth: 2 };
  }

  toJSON() {
    return { kind: 'shark', inputs: SharkSenses.COUNT, hidden: this.hidden,
             w1: Array.from(this.w1), b1: Array.from(this.b1),
             w2: Array.from(this.w2), b2: Array.from(this.b2) };
  }

  // Validated for the same reason Persist validates fish: a half-loaded brain
  // fails later, somewhere confusing.
  static fromJSON(d) {
    if (!d || d.kind !== 'shark') throw new Error('not a shark brain');
    if (d.inputs !== SharkSenses.COUNT) {
      throw new Error('that shark brain expects ' + d.inputs + ' senses, this shark has ' + SharkSenses.COUNT);
    }
    const H = d.hidden, I = SharkSenses.COUNT;
    if (d.w1.length !== H * I || d.b1.length !== H || d.w2.length !== 2 * H || d.b2.length !== 2) {
      throw new Error('shark brain has the wrong number of weights');
    }
    if (![...d.w1, ...d.b1, ...d.w2, ...d.b2].every(Number.isFinite)) {
      throw new Error('shark brain contains a non-number');
    }
    return new SharkBrain(Float64Array.from(d.w1), Float64Array.from(d.b1),
                          Float64Array.from(d.w2), Float64Array.from(d.b2));
  }
}
