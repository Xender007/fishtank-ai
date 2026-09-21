// =============================================================================
// tests/v3_benchmark.js - what did layout v3 training actually buy?
// =============================================================================
// Read-only: it never saves a brain. Usage:
//
//   node tests/v3_benchmark.js [seeds=12] [start-champion.json]
//
// Page setting throughout: 45 fish, ONE shark (the newest trained brain),
// 60 seconds, hunger on, held-out seeds 5300001 + i * 104729 that no trainer
// uses. Rows:
//
//   start   the layout-v2 champion, migrated with its teamwork prior (where
//           training began), in the full v3 environment
//   trained the current page champion (champions/best.js), full v3
//   ablations of the trained champion - the SAME brain with one learned part
//   switched back to its written version:
//     - teamwork by the written pack rules instead of its network
//     - routes ranked by the hand formula instead of its evolved critic
// =============================================================================
const fs = require('fs');
const path = require('path');
const { createSimulation } = require('../simulation');
const { Pool } = require('../parallel');
const { snapshotConfig } = require('../evaluation');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'champions');
const SEEDS = Number(process.argv[2]) || 12;

const S = createSimulation();
S.World.keepInnovation = true;
S.Innovation.reset();
S.Profiles.v3();

function readChampion() {
  const win = {};
  new Function('window', fs.readFileSync(path.join(OUT, 'best.js'), 'utf8'))(win);
  return win.CHAMPION;
}
// Where training began: the newest archived brain still in layout v2.
function readStart() {
  if (process.argv[3]) return JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const dir = path.join(OUT, 'archive');
  const files = fs.readdirSync(dir).map(n => path.join(dir, n))
    .map(f => ({ f, t: fs.statSync(f).mtimeMs, d: JSON.parse(fs.readFileSync(f, 'utf8')) }))
    .filter(x => x.d.kind === 'genome' && x.d.nodes.filter(n => n.type === 0).length === S.Senses.LEGACY_V2_COUNT)
    .sort((a, b) => b.t - a.t);
  return files.length ? files[0].d : null;
}

(async () => {
  const pool = new Pool();
  const history = JSON.parse(fs.readFileSync(path.join(OUT, 'shark-history.json'), 'utf8')).generations;
  const shark = history[history.length - 1];
  const trained = readChampion(), start = readStart();
  const base = snapshotConfig(S.CONFIG);
  const variant = patch => { const c = JSON.parse(JSON.stringify(base)); for (const k in patch) Object.assign(c[k], patch[k]); return c; };

  const rows = [];
  if (start) rows.push(['start (v2 champion, migrated)', start, base]);
  rows.push(['trained (page champion)', trained, base]);
  rows.push(['  ...with written pack rules', trained, variant({ learned: { teamwork: false } })]);
  rows.push(['  ...with the hand route formula', trained, variant({ learned: { planner: false } })]);
  rows.push(['  ...with both written', trained, variant({ learned: { teamwork: false, planner: false } })]);

  console.log('\n  45 fish · 1 shark (gen ' + shark.generation + ') · 60s · hunger on · ' + SEEDS + ' held-out seeds\n');
  console.log('  ' + 'brain'.padEnd(36) + 'eaten'.padStart(8) + 'starved'.padStart(9) + 'lost'.padStart(8) +
              'grouped'.padStart(9) + 'pellets'.padStart(9));
  const results = [];
  for (const [label, brain, config] of rows) {
    const r = await pool.map(Array.from({ length: SEEDS }, (_, i) => ({ kind: 'match', brain, sharkBrain: shark.brain,
      fish: 45, sharks: 1, seconds: 60, seed: 5300001 + i * 104729, grouped: true, config })));
    const mean = k => r.reduce((a, x) => a + x[k], 0) / r.length;
    const lost = r.map(x => x.eaten + x.starved);
    const sd = Math.sqrt(lost.reduce((a, x) => a + (x - mean('eaten') - mean('starved')) ** 2, 0) / lost.length);
    const row = { label: label.trim(), eaten: mean('eaten'), starved: mean('starved'), lost: mean('eaten') + mean('starved'),
                  lostSd: sd, grouped: mean('grouped'), pellets: mean('pellets'), perSeed: lost };
    results.push(row);
    console.log('  ' + label.padEnd(36) + row.eaten.toFixed(1).padStart(8) + row.starved.toFixed(1).padStart(9) +
      (row.lost.toFixed(1) + '').padStart(8) + ((100 * row.grouped).toFixed(0) + '%').padStart(9) + row.pellets.toFixed(0).padStart(9));
  }
  pool.close();
  const file = path.join(__dirname, 'results', 'v3-benchmark.jsonl');
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), seeds: SEEDS, shark: shark.generation, results }) + '\n');
  console.log('\n  lost = eaten + starved, of 45. grouped = share of living fish with 6+ packmates within 140px.');
  console.log('  rows appended to ' + path.relative(ROOT, file));
})().catch(err => { console.error(err); process.exitCode = 1; });
