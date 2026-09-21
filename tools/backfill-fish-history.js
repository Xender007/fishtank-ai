// =============================================================================
// tools/backfill-fish-history.js - build the fish-generation dropdown's list
// from brains already on disk.
// =============================================================================
// train.js records every generation's champion as it trains. Brains trained
// before that existed survive only as improvements in champions/archive and as
// the current champion files; this collects them, keyed by the accumulated
// generation each one was saved at. Safe to re-run: entries merge by generation.
//
//   node tools/backfill-fish-history.js
// =============================================================================
const fs = require('fs');
const path = require('path');
const { TrainingStore } = require('../training-store');

const OUT = path.join(__dirname, '..', 'champions');
const store = new TrainingStore(OUT);
const files = [];
for (const name of fs.readdirSync(OUT)) if (/^(best-.*|display-best)\.json$/.test(name)) files.push(path.join(OUT, name));
const archive = path.join(OUT, 'archive');
if (fs.existsSync(archive)) for (const name of fs.readdirSync(archive)) files.push(path.join(archive, name));

const entries = [];
for (const file of files) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { continue; }
  if (!data || data.kind !== 'genome' || !data.meta) continue;
  const generation = data.meta.totalGenerations;
  if (!Number.isFinite(generation)) continue;
  entries.push({
    generation,
    score: Number.isFinite(data.meta.benchmark) ? +data.meta.benchmark.toFixed(3) : null,
    page: Number.isFinite(data.meta.displayBenchmark) ? +data.meta.displayBenchmark.toFixed(3) : null,
    regime: data.meta.regime || (data.meta.senseLayout === 'v3' ? 'v3' : 'v2 (migrated on load)'),
    saved: true,
    brain: data,
  });
}
entries.sort((a, b) => a.generation - b.generation);
const n = store.fishHistory(entries);
console.log('  fish history: ' + entries.length + ' brains found, ' + n + ' generations listed');
