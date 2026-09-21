// =============================================================================
// tests/shark_brain_test.js - the shark's optional brain and survival instinct.
// =============================================================================
// Pins down what could quietly go wrong:
//   - the default shark is still the brainless measuring stick, and never starves
//   - a brained shark starves at EXACTLY starveSeconds, leaves world.sharks (so
//     no fish can sense a dead predator), and is replaced after respawnSeconds
//   - a meal resets the clock; swapping one brain for another does not
//   - the brain obeys the same physical limits as the brainless shark
//   - the trainer restores every global it touches and never flips a generation
//   - training is deterministic from a seed
//   - drawing a brained shark, its hunger ring and a corpse mutates nothing
// =============================================================================
const fs = require('fs'), path = require('path');
const { FILES } = require('../simulation');
const root = path.join(__dirname, '..');
const src = [...FILES, 'render'].map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8')).join('\n');
const S = new Function(src + '\nreturn { CONFIG, World, Render, Rng, V, Innovation, Persist, ' +
  'SharkBrain, SharkSenses, SharkTrainer, SharkHistory };')();
const { CONFIG, World, Render, Rng, V, Innovation, Persist, SharkBrain, SharkSenses, SharkTrainer, SharkHistory } = S;

function check(name, ok) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name);
  if (!ok) process.exitCode = 1;
}
CONFIG.evolution.enabled = false;
const dt = CONFIG.sim.dt;

// --- the network itself -------------------------------------------------------
const brain = SharkBrain.random(new Rng(5));
check('shark brain is 8 senses -> 6 hidden -> 2 outputs = 68 parameters',
  brain.paramCount() === 68 && SharkSenses.COUNT === 8 && brain.hiddenCount() === 6);
const probe = Float64Array.from([0.3, 0.8, -0.2, 0.1, 0.5, 0, 0.4, 1]);
const d1 = brain.decide(probe);
check('outputs are bounded: turn in -1..1, thrust in 0..1',
  Math.abs(d1.turn) <= 1 && d1.thrust >= 0 && d1.thrust <= 1);
const round = SharkBrain.fromJSON(JSON.parse(JSON.stringify(brain.toJSON())));
const d2 = round.decide(probe);
check('a saved shark brain decides identically after a JSON round trip',
  d1.turn === d2.turn && d1.thrust === d2.thrust);
let refused = false;
try { SharkBrain.fromJSON(Object.assign(brain.toJSON(), { inputs: 7 })); } catch (e) { refused = true; }
check('a shark brain built for a different sense layout is refused', refused);
const child = brain.clone().mutate(new Rng(1), 1, 1);
check('clone + mutate never touches the parent', brain.decide(probe).turn === d1.turn && child.w1[0] !== brain.w1[0]);

// --- default: brainless, never starves -----------------------------------------
{
  const w = new World();
  for (let i = 0; i < 1200; i++) w.update(dt);        // 20s, well past 10s
  check('default shark is brainless and never starves',
    CONFIG.sharkBrain.enabled === false && w.sharks.length === 1 && !w.sharks[0].brain &&
    w.starvations === 0 && w.sharks[0].speed === CONFIG.shark.maxSpeed);
}

// --- starvation ---------------------------------------------------------------
// A tank with no reachable food: every fish is dead, so nothing can be eaten.
function hungryWorld() {
  const w = new World();
  w.fish.forEach(f => { f.alive = false; });
  w.ticks = 0; w.time = 0;
  CONFIG.life.continuous = true;         // keep the empty tank from resetting
  return w;
}
{
  const w = hungryWorld();
  w.setSharkBrain(SharkBrain.random(new Rng(9)));
  const starve = Math.round(CONFIG.sharkBrain.starveSeconds / dt);
  for (let i = 0; i < starve - 1; i++) w.update(dt);
  const aliveBefore = w.sharks.length === 1;
  w.update(dt);
  check('a brained shark starves at exactly ' + CONFIG.sharkBrain.starveSeconds + 's without a meal',
    aliveBefore && w.sharks.length === 0 && w.starvations === 1);
  check('a starved shark leaves world.sharks (fish cannot sense it) and becomes a corpse',
    w.sharkCorpses.length === 1 && w.shark === null);
  const respawn = Math.round(CONFIG.sharkBrain.respawnSeconds / dt);
  for (let i = 0; i < respawn + 1; i++) w.update(dt);
  check('a replacement arrives after respawnSeconds, with a brain and an empty stomach',
    w.sharks.length === 1 && !!w.sharks[0].brain && w.sharks[0].hunger < 0.1);

  w.sharks[0].hunger = 7;
  w.setSharkBrain(SharkBrain.random(new Rng(10)));
  check('swapping to a newer brain keeps the hunger clock (no free meal)', w.sharks[0].hunger === 7);

  w.sharks.length = 0;
  w.setSharkBrain(null);
  check('brain off: brainless again, missing sharks return at once, flat-out speed',
    w.sharks.length === CONFIG.shark.count && !w.sharks[0].brain &&
    w.sharks[0].speed === CONFIG.shark.maxSpeed && w.sharkRespawns.length === 0);
  CONFIG.life.continuous = false;
}

// --- a meal resets the clock ---------------------------------------------------
{
  const w = new World();
  w.setSharkBrain(SharkBrain.random(new Rng(3)));
  const s = w.sharks[0];
  s.hunger = 9.5;
  const prey = w.fish.find(f => f.alive);
  prey.x = s.x; prey.y = s.y;
  w.resolveEating();
  check('eating resets hunger to zero', !prey.alive && s.hunger === 0 && s.kills === 1);
}

