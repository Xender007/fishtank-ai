// =============================================================================
// train.js - the offline trainer. Run with: node train.js
// =============================================================================
// The browser page is for WATCHING. This is for training, and it does the one
// thing the browser cannot afford to do: it evaluates every brain ALONE.
//
// -----------------------------------------------------------------------------
// WHY ALONE, AND WHY IT MATTERS MORE THAN ANYTHING ELSE HERE
// -----------------------------------------------------------------------------
// In a tank of 60 fish there is one shark, and it chases the nearest fish. The
// other 59 are safe for free. So "seconds survived" mostly measures WHETHER
// SOMEONE ELSE WAS CLOSER - which is position luck, not escape skill. A brain
// that never learns anything scores well as long as it spawns far away.
//
// That is why trained brains kept benchmarking no better than random ones: the
// thing being selected for was not the thing we wanted.
//
// Here, every brain gets its own private tank with one shark and no other fish.
// The shark has nothing else to chase. Survival time can then only come from
// escaping, and the score means exactly what it says.
//
// Usage:
//   node train.js                     100 generations, resuming from the best
//   node train.js --gens 300          longer
//   node train.js --fresh             ignore the saved champion and start over
//   node train.js --pop 120 --trials 6
// =============================================================================

const fs = require('fs');
const path = require('path');
const { createSimulation } = require('./simulation');
const { TrainingStore } = require('./training-store');

const NL = String.fromCharCode(10);
const ROOT = __dirname;
const outIndex = process.argv.indexOf('--out');
const OUT = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : path.join(ROOT, 'champions');
const store = new TrainingStore(OUT);
const ARCHIVE = path.join(OUT, 'archive');

// ---- command line ----------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
const FLAG = name => argv.includes('--' + name);

const GENS   = arg('gens', 20);
const POP    = arg('pop', 16);
const TRIALS = arg('trials', 3);
const SECS   = arg('secs', 60);

// How many fish share the tank during an evaluation, all running the brain
// being scored. 1 is a pure duel: can this brain escape, personally.
// Higher numbers score the brain as a SPECIES - the mean survival of a whole
// shoal of itself - which is a different and harder problem, because identical
// brains make identical turns, converge onto the same evasive path and pack
// into a line the shark can harvest. A shoal that survives has to have evolved
// to spread out, using nothing but what it can already sense.
const CLONES = arg('clones', 8);

// How many predators share the evaluation tank.
//
// This exists because of a ceiling. Training 45 clones against ONE shark, the
// schooling layer kept 97% of the shoal alive (43.6s of 45s) from generation
// one - so almost every brain scored almost the same, selection had nothing to
// choose between them, and the run could not improve. A score that saturates
// cannot teach, exactly as it could not back when generations were 30s long.
//
// Adding predators restores the gradient. Do not overdo it: three sharks once
// cut survival to 11s and learning collapsed the other way, because outcomes
// stopped depending on skill. Aim for a mean somewhere around half the cap.
const SHARKS = arg('sharks', 1);

// Probability that an add-connection mutation looks for a MEMORY edge.
// --recurrent 0 reproduces the old strictly feed-forward behaviour, which is
// the control this feature has to beat before it earns its place.
const RECURRENT = arg('recurrent', -1);
// Mutable, because --repeat switches it off after the first cycle: only the
// first may start from nothing, the rest must build on what it produced.
let FRESH_OVERRIDE = FLAG('fresh');
for (const [name, value] of Object.entries({ gens: GENS, pop: POP, trials: TRIALS, clones: CLONES, secs: SECS })) {
  if (!Number.isFinite(value) || value <= 0 || (name !== 'secs' && !Number.isInteger(value))) {
    throw Error('--' + name + ' must be a positive ' + (name === 'secs' ? 'number' : 'integer'));
  }
}

// ---- load the simulation ----------------------------------------------------
const { CONFIG, World, Genome, Evolution, Innovation, Rng, Senses, Persist } = createSimulation();
const DISPLAY_CLONES = CONFIG.fish.count;

