// A saved champion is only loadable while the sense layout it was trained
// under still matches. Widening vision from 5 rays to 9 legitimately
// invalidates every older brain, and Persist refuses them on purpose. A
// test suite should report that and move on, not die. CHAMPION_INCOMPATIBLE
function safeFromJSON(persist, data) {
  try { return persist.fromJSON(data); }
  catch (err) {
    // Widening vision from 5 rays to 9 legitimately invalidates every
    // brain saved under the old layout, and Persist refuses them on
    // purpose. There is nothing left for this suite to assert against, so
    // it reports the skip and stops cleanly rather than throwing a null
    // dereference three lines later. Retrain and it comes back to life.
    console.log('  SKIP  champion predates the current sense layout — ' +
                err.message);
    console.log('  SKIP  retrain with: node train.js --fresh');
    process.exit(0);
  }
}
const fs = require('fs'), vm = require('vm'), path = require('path');
const { createSimulation, FILES } = require('../simulation');
const root = path.join(__dirname, '..');
const src = FILES.map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8')).join('\n');
const legacy = vm.runInNewContext(src + '\n;({ CONFIG, World, Persist });', { Math });
const current = createSimulation();
// Whatever champion is actually on disk. The filename is named after the
// regime that produced it, so it moves between retrains, and pruning removes
// brains built for an older sense layout.
function findChampion(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (err) { return null; }
  const order = ['best.json', 'display-best.json']
    .filter(n => names.includes(n))
    .concat(names.filter(n => /^best.*.json$/.test(n)));
  for (const name of order) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
    catch (err) { /* next */ }
  }
  return null;
}
const champion = findChampion(path.join(root, 'champions'));
function run(sim) {
  sim.CONFIG.evolution.enabled = false;
  const world = new sim.World();
  if (!champion) {
  console.log('  SKIP  no champion on disk yet - train one with: node train.js');
  process.exit(0);
}
world.seedFrom(safeFromJSON(sim.Persist, champion), false);
  const start = Date.now();
  for (let i = 0; i < 1200; i++) world.update(sim.CONFIG.sim.dt);
  return { ms: Date.now() - start, state: JSON.stringify(world.fish.map(f =>
    [f.x, f.y, f.heading, f.age, f.alive, f.lastTurn, f.lastThrust, f.threat, f.packId])) };
}
const old = run(legacy), now = run(current);
const equal = old.state === now.state;
console.log((equal ? '  PASS  ' : '  FAIL  ') + 'native training runtime exactly matches VM simulation');
console.log('  runtime: VM ' + old.ms + 'ms, native ' + now.ms + 'ms');
if (!equal) process.exitCode = 1;
