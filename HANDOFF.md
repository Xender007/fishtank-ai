# HANDOFF — read this first

A from-scratch neural network project: a tank of fish evolving to escape a shark.
No libraries. Every weight, every forward pass, every mutation is code in this repo.

It was built as a **teaching project** — the user is a comfortable coder who is new to
AI/maths and wants to understand, not just run, what is here. That shapes everything:
the code is heavily commented with *why*, decisions are measured rather than assumed, and
several deliberate wrong turns are preserved because the failure taught more than the fix.

**Status:** working. Existing 244-generation champion retained; 127 tests passing.

## Current update: multi-step escape planning (social-v2, 2026-09-21)

Fish now compare a 0.48s initial dodge with alternative exit turns over a 1.92s
horizon. Close encounters also consider braking to 60% thrust before accelerating.
The old planner only compared one constant turn at full thrust over 1.2s. Both
use the same trained neural reflex, social perception and physical limits.

Only the first action is applied; routes are replanned every six ticks. Forecasts
check the closest approach between samples as well as wall contact. The focused
fish shows its chosen manoeuvre and a dotted gold route. Browser updates have a
12ms work budget per frame to keep high-speed controls responsive; physics still
uses fixed timesteps. Requested fast-forward can run slower on limited hardware.

Fresh validation: `node tests/planner_benchmark.js 12 60 3100007`, 45 fish,
unchanged predator and champion, identical starts for old/new controllers:

| Controller | Eaten | Mean survival | Grouped after 10s |
|---|---:|---:|---:|
| Previous social-v1 | 39.63% | 48.74s | 66.27% |
| Current social-v2 | 7.78% | 57.44s | 70.14% |

All 12 seeds improved in survival. This is 80.4% fewer deaths on this validation
set, not a guarantee of survival. Raw rows: `tests/results/social-v2-validation.jsonl`.
The prior implementation is frozen in `tests/fixtures/schooling-v1.js` for paired
benchmarks only. `tests/planner_test.js` adds nine assertions; all 127 tests pass.
Chrome verified route drawing, the inspector, and the high-speed frame budget
(20.9ms including drawing in the smoke check). Trainer smoke also passed.

Training now uses `best-social-v2-shoalN.json` and a new evaluation signature.
Existing champion weights/history and the predator code were not changed.

## First coordinated controller (social-v1, 2026-09-21)

The current request supersedes the old stage-by-stage stopping instructions and
the earlier assumption that schooling must emerge from neural weights alone.
`js/schooling.js` now adds an explicit social/planning layer around the unchanged
seven-input champion. This is a hybrid controller, not newly trained neural weights.

- 45 fish initially form five packs of nine. Each pack has exactly one alpha.
  Membership is stable until casualties require rebalancing; packs have at least
  seven while enough fish remain. Fewer than seven total survivors form one remnant.
- Alphas scan farther (260px); followers see 170px. Nearby movement can be sensed
  within 65px. Local alarms travel 150px per hop using previous-tick messages.
  Original observation timestamps expire after 2.5s, preventing endless rumours.
- Followers maintain spaced trailing positions. Threatened fish temporarily scatter,
  compare 1.2s escape routes, then regroup. The neural turn is a candidate and prior.
  All bodies retain their existing speed, turn limits and wall-clamping physics.
- Gold alpha labels, pack rings, orange warnings, pack links and a focused-fish
  readout expose role, behaviour, warning source and final movement commands.
- Predator remains brainless. More than three consecutive full rotations in one
  direction triggers a 1.4s opposite turn; ordinary chasing then resumes.

Historical v1 measurement using `node tests/schooling_benchmark.js 12 60`: same champion, 45 fish,
12 paired seeds, both conditions facing the updated predator. Neural only: 47.78%
eaten, 42.66s mean survival. Hybrid: 35.00% eaten, 50.40s survival. Schooling is not
perfect: after 10s, 67.66% of sampled living fish had at least six packmates within
140px; fleeing and regrouping temporarily separate packs. These seeds were used for
development evaluation, not an independent claim of optimality.

