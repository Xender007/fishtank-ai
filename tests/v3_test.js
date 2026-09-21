// =============================================================================
// tests/v3_test.js - layout v3: social senses, learned teamwork, the planner
// critic, fish hunger, legacy migration, and co-evolution's shark handling.
// =============================================================================
const { createSimulation } = require('../simulation');

function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}
const fresh = () => {
  const S = createSimulation();
  S.CONFIG.evolution.enabled = false;
  return S;
};
console.log('');

// --- 1. the layout ------------------------------------------------------------
{
  const { Senses, CONFIG } = fresh();
  const R = CONFIG.senses.rayCount;
  check('layout v3 appends eleven senses after the v2 twelve',
    Senses.COUNT === R + 14 && Senses.LEGACY_V2_COUNT === R + 3 && Senses.PACK_PULL === R + 3 && Senses.FOOD_NEAR === R + 13,
    Senses.COUNT + ' inputs');
  check('every input has a label', Senses.labels().length === Senses.COUNT);
}

// --- 2. social senses point the right way ------------------------------------
{
  const { CONFIG, World, Schooling, Senses } = fresh();
  CONFIG.fish.count = 9;
  const w = new World();
  const [f, ...rest] = w.fish;
  // One pack, everyone else 120px to f's +y side (f faces +x, so +y is the
  // positive-angle side), all heading +y, nearest one 20px ahead of f.
  f.x = 300; f.y = 300; f.heading = 0;
  rest.forEach((o, i) => { o.x = 280 + i * 8; o.y = 420; o.heading = Math.PI / 2; });
  rest[0].x = 320; rest[0].y = 300;
  Schooling.prepare(w);
  Senses.read(f, w);
  const s = f.senses;
  check('pack pull points toward the pack, on the positive side', s[Senses.PACK_PULL] > 0.2, s[Senses.PACK_PULL].toFixed(3));
  check('alignment reports the packmates turning positive', s[Senses.ALIGN] > 0.2, s[Senses.ALIGN].toFixed(3));
  check('the nearest neighbour dead ahead reads as close and centred',
    s[Senses.CROWDED] > 0.5 && Math.abs(s[Senses.NEIGHBOUR]) < 0.05,
    'crowded ' + s[Senses.CROWDED].toFixed(2) + ', bearing ' + s[Senses.NEIGHBOUR].toFixed(3));
  check('all social senses stay within -1..1', Array.from(s).every(v => v >= -1 && v <= 1));
  CONFIG.schooling.enabled = false;
  Senses.read(f, w);
  check('with the social layer off a fish senses no team at all',
    [Senses.PACK_PULL, Senses.ALIGN, Senses.NEIGHBOUR, Senses.CROWDED, Senses.ALARM].every(i => f.senses[i] === 0));
}

// --- 3. hunger ------------------------------------------------------------------
{
  const A = fresh(), B = fresh();
  B.CONFIG.hunger.enabled = true;
  const wa = new A.World(), wb = new B.World();
  check('switching hunger on moves no fish (food has its own random stream)',
    JSON.stringify(wa.fish.map(f => [f.x, f.y, f.heading])) === JSON.stringify(wb.fish.map(f => [f.x, f.y, f.heading])));
  check('with hunger off there is no food and energy reads a constant 1',
    wa.food.length === 0 && (A.Senses.read(wa.fish[0], wa), wa.fish[0].senses[A.Senses.ENERGY] === 1));
  check('with hunger on the tank holds the configured food', wb.food.length === B.CONFIG.hunger.pellets);

  // A fish alone with no food starves at exactly its clock.
  const { CONFIG, World } = B;
  CONFIG.fish.count = 1;
  CONFIG.shark.count = 1;
  const w = new World();
  w.evaluationOnly = true;
  w.sharks[0].x = 9999; w.sharks[0].y = 9999;   // pinned far away, never catches
  w.sharks[0].update = () => {};
  w.food = [];
  const fish = w.fish[0];
  fish.energy = 1;
  let ticks = 0;
  while (fish.alive && ticks < 10000) { w.update(CONFIG.sim.dt); ticks++; }
  const expected = Math.round(CONFIG.hunger.starveSeconds / CONFIG.sim.dt);
  check('a fish that never eats starves when its energy runs out',
    !fish.alive && fish.starved && Math.abs(ticks - expected) <= 1 && w.fishStarved === 1,
    ticks + ' ticks, expected ' + expected);

  const w2 = new World();
  w2.sharks[0].update = () => {};
  const f2 = w2.fish[0];
  f2.energy = 0.3;
  w2.food[0] = { x: f2.x, y: f2.y };
  const pellets = w2.food.length;
  w2.resolveFeeding();
  check('eating a pellet refills energy, and the pellet regrows elsewhere',
    Math.abs(f2.energy - (0.3 + CONFIG.hunger.pelletEnergy)) < 1e-12 && w2.food.length === pellets &&
    (w2.food[0].x !== f2.x || w2.food[0].y !== f2.y) && w2.pelletsEaten === 1);
}

