// =============================================================================
// tools/make-demo.js - record the real simulation into an animated SVG.
// =============================================================================
// Usage:  node tools/make-demo.js
// Output: assets/demo.svg
//
// This is not a mockup. It loads the trained champion from champions/, runs the
// actual simulation headlessly, samples every body's position and heading, and
// writes those samples out as SMIL keyframes. What the README shows is exactly
// what the code does.
//
// SVG rather than GIF because there is no image encoder here and no intention
// of adding a dependency: an <img src="*.svg"> animates via SMIL in every
// browser GitHub serves, stays a few dozen kilobytes, and is resolution
// independent.
// =============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['config','rng','vec','senses','brain','genome','evolution','schooling',
               'fish','shark','world','persist'];

const src = FILES.map(n => fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8'))
  .join(String.fromCharCode(10));
const ctx = { console, Math, JSON, Number, Array, Object, Map, Set,
              Float64Array, Int32Array, Date };
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext('var X = { CONFIG, World, Innovation, Evolution, Persist };', ctx);
const { CONFIG, World, Innovation, Evolution, Persist } = ctx.X;

// ---- settings --------------------------------------------------------------
const FPS = 12;
const SECONDS = 9;
const FRAMES = FPS * SECONDS;
const EVERY = Math.round(1 / CONFIG.sim.dt / FPS);   // ticks between samples

World.keepInnovation = true;
Innovation.reset();
CONFIG.evolution.enabled = false;      // a demo, not a training run
CONFIG.life.continuous = false;
CONFIG.fish.count = 34;
CONFIG.sim.generationSeconds = 9000;   // never reset mid-recording
CONFIG.seed = 20260921;
Evolution.threshold = null;

const world = new World();

// Load the champion if there is a compatible one; otherwise record whatever
// random brains exist, and say so.
let usingChampion = false;
try {
  global.window = {};
  require(path.join(ROOT, 'champions', 'best.js'));
  const brain = Persist.fromJSON(global.window.CHAMPION);
  Innovation.absorb(brain);
  world.fish.forEach(f => { f.net = brain.clone(); });
  usingChampion = true;
} catch (err) {
  console.log('  (no compatible champion - recording untrained fish: ' + err.message + ')');
}

// Let the school settle before the camera rolls.
for (let i = 0; i < 240; i++) world.update(CONFIG.sim.dt);

// ---- record ----------------------------------------------------------------
const track = world.fish.map(() => ({ x: [], y: [], a: [], s: [] }));
const sharkTrack = { x: [], y: [], a: [] };

for (let frame = 0; frame < FRAMES; frame++) {
  for (let t = 0; t < EVERY; t++) world.update(CONFIG.sim.dt);

  world.fish.forEach((f, i) => {
    track[i].x.push(Math.round(f.x));
    track[i].y.push(Math.round(f.y));
    track[i].a.push(Math.round(f.heading * 180 / Math.PI));
    track[i].s.push(f.alive ? +(f.radius() / CONFIG.fish.radius).toFixed(2) : 0);
  });

  const s = world.sharks[0];
  sharkTrack.x.push(Math.round(s.x));
  sharkTrack.y.push(Math.round(s.y));
  sharkTrack.a.push(Math.round(s.heading * 180 / Math.PI));
}

module.exports = { track, sharkTrack, FRAMES, SECONDS, usingChampion, world, CONFIG };

if (require.main === module) require('./write-demo-svg.js');