`node tests/run-all.js` includes 26 new behavioural assertions. The runner now
fails for crashed or missing suites instead of silently reporting zero tests.
`node tests/schooling_benchmark.js` is a read-only benchmark; it never saves brains.

Training: `node train.js --clones 45 --gens 40 --pop 40 --secs 45` evaluates the
hybrid controller. `--neural-only` evaluates the learned reflex alone. New scores
use `best-social-v1-shoal45.json` (or the corresponding population/regime), with an
environment signature; incompatible old scores are remeasured. The original
champion JSON and historical records were not overwritten by this update.

The findings below remain historical evidence. Earlier predator benchmarks are
not directly comparable now that the requested circle-breaking rule is active.

---

## Run it

```bash
# Watch the trained champion (no server, no build step)
double-click index.html          # or: start index.html

# Train more. Resumes from the saved champion automatically.
node train.js --clones 8 --gens 40 --pop 40 --secs 45
node train.js --gens 100                  # solo duelist instead of a shoal

# Tests
node tests/run-all.js                     # 127 assertions
```

---

## What is where

```
index.html         Loads js/* as plain <script> tags IN ORDER, then champions/best.js
js/config.js       EVERY tunable number, with the measurement that chose it
js/rng.js          Seeded generator (mulberry32) + gaussian. Never use Math.random().
js/vec.js          2D helpers as loose functions on plain numbers (no allocation)
js/senses.js       World -> 7 numbers, all 0..1, all egocentric
js/brain.js        Neuron, Layer, Network (the fixed 7-6-2 net from Stage 3)
js/genome.js       Genome + Innovation (NEAT-lite: brains that GROW). The default.
js/evolution.js    Fitness, tournament, crossover, speciation, diversity metrics
js/fish.js         Body + think(). The brain plugs in here.
js/schooling.js    Packs, alpha election, perception, alarms, memory, escape planner
js/shark.js        Predator. Deliberately brainless — see "The shark" below.
js/world.js        The tank. Owns state, advances it, NEVER draws.
js/render.js       Draws. NEVER mutates. Top-down view.
js/brainview.js    The Stage 6 inspector: draws any graph(), reads its arithmetic
js/chart.js        Fitness + parameter count per generation
js/persist.js      Brain <-> JSON, with validation
js/main.js         The loop, view state, all DOM wiring
train.js           Offline trainer. This is where real learning happens.
tests/             8 suites + run-all.js
champions/         best.json (solo), best-shoal8.json, best.js (page loads this),
                   archive/ (every improvement, never overwritten), history.json
PLAN.md            The full build log, stage by stage, with every measurement
```

**Load order matters.** These are classic scripts, not ES modules, because browsers block
`import`/`export` on `file://` URLs and the project must open with a double-click. Each
file defines a global and may only use globals defined above it. `genome.js` must come
after `brain.js` (it borrows `blendHue`).

---

## Current configuration