// Thousands of throwaway worlds get built below; the innovation numbering must
// survive all of them or shared history is lost.
World.keepInnovation = true;

// ...but it does have to be initialised ONCE. Without this, nextNodeId starts
// at 0, so the first neuron evolution grows is given id 0 - which is already an
// input node. The genome then has two different nodes claiming one id, and its
// index map, depth pass and distance calculation all quietly disagree.
Innovation.reset();

CONFIG.fish.count = POP;
CONFIG.evolution.trials = 1;        // the trainer does its own averaging

// CRITICAL. The evaluation tanks below must not evolve anything.
//
// Each evaluation builds a private world with one fish. When that fish is
// eaten, aliveCount() hits zero and world.update() calls nextGeneration() -
// which breeds, issues new innovation numbers, and ADAPTS THE SHARED SPECIES
// THRESHOLD. Thousands of evaluations therefore dragged the threshold from
// 0.25 down to near zero, at which point every single brain landed in a
// species of its own, each species got a quota of one, and selection stopped
// happening entirely. The trainer was faithfully copying the population
// forward and calling it evolution.
//
// The trainer does all its own breeding, so the tanks only need to simulate.
CONFIG.evolution.enabled = false;
CONFIG.shark.count = SHARKS;
if (RECURRENT >= 0) CONFIG.genome.recurrentRate = RECURRENT;
CONFIG.sim.generationSeconds = SECS;
CONFIG.schooling.enabled = !FLAG('neural-only');

// Scores belong to an environment as well as a genome. Changing the social
// controller, predator rule, trial duration or physics invalidates old scores.
const REGIME = CONFIG.schooling.enabled ? 'social-v2' : 'neural-circle-v1';
const EVALUATION = JSON.stringify({ regime: REGIME, clones: CLONES, seconds: SECS,
  dt: CONFIG.sim.dt,
  fish: { speed: CONFIG.fish.maxSpeed, turn: CONFIG.fish.turnRate, radius: CONFIG.fish.radius },
  shark: CONFIG.shark, tank: CONFIG.tank, senses: CONFIG.senses, schooling: CONFIG.schooling });
const DISPLAY_EVALUATION = JSON.stringify({ ...JSON.parse(EVALUATION), regime: 'social-v2', clones: DISPLAY_CLONES,
  schooling: { ...CONFIG.schooling, enabled: true }, seconds: 60, seedBase: 7300001, runs: 12 });

// =============================================================================
// EVALUATION - one brain, one shark, one empty tank.
// =============================================================================
// Returns mean seconds survived across `trials` runs, each from a different
// starting position. The seed varies per trial AND per generation, so a brain
// cannot get good at one particular opening and stop there.
// =============================================================================
function evaluate(brain, trials, seedBase, options = {}) {
  const savedCount = CONFIG.fish.count;
  const savedSeconds = CONFIG.sim.generationSeconds;
  const clones = options.clones || CLONES;
  CONFIG.fish.count = clones;
  CONFIG.sim.generationSeconds = options.seconds || SECS;

  try {
  let total = 0;
  const maxTicks = Math.round(CONFIG.sim.generationSeconds / CONFIG.sim.dt) - 1;

  for (let t = 0; t < trials; t++) {
    CONFIG.seed = seedBase + t * 7919;        // a prime, to avoid seed patterns
    const w = new World();

    // Every fish in the tank runs the brain being scored. No clone() needed -
    // nothing here mutates it - but they must be separate objects so each can
    // hold its own last-decision state.
    const watched = w.fish.slice();
    for (const f of watched) f.net = clones === 1 ? brain : brain.clone();

    // Hold references. Once every fish is dead, world.update() respawns the
    // tank, and reading w.fish afterwards would give newborns with random
    // brains and an age of zero.
    let ticks = 0;
    while (ticks < maxTicks && watched.some(f => f.alive)) {
      w.update(CONFIG.sim.dt);
      ticks++;
    }

    // The MEAN across the shoal. Scoring the best fish instead would let one
    // lucky survivor hide a massacre.
    let sum = 0;
    for (const f of watched) sum += f.age;
    total += sum / watched.length;
  }

  return total / trials;
  } finally {
    CONFIG.fish.count = savedCount;
    CONFIG.sim.generationSeconds = savedSeconds;
  }
}

