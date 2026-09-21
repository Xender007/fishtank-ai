// =============================================================================
// render.js - draws the world. Changes NOTHING about it.
// =============================================================================
// Every function here is read-only with respect to the world. If you ever find
// yourself wanting to modify a fish from in here, that logic belongs in
// world.js or fish.js instead. Keeping this boundary clean is what makes the
// "run evolution with the drawing switched off" trick possible in Stage 4.
//
// -----------------------------------------------------------------------------
// A NOTE ON THE VIEW: we are looking straight DOWN at the tank from above.
// That decides all the anatomy below. From above you do not see a belly, you
// see the animal's back; the pectoral fins stick out left and right; and the
// tail beats SIDE TO SIDE - which is the one motion we can actually animate
// here, so the anatomy and the animation agree with each other for free.
//
// Everything is drawn with canvas paths. No images, no sprite sheets, nothing
// to load - which keeps the "double-click index.html and it runs" promise.
// -----------------------------------------------------------------------------
// =============================================================================

const Render = {

  motes: null,   // drifting plankton, for a sense of depth
  t: 0,          // render-local frame counter. NOT simulation state.
  trails: new WeakMap(),
  motions: new WeakMap(),

  // `view` is presentation-only state owned by main.js: which fish the mouse
  // is nearest, and whether to show every fish's rays or just that one's.
  // It is deliberately NOT stored on the world - what you have chosen to look
  // at must never be able to influence what the fish do.
  frame(ctx, world, view) {
    // Plankton drift, tail beats and pulse rings all key off this counter.
    // Freezing it leaves every shape exactly where it is.
    if (typeof REDUCED_MOTION === 'undefined' || !REDUCED_MOTION) this.t++;
    if (!this.motes) this.initMotes(world);

    this.background(ctx, world);
    this.drawMotes(ctx, world);
    this.food(ctx, world);
    this.fishWakes(ctx, world);
    for (const s of world.sharks) this.wake(ctx, s, true);   // one or two: cheap
    if (Schooling.active(world)) this.packs(ctx, world, view);

    // Rays go UNDER the bodies, so the fish stay readable on top of them.
    if (view.showAllRays) {
      for (const f of world.fish) if (f.alive) this.rays(ctx, f, false);
    }
    if (view.focused && view.focused.alive) {
      if (Schooling.active(world)) this.sensorField(ctx, view.focused, world);
      this.rays(ctx, view.focused, true);
      this.wallFeeler(ctx, view.focused);
      if (Schooling.active(world)) this.escapeRoute(ctx, view.focused);
    }

    this.escortLines(ctx, world);
    for (const f of world.fish) if (!f.alive) this.deadFish(ctx, f);
    for (const f of world.fish) if (f.alive) this.fish(ctx, f, view.showLineage, Schooling.active(world));
    this.hungryFish(ctx, world);

    // With nobody under the cursor the brain panel shows a default fish; ring
    // it so it is obvious whose network is on screen.
    if (!view.focused && view.subject && view.subject.alive) this.focusRing(ctx, view.subject);
    if (view.focused && view.focused.alive) {
      this.focusRing(ctx, view.focused);
      this.rudder(ctx, view.focused);
      if (CONFIG.senses.neighbours) this.kinLinks(ctx, view.focused, world);
    }

    for (const c of world.sharkCorpses || []) this.sharkCorpse(ctx, c, world);
    for (const s of world.sharks) this.shark(ctx, s);
    for (const s of world.sharks) if (s.brain) this.hungerRing(ctx, s);
    this.tankEdge(ctx, world);
  },

  // ---------------------------------------------------------------------------
  // THE WATER, DRAWN ONCE.
  // ---------------------------------------------------------------------------
  // MEASURED with 70 fish at devicePixelRatio 2 (real frame intervals, not JS
  // timers - canvas work is rasterised after the script returns): the depth
  // gradient cost ~10ms a frame and the full-screen vignette another ~11ms,
  // more than every fish, ring and wake combined. Neither ever changes. So both
  // are painted once into an offscreen layer at the canvas's own pixel size
  // and copied in with one drawImage. The vignette now sits UNDER the animals
  // instead of over them, which is the only visible difference.
  //
  // Rebuilt whenever the canvas buffer changes size (zoom, another monitor).
  // Without a DOM (the Node tests) it simply draws directly.
  // ---------------------------------------------------------------------------
  background(ctx, world) {
    const cv = ctx.canvas;
    if (typeof document === 'undefined' || !cv || !(cv.width > 0)) {
      this.sea(ctx, world);
      this.vignette(ctx, world);
      return;
    }
    if (!this.bg || this.bg.width !== cv.width || this.bg.height !== cv.height) {
      const layer = document.createElement('canvas');
      layer.width = cv.width;
      layer.height = cv.height;
      const c = layer.getContext('2d');
      c.setTransform(cv.width / world.w, 0, 0, cv.height / world.h, 0, 0);
      this.sea(c, world);
      this.vignette(c, world);
      this.bg = layer;
    }
    ctx.drawImage(this.bg, 0, 0, world.w, world.h);
  },

  // Render-owned history: pausing freezes the wake, and redrawing cannot
  // advance an animal, consume simulation randomness, or alter its fitness.
  trailFor(body) {
    let trail = this.trails.get(body);
    if (!trail) { trail = []; this.trails.set(body, trail); }
    const last = trail[trail.length - 1];
    if (!last || body.age - last.age >= 0.06) {
      trail.push({ x: body.x, y: body.y, age: body.age });
      if (trail.length > 18) trail.shift();
    }
    return trail;
  },

  // ---------------------------------------------------------------------------
  // EVERY FISH WAKE IN FOUR STROKES.
  // ---------------------------------------------------------------------------
  // MEASURED at 70 fish (continuous life, devicePixelRatio 2): wakes cost 19.8ms
  // of a 19.5ms tank render - effectively ALL of it. Each fish drew each of its
  // ~17 segments as its own round-capped stroke, so a full colony issued about
  // 1,200 separate strokes per frame. The page fell to ~11fps and the motion
  // smeared, and the stacked translucent strokes turned the water milky.
  //
  // Segments are now grouped into four freshness bands and every fish's
  // segments in a band go into ONE path: four strokes for the whole school, the
  // same look within a band's resolution.
  // ---------------------------------------------------------------------------
  fishWakes(ctx, world) {
    const BANDS = 4;
    const paths = [];
    for (let b = 0; b < BANDS; b++) paths.push([]);
    for (const f of world.fish) {
      if (!f.alive) continue;
      const trail = this.trailFor(f);
      for (let i = 1; i < trail.length; i++) {
        const freshness = 1 - (f.age - trail[i].age) / 1.2;
        if (freshness <= 0) continue;
        paths[Math.min(BANDS - 1, Math.floor(freshness * BANDS))].push(trail[i - 1], trail[i]);
      }
    }
    ctx.save(); ctx.lineCap = 'round';
    for (let b = 0; b < BANDS; b++) {
      const seg = paths[b];
      if (!seg.length) continue;
      const freshness = (b + 0.5) / BANDS;
      ctx.strokeStyle = 'rgba(148, 238, 224,' + freshness * 0.07 + ')';
      ctx.lineWidth = 3 * freshness;
      ctx.beginPath();
      for (let i = 0; i < seg.length; i += 2) { ctx.moveTo(seg[i].x, seg[i].y); ctx.lineTo(seg[i + 1].x, seg[i + 1].y); }
      ctx.stroke();
    }
    ctx.restore();
  },

  wake(ctx, body, predator) {
    const trail = this.trailFor(body);
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const freshness = Math.max(0, 1 - (body.age - trail[i].age) / 1.2);
      ctx.strokeStyle = predator ? 'rgba(149, 201, 223,' + freshness * 0.12 + ')'
        : 'rgba(148, 238, 224,' + freshness * 0.07 + ')';
      ctx.lineWidth = (predator ? 10 : 3) * freshness;
      ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
    }
    ctx.restore();
  },

  steering(body, turnRate) {
    const previous = this.motions.get(body);
    let turn = previous ? previous.turn : 0;
    if (previous && body.age > previous.age) {
      turn = V.clamp(V.angleDiff(body.heading, previous.heading) / ((body.age - previous.age) * turnRate), -1, 1);
    }
    this.motions.set(body, { age: body.age, heading: body.heading, turn });
    return turn;
  },

  sensorField(ctx, fish, world) {
    const p = fish.socialSense;
    if (!p) return;
    ctx.save(); ctx.beginPath(); ctx.rect(2, 2, world.w - 4, world.h - 4); ctx.clip();
    const tint = fish.isAlpha ? '255, 213, 132' : '98, 214, 236';
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.range);
    glow.addColorStop(0, 'rgba(' + tint + ',0.075)');
    glow.addColorStop(1, 'rgba(' + tint + ',0.008)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, p.range, p.heading - p.halfFov, p.heading + p.halfFov);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(' + tint + ',0.22)'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, p.nearRange, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    const t = fish.threat;
    if (t) {
      // A remembered sighting is drawn at the remembered location. Looking
      // at this overlay does not reveal an unseen predator's current position.
      ctx.strokeStyle = 'rgba(255, 146, 118,' + (0.25 + fish.alarm * 0.6) + ')';
      ctx.setLineDash(fish.directThreat ? [] : [4, 4]);
      ctx.beginPath(); ctx.arc(t.x, t.y, 22, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + Math.cos(t.heading) * 42, t.y + Math.sin(t.heading) * 42); ctx.stroke();
      if (t.via !== undefined) {
        const sender = world.fish.find(f => f.id === t.via && f.alive);
        if (sender && V.dist(fish.x, fish.y, sender.x, sender.y) <= CONFIG.schooling.alarmRange) {
          ctx.beginPath(); ctx.moveTo(fish.x, fish.y); ctx.lineTo(sender.x, sender.y); ctx.stroke();
        }
      }
    }
    ctx.restore();
  },

  escapeRoute(ctx, fish) {
    const plan = fish.escapePlan;
    if (!plan) return;
    ctx.save();
    ctx.strokeStyle = '#ffe4a0'; ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(plan.path[0], plan.path[1]);
    for (let i = 2; i < plan.path.length; i += 2) ctx.lineTo(plan.path[i], plan.path[i + 1]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(plan.path[plan.path.length - 2], plan.path[plan.path.length - 1], 4, 0, Math.PI * 2);
    ctx.stroke(); ctx.restore();
  },

  packs(ctx, world, view) {
    ctx.save();
    for (const p of world.packs) {
      const hue = (p.id * 67 + 135) % 360;
      for (const f of p.members) {
        if (view.focused && view.focused.packId === p.id && f !== p.alpha) {
          ctx.strokeStyle = 'hsla(' + hue + ', 75%, 72%, 0.18)';
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(p.alpha.x, p.alpha.y); ctx.stroke();
        }
        ctx.strokeStyle = 'hsla(' + hue + ', 75%, 72%, 0.4)';
        ctx.lineWidth = f.isAlpha ? 2 : 1;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.isAlpha ? 15 : 10, 0, Math.PI * 2); ctx.stroke();
        if (f.alarm > 0) {
          ctx.strokeStyle = 'rgba(255, 139, 86, ' + (0.25 + f.alarm * 0.6) + ')';
          ctx.beginPath(); ctx.arc(f.x, f.y, f.isAlpha ? 18 : 13, -Math.PI / 2,
            -Math.PI / 2 + f.alarm * Math.PI * 2); ctx.stroke();
        }
      }
      ctx.fillStyle = '#ffe4a0';
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u03b1' + p.id, p.alpha.x, p.alpha.y - 21);
    }
    ctx.restore();
  },

  // ---------------------------------------------------------------------------
  // WATER
  // ---------------------------------------------------------------------------

  sea(ctx, world) {
    const g = ctx.createLinearGradient(0, 0, 0, world.h);
    g.addColorStop(0,    '#0d324a');
    g.addColorStop(0.55, '#082438');
    g.addColorStop(1,    '#03101a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, world.w, world.h);
  },

  // Specks of plankton. They get their own private Rng so their layout is
  // stable between reloads WITHOUT touching the simulation's random stream.
  // If they pulled from world.rng they would shift every fish spawn with them,
  // which would be an absurd way to lose reproducibility.
  initMotes(world) {
    const r = new Rng(9999);
    this.motes = [];
    for (let i = 0; i < 110; i++) {
      this.motes.push({
        x:   r.range(0, world.w),
        y:   r.range(0, world.h),
        rad: r.range(0.5, 1.9),
        amp: r.range(4, 16),
        ph:  r.angle(),
        a:   r.range(0.03, 0.14),
      });
    }
    // Four brightness groups, so 110 specks cost four fills rather than 110.
    for (const m of this.motes) m.band = Math.min(3, Math.floor((m.a - 0.03) / 0.11 * 4));
  },

  drawMotes(ctx) {
    for (let band = 0; band < 4; band++) {
      ctx.fillStyle = 'rgba(180, 235, 255, ' + (0.03 + (band + 0.5) * 0.11 / 4).toFixed(3) + ')';
      ctx.beginPath();
      for (const m of this.motes) {
        if (m.band !== band) continue;
        const x = m.x + Math.sin(this.t * 0.005 + m.ph) * m.amp;
        const y = m.y + Math.cos(this.t * 0.003 + m.ph) * m.amp * 0.5;
        ctx.moveTo(x + m.rad, y);
        ctx.arc(x, y, m.rad, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  },

  // A soft darkening towards the corners, so the middle reads as open water
  // and the edges feel enclosed.
  vignette(ctx, world) {
    const g = ctx.createRadialGradient(
      world.w / 2, world.h / 2, Math.min(world.w, world.h) * 0.25,
      world.w / 2, world.h / 2, Math.max(world.w, world.h) * 0.72
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, world.w, world.h);
  },

  tankEdge(ctx, world) {
    ctx.strokeStyle = 'rgba(96, 186, 222, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, world.w - 2, world.h - 2);
  },

  // ---------------------------------------------------------------------------
  // FISH
  // ---------------------------------------------------------------------------
  // Seen from above: a pointed oval body, two small pectoral fins swept back,
  // a forked tail beating side to side, and an eye on each side of the head.
  //
  // The tail beat uses a CONSTANT frequency with an amplitude that grows with
  // speed. That reads far better than varying the frequency: a coasting fish
  // barely twitches, a sprinting fish thrashes, and neither ever stutters.
  // ---------------------------------------------------------------------------

  fish(ctx, f, lineage, social) {
    // Size comes from the fish, not the config: in continuous mode a newborn
    // is 40% of adult size and grows. Nothing else about the drawing needs
    // to know that.
    const r = f.radius ? f.radius() : CONFIG.fish.radius;
    const young = f.maturity ? f.maturity() : 1;
    const L = r * 3.4;          // nose to tail-base
    const H = r * 1.05;         // half-width of the body

    const speedFrac = f.speed / CONFIG.fish.maxSpeed;
    const phase = f.age * 11 + f.wigglePhase;
    const effort = 0.25 + 0.75 * speedFrac;

    // -----------------------------------------------------------------------
    // A TRAVELLING WAVE, not a single bend.
    // -----------------------------------------------------------------------
    // A real fish does not flex at one hinge. A wave runs from head to tail,
    // arriving later and larger the further back you look - which is exactly
    // what produces thrust, and what the eye recognises as swimming rather
    // than as a shape being wobbled.
    //
    // wave(u) samples that: u is the distance back along the body from 0 at
    // the nose to 1 at the tail stock. The `- u * 2.6` is the phase lag that
    // makes the wave TRAVEL; without it every station moves together and the
    // fish looks like a flapping leaf. The `u * u` grows the amplitude
    // rearward, because a fish's head barely moves and its tail moves a lot.
    //
    // The turn term is added on top and is not part of the wave: that is the
    // body leaning into a turn, which happens at every station at once.
    const amp = H * 0.34 * effort;
    const wave = u => Math.sin(phase - u * 2.6) * amp * u * u + f.lastTurn * H * 0.42 * u;

    const flex = wave(1);                       // where the tail attaches
    const waveMid = wave(0.42);
    const waveRear = wave(0.78);

    // Follow-through: the tail fin trails the body it is attached to rather
    // than pivoting in lockstep with it. Sampling the wave slightly ahead of
    // the joint and taking the difference gives the angle the fin is being
    // dragged through.
    const wag = (wave(1) - wave(0.72)) / H * 1.5 + f.lastTurn * 0.18;

    // Colour says one of three things, in priority order.
    const pressed = f.touchingWall;
    let edge, spine, fin;

    if (pressed) {
      // Amber while pressed against the glass - the visual check that the wall
      // GLIDE works. A fish should turn amber and slide, not ping off.
      edge = '#c98f3a'; spine = '#ffdf9a'; fin = 'rgba(255, 200, 97, 0.8)';

    } else if (social && !lineage && f.pack) {
      const h = (f.packId * 67 + 135) % 360;
      edge = 'hsl(' + h + ', 50%, 32%)';
      spine = 'hsl(' + h + ', 85%, 72%)';
      fin = 'hsla(' + h + ', 75%, 60%, 0.8)';
    } else if (lineage && f.net) {
      // LINEAGE VIEW (Stage 5): every brain carries a hue down its family
      // tree. Clones keep it exactly; a child of two parents gets the blend.
      // So the tank shows you the family tree directly - 60 different colours
      // at generation 1, slowly collapsing towards a few as winners take over.
      // When the whole tank is one colour, variation is gone and so is
      // further improvement.
      const h = f.net.hue.toFixed(0);
      edge  = 'hsl(' + h + ', 50%, 32%)';
      spine = 'hsl(' + h + ', 85%, 72%)';
      fin   = 'hsla(' + h + ', 75%, 60%, 0.8)';

    } else {
      edge = '#2f9d84'; spine = '#9bf5df'; fin = 'rgba(111, 227, 198, 0.8)';
    }

    // Juveniles are washed out - pale, low contrast, visibly unfinished. It
    // reads instantly in a crowded tank, which matters because watching
    // whether the young survive is the entire point of continuous mode.
    if (young < 1) {
      ctx.globalAlpha = 0.6 + 0.4 * young;

      // A ring that shrinks as the fish grows up, so 'how close to adult' is
      // readable at a glance and not just inferred from size. Transparency
      // alone is ambiguous in a crowd - it reads as distance, not as age.
      ctx.strokeStyle = 'rgba(160, 235, 255, ' + (0.5 - 0.35 * young) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r * (4.2 - 1.4 * young), 0, Math.PI * 2);
      ctx.stroke();
    }

    // A contact shadow, small and close. Only the shark had one, which made
    // every fish read as a flat sticker on the water; this settles them into
    // it without competing with the shark's much heavier shadow.
    ctx.fillStyle = 'rgba(0, 20, 32, 0.28)';
    ctx.beginPath();
    ctx.ellipse(f.x + 1.5, f.y + 2.5, r * 2.4, r * 1.1, f.heading, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.heading);

    // BANKING. A turning fish rolls into the turn, so seen from above it
    // presents a narrower silhouette - the harder the turn, the more of the
    // body is edge-on to us. Squashing across the body axis is the whole
    // effect, and it costs one scale() call.
    //
    // It also does real work for the simulation, not just the look: the whole
    // contest here is the fish's 30px turning circle against the shark's 66px,
    // and banking is what makes an evasive break VISIBLE as it happens rather
    // than something you infer afterwards from the path.
    const bank = 1 - 0.34 * Math.min(1, Math.abs(f.lastTurn));
    ctx.scale(1, bank);

    // --- tail, drawn first so the body covers where it joins on ---
    ctx.save();
    ctx.translate(-L * 0.40, flex);
    ctx.rotate(wag);
    ctx.fillStyle = fin;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-L * 0.20, -H * 0.25, -L * 0.34, -H * 1.2);
    ctx.lineTo(-L * 0.18, 0);            // the notch that makes it a FORK
    ctx.quadraticCurveTo(-L * 0.28, H * 0.75, -L * 0.34, H * 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // --- pectoral fins, one each side, swept backwards ---
    ctx.globalAlpha = 0.6; ctx.fillStyle = fin;
    for (const side of [-1, 1]) {
      // Lagging phase: a fin is dragged by the body, it does not lead it.
      const flutter = Math.sin(phase - 1.1 + side * 0.9) * 0.18;
      const spread = 1.7 + flutter - side * f.lastTurn * 0.2;
      ctx.beginPath();
      ctx.moveTo(L * 0.16, side * H * 0.55);
      ctx.quadraticCurveTo(L * 0.02, side * H * spread, -L * (0.12 + flutter * 0.2), side * H * spread);
      ctx.lineTo(-L * 0.10, side * H * 0.50);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // --- body: a lens shape, two curves meeting at nose and tail-base ---
    // The gradient runs ACROSS the body: pale along the spine, darker at the
    // flanks. That is the whole trick that gives a flat silhouette a rounded,
    // three-dimensional look.
    const g = ctx.createLinearGradient(0, -H, 0, H);
    g.addColorStop(0,   edge);
    g.addColorStop(0.5, spine);
    g.addColorStop(1,   edge);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L * 0.60, 0);
    ctx.bezierCurveTo(L * 0.18, -H + waveMid, -L * 0.24, -H * 0.65 + waveRear, -L * 0.40, flex);
    ctx.bezierCurveTo(-L * 0.24, H * 0.65 + waveRear, L * 0.18, H + waveMid, L * 0.60, 0);
    ctx.closePath();
    ctx.fill();

    // A moving highlight follows the spine rather than sliding over the fish.
    ctx.strokeStyle = 'rgba(231, 255, 249, 0.38)'; ctx.lineWidth = 0.65;
    ctx.beginPath(); ctx.moveTo(L * 0.36, -H * 0.1);
    ctx.quadraticCurveTo(-L * 0.05, waveMid * 0.7, -L * 0.30, waveRear); ctx.stroke();

    // --- eyes, with a glint ---
    // The glint sits on a fixed side of the eye rather than tracking anything,
    // which reads as a wet surface catching the same light everywhere. Tiny,
    // and it is most of what stops the fish looking like a paper cut-out.
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#04121c';
      ctx.beginPath();
      ctx.arc(L * 0.34, side * H * 0.42, r * 0.20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.arc(L * 0.36, side * H * 0.42 - r * 0.06, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  },

  // ---------------------------------------------------------------------------
  // FOOD, and who is running out of it (CONFIG.hunger).
  // ---------------------------------------------------------------------------
  // Forty pellets in ONE path and one fill: drawing them one by one is forty
  // separate rasterisations a frame for dots two pixels across.
  food(ctx, world) {
    if (!world.food || !world.food.length) return;
    const r = CONFIG.hunger.pelletRadius * 0.7;
    ctx.save();
    ctx.fillStyle = 'rgba(170, 225, 110, 0.85)';
    ctx.beginPath();
    for (const p of world.food) { ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); }
    ctx.fill();
    ctx.restore();
  },

  // A fish below a third of its energy gets a thin amber arc showing how much
  // is left - the same idea as the shark's hunger ring, sized for a fish.
  hungryFish(ctx, world) {
    if (!CONFIG.hunger.enabled) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 176, 64, 0.85)';
    ctx.beginPath();
    for (const f of world.fish) {
      if (!f.alive || f.energy >= 0.33) continue;
      const r = (f.radius ? f.radius() : CONFIG.fish.radius) * 2.4;
      ctx.moveTo(f.x, f.y - r);
      ctx.arc(f.x, f.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (f.energy / 0.33));
    }
    ctx.stroke();
    ctx.restore();
  },

  // A corpse: same silhouette, drained of colour, tail stilled. Left on screen
  // as a map of WHERE fish die - watch where these cluster, it tells you what
  // evolution is actually up against. A fish that STARVED is tinted amber, so
  // the two ways to die can be told apart at a glance.
  deadFish(ctx, f) {
    const r = f.radius ? f.radius() : CONFIG.fish.radius;
    const L = r * 3.0, H = r * 0.95;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.heading);
    ctx.fillStyle = f.starved ? 'rgba(255, 190, 110, 0.16)' : 'rgba(200, 225, 235, 0.10)';
    ctx.beginPath();
    ctx.moveTo(L * 0.60, 0);
    ctx.quadraticCurveTo(L * 0.05, -H, -L * 0.40, 0);
    ctx.quadraticCurveTo(L * 0.05,  H,  L * 0.60, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  // ---------------------------------------------------------------------------
  // SHARK
  // ---------------------------------------------------------------------------
  // Longer, heavier, and deliberately in a different colour family from the
  // fish so you can never lose track of it in a crowded tank. Same top-down
  // anatomy: pointed snout, big swept pectorals, a dorsal ridge along the
  // spine, gill slits, and an asymmetric crescent tail whose upper lobe is
  // longer - the real giveaway that something is a shark and not a big fish.
  //
  // Its tail beats SLOWER than a fish (6.5 against 11). Large animals move at
  // lower frequencies, and it makes the shark read as heavy rather than
  // frantic, which is exactly the threat we want it to project.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // THE SURVIVAL INSTINCT, MADE VISIBLE. A ring around a brained shark that
  // drains as its starvation clock runs: full and green just after a meal,
  // short and red when it is about to die. Brainless sharks never starve and
  // get no ring.
  // ---------------------------------------------------------------------------
  hungerRing(ctx, s) {
    const left = V.clamp(1 - s.hunger / CONFIG.sharkBrain.starveSeconds, 0, 1);
    const r = CONFIG.shark.radius * 2.6;
    const hue = Math.round(120 * left);                  // 120 green -> 0 red
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 23, 34, 0.55)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'hsla(' + hue + ', 85%, 58%, 0.9)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    ctx.stroke();
    ctx.restore();
  },

  // A starved shark lies where it died, drained of colour, fading out while
  // its replacement is on the way.
  sharkCorpse(ctx, c, world) {
    const since = world.time - c.diedAt;
    const fade = V.clamp(1 - since / (CONFIG.sharkBrain.respawnSeconds + 2.5), 0, 1);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = 0.55 * fade;
    ctx.filter = 'grayscale(1)';
    this.shark(ctx, c);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#ffb4c0';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('starved', c.x, c.y - CONFIG.shark.radius * 2.2);
    ctx.restore();
  },

  shark(ctx, s) {
    const r = CONFIG.shark.radius;
    const L = r * 3.1;
    const H = r * 0.92;
    const phase = s.age * 6.5;
    const steering = this.steering(s, CONFIG.shark.turnRate);
    const wag = Math.sin(phase - 0.7) * 0.40 + steering * 0.15;
    const flex = Math.sin(phase) * H * 0.2 + steering * H * 0.35;

    ctx.save();
    ctx.translate(s.x, s.y);

    // A soft shadow beneath it. The fish deliberately do not get one - only
    // the shark - so the threat reads instantly even among sixty other bodies.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(3, 4, L * 0.55, H * 1.3, s.heading, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(s.heading);

    // The shark banks as well, but less: it is the heavier animal and its
    // 66px turning circle is exactly the weakness the fish exploit, so it
    // should read as committing to a turn rather than flicking through one.
    ctx.scale(1, 1 - 0.20 * Math.min(1, Math.abs(steering)));

    // --- crescent tail, upper lobe clearly longer ---
    ctx.save();
    ctx.translate(-L * 0.46, flex);
    ctx.rotate(wag);
    ctx.fillStyle = 'rgba(158, 54, 76, 0.92)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-L * 0.14, -H * 0.5, -L * 0.30, -H * 1.75);
    ctx.quadraticCurveTo(-L * 0.30, -H * 0.55, -L * 0.13, -H * 0.15);
    ctx.quadraticCurveTo(-L * 0.30, H * 0.45, -L * 0.27, H * 1.15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // --- pectoral fins: big, swept, the silhouette signature ---
    ctx.fillStyle = 'rgba(176, 62, 86, 0.85)';
    for (const side of [-1, 1]) {
      const lift = Math.sin(phase * 0.5 + side) * 0.08 - side * steering * 0.2;
      ctx.beginPath();
      ctx.moveTo(L * 0.10, side * H * 0.72);
      ctx.quadraticCurveTo(-L * 0.02, side * H * (1.9 + lift), -L * 0.18, side * H * (2.05 + lift));
      ctx.lineTo(-L * 0.20, side * H * 0.66);
      ctx.closePath();
      ctx.fill();
    }

    // --- body ---
    const g = ctx.createLinearGradient(0, -H, 0, H);
    g.addColorStop(0,   '#8e2f45');
    g.addColorStop(0.5, '#f2879a');
    g.addColorStop(1,   '#8e2f45');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L * 0.62, 0);                                    // snout
    ctx.quadraticCurveTo(L * 0.22, -H, -L * 0.16, -H * 0.60);
    ctx.quadraticCurveTo(-L * 0.36, -H * 0.30 + flex * 0.6, -L * 0.46, flex);   // tail stock
    ctx.quadraticCurveTo(-L * 0.36, H * 0.30 + flex * 0.6, -L * 0.16, H * 0.60);
    ctx.quadraticCurveTo(L * 0.22,   H, L * 0.62, 0);
    ctx.closePath();
    ctx.fill();

    // --- dorsal ridge: from above the fin is edge-on, a blade on the spine ---
    ctx.fillStyle = 'rgba(122, 36, 54, 0.95)';
    ctx.beginPath();
    ctx.moveTo(L * 0.08, 0);
    ctx.quadraticCurveTo(-L * 0.06, -H * 0.24 + steering * H * 0.1, -L * 0.26, flex * 0.45);
    ctx.quadraticCurveTo(-L * 0.06,  H * 0.24, L * 0.08, 0);
    ctx.closePath();
    ctx.fill();

    // --- gill slits ---
    ctx.strokeStyle = 'rgba(90, 26, 40, 0.75)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 4; i++) {
      const x = L * 0.30 - i * L * 0.055;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, side * H * 0.30);
        ctx.lineTo(x - L * 0.02, side * H * 0.66);
        ctx.stroke();
      }
    }

    // --- eyes ---
    ctx.fillStyle = '#1a0308';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(L * 0.42, side * H * 0.44, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  },

  // ---------------------------------------------------------------------------
  // SENSES MADE VISIBLE
  // ---------------------------------------------------------------------------
  // This is the entire point of Stage 1. The seven numbers in fish.senses are
  // what the brain will eventually see, and nothing else. Drawing them means
  // that when a fish later behaves stupidly you can look at what it was
  // actually perceiving instead of guessing.
  //
  // A ray that sees nothing is drawn faint and cyan, at full length.
  // A ray that hits the shark is drawn red, THICKER and BRIGHTER the closer
  // the contact, and stops dead at the point of contact.
  // ---------------------------------------------------------------------------

  rays(ctx, f, strong) {
    const range = CONFIG.senses.range;
    const pose = f.sensorPose || f;

    for (let i = 0; i < CONFIG.senses.rayCount; i++) {
      const a   = pose.heading + Senses.rayOffset(i);
      const hit = f.rayHit[i];
      const s   = f.senses[i];                  // 0..1, how close the contact
      const len = hit < 0 ? range : hit;

      const ex = pose.x + Math.cos(a) * len;
      const ey = pose.y + Math.sin(a) * len;

      // Each ray is drawn as a GRADIENT rather than a flat line, bright at the
      // fish and fading outwards. That is not decoration: the sense value is
      // 1 - distance/range, so a contact far away really does contribute
      // almost nothing to the network. The fade is the number made visible.
      const grad = ctx.createLinearGradient(pose.x, pose.y, ex, ey);

      if (hit < 0) {
        const head = strong ? 0.22 : 0.07;
        grad.addColorStop(0, 'rgba(130, 220, 255, ' + head + ')');
        grad.addColorStop(1, 'rgba(130, 220, 255, 0)');
        ctx.lineWidth = 1;
      } else {
        const alpha = strong ? 0.5 + 0.5 * s : 0.2 + 0.4 * s;
        const warm = 'rgba(255, ' + Math.round(160 - 120 * s) + ', ' +
                     Math.round(120 - 90 * s) + ', ';
        grad.addColorStop(0, warm + (alpha * 0.55) + ')');
        grad.addColorStop(1, warm + alpha + ')');   // brightest AT the contact
        ctx.lineWidth = 1 + 2.4 * s;
      }
      ctx.strokeStyle = grad;

      ctx.beginPath();
      ctx.moveTo(pose.x, pose.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // A bright pip exactly where the ray met the shark.
      if (hit >= 0 && strong) {
        // A pip at the exact point of contact, with a ring that pulses faster
        // and wider the closer the contact is. Urgency you can see without
        // reading the number.
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 0.25 + s * 6);
        ctx.strokeStyle = 'rgba(255, 190, 120, ' + (0.15 + 0.4 * s) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ex, ey, 3 + 5 * s * pulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 235, 160, 0.95)';
        ctx.beginPath();
        ctx.arc(ex, ey, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  // The wall feeler: a dashed amber line from the nose to the glass it is
  // about to meet. Only drawn once the fish can actually feel something, so
  // its appearance tells you the exact moment sense [5] leaves zero.
  wallFeeler(ctx, f) {
    const v = f.senses[Senses.WALL];
    if (v <= 0) return;

    const len = (1 - v) * CONFIG.senses.wallRange;
    const pose = f.sensorPose || f;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 200, 97, ' + (0.25 + 0.6 * v) + ')';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pose.x, pose.y);
    ctx.lineTo(pose.x + Math.cos(pose.heading) * len, pose.y + Math.sin(pose.heading) * len);
    ctx.stroke();
    ctx.restore();
  },

  // A ring around whichever fish the mouse is nearest, so you know which one
  // the readout panel is describing.
  focusRing(ctx, f) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(f.x, f.y, (f.radius ? f.radius() : CONFIG.fish.radius) * 3.1, 0, Math.PI * 2);
    ctx.stroke();
  },

  // The steering command, drawn as an arc sweeping from the nose in whichever
  // direction the neuron has decided to turn, as far as it is turning hard.
  // This is the neuron's single output made visible - when the panel says
  // turn = -0.68, this is what -0.68 looks like.
  rudder(ctx, f) {
    const out = f.lastTurn;
    if (Math.abs(out) < 0.02) return;

    const rad = (f.radius ? f.radius() : CONFIG.fish.radius) * 4.6;
    const a0 = f.heading;
    const a1 = f.heading + out * 1.15;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, rad, Math.min(a0, a1), Math.max(a0, a1));
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(f.x + Math.cos(a1) * rad, f.y + Math.sin(a1) * rad, 2.6, 0, Math.PI * 2);
    ctx.fill();
  },
  // Stage 8: faint threads to every fish the focused one can currently feel.
  // Drawn only for the focused fish - sixty fish worth of threads would be an
  // unreadable web. Brightness tracks closeness, which is exactly what the
  // three "kin" senses are made of.
  kinLinks(ctx, f, world) {
    const range = CONFIG.senses.neighbourRange;

    for (const other of world.fish) {
      if (other === f || !other.alive) continue;
      const d = V.dist(f.x, f.y, other.x, other.y);
      if (d > range) continue;

      const closeness = 1 - d / range;
      ctx.strokeStyle = 'rgba(150, 230, 255, ' + (0.06 + 0.34 * closeness) + ')';
      ctx.lineWidth = 0.5 + closeness;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(other.x, other.y);
      ctx.stroke();
    }
  },
  // Stage: continuous life. A line from a guarding adult to the juvenile it is
  // screening. This is the one behaviour in the whole simulation that exists
  // purely to keep somebody ELSE alive, and without drawing it there is no way
  // to tell an escorting adult from one that happens to be swimming nearby.
  escortLines(ctx, world) {
    if (!CONFIG.life.continuous) return;

    for (const f of world.fish) {
      if (!f.alive || f.escorting === null || f.escorting === undefined) continue;
      // escorting holds an ID, not an array index. Births make those diverge,
      // so it has to be looked up rather than indexed.
      const ward = world.fish.find(o => o.id === f.escorting);
      if (!ward || !ward.alive) continue;

      ctx.strokeStyle = f.isAlpha ? 'rgba(255, 213, 132, 0.35)'
                                  : 'rgba(150, 230, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(ward.x, ward.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  },
};
