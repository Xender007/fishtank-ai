# fishtank-ai

A neural network written from scratch — no libraries — that teaches fish to escape a shark.

Open `index.html`. No build step, no server, no npm install.

![stack](https://img.shields.io/badge/dependencies-none-brightgreen) ![tests](https://img.shields.io/badge/tests-168%20passing-brightgreen)

---

## What this is

A tank of fish, one shark, and brains that start with **16 parameters and no hidden
neurons**. Every weight, every forward pass, every mutation is code in this repository.
Nothing is imported.

The fish evolve. Their brains grow neurons, grow memory loops, and get measurably better
at not being eaten. You can watch the network compute while the fish it belongs to is
swimming.

It was built as a teaching project, which is why the code is commented the way it is:
`js/config.js` carries the measurement behind almost every number in it, and
[`PLAN.md`](PLAN.md) is a stage-by-stage log including the parts that did not work.

## Run it

```bash
# Watch
open index.html            # or just double-click it

# Train. Resumes from the saved champion; --fresh starts over.
node train.js --clones 12 --sharks 2 --gens 70

# Keep going, unattended
node train.js --repeat 10

# Tests
node tests/run-all.js      # 168 assertions
```

## What is in it

| | |
|---|---|
| `js/genome.js` | NEAT-style brains: nodes, connections, innovation numbers, memory edges, Hebbian plasticity |
| `js/brain.js` | The neuron. Multiply, sum, add bias, squash — that is all of it |
| `js/evolution.js` | Fitness, tournament selection, crossover, speciation |
| `js/senses.js` | The world as 12 numbers, all egocentric, all normalised |
| `js/schooling.js` | Packs, elected scouts, alarm relay, escape-route planning |
| `js/brainview.js` | The inspector — click a fish, watch its network think |
| `train.js` | Offline trainer. Evaluates each brain **alone**, which is the whole point |

## Some things this turned out to prove

Every number below is measured, and the scripts that measured them are in `tests/`.

- **A learning curve going up is not evidence of learning.** Sixty copies of *one* brain
  scored with the same spread as sixty *different* brains — selection was reading pure
  luck. The cheapest diagnostic in the project is cloning one brain N times and seeing how
  much the score moves on its own.
- **A score that saturates cannot teach.** At 30-second generations 56% of fish survived to
  the cap and scored identically; learning was 8% over 80 generations. At 90 seconds the
  same code improved 34% in twenty.
- **Too hard is as bad as too easy.** Three sharks cut survival from 37s to 11s and
  learning collapsed — outcomes stopped depending on skill.
- **Schooling did not emerge.** Fish grouped *more tightly* in the condition where they
  were physically unable to perceive each other. A group-shaped pattern is not evidence of
  a group-detecting mechanism.
- **A hand-wired neuron lost to a random drunkard**, 125 eaten against 41. That is the
  argument for learning weights rather than choosing them.

## Optional

The UI work used [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill),
which is not vendored here. To install it:

```bash
git clone --depth 1 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill /tmp/uiux
cp -r /tmp/uiux/.claude/skills/ui-ux-pro-max .claude/skills/
```

## Further reading

- [`PLAN.md`](PLAN.md) — the full build log, stage by stage, with every measurement and
  every failed prediction
- [`HANDOFF.md`](HANDOFF.md) — orientation: invariants, findings not to re-derive, open
  problems
