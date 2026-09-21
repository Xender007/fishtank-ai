// =============================================================================
// main.js - the loop that drives everything, plus the bits you interact with.
// =============================================================================

const canvas = document.getElementById('sea');
const ctx = canvas.getContext('2d');


const chartCanvas = document.getElementById("chart");
const chartCtx = chartCanvas.getContext("2d");

// -----------------------------------------------------------------------------
// SHARP CANVASES
// -----------------------------------------------------------------------------
// A canvas has two sizes: how big it IS (width/height, the pixel buffer) and how
// big it LOOKS (CSS). If the buffer is 900 pixels and the screen paints it
// across 900 *CSS* pixels on a display with 1.5 or 2 device pixels per CSS
// pixel, the browser upscales it - and everything goes soft. Text suffers worst,
// which is why the neuron labels looked smudged.
//
// So the buffer is sized in DEVICE pixels, the element is pinned to the logical
// size in CSS pixels, and the context is pre-scaled by the ratio. Every drawing
// routine then keeps working in logical coordinates and knows nothing about any
// of this.
// -----------------------------------------------------------------------------
// `displayW` is how wide the canvas should LOOK, in CSS pixels. The drawing
// code never finds out: it keeps working in its logical w x h, and the context
// transform absorbs both the display scale and the device pixel ratio. That is
// how the tank can fill the window while the simulation stays 900 x 600 inside
// - no physics number, trained brain or measurement changes with screen size.
//
// `maxPixels` caps the buffer. A tank blown up to 1400px on a 2x display would
// be a 5.6-megapixel canvas redrawn every frame; beyond the cap the buffer
// stops growing and the browser scales the last bit, which costs a little
// sharpness instead of the frame rate (see the ecosystem-mode measurements).
function fitCanvas(cv, ctx, w, h, displayW, maxPixels) {
  const dw = Math.max(1, Math.round(displayW || w));
  const dh = Math.round(dw * h / w);
  let ratio = window.devicePixelRatio || 1;
  if (maxPixels && dw * dh * ratio * ratio > maxPixels) ratio = Math.sqrt(maxPixels / (dw * dh));
  const bw = Math.round(dw * ratio), bh = Math.round(dh * ratio);
  if (cv.width !== bw || cv.height !== bh || cv.style.width !== dw + 'px') {
    cv.style.width = dw + 'px';
    cv.style.height = dh + 'px';
    cv.width = bw;
    cv.height = bh;
  }
  // setTransform, not scale: this runs again on resize and must not compound.
  ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0);
}

// Logical sizes. Everything downstream draws against these, never against
// canvas.width, which is now a device-pixel count.
const VIEW_SIZE = {
  sea:   { w: CONFIG.tank.w, h: CONFIG.tank.h },
  chart: { w: CONFIG.tank.w, h: 236 },
  brain: { w: 408, h: 452 },
  sharkBrain: { w: 470, h: 430 },
};

// Moving the window between monitors with different pixel densities changes
// devicePixelRatio, so the buffers have to be rebuilt or the page goes soft
// again.
// Someone who has asked their system for reduced motion should not be handed
// a tank of swimming fish, travelling signal pulses and breathing halos. The
// canvas work is not CSS, so it has to check the query itself.
const REDUCED_MOTION = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// -----------------------------------------------------------------------------
// LAYOUT - every canvas sized to the box the page gives it.
// -----------------------------------------------------------------------------
// The tank gets the largest 3:2 rectangle that fits its column on the first
// screen; the side canvases simply take their container's width. Each
// container's size comes from the CSS grid, never from the canvas inside it,
// so resizing a canvas can never feed back into another resize.
function contentWidth(el) {
  const cs = getComputedStyle(el);
  return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

function fitAllCanvases() {
  // The sticky header's real height, so the first screen is exactly the tank.
  const top = document.getElementById('topbar');
  if (top) document.documentElement.style.setProperty('--header-h', top.offsetHeight + 'px');

  const wrap = document.getElementById('tankwrap');
  const s = VIEW_SIZE.sea;
  const scale = wrap ? Math.max(0.3, Math.min(wrap.clientWidth / s.w, wrap.clientHeight / s.h)) : 1;
  fitCanvas(canvas, ctx, s.w, s.h, s.w * scale, 4.2e6);

  // The chart and the two brain diagrams are NOT magnified - scaling them up
  // just made their text huge. Their draw functions take a width, so they get
  // a real, wider logical canvas and lay themselves out across it at normal
  // text size. Hit-testing reads VIEW_SIZE, so it follows automatically.
  const widen = (id, size, min) => {
    const el = document.getElementById(id);
    if (el) size.w = Math.max(min, Math.floor(contentWidth(el)));
  };
  widen('chartcard', VIEW_SIZE.chart, 320);
  fitCanvas(chartCanvas, chartCtx, VIEW_SIZE.chart.w, VIEW_SIZE.chart.h);
  if (typeof brainCanvas !== 'undefined') {
    widen('brainwrap', VIEW_SIZE.brain, 300);
    fitCanvas(brainCanvas, brainCtx, VIEW_SIZE.brain.w, VIEW_SIZE.brain.h);
  }
  if (typeof sharkCanvas !== 'undefined') {
    widen('sharkbrainwrap', VIEW_SIZE.sharkBrain, 300);
    fitCanvas(sharkCanvas, sharkCtx, VIEW_SIZE.sharkBrain.w, VIEW_SIZE.sharkBrain.h);
  }
}

// One refit per animation frame at most, however many resize events arrive.
let fitQueued = false;
function queueFit() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => { fitQueued = false; fitAllCanvases(); });
}
window.addEventListener('resize', queueFit);
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(queueFit);
  for (const id of ['tankwrap', 'chartcard', 'brainwrap', 'sharkbrainwrap', 'topbar']) {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  }
}


// Taller than before: the chart now carries two stacked panels (survival and
// brain size) sharing one x-axis, rather than two y-scales on one panel.


// Pointer position over the chart, in canvas pixels. Chart.draw() reads it to
// place the crosshair and tooltip. This is view state, so it lives here.
chartCanvas.addEventListener('mousemove', (e) => {
  const r = chartCanvas.getBoundingClientRect();
  Chart.hover = (e.clientX - r.left) * (VIEW_SIZE.chart.w / r.width);
});
chartCanvas.addEventListener('mouseleave', () => { Chart.hover = null; });

const world = new World();

