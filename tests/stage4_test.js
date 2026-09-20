const fs = require('fs'), vm = require('vm');
const root = process.argv[2];
const src = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','shark','world']
  .map(n => fs.readFileSync(root + '/js/' + n + '.js', 'utf8')).join('\n');

const test = `
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}
const rng = new Rng(42);
console.log('');

// --- 1. a clone is genuinely independent ------------------------------------
const parent = Network.random(rng);
const before = Array.from(parent.layers[0].weights);
const child = parent.clone();
child.mutate(rng, 1.0, 1.0);                       // jitter EVERY weight hard
const after = Array.from(parent.layers[0].weights);
check('mutating a child does not touch its parent',
      before.every((v, i) => v === after[i]),
      'parent weights unchanged after a full-strength child mutation');
check('the child really did change',
      Array.from(child.layers[0].weights).some((v, i) => v !== before[i]));
check('a clone starts identical to its parent',
      Array.from(parent.clone().layers[0].weights).every((v, i) => v === before[i]));

// --- 2. mutation rate does what it says -------------------------------------
let touched = 0, total = 0;
for (let t = 0; t < 200; t++) {
  const c = parent.clone();
  touched += c.mutate(rng, 0.15, 0.3);
  total += c.paramCount();
}
const observed = touched / total;
check('mutation rate matches the configured fraction',
      Math.abs(observed - 0.15) < 0.02,
      'asked for 15%, touched ' + (100 * observed).toFixed(1) + '%');

// --- 3. tournament selection prefers better fish ----------------------------
const scored = Array.from({length: 60}, (_, i) => ({ brain: null, fitness: i }));
let sumPicked = 0;
for (let t = 0; t < 20000; t++) sumPicked += Evolution.tournament(scored, rng, 3).fitness;
const meanPicked = sumPicked / 20000;
check('a size-3 tournament picks well above average',
      meanPicked > 42 && meanPicked < 46,
      'mean fitness of winners = ' + meanPicked.toFixed(1) + ' (population mean 29.5)');

// --- 4. elites survive untouched --------------------------------------------
const pop = Array.from({length: 20}, (_, i) => ({ brain: Network.random(rng), fitness: i }));
const top = pop[pop.length - 1];
const topWeights = Array.from(top.brain.layers[0].weights);
const bred = Evolution.breed(pop, rng);
check('the single best brain is carried over with no mutation at all',
      Array.from(bred[0].layers[0].weights).every((v, i) => v === topWeights[i]));
check('breeding returns a full-sized population', bred.length === pop.length);
console.log('');
`;
vm.runInNewContext(src + test, { console, process });