// --- 4. learned teamwork ---------------------------------------------------------
{
  const { CONFIG, World, Profiles } = fresh();
  Profiles.v3();
  CONFIG.fish.count = 18;
  const w = new World();
  for (let i = 0; i < 30; i++) w.update(CONFIG.sim.dt);
  const calm = w.fish.find(f => f.alive && !f.threat);
  const state = [calm.net.values.slice(), calm.net.prev.slice(), calm.net.traces.slice()];
  const neural = calm.net.decide(calm.senses);
  calm.net.values.set(state[0]); calm.net.prev.set(state[1]); calm.net.traces.set(state[2]);
  const decision = calm.think(w);
  check('with learned teamwork, a calm fish is steered by its own network',
    calm.socialDecision === null && decision.turn === neural.turn && decision.thrust === neural.thrust);
  CONFIG.learned.teamwork = false;
  w.update(CONFIG.sim.dt);
  check('with the rules back on, the written pack steering returns',
    w.fish.filter(f => f.alive).every(f => f.socialDecision && Number.isFinite(f.socialDecision.turn)));
}

// --- 5. the critic -----------------------------------------------------------------
function trajectory(planner) {
  const { CONFIG, World, Persist } = fresh();
  CONFIG.learned.planner = planner;
  CONFIG.shark.count = 2;
  const w = new World();
  for (let i = 0; i < 1200; i++) w.update(CONFIG.sim.dt);
  return { state: JSON.stringify(w.fish.map(f => [f.x, f.y, f.heading, f.alive])),
           planned: w.fish.filter(f => f.escapePlan).length, w, Persist };
}
{
  const hand = trajectory(false), critic = trajectory(true);
  check('a hand-initialised critic reproduces the written planner bit for bit (20s, 45 fish)',
    hand.state === critic.state, critic.planned + ' fish holding a plan at the end');

  const { Critic, Genome, Rng, CONFIG, Persist } = fresh();
  const g = Genome.minimal(new Rng(5));
  const before = JSON.stringify(g.critic.toJSON());
  g.mutate(new Rng(6), 1, 0.35);
  check('the critic does not evolve while the planner is hand-written', JSON.stringify(g.critic.toJSON()) === before);
  CONFIG.learned.planner = true;
  g.mutate(new Rng(7), 1, 0.35);
  check('...and does evolve once the planner is learned', JSON.stringify(g.critic.toJSON()) !== before);
  g.critic.v[0] = 0.8;
  const f = new Float64Array(Critic.FEATURES.length).map((_, i) => i * 3.7 - 5);
  const back = Persist.fromJSON(JSON.parse(JSON.stringify(Persist.toJSON(g))));
  check('an evolved critic survives a save and reload exactly', back.critic.score(f) === g.critic.score(f));
}

