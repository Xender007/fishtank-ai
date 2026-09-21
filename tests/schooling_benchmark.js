// Paired seeds, exact same champion and spawn positions. No training or writes
// to champions. Usage: node tests/schooling_benchmark.js [seeds=12] [seconds=60]
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const files = ['config','rng','vec','senses','brain','genome','evolution','fish','schooling','sharkbrain','shark','world','persist'];
const src = files.map(n => fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8')).join('\n');
const champion = JSON.parse(fs.readFileSync(path.join(root, 'champions/best-shoal8.json'), 'utf8'));
const runs = Number(process.argv[2] || 12), seconds = Number(process.argv[3] || 60);
vm.runInNewContext(src + `
CONFIG.evolution.enabled = false;
CONFIG.sim.generationSeconds = seconds;
const brain = Persist.fromJSON(champion);
const results = [];
for (const enabled of [false, true]) {
  const rows = [];
  CONFIG.schooling.enabled = enabled;
  for (let seed = 0; seed < runs; seed++) {
    CONFIG.seed = 900001 + seed * 104729;
    const w = new World();
    const watched = w.fish.slice();
    for (const f of watched) f.net = brain.clone();
    let packed = 0, samples = 0, wallTicks = 0, liveTicks = 0;
    for (let i = 0; i < w.generationTicks - 1 && watched.some(f => f.alive); i++) {
      w.update(CONFIG.sim.dt);
      for (const f of watched) if (f.alive) { liveTicks++; if (f.touchingWall) wallTicks++; }
      if (enabled && i > 600 && i % 60 === 0) {
        for (const p of w.packs) {
          // Spatial pack quality: each member has >=6 packmates within 140px.
          for (const f of p.members) {
            samples++;
            if (p.members.filter(m => m !== f && V.dist2(f.x, f.y, m.x, m.y) < 140 ** 2).length >= 6) packed++;
          }
        }
      }
    }
    rows.push({ eaten: watched.filter(f => !f.alive).length / watched.length * 100,
      survival: watched.reduce((s, f) => s + f.age, 0) / watched.length,
      packed: samples ? packed / samples * 100 : 0, wall: wallTicks / Math.max(1, liveTicks) * 100 });
  }
  const avg = key => rows.reduce((s, r) => s + r[key], 0) / rows.length;
  const result = { mode: enabled ? 'social planner' : 'neural only', seeds: runs, seconds,
    eatenPercent: +avg('eaten').toFixed(2), survivalSeconds: +avg('survival').toFixed(2),
    groupedPercent: +avg('packed').toFixed(2), wallPercent: +avg('wall').toFixed(2), rows };
  results.push(result);
  console.log(JSON.stringify(result));
}
`, { console, champion, runs, seconds });