// -----------------------------------------------------------------------------
// VIEW STATE - what you are looking at, NOT part of the simulation.
// -----------------------------------------------------------------------------
// This lives here and not on the world, on purpose. Where your mouse happens
// to be must never be able to influence how a fish behaves; if it could, no
// run would ever be reproducible.
//
// Compare world.brainOn, which DOES live on the world - because unlike the
// cursor, it genuinely changes what the fish do. The test is simple: does it
// change the simulation, or only the picture?
// -----------------------------------------------------------------------------
const view = {
  focused: null,        // the fish nearest the cursor
  showAllRays: false,   // 'v' toggles every fish's rays at once
  showLineage: false,   // default: pack colours. 'l' switches to genetic lineage
  pinned: null,         // a fish clicked in the tank, so the panel stays put
  selectedNode: null,   // a neuron clicked in the brain view
  revealDepth: -1,      // step-through: -1 = whole network at once
};

// How many simulated seconds pass per real second. Evolution needs a LOT of
// simulated time, and watching 30-second generations at 1x would mean sitting
// through 25 minutes to reach generation 50. Because the timestep is fixed,
// running 50x drains 50 times as many identical 1/60s slices - so the outcome
// is exactly the same as watching it slowly, just not in real time.
let speed = 1;
const SPEEDS = [1, 5, 20, 100];
// How long the simulation may run inside one animation frame, in milliseconds.
//
// This used to be a STEP ceiling of 4000, which is the wrong unit. A step costs
// whatever it costs - 45 fish, nine rays each, a schooling planner - so a fixed
// step count means the time per frame swings with the tank, and at high speed
// the frame took longer than a frame. The page then rendered at 20-30fps and
// the motion smeared.
//
// Budgeting TIME keeps the frame rate steady no matter what the speed control
// says: the simulation simply gets through as many steps as it can in the slice
// it is given, and the picture stays smooth. At 9ms there is comfortable room
// left in a 16.7ms frame for drawing the sea, the chart and the brain.
const FRAME_BUDGET_MS = 9;

// ---------------------------------------------------------------------------
// ACTUAL versus REQUESTED speed
// ---------------------------------------------------------------------------
// Asking for 100x does not create throughput. MEASURED on this simulation:
//
//   45 fish with the schooling planner     231 ticks/s  ->   3.9x
//   45 fish without it                    6045 ticks/s  -> 100.8x
//
// The hand-written planner - pack organisation, alarm relay and a
// short-horizon route search per fish - costs about 26 times the neural
// network it wraps. So the speed buttons are a REQUEST, and the number
// beside them is what was actually achieved. A control that silently fails
// to do what it says is worse than no control.
// ---------------------------------------------------------------------------
let ticksThisSecond = 0;
let speedWindowStart = performance.now();
let actualSpeed = 0;

let lastGeneration = 1;
let paused = false;
let lastTime = performance.now();
let accumulator = 0;          // the bucket that real time pours into

// -----------------------------------------------------------------------------
// THE FIXED-TIMESTEP LOOP
// -----------------------------------------------------------------------------
// Real elapsed time goes into `accumulator`. We then drain it in exact 1/60
// second portions. The physics NEVER sees a variable dt, so:
//
//   - a stuttering frame changes nothing about how the fish behave,
//   - the same seed produces the same run on a 60Hz laptop and a 144Hz monitor,
//   - and in Stage 4 we can drain 50 portions per frame to fast-forward
//     evolution without altering the outcome by a single pixel.
// -----------------------------------------------------------------------------
function frame(now) {
  let elapsed = (now - lastTime) / 1000;
  lastTime = now;

  // Guard against the "spiral of death": if you alt-tab away for 30 seconds,
  // elapsed comes back as 30, we would try to run 1800 physics steps in one
  // frame, that takes longer than a frame, which makes the next elapsed value
  // bigger still... and the page locks up. So we simply refuse to care about
  // more than a quarter second of missed time. Dropped time beats a freeze.
  if (elapsed > 0.25) elapsed = 0.25;

  // Reduced motion holds the simulation at a fixed frame. The page still
  // works - every readout, the brain diagram, the arithmetic - it simply
  // does not move unless the reader asks it to with the step key.
  if (!paused && !REDUCED_MOTION) {
    accumulator += elapsed * speed;

    const until = performance.now() + FRAME_BUDGET_MS;
    let steps = 0;
    while (accumulator >= CONFIG.sim.dt) {
      world.update(CONFIG.sim.dt);       // the ONLY place the sim advances
      accumulator -= CONFIG.sim.dt;
      // Check the clock every few steps rather than every step: performance.now()
      // is not free, and calling it 4000 times a frame would itself become the
      // cost we are trying to control.
      ticksThisSecond++;
      // Every step, not every 16th. MEASURED: at 70 fish one tick costs ~1ms,
      // so checking every 16 steps let a "9ms" budget run to 16ms or more
      // before the first check. performance.now() costs microseconds.
      steps++;
      if (performance.now() >= until) break;
    }

    // Whatever could not be simulated inside the budget is dropped rather than
    // queued. Carrying it forward would make the next frame slower still - the
    // spiral of death, one level up.
    if (accumulator >= CONFIG.sim.dt) accumulator = 0;
  }

  // The shark teaches itself in the gaps: a few milliseconds of evaluation
  // tanks per frame, never touching the visible world. It pauses with the page,
  // and it gives way whenever the last frame was already slow - the tank you
  // are watching comes first, background training second.
  const lastFrameMs = now - (frame.prev || now);
  frame.prev = now;
  sharkState.yielding = lastFrameMs >= 26;
  if (!paused && sharkState.training && !sharkState.yielding) {
    try { ensureSharkTrainer().runFor(CONFIG.sharkBrain.train.pageBudgetMs); }
    catch (err) { sharkState.training = false; syncSharkControls(); reportUiError(err); }
  }

  // Sample the achieved rate about once a second. 60 ticks is one simulated
  // second, so ticks-per-second divided by 60 is the real multiplier.
  const sinceSample = now - speedWindowStart;
  if (sinceSample >= 1000) {
    actualSpeed = (ticksThisSecond / (sinceSample / 1000)) / 60;
    ticksThisSecond = 0;
    speedWindowStart = now;
  }

  // A generation just completed: keep its champion in browser storage, so a
  // refresh no longer throws away everything the fish learned.
  if (world.generation !== lastGeneration) {
    lastGeneration = world.generation;
    Persist.autosave(world);
  }
  // ---------------------------------------------------------------------------
  // DRAWING IS FENCED OFF FROM THE SIMULATION.
  // ---------------------------------------------------------------------------
  // A single exception anywhere below used to abort frame() before it reached
  // requestAnimationFrame at the bottom - which killed the loop after ONE
  // frame and froze the whole tank. The simulation was perfectly healthy; a
  // readout panel had thrown.
  //
  // So presentation now runs inside a fence. If it breaks, the fish keep
  // swimming and the error is reported loudly in the HUD instead of silently
  // stopping time. Note this is NOT swallowing the error: it is shown, and
  // logged once, precisely so it cannot hide.
  // ---------------------------------------------------------------------------
  try {
    refreshFocus();
    Render.frame(ctx, world, view);      // the ONLY place we draw
    Chart.draw(chartCtx, world, VIEW_SIZE.chart.w, VIEW_SIZE.chart.h);
    updateHud();
    updateSensePanel();
    updateBrainView();
    updateArithmetic();
    updateMutationLog();
    updateTrainingNote();
    updateSharkPanel();
  } catch (err) {
    reportUiError(err);
  }

  requestAnimationFrame(frame);
}