// The held-out test. FIXED seeds, never used in training, so improvement here
// means the brain got better at escaping rather than better at one scenario.
function benchmark(brain, runs) {
  const n = runs || 20;
  let total = 0;
  for (let r = 0; r < n; r++) total += evaluate(brain, 1, 500000 + r * 104729);
  return total / n;
}

function displayBenchmark(brain) {
  const savedSchooling = CONFIG.schooling.enabled;
  CONFIG.schooling.enabled = true;
  try {
    let total = 0;
    for (let i = 0; i < 12; i++) total += evaluate(brain, 1, 7300001 + i * 104729,
      { clones: DISPLAY_CLONES, seconds: 60 });
    return total / 12;
  } finally { CONFIG.schooling.enabled = savedSchooling; }
}

// =============================================================================
// PERSISTENCE - the project remembers, and keeps getting better.
// =============================================================================
function ensureDirs() {
  for (const d of [OUT, ARCHIVE]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// A solo score and a shoal score are not the same measurement, so each mode
// keeps its own champion file. Loading one to continue the other would compare
// numbers that mean different things.
function championFile() {
  return path.join(OUT, 'best-' + REGIME + '-shoal' + CLONES + '.json');
}

function loadChampion() {
  let file = championFile();
  // Old champions are compatible ancestors, but their benchmark is not reused.
  if (!fs.existsSync(file)) file = path.join(OUT,
    CLONES === 1 ? 'best.json' : 'best-shoal' + CLONES + '.json');
  if (!fs.existsSync(file)) file = path.join(OUT, 'best-shoal8.json');
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const brain = loadIfCompatible(data, 'champion');
    return brain ? { brain, data } : null;
  } catch (err) {
    console.log('  (could not read the saved champion: ' + err.message + ')');
    return null;
  }
}

function saveChampion(brain, score, generation, totalGens) {
  ensureDirs();
  const data = Persist.toJSON(brain, {
    generation,
    totalGenerations: totalGens,
    benchmark: score,
    params: brain.paramCount(),
    hidden: brain.hiddenCount(),
    senses: Senses.COUNT,
    clones: CLONES,
    sharks: SHARKS,
    seconds: SECS,
    evaluation: EVALUATION,
  });
  const text = JSON.stringify(data, null, 2);

  store.write(path.basename(championFile()), text);

  // The same brain as a plain script. The browser cannot fetch() a local JSON
  // file from a file:// page (CORS blocks it), but it CAN load a script tag -
  // so this is how the page picks the champion up with no server involved.
  // Browser promotion happens only after the separate display-size benchmark.
  store.archive(REGIME + '-shoal' + CLONES + '-gen' + totalGens, data);
  return data;
}

function totalGenerationsSoFar() {
  const rows = store.read('history.json') || [];
  return rows.reduce((a, r) => Math.max(a, r.totalGenerations || 0), 0);
}

// =============================================================================
// THE TRAINING LOOP
// =============================================================================
// A stored brain is only loadable while the sense layout it was trained under
// still matches - widening vision from 5 rays to 9 invalidates every older
// champion, and Persist refuses them on purpose. The trainer should start
// fresh rather than refuse to run.
function loadIfCompatible(data, what) {
  if (!data) return null;
  try { return Persist.fromJSON(data); }
  catch (err) {
    console.log('  ignoring the stored ' + what + ': ' + err.message);
    return null;
  }
}
// =============================================================================
// PRUNING - keep the record useful, not merely large.
// =============================================================================
// Two kinds of file stop being worth keeping.
//
// OBSOLETE: a brain saved under a different sense layout. When vision widened
// from 5 rays to 9, every older champion became unloadable - Persist refuses
// them, correctly, because their inputs mean something different now. They
// cannot be run, compared, or resumed from. They are not history, they are
// litter.
//
// SUPERSEDED: archived snapshots that are neither among the best nor among the
// most recent. The archive exists so a good brain is never lost to a bad run;
// it does not need every step of the climb.
//
// What is never touched: history.json (the accumulating record of every
// training run, which is the thing that makes progress legible across
// sessions), and any brain that still matches the current sense layout and is
// either the best or the newest.
// =============================================================================

function readJsonish(file) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    // best.js and its backups are an assignment, not bare JSON.
    const eq = text.indexOf('=');
    if (!text.trimStart().startsWith('{') && eq > 0) {
      text = text.slice(eq + 1).trim().replace(/;s*$/, '');
    }
    return JSON.parse(text);
  } catch (err) { return null; }
}

