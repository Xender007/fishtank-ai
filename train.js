// =============================================================================
// train.js - the offline fish trainer. Run with: node train.js
// =============================================================================
// The browser page is for WATCHING. This is for training.
//
// -----------------------------------------------------------------------------
// WHAT CHANGED ON 2026-09-21 (layout v3), and why each default is what it is
// -----------------------------------------------------------------------------
//  1. CO-EVOLUTION. The fish train against the TRAINED shark brain
//     (champions/shark-history.json), not the brainless chaser. The shark has
//     learned to beat the school; a fish trained only against a chaser is
//     trained for an opponent it will not meet on the page.
//  2. LEARNED TEAMWORK and 6. LEARNED PLANNING: Profiles.v3 hands pack
//     steering and route choice to the network (see js/config.js).
//  3. 45 FISH. Every brain is scored as a shoal of 45 copies of itself - the
//     size the page shows. The previous champion was trained at 8 and 12.
//  4. HARDER, AND IT STAYS HARD. Two trained sharks, hunger, and a difficulty
//     ladder that adds a shark whenever the population gets comfortable.
//  5. A BIGGER POPULATION: 48 brains a generation (was 16), with the target
//     species count scaled so each species still has ~10 members to shelter a
//     new neuron while it tunes.
//  7. HUNGER: fish must eat or starve (CONFIG.hunger).
//  8. ALL CPU CORES: evaluations run on a worker-thread pool (parallel.js).
//
// -----------------------------------------------------------------------------
// WHY EACH BRAIN IS SCORED AS A SHOAL OF ITSELF
// -----------------------------------------------------------------------------
// In a crowd of different brains one shark chases the nearest fish and the
// rest are safe for free, so "seconds survived" measures WHETHER SOMEONE ELSE
// WAS CLOSER (finding #1). A tank full of one brain has no one else to blame:
// the mean survival of the shoal is that brain's score, and nothing else's.
//
// Usage:
//   node train.js                      20 generations, resuming from the champion
//   node train.js --gens 60 --repeat 5
//   node train.js --opponent chaser    the old brainless shark
//   node train.js --rules              hand-written pack steering (control)
//   node train.js --hand-planner       hand-written route ranking (control)
//   node train.js --no-hunger          no food, no starvation (control)
//   node train.js --workers 0          single thread (debugging)
//   node train.js --fresh              ignore the champion, start from nothing
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createSimulation } = require('./simulation');
const { TrainingStore } = require('./training-store');
const { Pool } = require('./parallel');
const { snapshotConfig } = require('./evaluation');

const NL = String.fromCharCode(10);
const ROOT = __dirname;

// ---- the simulation this thread breeds in ------------------------------------
const S = createSimulation();
const { CONFIG, Profiles, World, Genome, Evolution, Innovation, Rng, Senses, Persist, SharkHistory } = S;

// Thousands of throwaway worlds get built by the evaluators; the innovation
// numbering must survive all of them or shared history is lost. It still has
// to be initialised ONCE (invariant #7), or the first grown neuron is given id
// 0 - already an input.
World.keepInnovation = true;
Innovation.reset();

// CRITICAL (invariant #6). The evaluation tanks must not evolve anything: a
// tank whose last fish dies calls nextGeneration(), which breeds, issues new
// innovation numbers and adapts the SHARED species threshold. Thousands of
// evaluations once dragged that threshold to zero and switched selection off
// entirely while the logs looked fine. The trainer does its own breeding.
CONFIG.evolution.enabled = false;
CONFIG.evolution.trials = 1;

