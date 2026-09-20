const fs = require('fs');
const vm = require('vm');
const root = process.argv[2];

const src = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','shark','world']
  .map(n => fs.readFileSync(root + '/js/' + n + '.js', 'utf8')).join('\n');

const test = `
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) process.exitCode = 1;
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 0.01); }

const fakeWorld = (sx, sy) => ({ w: CONFIG.tank.w, h: CONFIG.tank.h, shark: { x: sx, y: sy }, sharks: [{ x: sx, y: sy }] });
const RANGE = CONFIG.senses.range, WR = CONFIG.senses.wallRange, R = CONFIG.shark.radius;
const MID = Math.floor(CONFIG.senses.rayCount / 2);

console.log('');
console.log('  ray offsets: ' + Array.from({length: CONFIG.senses.rayCount},
  (_, i) => Math.round(Senses.rayOffset(i) * 180 / Math.PI) + '\u00B0').join('  '));
console.log('');

// --- 1. shark dead ahead at 100px --------------------------------------------
// surface is at 100 - 16 = 84px, so the sense should read 1 - 84/170
let f = new Fish(100, 100, 0);
Senses.read(f, fakeWorld(200, 100));
const expect1 = 1 - (100 - R) / RANGE;
check('centre ray sees a shark dead ahead', near(f.senses[MID], expect1),
      'got ' + f.senses[MID].toFixed(3) + ', expected ' + expect1.toFixed(3));
check('hit distance is the SURFACE, not the centre', near(f.rayHit[MID], 100 - R, 0.5),
      'got ' + f.rayHit[MID].toFixed(1) + 'px, expected ' + (100 - R));

// --- 2. closer shark reads higher --------------------------------------------
let g = new Fish(100, 100, 0);
Senses.read(g, fakeWorld(150, 100));
check('closer shark gives a bigger number', g.senses[MID] > f.senses[MID],
      g.senses[MID].toFixed(3) + ' > ' + f.senses[MID].toFixed(3));

// --- 3. shark behind the fish ------------------------------------------------
let h = new Fish(100, 100, 0);
Senses.read(h, fakeWorld(20, 100));
check('a shark BEHIND is completely invisible',
      Array.from(h.senses).slice(0, CONFIG.senses.rayCount).every(v => v === 0),
      'blind spot confirmed');

// --- 4. shark beyond visual range --------------------------------------------
let k = new Fish(100, 100, 0);
Senses.read(k, fakeWorld(100 + RANGE + 60, 100));
check('a shark beyond range is invisible',
      Array.from(k.senses).slice(0, CONFIG.senses.rayCount).every(v => v === 0));

// --- 5. the correct ray fires, not just any ray ------------------------------
const off = Senses.rayOffset(CONFIG.senses.rayCount - 1);   // the far-right ray
let m = new Fish(100, 300, 0);
Senses.read(m, fakeWorld(100 + 100 * Math.cos(off), 300 + 100 * Math.sin(off)));
const lit = Array.from(m.senses).slice(0, CONFIG.senses.rayCount)
              .map((v, i) => v > 0 ? i : -1).filter(i => i >= 0);
check('a shark off to one side lights exactly the right ray',
      lit.length === 1 && lit[0] === CONFIG.senses.rayCount - 1,
      'lit ray(s): [' + lit.join(',') + '], expected [' + (CONFIG.senses.rayCount - 1) + ']');

// --- 6. wall feeler -----------------------------------------------------------
let w1 = new Fish(100, 300, Math.PI);     // facing the left wall, 100px away
Senses.read(w1, fakeWorld(9999, 9999));
check('wall ahead at 100px', near(w1.senses[Senses.WALL], 1 - 100 / WR),
      'got ' + w1.senses[Senses.WALL].toFixed(3));

let w2 = new Fish(6, 300, Math.PI);       // nose almost on the glass
Senses.read(w2, fakeWorld(9999, 9999));
check('wall sense approaches 1 at the glass', w2.senses[Senses.WALL] > 0.94,
      'got ' + w2.senses[Senses.WALL].toFixed(3));

let w3 = new Fish(450, 300, 0);           // mid-tank, facing open water
Senses.read(w3, fakeWorld(9999, 9999));
check('wall sense is 0 in open water', w3.senses[Senses.WALL] === 0);

// --- 7. speed -----------------------------------------------------------------
let s1 = new Fish(450, 300, 0);
s1.speed = CONFIG.fish.maxSpeed;
Senses.read(s1, fakeWorld(9999, 9999));
check('speed sense is 1 at full thrust', near(s1.senses[Senses.SPEED], 1));

// --- 8. nothing ever escapes 0..1 over a real run -------------------------------
const world = new World();
let lo = Infinity, hi = -Infinity, sawShark = 0, sawWall = 0, bad = 0;
for (let i = 0; i < 1800; i++) {
  world.update(CONFIG.sim.dt);
  for (const fish of world.fish) {
    if (!fish.alive) continue;
    for (let j = 0; j < Senses.COUNT; j++) {
      const v = fish.senses[j];
      if (!Number.isFinite(v)) bad++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    for (let j = 0; j < CONFIG.senses.rayCount; j++) if (fish.senses[j] > 0) { sawShark++; break; }
    if (fish.senses[Senses.WALL] > 0) sawWall++;
  }
}
check('no NaN or Infinity anywhere in 30s', bad === 0);
// Rays, wall and crowd report a MAGNITUDE and live in 0..1. The closing
// sense reports a DIRECTION of change and is signed: negative means the
// shark is falling behind, which is information a 0..1 range cannot carry.
check('every sense stays within -1..1', lo >= -1 && hi <= 1,
      'observed range ' + lo.toFixed(3) + ' .. ' + hi.toFixed(3));
check('fish really do see the shark in play', sawShark > 0,
      sawShark + ' fish-ticks with the shark in view');
check('fish really do feel the wall in play', sawWall > 0,
      sawWall + ' fish-ticks with glass ahead');
console.log('');
`;

vm.runInNewContext(src + test, { console, process });
