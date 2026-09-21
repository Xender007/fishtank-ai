# Learning Neural Networks by Evolving Fish That Escape a Shark

> Latest (2026-09-21): Stage 10 — learned teamwork, an evolved route critic, fish hunger,
> multi-core co-evolution. Off for every test (Profiles.v3 switches it on).
>
> Before that: the shark got an OPTIONAL brain — see "Stage 9, by request" below.
>
> Earlier update (2026-09-21): the fish now use coordinated packs
> and a social escape planner around the saved neural reflex. The predator still
> has no brain; the requested three-circle correction is its only new rule.
> Earlier stages below are historical plans/findings, not instructions to stop
> the current work or to implement predator learning. See the latest entry below.

## Stage 10, by request — learned teamwork, learned planning, hunger, co-evolution (2026-09-21)

The request was eight changes: (1) train the fish against the trained shark, (2) learn
the teamwork, (3) train at 45 fish, (4) harder training, (5) a bigger population, (6) let
the brain drive the escape planner, (7) a fish survival instinct, and (8) use all CPU cores.
All eight are built; HANDOFF.md has the file-by-file map.

**The design choice that made 2, 6 and 7 possible: layout v3.** A network cannot learn to
use information it is never given. Until now the pack rules read the pack, the alarm and
the neighbours, but the network never saw any of them. Layout v3 appends 11 senses. It
only APPENDS, so the old 12 inputs keep their meaning, and for the first time a layout
change does not throw every trained brain away: v2 brains are migrated.

**Teamwork** now comes from the network's own output whenever no threat is known. The
packs, the alpha and the alarm relay remain: they are how fish communicate. What a fish
does with that information is now learned. The migrated weights start from a prior
translated from the old rules. That is a starting point, not a rule: the weights mutate
like any other.

**Planning** keeps its physics forecast (imagining the future is not learned), but choosing
between futures is now an evolved critic in every genome. At its initial values it is my
hand formula, bit for bit (tested), so any change in behaviour is evolution's doing.

**Hunger** makes safety cost something. The settings were measured first: 30s of energy
and 24 pellets was a famine, where starving was the whole game. At 40s and 40 pellets,
hand-changing only the foraging weights cut starvation from 14 fish to 5 per minute. So
avoiding it is learnable, and it trades against cohesion.

**Speed.** Scoring is spread over worker threads, with a result that matches the in-thread
result to the last bit (tested). On this machine (4 physical cores, 8 threads): 48
evaluations took 34.7s on one worker, 15.0s on 4, 11.7s on 8, so **3.0x**. The last
missing multiple is the hardware: 4 real cores.

### What was measured: finding #2 came back

The first co-evolution run learned nothing in 12 generations, and neither side moved on
the scoreboard. The clone diagnostic, the cheapest test in this project, showed why: 48
children of the champion, scored twice on independent seeds, ranked with a correlation of
**r = 0.04**. The "best of the generation" was the luckiest of the generation. In a harder
world with 45 fish and trained sharks, one 45-second trial swings by about 2.9s on luck,
while real differences between a champion's children are about 0.3s.

Stronger mutation made the differences real (r = 0.40), but the unmutated parent then
ranked 1st and 2nd of 48. **Nearly every change to a trained champion is a change for the
worse.** That is what being near a local optimum means, and it is why improvement is slow
no matter how selection is done.

The fixes: **racing** (re-measure the top 8 on 9 more trials before choosing elites, and cap
everyone unverified below them) and **36-seed benchmarks** (the old 20-seed bar re-measured
0.9s lower; it had been set by luck). With both, the next run saved and promoted a new
champion in its fifth generation.

### V3 results (training stopped by request, 2026-09-22)

Three co-evolution runs, ~2.5 hours of training on 8 threads, fish generations 380 -> 432,
shark generations 300 -> 332. The first run (no racing) learned nothing; the numbers below
are from the runs with racing and 36-seed benchmarks.

| page champion, page setting (45 fish, 1 trained shark, 60s, 36 seeds) | survival of 60s |
|---|---:|
| start: migrated v2 champion, vs shark gen 300 | 46.35s |
| after round 1 (gen 397), vs shark gen 300 | **48.27s** |
| the same brain re-measured vs the co-evolved shark gen 320 | 47.01s |
| final page champion (gen 432, 58 params), vs shark gen 320 | **47.81s** |

Co-evolution scoreboard after one full round (45 fish, 1 shark, 60s, 12 held-out seeds):

| | eaten | starved |
|---|---:|---:|
| starting fish vs starting shark | 17.3 | 5.1 |
| new fish vs starting shark | **14.3** | 4.9 |
| starting fish vs new shark | **18.8** | 4.8 |
| new fish vs new shark | 11.7 | 7.5 |

Both sides really improved: the new fish lose 3 fewer to the OLD shark, and the new shark
catches 1.5 more of the OLD fish. Gains are modest (about +1.5-2s of survival per fish),
because the champion sits near a local optimum (finding #12). Not yet run: the
`--no-prior` control, and `node tests/v3_benchmark.js` for the learned-vs-written ablations.
Logs: `tests/results/coevolution-20260921{,b,c}.log`, `champions/coevolution.json`.

## Stage 9, by request — the shark gets a brain (2026-09-21)

The user lifted the long-standing "no shark brain" instruction and asked for: a brain; one
survival instinct (if it cannot eat a fish within 10 seconds, it dies); automatic
self-improvement by training against champion fish; one button to turn the brain on and
off; a choice of which generation's brain drives the shark; and its neural graph on
screen.

**Design.** A fixed 8 → 6 → 2 network (68 parameters), Stage 3 style, kept separate from
the fish genome so the two species can never share innovation numbers. Senses: angle and
closeness of the nearest fish, the fish's sideways **drift** across the line of sight (so
it can aim where the fish is going), angle to and size of the local crowd, wall ahead,
**hunger** and its own speed. Outputs: turn, plus speed between 50% and 100%. It moves
under the same turn-rate and top-speed limits as always. Slowing down is its only new
physical lever, and at half speed its turning circle halves from 66px to 33px.

**The instinct.** Hunger counts seconds since the last meal. At 10s the shark dies and is
removed from the tank, so fish stop reacting to it. It lies there as a greyed "starved"
corpse and a replacement arrives 1.5s later. Hunger is also an input, so the brain can
feel the clock running out.

**Self-training.** The same evolutionary loop as the fish, pointed the other way. Each
candidate hunts clones of the champion fish alone. The score is kills, plus a small bonus
for staying close to the nearest fish, worth less than one catch. Every candidate in a
generation faces the same seeds, and elites are re-scored each generation. The page runs
this in 4ms slices per frame; `node train-shark.js` runs it flat out.

**The brainless measuring stick is untouched.** `CONFIG.sharkBrain.enabled` is false for
every test and trainer; only the page switches it on. So every earlier table in this file
still means what it says. Numbers taken with the brained shark belong to a new series.

### What was measured

1. **The starvation clock nearly made the task unlearnable.** Against 12 champion fish
   running the schooling planner, even the brainless chaser averages about one catch per
   30s. Random brains starved with zero kills, every score tied, and selection had nothing
   to work with. It is the "too hard" failure from Stage 4, from the predator's side.
   The fix is **mixed opponents**: half the trials face the champion's bare neural reflex,
   which is catchable and gives a gradient; the other half face the schooling fish the
   page actually shows.
2. **The determinism test found two trainer bugs.** One trial's opponent setting leaked
   into the next, so for a while *every* trial was reflex-only. And `step()` ran past the
   end of a generation. Both are fixed. The test now checks the opponent from inside the
   running tank, not from the config.
3. **Finding #2, from the other side.** With 2 trials per candidate, held-out kills swung
   from 0.4 to 2.3 between *neighbouring* generations, so the per-generation champion was
   chosen partly by luck. Trials went up to 4.

**Results.** 200 generations with 2 trials, then 100 more with 4 (population 24; about
6s per generation offline). Held out against **schooling** champion fish (24 seeds never
used in training, 12 fish, 20s, and the brainless chaser held to the same 10s rule):

| shark | kills / 20s | starved |
|---|---:|---:|
| brainless chaser | 0.38 | 23/24 |
| brain, gens 101-119 (2 trials) | ~0.3 | ~24/24 |
| brain, gens 150-200 (2 trials) | ~1.4, swinging 0.4-2.5 between neighbours | ~16/24 |
| brain, gens 290-300 (4 trials) | **2.75-3.63** (gen 300: 3.58) | 4-9/24 |

Against the bare reflex it only matches the brainless chaser (7.25 vs 7.67 kills on
12 seeds): chasing is already enough against fish that do not coordinate. Everything it
learned is about beating the *school*.