// Show a presentation error once, where it cannot be missed, without stopping
// the simulation.
let uiErrorShown = false;
function reportUiError(err) {
  if (uiErrorShown) return;
  uiErrorShown = true;
  console.error('drawing error (simulation is still running):', err);
  const el = document.getElementById('paused');
  if (el) {
    el.textContent = 'DRAW ERROR: ' + err.message + ' (see console)';
    el.style.visibility = 'visible';
    el.style.color = '#ff8095';
  }
}

// -----------------------------------------------------------------------------
// MOUSE FOCUS - whichever living fish is nearest the cursor gets inspected.
// -----------------------------------------------------------------------------
const mouse = { x: 0, y: 0, inside: false };

canvas.addEventListener('mousemove', (e) => {
  // The canvas is 900px internally but CSS may display it smaller, so the
  // cursor position has to be scaled from screen pixels into tank pixels.
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (VIEW_SIZE.sea.w / r.width);
  mouse.y = (e.clientY - r.top)  * (VIEW_SIZE.sea.h / r.height);
  mouse.inside = true;
});
canvas.addEventListener('mouseleave', () => { mouse.inside = false; });

function refreshFocus() {
  if (view.pinned && view.pinned.alive) { view.focused = view.pinned; return; }
  if (view.pinned) view.pinned = null;            // it got eaten
  view.focused = mouse.inside ? world.nearestLivingFish(mouse.x, mouse.y) : null;
  view.subject = view.focused || defaultSubject();
}

// The brain panel should never sit empty. With no fish under the cursor it
// shows the scout of the largest pack (or any living fish), marked in the tank
// with a ring so it is clear whose brain is on screen.
function defaultSubject() {
  let best = null;
  for (const p of world.packs || []) {
    if (p.alpha && p.alpha.alive && (!best || p.members.length > best.members.length)) best = p;
  }
  if (best) return best.alpha;
  for (const f of world.fish) if (f.alive) return f;
  return null;
}
function brainSubject() { return view.focused || view.subject || null; }

// Format a number the way an arithmetic sheet would: always show the sign, so
// columns line up and a negative never hides.
function signed(n, places) {
  const s = n.toFixed(places === undefined ? 2 : places);
  return (n >= 0 ? '+' : '') + s;
}

// -----------------------------------------------------------------------------
// THE SENSE READOUT - the seven inputs, live.
// -----------------------------------------------------------------------------
const senseRows = [];

function buildSensePanel() {
  const host = document.getElementById('senses');
  const labels = Senses.labels();

  labels.forEach((label, i) => {
    const row   = document.createElement('div');
    const name  = document.createElement('span');
    const track = document.createElement('div');
    const bar   = document.createElement('div');
    const val   = document.createElement('span');

    row.className = 'sense';
    name.className = 'sense-name';
    track.className = 'sense-track';
    val.className = 'sense-val';
    // Colour-coded by what the sense IS: vision red, wall amber, speed teal.
    bar.className = 'sense-bar ' +
      (i === Senses.WALL ? 'is-wall' : i === Senses.SPEED ? 'is-speed' : 'is-ray');

    name.textContent = label;
    val.textContent = '0.00';

    track.appendChild(bar);
    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);
    host.appendChild(row);

    senseRows.push({ row, bar, val });
  });
}

function updateSensePanel() {
  const f = brainSubject();
  const social = typeof Schooling !== 'undefined' && Schooling.active(world);

  // Each line hides itself when it has nothing to say - an empty element
  // still draws its card border, which left a column of blank boxes.
  document.getElementById('perception-note').textContent = f && social && f.socialSense
    ? 'Vision ' + f.socialSense.range + 'px · close sense ' + f.socialSense.nearRange + 'px' +
      (f.threat ? ' · sighting ' + Math.max(0, world.time - f.threat.seenAt).toFixed(2) + 's old'
                : ' · no known threat')
    : '';
  document.getElementById('plan-note').textContent = f && social && f.escapePlan
    ? f.escapePlan.manoeuvre + ' · ' + f.escapePlan.seconds.toFixed(2) + 's planned ahead'
    : '';
  document.getElementById('social-note').textContent = f && social && f.pack
    ? 'Pack ' + f.packId + ' · ' + f.pack.members.length + ' fish · ' +
      (f.isAlpha ? 'alpha scout' : 'follower') +
      (f.threat ? ' · alarm ' + Math.round(f.alarm * 100) + '%' : '') +
      ' · turn ' + f.lastTurn.toFixed(2) + ' · thrust ' + f.lastThrust.toFixed(2)
    : '';
  document.getElementById('focus-note').textContent =
    !f ? 'no fish alive'
      : view.focused ? (view.pinned ? 'pinned fish' : 'reading the ringed fish')
      : 'showing ' + (f.isAlpha ? 'α' + f.packId + ' (scout)' : 'a fish') + ' · hover or click another';

  for (let i = 0; i < senseRows.length; i++) {
    const v = f ? f.senses[i] : 0;
    senseRows[i].bar.style.width = (v * 100).toFixed(1) + '%';
    senseRows[i].val.textContent = v.toFixed(2);
    // Most senses sit at zero most of the time. Dimming them is what makes
    // the one or two carrying signal findable at a glance.
    senseRows[i].row.classList.toggle('quiet', Math.abs(v) < 0.005);
  }
}