| | |
|---|---|
| brain kind | `genome` (grows). `layered` is the fixed 7-6-2 net, kept for comparison |
| tank | 45 fish, 1 shark, 900x600 closed box |
| senses | 5 rays over 160°, wall-ahead, own speed = **7 inputs** |
| generation | 60s, 4 trials averaged |
| page evolution | **OFF** by default (see finding #3) |
| champion | shoal-trained: 39.9s/45s mean shoal survival, 65 params, 11 hidden |

---

## Invariants — breaking these has already cost real debugging time

1. **`update()` never draws; `render.js` never mutates.** This is what makes 100x
   fast-forward possible. It was stated in a comment from day one and quietly violated
   exactly once — via the crash path, where a throwing readout aborted `frame()` before
   `requestAnimationFrame` and froze the whole tank. Drawing now runs inside a try/catch.
   A comment is not enforcement.
2. **View state lives in `main.js`; simulation state lives on `world`.** The test is
   simple: does it change the simulation, or only the picture? Mouse position is view.
   `world.mode` is simulation.
3. **Fixed timestep, integer tick counter.** `world.ticks` is the source of truth;
   `world.time` is derived. Never accumulate a float you will compare against a threshold
   — `1/60` summed 1800 times is 29.999999999999996, and a 30s generation silently never
   ends.
4. **One seeded RNG for the simulation; decoration gets its own.** The plankton use
   `Rng(9999)`. If they drew from `world.rng` they would shift every fish spawn and
   destroy reproducibility.
5. **Reading a fitness after a generation flips gives you a newborn with age 0.** This bug
   has now appeared *three separate times* in measurement harnesses. Hold references
   (`const watched = w.fish.slice()`) and stop at `generationTicks - 1`.
6. **The trainer's evaluation tanks must not evolve.** `CONFIG.evolution.enabled = false`
   in `train.js`. When a lone fish dies, `world.update()` calls `nextGeneration()`, which
   breeds, issues innovation numbers, and adapts the shared species threshold. Thousands
   of evaluations dragged it to near zero, every brain landed in its own species, each got
   a quota of one, and selection stopped happening entirely — while the logs looked fine.
7. **`Innovation.reset()` exactly once per run.** The trainer sets `World.keepInnovation`
   so throwaway worlds do not wipe the numbering, then resets once itself. Skip it and the
   first grown neuron gets id 0, colliding with an input node.

---

## Measured findings — do not re-derive these, and do not overturn them without numbers

**1. Crowd fitness does not measure escape.** One shark chases the *nearest* fish; the
other 44 are safe for free. "Seconds survived" therefore mostly measures whether somebody
else was closer. This is why in-browser training produced brains no better than random for
a very long time. `train.js` evaluates brains alone (`--clones 1`) or as a school of
themselves (`--clones N`).

**2. With one trial, 100% of the fitness spread was luck.** 60 copies of the *same* brain
scored with sd 24.5s — identical to 60 genuinely different brains. Trial averaging
(`evolution.trials: 4`) cut that to 5.5s. **The cheapest diagnostic in this whole project
is cloning one brain N times and seeing how much the score moves on its own.** Reach for
it first, not last.

**3. The page's own evolution destroys trained brains.** Champion solo survival: 48.3s
before, **17.3s after 12 generations in the browser**. Evolution is off by default there;
`E` toggles it. With it off, the same brains re-run from fresh positions.

**4. A score that saturates cannot teach.** At 30s generations, 56% of fish survived to
the cap and scored *identically*; learning was 8% over 80 generations. At 90s only 10%
tied and the same code improved 34% in 20 generations. Nothing about the algorithm
changed.

**5. Too hard destroys the signal exactly like too easy.** Three sharks cut survival from
37s to 11s and learning fell to 1-2%. Outcomes stopped depending on skill.

**6. Measure a distance before choosing a threshold for it.** The compatibility threshold
was guessed at 2.4; actual pairwise distances ran 0.005-0.582. Every genome landed in one
species and speciation did nothing at all. It is now adaptive, targeting a species count.

**7. A metric your own operators can move is not measuring the world.** Lineage-hue
"diversity" read 0.00 under crossover and 0.49 without — because crossover *averages hues
by construction*. Real genetic spread was unchanged (0.447 vs 0.471). Use
`Evolution.geneticSpread()`, which reads the weights themselves.

**8. Neuron-wise crossover beats uniform** (+23% vs clone-only, against +13%). A neuron is
a learned feature and its incoming weights only mean anything as a set. Innovation numbers
fix the deeper "competing conventions" problem properly, by aligning genes on shared
history rather than array index.

**9. Schooling never emerged, and the way we know matters.** Fish clustered *more tightly*
in the condition where they were physically unable to perceive each other. That clustering
is shared ancestry — near-identical brains reacting identically — not social behaviour.
`senses.neighbours` is off by default; it cost fitness and bought nothing.

**10. The task is winnable, and the winning move is narrow.** A *brainless* constant turn
at radius 56px survives 27.1s alone; at 39px, 4.3s. The peak sits just under the shark's
66px turning circle. Evolution found it and went well past it (51.3s solo).

**11. Individually excellent is not collectively good.** Identical brains make identical
turns, converge on the same evasive circle, and pack into a line the shark harvests. The
solo champion lost 66% of a 60-fish tank. Training with `--clones 8` — scoring the *mean
survival of a whole school* — fixed it. This is the single most important idea to keep in
mind before changing the objective.

---

## Predictions that turned out wrong

Kept on purpose. They are in `PLAN.md` next to the reasoning that produced them.

- **Corner-camping never appeared.** Stage 4 predicted evolved fish would wedge into
  corners and stop moving. Wall time *fell* as they improved, because the shark chases
  the nearest fish and a stationary fish in a corner is easy to be nearest to. It may
  reappear against a predator that learns to cut off escape routes.
- **"More parameters hurt"** was measured repeatedly in Stages 7-8 and was **wrong** —
  every one of those measurements was taken under the broken 1-trial selection that was
  100% noise. Once selection worked, the growing genome beat the fixed network and
  parameters climbed 16 -> 65 while performance improved. Be suspicious of any conclusion
  drawn before finding #2 was fixed.
- **The hand-wired neuron** (Stage 2) was comprehensively beaten by a random drunkard:
  125 eaten vs 41. Left in as the default weights, because that is the argument for
  learning weights at all.

---

## Recurring bug patterns in this codebase

- **Reading state after a generation flip.** Three separate harnesses reported nonsense
  (a champion "surviving 1.1s") because `world.update()` respawned the tank mid-loop.
- **Block scope.** `const m = 40` declared inside a loop, used after it — a runtime
  `ReferenceError` that `node --check` cannot see.
- **Tests going stale after refactors.** `world.shark` -> `world.sharks`, `fish.brain` ->
  `fish.handNeuron`, `world.brainOn` -> `world.mode`. One suite silently compared a config
  against *itself* and reported a tie for several stages. Run `node tests/run-all.js`
  after any rename.
- **Writing long files through a shell heredoc** truncates and produces a misleading
  `unexpected EOF`. Write files over ~150 lines in chunks.

---

## Open problems / what to do next

1. **The champion is trained at 8 clones but displayed at 45.** Objective mismatch. Fix
   with `node train.js --clones 45 --gens 40 --pop 40 --secs 45` (slower: 45 fish per
   evaluation). Expect ~20-30 min.
2. **Benchmark variance is still high** — between-seed sd of 12-21 percentage points on
   tank-survival measurements. Any A/B with fewer than ~10 seeds is untrustworthy; a
   5-seed comparison already disagreed with a 12-seed one by 15 points.
3. **`Evolution.fitness()` is still raw survival time.** It works, but see finding #1 —
   it only means what you want when the evaluation isolates the fish. If anyone reinstates
   in-browser training as the primary path, this needs rethinking first.
4. **The shark has no brain, by explicit user instruction.** It is effective through
   physics (105 vs 90 px/s), not intelligence; its one weakness is its 66px turning circle
   against the fish's 30px, which is exactly what the champion learned to exploit. Keeping
   it fixed also preserves the measuring stick: every number in `PLAN.md` is comparable
   across stages *because* the thing being escaped never changed. **Do not give it a brain
   without asking.**
5. **Kin senses (`senses.neighbours`) are built and off.** Turning them on changes
   `Senses.COUNT`, which invalidates every saved champion — `Persist.fromJSON` will refuse
   them with a clear message, which is by design.

---

## How to work on this

The user wants to **understand**, not just receive. That means: explain the idea before
writing the code, measure claims instead of asserting them, and report failures plainly —
several of the most valuable moments in this project were things that did not work. When a
measurement contradicts something stated earlier in `PLAN.md`, say so directly and record
the new number; the log is a record of what was learned, including what was unlearned.

`PLAN.md` is the full history, stage by stage, with every table. This file is the
orientation. Between them, nothing here should need re-deriving.

---

## Recurrence — the brain can now remember

Until this change `wouldCycle()` rejected every loop, so the learned network was
**strictly feed-forward and had no state at all**. It could only answer "given exactly
what I see this instant, what do I do?" It could not tell a shark closing from one
leaving, could not time a break, and could not remember a threat that had passed into its
blind spot. The schooling layer bolted memory on by hand; the network itself had none.

**How it works.** The candidates `mutateAddConnection()` used to *reject* are exactly the
ones that give a network memory, so they are now kept and flagged `recurrent`. A recurrent
edge reads its source's value from the **previous tick**:

- `forward()` snapshots the whole value array into `prev` before recomputing anything, so
  a loop always reads last tick's value regardless of node numbering. Without the
  snapshot, whether a loop saw old or new data would depend on evaluation order and the
  same genome would behave differently depending on how its nodes happened to be numbered.
- The depth pass **skips recurrent edges**, which is what keeps the graph topologically
  sortable even though it now contains cycles.
- `CONFIG.genome.recurrentRate` (0.35) is the share of add-connection attempts that go
  looking for one. **Set it to 0 for the old behaviour** — that is the control.

**Two bugs this surfaced, both now fixed and tested:**
1. `mutateAddNode()` split *any* enabled connection into two forward edges. Splitting a
   memory edge therefore turned a loop into two forward connections, putting a backwards
   edge into the feed-forward set and breaking the ordering the forward pass depends on.
   The outgoing half now inherits the original's recurrence, preserving the delay.
2. The arithmetic panel read current-tick values for every edge, so any sum involving a
   memory edge did not add up. `graph()` now exposes `prevValue` and `BrainView.terms()`
   picks the right one per edge, labelling it "(last tick)".

`tests/memory_test.js` (12 assertions) pins the behaviour down, including the one that
matters: **under a constant input a recurrent brain produces a changing output**
(0.3799 → 0.6303 → 0.7475 → 0.7905, settling at 0.8108) while a feed-forward one returns
the same number forever.

Note for anyone comparing two recurrent brains: their output depends on their *history*,
so they must be run from a clean state for the same number of ticks. `rebuild()`
reallocates the value arrays, which is how you reset it. The first version of that test
failed for exactly this reason.

---

## What else would make the fish smarter — ranked

1. **Close the blind spot.** Vision is a 160° forward arc, leaving **200° behind them
   dark** — and a faster pursuer attacks from behind. Real prey fish have near-360°
   vision. `CONFIG.senses.fov` and `rayCount` are the knobs; an earlier 25-generation test
   was too noisy to call, and it deserves a proper run now that selection is sound.
2. **An explicit closing-rate sense.** Rays report distance only. Memory lets the network
   *derive* rate of change, but handing it the derivative directly is far cheaper to learn
   than discovering differentiation from scratch.
3. **A harder task.** At one shark the shoal already survives 97% of a generation, so the
   score has saturated and selection has almost nothing to choose between brains. Nothing
   above will show up in the numbers until this is fixed — more sharks, longer
   generations, or a faster predator.
4. **Lifetime learning.** Everything here is learned *between* generations. Hebbian or
   neuromodulated plasticity would let a fish adapt *within* its own life. This is the
   largest remaining architectural jump, and the biggest amount of work.
5. **Co-evolving the shark.** Deliberately not done — the user asked for a brainless
   shark, and a fixed predator is also what keeps every number in `PLAN.md` comparable
   across stages.

---

## Housekeeping — pruning and continuous training

`train.js` now prunes `champions/` at startup (disable with `--no-prune`, or run it
alone with `--prune-only`).

**What gets deleted:**
- **Obsolete brains** — any saved file whose input count differs from the current
  `Senses.COUNT`. When vision widened from 5 rays to 9, every older champion became
  permanently unloadable: `Persist` refuses them because their inputs mean something
  different now. They cannot be run, compared or resumed from. The first prune removed
  **49 files**.
- **Superseded archives** — snapshots that are neither among the best `--keep N`
  (default 6) nor among the two most recent. The two-newest rule exists so a run in
  progress can never delete the snapshot it just wrote.

**What is never touched:** `history.json` (the accumulating record across sessions —
currently 12 runs up to generation 320) and `training-progress.json`.

**Continuous improvement:** `--repeat N` runs N cycles back to back, each resuming from
the champion the last one saved and pruning first, so one command can be left running:

```bash
node train.js --clones 12 --sharks 2 --gens 40 --repeat 10
```

Cycles rather than one large `--gens` because each cycle re-reads the saved champion,
re-runs the held-out benchmark and writes a history row. If a cycle goes badly the next
starts from the last brain that actually scored well, instead of carrying a bad
population forward for hours.

**A trap this exposed:** four test suites hard-coded the champion's filename. That name
moves — it is derived from the training regime — and pruning can remove it outright. They
now resolve whatever champion is on disk and skip cleanly when there is none. A test that
depends on a generated artefact must not assume its name.

---

## Performance — the speed control is a request, not a promise

MEASURED throughput, 1.5s samples after JIT warm-up:

| configuration | ticks/s | real-time multiple |
|---|---|---|
| 45 fish, schooling planner on | 231 | **3.9×** |
| 45 fish, schooling planner off | 6045 | **100.8×** |
| 24 fish, planner on | 593 | 9.9× |
| 12 fish, planner on | 1217 | 20.3× |

**The hand-written planner costs about 26× the neural network it wraps.** Pack
organisation, the alarm relay and a short-horizon route search per fish dominate
everything else; plasticity and the genome forward pass are free by comparison.

So pressing `4` (100×) on a 45-fish tank delivers roughly 4×. The HUD now shows the
achieved figure beside the requested one and turns amber when they diverge — a control
that silently fails to do what it says is worse than no control.

Two ways to actually go fast:
- **`js/config.js` → `schooling.enabled: false`** for a 26× speedup, at the cost of the
  coordinated behaviour.
- Fewer fish. The planner is superlinear in population.

One real waste was found and removed: `Schooling.organise()` ran **twice per tick** —
once inside `prepare()` and again after `resolveEating()` — rebuilding packs, re-sorting
members and re-electing alphas on a population that had not changed. It now runs after
eating only when a fish was actually caught. Worth perhaps 5%; the planner is the real
cost.

### Canvas sharpness
All three canvases are now sized in **device pixels** with the context pre-scaled by
`devicePixelRatio`, and pinned to their logical size in CSS. Previously the buffer was
1:1 with CSS pixels and the browser upscaled everything on a high-DPI screen, which is
what made the neuron labels and their animation look smudged. Drawing code still works in
logical coordinates and knows nothing about it; `VIEW_SIZE` holds those logical sizes and
must be used instead of `canvas.width`, which is now a device-pixel count.

The frame loop also budgets **time** (9ms) rather than a step count. A fixed 4000-step
ceiling meant frame duration swung with the tank's cost, so at high speed a frame took
longer than a frame and the motion smeared.

### Incident — main.js was truncated during an edit
A patch computed `slice(start, indexOf(marker))` where the marker no longer existed.
`indexOf` returned −1, `slice(start, -1)` took everything to the end of the file, and the
replacement wrote over 360 lines. Recovered from a stale backup plus re-applying the
later work, verified by checking that every `getElementById` in `main.js` resolves against
`index.html` and vice versa.

**Never pass an unchecked `indexOf` result as a slice bound.** Assert the marker was found
first — a negative index is silently valid and means the opposite of what you intended.

---

## Continuous life — a population instead of a series of generations

`CONFIG.life.continuous` (toggled in the page by **TIMER: generations reset on a clock**)
switches the simulation from a generational model to a steady-state one.

**Generational (default):** the clock runs out, every fish dies at once, the best are
bred, and a fresh cohort of identically-aged adults appears. Clean to measure, nothing
like an ecology.

**Continuous:** the clock never resets. A mature fish accumulates energy simply by staying
alive, and spends it on one offspring — a cross with its nearest mature neighbour, or a
mutated clone of itself. Nothing scores anybody, nothing is culled, no tournament runs.
**Selection happens because fish that survive long enough to afford a child leave
descendants and fish that are eaten do not**, which is a good deal closer to how selection
actually works.

### Growing up
A newborn is 40% of adult size, moves at 45% of adult speed and turns at 60% of adult
rate, reaching full ability over `matureSeconds` (18s). It inherits its parents' reflexes
and none of the body to execute them. Juveniles draw smaller and washed out; collision
uses each fish's own radius, so being small is the one advantage a baby has.

### Whose job the young are
This is the part that makes the pack leader's role real rather than decorative:
- a **juvenile** pulls hard toward the middle of its pack, harder the younger it is;
- an **adult** holding a known threat finds the nearest juvenile and *interposes* —
  steering for the point between the young fish and the danger, the alpha more strongly
  than a follower.

Neither is learned, and neither pretends to be — they are written rules in the same spirit
as the rest of the planner; what is learned is the reflex underneath. Without them a
continuous population simply dies out: every baby born is eaten before it can grow, and a
lineage that cannot raise young has no descendants.

### Bookkeeping
`world.births`, `world.deepestGeneration` (how many ancestors deep the population is —
this is what "generation" means with no boundaries) and `world.extinct`.
`maxPopulation` (70) is a hard ceiling; without one a successful colony grows until the
frame rate collapses, which is its own kind of extinction. The chart is fed by
`sampleContinuous()` every 20s, since there are no generation boundaries to hang a data
point on.

`tests/life_test.js` — 13 assertions, including that the generation counter never moves
with a 20s timer over 60 simulated seconds, that juveniles genuinely exist during a run
(peak 42 at once), that the colony does not die out, and that generational mode still
works.

**One thing that looked like a bug and was not:** with `evolution.trials: 4` a brain is
evaluated four times before a generation completes, so four clock boundaries pass before
the counter moves. A test asserting "generations advance after 25s with a 20s timer"
fails correctly.

---

## Performance at high population

MEASURED, ticks per second (60 ticks = 1 simulated second):

| fish | before | after | max real-time speed |
|---|---|---|---|
| 30 | 507 | 570 | 9.5× |
| 45 | 311 | 445 | 7.4× |
| 60 | 121 | 281 | 4.7× |
| **70** | **145** | **314** | **5.2×** |

At 70 fish a tick cost **7.9ms** — more than half a frame before anything was drawn, which
is why a growing colony made the page lag and the motion smear. Two fixes:

**1. A planning budget (`schooling.maxPlansPerTick: 8`).** With `planEvery` fixed at 6,
the number of fish searching for an escape route each tick grew with the population, so
cost scaled with headcount and the frame rate fell off a cliff *exactly when a colony was
doing well*. Now a fish re-plans less often in a large school and just as often in a small
one. Stale plans are the price and they are cheap: a route computed 150ms ago is still
roughly right, a dropped frame is always wrong.

**2. A narrower alarm relay.** Every fish scanned every other fish's message and rejected
almost all of them. Only fish actually holding a current warning can relay one, so that
list is now built once per tick — and is usually empty, because most of the time nobody
has seen anything. The squared alarm range was also being recomputed inside the inner
loop.

`Schooling.organise()` is now negligible (0.010ms); `prepare()` is 1.34ms, down from 2.36.

### Display fixes
- **`alive` denominator** — the HUD divided by `fish.count` (45) while continuous mode
  breeds up to `maxPopulation` (70), so it read `70/45`. It now uses whichever ceiling
  applies to the current mode.
- **Fish rendering** — every fish now casts a small contact shadow (previously only the
  shark had one, which made the fish read as flat stickers). Juveniles carry a ring that
  shrinks as they mature: transparency alone reads as *distance* in a crowd, not as age.
  Escorting adults draw a dashed line to the juvenile they are screening — the one
  behaviour in the simulation that exists purely to keep somebody else alive, and
  previously invisible.
- `f.escorting` holds an **id**, not an array index. After births those diverge, so it
  must be resolved with `.find(o => o.id === ...)`.

---

## Installed skill — ui-ux-pro-max

`.claude/skills/ui-ux-pro-max` and `.claude/skills/ui-styling`, from
`github.com/nextlevelbuilder/ui-ux-pro-max-skill` (9.4MB of CSV reference data:
styles, palettes, font pairings, 119 UX guidelines, motion presets, per-stack notes).

**Two things deliberately not installed:**
- The repo's `stack/.claude/settings.json`, which grants `Read(//home/**)`,
  `enableAllProjectMcpServers` and several MCP allowances. None of that is needed to read
  reference data, and it widens this project's permissions for no benefit.
- The other five bundled skills (banner-design, brand, design, design-system, slides) —
  none apply to a canvas simulation.

**Its `search.py` cannot run here** — this machine has no Python (checked in the first
session). The CSVs are read directly with node instead, which works fine.

**What it was and was not useful for.** Its motion data is web-interface motion — hover
states, scroll reveals, page transitions — and has nothing to say about animating a
creature on a canvas. Its *UX guidelines* were useful, and four of them were being broken:

| rule | violation | fix |
|---|---|---|
| #9 Reduced Motion | constant animation, no opt-out | `prefers-reduced-motion` honoured in CSS **and** in the three canvases |
| #13 Transform Performance | bars animated `width` | `transform: scaleX` instead — twelve bars updating 60×/s |
| #22 Touch Target Size | buttons ~30px tall | `min-height: 44px` |
| #23 Touch Spacing | 6px gaps | 8px |

Plus a contrast pass: several labels sat at 0.45–0.55 opacity on a dark surface, under the
4.5:1 body-text ratio.

Reduced motion holds the simulation at a fixed frame rather than stripping the page — every
readout, the brain diagram and the arithmetic still work, it simply does not move unless
stepped.

## Fish animation — a travelling wave

The fish flexed at a single hinge: one `flex` value bent the whole body together, which
reads as a shape being wobbled rather than an animal swimming.

A real fish passes a wave from head to tail, arriving **later and larger** the further back
you look — that is what produces thrust and what the eye recognises as swimming. The body
now samples `wave(u)` at four stations, where `u` runs 0 at the nose to 1 at the tail
stock:

```js
wave(u) = sin(phase - u * 2.6) * amp * u * u   +   turn * H * 0.42 * u
          ^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^       ^^^^^^^^^^^^^^^^^^
          phase lag = it TRAVELS  grows rearward    leaning into a turn
```

Without the `- u * 2.6` lag every station moves in unison and the fish looks like a
flapping leaf. The `u * u` is why a fish's head barely moves while its tail moves a lot.

Also added: **follow-through** — the caudal fin's angle comes from the *difference* between
the wave at the joint and just ahead of it, so the fin trails the body instead of pivoting
with it, and the pectoral fins run on a lagging phase for the same reason.

Cost: three extra `sin()` calls per fish per frame — measured at 3ms for a full second of
drawing 70 fish. Free.
