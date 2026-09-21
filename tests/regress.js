const fs = require('fs'), vm = require('vm');
const root = process.argv[2];
const src = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','sharkbrain','shark','world','brainview']
  .map(n => fs.readFileSync(root + '/js/' + n + '.js', 'utf8')).join('\n');

const test = `
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}
console.log('');

// Everything the browser calls per frame must work for BOTH brain kinds.
for (const kind of ['genome', 'layered']) {
  CONFIG.genome.kind = kind;
  Evolution.threshold = null;
  const w = new World();
  for (let i = 0; i < 300; i++) w.update(CONFIG.sim.dt);

  let err = null;
  try {
    Evolution.geneticSpread(w.fish);
    Evolution.diversity(w.fish);
    w.fish[0].net.graph();
    w.fish[0].net.paramCount();
    w.fish[0].net.hiddenCount();
    BrainView.terms(w.fish[0].net, kind === 'genome' ? Senses.COUNT : 200);
  } catch (e) { err = e.message; }
  check(kind + ': every per-frame call works', err === null, err || 'no exceptions');

  const spread = Evolution.geneticSpread(w.fish);
  check(kind + ': gene spread is a sensible positive number',
        Number.isFinite(spread) && spread > 0, 'spread = ' + spread.toFixed(4));
}

// And the fish must actually be swimming.
CONFIG.genome.kind = 'genome';
Evolution.threshold = null;
const w2 = new World();
const startX = w2.fish.map(f => f.x);
for (let i = 0; i < 600; i++) w2.update(CONFIG.sim.dt);
let moved = 0, totalThrust = 0, n = 0;
for (let i = 0; i < w2.fish.length; i++) {
  const f = w2.fish[i];
  if (!f.alive) continue;
  n++;
  totalThrust += f.lastThrust;
  if (V.dist(f.x, f.y, startX[i], 0) > 0) moved++;
}
check('fish are actually moving', w2.fish.filter(f => f.alive && f.speed > 1).length > 0,
      w2.fish.filter(f => f.alive && f.speed > 1).length + ' of ' + n + ' living fish have speed > 1');
check('mean thrust is not pinned at zero', totalThrust / n > 0.05,
      'mean thrust = ' + (totalThrust / n).toFixed(3));
console.log('');
`;
vm.runInNewContext(src + test, { console, process });
