<div align="center">

# 🐟 fishtank-ai

### A neural network written from scratch that teaches fish to escape a shark.

**No libraries. No build step. No `npm install`.** Open `index.html` and it runs.

<img src="assets/demo.svg" alt="A school of fish evading a shark in a closed tank" width="760">

<sub>Not a mockup — this is the real simulation, recorded frame by frame with the trained champion.<br>
Regenerate it yourself: <code>node tools/make-demo.js</code></sub>

![no dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)
![tests](https://img.shields.io/badge/tests-168%20passing-brightgreen?style=flat-square)
![generations](https://img.shields.io/badge/generations%20trained-380-blue?style=flat-square)
![vanilla js](https://img.shields.io/badge/vanilla-JS-f7df1e?style=flat-square)

</div>

---

## What you are looking at

Thirty-four fish and one shark in a closed tank. The shark is **faster** (105 px/s against
90) and has no brain at all — it simply aims at the nearest fish and swims flat out.

The fish cannot win a straight race. Their only advantage is that they turn inside a circle
the shark physically cannot fit in — **30px against 66px**. Every evasion you see is that
one asymmetry being exploited.

Nobody programmed it. The fish started with 16 parameters, no hidden neurons and random
weights, and were eaten until they weren't.

---

## Run it

```bash
git clone https://github.com/Xender007/fishtank-ai && cd fishtank-ai

start index.html            # Windows  (macOS: open, Linux: xdg-open)

node train.js --gens 70     # train — resumes from the saved champion
node train.js --repeat 10   # …and keep going, unattended
node tests/run-all.js       # 168 assertions
```

There is nothing to install. It is `<script>` tags and a canvas.

---

## What is actually in the box

Every weight, forward pass, mutation and selection step is code in this repository.

<table>
<tr><td width="50%" valign="top">

**The brain**
- Neurons, from `sum(w·x) + b → tanh`
- **NEAT-style genomes** that grow their own neurons and connections from a minimal start
- Innovation numbers, speciation, crossover
- **Recurrent memory** — a constant input produces a *changing* output
- **Hebbian plasticity** — synapses that adapt within one life

</td><td width="50%" valign="top">

**The world**
- 12 egocentric senses: 9 vision rays over 330°, wall, speed, closing rate
- Packs with elected scouts, an alarm that relays one hop per tick, route planning
- **Continuous life** — no generation timer; fish breed, juveniles are born small and slow,
  and adults interpose between them and the shark
- A brain inspector: click any fish and watch its network think

</td></tr>
</table>

---

## Five things this turned out to prove

Every number is measured. The scripts that measured them are in `tests/`.

> ### 🎲 A learning curve going up is not evidence of learning
> Sixty copies of **one identical brain** scored with the same spread as sixty *different*
> brains. Selection was reading pure luck. The cheapest diagnostic in the whole project is
> cloning one brain N times and seeing how much the score moves on its own.

> ### 📏 A score that saturates cannot teach
> At 30-second generations, 56% of fish survived to the cap and scored *identically* —
> learning was 8% over 80 generations. At 90 seconds the same code improved **34% in
> twenty**. Nothing about the algorithm changed.

> ### 🔥 Too hard is as bad as too easy
> Three sharks cut survival from 37s to 11s and learning collapsed to 1–2%. Outcomes
> stopped depending on skill.

> ### 🐠 The schooling never emerged
> Fish grouped **more tightly** in the condition where they were physically unable to
> perceive each other. A group-shaped *pattern* is not evidence of a group-detecting
> *mechanism* — the only way to tell is to remove the mechanism and see if the pattern
> survives.

> ### 🧠 A hand-wired neuron lost to a random drunkard
> 125 eaten against 41. That is the argument for *learning* weights instead of choosing
> them, and it is why the losing weights are still the default in `config.js`.

---

## The files

| | |
|---|---|
| `js/genome.js` | Brains that grow: nodes, connections, innovation numbers, memory, plasticity |
| `js/brain.js` | The neuron. Multiply, sum, add bias, squash — that really is all of it |
| `js/evolution.js` | Fitness, tournament selection, crossover, speciation |
| `js/senses.js` | The world reduced to 12 numbers, all egocentric, all normalised |
| `js/schooling.js` | Packs, scouts, alarm relay, escape-route search |
| `js/brainview.js` | The inspector — nodes light up, signals travel the wires |
| `train.js` | Offline trainer. Scores each brain **alone**, which is the whole point |
| `tools/make-demo.js` | Records the simulation into the SVG at the top of this file |

`js/config.js` is worth reading on its own: nearly every number in it carries the
measurement that chose it, including the ones that failed.

---

## Read further

- **[`PLAN.md`](PLAN.md)** — the full build log, stage by stage, with every measurement and
  every prediction that turned out wrong
- **[`HANDOFF.md`](HANDOFF.md)** — orientation for picking it up cold: invariants, findings
  not worth re-deriving, open problems

<div align="center">
<sub>Built with <a href="https://claude.com/claude-code">Claude Code</a>. The UI pass used
<a href="https://github.com/nextlevelbuilder/ui-ux-pro-max-skill">ui-ux-pro-max</a>, which is
not vendored here.</sub>
</div>