// -----------------------------------------------------------------------------
// THE BRAIN INSPECTOR (Stage 6)
// -----------------------------------------------------------------------------
const brainCanvas = document.getElementById('brain');
const brainCtx = brainCanvas.getContext('2d');
// Bolder than the default: see BrainView.emphasis.
BrainView.emphasis = 1.6;


// Clicking the sea PINS a fish, so the panel stops following your cursor and
// you can study one brain while it swims. Click open water to unpin.
canvas.addEventListener('click', () => {
  if (!mouse.inside) return;
  const near = world.nearestLivingFish(mouse.x, mouse.y);
  const far = !near || V.dist(mouse.x, mouse.y, near.x, near.y) > 60;
  view.pinned = far ? null : near;
  view.selectedNode = null;
});

// Clicking a neuron selects it, and the arithmetic panel shows its working.
brainCanvas.addEventListener('click', (e) => {
  const r = brainCanvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (VIEW_SIZE.brain.w / r.width);
  const y = (e.clientY - r.top) * (VIEW_SIZE.brain.h / r.height);
  const hit = BrainView.hitTest(x, y);
  if (hit !== null) view.selectedNode = hit;
});

// Hover feeds the tooltip: node -> name, activation, bias; edge -> weight and
// whether the gene is enabled. Thickness alone is an impression, not a number.
brainCanvas.addEventListener('mousemove', (e) => {
  const r = brainCanvas.getBoundingClientRect();
  BrainView.hover = {
    x: (e.clientX - r.left) * (VIEW_SIZE.brain.w / r.width),
    y: (e.clientY - r.top) * (VIEW_SIZE.brain.h / r.height),
  };
});
brainCanvas.addEventListener('mouseleave', () => { BrainView.hover = null; });

function updateBrainView() {
  const f = brainSubject();
  document.getElementById('brainwrap').classList.toggle('idle', !f || !f.net);
  if (!f || !f.net) return;

  BrainView.draw(brainCtx, f.net, VIEW_SIZE.brain.w, VIEW_SIZE.brain.h, {
    revealDepth: view.revealDepth,
    selectedId: view.selectedNode,
  });

  // Memory edges get their own count: they are a different KIND of
  // parameter. A brain with loops can hold state between ticks; one
  // without can only react to the instant it is in.
  const mem = f.net.memoryCount ? f.net.memoryCount() : 0;
  document.getElementById('brainmeta').textContent =
    f.net.paramCount() + ' params · ' + f.net.hiddenCount() + ' hidden' +
    (mem ? ' · ' + mem + ' memory' : ' · no memory') +
    (view.revealDepth >= 0 ? ' · step ' + view.revealDepth : '');
}

// -----------------------------------------------------------------------------
// THE ARITHMETIC - one neuron's working, with this tick's real numbers.
// -----------------------------------------------------------------------------
function updateArithmetic() {
  const host = document.getElementById('math');
  const f = brainSubject();

  // Default to the turn output, so there is always something to read.
  let id = view.selectedNode;
  if (id === null && f && f.net) {
    id = (f.net instanceof Genome) ? Senses.COUNT : 200;
  }

  const t = (f && f.net && id !== null) ? BrainView.terms(f.net, id) : null;

  if (!t) {
    host.innerHTML = '<div class="mnote">click a neuron to see its working</div>';
    document.getElementById('m-bias').textContent = '+0.00';
    document.getElementById('m-sum').textContent  = '+0.00';
    document.getElementById('m-out').textContent  = '+0.00';
    document.getElementById('m-title').textContent = '\u2014';
    return;
  }

  document.getElementById('m-title').textContent = t.name;

  // Only the largest few terms - a grown brain can have dozens of inputs and
  // the small ones are noise. Sorted by magnitude, so what is actually driving
  // this neuron is always at the top.
  const rows = t.rows.slice(0, 7);
  host.innerHTML = rows.map(r =>
    '<div class="mrow">' +
      '<span class="mlabel">' + r.name + '</span>' +
      '<span class="mx">' + signed(r.value) + '</span>' +
      '<span class="msym">\u00D7</span>' +
      '<span class="mw">' + signed(r.weight) + '</span>' +
      '<span class="msym">=</span>' +
      '<span class="mp ' + (Math.abs(r.product) < 0.005 ? 'zero' : r.product > 0 ? 'pos' : 'neg') +
        '">' + signed(r.product) + '</span>' +
    '</div>').join('') +
    (t.rows.length > rows.length
      ? '<div class="mnote">+ ' + (t.rows.length - rows.length) + ' smaller terms</div>'
      : '');

  document.getElementById('m-bias').textContent = signed(t.bias);
  document.getElementById('m-sum').textContent  = signed(t.sum);
  document.getElementById('m-out').textContent  = signed(t.out);
}

// -----------------------------------------------------------------------------
// THE MUTATION LOG (Stage 7) - every structural change, in plain English.
// -----------------------------------------------------------------------------
let lastLogLength = -1;

function updateMutationLog() {
  if (world.mutationLog.length === lastLogLength) return;   // nothing new
  lastLogLength = world.mutationLog.length;

  const host = document.getElementById('mutlog');
  const recent = world.mutationLog.slice(-14).reverse();

  host.innerHTML = recent.length
    ? recent.map(m =>
        '<div class="logrow"><span class="loggen">g' + m.generation + '</span>' +
        '<span class="logtext ' + (m.text[0] === '+' ? 'add' : 'off') + '">' +
        m.text + '</span></div>').join('')
    : '<div class="mnote">no structural changes yet</div>';
}

const MODES = ['network', 'neuron', 'wander'];
const MODE_LABEL = {
  network: 'random network (7\u21926\u21922)',
  neuron:  'hand-wired neuron (Stage 2)',
  wander:  'random wander (no brain)',
};


// -----------------------------------------------------------------------------
// LIVE TRAINING READOUT
// -----------------------------------------------------------------------------
// Without this the panel said the same sentence at generation 1 and generation
// 50, so there was no way to tell whether anything was happening. It reports
// the brain's size against where it started, which is the whole point of a
// genome that grows: parameters going up is the visible part of structural
// evolution.
// -----------------------------------------------------------------------------
let trainingStart = null;

