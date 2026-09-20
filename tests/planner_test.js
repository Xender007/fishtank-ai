const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[2] || path.join(__dirname, '..');
const files = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','shark','world','render'];
const src = files.map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8')).join('\n');
vm.runInNewContext(src + `
function check(name, ok) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name);
  if (!ok) process.exitCode = 1;
}
CONFIG.fish.count = 1;
CONFIG.evolution.enabled = false;
const w = new World(), f = w.fish[0], cfg = CONFIG.schooling;
f.x = 450; f.y = 300; f.heading = 0;
f.socialDecision = { turn: 0, thrust: 1 };
const plans = [];
for (const dx of [-100, -70, -40, 40, 70, 100]) for (const dy of [-50, 0, 50]) {
  f.escapeDecision = null;
  f.threat = { x: 450 + dx, y: 300 + dy, heading: Math.atan2(-dy, -dx), speed: 105, seenAt: 0 };
  const d = Schooling.decide(f, w, { turn: 0, thrust: 1 });
  plans.push(f.escapePlan);
  if (d.turn !== f.escapePlan.turn || d.thrust !== f.escapePlan.thrust) throw Error('plan/action mismatch');
}
// Facing the left wall with an attacker approaching from the upper right:
// braking makes the turn tighter, then a straight exit clears both obstacles.
f.x = 50; f.y = 300; f.heading = Math.PI;
f.threat = { x: 150, y: 250, heading: Math.atan2(50, -100), speed: 105, seenAt: 0 };
f.escapeDecision = null;
Schooling.decide(f, w, { turn: 0, thrust: 1 });
plans.push(f.escapePlan);
const brake = f.escapePlan;
check('fish choose braking to turn clear of both a wall and an approaching shark',
  brake.thrust < 1 && brake.clearance > CONFIG.shark.radius + CONFIG.fish.radius);
check('fish can choose a different exit turn after the initial dodge',
  plans.some(p => p.turn !== p.exitTurn));
check('route search returns physically valid first actions',
  plans.every(p => Math.abs(p.turn) <= 1 && p.thrust >= 0 && p.thrust <= 1));
check('forecasts extend beyond the old constant-turn horizon',
  plans.every(p => p.seconds > cfg.predictionSteps * cfg.predictionDt && p.path.length === (cfg.routeSteps + 1) * 2));
let bounded = true, finite = true;
for (const p of plans) for (let i = 2; i < p.path.length; i += 2) {
  const x = p.path[i], y = p.path[i + 1];
  bounded &&= x >= CONFIG.fish.radius && x <= w.w - CONFIG.fish.radius &&
    y >= CONFIG.fish.radius && y <= w.h - CONFIG.fish.radius;
  finite &&= Number.isFinite(x) && Number.isFinite(y) &&
    Math.hypot(x - p.path[i - 2], y - p.path[i - 1]) <= CONFIG.fish.maxSpeed * cfg.predictionDt + 1e-9;
}
check('forecast paths remain in the tank without impossible jumps', bounded && finite);
if (brake) {
  const step = i => Math.hypot(brake.path[i * 2] - brake.path[(i - 1) * 2],
    brake.path[i * 2 + 1] - brake.path[(i - 1) * 2 + 1]);
  check('braking is temporary and the planned exit accelerates again',
    Math.abs(step(1) - CONFIG.fish.maxSpeed * brake.thrust * cfg.predictionDt) < 1e-8 &&
    Math.abs(step(cfg.dodgeSteps + 1) - CONFIG.fish.maxSpeed * cfg.predictionDt) < 1e-8);
}
// Change the hidden world without changing the remembered observation. Planning
// must be identical: fish do not receive a live, omniscient predator location.
f.escapeDecision = null;
Schooling.decide(f, w, { turn: 0, thrust: 1 });
const knownPlan = JSON.stringify(f.escapePlan);
Object.defineProperty(w, 'sharks', { get() { throw Error('planner read an unseen shark'); } });
f.escapeDecision = null;
Schooling.decide(f, w, { turn: 0, thrust: 1 });
check('route planning depends on observations, not hidden predator state', knownPlan === JSON.stringify(f.escapePlan));
const snapshot = JSON.stringify(f.escapePlan);
const noop = () => {};
const ctx = new Proxy({}, { get: () => noop, set: () => true });
Render.escapeRoute(ctx, f);
check('drawing a planned route never changes that route', JSON.stringify(f.escapePlan) === snapshot);
f.threat = null;
Schooling.decide(f, w, { turn: 0, thrust: 1 });
check('expired warnings clear the old escape route and restore schooling', f.escapePlan === null && f.escapeDecision === null);
`, { console, process, Math });
