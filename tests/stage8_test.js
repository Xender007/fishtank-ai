const fs = require('fs'), vm = require('vm');
const root = process.argv[2];
const src = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','sharkbrain','shark','world','persist','brainview']
  .map(n => fs.readFileSync(root + '/js/' + n + '.js', 'utf8')).join('\n');

const test = `
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}
function near(a, b, t) { return Math.abs(a - b) <= (t || 1e-9); }

// The kin senses ship OFF by default (measured to cost fitness), so this suite
// switches them on explicitly - it is testing the feature, not the default.
CONFIG.senses.neighbours = true;
// rays + wall + speed + closing + three kin senses.
Senses.COUNT = CONFIG.senses.rayCount + 6;
console.log('');

// --- 1. the sense layout grew by exactly three ------------------------------
check('the kin senses add exactly three slots', Senses.COUNT === CONFIG.senses.rayCount + 6,
      Senses.COUNT + ' senses: ' + Senses.labels().join(', '));
check('labels and slots stay in step', Senses.labels().length === Senses.COUNT);

// --- 2. neighbour sectors point the right way -------------------------------
const mk = (x, y) => ({ x, y, alive: true });
const at = (dx, dy) => {
  const f = new Fish(400, 300, 0);            // facing +x
  const world = { w: CONFIG.tank.w, h: CONFIG.tank.h, shark: { x: 9999, y: 9999 }, sharks: [{ x: 9999, y: 9999 }],
                  fish: [f, mk(400 + dx, 300 + dy)] };
  Senses.read(f, world);
  return [f.senses[Senses.KIN], f.senses[Senses.KIN + 1], f.senses[Senses.KIN + 2]];
};
const ahead = at(60, 0), plus = at(0, 60), minus = at(0, -60), behind = at(-60, 0);
check('a neighbour dead ahead registers as ahead',
      ahead[1] > 0 && ahead[0] === 0 && ahead[2] === 0, JSON.stringify(ahead.map(v => +v.toFixed(2))));
check('a neighbour on the positive side registers there',
      plus[2] > 0 && plus[0] === 0, JSON.stringify(plus.map(v => +v.toFixed(2))));
check('a neighbour on the negative side registers there',
      minus[0] > 0 && minus[2] === 0, JSON.stringify(minus.map(v => +v.toFixed(2))));
check('a neighbour directly behind is not "ahead"', behind[1] === 0);
const lonely = (() => {
  const f = new Fish(400, 300, 0);
  Senses.read(f, { w: 900, h: 600, shark: { x: 9999, y: 9999 }, sharks: [{ x: 9999, y: 9999 }], fish: [f] });
  return f.senses[Senses.KIN] + f.senses[Senses.KIN+1] + f.senses[Senses.KIN+2];
})();
check('a fish entirely alone senses no company', lonely === 0);

// --- 3. closer neighbours read stronger -------------------------------------
check('closeness, not just presence', at(20, 0)[1] > at(140, 0)[1],
      at(20,0)[1].toFixed(2) + ' close vs ' + at(140,0)[1].toFixed(2) + ' far');

// --- 4. save and load round-trip --------------------------------------------
CONFIG.genome.kind = 'genome';
Evolution.threshold = null;
const w = new World();
for (let i = 0; i < 900; i++) w.update(CONFIG.sim.dt);
const brain = w.fish[0].net;
for (let i = 0; i < 30; i++) { brain.mutateAddNode(w.rng); brain.mutateAddConnection(w.rng); }

const json = JSON.parse(JSON.stringify(Persist.toJSON(brain, { generation: 3 })));
const back = Persist.fromJSON(json);

const probe = Array.from({length: Senses.COUNT}, (_, i) => Math.sin(i * 1.7));
const a = brain.decide(probe.slice()), b = back.decide(probe.slice());
check('a saved brain behaves identically when loaded',
      near(a.turn, b.turn) && near(a.thrust, b.thrust),
      'turn ' + a.turn.toFixed(6) + ' vs ' + b.turn.toFixed(6));
check('structure survives the round trip',
      back.paramCount() === brain.paramCount() && back.hiddenCount() === brain.hiddenCount(),
      back.paramCount() + ' params, ' + back.hiddenCount() + ' hidden');

// --- 5. bad files are rejected where the cause is obvious -------------------
let rejected = 0;
for (const bad of [null, {}, { kind: 'genome' }, { kind: 'nonsense' }]) {
  try { Persist.fromJSON(bad); } catch (e) { rejected++; }
}
check('malformed files are rejected, not half-loaded', rejected === 4);
const wrongSenses = JSON.parse(JSON.stringify(json));
wrongSenses.nodes = wrongSenses.nodes.filter(n => !(n.type === NODE_INPUT && n.id === 0));
let msg = '';
try { Persist.fromJSON(wrongSenses); } catch (e) { msg = e.message; }
check('a brain built for a different sense layout is refused clearly',
      msg.indexOf('sense') >= 0, msg);

// --- 6. reseeding a population from one brain -------------------------------
w.seedFrom(back);
check('seedFrom repopulates the tank', w.fish.length === CONFIG.fish.count);
check('one child is an exact copy, the rest are mutated',
      w.fish[0].net.paramCount() === back.paramCount() &&
      new Set(w.fish.map(f => f.net.conns.map(c => c.w.toFixed(6)).join(','))).size > 1);
check('the reseeded world still runs', (() => {
  for (let i = 0; i < 300; i++) w.update(CONFIG.sim.dt);
  return w.fish.some(f => f.alive && Number.isFinite(f.x));
})());
console.log('');
`;
vm.runInNewContext(src + test, { console, process });