function updateTrainingNote() {
  const el = document.getElementById('training-note');
  if (!el) return;

  const subj = brainSubject();
  const brain = subj && subj.net;
  if (!brain) { el.textContent = ''; return; }

  const params = brain.paramCount();
  const hidden = brain.hiddenCount();
  const memory = brain.memoryCount ? brain.memoryCount() : 0;

  if (!trainingStart || trainingStart.generation > world.generation) {
    trainingStart = { generation: world.generation, params, hidden };
  }

  if (CONFIG.life.continuous) {
    const live = world.fish.filter(f => f.alive);
    let young = 0, oldest = 0;
    for (const f of live) { if (f.maturity() < 1) young++; if (f.age > oldest) oldest = f.age; }
    el.textContent = world.extinct
      ? 'EXTINCT — every fish died. Press restart to seed a new colony.'
      : live.length + ' alive (' + young + ' juvenile) · ' + (world.births || 0) +
        ' born · ' + world.totalKills + ' eaten' +
        ' · habitat holds ' + CONFIG.life.maxPopulation + ' (breeding slows as it fills)' +
        ' · deepest lineage ' + (world.deepestGeneration || 1) +
        ' · oldest ' + oldest.toFixed(0) + 's · ' + params + ' params';
    return;
  }

  if (!CONFIG.evolution.enabled) {
    el.textContent = 'generation ' + world.generation + ' · ' + params +
      ' params · ' + hidden + ' hidden · ' + memory + ' memory · not training';
    return;
  }

  const dp = params - trainingStart.params;
  const dh = hidden - trainingStart.hidden;
  const sum = world.lastSummary;

  el.textContent =
    'generation ' + world.generation +
    ' · ' + params + ' params (' + (dp >= 0 ? '+' : '') + dp + ' since gen ' + trainingStart.generation + ')' +
    ' · ' + hidden + ' hidden (' + (dh >= 0 ? '+' : '') + dh + ')' +
    ' · ' + memory + ' memory' +
    (sum ? ' · last mean ' + sum.mean.toFixed(1) + 's' : '');
}

// A count that changes by one in a crowd of seventy is easy to miss, so the
// number flashes: red when a fish is lost, green when one is born.
let lastAlive = null;
function flashCount(alive) {
  if (lastAlive !== null && alive !== lastAlive) {
    const el = document.getElementById('alive');
    el.classList.remove('count-down', 'count-up');
    void el.offsetWidth;                    // restart the animation
    el.classList.add(alive < lastAlive ? 'count-down' : 'count-up');
  }
  lastAlive = alive;
}

function updateHud() {
  const sum = world.lastSummary;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

  set('gen', world.generation);
  const alive = world.aliveCount();
  set('alive', alive);
  flashCount(alive);
  // The denominator depends on which world we are in. Generational mode
  // respawns a fixed cohort, so it is fish.count. Continuous mode breeds up to
  // a ceiling, so it is maxPopulation - showing 70/45 was the old denominator
  // being applied to a population that is allowed to outgrow it.
  set('total', CONFIG.life.continuous ? CONFIG.life.maxPopulation : CONFIG.fish.count);
  set('time', world.time.toFixed(1));
  set('mean', sum ? sum.mean.toFixed(1) + 's' : '–');
  set('best', sum ? sum.best.toFixed(1) + 's' : '–');
  // Requested, and what the machine managed. They diverge sharply once the
  // schooling planner is running.
  const achieved = actualSpeed > 0 ? actualSpeed : speed;
  const lagging = paused ? false : achieved < speed * 0.8;
  set('speed', lagging
    ? speed + '× (' + achieved.toFixed(1) + '×)'
    : speed + '×');
  const speedEl = document.getElementById('speed');
  if (speedEl) speedEl.className = lagging ? 'off' : '';
  set('species', world.speciesCount);
  set('packs', world.packs ? world.packs.length : 0);
  let young = 0;
  for (const f of world.fish) if (f.alive && f.maturity && f.maturity() < 1) young++;
  set('young', young);
  set('births', world.births || 0);
  set('eaten', world.totalKills);
  set('shoal', Evolution.shoaling(world.fish).toFixed(0) + 'px');
  set('diversity', Evolution.geneticSpread(world.fish).toFixed(3));

  // Brain size, live from the focused fish when there is one - so growth is
  // visible immediately rather than only when a generation ends.
  const subj = brainSubject();
  const shown = subj && subj.net;
  set('params', shown ? shown.paramCount() : 0);
  set('hidden', shown ? shown.hiddenCount() : 0);

  const ev = document.getElementById('evolving');
  if (ev) {
    ev.textContent = CONFIG.evolution.enabled ? 'ON' : 'OFF';
    ev.className = CONFIG.evolution.enabled ? 'on' : 'off';
  }
  set('mode', MODE_LABEL[world.mode]);
  const sb = world.sharkBrain && selectedSharkEntry();
  set('shark-hud', sb ? 'brain gen ' + sb.generation : 'brainless');

  const paused_el = document.getElementById('paused');
  if (paused_el) paused_el.style.visibility = paused ? 'visible' : 'hidden';
}


window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
  }
  // Single-step while paused. Invaluable for watching a catch happen one
  // sixtieth of a second at a time, which you will want to do a lot later.
  if (e.code === 'KeyS' && paused) {
    world.update(CONFIG.sim.dt);
  }
  if (e.code === 'KeyV') {
    view.showAllRays = !view.showAllRays;
  }
  // Evolution on/off. Off is right for watching a trained brain; on is how
  // every earlier stage of this project worked.
  if (e.code === 'KeyE') {
    CONFIG.evolution.enabled = !CONFIG.evolution.enabled;
    syncEvolveButtons();
  }
  if (e.code === 'KeyK') toggleSharkBrain();
  if (e.code === 'KeyL') {
    view.showLineage = !view.showLineage;
  }
  // Cycle the three brains and compare them against each other.
  if (e.code === 'KeyB') {
    world.mode = MODES[(MODES.indexOf(world.mode) + 1) % MODES.length];
  }
  // Fast-forward. Evolution needs a great deal of simulated time; because the
  // timestep is fixed, 100x produces exactly the run you would have watched at
  // 1x, only sooner - not an approximation of it.
  if (e.code === 'Digit1') speed = SPEEDS[0];
  if (e.code === 'Digit2') speed = SPEEDS[1];
  if (e.code === 'Digit3') speed = SPEEDS[2];
  if (e.code === 'Digit4') speed = SPEEDS[3];

  // STEP THE FORWARD PASS one layer at a time. This does not advance time -
  // it advances the COMPUTATION, so you watch numbers propagate left to right
  // across the diagram the way water fills a system of pipes.
  if (e.code === 'KeyN') {
    const subj = brainSubject();
    const g = subj && subj.net ? subj.net.graph() : null;
    const max = g ? g.maxDepth : 0;
    view.revealDepth = view.revealDepth >= max ? -1 : view.revealDepth + 1;
  }

  // End this generation early and breed now, rather than waiting out the clock.
  if (e.code === 'KeyG') world.nextGeneration();

  if (e.code === 'KeyR') location.reload();
});


