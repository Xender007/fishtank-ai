// Compare the preserved social-v1 controller to the current one. The old
// implementation is a frozen fixture, never loaded by the application.
// node tests/planner_benchmark.js [runs=12] [seconds=60] [seedBase=900001]
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const files = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','sharkbrain','shark','world','persist'];
const champion = JSON.parse(fs.readFileSync(path.join(root, 'champions/best-shoal8.json'), 'utf8'));
const runs = +(process.argv[2] || 12), seconds = +(process.argv[3] || 60), seedBase = +(process.argv[4] || 900001);
for (const mode of ['previous', 'current']) {
  const src = files.map(n => fs.readFileSync(path.join(root,
    n === 'schooling' && mode === 'previous' ? 'tests/fixtures/schooling-v1.js' : 'js/' + n + '.js'), 'utf8')).join('\n');
  vm.runInNewContext(src + `
    CONFIG.evolution.enabled = false;
    CONFIG.sim.generationSeconds = seconds;
    const brain = Persist.fromJSON(champion), rows = [];
    const start = Date.now();
    for (let seed = 0; seed < runs; seed++) {
      CONFIG.seed = seedBase + seed * 104729;
      const w = new World(), watched = w.fish.slice();
      for (const f of watched) f.net = brain.clone();
      let samples = 0, grouped = 0;
      for (let i = 0; i < w.generationTicks - 1 && watched.some(f => f.alive); i++) {
        w.update(CONFIG.sim.dt);
        if (i > 600 && i % 60 === 0) for (const p of w.packs) for (const f of p.members) {
          samples++;
          if (p.members.filter(m => m !== f && V.dist2(m.x,m.y,f.x,f.y) < 140 ** 2).length >= 6) grouped++;
        }
      }
      rows.push({ eaten: watched.filter(f => !f.alive).length / watched.length * 100,
        survival: watched.reduce((s, f) => s + f.age, 0) / watched.length,
        grouped: grouped / Math.max(1, samples) * 100 });
    }
    const avg = key => rows.reduce((s, r) => s + r[key], 0) / rows.length;
    console.log(JSON.stringify({mode, runs, seconds, seedBase, eaten: avg('eaten'),
      survival: avg('survival'), grouped: avg('grouped'), runtimeSeconds: (Date.now()-start)/1000, rows}));
  `, { console, Math, Date, champion, runs, seconds, seedBase, mode });
}
