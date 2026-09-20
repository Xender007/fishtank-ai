const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[2] || path.join(__dirname, '..');
const FILES = ['config','rng','vec','senses','brain','genome','evolution','schooling',
               'fish','shark','world','persist'];
const src = FILES.map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8'))
  .join(String.fromCharCode(10));
const ctx = { console, Math, JSON, Number, Array, Object, Map, Set, Float64Array, Int32Array, Date, process };
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext('var X = { CONFIG, World, Genome, Innovation, Rng, Senses, Persist, NODE_HIDDEN };', ctx);
const { CONFIG, Genome, Innovation, Rng, Senses, Persist } = ctx.X;

function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}

Innovation.reset();
const rng = new Rng(21);
console.log('');

// --- 1. a feed-forward brain is memoryless by definition --------------------
const flat = Genome.minimal(rng);
const input = Array.from({ length: Senses.COUNT }, (_, i) => (i % 2) * 0.5);
const a1 = flat.forward(input.slice())[flat.outTurn];
const a2 = flat.forward(input.slice())[flat.outTurn];
check('without memory, the same input always gives the same output',
      a1 === a2, a1.toFixed(6) + ' twice');

// --- 2. a self-loop makes the output evolve under a CONSTANT input ----------
// This is the whole point. Nothing about the input changes; the network's own
// state does.
const mem = Genome.minimal(rng);
const hiddenId = Innovation.forSplit(mem.conns[0].inn);
mem.mutateAddNode(rng);
const loopTarget = mem.nodes.find(n => n.type === 2);
check('a hidden neuron exists to attach memory to', !!loopTarget);

// Give the neuron something to integrate. Which connection add-node happened
// to split decides what feeds this neuron, and if that input sits at zero the
// loop has nothing to remember - a memory of nothing stays nothing. A bias
// makes the test depend on the mechanism rather than on the dice.
loopTarget.bias = 0.4;

mem.conns.push({
  inn: Innovation.forConnection(loopTarget.id, loopTarget.id),
  from: loopTarget.id, to: loopTarget.id,
  w: 0.9, enabled: true, recurrent: true,
});
mem.rebuild();

// Watch the neuron carrying the loop, not an output that may not depend on it.
// (The first version of this test watched `turn` while add-node had spliced the
// new neuron into the `thrust` path, so the assertion failed on a network that
// was working perfectly.)
const hi = mem.index.get(loopTarget.id);
const trace = [];
const outs = [];
for (let t = 0; t < 8; t++) {
  const v = mem.forward(input.slice());
  trace.push(mem.values[hi]);
  outs.push(v[mem.outTurn] + v[mem.outThrust]);
}

check('WITH memory, a constant input produces a CHANGING internal state',
      Math.abs(trace[1] - trace[0]) > 1e-6,
      trace.slice(0, 4).map(v => v.toFixed(4)).join(' -> '));
check('that state reaches the outputs',
      Math.abs(outs[1] - outs[0]) > 1e-9,
      'outputs moved by ' + Math.abs(outs[3] - outs[0]).toFixed(6));
check('the state settles rather than exploding',
      Math.abs(trace[7] - trace[6]) < Math.abs(trace[1] - trace[0]) &&
      trace.every(v => Number.isFinite(v) && Math.abs(v) <= 1),
      'settles at ' + trace[7].toFixed(6));
// --- 3. the graph stays sortable despite containing a loop ------------------
check('a recurrent edge imposes no depth ordering',
      mem.order.length > 0 && mem.depth.every(d => d >= 0 && Number.isFinite(d)),
      'maxDepth ' + mem.maxDepth);
check('memoryCount sees the loop', mem.memoryCount() === 1);

// --- 4. survives clone, crossover and a JSON round trip ---------------------
check('clone keeps the memory edge', mem.clone().memoryCount() === 1);
const kid = mem.crossover(mem.clone(), rng);
check('crossover keeps the memory edge', kid.memoryCount() === 1);
const back = Persist.fromJSON(JSON.parse(JSON.stringify(Persist.toJSON(mem, {}))));
check('a saved memory edge survives JSON', back.memoryCount() === 1);
// Both from a CLEAN state, for the same number of ticks.
//
// This is the property that makes a recurrent network different in kind: its
// output is a function of its history, not just its input. Comparing two
// instances is only meaningful if they have lived the same life. rebuild()
// reallocates the value arrays, which is how you reset that history.
mem.rebuild();
back.rebuild();
const r1 = [], r2 = [];
for (let t = 0; t < 5; t++) r1.push(mem.forward(input.slice())[mem.outThrust]);
for (let t = 0; t < 5; t++) r2.push(back.forward(input.slice())[back.outThrust]);
check('a reloaded brain replays the same trajectory',
      r1.every((v, i) => Math.abs(v - r2[i]) < 1e-12),
      r1.map(v => v.toFixed(4)).join(' -> '));
// --- 5. heavy random mutation stays finite and terminates -------------------
CONFIG.genome.recurrentRate = 0.5;
const stress = Genome.minimal(rng);
for (let i = 0; i < 400; i++) {
  if (rng.next() < 0.3) stress.mutateAddNode(rng); else stress.mutateAddConnection(rng);
}
let finite = true;
for (let t = 0; t < 200; t++) {
  const out = stress.forward(input.slice());
  if (!Number.isFinite(out[stress.outTurn]) || !Number.isFinite(out[stress.outThrust])) finite = false;
}
check('400 mutations with memory: 200 ticks stay finite and bounded', finite,
      stress.paramCount() + ' params, ' + stress.memoryCount() + ' memory edges, ' +
      stress.hiddenCount() + ' hidden');
CONFIG.genome.recurrentRate = 0.35;
console.log('');