// -----------------------------------------------------------------------------
// SAVING AND LOADING BRAINS (Stage 8)
// -----------------------------------------------------------------------------
function flash(message) {
  const el = document.getElementById('savenote');
  el.textContent = message;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { el.textContent = ''; }, 4000);
}

document.getElementById('btn-save').addEventListener('click', () => {
  try { flash(Persist.download(world)); }
  catch (err) { flash('could not save: ' + err.message); }
});

// Loading reseeds the WHOLE population from the saved brain - one untouched
// copy plus mutated children - so a good brain becomes the ancestor of a new
// run rather than one stranger among sixty.
document.getElementById('btn-load').addEventListener('click', () => {
  document.getElementById('file-load').click();
});

document.getElementById('file-load').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      world.seedFrom(Persist.fromJSON(data));
      view.pinned = null;
      view.selectedNode = null;
      flash('loaded ' + (data.meta && data.meta.generation
            ? 'a brain from generation ' + data.meta.generation : 'a brain'));
    } catch (err) {
      flash('could not load: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';          // so choosing the same file twice still fires
});

document.getElementById('btn-restore').addEventListener('click', () => {
  const saved = Persist.restore();
  if (!saved) { flash('nothing stored in this browser yet'); return; }
  world.seedFrom(saved.brain);
  view.pinned = null;
  view.selectedNode = null;
  flash('restored the best brain from generation ' +
        (saved.data.meta ? saved.data.meta.generation : '?'));
});


// -----------------------------------------------------------------------------
// THE TRAINED CHAMPION, AND AUTO-TRAINING IN THE PAGE
// -----------------------------------------------------------------------------
// champions/best.js is written by train.js, which evolves brains far more
// rigorously than this page can: every brain alone in its own tank with a
// shark, so survival time can only come from escaping.
//
// In a crowd, one shark chases the nearest fish and the rest are safe for free.
// Raw survival therefore measured luck - a champion fell from 48.3s to 17.3s in
// twelve generations here. Evolution.fitness() now scales survival by how much
// of a life was spent under threat, which is what makes in-page training worth
// switching on at all. It is still the weaker signal of the two.
// -----------------------------------------------------------------------------
const improve = { warmStart: true };

function championBrain() {
  if (typeof window.CHAMPION === 'undefined') return null;
  try { return Persist.fromJSON(window.CHAMPION); }
  catch (err) { return null; }
}

function loadChampion(announce) {
  const brain = championBrain();
  if (!brain) return false;
  // false = do not mutate the children. This is a display of a finished brain,
  // not a starting point to evolve from.
  world.seedFrom(brain, false);
  CONFIG.evolution.enabled = false;
  view.pinned = null;
  view.selectedNode = null;
  if (announce) {
    const meta = window.CHAMPION.meta || {};
    flash('champion loaded \u00b7 ' + brain.paramCount() + ' params \u00b7 ' +
          brain.hiddenCount() + ' hidden \u00b7 ' +
          (brain.memoryCount ? brain.memoryCount() : 0) + ' memory');
  }
  return true;
}

function syncEvolveButtons() {
  const on = CONFIG.evolution.enabled;
  const champ = championBrain();

  const e = document.getElementById('btn-evolve');
  e.textContent = on ? 'AUTO-TRAIN: ON' : 'AUTO-TRAIN: OFF';
  e.classList.toggle('on', on);

  const w = document.getElementById('btn-warm');
  w.textContent = improve.warmStart
    ? 'START FROM: latest trained brain'
    : 'START FROM: nothing (fresh)';
  w.classList.toggle('on', improve.warmStart);
  w.disabled = false;

  const lifeBtn = document.getElementById('btn-life');
  if (lifeBtn) {
    lifeBtn.textContent = CONFIG.life.continuous
      ? 'TIMER OFF: continuous life, no reset'
      : 'TIMER: generations reset on a clock';
    lifeBtn.classList.toggle('on', CONFIG.life.continuous);
  }

  const detail = champ
    ? champ.paramCount() + ' params, ' + champ.hiddenCount() + ' hidden, ' +
      (champ.memoryCount ? champ.memoryCount() : 0) + ' memory loops'
    : 'none saved yet';

  if (CONFIG.life.continuous) {
    document.getElementById('evolve-note').innerHTML =
      'The clock never resets. Mature fish spend accumulated life on offspring; ' +
      'the young are born <b>small, slow and clumsy</b> and grow over ' +
      CONFIG.life.matureSeconds + 's. Nothing is culled on a schedule — a lineage ' +
      'continues only if its descendants survive, and the pack has to shelter ' +
      'the young or the whole population dies out.';
    return;
  }

  document.getElementById('evolve-note').innerHTML = on
    ? (improve.warmStart
        ? 'Breeding <b>from the saved brain</b> (' + detail + '). Its weights, grown neurons and memory are carried into generation 1 and improved from there.'
        : 'Breeding <b>from scratch</b>. Minimal brains, no hidden neurons, no memory \u2014 everything has to be rediscovered.')
    : 'Watching only \u2014 the same brains re-run every generation, so nothing changes. Turn auto-train on to let them improve.';
}

document.getElementById('btn-evolve').addEventListener('click', () => {
  CONFIG.evolution.enabled = !CONFIG.evolution.enabled;
  syncEvolveButtons();
  flash(CONFIG.evolution.enabled
    ? 'auto-train ON \u00b7 press "restart" to begin at generation 1'
    : 'auto-train OFF \u00b7 the same brains now re-run each generation');
});