// How many INPUT nodes a stored brain expects. Null when the file is not a
// brain at all, in which case it is left alone.
function storedSenseCount(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.kind === 'genome') {
    if (!Array.isArray(data.nodes)) return null;
    return data.nodes.filter(n => n.type === 0).length;
  }
  if (data.kind === 'layered') {
    return data.layers && data.layers[0] ? data.layers[0].inputCount : null;
  }
  return null;
}

const NEVER_PRUNE = new Set(['history.json', 'training-progress.json']);

function prune(keep) {
  if (!fs.existsSync(OUT)) return;
  const removed = { obsolete: 0, superseded: 0 };

  // --- top level: anything built for a different sense layout ---
  for (const name of fs.readdirSync(OUT)) {
    if (NEVER_PRUNE.has(name)) continue;
    const file = path.join(OUT, name);
    if (fs.statSync(file).isDirectory()) continue;
    if (!/.(json|js|bak)$/.test(name)) continue;

    const senses = storedSenseCount(readJsonish(file));
    if (senses !== null && senses !== Senses.COUNT) {
      fs.unlinkSync(file);
      removed.obsolete++;
    }
  }

  // --- archive: drop obsolete, then keep the best and the newest ---
  if (!fs.existsSync(ARCHIVE)) return report(removed);
  const entries = [];
  for (const name of fs.readdirSync(ARCHIVE)) {
    const file = path.join(ARCHIVE, name);
    const data = readJsonish(file);
    const senses = storedSenseCount(data);
    if (senses !== null && senses !== Senses.COUNT) {
      fs.unlinkSync(file);
      removed.obsolete++;
      continue;
    }
    entries.push({
      file,
      score: (data && data.meta && data.meta.benchmark) || 0,
      time: fs.statSync(file).mtimeMs,
    });
  }

  const survivors = new Set();
  entries.slice().sort((a, b) => b.score - a.score).slice(0, keep)
         .forEach(e => survivors.add(e.file));
  // Always keep the two most recent as well, even if they scored poorly - a
  // run in progress should not delete the snapshot it just wrote.
  entries.slice().sort((a, b) => b.time - a.time).slice(0, 2)
         .forEach(e => survivors.add(e.file));

  for (const e of entries) {
    if (survivors.has(e.file)) continue;
    fs.unlinkSync(e.file);
    removed.superseded++;
  }
  report(removed);
}

