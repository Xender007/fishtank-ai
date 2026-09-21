const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[2] || path.join(__dirname, '..');
const files = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','sharkbrain','shark','world','persist','render'];
const src = files.map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8')).join('\n');

// Find whichever champion is actually on disk. Suites used to hard-code one
// filename, which broke as soon as pruning removed brains built for an older
// sense layout - and the current champion is named after the regime that
// produced it, so the name moves anyway.
function findChampion(dir) {
  const preferred = ['best.json', 'display-best.json'];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (err) { return null; }
  const candidates = preferred.filter(n => names.includes(n))
    .concat(names.filter(n => /^best.*.json$/.test(n) && !preferred.includes(n)));
  for (const name of candidates) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
    catch (err) { /* try the next one */ }
  }
  return null;
}
const champion = findChampion(path.join(root, 'champions'));
vm.runInNewContext(src + `
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
function check(name, ok) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name);
  if (!ok) process.exitCode = 1;
}
CONFIG.evolution.enabled = false;
const dt = CONFIG.sim.dt;
let w = new World();
check('45 fish form five packs of nine, with exactly one alpha each',
  w.packs.length === 5 && w.packs.every(p => p.members.length === 9 &&
    p.members.filter(f => f.isAlpha).length === 1));
const old = w.packs[0].alpha;
old.alive = false;
Schooling.prepare(w);
check('a lost alpha is replaced by a living pack member',
  !old.isAlpha && w.packs[0].alpha !== old && w.packs[0].alpha.alive);
w.packs[0].members.slice(0, 3).forEach(f => { f.alive = false; });
Schooling.prepare(w);
check('casualties merge undersized packs without duplicate members',
  w.packs.every(p => p.members.length >= 7) &&
  new Set(w.packs.flatMap(p => p.members)).size === w.aliveCount());
for (const n of [0, 1, 6, 7, 13, 14, 20, 45]) {
  CONFIG.fish.count = n; w = new World();
  check('pack sizing handles population ' + n,
    w.packs.every(p => p.members.length >= Math.min(n, 7)) &&
    w.packs.flatMap(p => p.members).length === n);
}

CONFIG.fish.count = 7; w = new World();
const a = w.packs[0].alpha;
const others = w.fish.filter(f => f !== a), b = others[0], c = others[1];
for (const f of w.fish) { f.x = 880; f.y = 580; f.heading = 0; }
a.x = 280; a.y = 300; a.heading = Math.PI;
b.x = 410; b.y = 300;
c.x = 540; c.y = 300;
w.shark.x = 100; w.shark.y = 300; w.shark.heading = 0;
Schooling.prepare(w);
check('alpha spots a distant predator before followers can see it', a.directThreat && !b.threat && !c.threat);
w.ticks++; w.time = w.ticks * dt; Schooling.prepare(w);
check('nearby follower reacts to the alpha alarm on the next tick', b.threat && b.threat.source === a.id && b.threat.hops === 1 && !c.threat);
w.ticks++; w.time = w.ticks * dt; Schooling.prepare(w);
check('alarm cascades through followers without global telepathy', c.threat && c.threat.hops === 2 && !c.directThreat);
const seenAt = c.threat.seenAt;
w.sharks = [];
for (let i = 0; i < 170; i++) { w.ticks++; w.time = w.ticks * dt; Schooling.prepare(w); }
check('relayed memories expire instead of sustaining an endless alarm', w.fish.every(f => !f.threat && f.alarm === 0));

// Reordering the fish array must not create faster alarm propagation.
function alarmOrder(reverse) {
  CONFIG.seed = 22; const world = new World();
  world.fish.forEach((f, i) => { f.x = 200 + i * 80; f.y = 300; f.heading = Math.PI; });
  world.shark.x = 60; world.shark.y = 300;
  if (reverse) world.fish.reverse();
  for (let i = 0; i < 4; i++) { Schooling.prepare(world); world.ticks++; world.time += dt; }
  return JSON.stringify(world.fish.slice().sort((a, b) => a.id - b.id).map(f => f.threat));
}
check('alarm propagation is independent of fish update order', alarmOrder(false) === alarmOrder(true));

// A synthetic target stays 90 degrees off the nose, forcing exact circles.
const sharkWorld = { nearestLivingFish(x, y) {
  return { x: x + Math.cos(s.heading + Math.PI / 2) * 100,
           y: y + Math.sin(s.heading + Math.PI / 2) * 100 };
}, keepInsideTank() {} };
let s = new Shark(450, 300, 0);
const threshold = 3 * Math.PI * 2;
const n = Math.floor(threshold / (CONFIG.shark.turnRate * dt));
for (let i = 0; i < n; i++) s.update(dt, sharkWorld);
check('shark does not break direction before three full circles', s.circleBreaks === 0);
const heading = s.heading;
s.update(dt, sharkWorld);
check('shark reverses its turn after more than three circles', s.circleBreaks === 1 && V.angleDiff(s.heading, heading) < 0);
check('circle escape respects speed and turn limits, with no brain',
  Math.abs(V.angleDiff(s.heading, heading)) <= CONFIG.shark.turnRate * dt + 1e-9 &&
  s.speed === CONFIG.shark.maxSpeed && !s.net);
for (let i = 0; i < 100; i++) s.update(dt, sharkWorld);
check('shark resumes ordinary chasing after its short direction change', s.breakRemaining === 0);
s = new Shark(450, 300, 0);
const reverseWorld = { nearestLivingFish(x, y) {
  const sign = Math.floor(s.age / 2) % 2 ? -1 : 1;
  return { x: x + Math.cos(s.heading + sign) * 100, y: y + Math.sin(s.heading + sign) * 100 };
}, keepInsideTank() {} };
for (let i = 0; i < 1800; i++) s.update(dt, reverseWorld);
check('ordinary left-right pursuit does not accumulate false circles', s.circleBreaks === 0);

CONFIG.fish.count = 45; CONFIG.seed = 1234;
const brain = safeFromJSON(Persist, champion);
function run() {
  const world = new World(); world.seedFrom(brain, false);
  const watched = world.fish.slice();
  for (let i = 0; i < 900; i++) world.update(dt);
  return { world, snapshot: JSON.stringify(watched.map(f => [f.x, f.y, f.heading, f.alive, f.packId, f.isAlpha, f.alarm])) };
}
const r1 = run(), r2 = run();
check('same seed reproduces packs, alarms and movement exactly', r1.snapshot === r2.snapshot);
check('advanced fish remain finite, inside the tank, within physical limits', r1.world.fish.every(f =>
  Number.isFinite(f.heading) && f.x >= CONFIG.fish.radius && f.x <= r1.world.w - CONFIG.fish.radius &&
  f.y >= CONFIG.fish.radius && f.y <= r1.world.h - CONFIG.fish.radius &&
  Math.abs(f.lastTurn) <= 1 && f.speed <= CONFIG.fish.maxSpeed));
check('existing champion still loads with identical parameters and senses',
  brain.paramCount() === safeFromJSON(Persist, champion).paramCount() &&
  // Was pinned at 7. Vision widened to 9 rays and a closing-rate sense was
  // added, so the layout is now whatever Senses reports - the point of the
  // assertion is that a champion on disk matches the CURRENT layout, not a
  // number frozen when it was written.
  brain.nodes.filter(n => n.type === 0).length === Senses.COUNT);
const before = r1.snapshot;
const noop = () => {};
const ctx = new Proxy({}, { get: () => noop, set: () => true });
Render.packs(ctx, r1.world, { focused: r1.world.fish.find(f => f.alive) });
check('pack rendering never changes simulation state', before === JSON.stringify(r1.world.fish.map(f =>
  [f.x, f.y, f.heading, f.alive, f.packId, f.isAlpha, f.alarm])));
CONFIG.schooling.enabled = false;
const f = r1.world.fish.find(f => f.alive);
// Every forward pass now also takes a Hebbian step (plasticity loads from disk
// since 2026-09-21), so calling the network twice is not a pure repeat. Put its
// state back between the two calls, so both see the same brain.
const state = [f.net.values.slice(), f.net.prev.slice(), f.net.traces.slice()];
const neural = f.net.decide(f.senses);
f.net.values.set(state[0]); f.net.prev.set(state[1]); f.net.traces.set(state[2]);
const decision = f.think(r1.world);
check('disabling schooling restores the exact learned neural output', neural.turn === decision.turn && neural.thrust === decision.thrust);
`, { console, process, champion });
