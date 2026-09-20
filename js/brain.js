// =============================================================================
// brain.js - a neuron. The whole idea, in about fifteen lines of arithmetic.
// =============================================================================
// A neuron holds one weight per input, plus a bias. To fire it:
//
//      sum = bias + (w0 * x0) + (w1 * x1) + ... + (wn * xn)
//      out = tanh(sum)
//
// That is the complete definition. Everything else in machine learning is
// about WHERE THE WEIGHTS COME FROM. In this stage I pick them by hand. From
// Stage 4 onwards, dying fish pick them.
//
// -----------------------------------------------------------------------------
// WHY tanh?
// -----------------------------------------------------------------------------
// Two reasons, and the second is the one that matters.
//
// 1. Housekeeping: `turn` must be between -1 and +1, and tanh guarantees that
//    for ANY input, however extreme. A weight of 900 cannot make a fish spin.
//
// 2. The real reason: WITHOUT a non-linear squash, layers are pointless.
//    A weighted sum of weighted sums is algebraically just... another weighted
//    sum. Stack ten linear layers and you can compute nothing that one layer
//    could not. The squash is what breaks that collapse and makes depth mean
//    something. It is the difference between a network that can only draw a
//    straight dividing line through its inputs and one that can draw any shape.
//
// tanh specifically is a nice default here because it is centred on zero and
// symmetric: an input can push the output negative as easily as positive,
// which is exactly what a left/right steering decision needs.
// -----------------------------------------------------------------------------
// =============================================================================

class Neuron {

  // `weights` is one number per input, in the same order as Senses produces
  // them. `bias` is what the neuron outputs when every input happens to be 0.
  constructor(weights, bias) {
    this.weights = weights;
    this.bias = bias;

    // The neuron remembers its last piece of work so the panel can show you
    // the actual arithmetic. Pure bookkeeping - nothing reads these to think.
    this.lastInputs = null;
    this.lastSum = 0;
    this.lastOut = 0;
  }

  // ---------------------------------------------------------------------------
  // FIRE. This is the entire forward pass of a one-neuron network.
  // ---------------------------------------------------------------------------
  fire(inputs) {
    let sum = this.bias;

    for (let i = 0; i < this.weights.length; i++) {
      sum += this.weights[i] * inputs[i];
    }

    this.lastInputs = inputs;      // a reference, deliberately not a copy
    this.lastSum = sum;
    this.lastOut = Math.tanh(sum);

    return this.lastOut;
  }
}

// =============================================================================
// LAYER - a row of neurons that all read the same inputs. (Stage 3)
// =============================================================================
// Rather than holding an array of Neuron objects, a layer keeps ONE flat array
// of weights laid out row by row:
//
//     weights = [ neuron0's weights..., neuron1's weights..., ... ]
//
// and neuron i's weight for input j lives at [i * inputCount + j].
//
// Two reasons, and the second is the one that matters here:
//   1. One contiguous block of memory is faster to walk than a forest of
//      little objects.
//   2. In Stage 4, MUTATION becomes a single loop over one flat array. No
//      recursion into objects, no special cases. Copying a brain becomes
//      slice(). That simplicity is worth a lot when evolution is copying and
//      jittering thousands of brains a second.
// =============================================================================

class Layer {

  constructor(inputCount, size, rng) {
    this.inputCount = inputCount;
    this.size = size;

    this.weights = new Float64Array(size * inputCount);
    this.biases  = new Float64Array(size);
    this.out     = new Float64Array(size);   // reused every tick, never realloc

    // See CONFIG.net.initGain for why the range shrinks as fanIn grows.
    const range = CONFIG.net.initGain / Math.sqrt(inputCount);
    for (let i = 0; i < this.weights.length; i++) this.weights[i] = rng.range(-range, range);
    for (let i = 0; i < size; i++)               this.biases[i]  = rng.range(-range, range);
  }

  // Exactly the Stage 2 neuron, run once per neuron in this layer.
  forward(inputs) {
    for (let i = 0; i < this.size; i++) {
      let sum = this.biases[i];
      const base = i * this.inputCount;

      for (let j = 0; j < this.inputCount; j++) {
        sum += this.weights[base + j] * inputs[j];
      }

      this.out[i] = Math.tanh(sum);
    }
    return this.out;
  }

  paramCount() { return this.weights.length + this.biases.length; }
}

// =============================================================================
// NETWORK - layers chained nose to tail.
// =============================================================================
// The forward pass is four lines. Feed the senses to the first layer, feed its
// output to the next, and keep going. That is all "running a neural network"
// means - there is no other machinery hiding anywhere.
// =============================================================================

