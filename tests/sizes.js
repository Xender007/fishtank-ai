const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[2];
const FILES = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','shark','world','persist'];
const src = FILES.map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8'))
  .join(String.fromCharCode(10));
const ctx = { console, Math, JSON, Number, Array, Object, Map, Set, Float64Array, Int32Array, Date };
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext('var X = { CONFIG, World, Innovation, Rng, Evolution, Persist };', ctx);
const { CONFIG, World, Innovation, Persist } = ctx.X;

World.keepInnovation = true;
Innovation.reset();
CONFIG.evolution.enabled = false;

global.window = {};
require(path.join(root, 'champions', 'best.js'));
const champ = Persist.fromJSON(global.window.CHAMPION);
Innovation.absorb(champ);

function measure(count, runs) {
  CONFIG.fish.count = count;
  CONFIG.sim.generationSeconds = 60;
  const maxTicks = Math.round(60 / CONFIG.sim.dt) - 1;
  const each = [];
  for (let r = 0; r < runs; r++) {
    CONFIG.seed = 11000 + r * 7717;
    const w = new World();
    const watched = w.fish.slice();
    for (const f of watched) f.net = champ.clone();
    let t = 0;
    while (t < maxTicks && watched.some(f => f.alive)) { w.update(CONFIG.sim.dt); t++; }
    each.push(100 * watched.filter(f => !f.alive).length / watched.length);
  }
  const mean = each.reduce((a, b) => a + b, 0) / each.length;
  const sd = Math.sqrt(each.reduce((a, b) => a + (b - mean) * (b - mean), 0) / each.length);
  return { mean, sd, min: Math.min.apply(null, each), max: Math.max.apply(null, each) };
}

console.log('');
console.log('  Shoal champion, 60s, 12 seeds per row');
console.log('');
console.log('  fish    eaten (mean)    sd      range');
console.log('  ' + '-'.repeat(48));
for (const n of [16, 24, 30, 45, 60]) {
  const r = measure(n, 12);
  console.log('  ' + String(n).padEnd(8) + (r.mean.toFixed(0) + '%').padStart(10) +
              (r.sd.toFixed(0) + '%').padStart(9) +
              ('  ' + r.min.toFixed(0) + '-' + r.max.toFixed(0) + '%').padStart(14));
}
console.log('');