// --- physical limits ----------------------------------------------------------
{
  const w = new World();
  w.setSharkBrain(SharkBrain.random(new Rng(11)).mutate(new Rng(2), 1, 5));   // wild weights
  const s = w.sharks[0];
  let ok = true;
  for (let i = 0; i < 600 && s.alive; i++) {
    const h = s.heading;
    w.update(dt);
    if (!w.sharks.includes(s)) break;
    const turned = Math.abs(V.angleDiff(s.heading, h));
    if (turned > CONFIG.shark.turnRate * dt + 1e-9) ok = false;
    if (s.speed > CONFIG.shark.maxSpeed + 1e-9 ||
        s.speed < CONFIG.shark.maxSpeed * CONFIG.sharkBrain.minSpeedFraction - 1e-9) ok = false;
    if (!s.senses.every(Number.isFinite)) ok = false;
  }
  check('a brain can never turn faster than turnRate or swim faster than maxSpeed', ok);
}

// --- the trainer ---------------------------------------------------------------
{
  const fishBrain = Persist.fromJSON(JSON.parse(fs.readFileSync(path.join(root, 'champions', 'display-best.json'), 'utf8')));
  World.keepInnovation = true;
  const settings = { population: 4, trials: 2, seconds: 3, fish: 6 };
  const before = JSON.stringify([CONFIG.fish.count, CONFIG.shark.count, CONFIG.seed,
    CONFIG.schooling.enabled, CONFIG.life.continuous, World.keepInnovation]);
  const nodeIdBefore = Innovation.nextNodeId;
  const t1 = new SharkTrainer({ fishBrain, seed: 42, settings });
  let steps = 0;
  while (!t1.step(97) && steps++ < 10000) { /* in odd-sized chunks, like the page */ }
  const after = JSON.stringify([CONFIG.fish.count, CONFIG.shark.count, CONFIG.seed,
    CONFIG.schooling.enabled, CONFIG.life.continuous, World.keepInnovation]);
  check('trainer completes a generation and keeps the population size',
    t1.generation === 1 && t1.population.length === 4 && t1.lastRecord.brain instanceof SharkBrain);
  check('trainer restores every global it touches (fish/shark count, seed, schooling, life, innovation flag)',
    before === after && Innovation.nextNodeId === nodeIdBefore);

  const t2 = new SharkTrainer({ fishBrain, seed: 42, settings });
  while (!t2.step(5000)) { /* one big chunk */ }
  check('shark training is deterministic from its seed, however the ticks are chunked',
    t1.lastRecord.score === t2.lastRecord.score && t1.lastRecord.mean === t2.lastRecord.mean);

  // Observed from INSIDE the running tank, not from the config: a trial's
  // opponent once leaked into the next trial and every trial became reflex-only.
  const t3 = new SharkTrainer({ fishBrain, seed: 7, settings });
  const seen = {};
  for (let i = 0; i < 4000 && t3.generation === 0; i++) {
    t3.step(1);
    if (t3.world && t3.world.ticks > 5) {
      const key = t3.index + ':' + t3.trial;
      seen[key] = (seen[key] || '') + (t3.world.packs.length ? 'S' : 'R');
    }
  }
  const keys = Object.keys(seen);
  check('mixed opponents: even trials really run reflex-only fish, odd trials really run schooling fish',
    keys.length === 8 && keys.every(k => {
      const trial = Number(k.split(':')[1]);
      return /^R+$/.test(seen[k]) === (trial === 0) && /^S+$/.test(seen[k]) === (trial === 1);
    }));
}

// --- evaluation-only worlds never flip a generation ------------------------------
{
  const w = new World();
  w.evaluationOnly = true;
  w.fish.forEach(f => { f.alive = false; });
  const gen = w.generation;
  w.update(dt);
  check('an evaluation tank with every fish eaten does not breed or respawn',
    w.generation === gen && w.fish.every(f => !f.alive));
}

// --- history file helpers --------------------------------------------------------
{
  const entries = Array.from({ length: 300 }, (_, i) => ({ generation: i + 1 }));
  const thin = SharkHistory.thin(entries, 120);
  check('history thinning keeps the first and the 20 most recent generations, under the cap',
    thin.length <= 120 && thin[0].generation === 1 && thin[thin.length - 1].generation === 300 &&
    thin.slice(-20).every((e, i) => e.generation === 281 + i));
  const bad = Object.assign(brain.toJSON(), { inputs: 5 });
  const parsed = SharkHistory.fromJSON({ generations: [
    { generation: 2, score: 1, kills: 1, mean: 1, brain: brain.toJSON() },
    { generation: 1, score: 1, kills: 1, mean: 1, brain: bad }] });
  check('an incompatible history entry is skipped, not fatal', parsed.length === 1 && parsed[0].generation === 2);
}

// --- rendering is read-only --------------------------------------------------------
{
  const w = new World();
  w.setSharkBrain(SharkBrain.random(new Rng(4)));
  for (let i = 0; i < 30; i++) w.update(dt);
  w.sharkCorpses.push({ x: 100, y: 100, heading: 1, age: 3, kills: 0, diedAt: w.time });
  const ctx = new Proxy({}, {
    get(_, name) {
      if (name === 'createLinearGradient' || name === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...args) => {
        if (args.some(v => typeof v === 'number' && !Number.isFinite(v))) throw Error('nonfinite geometry');
      };
    }, set() { return true; },
  });
  const state = () => JSON.stringify({ rng: w.rng.state, sharks: w.sharks.map(s =>
    [s.x, s.y, s.heading, s.hunger, s.speed, Array.from(s.senses)]), corpses: w.sharkCorpses });
  const before = state();
  Render.frame(ctx, w, { focused: null, showAllRays: false, showLineage: false });
  check('drawing a brained shark, its hunger ring and a corpse mutates nothing', before === state());
}