class Network {

  constructor(layers) {
    this.layers = layers;
  }

  // 7 senses -> hidden -> 2 outputs, with every weight drawn at random.
  // `rng` is the WORLD's generator, so a seed still reproduces the whole ocean
  // including every brain in it.
  static random(rng) {
    const sizes = [Senses.COUNT, CONFIG.net.hidden, 2];
    const layers = [];
    for (let i = 1; i < sizes.length; i++) {
      layers.push(new Layer(sizes[i - 1], sizes[i], rng));
    }
    const net = new Network(layers);

    // A lineage colour, carried down the family tree. Clones keep it exactly;
    // children of two parents get the blend. Turn on the lineage view (L) and
    // the tank shows you which families are winning.
    net.hue = rng.next() * 360;
    return net;
  }

  forward(inputs) {
    let signal = inputs;
    for (const layer of this.layers) {
      signal = layer.forward(signal);     // each layer's output is the next
    }                                     // layer's input. That is the whole
    return signal;                        // of it.
  }

  // Convenience views for the readout panel.
  get hidden() { return this.layers[0].out; }
  get output() { return this.layers[this.layers.length - 1].out; }

  // ---------------------------------------------------------------------------
  // DECIDE - turn the two raw outputs into the two controls a fish accepts.
  // ---------------------------------------------------------------------------
  // turn wants -1..1, which is exactly what tanh gives. Free.
  //
  // thrust wants 0..1, and tanh gives -1..1. If we simply clamped, every
  // negative output would collapse to "stopped" and HALF the neuron's range
  // would do nothing at all. Rescaling instead keeps the whole range useful.
  // Matching an output's range to the thing it controls is a small habit that
  // saves a lot of wasted capacity.
  // ---------------------------------------------------------------------------
  decide(senses) {
    const out = this.forward(senses);
    return { turn: out[0], thrust: (out[1] + 1) / 2 };
  }

  paramCount() {
    let n = 0;
    for (const layer of this.layers) n += layer.paramCount();
    return n;
  }
}

// =============================================================================
// INHERITANCE (Stage 4) - copying a brain, and changing it slightly.
// =============================================================================
// These two methods are all the machinery evolution needs from a network.
// Everything else - who breeds, how often, with whom - lives in evolution.js.
// =============================================================================

// Copy a layer without running the constructor. Object.create() hands back a
// blank object with the right prototype, so `copy instanceof Layer` is true and
// copy.forward() works, but we never have to supply an rng just to build
// weights we are about to overwrite anyway.
//
// Note `.slice()` on a Float64Array returns a genuine new buffer, not a view.
// If it did not, every child would share its parent's weights and mutating one
// fish would silently mutate its whole family. This is exactly the kind of bug
// that produces an evolution run where nothing ever improves.
Layer.prototype.clone = function () {
  const copy = Object.create(Layer.prototype);
  copy.inputCount = this.inputCount;
  copy.size = this.size;
  copy.weights = this.weights.slice();
  copy.biases  = this.biases.slice();
  copy.out     = new Float64Array(this.size);   // scratch space, not inherited
  return copy;
};

// Walk every parameter; with probability `rate`, nudge it by a bell-curve
// amount scaled by `strength`. Note that weights are NOT clamped to any range
// - a weight is free to grow as large as it usefully can, and tanh will keep
// the output sane regardless.
Layer.prototype.mutate = function (rng, rate, strength) {
  let changed = 0;
  for (let i = 0; i < this.weights.length; i++) {
    if (rng.next() < rate) { this.weights[i] += rng.gaussian() * strength; changed++; }
  }
  for (let i = 0; i < this.biases.length; i++) {
    if (rng.next() < rate) { this.biases[i] += rng.gaussian() * strength; changed++; }
  }
  return changed;
};

Network.prototype.clone = function () {
  const copy = new Network(this.layers.map(l => l.clone()));
  copy.hue = this.hue;
  return copy;
};

Network.prototype.mutate = function (rng, rate, strength) {
  let changed = 0;
  for (const layer of this.layers) changed += layer.mutate(rng, rate, strength);
  return changed;
};

