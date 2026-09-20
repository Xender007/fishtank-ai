const fs = require('fs'), vm = require('vm');
const root = process.argv[2];
const src = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','shark','world']
  .map(n => fs.readFileSync(root + '/js/' + n + '.js', 'utf8')).join('\n');

const test = `
function sd(a) {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length);
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }

// Score one population over N trials exactly the way the world now does,
// returning each brain's MEAN fitness.
function evaluate(world, trials) {
  const sums = new Array(world.fish.length).fill(0);
  for (let t = 0; t < trials; t++) {
    const brains = world.fish.map(f => f.net);
    world.ticks = 0; world.time = 0;
    world.spawn(brains);
    let snap = null;
    for (let i = 0; i < world.generationTicks; i++) {
      snap = world.fish.map(f => Evolution.fitness(f));
      const g = world.generation;
      world.update(CONFIG.sim.dt);
      if (world.generation !== g) break;
      snap = world.fish.map(f => Evolution.fitness(f));
    }
    snap.forEach((v, i) => sums[i] += v);
  }
  return sums.map(v => v / trials);
}

function measure(sharkCount, trials) {
  CONFIG.shark.count = sharkCount;
  CONFIG.evolution.trials = trials;

  CONFIG.seed = 1234; Evolution.threshold = null;
  const varied = new World();
  const sVaried = sd(evaluate(varied, trials));

  CONFIG.seed = 1234; Evolution.threshold = null;
  const same = new World();
  const one = same.fish[0].net;
  same.fish.forEach(f => { f.net = one.clone(); });
  const scores = evaluate(same, trials);
  const sSame = sd(scores);

  console.log('  ' + (sharkCount + ' shark' + (sharkCount > 1 ? 's' : '') + ', ' +
              trials + ' trial' + (trials > 1 ? 's' : '')).padEnd(22) +
              sSame.toFixed(1).padStart(9) + 's' +
              sVaried.toFixed(1).padStart(10) + 's' +
              ((100 * sSame / sVaried).toFixed(0) + '%').padStart(12) +
              mean(scores).toFixed(1).padStart(12) + 's');
}

console.log('');
console.log('  HOW MUCH OF THE SCORE IS LUCK? (lower luck share = better selection)');
console.log('');
console.log('  setup                 identical  different   luck share   mean fitness');
console.log('  ' + '-'.repeat(72));
measure(1, 1);
measure(3, 1);
measure(1, 4);
measure(3, 4);
measure(3, 8);
console.log('');
`;
vm.runInNewContext(src + test, { console, process });
