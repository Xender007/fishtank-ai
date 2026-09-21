// =============================================================================
// train-shark.js - train the shark's brain offline. Run with: node train-shark.js
// =============================================================================
// The page trains the shark too (a few milliseconds per frame), but this is
// the fast path: no drawing, no frame budget, just evaluations back to back.
//
// Every candidate hunts clones of the CHAMPION FISH (champions/best.js) in a
// private tank. The survival instinct is on: 10s without a meal and it dies.
// See js/sharktrainer.js for the loop itself.
//
// Usage:
//   node train-shark.js                   40 generations, resuming from the last
//   node train-shark.js --gens 100
//   node train-shark.js --fresh           ignore saved shark brains, start random
//   node train-shark.js --pop 24 --trials 3 --secs 20 --fish 12
//
// Writes champions/shark-history.json and champions/shark-best.js (which the
// page loads). Every generation's champion is kept, so the page can pick any.
// =============================================================================

const fs = require('fs');
const path = require('path');
const { createSimulation } = require('./simulation');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
const FRESH = argv.includes('--fresh');
const GENS = arg('gens', 40);

const S = createSimulation();
const { CONFIG, World, Innovation, Persist, SharkBrain, SharkTrainer, SharkHistory, Rng } = S;
World.keepInnovation = true;
Innovation.reset();                 // once, exactly as train.js does (invariant #7)
CONFIG.evolution.enabled = false;   // evaluation tanks never evolve (invariant #6)

const settings = {};
for (const [flag, key] of [['pop', 'population'], ['trials', 'trials'], ['secs', 'seconds'], ['fish', 'fish']]) {
  const v = arg(flag, null);
  if (v !== null) settings[key] = v;
}

// ---- the fish it hunts ------------------------------------------------------
const OUT = path.join(__dirname, 'champions');
const champSrc = fs.readFileSync(path.join(OUT, 'best.js'), 'utf8');
const win = {};
new Function('window', champSrc)(win);
const fishBrain = Persist.fromJSON(win.CHAMPION);
Innovation.absorb(fishBrain);

// ---- resume ----------------------------------------------------------------
const HISTORY = path.join(OUT, 'shark-history.json');
let history = [];
if (!FRESH && fs.existsSync(HISTORY)) {
  history = SharkHistory.fromJSON(JSON.parse(fs.readFileSync(HISTORY, 'utf8')));
}
const last = history[history.length - 1];
console.log(last
  ? 'resuming from shark generation ' + last.generation + ' (' + last.kills.toFixed(2) + ' kills/trial)'
  : 'starting from random shark brains');

const trainer = new SharkTrainer({
  fishBrain,
  startBrain: last ? last.brain : null,
  startGeneration: last ? last.generation : 0,
  seed: 20260921 + (last ? last.generation : 0),
  settings,
});
const c = trainer.cfg;
console.log('population ' + c.population + ' · trials ' + c.trials + ' · ' + c.seconds +
            's · ' + c.fish + ' champion fish · schooling ' + (CONFIG.schooling.enabled ? 'on' : 'off'));

function save() {
  const data = {
    version: 1,
    saved: new Date().toISOString(),
    fishChampion: win.CHAMPION.meta || {},
    settings: c,
    generations: SharkHistory.thin(history, 120).map(SharkHistory.entryToJSON),
  };
  fs.writeFileSync(HISTORY, JSON.stringify(data));
  fs.writeFileSync(path.join(OUT, 'shark-best.js'),
    '// Shark brains, one champion per generation. Written by train-shark.js.\n' +
    'window.SHARK_HISTORY = ' + JSON.stringify(data) + ';\n');
}

const t0 = Date.now();
for (let g = 0; g < GENS; g++) {
  while (!trainer.step(5000)) { /* keep simulating */ }
  const r = trainer.lastRecord;
  history.push(r);
  console.log('gen ' + String(r.generation).padStart(4) + '   best ' + r.score.toFixed(2) +
              ' (' + r.kills.toFixed(2) + ' kills)   population mean ' + r.mean.toFixed(2) +
              '   ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  save();
}

// ---- held-out benchmark ------------------------------------------------------
// Seeds never used in training, against both opponents. For a FAIR comparison
// the brainless chaser is held to the same rule: its count stops the moment it
// goes starveSeconds without a meal (it does not physically die - the instinct
// belongs to the brain - but nothing it eats after that would have happened).
function benchmark(brain, seeds, schooling) {
  let kills = 0, starved = 0;
  const limit = CONFIG.sharkBrain.starveSeconds;
  for (const seed of seeds) {
    trainer.world = null;
    trainer.withTankConfig(() => {
      CONFIG.seed = seed;
      CONFIG.schooling.enabled = schooling;
      const w = new World();
      w.evaluationOnly = true;
      w.sharkBrain = brain;
      w.rng = new Rng(seed);
      w.spawn(Array.from({ length: c.fish }, () => fishBrain.clone()));
      const s = w.sharks[0];
      let lastMeal = 0, seen = 0;
      for (let t = 0; t < Math.round(c.seconds / CONFIG.sim.dt); t++) {
        w.update(CONFIG.sim.dt);
        if (s.kills > seen) { seen = s.kills; lastMeal = w.time; }
        if (!s.alive || w.time - lastMeal >= limit) { starved++; break; }
        if (w.aliveCount() === 0) break;
      }
      kills += seen;
    });
  }
  return { kills: kills / seeds.length, starved };
}
const seeds = Array.from({ length: 12 }, (_, i) => 777001 + i * 104729);
const top = history[history.length - 1];
console.log('\nheld-out, 12 seeds, ' + c.seconds + 's, ' + c.fish + ' champion fish, 10s starvation for both:');
for (const [label, schooling] of [['reflex-only fish ', false], ['schooling fish   ', true]]) {
  const a = benchmark(null, seeds, schooling), b = benchmark(top.brain, seeds, schooling);
  console.log('  ' + label + ' brainless ' + a.kills.toFixed(2) + ' kills (starved ' + a.starved +
              '/12)   brain gen ' + top.generation + ' ' + b.kills.toFixed(2) + ' kills (starved ' + b.starved + '/12)');
}
