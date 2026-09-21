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
    // Counted once here, read by every decide() call this tick.
    world.planningPopulation = world.fish.reduce((n, f) => n + (f.alive ? 1 : 0), 0);
    this.organise(world);
    const cfg = CONFIG.schooling, now = world.time;
    const live = world.fish.filter(f => f.alive);
    // Immutable previous-tick messages: an alarm travels one local hop per
    // tick, never instantly through the whole array. Relays keep the ORIGINAL
    // observation time, so a rumour cannot refresh itself forever.
    // Only fish that actually HOLD a current warning can relay one. Building
    // that list once per tick, rather than having all seventy fish scan all
    // seventy messages and reject sixty-nine of them, is the difference
    // between an O(n^2) loop that runs every tick and one that is usually
    // empty - because most of the time nobody has seen anything.
    const messages = [];
    for (const f of live) {
      const t = f.threat;
      if (t && now - t.seenAt < cfg.memorySeconds) messages.push({ fish: f, threat: t });
    }
    const alarmRange2 = cfg.alarmRange * cfg.alarmRange;
    for (const f of live) {
      let threat = f.threat && now - f.threat.seenAt < cfg.memorySeconds ? f.threat : null;
      let nearest = Infinity, seen = null;
      const profile = Senses.socialProfile(f, now);
      f.socialSense = profile;
      const gaze = profile.heading, range = profile.range;
      for (const s of world.sharks) {
        const d = V.dist(f.x, f.y, s.x, s.y);
        const angle = Math.abs(V.angleDiff(V.angleTo(f.x, f.y, s.x, s.y), gaze));
        if (d < nearest && (d <= cfg.nearSense || (d <= range &&
            angle <= profile.halfFov))) {
          nearest = d; seen = s;
        }
      }
      f.directThreat = !!seen;
      if (seen) threat = { x: seen.x, y: seen.y, heading: seen.heading,
        speed: seen.speed, seenAt: now, source: f.id, hops: 0 };
      else for (const msg of messages) {
        // Staleness was already checked when the list was built; only the
        // distance can differ per listener.
        if (msg.fish === f) continue;
        if (V.dist2(f.x, f.y, msg.fish.x, msg.fish.y) > alarmRange2) continue;
        const t = msg.threat;
        if (!threat || t.seenAt > threat.seenAt) threat = { ...t, hops: t.hops + 1, via: msg.fish.id };
      }
      f.threat = threat;
      f.alarm = threat ? V.clamp(1 - (now - threat.seenAt) / cfg.memorySeconds, 0, 1) : 0;
      f.socialDecision = null;
    }
    this.measureSocial(world, live);
    // Compute everyone's navigation from the same positions and headings.
    // With learned teamwork the network steers instead (see decide()); the
    // written rules then run only for PARENTING in continuous life - juveniles
    // sheltering and adults screening them - because training never contains
    // a juvenile, so there is nothing to learn that behaviour from.
    const learned = CONFIG.learned.teamwork;
    for (const f of live) {
      if (!learned) { f.socialDecision = this.navigate(f, world); continue; }
      f.socialDecision = null;
      if (CONFIG.life.continuous) {
        const rule = this.navigate(f, world);
        if (f.escorting !== null && f.escorting !== undefined || f.maturity() < 1) f.socialDecision = rule;
      }
      if (!f.socialDecision) {
        f.escorting = null;
        f.behaviour = f.isAlpha ? 'scouting' : f.social.packDistance > 100 ? 'regrouping' : 'schooling';
      }
    }
  },

  // ---------------------------------------------------------------------------
  // THE TEAM, MEASURED ONCE PER TICK (layout-v3 senses).
  // ---------------------------------------------------------------------------
  // For every fish: where its pack's centre is, which way its packmates are
  // heading on average, and where its nearest neighbour is. All from the same
  // snapshot, before anybody moves, so the answer never depends on the order
  // fish happen to be stored in. Senses.readSocial() copies these into the
  // network's inputs.
  // ---------------------------------------------------------------------------
  measureSocial(world, live) {
    for (const p of world.packs) {
      let c = 0, s = 0;
      for (const m of p.members) { c += Math.cos(m.heading); s += Math.sin(m.heading); }
      p.headingCos = c; p.headingSin = s;
    }
    for (const f of live) {
      const soc = f.social || (f.social = {});
      const p = f.pack;
      const pd = p ? V.dist(f.x, f.y, p.x, p.y) : 0;
      soc.packDistance = pd;
      soc.packPull = p && pd > 1e-6
        ? V.angleDiff(V.angleTo(f.x, f.y, p.x, p.y), f.heading) / Math.PI * V.clamp(pd / 100, 0, 1) : 0;
      soc.packFar = V.clamp(pd / 150, 0, 1);
      let align = 0;
      if (p && p.members.length > 1) {
        const c = p.headingCos - Math.cos(f.heading), s = p.headingSin - Math.sin(f.heading);
        if (c * c + s * s > 1e-12) align = V.angleDiff(Math.atan2(s, c), f.heading) / Math.PI;
      }
      soc.align = align;
      let nearest = Infinity, other = null;
      for (const o of live) {
        if (o === f) continue;
        const d2 = V.dist2(f.x, f.y, o.x, o.y);
        if (d2 < nearest) { nearest = d2; other = o; }
      }
      const reach = CONFIG.schooling.spacing * 2;
      const closeness = other ? V.clamp(1 - Math.sqrt(nearest) / reach, 0, 1) : 0;
      soc.crowded = closeness;
      soc.neighbour = other && closeness > 0
        ? V.angleDiff(V.angleTo(f.x, f.y, other.x, other.y), f.heading) / Math.PI * closeness : 0;
    }
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
    // -----------------------------------------------------------------------
    // THE YOUNG, AND WHOSE JOB THEY ARE
    // -----------------------------------------------------------------------
    // A newborn moves at 45% of adult speed and turns at 60% of adult rate. It
    // cannot escape anything. Its brain may be excellent - it inherited two
    // good ones - but the body cannot execute what the brain asks for another
    // eighteen seconds.
    //
    // So survival of the young is not their own problem to solve. A juvenile
    // pulls hard toward the middle of its pack, where being reached means
    // going through the adults first. And an adult that has a known threat and
    // a juvenile near it INTERPOSES: it steers for the point between the two.
    //
    // Neither behaviour is learned, and neither is pretending to be. They are
    // written rules, in the same spirit as the rest of this planner - what is
    // learned is the reflex underneath. Without them a population in
    // continuous mode simply goes extinct: every baby born is eaten before it
    // can grow, and a lineage that cannot raise young has no descendants.
    // -----------------------------------------------------------------------
    if (CONFIG.life.continuous) {
      const mine = f.maturity();

      if (mine < 1) {
        // Juvenile: get inside the school. The younger it is, the harder it
        // pulls, because the less it can do for itself.
        const need = (1 - mine) * 2.2;
        dx += (p.x - f.x) / 90 * need;
        dy += (p.y - f.y) / 90 * need;
      } else if (f.threat) {
        // Adult with a threat in mind: find the nearest juvenile in the pack
        // and put yourself between it and the danger.
        let ward = null, nearest = 200 * 200;
        for (const other of p.members) {
          if (!other.alive || other.maturity() >= 1) continue;
          const d = V.dist2(f.x, f.y, other.x, other.y);
          if (d < nearest) { nearest = d; ward = other; }
        }
        if (ward) {
          // The point between the young fish and the threat.
          const gx = (ward.x + f.threat.x) / 2;
          const gy = (ward.y + f.threat.y) / 2;
          const urgency = f.isAlpha ? 2.0 : 1.2;   // the scout leads the screen
          dx += (gx - f.x) / 70 * urgency;
          dy += (gy - f.y) / 70 * urgency;
          f.escorting = ward.id;
        } else {
          f.escorting = null;
        }
      } else {
        f.escorting = null;
      }
    }

    // Look ahead far enough to turn before touching glass, including corners.
    const margin = 100;
    dx += Math.max(0, margin - f.x) / 24 - Math.max(0, f.x - world.w + margin) / 24;
    dy += Math.max(0, margin - f.y) / 24 - Math.max(0, f.y - world.h + margin) / 24;
    const turn = V.clamp(V.angleDiff(Math.atan2(dy, dx), f.heading) * 1.8, -1, 1);
    const gap = Math.hypot(tx - f.x, ty - f.y);
    const thrust = f.isAlpha ? 0.72 : V.clamp(0.66 + (gap - 25) / 160, 0.5, 1);
    f.behaviour = f.escorting ? 'escorting a juvenile'
      : (f.maturity && f.maturity() < 1) ? 'juvenile — sheltering'
      : f.isAlpha ? 'scouting' : gap > 100 ? 'regrouping' : 'schooling';
    return { turn, thrust };
  },

  decide(f, world, neural) {
    if (!this.active(world)) return neural;
    // In calm water the fish is steered by my pack rules, or - with learned
    // teamwork - by its own network, which is then simply the neural output.
    const calm = f.socialDecision || (CONFIG.learned.teamwork ? neural : null);
    if (!calm) return neural;
    const t = f.threat, cfg = CONFIG.schooling;
    if (!t) { f.escapeDecision = null; f.escapePlan = null; return calm; }
    const elapsed = Math.min(world.time - t.seenAt, 0.6);
    const sx = V.clamp(t.x + Math.cos(t.heading) * t.speed * elapsed, 16, world.w - 16);
    const sy = V.clamp(t.y + Math.sin(t.heading) * t.speed * elapsed, 16, world.h - 16);
    const distance = V.dist(f.x, f.y, sx, sy);
    if (distance > cfg.scoutRange + 40) { f.escapePlan = null; return calm; }
    f.behaviour = f.directThreat ? 'evading' : 'following alarm';
    // How often THIS fish re-plans. In a small school that is planEvery; in a
    // large one it stretches so the total planning work per tick stays inside
    // the budget, whatever the population does.
    const crowd = world.planningPopulation || 1;
    const interval = Math.max(cfg.planEvery, Math.ceil(crowd / cfg.maxPlansPerTick));
    if (f.escapeDecision && (world.ticks + f.id) % interval !== 0) return f.escapeDecision;

    // Search complete manoeuvres: dodge (optionally braking) THEN exit. Apply
    // only the first action and replan from new observations. A fish can now
    // discover a hook turn or an S-shaped escape, rather than holding a circle.
    const choices = [-1, -0.5, 0, 0.5, 1, neural.turn, calm.turn];
    // Which ranking: my formula, or the critic this fish's genome evolved.
    const critic = CONFIG.learned.planner && f.net && f.net.critic ? f.net.critic : null;
    const feat = critic ? (f._criticScratch || (f._criticScratch = new Float64Array(Critic.FEATURES.length))) : null;
    const urgency = V.clamp(1 - distance / 300, 0, 1);
    // Reuse one scratch trajectory. Only a winning candidate is copied for
    // the inspector; the renderer never computes or changes fish decisions.
    const pathLength = (cfg.routeSteps + 1) * 2;
    if (!f._routeScratch || f._routeScratch.length !== pathLength) f._routeScratch = new Float64Array(pathLength);
    const path = f._routeScratch;
    path[0] = f.x; path[1] = f.y;
    let best = -Infinity, decision = neural;
    const sharkStep = CONFIG.shark.turnRate * cfg.predictionDt;   // the forecast shark's turn limit per step
    for (let c = 0; c < choices.length; c++) {
      const turn = choices[c];
      // With learned teamwork the calm-water turn IS the reflex turn, so the
      // last candidate would repeat the one before it. A repeat can never win
      // (only a strictly better score replaces the best), so skipping it
      // changes no decision and saves a seventh of the search.
      if (c === choices.length - 1 && turn === choices[c - 1]) continue;
      const braking = distance < 150 && Math.abs(turn) > 0.6;
      for (let sp = 0; sp < (braking ? 2 : 1); sp++) for (let ex = 0; ex < 3; ex++) {
        const thrust = sp === 0 ? 1 : 0.6;
        const exitTurn = ex === 0 ? turn : ex === 1 ? 0 : -turn;
        const step = sharkStep;
        let x = f.x, y = f.y, heading = f.heading;
        let px = sx, py = sy, ph = t.heading, minGap = Infinity, wallCost = 0;
        for (let i = 0; i < cfg.routeSteps; i++) {
          const initial = i < cfg.dodgeSteps;
          const ox = x - px, oy = y - py;
          heading += (initial ? turn : exitTurn) * CONFIG.fish.turnRate * cfg.predictionDt;
          const speed = CONFIG.fish.maxSpeed * (initial ? thrust : 1);
          x += Math.cos(heading) * speed * cfg.predictionDt;
          y += Math.sin(heading) * speed * cfg.predictionDt;
          const wall = Math.min(x, y, world.w - x, world.h - y);
          wallCost += Math.max(0, 28 - wall) * 1.6;
          x = V.clamp(x, CONFIG.fish.radius, world.w - CONFIG.fish.radius);
          y = V.clamp(y, CONFIG.fish.radius, world.h - CONFIG.fish.radius);
          path[(i + 1) * 2] = x;
          path[(i + 1) * 2 + 1] = y;
          ph += V.clamp(V.angleDiff(V.angleTo(px, py, x, y), ph), -step, step);
          px = V.clamp(px + Math.cos(ph) * t.speed * cfg.predictionDt, 16, world.w - 16);
          py = V.clamp(py + Math.sin(ph) * t.speed * cfg.predictionDt, 16, world.h - 16);
          // Swept separation catches collisions BETWEEN forecast samples.
          const rx = x - px - ox, ry = y - py - oy;
          const fraction = V.clamp(-(ox * rx + oy * ry) / (rx * rx + ry * ry || 1), 0, 1);
          // sqrt, not Math.hypot: hypot guards against overflow this never needs
          // and is several times slower in V8. MEASURED: 15-20% off a whole
          // 45-fish evaluation, since this line runs for every forecast step of
          // every candidate route.
          const gx = ox + fraction * rx, gy = oy + fraction * ry;
          minGap = Math.min(minGap, Math.sqrt(gx * gx + gy * gy));
        }
        const gap = V.dist(x, y, px, py);
        const collision = Math.max(0, CONFIG.shark.radius + CONFIG.fish.radius + 10 - minGap);
        const cohesion = distance > 150 ? V.dist(x, y, f.pack.x, f.pack.y) * 0.06 : 0;
        let score;
        if (critic) {
          // Raw features, in Critic.FEATURES order. The cohesion slot holds the
          // DISTANCE (the hand formula's 0.06 is the critic's weight on it).
          feat[0] = minGap; feat[1] = gap; feat[2] = collision; feat[3] = wallCost;
          feat[4] = distance > 150 ? V.dist(x, y, f.pack.x, f.pack.y) : 0;
          feat[5] = Math.abs(turn - neural.turn); feat[6] = Math.abs(turn - f.lastTurn);
          feat[7] = thrust < 1 ? 1 : 0; feat[8] = urgency;
          score = critic.score(feat);
        } else {
          score = minGap * 2 + gap * 0.65 - collision * 18 - wallCost - cohesion -
            Math.abs(turn - neural.turn) * 1.5 - Math.abs(turn - f.lastTurn) * 3;
        }
        if (score > best) {
          best = score; decision = { turn, thrust };
          f.escapePlan = {
            turn, thrust, exitTurn, clearance: minGap, path: path.slice(), plannedAt: world.time,
            seconds: cfg.routeSteps * cfg.predictionDt,
            manoeuvre: thrust < 1 ? 'brake and dodge' : Math.abs(turn) < 0.1 ? 'accelerate away' :
              exitTurn === 0 ? 'turn then straighten' : exitTurn !== turn ? 'reverse-turn escape' : 'arcing escape',
          };
        }
      }
    }
    f.escapeDecision = decision;
    return decision;
  },
};
