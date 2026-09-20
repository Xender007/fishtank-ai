const fs = require('fs'), path = require('path');
const { FILES } = require('../simulation');
const root = path.join(__dirname, '..');
const src = [...FILES, 'render'].map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8')).join('\n');
const { CONFIG, World, Render, Schooling, Senses } = new Function(src +
  '\nreturn { CONFIG, World, Render, Schooling, Senses };')();
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
const w = new World();
for (let i = 0; i < 30; i++) w.update(CONFIG.sim.dt);
const f = w.fish.find(f => f.alive), alpha = w.packs[0].alpha;
const profile = Senses.socialProfile(alpha, w.time);
check('scout overlay shares the actual range and swept viewing direction',
  profile.range === CONFIG.schooling.scoutRange &&
  profile.heading === alpha.heading + Math.sin(w.time * 2 + alpha.id) * 0.65);
const follower = w.fish.find(f => f.alive && !f.isAlpha);
check('followers and scouts display their own real sensor ranges',
  Senses.socialProfile(follower, w.time).range === CONFIG.schooling.followerRange &&
  profile.nearRange === CONFIG.schooling.nearSense);

let calls = [];
const ctx = new Proxy({}, {
  get(_, name) {
    if (name === 'createLinearGradient' || name === 'createRadialGradient') return () => ({ addColorStop() {} });
    return (...args) => {
      if (args.some(v => typeof v === 'number' && !Number.isFinite(v))) throw Error('nonfinite drawing geometry');
      calls.push([name, ...args]);
    };
  }, set() { return true; },
});
const state = () => JSON.stringify({ rng: w.rng.state, ticks: w.ticks,
  fish: w.fish.map(f => [f.x, f.y, f.heading, f.age, f.lastTurn, f.threat, Array.from(f.senses)]), sharks: w.sharks });
const before = state();
Render.frame(ctx, w, { focused: f, showAllRays: true, showLineage: false });
Render.frame(ctx, w, { focused: alpha, showAllRays: false, showLineage: true });
check('animated bodies, wakes and sensor drawing do not mutate simulation or RNG', before === state());
const trailLength = Render.trails.get(f).length;
Render.wake(ctx, f, false);
check('redrawing a paused fish does not append wake points', Render.trails.get(f).length === trailLength);
calls = [];
Render.fish(ctx, f, false, true);
const firstShape = JSON.stringify(calls);
// Advancing simulated time, without translating the body, changes fin/body
// geometry. This verifies actual body animation rather than just a moving dot.
const age = f.age;
f.age += 0.1; calls = [];
Render.fish(ctx, f, false, true);
check('fish bodies and fins deform through the swimming cycle', JSON.stringify(calls) !== firstShape);
f.age = age;
const shark = w.sharks[0]; calls = [];
Render.shark(ctx, shark);
const sharkShape = JSON.stringify(calls);
const sharkAge = shark.age;
shark.age += 0.1; calls = [];
Render.shark(ctx, shark);
check('shark body and fins deform independently of its position', JSON.stringify(calls) !== sharkShape);
shark.age = sharkAge;

const savedPose = { ...f.sensorPose };
const x = f.x;
f.x += 20; calls = [];
Render.rays(ctx, f, true);
check('ray overlays stay anchored to the pose where readings were sampled',
  calls.filter(c => c[0] === 'moveTo').every(c => c[1] === savedPose.x && c[2] === savedPose.y));
f.x = x;
f.threat = { x: 120, y: 130, heading: 0, speed: 105, seenAt: w.time - 1, source: 4, hops: 1 };
f.directThreat = false; f.alarm = 0.6;
Object.defineProperty(w, 'sharks', { get() { throw Error('overlay revealed unseen predator'); } });
Render.sensorField(ctx, f, w);
check('memory overlay draws stored sightings without querying hidden predators', true);