// =============================================================================
// OPTIONS
// =============================================================================
function parseOptions(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : fallback;
  };
  const str = (name, fallback) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const flag = name => argv.includes('--' + name);
  const T = CONFIG.training;
  const o = {
    gens: arg('gens', 20),
    pop: arg('pop', T.population),
    trials: arg('trials', T.trials),
    secs: arg('secs', T.seconds),
    clones: arg('clones', T.clones),
    sharks: arg('sharks', T.sharks),
    // 'shark' = the newest trained shark brain (plus a hall of fame), falling
    // back to the chaser only when no shark has been trained yet.
    opponent: str('opponent', 'shark'),
    hall: arg('hall', 1),
    race: arg('race', 8),
    raceTrials: arg('race-trials', 9),
    ladder: !flag('no-ladder'),
    workers: arg('workers', undefined),
    recurrent: arg('recurrent', -1),
    seed: arg('seed', Date.now() >>> 0),
    keep: arg('keep', 6),
    repeat: Math.max(1, arg('repeat', 1)),
    fresh: flag('fresh'),
    prune: !flag('no-prune'),
    pruneOnly: flag('prune-only'),
    neuralOnly: flag('neural-only'),
    teamwork: !flag('rules'),
    planner: !flag('hand-planner'),
    hunger: !flag('no-hunger'),
    prior: !flag('no-prior'),
    out: str('out', null) ? path.resolve(str('out', null)) : path.join(ROOT, 'champions'),
    quiet: flag('quiet'),
  };
  for (const name of ['gens', 'pop', 'trials', 'clones', 'secs', 'sharks']) {
    const v = o[name];
    if (!Number.isFinite(v) || v <= 0 || (name !== 'secs' && !Number.isInteger(v))) {
      throw Error('--' + name + ' must be a positive ' + (name === 'secs' ? 'number' : 'integer'));
    }
  }
  return o;
}

// =============================================================================
// THE OPPONENT - which shark brains the fish train against.
// =============================================================================
// The newest trained shark, plus `hall` older champions: a HALL OF FAME. Pure
// newest-vs-newest co-evolution can cycle - the fish learn to beat today's
// shark and forget yesterday's, the shark learns yesterday's trick again, and
// round and round (the Red Queen running in place). Keeping an older shark in
// the rotation means a trick has to keep working against it too.
// =============================================================================
function loadSharkOpponents(out, hall) {
  const file = path.join(out, 'shark-history.json');
  if (!fs.existsSync(file)) return [];
  const history = SharkHistory.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!history.length) return [];
  const newest = history[history.length - 1];
  const picks = [newest];
  for (let k = 1; k <= hall && history.length > 1; k++) {
    // Evenly spaced back through the record: with one, the halfway point.
    const e = history[Math.floor((history.length - 1) * (1 - k / (hall + 1)))];
    if (!picks.includes(e)) picks.push(e);
  }
  return picks;
}

const fingerprint = data => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 10);

// =============================================================================
// PRUNING - keep the record useful, not merely large.
// =============================================================================
// OBSOLETE: a brain saved under a sense layout that can neither be loaded nor
// migrated. Layout v2 (12 inputs) is NOT obsolete: v3 appended senses, so v2
// brains migrate (Genome.migrateLegacy) and are kept.
// SUPERSEDED: archived snapshots that are neither among the best `keep` nor
// among the two most recent.
// Never touched: history.json and training-progress.json.
// =============================================================================
function readJsonish(file) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    // best.js and shark-best.js are an assignment, not bare JSON.
    const eq = text.indexOf('=');
    if (!text.trimStart().startsWith('{') && eq > 0) {
      text = text.slice(eq + 1).trim().replace(/;\s*$/, '');
    }
    return JSON.parse(text);
  } catch (err) { return null; }
}

// How many INPUT nodes a stored brain expects. Null when the file is not a
// fish brain at all, in which case it is left alone.
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

const loadable = n => n === null || n === Senses.COUNT || n === Senses.LEGACY_V2_COUNT;
const NEVER_PRUNE = new Set(['history.json', 'training-progress.json', 'coevolution.json']);