function report(removed) {
  const total = removed.obsolete + removed.superseded;
  if (!total) return;
  console.log('  pruned ' + total + ' file(s): ' + removed.obsolete +
              ' from an older sense layout, ' + removed.superseded + ' superseded');
}
function main() {
  ensureDirs();
  if (!FLAG('no-prune')) prune(arg('keep', 6));
  if (FLAG('prune-only')) return;
  const runSeed = arg('seed', Date.now() >>> 0);
  const rng = new Rng(runSeed);
  let carried = totalGenerationsSoFar();
  const runId = new Date().toISOString() + '-' + process.pid;
  const t0 = Date.now();

  // ---- the starting population ----
  let population = [];
  const saved = FRESH_OVERRIDE ? null : loadChampion();

  if (saved) {
    console.log('\n  resuming from a saved champion  ' +
                '(' + saved.data.meta.benchmark + 's, ' +
                saved.data.meta.params + ' params, after ' +
                (saved.data.meta.totalGenerations || '?') + ' generations)');
    // One untouched copy, the rest mutated children. The saved brain becomes
    // the ancestor of the whole new run rather than one individual in a crowd.
    Innovation.absorb(saved.brain);
    population.push(saved.brain.clone());
    while (population.length < POP) {
      const child = saved.brain.clone();
      child.mutate(rng, CONFIG.evolution.mutationRate, CONFIG.evolution.mutationStrength);
      population.push(child);
    }
  } else {
    console.log('\n  starting fresh');
    for (let i = 0; i < POP; i++) population.push(Genome.minimal(rng));
  }

  // A benchmark carried over from a DIFFERENT evaluation mode is not a number
  // this run can be compared against - a solo score and a shoal score measure
  // different things. Keep the brain, discard the score.
  const sameMode = saved && saved.data.meta && saved.data.meta.evaluation === EVALUATION;
  if (saved && !sameMode) {
    console.log('  (its score was measured in a different mode, so starting the' +
                ' scoreboard fresh)');
  }
  // Re-evaluate the ancestor before replacing it, so a worse first generation
  // cannot overwrite a stronger imported brain just because its score was old.
  let bestScore = sameMode ? saved.data.meta.benchmark : saved ? benchmark(saved.brain) : -Infinity;
  let bestBrain = saved ? saved.brain : null;
  if (saved && !sameMode) saveChampion(bestBrain, bestScore, 0, carried);

  // Keep a separate display champion: an eight-fish training score cannot
  // prove that a brain improves the 45-fish school shown on the page.
  let displayData = store.display();
  let displayBrain = loadIfCompatible(displayData, 'display champion') || bestBrain;
  if (displayData && !displayBrain) displayData = null;
  console.log('  validating the display champion with ' + DISPLAY_CLONES + ' fish...');
  let displayScore = displayData && displayData.meta.displayEvaluation === DISPLAY_EVALUATION
    ? displayData.meta.displayBenchmark : displayBrain ? displayBenchmark(displayBrain) : -Infinity;
  function publishDisplay(brain, meta) {
    displayData = Persist.toJSON(brain, { ...meta, params: brain.paramCount(), hidden: brain.hiddenCount(),
      displayBenchmark: displayScore, displayEvaluation: DISPLAY_EVALUATION,
      displayClones: DISPLAY_CLONES, displaySeconds: 60 });
    store.publish(displayData);
  }
  if (displayBrain) publishDisplay(displayBrain, displayData ? displayData.meta : { totalGenerations: carried });
  console.log('  display baseline: ' + displayScore.toFixed(3) + 's of 60s');

  function recordProgress(completed, status) {
    return store.progress({ runId, started: new Date(t0).toISOString(), finished: new Date().toISOString(), status,
      generations: completed, requestedGenerations: GENS, totalGenerations: carried + completed,
      population: POP, trials: TRIALS, clones: CLONES, seconds: SECS, seed: runSeed, evaluation: EVALUATION,
      benchmark: bestScore, displayBenchmark: displayScore,
      params: bestBrain ? bestBrain.paramCount() : 0, hidden: bestBrain ? bestBrain.hiddenCount() : 0,
      minutes: (Date.now() - t0) / 60000 });
  }
  recordProgress(0, 'running');

  console.log('  population ' + POP + ' \u00b7 ' + TRIALS + ' trials each \u00b7 ' +
              SECS + 's max \u00b7 ' + GENS + ' generations');
  console.log('  each brain controls ' + CLONES + ' fish; regime ' + REGIME + '\n');
  console.log('  gen     mean    best   params  hidden  memory  species     held-out');
  console.log('  ' + '-'.repeat(72));

  for (let gen = 1; gen <= GENS; gen++) {
    // ---- SCORE: each brain alone, several times ----
    // The seed base moves every generation, so the population is never
    // optimising against one fixed set of openings.
    const seedBase = 1000 + (carried + gen) * 31013;
    const scored = population.map(brain => ({
      brain,
      fitness: evaluate(brain, TRIALS, seedBase),
    }));

    let sum = 0, best = -Infinity, bestOfGen = null;
    for (const s of scored) {
      sum += s.fitness;
      if (s.fitness > best) { best = s.fitness; bestOfGen = s.brain; }
    }
    const mean = sum / scored.length;

    // ---- BENCHMARK the generation's champion on unseen seeds ----
    let note = '';
    if (gen % 5 === 0 || gen === GENS) {
      const score = benchmark(bestOfGen);
      note = score.toFixed(1) + 's';
      if (score > bestScore) {
        bestScore = score;
        bestBrain = bestOfGen.clone();
        saveChampion(bestBrain, score, gen, carried + gen);
        note += '  SAVED';
      }
      const screenScore = displayBenchmark(bestOfGen);
      note += ' / display ' + screenScore.toFixed(2) + 's';
      if (screenScore > displayScore) {
        displayScore = screenScore;
        displayBrain = bestOfGen.clone();
        publishDisplay(displayBrain, { generation: gen, totalGenerations: carried + gen,
          benchmark: score, evaluation: EVALUATION, clones: CLONES });
        note += '  PROMOTED';
      }
    }

    console.log('  ' + String(gen).padEnd(6) +
                mean.toFixed(1).padStart(7) + 's' +
                best.toFixed(1).padStart(7) + 's' +
                bestOfGen.paramCount().toString().padStart(8) +
                bestOfGen.hiddenCount().toString().padStart(8) +
                (bestOfGen.memoryCount ? bestOfGen.memoryCount() : 0).toString().padStart(8) +
                String(Evolution.speciate(scored).length).padStart(8) +
                note.padStart(14));

    // ---- BREED ----
    const result = CONFIG.genome.useSpecies
      ? Evolution.breedSpeciated(scored, rng)
      : { brains: Evolution.breed(scored, rng) };
    population = result.brains;
    recordProgress(gen, gen === GENS ? 'complete' : 'running');
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  if (displayBrain) publishDisplay(displayBrain, { ...displayData.meta, trainingTotalGenerations: carried + GENS });
  const runs = (store.read('history.json') || []).length;

  console.log('\n  done in ' + mins + ' min \u00b7 training run #' + runs +
              ' \u00b7 ' + (carried + GENS) + ' generations of accumulated evolution');
  console.log('  best held-out survival: ' + bestScore.toFixed(1) + 's of ' + SECS + 's' +
              (bestBrain ? '  (' + bestBrain.paramCount() + ' params, ' +
               bestBrain.hiddenCount() + ' hidden)' : ''));
  console.log('  improvements save to ' + championFile() + ' and champions/best.js');
  console.log('  run again to continue from here, or --fresh to start over\n');
}

// ---------------------------------------------------------------------------
// KEEP GOING
// ---------------------------------------------------------------------------
// --repeat N runs N cycles back to back. Each cycle resumes from the champion
// the previous one saved and prunes before it starts, so a single command can
// be left running and the record stays tidy while it improves.
//
// Cycles rather than simply a larger --gens because each one re-reads the
// saved champion, re-runs the held-out benchmark and writes a history row.
// If a cycle goes badly the next starts from the last brain that actually
// scored well, instead of carrying a bad population forward for hours.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const cycles = Math.max(1, arg('repeat', 1));
  for (let cycle = 1; cycle <= cycles; cycle++) {
    if (cycles > 1) console.log(NL + '  ===== cycle ' + cycle + ' of ' + cycles + ' =====');
    main();
    // Only the first cycle may start fresh; the rest must build on it.
    FRESH_OVERRIDE = false;
  }
}
module.exports = { evaluate, benchmark, displayBenchmark, loadChampion, championFile, EVALUATION, DISPLAY_EVALUATION };