In the page's actual setting (45 champion fish, schooling on, 8 seeds × 60s):

| shark | fish eaten per 60s | starvations per 60s |
|---|---:|---:|
| brainless chaser | 2.8 / 45 | — (cannot starve) |
| brain gen 300 | **18.0 / 45** | 0.9 |

Going from 2 to 4 trials was what made progress stick: before, the per-generation
champion was chosen largely by luck, exactly as in finding #2.

## Multi-step escape planner — social-v2, 2026-09-21

Follow-up request: make the fish smarter still. The concrete limitation was the
planner's action space: it could only compare holding one turn at full speed.
More neural parameters would not fix this controller limitation.

Fish now forecast two phases: an initial dodge lasting 0.48s followed by an exit,
for 1.92s total. They compare continuing the turn, straightening, or reversing it.
In close encounters, strong turns also consider 60% thrust during the first phase,
then full thrust on exit. This lets them turn more tightly beside a wall and
accelerate away once aligned. The controller applies only the first action and
replans from observations every six fixed ticks. Collision forecasts check the
closest approach along each relative-motion segment, avoiding missed collisions
between forecast samples.

The initial six-seed development check reduced losses from 39.26% to 4.44%.
The controller was then evaluated on twelve fresh seeds, `3100007 + i * 104729`,
with 45 exact champion copies, 60s rounds and the same predator in both conditions:

| Controller | Eaten | Mean survival | At least six packmates within 140px after 10s |
|---|---:|---:|---:|
| Previous social-v1 | 39.63% | 48.74s | 66.27% |
| Multi-step social-v2 | 7.78% | 57.44s | 70.14% |

Survival improved in all twelve paired runs. Deaths fell 80.4% relative to the
previous controller on this set. The result is improved planning, not newly trained
neural weights; fish/predator speed and turn limits, shark behaviour, senses and
pack rules were unchanged. No champion or training-history file was overwritten.

Reproduce with `node tests/planner_benchmark.js 12 60 3100007`. The old controller
is preserved as a test fixture; per-seed results are saved in
`tests/results/social-v2-validation.jsonl`. Runtime for the comparison was about
49s for v1 and 130s for v2 on this environment. The richer search costs more, so
the browser yields after approximately 12ms of simulation work per frame; requested
100x may run slower, but the simulated trajectories still use fixed timesteps.

The inspector displays the current manoeuvre and a dotted gold forecast. All
127 assertions passed, including nine route-planner checks for braking beside a
wall, phased acceleration, valid paths, memory-only prediction and read-only
rendering. A real Chrome smoke test checked the inspector/route and a 100x frame
(20.9ms including rendering); the trainer evaluated eight clones without saving.
Future training uses the social-v2 score namespace so v1 scores are not reused.

## Coordinated escape update — 2026-09-21

The request was to make fish cooperate in packs larger than five or six, with one
scouting alpha per pack and reactions spreading between fish. It explicitly kept
the predator brainless, adding only a direction change after more than three circles.

Implemented `js/schooling.js`: five initial packs of nine, stable alpha election,
replacement after death, casualty-driven pack rebalancing, staggered formation
positions, separation, wall avoidance, and regrouping after evasive manoeuvres.
Pack size is at least seven while possible; fewer than seven total survivors form
one remnant. Groups are formed from nearby fish without teleporting their bodies.

Scouts have wider, longer-range scanning vision; all fish have short-range sensing
around their bodies. A sighting produces a timestamped alarm. Neighbours receive
previous-tick messages within 150px, including across pack boundaries, so a reaction
can cascade without instantaneous global knowledge. Relays preserve the original
timestamp and expire after 2.5s. Unseen predators are estimated from their last
observed position and heading, not read remotely from the world.

When threatened, fish compare candidate turns over 1.2 seconds of predicted motion.
They score minimum clearance, eventual distance, wall contact, and steering continuity;
cohesion has reduced priority during immediate danger. The saved network still runs
and supplies a candidate/prior. This is deliberately a **hybrid controller**: the
social rules and predictor are engineered; no additional neural training is claimed.
The seven-input champion files still load unchanged.

The shark accumulates actual signed turn steps, resetting its loop count on a turn
reversal or sustained straight travel. Beyond three full rotations it turns the other
way for 1.4s, then resumes nearest-fish pursuit. It retains the same speed/turn limits
and receives no network, prediction or learning code.

Paired development benchmark (`node tests/schooling_benchmark.js 12 60`), 45 exact
copies of `best-shoal8.json`, seeds `900001 + i * 104729`, both conditions facing the
updated predator, 60-second rounds:

| Controller | Fish eaten | Mean survival | Time touching walls |
|---|---:|---:|---:|
| Saved neural network alone | 47.78% | 42.66s | 0.16% |
| Neural reflex + social planner | 35.00% | 50.40s | 0.55% |

This is 26.7% fewer deaths relative to this baseline and 18.1% longer mean survival.
Individual seeds still vary; this does not establish optimality. After the first 10s,
67.66% of sampled living fish had at least six packmates within 140px. Packs can
temporarily spread apart while escaping and regrouping. Historical numbers earlier
in this project used a predator without the new circle rule and are not directly
comparable to this table.

Verification: all 118 assertions passed, including 26 new checks covering pack
sizes, alpha succession, alarm locality/cascades/expiry, deterministic replay,
bounded movement, compatible saved brains, and both the three-circle threshold and
the absence of false triggers during alternating turns. The test runner now treats
missing/crashed suites as failures. A real headless Chrome check advanced the page
20s and rendered the pack display plus the focused alpha's neural/social inspector.
A trainer smoke check evaluated eight clones without saving or changing champions.

Future training saves scores under a new regime and an environment signature,
including duration, physics, senses and social settings. Old champions can seed
training but are benchmarked again before comparison; old solo/shoal JSON remains
separate. `--neural-only` disables the social layer for comparison. UI pack colors,
gold alpha labels, warning rings, pack counts and focused readouts make the new
behaviour visible; `L` still switches to genetic lineage colors.

## Context

You want to learn neural networks from scratch — not by importing a library, but by
writing every multiply and every weight yourself. The vehicle is a simulation: a sea
full of small fish and one predator. Fish that get eaten "learn" — the survivors pass
on their brains with small changes, and over generations the brains **grow new
parameters** (new connections, new neurons) so the fish escape better and earlier.

Two requirements shape everything below:

1. **You want to see it.** Not a loss number in a console — the actual fish, the actual
   vision rays, the actual network lighting up, the fitness curve climbing.
2. **You want to understand it.** So we build in small stages, and I explain before I
   write, not after.

Decisions already made:
- **Stack: browser, plain HTML + JavaScript.** You have Node v20 but no Python, and this
  needs zero install — you double-click `index.html` and it runs.
- **Your level: comfortable coder, new to AI/math.** I skip "this is a for-loop",
  I go slow on "why tanh", "why this fitness function", "why mutation rate matters".
- **Delivery: explanation in chat + heavily commented code**, then I stop and check you
  followed it before moving on.

### One technical constraint worth knowing up front

Browsers block ES modules (`import`/`export`) on `file://` URLs for security. Since you
want to just double-click the file, we use **classic `<script>` tags loaded in order**
instead of modules. Each file defines a global class (`Brain`, `Fish`, `Shark`...).
Slightly old-fashioned, but it means the project genuinely opens with a double-click and
no server, no npm, no build step. If we later want modules, `npx serve .` is one command.

## What gets built

```
D:\neural network learning with fish and shark\
  index.html        canvas + HUD + control panel; loads the scripts in order
  css\style.css     dark "underwater" theme
  js\
    rng.js          seeded random — so a run can be replayed exactly
    vec.js          tiny 2D math: distance, angle, clamp, lerp
    brain.js        *** THE NEURAL NETWORK. Written from scratch, no libraries. ***
    genome.js       the brain's DNA: node list + connection list + mutation ops
    fish.js         body, vision rays, movement, energy
    shark.js        the predator
    world.js        the tank: update loop, collisions, generation timer
    evolution.js    fitness, selection, crossover, mutation, species
    render.js       draws sea, fish, shark, rays
    brainview.js    draws a fish's network: neurons, weights, live activations
    inspector.js    click a fish, step the forward pass, show the arithmetic
    chart.js        fitness AND parameter-count, per generation
    main.js         game loop + wiring the HUD controls
```

No dependencies. No build. Total ~1200 lines, written across the stages below.

## Visual design

The look is not decoration for its own sake — you are going to spend hours staring at
this screen trying to tell whether a fish is behaving cleverly, so the visuals have to
carry information.