// --- 6. persistence and migration ----------------------------------------------------
{
  const { Persist, Genome, Rng, Senses, CONFIG, Innovation } = fresh();
  Innovation.reset();
  const g = Genome.minimal(new Rng(11));
  g.conns[0].plasticity = 0.3; g.conns[3].plasticity = -0.2;
  const back = Persist.fromJSON(JSON.parse(JSON.stringify(Persist.toJSON(g))));
  check('evolved plasticity survives a save and reload (it was silently dropped before)',
    back.plasticCount() === 2 && back.conns[0].plasticity === 0.3);
  const probe = Float64Array.from({ length: Senses.COUNT }, (_, i) => Math.sin(i));
  let same = true;
  for (let t = 0; t < 50; t++) {
    const a = g.decide(probe), b = back.decide(probe);
    same = same && a.turn === b.turn && a.thrust === b.thrust;
  }
  check('...so a reloaded plastic brain behaves identically over 50 ticks of learning', same);

  // A hand-built layout-v2 brain: 12 inputs, turn 12, thrust 13, hidden 14.
  const L = Senses.LEGACY_V2_COUNT;
  const legacy = { kind: 'genome', hue: 10, nodes: [], conns: [] };
  for (let i = 0; i < L; i++) legacy.nodes.push({ id: i, type: 0, bias: 0 });
  legacy.nodes.push({ id: L, type: 1, bias: 0.1 }, { id: L + 1, type: 1, bias: -0.2 }, { id: L + 2, type: 2, bias: 0.05 });
  legacy.conns.push({ inn: 0, from: 0, to: L + 2, w: 0.5, enabled: true },
                    { inn: 1, from: L + 2, to: L, w: 1.2, enabled: true },
                    { inn: 2, from: 5, to: L + 1, w: -0.7, enabled: true },
                    { inn: 3, from: L + 2, to: L + 2, w: 0.3, enabled: true, recurrent: true, plasticity: 0.1 });
  Innovation.reset();
  const m = Persist.fromJSON(legacy);
  const inputs = new Float64Array(Senses.COUNT);
  inputs[0] = 0.8; inputs[5] = 0.4;
  const h = Math.tanh(0.05 + 0.8 * 0.5);
  const turn = Math.tanh(0.1 + 1.2 * h), thrust = (Math.tanh(-0.2 - 0.7 * 0.4) + 1) / 2;
  const d = m.decide(inputs);
  check('a layout-v2 brain is migrated, not refused', m.migratedFrom === 'v2' &&
    m.nodes.filter(n => n.type === 0).length === Senses.COUNT);
  check('...and computes exactly what it did before when the new senses are quiet',
    Math.abs(d.turn - turn) < 1e-15 && Math.abs(d.thrust - thrust) < 1e-15, d.turn.toFixed(6) + ' vs ' + turn.toFixed(6));
  const inns = m.conns.map(c => c.inn);
  check('...with no innovation number used twice', new Set(inns).size === inns.length);
  const w = m.conns.find(c => c.from === Senses.PACK_PULL && c.to === Senses.COUNT).w;
  check('...and the teamwork prior wired in (steer toward the pack)', w === Genome.TEAM_PRIOR.turn.PACK_PULL);
  const zero = Genome.migrateLegacy(legacy, { prior: false });
  check('the zero-prior control wires every new sense at zero',
    zero.conns.filter(c => c.from >= L && c.from < Senses.COUNT).every(c => c.w === 0));
}

// --- 7. a starved shark in a fish-training tank is replaced ----------------------------
{
  const { CONFIG, World, SharkBrain, Rng } = fresh();
  CONFIG.fish.count = 3;
  const w = new World();
  w.evaluationOnly = true;
  w.respawnStarvedSharks = true;
  const brain = SharkBrain.random(new Rng(3));
  brain.b2[1] = -50; brain.b2[0] = 50;     // circles slowly, catches nothing
  w.setSharkBrain(brain);
  w.fish.forEach(f => { f.x = 20; f.y = 20; f.update = () => {}; });
  w.sharks[0].x = 800; w.sharks[0].y = 500;
  let starvedAt = -1, back = false;
  for (let i = 0; i < Math.round(13 / CONFIG.sim.dt); i++) {
    w.update(CONFIG.sim.dt);
    if (starvedAt < 0 && w.starvations > 0) starvedAt = w.time;
    if (starvedAt >= 0 && w.sharks.length === 1) back = true;
  }
  check('in a fish-training tank a starved shark is replaced, as on the page',
    starvedAt > 9.9 && starvedAt < 10.1 && back, 'starved at ' + starvedAt.toFixed(2) + 's');
}
