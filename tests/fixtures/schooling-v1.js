// A hybrid fish brain: learned neural reflex + social memory + short-horizon
// route evaluation. All decisions use a snapshot taken BEFORE anybody moves.
// The shark has no access to this planner and gains no learned behaviour.
const Schooling = {
  active(world) { return CONFIG.schooling.enabled && world.mode === 'network'; },

  // Nearest neighbours form stable packs. Rebuild only when casualties leave
  // an undersized pack; otherwise preserve identity and the surviving alpha.
  organise(world) {
    const live = world.fish.filter(f => f.alive);
    for (const f of world.fish) if (!f.alive) f.isAlpha = false;
    let packs = (world.packs || []).map(p => ({ ...p,
      members: p.members.filter(f => f.alive) })).filter(p => p.members.length);
    const minimum = CONFIG.schooling.minSize;
    if (!packs.length || packs.reduce((n, p) => n + p.members.length, 0) !== live.length ||
        (packs.length > 1 && packs.some(p => p.members.length < minimum))) {
      const count = Math.max(1, Math.min(Math.floor(live.length / minimum),
        Math.round(live.length / CONFIG.schooling.targetSize)));
      const remaining = live.slice().sort((a, b) => a.id - b.id);
      packs = [];
      for (let i = 0; i < count && remaining.length; i++) {
        const seed = remaining[0];
        remaining.sort((a, b) => V.dist2(a.x, a.y, seed.x, seed.y) -
          V.dist2(b.x, b.y, seed.x, seed.y) || a.id - b.id);
        const size = Math.ceil(remaining.length / (count - i));
        packs.push({ id: i + 1, members: remaining.splice(0, size), alpha: null });
      }
    }
    for (const p of packs) {
      p.x = p.members.reduce((s, f) => s + f.x, 0) / p.members.length;
      p.y = p.members.reduce((s, f) => s + f.y, 0) / p.members.length;
      if (!p.alpha || !p.alpha.alive || !p.members.includes(p.alpha)) {
        // A central survivor can communicate with more of the pack. Stable id
        // breaks ties, so election consumes no randomness and never flaps.
        p.alpha = p.members.slice().sort((a, b) =>
          V.dist2(a.x, a.y, p.x, p.y) - V.dist2(b.x, b.y, p.x, p.y) || a.id - b.id)[0];
      }
      p.members.forEach((f, i) => {
        f.pack = p; f.packId = p.id; f.isAlpha = f === p.alpha; f.slot = i;
      });
    }
    world.packs = packs;
  },

  prepare(world) {
    if (!this.active(world)) return;
    this.organise(world);
    const cfg = CONFIG.schooling, now = world.time;
    const live = world.fish.filter(f => f.alive);
    // Immutable previous-tick messages: an alarm travels one local hop per
    // tick, never instantly through the whole array. Relays keep the ORIGINAL
    // observation time, so a rumour cannot refresh itself forever.
    const messages = live.map(f => ({ fish: f, threat: f.threat }));
    for (const f of live) {
      let threat = f.threat && now - f.threat.seenAt < cfg.memorySeconds ? f.threat : null;
      let nearest = Infinity, seen = null;
      const gaze = f.heading + (f.isAlpha ? Math.sin(now * 2 + f.id) * 0.65 : 0);
      const range = f.isAlpha ? cfg.scoutRange : cfg.followerRange;
      for (const s of world.sharks) {
        const d = V.dist(f.x, f.y, s.x, s.y);
        const angle = Math.abs(V.angleDiff(V.angleTo(f.x, f.y, s.x, s.y), gaze));
        if (d < nearest && (d <= cfg.nearSense || (d <= range &&
            angle <= (f.isAlpha ? Math.PI * 0.78 : CONFIG.senses.fov / 2)))) {
          nearest = d; seen = s;
        }
      }
      f.directThreat = !!seen;
      if (seen) threat = { x: seen.x, y: seen.y, heading: seen.heading,
        speed: seen.speed, seenAt: now, source: f.id, hops: 0 };
      else for (const msg of messages) {
        const t = msg.threat;
        if (msg.fish === f || !t || now - t.seenAt >= cfg.memorySeconds ||
            V.dist2(f.x, f.y, msg.fish.x, msg.fish.y) > cfg.alarmRange ** 2) continue;
        if (!threat || t.seenAt > threat.seenAt) threat = { ...t, hops: t.hops + 1 };
      }
      f.threat = threat;
      f.alarm = threat ? V.clamp(1 - (now - threat.seenAt) / cfg.memorySeconds, 0, 1) : 0;
      f.socialDecision = null;
    }
    // Compute everyone's navigation from the same positions and headings.
    for (const f of live) f.socialDecision = this.navigate(f, world);
  },

  navigate(f, world) {
    const cfg = CONFIG.schooling, p = f.pack, a = p.alpha;
    let dx = Math.cos(a.heading), dy = Math.sin(a.heading);
    let tx = f.x + dx * 80, ty = f.y + dy * 80;
    if (!f.isAlpha) {
      // Staggered trailing slots avoid the identical-path queue which the
      // old solo champion formed. A threatened school may temporarily fan out.
      const index = p.members.filter(m => m !== a).indexOf(f);
      const row = 1 + Math.floor(index / 2), side = index % 2 ? 1 : -1;
      tx = a.x - dx * row * cfg.spacing - dy * side * cfg.spacing;
      ty = a.y - dy * row * cfg.spacing + dx * side * cfg.spacing;
      dx = (tx - f.x) / 45 + Math.cos(a.heading);
      dy = (ty - f.y) / 45 + Math.sin(a.heading);
    } else {
      // Slow down for stragglers, and gently steer back towards the pack.
      dx += (p.x - f.x) / 250;
      dy += (p.y - f.y) / 250;
    }
    for (const other of world.fish) {
      if (!other.alive || other === f) continue;
      let x = f.x - other.x, y = f.y - other.y;
      let d = Math.hypot(x, y);
      if (d >= cfg.spacing) continue;
      if (d < 0.001) { x = f.id < other.id ? -1 : 1; y = 0; d = 1; }
      const strength = (cfg.spacing - d) / cfg.spacing * 1.8;
      dx += x / d * strength; dy += y / d * strength;
    }
    // Look ahead far enough to turn before touching glass, including corners.
    const margin = 100;
    dx += Math.max(0, margin - f.x) / 24 - Math.max(0, f.x - world.w + margin) / 24;
    dy += Math.max(0, margin - f.y) / 24 - Math.max(0, f.y - world.h + margin) / 24;
    const turn = V.clamp(V.angleDiff(Math.atan2(dy, dx), f.heading) * 1.8, -1, 1);
    const gap = Math.hypot(tx - f.x, ty - f.y);
    const thrust = f.isAlpha ? 0.72 : V.clamp(0.66 + (gap - 25) / 160, 0.5, 1);
    f.behaviour = f.isAlpha ? 'scouting' : gap > 100 ? 'regrouping' : 'schooling';
    return { turn, thrust };
  },

  decide(f, world, neural) {
    if (!this.active(world) || !f.socialDecision) return neural;
    const t = f.threat, cfg = CONFIG.schooling;
    if (!t) { f.escapeDecision = null; return f.socialDecision; }
    const elapsed = Math.min(world.time - t.seenAt, 0.6);
    const sx = V.clamp(t.x + Math.cos(t.heading) * t.speed * elapsed, 16, world.w - 16);
    const sy = V.clamp(t.y + Math.sin(t.heading) * t.speed * elapsed, 16, world.h - 16);
    const distance = V.dist(f.x, f.y, sx, sy);
    if (distance > cfg.scoutRange + 40) return f.socialDecision;
    f.behaviour = f.directThreat ? 'evading' : 'following alarm';
    if (f.escapeDecision && (world.ticks + f.id) % cfg.planEvery !== 0) return f.escapeDecision;

    // Predict several possible turns under the SAME speed and turn limits as
    // the real bodies. The neural reflex is one candidate and a small prior;
    // safe separation and avoiding glass dominate the choice. Only the last
    // observed predator state is available, not its current hidden position.
    const choices = [-1, -0.65, -0.3, 0, 0.3, 0.65, 1, neural.turn, f.socialDecision.turn];
    let best = -Infinity, decision = neural;
    for (const turn of choices) {
      let x = f.x, y = f.y, heading = f.heading;
      let px = sx, py = sy, ph = t.heading, minGap = Infinity, wallCost = 0;
      for (let i = 0; i < cfg.predictionSteps; i++) {
        heading += turn * CONFIG.fish.turnRate * cfg.predictionDt;
        x += Math.cos(heading) * CONFIG.fish.maxSpeed * cfg.predictionDt;
        y += Math.sin(heading) * CONFIG.fish.maxSpeed * cfg.predictionDt;
        const wall = Math.min(x, y, world.w - x, world.h - y);
        wallCost += Math.max(0, 28 - wall) * 1.6;
        x = V.clamp(x, CONFIG.fish.radius, world.w - CONFIG.fish.radius);
        y = V.clamp(y, CONFIG.fish.radius, world.h - CONFIG.fish.radius);
        const step = CONFIG.shark.turnRate * cfg.predictionDt;
        ph += V.clamp(V.angleDiff(V.angleTo(px, py, x, y), ph), -step, step);
        px = V.clamp(px + Math.cos(ph) * t.speed * cfg.predictionDt, 16, world.w - 16);
        py = V.clamp(py + Math.sin(ph) * t.speed * cfg.predictionDt, 16, world.h - 16);
        minGap = Math.min(minGap, V.dist(x, y, px, py));
      }
      const gap = V.dist(x, y, px, py);
      const collision = Math.max(0, CONFIG.shark.radius + CONFIG.fish.radius + 10 - minGap);
      const cohesion = distance > 150 ? V.dist(x, y, f.pack.x, f.pack.y) * 0.06 : 0;
      const score = minGap * 2 + gap * 0.65 - collision * 18 - wallCost - cohesion -
        Math.abs(turn - neural.turn) * 1.5 - Math.abs(turn - f.lastTurn) * 3;
      if (score > best) { best = score; decision = { turn, thrust: 1 }; }
    }
    f.escapeDecision = decision;
    return decision;
  },
};