**The view is top-down.** We look straight down into the tank. That fixes the anatomy:
you see an animal's back rather than its belly, pectoral fins stick out left and right,
and the tail beats *side to side* — which is the one motion worth animating, so the
anatomy and the animation agree with each other for free.

**Everything is drawn with canvas paths.** No images, no sprite sheets, nothing to
download. That is what keeps the "double-click `index.html` and it runs" promise intact.

**Colour carries meaning, and the same language extends into the brain panel later:**

| Colour | Means |
|---|---|
| Teal | prey |
| Deep red | the predator |
| Amber | a body pressed against the glass — the visual check that wall *glide* works |
| Faint white silhouette | a corpse, left in place as a map of where fish die |
| Orange / blue *(from Stage 6)* | a positive / negative neuron activation |
| Green / red *(from Stage 6)* | a positive / negative connection weight |

**Motion is informative too.** Tail beats run at a *constant frequency* with amplitude
scaled by speed — so a coasting fish barely twitches and a sprinting one thrashes, and
neither ever stutters the way a speed-varying frequency does. The shark beats slower than
the fish (6.5 against 11): large animals move at lower frequencies, and it makes the
shark read as heavy rather than frantic. Only the shark casts a shadow, so the threat is
findable at a glance among sixty other bodies.

**The one hard rule: decoration must never touch the simulation.** The drifting plankton
have their own private `Rng(9999)` and the renderer keeps its own frame counter. If the
motes drew from `world.rng` they would shift every fish spawn along with them, and the
seeded, reproducible run — the thing that makes every later experiment meaningful —
would quietly break. Anything cosmetic gets its own random stream.

## The stages

Each stage ends in something that **runs and shows you something new**. I write one
stage per turn, explain first, and stop at the end of it.

### Stage 0 — The sea (no brains yet)
`index.html`, `css/style.css`, `vec.js`, `rng.js`, `fish.js` (dumb), `shark.js` (dumb),
`world.js`, `render.js`, `main.js`.

60 fish drifting on random headings. One shark that simply chases the nearest fish.
Fish get eaten. **Nothing learns.** This is the "before" picture — we need the world
working before we can watch learning happen inside it.

*Teaches:* the game loop, fixed timestep, why we separate `update()` from `draw()`.

### World rules — a closed tank, not open ocean

The sea is a **small bounded area**, and everything stays inside it. Specifically:

- **No wrap-around.** A fish that reaches the left wall does *not* reappear on the right.
  The edges are solid.
- **Nothing ever leaves the view.** Position is clamped to the tank on every tick, so no
  fish or shark can drift off-screen and vanish. If you can't see it, it isn't there.
- **Fish glide along walls, they don't bounce.** On contact we kill only the velocity
  component pointing *into* the wall and keep the component running *along* it. A fish
  swimming at the wall diagonally slides smoothly down it instead of ricocheting. This
  matters: hugging the wall has to feel like a real, usable tactic, because evolution is
  going to try it.
- **Walls are visible**, drawn as the tank edge, so you can see the arena the fish are
  reasoning about.

This is a deliberate choice, not a shortcut. A closed tank means **escape is finite** —
there is no running away forever, so the fish are forced to learn actual evasion
(turning, timing, cutting angles) rather than just picking a direction and fleeing. It
also makes the wall-distance sensor in Stage 1 genuinely informative, and it sets up the
corner trap in Stage 4.

### Stage 1 — Senses (what the network will actually see)
Add vision to `fish.js`. Each fish casts **5 rays** in an arc ahead of it. Each ray
returns one number: `0` = nothing there, `1` = the shark is touching me. Plus two more
inputs: own speed, and **how close the wall is in front of it** (`0` = open water,
`1` = nose against the glass).

That wall input is not decoration. In a closed tank a fish that flees blindly ends up
pinned, so "shark behind me AND wall ahead of me" is exactly the situation the network
has to learn to handle — and it can only learn it if it can sense it.

The rays get **drawn on the canvas**, glowing red as the shark gets closer, so you can
literally see the numbers the network will receive.

*Teaches:* the single most important idea before any math — **a neural network is just
numbers in → numbers out**. This stage builds the "numbers in".

### Stage 2 — One neuron, by hand
`brain.js` v1. A neuron is three things: **weights** (how much each input matters), a
**bias** (how eager it is to fire anyway), and an **activation function** (`tanh`, which
squashes any number into −1..1).

I wire one neuron by hand — set the weights myself so that "front ray lights up → turn
hard". You watch a hand-tuned fish dodge, badly. Then you change a weight in the file,
press F5, and watch its behaviour change. That is the whole intuition for what learning
will later do automatically.

*Teaches:* weight = importance, bias = default eagerness, activation = squashing, and why
a network without an activation function can only ever draw straight lines.

### Stage 3 — A layer, then a whole network
`brain.js` v2: 7 inputs → hidden layer → 2 outputs (**turn** and **thrust**).
Forward pass written as plain nested loops — no matrices, so you can see every multiply.
Every fish gets **random** weights. They all swim like idiots and get eaten instantly.

*Teaches:* layers, the forward pass, why a hidden layer lets the fish combine senses
("shark on the left AND wall on the right → do something different").

### Stage 4 — Death teaches: the first learning loop ★
`evolution.js`. **This is the moment you asked for.**

When every fish is eaten (or the 30-second generation timer runs out):
1. **Fitness** — score each fish. Mainly how long it survived, plus a small bonus for
   keeping distance from the shark.
2. **Selection** — sort; keep the best few unchanged (*elitism*); pick parents with
   probability proportional to fitness.
3. **Mutation** — a child is a copy of its parent's weights with small random jitter.
4. Repeat.

Plus `chart.js`: the fitness-per-generation curve, climbing. Plus a **speed control**
(1× / 5× / 50× — fast-forward so 50 generations take seconds instead of minutes).

*Teaches:* fitness functions, selection pressure, mutation rate, elitism, and
exploration-vs-exploitation.

**And the corner trap.** Because the tank is closed, this one is close to guaranteed, and
I'm going to let it happen on purpose. Within a few generations the fish will discover
that the highest-scoring strategy is to **wedge into a corner and stop moving** — a corner
can only be approached from one side, so it's the safest square metre in the tank, and
"survive a long time" rewards it perfectly. You'll watch 60 fish evolve into a row of
cowards stuck to the walls.

That failure is the most valuable thing in the project: the fish didn't do what you
wanted, they did **exactly what you rewarded**. Then we fix it, and you get to choose how:
give the shark a speed edge so corners become death traps, reward distance travelled,
score *average* distance from the shark rather than raw survival time, or spawn the shark
in a different place each generation so no one corner stays safe. Each fix produces
visibly different fish — that's the lesson.

### Stage 5 — Crossover: two parents, one child
Until now a child was a *copy* of one parent with a few weights jittered. Now two parents
produce a child that takes some weights from each.

Why bother? Cloning can only improve one lineage at a time — if fish A evolves a good
"dodge left" reflex and fish B independently evolves good wall-avoidance, cloning means
those two discoveries can never meet. Crossover lets a child inherit both at once.

*Teaches:* why sexual reproduction beats cloning, and the risk that comes with it —
mixing two good brains often produces a broken one, which is exactly why Stage 7 needs
species.

### Stage 6 — The brain inspector: watching a network think ★★
`brainview.js` + `inspector.js`. **A whole stage devoted to seeing the network work.**

Up to here the network has been a thing that produces behaviour. Now we open it up.
Click any fish in the tank and a panel appears beside the sea showing its actual brain:

- **Neurons are circles**, laid out in columns: senses on the left, hidden neurons in the
  middle, `turn` and `thrust` on the right. Each circle is filled by its **live
  activation** — orange for positive, blue for negative, pale for near-zero — with the
  number printed inside. As the fish swims, you watch the whole diagram pulse.
- **Connections are lines.** Green = positive weight, red = negative, and thickness =
  strength. Hover one to read its exact value. A brain that has learned "shark on my
  left → turn right" shows up as one thick green line you can point at.
- **Sensor bars** down the left edge and **two output dials** on the right, so you can
  see the numbers enter and the decision leave.

Then the part that makes it click — **step the forward pass by hand.** Pause the sim and
press `n`. Instead of advancing time, the network advances **one layer**. Layer by layer
you watch numbers propagate left to right across the diagram, the way water fills a
system of pipes. Press `n` again and the outputs finally resolve.

And the **maths strip**: click a single neuron and it prints the exact arithmetic it just
performed, with real numbers from this tick:

