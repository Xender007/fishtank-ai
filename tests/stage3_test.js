const fs = require('fs'), vm = require('vm');
const root = process.argv[2];
const src = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','sharkbrain','shark','world']
  .map(n => fs.readFileSync(root + '/js/' + n + '.js', 'utf8')).join('\n');

const test = `
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-9); }
// This suite is about the FIXED layered network, which is no longer the
// default brain kind - so it says so explicitly rather than inheriting it.
CONFIG.genome.kind = 'layered';
const rng = new Rng(7);
console.log('');

// --- 1. shape and parameter count -------------------------------------------
const net = Network.random(rng);
const expected = Senses.COUNT * CONFIG.net.hidden + CONFIG.net.hidden
               + CONFIG.net.hidden * 2 + 2;
check('parameter count matches the wiring by hand', net.paramCount() === expected,
      net.paramCount() + ' = ' + Senses.COUNT + 'x' + CONFIG.net.hidden + ' + ' +
      CONFIG.net.hidden + ' + ' + CONFIG.net.hidden + 'x2 + 2');
check('hidden layer is the configured width', net.layers[0].size === CONFIG.net.hidden);
check('output layer has exactly two neurons', net.layers[1].size === 2);

// --- 2. the forward pass, against arithmetic done by hand -------------------
const a = new Layer(2, 2, rng), b = new Layer(2, 1, rng);
a.weights.set([1, 0,  0, 1]); a.biases.set([0, 0]);   // identity-ish
b.weights.set([1, 1]);        b.biases.set([0]);      // sum the two
const tiny = new Network([a, b]);
const got = tiny.forward([0.5, -0.5])[0];
const byHand = Math.tanh(Math.tanh(0.5) + Math.tanh(-0.5));
check('two-layer forward pass matches hand arithmetic', near(got, byHand),
      'got ' + got.toFixed(6) + ', expected ' + byHand.toFixed(6));

a.weights.set([2, -1,  0.5, 3]); a.biases.set([0.1, -0.2]);
b.weights.set([1.5, -0.7]);      b.biases.set([0.25]);
const h0 = Math.tanh(0.1 + 2 * 0.3 + (-1) * 0.8);
const h1 = Math.tanh(-0.2 + 0.5 * 0.3 + 3 * 0.8);
const o  = Math.tanh(0.25 + 1.5 * h0 + (-0.7) * h1);
check('again with awkward numbers', near(tiny.forward([0.3, 0.8])[0], o),
      'got ' + tiny.forward([0.3, 0.8])[0].toFixed(6) + ', expected ' + o.toFixed(6));

// --- 3. the outputs are in the ranges a fish accepts ------------------------
let worstTurn = 0, minThrust = 9, maxThrust = -9;
for (let i = 0; i < 4000; i++) {
  const inputs = Array.from({length: Senses.COUNT}, () => rng.range(-3, 3));
  const d = net.decide(inputs);
  worstTurn = Math.max(worstTurn, Math.abs(d.turn));
  minThrust = Math.min(minThrust, d.thrust);
  maxThrust = Math.max(maxThrust, d.thrust);
}
check('turn stays inside -1..1 for any input', worstTurn <= 1,
      'largest |turn| = ' + worstTurn.toFixed(6));
check('thrust is rescaled into 0..1, not clipped', minThrust >= 0 && maxThrust <= 1,
      'thrust range ' + minThrust.toFixed(3) + ' .. ' + maxThrust.toFixed(3));

// --- 4. every fish is an individual -----------------------------------------
const w = new World();
const sig = f => Array.from(f.net.layers[0].weights).slice(0, 4).join(',');
const distinct = new Set(w.fish.map(sig));
check('every fish got its OWN random brain', distinct.size === w.fish.length,
      distinct.size + '/' + w.fish.length + ' distinct');
check('brains are not accidentally sharing one array',
      w.fish[0].net.layers[0].weights !== w.fish[1].net.layers[0].weights);
console.log('');

// --- 5. saturation: why the init range shrinks as fanIn grows ---------------
function pinnedFraction(gain) {
  CONFIG.net.initGain = gain;
  const ww = new World();
  let dead = 0, n = 0;
  for (let i = 0; i < 600; i++) {
    ww.update(CONFIG.sim.dt);
    for (const f of ww.fish) {
      if (!f.alive) continue;
      for (let j = 0; j < CONFIG.net.hidden; j++) {
        n++;
        if (Math.abs(f.net.hidden[j]) > 0.95) dead++;
      }
    }
  }
  return 100 * dead / n;
}
const p1 = pinnedFraction(1), p8 = pinnedFraction(8), p16 = pinnedFraction(16);
CONFIG.net.initGain = 1.0;
check('the default init keeps every hidden neuron responsive', p1 < 1,
      p1.toFixed(1) + '% of hidden neurons pinned at +/-1');
check('oversized weights SATURATE tanh and kill responsiveness', p8 > 20 && p16 > p8,
      'gain 8 -> ' + p8.toFixed(1) + '% pinned, gain 16 -> ' + p16.toFixed(1) + '%');

// --- 6. determinism survives all of this ------------------------------------
function fingerprint() {
  const ww = new World();
  for (let i = 0; i < 900; i++) ww.update(CONFIG.sim.dt);
  return ww.totalKills + ':' + ww.fish.map(f => f.x.toFixed(6)).join(';');
}
check('the same seed still reproduces the whole ocean, brains included',
      fingerprint() === fingerprint());
console.log('');
`;
vm.runInNewContext(src + test, { console, process });
