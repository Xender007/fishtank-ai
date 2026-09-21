const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[2] || path.join(__dirname, '..');
const FILES = ['config','rng','vec','senses','brain','genome','evolution','schooling',
               'fish','sharkbrain','shark','world','persist'];
const src = FILES.map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8'))
  .join(String.fromCharCode(10));
const ctx = { console, Math, JSON, Number, Array, Object, Map, Set, Float64Array, Int32Array, Date, process };
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext('var X = { CONFIG, World, Innovation, Evolution, Genome, Fish, Rng };', ctx);
const { CONFIG, World, Innovation, Evolution, Fish, Rng } = ctx.X;

function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}

World.keepInnovation = true;
Innovation.reset();
console.log('');

// --- 1. a juvenile is genuinely weaker -------------------------------------
CONFIG.life.continuous = true;
const baby = new Fish(400, 300, 0, 0, null);
baby.age = 0;
const adult = new Fish(400, 300, 0, 0, null);
adult.age = CONFIG.life.matureSeconds * 2;

check('a newborn is not mature', baby.maturity() === 0);
check('an old fish is fully mature', adult.maturity() === 1);
check('a newborn is physically smaller', baby.radius() < adult.radius(),
      baby.radius().toFixed(1) + 'px vs ' + adult.radius().toFixed(1) + 'px');

baby.age = CONFIG.life.matureSeconds / 2;
check('maturity climbs with age', baby.maturity() > 0 && baby.maturity() < 1,
      'halfway: ' + baby.maturity().toFixed(2));

// --- 2. the clock does not reset -------------------------------------------
CONFIG.fish.count = 30;
CONFIG.sim.generationSeconds = 20;      // short, to prove it is ignored
CONFIG.seed = 71;
Evolution.threshold = null;
const w = new World();
w.fish.forEach(f => { f.age = CONFIG.life.matureSeconds; });

const startGeneration = w.generation;
let peakYoung = 0;
for (let i = 0; i < 60 * 60; i++) {
  w.update(CONFIG.sim.dt);
  if (i % 30 === 0) {
    let n = 0;
    for (const f of w.fish) if (f.alive && f.maturity() < 1) n++;
    if (n > peakYoung) peakYoung = n;
  }
}

check('the generation counter never advances', w.generation === startGeneration,
      'still generation ' + w.generation + ' after 60s with a 20s timer');
check('the clock keeps running', w.time > 55, w.time.toFixed(1) + 's elapsed');

// --- 3. fish actually breed --------------------------------------------------
check('offspring were born', w.births > 0, w.births + ' born');
check('lineage depth increases', w.deepestGeneration > 1,
      'deepest lineage ' + w.deepestGeneration);

const live = w.fish.filter(f => f.alive);
// Peak rather than final: the population reaches its ceiling early, breeding
// stops, and everyone born has grown up by the time 60s is over. A tail count
// of zero means the colony succeeded, not that it never had young.
check('juveniles existed during the run', peakYoung > 0,
      'peak ' + peakYoung + ' juvenile at once');

// --- 4. population stays bounded ---------------------------------------------
check('population respects the ceiling', live.length <= CONFIG.life.maxPopulation,
      live.length + ' alive, cap ' + CONFIG.life.maxPopulation);

// --- 5. and does not simply die out ------------------------------------------
check('the colony is not extinct after 60s', live.length > 0 && !w.extinct,
      live.length + ' alive');

// --- 6. the chart still gets data -------------------------------------------
check('the population is sampled for the chart', w.history.length > 0,
      w.history.length + ' samples, latest population ' +
      (w.history.length ? w.history[w.history.length - 1].population : 0));

// --- 6b. corpses are cleared in a colony that never resets --------------------
// They used to pile up forever: 108 dead fish after five minutes, walked by
// every loop over world.fish on every tick and drawn every frame.
{
  CONFIG.life.continuous = true;
  CONFIG.seed = 404;
  const w = new World();
  w.fish.forEach(f => { f.age = CONFIG.life.matureSeconds; });
  const victims = w.fish.slice(0, 5);
  for (const v of victims) { v.x = w.shark.x; v.y = w.shark.y; }
  w.resolveEating();
  const eaten = victims.filter(v => !v.alive).length;
  const stamped = victims.every(v => v.alive || v.diedAt === w.time);
  for (let i = 0; i < 60; i++) w.update(CONFIG.sim.dt);
  const stillThere = w.fish.filter(f => victims.includes(f) && !f.alive).length;
  for (let i = 0; i < Math.round((CONFIG.life.corpseSeconds + 0.5) * 60); i++) w.update(CONFIG.sim.dt);
  const gone = !w.fish.some(f => victims.includes(f) && !f.alive);
  check('an eaten fish records when it died', eaten > 0 && stamped);
  check('a fresh corpse stays visible for a while', stillThere === eaten);
  check('continuous mode clears corpses after corpseSeconds, bounding world.fish',
        gone && w.fish.every(f => f.alive || w.time - f.diedAt <= CONFIG.life.corpseSeconds),
        eaten + ' eaten, array now ' + w.fish.length);
}

// --- 7. generational mode is untouched ---------------------------------------
CONFIG.life.continuous = false;
CONFIG.sim.generationSeconds = 20;
// One trial per generation. With the default of 4, a brain is evaluated four
// times before a generation completes, so four clock boundaries pass before
// the counter moves - which is correct, and is what the first version of this
// assertion mistook for a bug.
CONFIG.evolution.trials = 1;
CONFIG.seed = 71;
Evolution.threshold = null;
const g = new World();
for (let i = 0; i < 60 * 25; i++) g.update(CONFIG.sim.dt);
check('with the timer on, generations still advance', g.generation > 1,
      'reached generation ' + g.generation);
console.log('');