function prune(out, keep) {
  if (!fs.existsSync(out)) return;
  const removed = { obsolete: 0, superseded: 0 };
  for (const name of fs.readdirSync(out)) {
    if (NEVER_PRUNE.has(name)) continue;
    const file = path.join(out, name);
    if (fs.statSync(file).isDirectory()) continue;
    if (!/\.(json|js|bak)$/.test(name)) continue;
    if (!loadable(storedSenseCount(readJsonish(file)))) { fs.unlinkSync(file); removed.obsolete++; }
  }
  const archive = path.join(out, 'archive');
  if (fs.existsSync(archive)) {
    const entries = [];
    for (const name of fs.readdirSync(archive)) {
      const file = path.join(archive, name);
      const data = readJsonish(file);
      if (!loadable(storedSenseCount(data))) { fs.unlinkSync(file); removed.obsolete++; continue; }
      entries.push({ file, score: (data && data.meta && data.meta.benchmark) || 0, time: fs.statSync(file).mtimeMs });
    }
    const survivors = new Set();
    entries.slice().sort((a, b) => b.score - a.score).slice(0, keep).forEach(e => survivors.add(e.file));
    // A run in progress must never delete the snapshot it just wrote.
    entries.slice().sort((a, b) => b.time - a.time).slice(0, 2).forEach(e => survivors.add(e.file));
    for (const e of entries) if (!survivors.has(e.file)) { fs.unlinkSync(e.file); removed.superseded++; }
  }
  const total = removed.obsolete + removed.superseded;
  if (total) console.log('  pruned ' + total + ' file(s): ' + removed.obsolete +
                         ' unloadable, ' + removed.superseded + ' superseded');
}

// =============================================================================
// THE TRAINING RUN
// =============================================================================
// The page shows 45 fish; remember that number before any option changes it.
const DISPLAY_CLONES = CONFIG.fish.count;

// Seeds per held-out benchmark. Was 20 (and 12 for the page setting). One 45-fish
// trial moves by ~2.9s on luck alone, so 20 runs left a standard error of
// ~0.65s - more than twice the real difference between a champion's mutated
// children (~0.3s). A lucky baseline then blocked every later brain. 36 runs
// brings it to ~0.48s; it is a ratchet, so the bar must not be set by luck.
const BENCH_RUNS = 36;