// -----------------------------------------------------------------------------
// TIMER versus CONTINUOUS LIFE
// -----------------------------------------------------------------------------
// With the timer on, every fish dies at once when the clock runs out and a
// fresh cohort is bred - clean to measure, nothing like an ecology.
//
// With it off the clock never resets. Fish breed when they have lived long
// enough to afford it, the young are born small and slow, and a lineage
// continues only because its descendants survive. If they all die, the
// population is extinct and stays that way.
// -----------------------------------------------------------------------------
document.getElementById('btn-life').addEventListener('click', () => {
  CONFIG.life.continuous = !CONFIG.life.continuous;

  if (CONFIG.life.continuous) {
    // Start the colony from the current tank, aged to adults so it does not
    // begin with a population that cannot breed yet.
    world.fish.forEach(f => { f.age = Math.max(f.age, CONFIG.life.matureSeconds); });
    world.extinct = false;
    world.births = 0;
    world.deepestGeneration = 1;
  }
  syncEvolveButtons();
  flash(CONFIG.life.continuous
    ? 'continuous life · the clock no longer resets · raise the young or go extinct'
    : 'timer restored · generations reset on the clock');
});

document.getElementById('btn-warm').addEventListener('click', () => {
  improve.warmStart = !improve.warmStart;
  syncEvolveButtons();
});

// Start over at generation 1 - from the saved brain, or from nothing.
document.getElementById('btn-restart').addEventListener('click', () => {
  const champ = improve.warmStart ? championBrain() : null;
  if (improve.warmStart && !champ) flash('no usable saved brain \u2014 starting fresh instead');

  // Warm start MUTATES the children: the champion is kept intact as one elite
  // and the rest are varied descendants, which is what gives selection
  // something to choose between. A cold start builds minimal brains.
  world.seedFrom(champ || World.newBrain(world.rng), true);
  CONFIG.evolution.enabled = true;
  view.pinned = null;
  view.selectedNode = null;
  syncEvolveButtons();
  flash('generation 1 \u00b7 ' + (champ
    ? 'seeded from the saved brain (' + champ.paramCount() + ' params)'
    : 'fresh minimal brains') + ' \u00b7 auto-train ON');
});

document.getElementById('btn-champion').addEventListener('click', () => {
  if (!loadChampion(true)) flash('no champions/best.js \u2014 run: node train.js');
  syncEvolveButtons();
});

document.getElementById('btn-random').addEventListener('click', () => {
  world.seedFrom(World.newBrain(world.rng), true);
  CONFIG.evolution.enabled = true;
  view.pinned = null;
  view.selectedNode = null;
  syncEvolveButtons();
  flash('started over from random brains, auto-train ON');
});


// -----------------------------------------------------------------------------
// THE SHARK'S BRAIN
// -----------------------------------------------------------------------------
// One button switches it on and off; the dropdown picks WHICH trained
// generation drives the shark ("newest" follows self-training as it goes).
// Off restores the brainless chaser every number in PLAN.md was measured
// against. On brings the survival instinct with it: 10s without a meal and the
// shark starves, lies there a moment, and a fresh one takes its place.
//
// Self-training runs in the background against clones of the champion fish
// (js/sharktrainer.js). Each finished generation's champion is added to the
// dropdown and kept in this browser; train-shark.js does the same offline and
// much faster, writing champions/shark-best.js.
// -----------------------------------------------------------------------------
const sharkCanvas = document.getElementById('sharkbrain');
const sharkCtx = sharkCanvas.getContext('2d');

// A second BrainView with its own layout and hover state. The inspector keeps
// laid-out positions on itself for hit-testing, so two diagrams sharing one
// object would overwrite each other every frame.
const SharkView = Object.assign(Object.create(BrainView), {
  nodes: [], edges: [], hover: null, t: 0, hoveredNode: null, hoveredEdge: null, emphasis: 1,
});

sharkCanvas.addEventListener('mousemove', (e) => {
  const r = sharkCanvas.getBoundingClientRect();
  SharkView.hover = {
    x: (e.clientX - r.left) * (VIEW_SIZE.sharkBrain.w / r.width),
    y: (e.clientY - r.top) * (VIEW_SIZE.sharkBrain.h / r.height),
  };
});
sharkCanvas.addEventListener('mouseleave', () => { SharkView.hover = null; });

const SHARK_KEY = 'fish-shark-shark-history';
const sharkState = {
  enabled: false,
  training: true,
  selected: 'latest',   // or a generation number
  history: [],          // [{ generation, score, kills, mean, brain }]
  trainer: null,
  lastBrain: null,      // what the diagram shows while no shark is alive
};

// The trainer's file and this browser's own continuation of it - whichever was
// saved more recently wins. Both go through SharkHistory, which skips any
// entry that no longer fits the current sense layout.
function loadSharkHistory() {
  const file = typeof window.SHARK_HISTORY !== 'undefined' ? window.SHARK_HISTORY : null;
  let local = null;
  try { const raw = localStorage.getItem(SHARK_KEY); if (raw) local = JSON.parse(raw); }
  catch (err) { /* storage unavailable */ }
  const pick = local && (!file || String(local.saved) > String(file.saved)) ? local : file;
  sharkState.history = SharkHistory.fromJSON(pick);
  if (!sharkState.history.length) {
    // Nothing trained yet: generation 0 is a random brain. Self-training
    // improves it from there.
    sharkState.history.push({ generation: 0, score: 0, kills: 0, mean: 0,
                              brain: SharkBrain.random(new Rng(CONFIG.seed + 7)) });
  }
}

function saveSharkHistory() {
  try {
    localStorage.setItem(SHARK_KEY, JSON.stringify({
      version: 1,
      saved: new Date().toISOString(),
      generations: SharkHistory.thin(sharkState.history, 120).map(SharkHistory.entryToJSON),
    }));
  } catch (err) { /* storage unavailable - training still works this session */ }
}

function selectedSharkEntry() {
  const h = sharkState.history;
  if (!h.length) return null;
  if (sharkState.selected === 'latest') return h[h.length - 1];
  return h.find(e => e.generation === sharkState.selected) || h[h.length - 1];
}

// Put the chosen brain (or none) into the tank. The world owns it from here:
// every respawn and every new generation's shark gets a clone.
function applySharkBrain() {
  const entry = sharkState.enabled ? selectedSharkEntry() : null;
  CONFIG.sharkBrain.enabled = !!entry;
  world.setSharkBrain(entry ? entry.brain : null);
  syncSharkControls();
}

function toggleSharkBrain() {
  sharkState.enabled = !sharkState.enabled;
  applySharkBrain();
  flash(sharkState.enabled
    ? 'shark brain ON · generation ' + selectedSharkEntry().generation + ' · it starves after ' +
      CONFIG.sharkBrain.starveSeconds + 's without a meal'
    : 'shark brain OFF · back to the brainless chaser');
}

