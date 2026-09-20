const fs = require('fs'), vm = require('vm');
const root = process.argv[2];
const src = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','shark','world']
  .map(n => fs.readFileSync(root + '/js/' + n + '.js', 'utf8')).join('\n');

const test = `
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}
const rng = new Rng(5);
console.log('');

const A = Network.random(rng), B = Network.random(rng);
const aw = Array.from(A.layers[0].weights), bw = Array.from(B.layers[0].weights);

// --- 1. a child invents nothing ---------------------------------------------
for (const scheme of ['uniform', 'neuron']) {
  const kid = A.crossover(B, rng, scheme);
  const kw = Array.from(kid.layers[0].weights);
  check(scheme + ': every weight came from one parent or the other',
        kw.every((v, i) => v === aw[i] || v === bw[i]));
  check(scheme + ': the child is not just a copy of one parent',
        kw.some((v, i) => v !== aw[i]) && kw.some((v, i) => v !== bw[i]));
}

// --- 2. neuron-wise really does keep neurons whole --------------------------
let intact = true;
for (let t = 0; t < 30; t++) {
  const kid = A.crossover(B, rng, 'neuron');
  const L = kid.layers[0];
  for (let i = 0; i < L.size; i++) {
    const base = i * L.inputCount;
    const fromA = L.weights[base] === aw[base];
    for (let j = 0; j < L.inputCount; j++) {
      const src = fromA ? aw : bw;
      if (L.weights[base + j] !== src[base + j]) intact = false;
    }
  }
}
check('neuron scheme keeps incoming weights of a neuron together', intact,
      'no neuron was ever half from each parent');

// --- 3. parents are untouched ------------------------------------------------
check('crossover does not modify either parent',
      Array.from(A.layers[0].weights).every((v, i) => v === aw[i]) &&
      Array.from(B.layers[0].weights).every((v, i) => v === bw[i]));

// --- 4. crossing a brain with itself is just a clone ------------------------
const self = A.crossover(A, rng, 'uniform');
check('a fish crossed with itself yields an identical brain',
      Array.from(self.layers[0].weights).every((v, i) => v === aw[i]));

// --- 5. hues average as angles, not as numbers ------------------------------
A.hue = 350; B.hue = 10;
const kid2 = A.crossover(B, rng, 'neuron');
check('two near-identical reds blend to red, not to cyan',
      kid2.hue < 5 || kid2.hue > 355,
      'blend(350, 10) = ' + kid2.hue.toFixed(1) + ' (naive averaging would give 180)');

// --- 6. diversity collapses as a population converges -----------------------
const spread = Array.from({length: 60}, (_, i) => ({ net: { hue: i * 6 } }));
const same   = Array.from({length: 60}, () => ({ net: { hue: 200 } }));
check('diversity is ~1 when every family is distinct, 0 when all are one',
      Evolution.diversity(spread) > 0.95 && Evolution.diversity(same) < 0.001,
      'spread ' + Evolution.diversity(spread).toFixed(3) +
      ', converged ' + Evolution.diversity(same).toFixed(3));
console.log('');
`;
vm.runInNewContext(src + test, { console, process });
