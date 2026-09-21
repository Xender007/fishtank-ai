const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[2];
const FILES = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','sharkbrain','shark','world'];
const src = FILES.map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8'))
  .join(String.fromCharCode(10));
const ctx = { console, Math, JSON, Number, Array, Object, Map, Set, Float64Array, Int32Array };
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext('var X = { CONFIG, World, Genome, Innovation, Rng, Senses, Evolution, NODE_INPUT };', ctx);
const { CONFIG, World, Genome, Innovation, Rng, Senses } = ctx.X;

World.keepInnovation = true;
Innovation.reset();
CONFIG.evolution.enabled = false;

// Survival of a single fish whose brain we dictate, averaged over seeds.
function trial(setup, runs, secs) {
  CONFIG.fish.count = 1;
  CONFIG.sim.generationSeconds = secs;
  const maxTicks = Math.round(secs / CONFIG.sim.dt);
  let total = 0;
  for (let r = 0; r < runs; r++) {
    CONFIG.seed = 4000 + r * 1013;
    const w = new World();
    const f = w.fish[0];
    setup(f);
    let ticks = 0;
    while (ticks < maxTicks && f.alive) { w.update(CONFIG.sim.dt); ticks++; }
    total += f.age;
  }
  return total / runs;
}

// A brain that ignores every sense and just holds one turn + full thrust.
function constantBrain(turnBias, thrustBias) {
  const rng = new Rng(1);
  const g = Genome.minimal(rng);
  for (const c of g.conns) c.w = 0;                 // deaf to the world
  g.nodes.forEach(n => {
    if (n.id === Senses.COUNT) n.bias = turnBias;       // turn
    if (n.id === Senses.COUNT + 1) n.bias = thrustBias; // thrust
  });
  g.rebuild();
  return g;
}

const SECS = 60, RUNS = 10;
console.log('');
console.log('  ONE fish, one shark, ' + SECS + 's max. Is this task winnable at all?');
console.log('');
console.log('  strategy                       mean survival');
console.log('  ' + '-'.repeat(48));

const straight = constantBrain(0, 3);
console.log('  swim straight, full speed' .padEnd(33) + trial(f => f.net = straight, RUNS, SECS).toFixed(1).padStart(8) + 's');

for (const turn of [0.3, 0.6, 1.0, 2.0, 4.0]) {
  const b = constantBrain(turn, 3);
  const r = trial(f => f.net = b, RUNS, SECS);
  const radius = (CONFIG.fish.maxSpeed / (Math.tanh(turn) * CONFIG.fish.turnRate)).toFixed(0);
  console.log(('  circle, turn bias ' + turn + ' (r=' + radius + 'px)').padEnd(33) +
              r.toFixed(1).padStart(8) + 's');
}

console.log('');
console.log('  shark turning circle = ' +
            (CONFIG.shark.maxSpeed / CONFIG.shark.turnRate).toFixed(0) + 'px');
console.log('  fish tightest circle = ' +
            (CONFIG.fish.maxSpeed / CONFIG.fish.turnRate).toFixed(0) + 'px');
console.log('');