async function trainFish(o, env) {
  env = env || {};
  const out = o.out;
  const store = new TrainingStore(out);
  for (const d of [out, path.join(out, 'archive')]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  if (o.prune) prune(out, o.keep);
  if (o.pruneOnly) return null;

  // ---- the environment: exactly what the page runs ----
  Profiles.v3({ teamwork: o.teamwork, planner: o.planner, hunger: o.hunger });
  CONFIG.schooling.enabled = !o.neuralOnly;
  if (o.recurrent >= 0) CONFIG.genome.recurrentRate = o.recurrent;
  CONFIG.genome.targetSpecies = Math.max(4, Math.round(o.pop / CONFIG.training.brainsPerSpecies));
  Evolution.threshold = null;

  const opponents = o.opponent === 'chaser' ? [] : loadSharkOpponents(out, o.hall);
  const sharkJSON = opponents.map(e => e.brain.toJSON());
  const pageShark = sharkJSON.length ? [sharkJSON[0]] : [];
  const opponentLabel = opponents.length
    ? 'trained shark gen ' + opponents.map(e => e.generation).join(' + gen ')
    : 'brainless chaser' + (o.opponent === 'chaser' ? '' : ' (no trained shark found)');

  // ---- what a score MEANS. Two scores are comparable only if every one of
  // these matches, so they are fingerprinted into the champion file. ----
  const REGIME = o.neuralOnly ? 'v3-neural'
    : 'v3-' + (o.teamwork ? 'team' : 'rules') + '-' + (o.planner ? 'critic' : 'hand') + (o.hunger ? '-hunger' : '');
  const environment = {
    layout: 'v3', dt: CONFIG.sim.dt,
    fish: { speed: CONFIG.fish.maxSpeed, turn: CONFIG.fish.turnRate, radius: CONFIG.fish.radius },
    shark: { radius: CONFIG.shark.radius, speed: CONFIG.shark.maxSpeed, turn: CONFIG.shark.turnRate,
             circleLimit: CONFIG.shark.circleLimit, circleBreakSeconds: CONFIG.shark.circleBreakSeconds },
    sharkBrain: { starve: CONFIG.sharkBrain.starveSeconds, respawn: CONFIG.sharkBrain.respawnSeconds,
                  minSpeed: CONFIG.sharkBrain.minSpeedFraction },
    tank: CONFIG.tank, senses: CONFIG.senses, schooling: CONFIG.schooling,
    learned: CONFIG.learned, hunger: CONFIG.hunger,
  };
  const EVALUATION = JSON.stringify({ regime: REGIME, clones: o.clones, seconds: o.secs, sharks: o.sharks,
    runs: BENCH_RUNS, seedBase: 500000, opponents: fingerprint(sharkJSON), environment });
  const DISPLAY_EVALUATION = JSON.stringify({ regime: REGIME, clones: DISPLAY_CLONES, seconds: 60, sharks: 1,
    runs: BENCH_RUNS, seedBase: 7300001, opponents: fingerprint(pageShark), environment });
  const championFile = path.join(out, 'best-' + REGIME + '-shoal' + o.clones + '.json');

  const pool = env.pool || new Pool(o.workers);
  const config = snapshotConfig(CONFIG);
  const job = (brain, trials, seedBase, extra) => Object.assign({
    kind: 'fish', brain: Persist.toJSON(brain), trials, seedBase, clones: o.clones, seconds: o.secs,
    sharks: o.sharks, sharkBrains: sharkJSON, config }, extra);

  // The held-out test. FIXED seeds never used in training, so a rise here means
  // the brain got better at escaping rather than at one set of openings.
  async function benchmark(brain) {
    const r = await pool.map(Array.from({ length: BENCH_RUNS }, (_, i) => job(brain, 1, 500000 + i * 104729)));
    return r.reduce((a, x) => a + x.fitness, 0) / r.length;
  }
  // The page's own setting: 45 fish, ONE shark (the newest), 60 seconds.
  async function displayBenchmark(brain) {
    const r = await pool.map(Array.from({ length: BENCH_RUNS }, (_, i) => job(brain, 1, 7300001 + i * 104729,
      { clones: DISPLAY_CLONES, seconds: 60, sharks: 1, sharkBrains: pageShark })));
    return r.reduce((a, x) => a + x.fitness, 0) / r.length;
  }

  // ---- the starting brain ----
  // A v2 brain (12 inputs) is migrated rather than refused; --no-prior wires
  // its new senses at zero instead of the hand prior (the control).
  const load = data => (storedSenseCount(data) === Senses.LEGACY_V2_COUNT && Senses.COUNT !== Senses.LEGACY_V2_COUNT
    ? Genome.migrateLegacy(data, { prior: o.prior }) : Persist.fromJSON(data));
  function loadChampion() {
    const names = fs.readdirSync(out);
    const others = names.filter(n => /^best-.*\.json$/.test(n))
      .map(n => ({ n, t: fs.statSync(path.join(out, n)).mtimeMs })).sort((a, b) => b.t - a.t).map(x => x.n);
    const order = [path.basename(championFile), 'display-best.json', ...others];
    for (const name of [...new Set(order)]) {
      const file = path.join(out, name);
      if (!fs.existsSync(file)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { brain: load(data), data, name };
      } catch (err) { console.log('  ignoring ' + name + ': ' + err.message); }
    }
    return null;
  }

  const rng = new Rng(o.seed);
  const carried = (store.read('history.json') || []).reduce((a, r) => Math.max(a, r.totalGenerations || 0), 0);
  const runId = new Date().toISOString() + '-' + process.pid;
  const t0 = Date.now();

  let population = [];
  const saved = o.fresh ? null : loadChampion();
  if (saved) {
    const m = saved.data.meta || {};
    console.log('\n  resuming from ' + saved.name + (saved.brain.migratedFrom ? ' (migrated from layout ' +
      saved.brain.migratedFrom + (o.prior ? ', teamwork prior' : ', zero prior') + ')' : '') +
      ' · ' + saved.brain.paramCount() + ' params · after ' + (m.totalGenerations || '?') + ' generations');
    // One untouched copy, the rest mutated children: the saved brain becomes
    // the ancestor of the whole run rather than one individual in a crowd.
    Innovation.absorb(saved.brain);
    population.push(saved.brain.clone());
    while (population.length < o.pop) {
      const child = saved.brain.clone();
      child.mutate(rng, CONFIG.evolution.mutationRate, CONFIG.evolution.mutationStrength);
      population.push(child);
    }
  } else {
    console.log('\n  starting fresh');
    for (let i = 0; i < o.pop; i++) population.push(Genome.minimal(rng));
  }

  console.log('  environment: ' + REGIME + ' · opponent: ' + opponentLabel + ' · ' + pool.size + ' worker thread(s)');
  // A score from a different environment is not comparable: keep the brain,
  // re-measure the score before anything is allowed to replace it.
  const sameMode = saved && saved.data.meta && saved.data.meta.evaluation === EVALUATION;
  let bestBrain = saved ? saved.brain : null;
  let bestScore = sameMode ? saved.data.meta.benchmark : saved ? await benchmark(saved.brain) : -Infinity;

  function metaFor(brain, extra) {
    return Object.assign({ senseLayout: 'v3', regime: REGIME, params: brain.paramCount(), hidden: brain.hiddenCount(),
      senses: Senses.COUNT, clones: o.clones, sharks: o.sharks, seconds: o.secs, opponent: opponentLabel,
      opponentGenerations: opponents.map(e => e.generation),
      critic: brain.critic && !brain.critic.isHand() ? brain.critic.describe() : 'hand-written ranking' }, extra);
  }
  function saveChampion(brain, score, generation, total) {
    const data = Persist.toJSON(brain, metaFor(brain, { generation, totalGenerations: total, benchmark: score,
      evaluation: EVALUATION }));
    store.write(path.basename(championFile), JSON.stringify(data, null, 2));
    store.archive(REGIME + '-shoal' + o.clones + '-gen' + total, data);
  }
  if (saved && !sameMode) saveChampion(bestBrain, bestScore, 0, carried);

  // The page's champion is chosen by the PAGE's setting, separately.
  let displayData = store.display();
  const displaySame = displayData && displayData.meta && displayData.meta.displayEvaluation === DISPLAY_EVALUATION;
  let displayBrain = displaySame ? load(displayData) : bestBrain;
  let displayScore = displaySame ? displayData.meta.displayBenchmark : displayBrain ? await displayBenchmark(displayBrain) : -Infinity;
  function publishDisplay(brain, extra) {
    displayData = Persist.toJSON(brain, metaFor(brain, Object.assign({}, extra, {
      displayBenchmark: displayScore, displayEvaluation: DISPLAY_EVALUATION,
      displayClones: DISPLAY_CLONES, displaySeconds: 60, displaySharks: 1 })));
    store.publish(displayData);
  }
  if (displayBrain && !displaySame) publishDisplay(displayBrain, { totalGenerations: carried });
  console.log('  baseline: held-out ' + bestScore.toFixed(2) + 's of ' + o.secs + 's · page setting ' +
              displayScore.toFixed(2) + 's of 60s');

  let trainSharks = o.sharks;
  function recordProgress(completed, status) {
    return store.progress({ runId, started: new Date(t0).toISOString(), finished: new Date().toISOString(), status,
      generations: completed, requestedGenerations: o.gens, totalGenerations: carried + completed,
      population: o.pop, trials: o.trials, clones: o.clones, seconds: o.secs, sharks: o.sharks,
      trainingSharks: trainSharks, regime: REGIME, opponent: opponentLabel, seed: o.seed, workers: pool.size,
      evaluation: EVALUATION, benchmark: bestScore, displayBenchmark: displayScore,
      params: bestBrain ? bestBrain.paramCount() : 0, hidden: bestBrain ? bestBrain.hiddenCount() : 0,
      minutes: (Date.now() - t0) / 60000 });
  }
  recordProgress(0, 'running');

  console.log('  population ' + o.pop + ' · ' + o.trials + ' trials' +
              (o.race ? ' (top ' + o.race + ' raced +' + o.raceTrials + ')' : '') + ' · ' + o.secs + 's · ' + o.clones +
              ' fish per shoal · target species ' + CONFIG.genome.targetSpecies + '\n');
  console.log('  gen    mean    best  eaten starved sharks params hidden  mem spec   held-out');
  console.log('  ' + '-'.repeat(86));

  for (let gen = 1; gen <= o.gens; gen++) {
    const tg = Date.now();
    // The seed base moves every generation, so the population never optimises
    // against one fixed set of openings. Every brain in a generation faces the
    // SAME seeds, so differences are differences in brains.
    const seedBase = 1000 + (carried + gen) * 31013;
    const results = await pool.map(population.map(b => job(b, o.trials, seedBase, { sharks: trainSharks })));
    const scored = population.map((brain, i) => ({ brain, fitness: results[i].fitness }));

    // -------------------------------------------------------------------------
    // RACING - re-measure the finalists before believing them.
    // -------------------------------------------------------------------------
    // MEASURED (2026-09-21): 48 mutated children of the champion, scored twice
    // on independent seed sets, 3 trials each, 45 fish, 3 trained sharks: the
    // two rankings correlated at r = 0.04. The spread BETWEEN children (1.1s)
    // was almost all luck; one brain re-scored on 48 seed sets moved with an
    // sd of 1.7s. So "the best of 48" was mostly the luckiest of 48 - finding
    // #2 again, in a harder world - and it became the elite that the next
    // generation descends from.
    //
    // Scoring all 48 twelve times would cost 4x. Instead the top few get
    // extra trials on fresh (shared) seeds, and the champion and elites are
    // chosen on those. No unverified brain may outrank a verified finalist:
    // anything that was not re-measured is capped at the lowest finalist's
    // corrected score, so luck alone can no longer make an elite.
    // -------------------------------------------------------------------------
    if (o.race > 0 && o.raceTrials > 0) {
      const order = scored.map((s, i) => i).sort((a, b) => scored[b].fitness - scored[a].fitness).slice(0, o.race);
      const extra = await pool.map(order.map(i => job(population[i], o.raceTrials, seedBase + 777767, { sharks: trainSharks })));
      let floor = Infinity;
      order.forEach((i, k) => {
        const s = scored[i];
        s.fitness = (s.fitness * o.trials + extra[k].fitness * o.raceTrials) / (o.trials + o.raceTrials);
        s.raced = true;
        floor = Math.min(floor, s.fitness);
      });
      for (const s of scored) if (!s.raced && s.fitness > floor) s.fitness = floor;
    }

    // The population mean is the plain first-pass mean (every brain measured
    // the same way); "best" is the best RACED score.
    let sum = 0, best = -Infinity, bestOfGen = null, eaten = 0, starved = 0;
    scored.forEach((s, i) => {
      sum += results[i].fitness; eaten += results[i].eaten; starved += results[i].starved;
      if (s.fitness > best) { best = s.fitness; bestOfGen = s.brain; }
    });
    const mean = sum / scored.length;
    const sharksThisGen = trainSharks;

    // THE DIFFICULTY LADDER (item 4). A score that sits near the cap cannot
    // teach (finding #4); one near zero cannot either (finding #5).
    let ladder = '';
    const frac = mean / o.secs, T = CONFIG.training;
    if (o.ladder && frac > T.raiseAbove && trainSharks < T.maxSharks) { trainSharks++; ladder = ' +shark'; }
    else if (o.ladder && frac < T.lowerBelow && trainSharks > 1) { trainSharks--; ladder = ' -shark'; }

    let note = '';
    if (gen % 5 === 0 || gen === o.gens) {
      const [score, screen] = await Promise.all([benchmark(bestOfGen), displayBenchmark(bestOfGen)]);
      note = score.toFixed(1) + 's';
      if (score > bestScore) {
        bestScore = score; bestBrain = bestOfGen.clone();
        saveChampion(bestBrain, score, gen, carried + gen);
        note += ' SAVED';
      }
      note += ' / page ' + screen.toFixed(1) + 's';
      if (screen > displayScore) {
        displayScore = screen; displayBrain = bestOfGen.clone();
        publishDisplay(displayBrain, { generation: gen, totalGenerations: carried + gen, benchmark: score,
          evaluation: EVALUATION });
        note += ' PROMOTED';
      }
    }

    const n = scored.length;
    console.log('  ' + String(gen).padEnd(5) + mean.toFixed(1).padStart(6) + 's' + best.toFixed(1).padStart(7) + 's' +
      (eaten / n).toFixed(1).padStart(7) + (starved / n).toFixed(1).padStart(8) + String(sharksThisGen).padStart(7) +
      String(bestOfGen.paramCount()).padStart(7) + String(bestOfGen.hiddenCount()).padStart(7) +
      String(bestOfGen.memoryCount()).padStart(5) + String(Evolution.speciate(scored).length).padStart(5) +
      '  ' + ((Date.now() - tg) / 1000).toFixed(0).padStart(3) + 's ' + note + ladder);

    // Every generation's champion goes into the page's dropdown.
    store.fishHistory([{ generation: carried + gen, score: +best.toFixed(3), mean: +mean.toFixed(3),
      sharks: sharksThisGen, regime: REGIME, brain: Persist.toJSON(bestOfGen, { generation: carried + gen }) }]);

    const result = CONFIG.genome.useSpecies ? Evolution.breedSpeciated(scored, rng) : { brains: Evolution.breed(scored, rng) };
    population = result.brains;
    recordProgress(gen, gen === o.gens ? 'complete' : 'running');
  }

  if (displayBrain) publishDisplay(displayBrain, Object.assign({}, displayData.meta, { trainingTotalGenerations: carried + o.gens }));
  if (!env.pool) pool.close();

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log('\n  done in ' + mins + ' min · ' + (carried + o.gens) + ' generations of accumulated evolution');
  console.log('  held-out: ' + bestScore.toFixed(2) + 's of ' + o.secs + 's · page setting: ' +
              displayScore.toFixed(2) + 's of 60s');
  if (displayBrain && displayBrain.critic) console.log('  page champion\'s planner: ' + displayBrain.critic.describe());
  return { bestBrain, bestScore, displayBrain, displayScore, regime: REGIME, opponents };
}

// ---------------------------------------------------------------------------
// KEEP GOING: --repeat N runs N cycles, each resuming from the champion the
// previous one saved. If a cycle goes badly the next starts from the last
// brain that actually scored well, instead of carrying a bad population on.
// ---------------------------------------------------------------------------
if (require.main === module) {
  (async () => {
    const o = parseOptions(process.argv.slice(2));
    for (let cycle = 1; cycle <= o.repeat; cycle++) {
      if (o.repeat > 1) console.log(NL + '  ===== cycle ' + cycle + ' of ' + o.repeat + ' =====');
      const r = await trainFish(o);
      if (!r) break;
      o.fresh = false;       // only the first cycle may start from nothing
    }
  })().catch(err => { console.error(err); process.exitCode = 1; });
}

module.exports = { trainFish, parseOptions, loadSharkOpponents, prune, S };