```
    hidden#3   (0.82 x -1.31) + (0.05 x  0.44) + (0.00 x  2.10)
             + (0.91 x  0.77) + bias 0.20
             = -0.87   ->   tanh   ->   -0.70
```

**That line is the entire neural network.** Multiply each input by its weight, add them
up, add a bias, squash the result. Every deep learning system on earth is that operation,
repeated. Once you have watched it happen with numbers you can read, the mystery is gone
for good — and everything afterwards is engineering, not magic.

*Teaches:* the forward pass made concrete; what a weight physically does to a signal; why
an activation function is needed at all; and how to *read* a trained network instead of
treating it as a black box.

### Stage 7 — Growing brains: adding parameters over generations ★★★
`genome.js`. **This is the heart of your request.** Up to now every fish had the same
fixed brain shape and only the weight *values* changed. Now the *shape* itself evolves.

The genome becomes a list of **nodes** and a list of **connections**, each connection
tagged with an innovation number. Four mutation types:
- **Change weight** — as before.
- **Add connection** — wire two previously-unconnected neurons.
- **Add node** — split an existing connection and drop a new neuron in the middle.
- **Toggle connection** — disable/re-enable a link.

Generation 0 starts with the **smallest possible brain** — inputs wired straight to
outputs, no hidden neurons at all. Complexity is only added when it earns fitness.

Three things make the growth visible, since watching parameters appear is the point:

1. **A parameter counter that flashes.** The HUD reads `params: 14`, and when a
   structural mutation lands it flashes `+2` in green. You see the brain get bigger in
   real time.
2. **A mutation log** scrolling beside the tank, in plain English:
   `gen 14 · +node splitting ray2 -> turn` / `gen 19 · +connection speed -> hidden#3`.
   Every structural change to every surviving lineage, named.
3. **A second line on the chart.** `chart.js` now plots fitness *and* parameter count on
   the same generations axis. This is the most important graph in the project, because it
   lets you answer a question that matters far beyond fish: **did adding parameters
   actually help?** You will see stretches where params climb and fitness does not move —
   capacity added, nothing learned. Bigger is not better, and here you can watch that be
   true.

Open the brain inspector from Stage 6 while this runs and you can watch new neurons
physically appear in the diagram, generation by generation.

This is a hand-rolled version of **NEAT** (NeuroEvolution of Augmenting Topologies), the
real algorithm this idea comes from. It needs one extra piece — **species**, so a fish
that just grew a new neuron gets a few generations to tune it before being judged against
older, already-optimised fish. Without that, every innovation dies the moment it is born.

*Teaches:* that "how big should my network be?" can itself be learned; innovation
numbers; the capacity-vs-performance relationship; why protecting new ideas matters in
evolution *and* in research.

### Stage 8 — New senses unlock
More rays, longer range, plus the ability to sense **other fish** — and schooling
behaviour (bait balls, splitting, evasive turns) emerges on its own without us ever
programming it. Save/load the best genome to a JSON file so a good fish survives a page
refresh.

### Stage 9 — The shark learns too (co-evolution)
Give the shark a brain and its own fitness (fish eaten per minute). Now both sides
improve — an arms race. Fish get faster and trickier; the shark learns to cut off escape
routes instead of chasing tails.

*Teaches:* co-evolution, the Red Queen effect, and why a moving target is much harder
than a fixed one.

## HUD controls (built up across stages)

Pause · Step one frame · Reset · Speed 1×/5×/50× · Show rays · Show brain ·
Mutation rate slider · Population size · "End generation now" ·
**Click a fish to inspect its brain** · **`n` = step the forward pass one layer** ·
Show mutation log ·
Live readout: generation, alive count, best fitness, **parameter count (flashing +N
when a structural mutation lands)**.

## How we work

- **One stage per turn.** I explain the idea in chat first — with a small diagram where
  it helps — then write the file with a comment on nearly every meaningful line, then
  stop and ask whether you want to go on or dig into something.
- **You drive.** If a stage lands and you want to poke at it for a while (change a weight,
  break something, ask "what if the mutation rate were 10×?"), we do that instead of
  advancing. Understanding beats progress.
- Nothing is hidden in a library. Every number the network computes is computed in code
  you've read.

## Verification

There are no unit tests here — the simulation *is* the test, and your eyes are the
assertion. After each stage, open `index.html` (double-click, or drag into your browser)
and check the specific thing that stage added:

| Stage | What you should see |
|---|---|
| 0 | Fish drift inside a visible tank; shark chases; fish are caught. Nothing ever crosses a wall or reappears on the opposite side — push a fish into a wall and it slides along it. |
| 1 | Coloured rays fanning out from each fish, flaring red near the shark. |
| 2 | A hand-tuned fish turns away from the shark. Change a weight, reload, behaviour changes. |
| 3 | 60 randomly-wired fish swimming uselessly, eaten fast. Baseline fitness ~ low. |
| 4 | Fitness curve climbing over generations; by ~gen 20 fish visibly dodge. |
| 5 | Children visibly carrying traits from two different parents; fitness climbing faster than with cloning alone. |
| 6 | Click a fish → its network appears and pulses as it swims. Pause, press `n`, and watch numbers propagate one layer at a time. Click a neuron and read the actual sum it computed. |
| 7 | `params` counter rising and flashing `+2`; mutation log scrolling in plain English; new neurons appearing in the diagram; the second chart line showing whether the extra parameters actually bought any fitness. |
| 8 | Fish clumping into schools and splitting when the shark charges. |
| 9 | Shark improving too — fitness curves for both sides on the chart. |

If a stage doesn't do what the table says, that's a bug and we fix it before moving on.

---

## Build log

### Stage 0 — DONE
Files: `index.html`, `css/style.css`, `js/{config,rng,vec,fish,shark,world,render,main}.js`

Decisions made while building:
- **Movement model:** a body has a heading and a thrust and moves nose-first only.
  No strafing. `think()` returns `{turn, thrust}` — these two numbers become the two
  output neurons in Stage 3.
- **Speed/agility asymmetry:** shark is faster (105 vs 90 px/s) but turns at roughly
  half the rate (1.6 vs 3.0 rad/s). Turning circles: fish 30px, shark 66px. The fish's
  only possible winning strategy is to turn inside a circle the shark cannot fit in.
- **Wall glide** is implemented as a position clamp with the heading left untouched —
  the into-wall component is absorbed, the along-wall component survives. No reflection,
  deliberately: a bounce is free energy and evolution would abuse it.
- **Integer tick counter**, not accumulated float seconds. `1/60` is not exact in binary,
  so summing it 1800 times gives 29.999999999999996 and a 30-second round silently never
  ends. `world.ticks` is the source of truth; `world.time` is derived for display.
- **Corpses are kept** in the fish array with their final `age`. In Stage 4 that age is
  the fitness score, and the dead are most of the data.
- `world.totalKills` survives rounds; `shark.kills` does not (spawn() rebuilds the shark).

Headless check (`node`, 30 simulated seconds): walls hold for fish and shark, nothing
wraps, fish do reach and glide along the glass, shark catches fish, rounds advance, and
the same seed reproduces the run byte-for-byte.

**Open question carried into Stage 4:** with the current numbers only ~22 of 60 fish are
eaten per 30s round, so most fish survive to the time limit and would tie on fitness.
Weak selection pressure. Fixes to try then: shorter rounds, a faster shark, or scoring
average distance-from-shark as a tie-breaker rather than raw survival time.

### Stage 0.5 — Proper artwork for the fish and the shark — DONE
`render.js` rewritten (72 → 308 lines); small additions to `fish.js`, `shark.js`, `world.js`.

- **Fish:** lens-shaped body with a cross-body gradient (pale spine, dark flanks — the
  trick that makes a flat silhouette look rounded), two swept pectoral fins, a forked
  caudal fin that beats side to side, an eye on each side of the head.
- **Shark:** longer torpedo body, pointed snout, oversized swept pectorals, a dorsal
  ridge seen edge-on along the spine, four gill slits per side, and an asymmetric
  crescent tail with a longer upper lobe — the detail that reads as *shark* rather than
  *big fish*. Plus a drop shadow no other body gets.
- **Water:** vertical depth gradient, 110 drifting plankton motes, corner vignette.
- **Corpses** are now the fish silhouette drained of colour rather than a plain dot.
- `fish.wigglePhase` (constructor arg, fed from `world.rng`) stops all 60 fish beating
  their tails in unison; `shark.age` added purely to drive its tail.

Verified: all eight headless physics checks still pass, 60/60 tail phases distinct, and
every field `render.js` reads is present on the bodies.

