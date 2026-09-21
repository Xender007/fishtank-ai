// =============================================================================
// coevolve.js - fish and shark, taking turns to learn. Run with: node coevolve.js
// =============================================================================
// CO-EVOLUTION. Each round:
//
//   1. the FISH train for a while against the newest trained shark (plus one
//      older shark from its record - a hall of fame, so a trick has to keep
//      beating yesterday's predator too);
//   2. the SHARK trains for a while against the newest champion fish;
//   3. both are measured against each other AND against where they started.
//
// Why step 3 matters: when both sides move, one number cannot tell you who is
// improving. "Fish eaten per minute" can stay flat while BOTH get much better
// - the Red Queen, running to stay in place. The only way to see progress is
// to replay today's fish against the ORIGINAL shark and the original fish
// against today's shark. If today's fish beat the old shark better than the
// old fish did, the fish really learned something; likewise the shark.
//
// Usage:
//   node coevolve.js --rounds 3 --fish-gens 10 --shark-gens 15
//   (any train.js option also applies to the fish phase: --pop, --trials,
//    --secs, --sharks, --workers, --rules, --hand-planner, --no-hunger ...)
// =============================================================================

const fs = require('fs');
const path = require('path');
const fishTrainer = require('./train');
const sharkTrainer = require('./train-shark');
const { Pool } = require('./parallel');
const { snapshotConfig } = require('./evaluation');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : fallback;
};

const ROUNDS = arg('rounds', 3);
const FISH_GENS = arg('fish-gens', 10);
const SHARK_GENS = arg('shark-gens', 15);
const SEEDS = Array.from({ length: arg('score-seeds', 12) }, (_, i) => 9100001 + i * 104729);

const { S } = fishTrainer;
const { Persist } = S;

// The page's setting: 45 fish, ONE shark, 60 seconds. Eaten and starved per run.
async function match(pool, fishBrain, sharkBrain, config) {
  const fish = Persist.toJSON(fishBrain), shark = sharkBrain ? sharkBrain.toJSON() : null;
  const r = await pool.map(SEEDS.map(seed => ({ kind: 'match', brain: fish, sharkBrain: shark,
    fish: 45, sharks: 1, seconds: 60, seed, config })));
  const mean = k => r.reduce((a, x) => a + x[k], 0) / r.length;
  return { eaten: mean('eaten'), starved: mean('starved'), sharkStarvations: mean('sharkStarvations') };
}

const fmt = m => (m.eaten.toFixed(1) + ' eaten').padStart(12) + (m.starved.toFixed(1) + ' starved').padStart(13);

async function main() {
  const fishOpts = fishTrainer.parseOptions(argv);
  fishOpts.gens = FISH_GENS;
  const sharkOpts = sharkTrainer.parseOptions(argv);
  sharkOpts.gens = SHARK_GENS;
  sharkOpts.benchmark = false;
  const out = fishOpts.out;
  const pool = new Pool(fishOpts.workers);
  S.Profiles.v3({ teamwork: fishOpts.teamwork, planner: fishOpts.planner, hunger: fishOpts.hunger });

  // Where both sides START. Everything is measured against these as well.
  const fish0 = sharkTrainer.loadFishChampion(out).brain;
  const history0 = sharkTrainer.loadHistory(out);
  const shark0 = history0.length ? history0[history0.length - 1] : null;
  const logFile = path.join(out, 'coevolution.json');
  const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : [];

  console.log('\n  CO-EVOLUTION · ' + ROUNDS + ' rounds · fish ' + FISH_GENS + ' gens, shark ' + SHARK_GENS +
              ' gens per round · ' + pool.size + ' worker thread(s)');
  console.log('  starting shark: ' + (shark0 ? 'generation ' + shark0.generation : 'none - the fish face the chaser first'));

  const t0 = Date.now();
  for (let round = 1; round <= ROUNDS; round++) {
    console.log('\n  ===== round ' + round + ' of ' + ROUNDS + ': the fish train =====');
    await fishTrainer.trainFish(fishOpts, { pool });
    fishOpts.fresh = false;
    fishOpts.seed = (fishOpts.seed + 7919) >>> 0;   // a new breeding stream each round

    const fishNow = sharkTrainer.loadFishChampion(out);
    console.log('\n  ===== round ' + round + ' of ' + ROUNDS + ': the shark trains =====');
    const { newest } = await sharkTrainer.trainShark(sharkOpts, { pool, fishBrain: fishNow.brain, fishMeta: fishNow.meta });
    sharkOpts.fresh = false;

    // ---- the scoreboard ----
    const config = snapshotConfig(S.CONFIG);
    const fishLive = S.Persist.fromJSON(S.Persist.toJSON(fishNow.brain));
    const [now, newFishOldShark, oldFishNewShark, oldBoth] = await Promise.all([
      match(pool, fishLive, newest.brain, config),
      match(pool, fishLive, shark0 && shark0.brain, config),
      match(pool, fish0, newest.brain, config),
      match(pool, fish0, shark0 && shark0.brain, config),
    ]);
    console.log('\n  scoreboard after round ' + round + ' (45 fish, 1 shark, 60s, ' + SEEDS.length + ' held-out seeds):');
    console.log('    starting fish  vs starting shark ' + fmt(oldBoth));
    console.log('    NEW fish       vs starting shark ' + fmt(newFishOldShark) + '   <- did the fish improve?');
    console.log('    starting fish  vs NEW shark      ' + fmt(oldFishNewShark) + '   <- did the shark improve?');
    console.log('    NEW fish       vs NEW shark      ' + fmt(now));
    log.push({ round, finished: new Date().toISOString(), minutes: (Date.now() - t0) / 60000,
      fishGenerations: FISH_GENS, sharkGenerations: SHARK_GENS, sharkGeneration: newest.generation,
      startSharkGeneration: shark0 ? shark0.generation : null,
      oldBoth, newFishOldShark, oldFishNewShark, now });
    fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
  }
  pool.close();
  console.log('\n  co-evolution done in ' + ((Date.now() - t0) / 60000).toFixed(1) + ' min · scoreboard in ' + logFile);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
