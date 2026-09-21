const fs = require('fs');
const vm = require('vm');
const root = process.argv[2];

const src = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','sharkbrain','shark','world']
  .map(n => fs.readFileSync(root + '/js/' + n + '.js', 'utf8')).join('\n');

const test = `
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-9); }
const fakeWorld = (sx, sy) => ({ w: CONFIG.tank.w, h: CONFIG.tank.h, shark: { x: sx, y: sy }, sharks: [{ x: sx, y: sy }], brainOn: true });

console.log('');

// --- 1. the arithmetic itself ------------------------------------------------
const n = new Neuron([0.5, -2.0, 1.0], 0.25);
const out = n.fire([1.0, 0.5, -1.0]);
const expectSum = 0.25 + 0.5 * 1.0 + (-2.0) * 0.5 + 1.0 * (-1.0);   // = -1.25
check('weighted sum is computed correctly', near(n.lastSum, expectSum),
      'got ' + n.lastSum.toFixed(4) + ', expected ' + expectSum.toFixed(4));
check('output is tanh of the sum', near(out, Math.tanh(expectSum)),
      'tanh(' + expectSum.toFixed(2) + ') = ' + out.toFixed(4));

// --- 2. tanh really does bound the output ------------------------------------
const wild = new Neuron([900, -900], 500);
const a = wild.fire([1, 0]), b = wild.fire([0, 1]);
check('no weight, however absurd, can push the output past 1',
      a <= 1 && a >= -1 && b <= 1 && b >= -1,
      'extremes: ' + a.toFixed(6) + ' and ' + b.toFixed(6));

// --- 3. does it actually steer AWAY? -----------------------------------------
const D = 90;
function turnFor(offsetIndex) {
  const off = Senses.rayOffset(offsetIndex);
  const f = new Fish(450, 300, 0);
  Senses.read(f, fakeWorld(450 + D * Math.cos(off), 300 + D * Math.sin(off)));
  return f.handNeuron.fire(f.senses);
}
const tNeg = turnFor(1);                                  // shark on the -40 ray
const tPos = turnFor(CONFIG.senses.rayCount - 2);         // shark on the +40 ray
check('shark on the negative side -> turns positive', tNeg > 0.1, 'turn = ' + tNeg.toFixed(3));
check('shark on the positive side -> turns negative', tPos < -0.1, 'turn = ' + tPos.toFixed(3));
check('the two responses mirror each other', near(tNeg, -tPos, 0.001),
      tNeg.toFixed(3) + ' vs ' + tPos.toFixed(3));

// --- 4. an untroubled fish in open water should barely steer -----------------
const calm = new Fish(450, 300, 0);
Senses.read(calm, fakeWorld(9999, 9999));
const tCalm = calm.handNeuron.fire(calm.senses);
check('sees nothing -> does nothing', Math.abs(tCalm) < 0.001, 'turn = ' + tCalm.toFixed(4));

// --- 5. THE REAL QUESTION: does thinking beat not thinking? ------------------
// It does not. The assertions below record WHY, because the mechanism is worth
// more than the disappointment.
function trial(brainOn, ticks) {
  const w = new World();
  w.mode = brainOn ? 'neuron' : 'wander';
  let wallTicks = 0, sumDist = 0, n = 0;
  for (let i = 0; i < ticks; i++) {
    w.update(CONFIG.sim.dt);
    for (const f of w.fish) {
      if (!f.alive) continue;
      n++;
      if (f.touchingWall) wallTicks++;
      sumDist += V.dist(f.x, f.y, w.shark.x, w.shark.y);
    }
  }
  return { kills: w.totalKills, wall: wallTicks / n, dist: sumDist / n };
}
const T = 3600;                       // 60 simulated seconds = two full rounds
const off = trial(false, T);
const on  = trial(true,  T);

console.log("");
console.log("  --- 60s, identical starting tank ---");
console.log("                      eaten   on wall   avg dist from shark");
console.log("  random wander    " + String(off.kills).padStart(6) +
            (100 * off.wall).toFixed(1).padStart(9) + "%" + off.dist.toFixed(0).padStart(15) + "px");
console.log("  one neuron       " + String(on.kills).padStart(6) +
            (100 * on.wall).toFixed(1).padStart(9) + "%" + on.dist.toFixed(0).padStart(15) + "px");
console.log("");

check("hand-wired flight LOSES to random (the Stage 4 motivation)", on.kills > off.kills,
      on.kills + " eaten vs " + off.kills + " - my weights are worse than no weights");
check("...because flight pins fish against the glass", on.wall > off.wall * 1.5,
      (100 * on.wall).toFixed(1) + "% on the wall vs " + (100 * off.wall).toFixed(1) + "%");
check("...and greater distance from the shark did NOT mean survival",
      on.dist > off.dist && on.kills > off.kills,
      "further away on average (" + on.dist.toFixed(0) + "px vs " + off.dist.toFixed(0) +
      "px) yet more died - distance is a BAD fitness proxy");

// --- 6. turn output stays legal across a whole run ---------------------------
const w2 = new World();
let worst = 0, nan = 0;
for (let i = 0; i < 1800; i++) {
  w2.update(CONFIG.sim.dt);
  for (const f of w2.fish) {
    if (!f.alive) continue;
    if (!Number.isFinite(f.lastTurn)) nan++;
    worst = Math.max(worst, Math.abs(f.lastTurn));
  }
}
check('no NaN from the neuron in 30s', nan === 0);
check('turn never leaves -1..1 in play', worst <= 1, 'largest |turn| = ' + worst.toFixed(4));
console.log('');
`;

vm.runInNewContext(src + test, { console, process });