**Build note:** the `Bash` tool truncates very long commands, which corrupts a big
heredoc mid-string and produces a confusing `unexpected EOF` from the shell. Write files
over ~150 lines in chunks (`cat >` then `cat >>`).

### Stage 1 — Senses — DONE
New: `js/senses.js`. Changed: `config.js`, `fish.js`, `render.js`, `main.js`, `index.html`,
`css/style.css`.

**Seven inputs, all normalised to 0..1:** five vision rays across a 160° fan (range
170px), wall-ahead (range 130px), own speed. `Senses.COUNT`, `.WALL` and `.SPEED` are
exported so nothing downstream hardcodes an index.

Decisions made while building:
- **Egocentric, never absolute.** No sense is a world coordinate. Ray 2 always means
  "40° off my left shoulder" regardless of where the fish is or which way it faces, so a
  single learned reflex transfers everywhere in the tank. This is the stage's real lesson:
  input representation decides what is learnable at all.
- **Normalised to a common scale** so the network never has to discover wildly different
  weight magnitudes for inputs that matter equally.
- **Analytic ray-circle intersection**, not stepped sampling: project fish→shark onto the
  ray to get `t`, reject if `t < 0` (behind) or `perp > R` (passes beside), otherwise the
  contact is at `t - sqrt(R² - perp²)`. The sense reports the shark's *surface*, not its
  centre.
- **Arrays are allocated once per fish** (`fish.senses`, `fish.rayHit`) and overwritten in
  place. At 50× fast-forward, returning fresh arrays would mean ~180k throwaway
  allocations a second.
- **Wall feeler guards against division by zero** with `1e-9` checks — a fish swimming
  exactly horizontally has `uy = 0`, and the naive version returns NaN.
- **`view` state (mouse focus, ray toggle) lives in `main.js`, never on the world.** Where
  you point your mouse must not be able to influence the fish, or no run is reproducible.
- `think()` deliberately still ignores the senses and wanders at random. Senses without a
  brain change nothing, and seeing that is worth a stage.

**To see it:** hover the tank — the nearest fish gets a ring, its rays draw bright, and
the side panel shows its seven live values. `v` shows every fish's rays at once.

Verified: 14 sensing assertions against hand-computed values (dead-ahead distance, surface
vs centre, rear blind spot, out-of-range, correct ray firing for an off-axis shark, wall
at 100px, wall at the glass, open water, full thrust), plus no NaN and nothing outside
0..1 across a 30s run. All 8 Stage 0 physics checks still pass with byte-identical
numbers — sensing consumes no randomness, so the seeded run is unchanged.

### Stage 2 — One neuron, by hand — DONE
New: `js/brain.js`. Changed: `config.js`, `fish.js`, `world.js`, `render.js`, `main.js`,
`index.html`, `css/style.css`.

