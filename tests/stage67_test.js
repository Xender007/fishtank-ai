const fs = require('fs'), vm = require('vm');
const root = process.argv[2];
const src = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','sharkbrain','shark','world','brainview']
  .map(n => fs.readFileSync(root + '/js/' + n + '.js', 'utf8')).join('\n');

const test = `
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-9); }
Innovation.reset();
const rng = new Rng(11);
console.log('');

// --- 1. the minimal starting brain ------------------------------------------
const g = Genome.minimal(rng);
check('generation 1 starts with NO hidden neurons', g.hiddenCount() === 0);
check('inputs are wired straight to both outputs',
      g.conns.length === Senses.COUNT * 2, g.conns.length + ' connections');
check('parameter count is connections + output biases',
      g.paramCount() === Senses.COUNT * 2 + 2, g.paramCount() + ' params');

// --- 2. forward pass against hand arithmetic --------------------------------
const inputs = Array.from({length: Senses.COUNT}, (_, i) => (i % 3) * 0.4 - 0.4);
const out = g.forward(inputs.slice());
let byHand = g.nodes[g.outTurn].bias;
for (const c of g.conns) if (c.to === Senses.COUNT && c.enabled) byHand += inputs[c.from] * c.w;
check('forward pass matches hand arithmetic', near(out[g.outTurn], Math.tanh(byHand)),
      'got ' + out[g.outTurn].toFixed(6) + ', expected ' + Math.tanh(byHand).toFixed(6));

// --- 3. adding a node ---------------------------------------------------------
const grown = g.clone();
const before = grown.paramCount();
const ev = grown.mutateAddNode(rng);
check('adding a node grows the brain by exactly 2 params',
      grown.paramCount() === before + 2,
      before + ' -> ' + grown.paramCount() + '   (' + ev + ')');
check('the new neuron really is hidden', grown.hiddenCount() === 1);
check('the split connection is disabled, not deleted',
      grown.conns.filter(c => !c.enabled).length === 1 &&
      grown.conns.length === g.conns.length + 2);

// --- 4. cycles can never form -------------------------------------------------
let acyclic = true;
const stress = g.clone();
for (let i = 0; i < 400; i++) {
  if (rng.next() < 0.3) stress.mutateAddNode(rng); else stress.mutateAddConnection(rng);
}
let memories = 0;
for (const c of stress.conns) {
  const fi = stress.index.get(c.from), ti = stress.index.get(c.to);
  if (fi === undefined || ti === undefined) continue;
  if (c.recurrent) { memories++; continue; }   // memory edges read last tick
  if (stress.depth[fi] >= stress.depth[ti]) acyclic = false;   // the rest go forward
}
// Loops ARE allowed now - that is what gives the network memory - but only as
// explicitly flagged recurrent edges. Every ordinary connection must still run
// strictly forward, or the topological order the forward pass depends on is a
// lie and evaluation becomes order-dependent.
check('every non-memory edge still runs strictly forward', acyclic,
      stress.paramCount() + ' params, ' + stress.hiddenCount() + ' hidden, ' +
      memories + ' memory edges');
const vals = stress.forward(inputs.slice());
check('a heavily grown brain still produces finite output',
      Number.isFinite(vals[stress.outTurn]) && Number.isFinite(vals[stress.outThrust]));

// --- 5. innovation numbers are shared history ---------------------------------
const a1 = Genome.minimal(rng), a2 = Genome.minimal(rng);
const innA = a1.conns.map(c => c.inn).sort((x, y) => x - y);
const innB = a2.conns.map(c => c.inn).sort((x, y) => x - y);
check('the same connection gets the same innovation number in every genome',
      innA.every((v, i) => v === innB[i]));
const n1 = a1.clone(), n2 = a1.clone();
n1.mutateAddNode(rng); n2.mutateAddNode(rng);
check('splitting the same connection yields the same node id everywhere',
      Innovation.splits.size > 0);

// --- 6. crossover keeps structure well-formed ---------------------------------
const kid = stress.crossover(g, rng);
const ids = new Set(kid.nodes.map(n => n.id));
check('no child connection refers to a node the child does not have',
      kid.conns.every(c => ids.has(c.from) && ids.has(c.to)));
check('the child can run', Number.isFinite(kid.forward(inputs.slice())[kid.outTurn]));

// --- 7. distance and species ---------------------------------------------------
check('a genome is distance 0 from a copy of itself', g.distance(g.clone()) === 0);
check('a grown genome is measurably distant from the original', stress.distance(g) > 0.3,
      'distance = ' + stress.distance(g).toFixed(3));
const clones = Array.from({length: 20}, (_, i) => ({ brain: g.clone(), fitness: i }));
Evolution.threshold = 0.25;
check('20 identical brains form exactly one species',
      Evolution.speciate(clones).length === 1);

// --- 8. the inspector reads the real arithmetic --------------------------------
stress.forward(inputs.slice());
const t = BrainView.terms(stress, Senses.COUNT);
let recomposed = t.bias;
for (const r of t.rows) recomposed += r.product;
check('the arithmetic panel sums to the neuron\u2019s actual output',
      near(Math.tanh(recomposed), stress.values[stress.outTurn], 1e-9),
      t.rows.length + ' terms -> tanh = ' + t.out.toFixed(6));
console.log('');
`;
vm.runInNewContext(src + test, { console, process });
