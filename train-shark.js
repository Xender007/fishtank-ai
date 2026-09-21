// =============================================================================
// train-shark.js - train the shark's brain offline. Run with: node train-shark.js
// =============================================================================
// The page trains the shark too (a few milliseconds per frame), but this is
// the fast path: no drawing, no frame budget, and every CPU core scoring
// candidates at once (parallel.js).
//
// Every candidate hunts copies of the page's CURRENT CHAMPION FISH
// (champions/best.js) in a private tank, in the same environment the page runs
// (Profiles.v3: learned teamwork and planning, fish hunger). The survival
// instinct is on: 10s without a meal and it dies. See js/sharktrainer.js for
// the loop itself; this file only farms its scoring out to worker threads.
//
// Usage:
//   node train-shark.js                   40 generations, resuming from the last
//   node train-shark.js --gens 100
//   node train-shark.js --fresh           ignore saved shark brains, start random
//   node train-shark.js --pop 32 --trials 4 --secs 20 --fish 45 --workers 8
//
// Writes champions/shark-history.json and champions/shark-best.js (which the
// page loads). Every generation's champion is kept, so the page can pick any.
// =============================================================================

const fs = require('fs');
const path = require('path');
const { createSimulation } = require('./simulation');
const { Pool } = require('./parallel');
const { snapshotConfig } = require('./evaluation');

const S = createSimulation();
const { CONFIG, Profiles, World, Innovation, Persist, SharkTrainer, SharkHistory } = S;
World.keepInnovation = true;
Innovation.reset();                 // once, exactly as train.js does (invariant #7)
CONFIG.evolution.enabled = false;   // evaluation tanks never evolve (invariant #6)

function parseOptions(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : fallback;
  };
  const flag = name => argv.includes('--' + name);
  const i = argv.indexOf('--out');
  return {
    gens: arg('gens', 40),
    pop: arg('pop', CONFIG.training.sharkPopulation),
    trials: arg('trials', CONFIG.sharkBrain.train.trials),
    secs: arg('secs', CONFIG.sharkBrain.train.seconds),
    // The page shows 45 fish, so the shark trains against 45 (the page's own
    // background trainer stays at 12: it has 4ms a frame to spend).
    fish: arg('fish', CONFIG.training.clones),
    workers: arg('workers', undefined),
    fresh: flag('fresh'),
    teamwork: !flag('rules'),
    planner: !flag('hand-planner'),
    hunger: !flag('no-hunger'),
    out: i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : path.join(__dirname, 'champions'),
    benchmark: !flag('no-benchmark'),
  };
}

// The page's champion fish: best.js, as the browser loads it. A layout-v2
// brain is migrated on load (Persist.fromJSON).
function loadFishChampion(out) {
  const src = fs.readFileSync(path.join(out, 'best.js'), 'utf8');
  const win = {};
  new Function('window', src)(win);
  return { brain: Persist.fromJSON(win.CHAMPION), meta: win.CHAMPION.meta || {} };
}

function loadHistory(out) {
  const file = path.join(out, 'shark-history.json');
  return fs.existsSync(file) ? SharkHistory.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8'))) : [];
}

function saveHistory(out, history, settings, fishMeta) {
  const data = {
    version: 1,
    saved: new Date().toISOString(),
    fishChampion: fishMeta || {},
    settings,
    generations: SharkHistory.thin(history, 120).map(SharkHistory.entryToJSON),
  };
  fs.writeFileSync(path.join(out, 'shark-history.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(out, 'shark-best.js'),
    '// Shark brains, one champion per generation. Written by train-shark.js.\n' +
    'window.SHARK_HISTORY = ' + JSON.stringify(data) + ';\n');
}

async function trainShark(o, env) {
  env = env || {};
  Profiles.v3({ teamwork: o.teamwork, planner: o.planner, hunger: o.hunger });
  // A brain handed over by another module (coevolve.js) belongs to ITS copy of
  // the simulation; re-read it into this one through JSON.
  const fish = env.fishBrain ? { brain: Persist.fromJSON(Persist.toJSON(env.fishBrain)), meta: env.fishMeta || {} }
                             : loadFishChampion(o.out);
  Innovation.absorb(fish.brain);

  let history = o.fresh ? [] : loadHistory(o.out);
  const last = history[history.length - 1];
  console.log('\n  ' + (last ? 'resuming from shark generation ' + last.generation + ' (' + last.kills.toFixed(2) + ' kills/trial)'
                          : 'starting from random shark brains'));

  const trainer = new SharkTrainer({
    fishBrain: fish.brain,
    startBrain: last ? last.brain : null,
    startGeneration: last ? last.generation : 0,
    seed: 20260921 + (last ? last.generation : 0),
    settings: { population: o.pop, trials: o.trials, seconds: o.secs, fish: o.fish },
  });
  const c = trainer.cfg;
  const pool = env.pool || new Pool(o.workers);
  const config = snapshotConfig(CONFIG);
  const fishJSON = Persist.toJSON(fish.brain);
  console.log('  population ' + c.population + ' · trials ' + c.trials + ' · ' + c.seconds + 's · ' + c.fish +
              ' champion fish · ' + pool.size + ' worker thread(s)');

  const t0 = Date.now();
  for (let g = 0; g < o.gens; g++) {
    // Every candidate is scored on the same seeds in parallel; breeding stays
    // here, on the trainer's own random stream, exactly as in the page.
    const results = await pool.map(trainer.population.map(b => ({
      kind: 'shark', brain: b.toJSON(), fishBrain: fishJSON, baseSeed: trainer.baseSeed,
      generation: trainer.generation, settings: c, config })));
    const r = trainer.completeGeneration(results);
    history.push(r);
    saveHistory(o.out, history, c, fish.meta);
    console.log('  gen ' + String(r.generation).padStart(4) + '   best ' + r.score.toFixed(2) +
                ' (' + r.kills.toFixed(2) + ' kills)   population mean ' + r.mean.toFixed(2) +
                '   ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }

  // ---- held-out, in the page's own setting ----
  // 45 champion fish, one shark, 60s, 12 seeds never used in training. A
  // starved brained shark is replaced after 1.5s, as on the page.
  if (o.benchmark && history.length) {
    const top = history[history.length - 1];
    const seeds = Array.from({ length: 12 }, (_, i) => 777001 + i * 104729);
    const run = async (sharkBrain, schooling) => {
      const cfg = snapshotConfig(CONFIG);
      cfg.schooling.enabled = schooling;
      const res = await pool.map(seeds.map(seed => ({ kind: 'match', brain: fishJSON,
        sharkBrain: sharkBrain ? sharkBrain.toJSON() : null, fish: 45, sharks: 1, seconds: 60, seed, config: cfg })));
      return res.reduce((a, x) => a + x.eaten, 0) / res.length;
    };
    console.log('\n  held-out, 12 seeds, 45 champion fish, 60s, fish eaten:');
    for (const [label, schooling] of [['reflex-only fish ', false], ['schooling fish   ', true]]) {
      const [a, b] = await Promise.all([run(null, schooling), run(top.brain, schooling)]);
      console.log('    ' + label + ' brainless ' + a.toFixed(2) + '   brain gen ' + top.generation + ' ' + b.toFixed(2));
    }
  }
  if (!env.pool) pool.close();
  return { history, newest: history[history.length - 1] };
}

if (require.main === module) {
  trainShark(parseOptions(process.argv.slice(2))).catch(err => { console.error(err); process.exitCode = 1; });
}

module.exports = { trainShark, parseOptions, loadFishChampion, loadHistory };
