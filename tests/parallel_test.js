// =============================================================================
// tests/parallel_test.js - multi-core training must not change a single score.
// =============================================================================
// Scoring moved into worker threads. That is only safe if a score depends on
// the job alone: the same brain, seed and settings must give the same number
// to the last bit whether it runs here or in a worker, and the page's
// time-sliced shark trainer must agree with the one-shot scorer workers use.
// =============================================================================
const { createSimulation } = require('../simulation');
const { Pool } = require('../parallel');
const { snapshotConfig } = require('../evaluation');

function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}

(async () => {
  console.log('');
  const S = createSimulation();
  S.World.keepInnovation = true;
  S.Innovation.reset();
  S.CONFIG.evolution.enabled = false;
  S.Profiles.v3();
  const rng = new S.Rng(42);
  const fish = S.Genome.minimal(rng);
  for (let i = 0; i < 6; i++) fish.mutate(rng, 0.5, 0.4);   // grow it a little: hidden, memory, critic
  const shark = S.SharkBrain.random(new S.Rng(8));
  const config = snapshotConfig(S.CONFIG);
  const fishJob = { kind: 'fish', brain: S.Persist.toJSON(fish), trials: 2, seedBase: 4242, clones: 12,
                    seconds: 8, sharks: 2, sharkBrains: [shark.toJSON(), null], config };
  const settings = Object.assign({}, S.CONFIG.sharkBrain.train, { population: 3, trials: 2, seconds: 4, fish: 8 });
  const sharkJob = { kind: 'shark', brain: shark.toJSON(), fishBrain: S.Persist.toJSON(fish),
                     baseSeed: 777, generation: 5, settings, config };

  const local = new Pool(0), pool = new Pool(2);
  const [a, b] = [await local.map([fishJob, sharkJob]), await pool.map([fishJob, sharkJob, fishJob])];
  pool.close();
  check('a fish evaluation gives the same score in a worker as in this thread',
    JSON.stringify(a[0]) === JSON.stringify(b[0]) && JSON.stringify(b[0]) === JSON.stringify(b[2]),
    a[0].fitness.toFixed(6) + 's');
  check('a shark evaluation gives the same score in a worker as in this thread',
    JSON.stringify(a[1]) === JSON.stringify(b[1]), a[1].score.toFixed(6));

  // The page path (step() in slices) against the worker path (scoreCandidate).
  const T = new S.SharkTrainer({ fishBrain: fish, seed: 777, startGeneration: 5, settings });
  const first = T.population[0].clone();
  while (T.index === 0) T.step(37);                 // odd chunk size on purpose
  const sliced = T.scores[0];
  const T2 = new S.SharkTrainer({ fishBrain: fish, seed: 777, startGeneration: 5, settings });
  const whole = T2.scoreCandidate(first).score;
  check('the page\'s time-sliced shark scoring matches the one-shot scorer to the last bit',
    sliced === whole, sliced.toFixed(6) + ' vs ' + whole.toFixed(6));
})().catch(err => { console.log('  FAIL  ' + err.stack); process.exitCode = 1; });