// =============================================================================
// CROSSOVER (Stage 5) - a child built from two parents.
// =============================================================================
// Cloning can only ever improve one lineage at a time. If one family discovers
// "break hard when the shark is close" and another independently discovers
// "do not get pinned on the glass", cloning means those two discoveries can
// never meet: one family out-competes the other and the loser's insight is
// gone. Crossover lets a child inherit both.
//
// -----------------------------------------------------------------------------
// COMPETING CONVENTIONS - the reason this might not work at all
// -----------------------------------------------------------------------------
// Hidden neuron #3 in one parent may have evolved to mean "threat on my left".
// In the other parent, neuron #3 may mean "wall ahead". Both are good brains.
// But the INDEX is an arbitrary label - nothing makes #3 mean the same thing in
// two separately evolved networks. Mix them and the child's neuron #3 is half
// of one concept and half of another, which is not a compromise between two
// good ideas but a broken third thing.
//
// Two excellent parents, one useless child. This is a named, well-known
// failure of naive crossover on neural networks, and it is precisely why NEAT
// (Stage 7) tags every connection with an innovation number - so crossover can
// line up genes that share HISTORY rather than genes that share an index.
//
// The two schemes below differ in how much damage they can do.
// -----------------------------------------------------------------------------

// Copy material from `other` into THIS layer, in place.
Layer.prototype.crossFrom = function (other, rng, scheme) {
  if (scheme === 'neuron') {
    // Whole neurons travel together: all of a neuron's incoming weights plus
    // its bias come from the same parent. A neuron IS a learned feature, and
    // its incoming weights only mean anything as a set.
    for (let i = 0; i < this.size; i++) {
      if (rng.next() < 0.5) {
        const base = i * this.inputCount;
        for (let j = 0; j < this.inputCount; j++) {
          this.weights[base + j] = other.weights[base + j];
        }
        this.biases[i] = other.biases[i];
      }
    }
  } else {
    // Uniform: every single weight is an independent coin flip. Maximum
    // mixing, and maximum opportunity to shred a working feature.
    for (let i = 0; i < this.weights.length; i++) {
      if (rng.next() < 0.5) this.weights[i] = other.weights[i];
    }
    for (let i = 0; i < this.biases.length; i++) {
      if (rng.next() < 0.5) this.biases[i] = other.biases[i];
    }
  }
};

// Average two hues the way you must average anything circular: as vectors.
// Averaging the NUMBERS would make 350 and 10 - two nearly identical reds -
// come out as 180, a cyan that resembles neither parent.
function blendHue(h1, h2) {
  const a = h1 * Math.PI / 180, b = h2 * Math.PI / 180;
  const x = Math.cos(a) + Math.cos(b);
  const y = Math.sin(a) + Math.sin(b);
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return h1;   // exact opposites
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

Network.prototype.crossover = function (other, rng, scheme) {
  const child = this.clone();
  for (let i = 0; i < child.layers.length; i++) {
    child.layers[i].crossFrom(other.layers[i], rng, scheme);
  }
  // The child's lineage colour is the blend of its parents'. This is what you
  // actually SEE in the tank: a population that starts as 60 different hues
  // and slowly converges as successful families take over.
  child.hue = blendHue(this.hue, other.hue);
  return child;
};

// The fixed Stage 3 network describes itself in the same shape a Genome does,
// so the brain inspector can draw either without knowing which it has. Node ids
// are faked (inputs 0..n, hidden 100+, outputs 200+) since a layered network
// has no real ids of its own.
Network.prototype.graph = function () {
  const nodes = [];
  const conns = [];
  const inputs = this.layers[0].inputCount;

  for (let i = 0; i < inputs; i++) {
    nodes.push({ id: i, name: Senses.labels()[i], type: 0, depth: 0, bias: 0,
                 value: 0, prevValue: 0 });
  }
  const hid = this.layers[0];
  for (let i = 0; i < hid.size; i++) {
    nodes.push({ id: 100 + i, name: 'h' + i, type: 2, depth: 1,
                 bias: hid.biases[i], value: hid.out[i], prevValue: hid.out[i] });
    for (let j = 0; j < hid.inputCount; j++) {
      conns.push({ from: j, to: 100 + i, w: hid.weights[i * hid.inputCount + j],
                   enabled: true });
    }
  }
  const out = this.layers[1];
  for (let i = 0; i < out.size; i++) {
    nodes.push({ id: 200 + i, name: i === 0 ? 'turn' : 'thrust', type: 1, depth: 2,
                 bias: out.biases[i], value: out.out[i], prevValue: out.out[i] });
    for (let j = 0; j < out.inputCount; j++) {
      conns.push({ from: 100 + j, to: 200 + i, w: out.weights[i * out.inputCount + j],
                   enabled: true });
    }
  }
  return { nodes, conns, maxDepth: 2 };
};

Network.prototype.hiddenCount = function () { return this.layers[0].size; };