function ensureSharkTrainer() {
  if (sharkState.trainer) return sharkState.trainer;
  const fish = championBrain() || world.fish[0].net;
  const last = sharkState.history[sharkState.history.length - 1];
  sharkState.trainer = new SharkTrainer({
    fishBrain: fish.clone(),
    startBrain: last.generation > 0 ? last.brain : null,
    startGeneration: last.generation,
    seed: 90210 + last.generation,
    onGeneration: onSharkGeneration,
  });
  return sharkState.trainer;
}

function onSharkGeneration(record) {
  sharkState.history.push(record);
  if (sharkState.history.length > 400) sharkState.history = SharkHistory.thin(sharkState.history, 300);
  saveSharkHistory();
  rebuildSharkSelect();
  // "Newest" means newest: the live shark picks up the new brain at once,
  // keeping its body and its hunger.
  if (sharkState.enabled && sharkState.selected === 'latest') world.setSharkBrain(record.brain);
}

function rebuildSharkSelect() {
  const sel = document.getElementById('shark-gen');
  const h = sharkState.history;
  const newest = h[h.length - 1];
  const opts = ['<option value="latest">newest — gen ' + newest.generation +
                ' (follows training)</option>'];
  for (let i = h.length - 1; i >= 0; i--) {
    const e = h[i];
    opts.push('<option value="' + e.generation + '">gen ' + e.generation +
              (e.generation === 0 ? ' · untrained' : ' · ' + e.kills.toFixed(1) + ' kills/trial') +
              '</option>');
  }
  sel.innerHTML = opts.join('');
  sel.value = String(sharkState.selected);
  if (sel.value === '') { sharkState.selected = 'latest'; sel.value = 'latest'; }
}

function syncSharkControls() {
  const b = document.getElementById('btn-shark-brain');
  b.textContent = sharkState.enabled ? 'SHARK BRAIN: ON' : 'SHARK BRAIN: OFF (brainless chaser)';
  b.classList.toggle('on', sharkState.enabled);
  const t = document.getElementById('btn-shark-train');
  t.textContent = sharkState.training ? 'SELF-TRAINING: ON' : 'SELF-TRAINING: OFF';
  t.classList.toggle('on', sharkState.training);
  document.getElementById('shark-gen').disabled = !sharkState.enabled;
}

document.getElementById('btn-shark-brain').addEventListener('click', toggleSharkBrain);

document.getElementById('btn-shark-train').addEventListener('click', () => {
  sharkState.training = !sharkState.training;
  syncSharkControls();
});

document.getElementById('shark-gen').addEventListener('change', (e) => {
  sharkState.selected = e.target.value === 'latest' ? 'latest' : Number(e.target.value);
  applySharkBrain();
  flash('shark now runs the brain from generation ' + selectedSharkEntry().generation);
});

function updateSharkPanel() {
  const s = world.sharks[0];
  const brained = !!world.sharkBrain;
  const starve = CONFIG.sharkBrain.starveSeconds;

  // --- hunger: the survival instinct ---
  const bar = document.getElementById('hunger-bar');
  const left = brained && s ? V.clamp(1 - s.hunger / starve, 0, 1) : 0;
  bar.style.transform = 'scaleX(' + left.toFixed(3) + ')';
  bar.style.background = 'hsl(' + Math.round(120 * left) + ', 70%, 55%)';
  document.getElementById('hunger-val').textContent = !brained ? 'never starves'
    : s ? (starve - s.hunger).toFixed(1) + 's left' : 'starved';

  // --- this tank ---
  const entry = selectedSharkEntry();
  let status;
  if (!brained) {
    status = 'Brainless chaser: aims at the nearest fish and swims flat out. No hunger, no learning. ' +
             'Turn the brain on to let a trained network steer.';
  } else if (!s) {
    const next = world.sharkRespawns.length ? Math.max(0, world.sharkRespawns[0] - world.time) : 0;
    status = 'Starved — a new shark arrives in ' + next.toFixed(1) + 's. Starvations so far: ' + world.starvations + '.';
  } else {
    status = 'Generation ' + entry.generation + ' brain · ' + s.kills + ' eaten this life · ' +
             'turn ' + signed(s.lastTurn) + ' · speed ' + Math.round(100 * s.speed / CONFIG.shark.maxSpeed) + '% · ' +
             'starved ' + world.starvations + '× so far';
  }
  document.getElementById('shark-status').textContent = status;

  // --- self-training ---
  const tr = sharkState.trainer;
  const newest = sharkState.history[sharkState.history.length - 1];
  let note;
  if (!sharkState.training) {
    note = 'Self-training paused. Newest trained brain: generation ' + newest.generation + '.';
  } else if (tr) {
    const p = tr.progress();
    note = 'Training generation ' + p.generation + ' against champion fish · candidate ' +
           p.candidate + '/' + p.population + ' · trial ' + p.trial + '/' + p.trials +
           (tr.reflexTrial(p.trial - 1) ? ' (reflex-only fish)' : ' (schooling fish)') +
           (tr.lastRecord ? ' · last generation’s best: ' + tr.lastRecord.kills.toFixed(1) + ' kills/trial' : '') +
           (sharkState.yielding ? ' · waiting: the tank needs this frame' : '');
  } else {
    note = 'Self-training starts with the next frame.';
  }
  document.getElementById('shark-train-note').textContent = note;

  // --- the diagram: the live shark's own network, pulsing ---
  if (s && s.brain) sharkState.lastBrain = s.brain;
  const shown = brained ? (s && s.brain) || sharkState.lastBrain || entry.brain : entry.brain;
  document.getElementById('sharkbrainwrap').classList.toggle('idle', !brained);
  SharkView.draw(sharkCtx, shown, VIEW_SIZE.sharkBrain.w, VIEW_SIZE.sharkBrain.h,
                 { revealDepth: -1, selectedId: null });
  document.getElementById('sharkmeta').textContent =
    (brained ? 'driving the shark' : 'brain off — showing generation ' + entry.generation + ', not steering') +
    ' · ' + shown.paramCount() + ' params · 8 senses → ' + shown.hiddenCount() + ' hidden → turn, speed';
}


fitAllCanvases();
buildSensePanel();
loadChampion(false);
syncEvolveButtons();
loadSharkHistory();
rebuildSharkSelect();
// The page starts with the brain ON so the new behaviour is visible at once.
// CONFIG.sharkBrain.enabled stays false for the tests and trainers.
sharkState.enabled = true;
applySharkBrain();
requestAnimationFrame(frame);