`Neuron` = a weight per input, a bias, `tanh`. `fire()` is the whole forward pass. Each
fish gets its own instance (sharing CONFIG's weights array) so it can remember its own
`lastSum`/`lastOut` for the readout. The arithmetic panel shows every multiplication live;
a rudder arc on the focused fish draws the turn it is commanding. `B` toggles between the
neuron and the Stage 0 random wander.

- `world.brainOn` lives on the **world**, not in `main.js` view state, because unlike the
  mouse cursor it changes what the fish do. The test: does it change the simulation, or
  only the picture?
- Sign structure is the lesson — `heading += turn * turnRate * dt`, so negative-offset
  rays need positive weights. The mirror pattern is what makes one neuron mean "turn
  away" rather than "turn always".
- Sense [2] (dead ahead) has no principled value: the geometry is symmetric and a single
  neuron cannot represent "whichever way is better". The tie-break is hardcoded and
  arbitrary. First honest glimpse of what one neuron cannot do.

**FINDING — the hand-wired neuron is worse than no brain at all.** 60s, identical tank,
fish eaten (lower is better):

| strategy | eaten | time on wall | avg dist from shark |
|---|---|---|---|
| random wander | **47** | 21% | 437px |
| turn AWAY (what I wired) | 70 | 40% | 518px |
| turn AWAY, wall weight 0 | 101 | 81% | 556px |
| turn ACROSS (signs flipped) | 58 | 81% | 497px |
| turn ACROSS, twice as hard | 54 | 82% | 512px |
| turn ACROSS + wall avoidance | 65 | 36% | 415px |

Three things fall out of this, and all three change later stages:

1. **In a closed tank, fleeing means running out of room.** Flight doubles time spent
   pinned against the glass (21% → 40%, and 81% with wall-avoidance off). The corner trap
   predicted for Stage 4 has arrived two stages early, and it arrives without any
   evolution at all.
2. **Distance from the predator is a BAD fitness proxy.** Fleeing fish stay measurably
   further from the shark (518px vs 437px) and die more often. This kills one of the four
   Stage 4 fitness fixes listed earlier — scoring average distance-from-shark would
   actively select for the losing strategy. Prefer survival time, or time-alive with a
   movement term.
3. **Turning ACROSS beats turning away** (58 vs 70). That is the turning-circle asymmetry
   (fish 30px, shark 66px) showing up in measured data for the first time.

The default weights are deliberately left at the losing "turn away" setting: the point of
Stage 2 is that reasoning your way to good weights is hard even for seven inputs and one
output, and that is the entire argument for Stage 4. The measured table is reproduced in
`config.js` so any row can be pasted over `turnWeights` and re-run.

Verified: 12 assertions — weighted sum, tanh output, tanh bounding an absurd weight of
900, correct steer-away sign on both sides, mirror symmetry, zero response in empty water,
no NaN, output bounded in play, plus the three assertions recording the finding above.

### Stage 3 — A whole network, wired at random — DONE
Changed: `brain.js` (+`Layer`, +`Network`), `config.js`, `fish.js`, `world.js`,
`render.js`, `main.js`, `index.html`, `css/style.css`.

**Shape: 7 senses → 6 hidden → 2 outputs = 62 parameters.** Every fish gets its own
randomly initialised brain, drawn from `world.rng` so one seed still reproduces every
brain in the ocean. `B` now cycles three brains — random network, Stage 2 hand-wired
neuron, Stage 0 wander — for direct comparison.

Decisions made while building:
- **Flat weight arrays, not arrays of `Neuron` objects.** `weights[i * inputCount + j]`.
  Faster to walk, but the real payoff is Stage 4: mutation becomes one loop over one flat
  array and copying a brain becomes `slice()`.
- **`Fish` now receives its brain as a constructor argument** instead of building one.
  Stage 3 hands it a random network; Stage 4 hands it an *inherited* one, and nothing
  else in the class has to change.
- **`thrust` is rescaled `(tanh + 1) / 2`, not clamped.** Clamping would collapse every
  negative output to "stopped" and waste half the neuron's range.
- **`fish.lastTurn` / `lastThrust`** added so `render.js` reads the decision rather than
  reaching into whichever brain made it; the rudder indicator works in all three modes.
- **Weight init range is `initGain / sqrt(fanIn)`.** Measured saturation — percentage of
  hidden neurons pinned beyond |0.95|, where tanh stops responding to its input:

  | initGain | mean abs activation | pinned |
  |---|---|---|
  | 1 (default) | 0.197 | 0.0% |
  | 4 | 0.578 | 5.6% |
  | 8 | 0.775 | 38.6% |
  | 16 | 0.884 | 71.6% |

  A saturated neuron is a dead neuron: change its input and nothing happens.

**The "before" picture, 60s, identical tank:**

| brain | eaten | time on wall |
|---|---|---|
| random wander (no brain) | **49** | 21.0% |
| hand-wired neuron (Stage 2) | 66 | 40.0% |
| random network 7-6-2 | 58 | 9.5% |

The random network beats my hand-wiring but still loses to the drunkard. Its low wall
time has a specific cause worth knowing: with no shark in view almost every input is
zero, so each output is essentially `tanh(bias)` — a *constant* turn. Random-brained fish
swim in lazy circles of fixed radius, which happens to keep them off the glass. Watch the
hidden bars on a fish in open water: they sit frozen until a ray catches the shark.

Verified: 11 assertions — parameter count, layer widths, two-layer forward pass against
hand arithmetic (twice, second time with awkward numbers), turn bounded, thrust rescaled
into 0..1 rather than clipped, 60/60 distinct brains, no accidental array sharing,
saturation at high init gain, and determinism preserved end to end.

### Stage 4 — Death teaches — DONE
New: `js/evolution.js`, `js/chart.js`. Changed: `brain.js` (+`clone`, +`mutate`),
`rng.js` (+`gaussian`), `config.js`, `world.js`, `main.js`, `index.html`, `css/style.css`.

`world.nextRound()` became `world.nextGeneration()`: score every fish, summarise, breed,
respawn with the children's brains. `spawn(brains)` takes the networks to install, or
null for fresh random ones — that one argument is the difference between a simulation and
a learning system. Speed control `1/2/3/4` = 1×/5×/20×/100×; `n` breeds immediately.

Decisions made while building:
- **Fitness = seconds survived, nothing else.** Explicitly *not* distance-from-shark —
  Stage 2 measured that and it selects for the losing strategy.
- **Tournament selection (size 3), not roulette.** Roulette collapses when scores are
  similar (no pressure) and again when one fish dominates (instant convergence). A
  tournament compares rank only, so it is immune to both.
- **Elitism (4 unmutated copies)** turns best-so-far into a ratchet.
- **Gaussian mutation, not uniform** — most changes small, occasional change large.
- `Layer.clone()` uses `Object.create()` to skip the constructor, and `.slice()` on the
  Float64Array so children get a real new buffer. A shared buffer would mean mutating one
  fish silently mutates its whole family — the classic bug where evolution never improves.

**FINDING — the fitness ceiling was the whole problem.** First run: 8% improvement over
80 generations, with `best` pinned at the maximum from generation 1. Diagnosis: 56% of
fish survived the full generation and scored *identically*, so selection was picking
parents at random from over half the population.

| setup | tied at cap | improvement |
|---|---|---|
| 30s generation (original) | 56% | 8% / 80 gens |
| 30s, shark at 140px/s | 51% | 2% |
| 30s, shark at 180px/s | 46% | 1% |
| **90s generation** | **10%** | **34% / 20 gens** |

Two lessons, both bigger than this project:
1. **A score that saturates cannot teach.** Nothing about the algorithm changed between
   the 8% run and the 34% run — only how well the score distinguishes one fish from
   another.
2. **Too hard is as bad as too easy.** Speeding the shark up *reduced* learning to 1–2%,
   because outcomes stopped depending on skill and started depending on luck. Difficulty
   belongs where being better actually changes the result.

`generationSeconds` is now 90 (and `roundSeconds`/`roundTicks` were renamed to
`generationSeconds`/`generationTicks` — "round" was leftover Stage 0 vocabulary).

**Confirmed run, 50 generations:** mean fitness 36.8s → 52.7s, **+43%**, peaking at 65.3s.

**PREDICTION THAT FAILED — no corner-camping appeared.** The plan expected evolved fish to
wedge into corners and stop moving. They did the opposite: wall time *fell* from 13% to
8.8% as they improved. The reason is that the shark always chases the *nearest* fish, so a
corner is only safe if someone else is closer — and a stationary fish in a corner is easy
to be nearest to. The exploit the plan predicted does not exist against this predator. It
may well reappear in Stage 9 when the shark learns to hunt properly.

**Known limitation:** fitness is noisy between generations (mean bounced 39.9s → 65.3s →
43.0s late in the run) because a brain's score depends heavily on where the shark happened
to go. Each brain is evaluated on exactly one trial. Averaging several trials per brain
would smooth this, at proportional cost.

Verified: 7 assertions — clone independence under full-strength mutation, clone fidelity,
observed mutation rate 14.8% against a configured 15%, tournament winners averaging 44.6
against a population mean of 29.5, elite carried over bit-identical, population size
preserved — plus the 50-generation learning run above.

### Stage 5 — Crossover: two parents, one child — DONE
Changed: `brain.js` (+`crossFrom`, +`crossover`, +`blendHue`, lineage hue on
`random`/`clone`), `evolution.js` (+crossover in `breed`, +`diversity`,
+`geneticSpread`), `config.js`, `render.js`, `main.js`, `index.html`.

Two schemes, both implemented so they could be compared:
- **uniform** — every individual weight is an independent coin flip between parents.
- **neuron-wise** (default) — a whole neuron travels together: all of its incoming
  weights plus its bias come from the same parent.

`crossover.rate` is 0.75, so a quarter of children are still plain mutated clones. That
hedge matters because crossover on neural networks is genuinely risky.

**COMPETING CONVENTIONS** is the reason it might not work at all: hidden neuron #3 in one
parent may mean "threat on my left" while #3 in the other means "wall ahead". The index is
an arbitrary label. Mixing them gives a child whose #3 is half of each — not a compromise
between two good ideas but a broken third thing. This is exactly why NEAT tags connections
with innovation numbers in Stage 7, so crossover aligns genes by *history* rather than by
index.

**MEASURED, 15–20 generations, averaged across seeds:**

| scheme | gain | hue "diversity" | real gene spread |
|---|---|---|---|
| clone only | −4% to −8% | 0.49 | 0.471 |
| uniform crossover | +13% | 0.07 | 0.448 |
| **neuron-wise crossover** | **+19%** | 0.00 | 0.447 |

Neuron-wise crossover beats clone-only by **+23%** and uniform by a clear margin — keeping
each learned feature intact really does limit the damage competing conventions can do.

**FINDING — my first diversity metric was measuring itself.** The lineage-hue number read
0.00 under crossover and 0.49 without, which would have meant crossover destroys variation
*while simultaneously* improving faster. It does not. Crossover **blends hues by
construction**, so the colours converge towards the population average regardless of what
the genes do. Replaced with `Evolution.geneticSpread()` — the mean, over all 62
parameters, of that parameter's standard deviation across the population. It shows gene
variation essentially unchanged by crossover (0.471 / 0.448 / 0.447).

The general lesson, worth more than the fish: **if an operator in your system can move
your metric directly, the metric has stopped measuring the world.** The hue view is kept
as a *visualisation* (it shows family structure beautifully) but the HUD now reports
`gene spread`.

`L` toggles the lineage view: each brain carries a hue down its family tree, clones keep it
exactly, children of two parents get the circular blend. `blendHue` averages hues as
vectors, not as numbers — averaging 350 and 10 naively gives 180, a cyan resembling
neither parent.

Verified: 9 assertions — no invented weights under either scheme, child differs from both
parents, neuron scheme never splits a neuron, parents unmodified, self-crossover equals a
clone, hue blending of 350+10 gives 0 rather than 180, and the diversity metric reading 1.0
spread / 0.0 converged.

### Stages 6 & 7 — The brain inspector, and brains that grow — DONE
New: `js/genome.js` (447 lines), `js/brainview.js`. Changed: `brain.js` (+`graph()`,
+`hiddenCount()`), `evolution.js` (+`speciate`, +`breedSpeciated`, adaptive threshold),
`world.js`, `chart.js`, `main.js`, `config.js`, `index.html`, `css/style.css`.

**Stage 6 — the inspector.** `BrainView` draws whatever `graph()` hands it, so it works
for a growing genome and the fixed Stage 3 network alike. Nodes are laid out in columns by
**depth** (one more than the deepest input), so a new column appears by itself when
evolution grows a neuron. Node fill = live activation (orange positive, blue negative);
connection colour = weight sign, thickness = magnitude; dashed grey = a disabled gene,
still inherited. Click the tank to **pin** a fish; click a neuron to see its arithmetic
with this tick's real numbers, sorted by magnitude. `n` steps the forward pass **one depth
level at a time** — advancing the computation rather than time.

**Stage 7 — genomes.** A brain is now nodes + connections. Generation 1 starts at
**16 parameters** (7 inputs wired straight to 2 outputs, zero hidden neurons) against the
layered network's 62. Four mutations: perturb weight, **add connection**, **add node**
(split a connection, disable the original, insert a neuron with incoming weight 1 and the
original weight outgoing), and **toggle** (a gene switched off keeps its innovation number
and can return). `wouldCycle()` walks forward from the target to guarantee the graph stays
feed-forward.

**Innovation numbers** solve Stage 5's competing-conventions problem properly: the first
time a connection between two particular nodes appears anywhere it gets a permanent serial
number, and splitting a given connection always yields the same node id everywhere. So
crossover aligns genes by **shared history** rather than by index — matching genes mix
freely, disjoint genes are inherited whole from the fitter parent.

**FINDING 1 — my compatibility threshold was 4× too large.** Measured pairwise distances
after 8 generations: min 0.005, median 0.248, max 0.582. My guessed threshold of 2.4 put
the *entire population in one species*, so speciation did nothing and structure never grew.
Replaced with an adaptive threshold that drifts to hold the species count near
`targetSpecies`. **Always measure the scale of a distance before choosing a threshold for
it.**

**FINDING 2 — growing brains did not pay for themselves here.** 30 generations, 60 fish:

| setup | gain | final params | hidden |
|---|---|---|---|
| fixed 7-6-2 network | +12% | 62 (fixed) | 6 |
| growing genome, 8 species | −16% | 22.4 | 1.73 |
| growing genome, 4 species | −5% | 21.4 | 1.30 |
| **growing genome, NO speciation** | **+20%** | **16.0** | 1.13 |

That last row is the important one. With speciation off the parameter count never leaves
16 — every structural innovation is killed in the generation it appears, exactly as the
theory predicts — so the brain stays minimal and simply tunes its 16 weights well, and
that beats everything else. Speciation genuinely *does* enable growth; it just costs more
than it returns at this scale.

Over 80 generations with 9-generation smoothing: no-species 42.1s → 50.3s (+19%),
with-species 42.4s → 47.8s (+13%) but peaking at **60.7s** around generation 61. Higher
ceiling, not reliably better on average.

The honest reading: at 60 fish and under 100 generations there is not enough population or
time for structural innovation to repay its cost. Real NEAT papers use populations of 150+
and hundreds of generations, and that is not an accident. Speciation ships **on** because
watching brains grow is the point of the stage, and `useSpecies: false` is the control.

This is also the exact lesson the parameter line on the chart exists to teach: of the
24 windows where parameters grew, fitness rose in 13 and did not in 11. **Adding capacity
is a coin flip unless something makes it pay.**

Verified: 17 assertions — minimal genome shape, forward pass against hand arithmetic,
add-node growing params by exactly 2 and disabling rather than deleting, **400 random
structural mutations never creating a cycle** (ending at 542 params / 131 hidden), grown
brains still producing finite output, innovation numbers identical across genomes,
crossover never referencing a missing node, distance 0 for a self-copy, 20 identical brains
forming exactly one species, and the inspector's arithmetic panel summing to the neuron's
actual output.

### Bug — the tank froze after Stage 7
**Symptom:** fish completely motionless, nothing responding.

**Cause:** `Evolution.geneticSpread()` was written in Stage 5 against the *layered*
network and indexed `net.layers[...]`. Genomes have no `.layers`, so it threw a TypeError
inside `updateHud()`. That aborted `frame()` before it reached `requestAnimationFrame` at
the bottom, so the loop ran exactly once and stopped. The simulation itself was perfectly
healthy — a readout panel had thrown, and it stopped time.

**Fix 1:** `geneticSpread()` now buckets parameters by *identity* rather than by position,
and identity differs by brain kind. Layered networks share a shape, so position works.
Genomes carry different genes from one another, so position means nothing — weights are
keyed by **innovation number** and biases by **node id**, which is the only thing that
lines up across genomes. Genes held by fewer than two fish are skipped, having no spread
to measure.

**Fix 2 (the more important one):** all drawing and readout code now runs inside a
try/catch in `frame()`, so a presentation bug can never stop the simulation again. The
error is logged once and displayed in the HUD rather than swallowed — it is fenced off,
not hidden.

The general lesson, and it is the same boundary this project has kept since Stage 0: the
simulation must not depend on being drawn. That rule was stated in `render.js` from the
first stage, and the one place it got quietly violated was the crash path.

Verified: 6 assertions — every per-frame call succeeds for *both* brain kinds, gene spread
returns a sensible positive number for both, 54/54 living fish have speed > 1, and mean
thrust is 0.450 rather than pinned at zero.

### Stage 8 — New senses, and keeping what was learned — DONE
New: `js/persist.js`. Changed: `senses.js` (+`readNeighbours`), `evolution.js`
(+`shoaling`), `genome.js` (+`Innovation.absorb`), `world.js` (+`seedFrom`,
+`bestBrain`), `render.js` (+`kinLinks`), `main.js`, `config.js`, `index.html`,
`css/style.css`.

**Three new senses:** how much company there is on the negative side, dead ahead, and the
positive side — each the summed closeness of neighbours in that sector, same sign
convention as the rays. `O(n²)` per tick, which at 60 fish is 1,770 distance checks and
costs nothing; at a few hundred fish it would need a spatial grid, and that is the honest
reason this simulation stays small.

**Deliberately NOT done: "more rays, longer range."** The plan asked for it. Stage 7
measured that a 16-parameter brain beat the 62-parameter one, so extra inputs are not
free. Ray count stays at 5.

**Save / load.** A brain serialises to JSON — for a genome, its node list and connection
list; for a layered network, its weight arrays. The champion of every generation is
autosaved to `localStorage` (in a try/catch: `file://` pages and private windows can throw),
and `save best` writes a file. Loading calls `world.seedFrom()`, which repopulates the whole
tank from that one brain — one untouched copy plus mutated children — so a good brain
becomes an ancestor rather than a stranger. `Innovation.absorb()` takes on a loaded
genome's numbering first, or its innovation numbers could collide with ones this run has
already issued for different connections and crossover would start matching unrelated genes.

**FINDING 1 — the extra senses cost more than they returned, and the gap widened.**

| senses | 30 gens | 60 gens | nearest-neighbour distance |
|---|---|---|---|
| 7 (shark + wall) | **+21%** | **+50%** | 87px → 63px |
| 10 (with kin senses) | +4% | +12% | 86px → 73px |

Same lesson as Stage 7, now on the input side rather than the hidden side: every new
sense adds weights, and weights cost generations to tune. Default is `neighbours: false`.

**FINDING 2 — the schooling never happened, and the way we know is the interesting part.**
The plan promised that "schooling behaviour emerges on its own." It did not. Look at the
last column: **the fish group more tightly in the condition where they are physically
unable to perceive each other.** With `neighbours: false` no fish can detect another fish
by any mechanism whatsoever, and clustering still improved from 87px to 63px — more than
when they could sense each other.

So the clustering is not schooling. It cannot be. It is sixty near-identical brains,
descended from the same few ancestors, reacting to the same shark the same way and
therefore ending up in the same places. Shared genes, not social behaviour.

**A group-shaped pattern is not evidence of a group-detecting mechanism**, and the only
way to tell them apart is to remove the mechanism and check whether the pattern survives.
Here it not only survived, it got stronger. Had the kin senses shipped on by default, the
tighter grouping would have looked exactly like emergent schooling and the write-up would
have claimed it.

Verified: 15 assertions — sense layout grows by exactly three, each sector registers on
the correct side, a fish alone senses nothing, closeness beats mere presence, a saved
brain behaves bit-identically after a JSON round trip (112 params, 30 hidden), malformed
files rejected rather than half-loaded, a brain built for a different sense layout refused
with a clear message, and `seedFrom` repopulating with one exact copy plus mutated children.

---

## Stage 9 — the shark learns — NOT BUILT, by request

Co-evolution is deliberately left unimplemented: the user asked for the remaining stages
**without giving the shark a brain**. The shark stays as it has been since Stage 0 — aim
at the nearest fish, swim flat out, turn no faster than 1.6 rad/s.

That is not only a concession. A fixed predator is a **fair measuring stick**: every
fitness number in this document is comparable across every stage precisely because the
thing being escaped never changed. Had the shark improved alongside the fish, a rising
fitness curve would have been ambiguous — better fish, or a worse shark that generation?

The one thing Stage 9 would have tested is the corner-camping prediction from Stage 4,
which failed against a shark that always chases the nearest fish. It might well reappear
against a predator that learns to cut off escape routes. That remains untested.

---

## Investigation — "fish still get eaten easily after 120 generations"

The report was correct, and the cause turned out to be more serious than slow learning.

### The decisive measurement

Give **every fish an identical brain** and score them. Any spread in the results is
therefore pure luck, because there is no skill difference to measure.

| population | mean | sd | range |
|---|---|---|---|
| 60 **different** random brains | 41.8s | **24.5s** | 0–90s |
| 60 copies of the **same** brain | 44.2s | **24.5s** | 0–90s |

Identical spread. **100% of what selection was reading was luck.** For 120 generations it
had been sorting fish by where they happened to spawn and whether a shark happened to come
at them, not by how well they escaped.

The cause is in one further number: a fish had a shark in view only **5% of a generation**.
It was being *tested* 5% of the time; the other 95% was the clock ticking while nothing
happened. Survival time mostly measured "nothing happened to me".

### Fixes

1. **Trial averaging** (`evolution.trials: 4`). Each brain is now scored as the *mean* of
   several runs from fresh positions. Noise falls as `sqrt(trials)` while real skill —
   the part that repeats — is untouched. Measured spread among identical brains fell from
   **26.8s to 5.5s**. It costs `trials`× the compute per generation, which is the trade.
2. **Randomised shark spawns.** Sharks used to start in a fixed corner every time, which
   let fish evolve against one specific opening move and correlated every trial with every
   other. They now spawn anywhere.
3. **Multiple sharks supported** (`shark.count`). Tried and rejected as a default: 3
   sharks cut mean survival from 37s to 11s — past "harder" into "hopeless", which
   destroys the signal the same way too-easy does. Left at 1.
4. **`generationSeconds` 90 → 60**, since a generation now costs `trials`× as much.

### A bug found on the way
`spawn()` declared its margin `const m = 40` *inside* the fish loop, and the new shark
spawn code referenced `m` after it. A `ReferenceError` at runtime that `node --check`
cannot catch, because it is scoping, not syntax.

### Held-out benchmark — the honest scoreboard
Percentage gains are not comparable across training regimes, so every champion was judged
on the **same** test: 1 shark, 90s, 12 seeds never used in training.

| brain | benchmark | vs random |
|---|---|---|
| 14 untrained random brains | **36.8s** (sd 4.7, best 46.2) | baseline |
| trained 30 gens, **1 trial** (the old default) | **24.7s** | **worse than random** |
| trained 30 gens, 4 trials | 45.0–46.7s | +1.7 to +2.1 sd |
| trained 45 gens, shipping defaults | **56.7s** | **+4.2 sd** |

The old single-trial configuration was producing brains **worse than random** on unseen
conditions — it was fitting noise, and the rising fitness curve on screen was measuring
how well it fitted that noise. With trial averaging the same 45 generations now beat the
best of fourteen random brains.

**The lesson:** a learning curve that goes up is not evidence of learning. It is evidence
that the score went up. The only way to know whether anything was learned is to evaluate
on conditions the thing was never selected under — and the single cheapest diagnostic in
this whole project was cloning one brain sixty times to see how much the score moved on
its own.

### Also repaired
Four test suites had gone stale against later refactors (`world.shark` → `world.sharks`,
`fish.brain` → `fish.handNeuron`, `world.brainOn` → `world.mode`) and were silently passing
by comparing a config against itself. Stage 2's comparison now correctly reports 125 eaten
for the hand-wired neuron against 41 for the drunkard.

---

## The offline trainer — `train.js`

**The diagnosis that mattered.** In a tank of 60 fish there is one shark, and it chases
the *nearest* fish. The other 59 are safe for free. So "seconds survived" mostly measured
**whether somebody else was closer** — position luck, not escape skill. That is why
trained brains kept benchmarking no better than random ones: the thing being selected for
was not the thing we wanted.

`train.js` evaluates every brain **alone**, in a private tank with one shark and no other
fish. The shark has nothing else to chase, so survival time can only come from escaping.

```
node train.js                      100 generations, resuming from the saved champion
node train.js --gens 300           longer
node train.js --fresh              ignore the champion, start over
node train.js --pop 120 --trials 6
```

**Is the task even winnable?** Measured before tuning anything — a *brainless* constant
turn, one fish, one shark, 60s max:

| strategy | survival |
|---|---|
| swim straight | 5.8s |
| circle r=103px | 5.2s |
| **circle r=56px** | **27.1s** |
| circle r=39px | 4.3s |
| circle r=30px (tightest possible) | 4.4s |

Winnable, and the winning radius is *just under the shark's 66px turning circle* — tight
enough that the shark can never line up, wide enough not to be cornered. Note how narrow
the peak is: 56px works, 39px does not. A deceptive fitness landscape, which is exactly
the kind evolution is good at and hand-tuning is bad at.

**Result: 4.5s → 51.3s** of a 60s maximum, across 200 accumulated generations. The brain
grew from the minimal **16 parameters to 53, with 8 hidden neurons** — comfortably beating
the hand-made circler's 27.1s.

| generation | held-out survival | params |
|---|---|---|
| 5 | 3.4s | 16 |
| 25 | 31.7s | 19 |
| 45 | 40.0s | 27 |
| 110 | 46.0s | 31 |
| 200 | **51.3s** | **53** |

**Growing parameters finally paid off** — and it only paid off once selection was
measuring the right thing. Every earlier experiment concluding "more parameters hurt" was
run under a fitness signal that was 100% noise.

### Persistence — the project accumulates
- `champions/best.json` — the best brain ever, by held-out benchmark
- `champions/best.js` — the same brain as `window.CHAMPION = {...}`. A `file://` page
  cannot `fetch()` a local JSON file (CORS forbids it) but it *can* load a script tag, so
  this is how the browser picks the champion up with no server.
- `champions/archive/gen00110-46.0s.json` — every improvement kept, never overwritten
- `champions/history.json` — one row per training run, so total generations accumulate
  across sessions

`index.html` loads `champions/best.js` and starts the tank from the champion and its
mutated children. Buttons: **load champion**, **start random**, **save best**, **load
file**, **restore last**.

### Two bugs found building it
1. **`spawn()` scoping** — `const m = 40` was declared inside the fish loop and the new
   shark-spawn code referenced it afterwards. A runtime `ReferenceError` that
   `node --check` cannot see, because it is scoping, not syntax.
2. **The evaluation tanks were evolving.** When the lone fish died, `aliveCount()` hit
   zero and `world.update()` called `nextGeneration()` — which bred, issued innovation
   numbers, and **adapted the shared species threshold**. Thousands of evaluations dragged
   it from 0.25 to near zero, at which point every brain landed in a species of its own,
   each species got a quota of one, and selection stopped happening entirely. The trainer
   was faithfully copying the population forward and calling it evolution. Fixed by
   `CONFIG.evolution.enabled = false` in the trainer, since it does its own breeding.
   Also `Innovation.reset()` must run once at startup or the first grown neuron gets id 0,
   colliding with an input node.

### On the shark staying brainless
It is effective through physics, not intelligence: it is simply faster than every fish
(105 vs 90 px/s). Its one exploitable weakness is the turning circle — 66px against the
fish's 30px — and that is precisely the weakness the champion learned to use. Giving it a
brain would teach it interception and herding, and would also destroy the fixed measuring
stick every number in this document depends on.

---

## "The brainless shark still beats the champion"

Three separate causes, all measured.

### 1. The page was un-training the champion
The browser scores fish **in a crowd**, where one shark can only chase one fish and the
other 59 are safe for free. Selecting on that rewards "do not be the nearest fish", which
is not escaping. Measured on the champion's solo survival:

| | survives alone |
|---|---|
| champion as loaded | **48.3s** |
| after 12 generations of browser evolution | **17.3s** |

Twelve generations on screen destroyed two hundred generations of training. Evolution now
defaults **OFF** in the page, `E` toggles it, and with it off the same brains re-run from
new positions instead of being thrown away. (Previously, evolution-off spawned *fresh
random brains* each generation — a champion survived exactly one generation on screen.)

### 2. The seeding mutation was damaging the champion
Loading a champion built one exact copy plus 59 *mutated* children. 16 fish over 60s,
share of the tank eaten:

| mutation strength | eaten |
|---|---|
| **0** | **20%** |
| 0.05 | 38% |
| 0.15 (the old default) | 61% |
| 0.35 | 48% |

`seedFrom(brain, false)` now clones exactly when displaying a finished brain. Children are
only jittered when we are about to evolve from it.

### 3. A brain that is superb alone is not good in a crowd
This was the real one. Sixty identical brains make identical turns, converge onto the same
evasive circle, and pack into one moving line (mean neighbour gap 39px) that the shark
harvests. **Individually excellent, collectively suicidal.**

So the trainer gained `--clones N`: each brain is scored as a **school of itself**, on the
*mean* survival of the whole shoal, which forces it to evolve spreading out — using
nothing but the senses it already has.

```
node train.js --clones 8 --gens 40 --pop 40 --secs 45
```

Result after 40 generations (seeded from the solo champion): **39.9s of 45s mean survival
for the entire school**, 65 parameters, 11 hidden neurons.

Share of tank eaten over 60s, solo-trained champion vs shoal-trained:

| fish | solo-trained | shoal-trained |
|---|---|---|
| 8 | 35% | 23% |
| 16 | 29% | **20%** |
| 24 | — | **15%** |
| 30 | 25% | 28% |
| 60 | 66% | — |

Tank size is now **24**, the measured best.

Champion files are kept per mode — `best.json` (solo) and `best-shoal8.json` — because a
solo score and a shoal score measure different things and must never overwrite each other.
A champion loaded from a different mode keeps its brain but discards its score, so the new
scoreboard starts honestly.

**The lesson:** the champion was never broken. It was optimised for a task nobody was
watching. "Can one fish escape?" and "can a school survive?" are different objectives, and
a system trained on the first will happily fail the second while every number on its own
scoreboard keeps going up.
