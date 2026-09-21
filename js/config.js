// =============================================================================
// config.js - every tunable number in the project, in one place.
// =============================================================================
// This file exists so you can experiment. Change a number, press F5, watch what
// happens. That loop - tweak, reload, observe - is how you will actually build
// intuition for this stuff, far more than reading will.
// =============================================================================

const CONFIG = {

  // Change this number and you get a different ocean: different starting
  // positions, different headings, different everything. Keep it the same and
  // every run is identical, which is what makes experiments meaningful.
  seed: 1234,

  // The tank, in pixels. Deliberately SMALL. See "World rules" in PLAN.md:
  // a closed, cramped tank forces the fish to learn real evasion instead of
  // just picking a direction and fleeing forever.
  tank: {
    w: 900,
    h: 600,
  },

  fish: {
    // MEASURED. Exact clones of the shoal-trained champion, 60s, share of the
    // tank eaten, 12 seeds per row (an earlier 5-seed version of this table was
    // too noisy to trust and disagreed with itself by 15 points):
    //
    //   fish    eaten    sd     range
    //   16       20%     19%    0-69%
    //   24       19%     21%    0-83%
    //   30       19%     16%    0-53%
    //   45       27%     12%   13-53%
    //   60       26%     21%    2-65%
    //
    // 45 costs roughly 8 points more than 24-30, with the ranges overlapping
    // heavily - a real but modest price for a fuller-looking sea, and the
    // variance between seeds dwarfs the difference between sizes.
    //
    // Worth knowing WHY a crowd is harder at all: identical brains make
    // identical turns, so a shoal of clones converges onto the same evasive
    // path and packs into a line the shark can harvest. The shoal-trained
    // champion has evolved partly out of that habit; the solo-trained one
    // never did, and collapsed to 66% eaten at 60 fish.
    //
    // To optimise specifically for this size:  node train.js --clones 45
    count:    45,
    radius:   5,
    maxSpeed: 90,    // pixels per second at full thrust
    turnRate: 3.0,   // RADIANS PER SECOND - about 172 deg/s. Very nimble.
  },

  shark: {
    // How many predators. With one shark a fish has a predator in view only
    // 5% of a generation, so 95% of its "fitness" is the clock ticking while
    // nothing happens. More sharks means more threat events per score.
    //
    // MEASURED: raising this to 3 cut mean survival from 37s to 11s - far past
    // "harder" and into "hopeless", which destroys the fitness signal the same
    // way too-easy does (see sim.generationSeconds). Trial averaging turned out
    // to fix the noise far better than extra sharks, so this stays at 1. Try 2
    // if you want a genuinely brutal ocean.
    count: 1,

    radius:   16,
    maxSpeed: 105,   // FASTER than a fish...
    turnRate: 1.6,   // ...but turns at barely half the rate. This is the game.
    circleLimit: 3, // after MORE than three uninterrupted loops, reverse the turn
    circleBreakSeconds: 1.4,
  },

  // The shark's OPTIONAL brain (js/sharkbrain.js). Off here, so every test,
  // benchmark and trainer keeps facing the brainless measuring stick that all
  // numbers in PLAN.md were taken against. The page switches it on.
  sharkBrain: {
    enabled: false,
    // THE SURVIVAL INSTINCT. A brained shark that goes this long without a
    // meal dies. It is also fed to the network as an input ("hunger"), so the
    // brain can feel the clock running out - and it is what gives evolution
    // its signal: a shark that cannot catch anything simply stops existing.
    starveSeconds: 10,
    respawnSeconds: 1.5,   // how long a starved shark lies there before a new one
    // A brain may slow down, because turnRate is fixed in rad/s: at 50% speed
    // its turning circle halves, from 66px to 33px - close to the fish's 30px.
    // That is the one physical lever a thinking shark has that a brainless
    // one never used. It still never goes faster than maxSpeed.
    minSpeedFraction: 0.5,
    hidden: 6,             // 8 senses -> 6 hidden -> 2 outputs = 68 parameters
    // Self-training: each candidate brain hunts a school of champion fish.
    train: {
      population: 16,
      // 4, not 2: with 2 the per-generation champion was chosen largely by luck -
      // held-out kills swung 0.4-2.3 between neighbouring generations.
      trials: 4,           // same seeds for every candidate in a generation
      mixedOpponents: true, // even trials: champion reflex only. See sharktrainer.js
      seconds: 20,         // a trial also ends early if the shark starves
      fish: 12,            // champion clones in the evaluation tank
      elites: 2,
      mutationRate: 0.2,
      mutationStrength: 0.35,
      crossoverRate: 0.6,
      pageBudgetMs: 4,     // per animation frame, on top of the visible tank
    },
  },

  // Social decisions surround the saved neural reflex; its seven inputs and
  // weights remain compatible. These are engineered behaviours, not claims of
  // newly evolved intelligence. Disable for the original network-only baseline.
  schooling: {
    enabled: true,
    minSize: 7,
    targetSize: 9,
    spacing: 24,
    alarmRange: 150,
    memorySeconds: 2.5,
    scoutRange: 260,
    followerRange: 170,
    nearSense: 65,
    planEvery: 6,       // evaluate escape routes at 10 Hz; bodies still run at 60 Hz

    // Hard ceiling on how many fish may search for an escape route in a
    // single tick.
    //
    // MEASURED at 70 fish: one tick cost 7.9ms, of which the route search was
    // most of it - more than half a frame before anything is drawn, which is
    // why a growing population made the page lag and smear. With planEvery
    // fixed at 6, the number of fish planning per tick grows with the
    // population, so cost scales with headcount and the frame rate falls off
    // a cliff exactly when a colony is doing well.
    //
    // Budgeting the WORK instead means a fish re-plans less often in a large
    // school and just as often in a small one. Stale plans are the price, and
    // they are a cheap price: a route computed 150ms ago is still roughly
    // right, while a dropped frame is always wrong.
    maxPlansPerTick: 8,
    predictionSteps: 10, // retained for the frozen social-v1 benchmark
    predictionDt: 0.12,
    routeSteps: 16,    // 1.92s: compare an initial dodge followed by an exit turn
    dodgeSteps: 4,     // brake/turn for 0.48s, then accelerate into the exit
  },

  // --------------------------------------------------------------------------
  // WHAT A FISH CAN PERCEIVE. These become the INPUT NEURONS in Stage 3.
  // --------------------------------------------------------------------------
  senses: {
    // NINE RAYS OVER 330 DEGREES, not five over 160.
    //
    // The old fan left a 200 degree blind spot directly behind the fish - and
    // the shark is FASTER, so it closes from behind by default. The fish were
    // being eaten by something they could not perceive until it was alongside.
    // You cannot evade what you cannot sense, and no amount of extra brain
    // fixes a missing input.
    //
    // Real prey fish see nearly all the way round; the small remaining gap
    // behind the tail is realistic and keeps one thing still worth learning,
    // which is not to sit still with your tail toward open water.
    //
    // This costs parameters - nine inputs instead of five, wired to every
    // output - and it invalidates every brain saved under the old layout.
    // Persist.fromJSON refuses those with a clear message rather than loading
    // a brain whose inputs mean something different than they did.
    rayCount:  9,
    fov:       330 * Math.PI / 180,  // total width of the fan, in radians
    range:     170,                  // how far a fish can see, in pixels
    wallRange: 130,                  // how far ahead it can feel the glass

    // ---- STAGE 8: sensing OTHER FISH ---------------------------------------
    // Three extra inputs: how much company there is to the negative side,
    // dead ahead, and to the positive side. Same sign convention as the rays.
    //
    // NOTE WHAT IS NOT HERE. The plan originally called for "more rays, longer
    // range" as well. Stage 7 measured that a 16-parameter brain beat the
    // 62-parameter one I designed, so extra inputs are not free: every new
    // sense adds weights to tune, and tuning them costs generations. Three
    // senses are added, and even those are measured rather than assumed - see
    // the table below.
    //
    // Historical experiment: these inputs were intended to teach schooling
    // without explicit cohesion/separation/alignment rules. It did not work.
    // The current Schooling controller adds those rules separately, preserving
    // compatibility with the trained seven-input network.
    // ------------------------------------------------------------------------
    // MEASURED, AND THE ANSWER WAS NO. Default OFF. Set true to explore.
    // ------------------------------------------------------------------------
    //   senses                 30 gens   60 gens   nearest-neighbour distance
    //   7 (shark + wall)          +21%      +50%      87px -> 63px
    //   10 (with kin senses)       +4%      +12%      86px -> 73px
    //
    // The three extra senses cost fitness, and the gap WIDENS with time rather
    // than closing. Same lesson as Stage 7: every new input adds weights, and
    // weights cost generations to tune. Capacity is never free.
    //
    // AND THE SCHOOLING NEVER HAPPENED. Look at the last column. The fish
    // group more tightly in the condition where they are PHYSICALLY UNABLE TO
    // PERCEIVE EACH OTHER. So the clustering is not schooling at all - it
    // cannot be, because in that run no fish can detect another fish by any
    // means. It is sixty near-identical brains, descended from the same few
    // ancestors, reacting to the same shark in the same way and therefore
    // ending up in the same places.
    //
    // That is worth more than the feature was. A group-shaped PATTERN is not
    // evidence of a group-detecting MECHANISM, and the only way to tell the
    // difference is to remove the mechanism and check whether the pattern
    // survives. Here it not only survived, it got stronger.
    //
    // Turning this on switches on three extra senses, three more rows in the
    // inputs panel, and the kin-link threads drawn from the focused fish.
    // ------------------------------------------------------------------------
    neighbours: false,
    neighbourRange: 150,
    crowdScale: 3,                   // how many close neighbours read as "1.0"
  },

  // --------------------------------------------------------------------------
  // THE HAND-WIRED NEURON (Stage 2). Edit these, press F5, watch what changes.
  // --------------------------------------------------------------------------
  // One weight per sense, in the order senses.js produces them:
  //
  //     [0] ray -80    [1] ray -40    [2] ray 0    [3] ray +40    [4] ray +80
  //     [5] wall ahead                [6] own speed
  //
  // WHY THE SIGNS MIRROR: a fish turns by heading += turn * turnRate * dt, so
  // a POSITIVE turn increases the heading. A shark on the -40 ray sits at
  // heading-40; increasing the heading pushes it further behind that shoulder.
  // So negative-offset rays need POSITIVE weights and positive-offset rays
  // need NEGATIVE ones. That mirror pattern is the entire reason this single
  // neuron means "turn away" instead of "turn always".
  //
  // The inner rays (+/-40) carry MORE weight than the outer ones (+/-80): a
  // threat closer to dead ahead is more urgent than one off to the side.
  //
  // Sense [2] is the awkward one. A shark exactly dead ahead gives no reason
  // to prefer left over right - the geometry is symmetric. A single neuron
  // cannot represent "whichever way is better", so I simply had to CHOOSE a
  // direction and hardcode it. Keep that limitation in mind; it is the first
  // honest glimpse of what one neuron cannot do.
  brain: {
    // Rebuilt for the 9-ray, 330-degree fan. Same mirror rule as before:
    // negative-offset rays push the turn positive, positive-offset rays push
    // it negative, and the rays nearest dead-ahead carry the most weight
    // because a threat in front is the most urgent. The rearmost rays are
    // weak - something directly behind gives almost no steering information,
    // only a reason to move.
    turnWeights: [
      +0.6,   // ray -165  almost astern
      +1.0,   // ray -124
      +1.6,   // ray -82
      +1.9,   // ray -41   closest to the nose: most urgent
      +1.0,   // ray 0     dead ahead: an arbitrary tie-break
      -1.9,   // ray +41
      -1.6,   // ray +82
      -1.0,   // ray +124
      -0.6,   // ray +165
      +1.0,   // wall ahead -> veer off, consistently one way
       0.0,   // own speed  -> irrelevant to steering
       0.0,   // closing    -> tells you URGENCY, not which way to go
    ],
    turnBias: 0.0,   // what the neuron does when it senses absolutely nothing

    // ------------------------------------------------------------------------
    // MEASURED: THESE WEIGHTS ARE WORSE THAN NO WEIGHTS AT ALL.
    // ------------------------------------------------------------------------
    // 60 simulated seconds, identical starting tank, fish eaten (lower better):
    //
    //     random wander (no brain at all) .......  47      21% of time on wall
    //     turn AWAY (the weights above) .........  70      40%
    //     turn AWAY, wall weight 0 .............. 101      81%
    //     turn ACROSS (all ray signs flipped) ...  58      81%
    //     turn ACROSS, twice as hard ............  54      82%
    //     turn ACROSS + wall avoidance ..........  65      36%
    //
    // Fleeing keeps a fish FURTHER from the shark on average (518px against
    // 437px) and still gets it killed more often, because in a closed tank
    // running away means running out of room. Note also that turning ACROSS
    // the shark beats turning away - that is the turning-circle asymmetry from
    // config.shark showing up in the data.
    //
    // Every single hand-wired variant loses to a drunkard. That is not a bug
    // in the neuron; the neuron does exactly what its weights say. It is a
    // limit on ME. Picking good weights by reasoning about the problem is
    // hard, and this is a problem with seven inputs and one output.
    //
    // Which is the entire argument for Stage 4. Paste any row above over
    // turnWeights and press F5 to reproduce the numbers yourself.
    // ------------------------------------------------------------------------

    // Start with the neuron in charge. Press B in the browser to hand control
    // back to the random wander and compare the two directly.
    enabled: true,
  },

  // --------------------------------------------------------------------------
  // THE NETWORK (Stage 3). 7 senses -> hidden layer -> 2 outputs.
  // --------------------------------------------------------------------------
  net: {
    hidden: 6,        // neurons in the hidden layer

    // How big the random starting weights are. The range is
    // initGain / sqrt(numberOfInputsToThisNeuron), which is a standard recipe.
    //
    // WHY DIVIDE BY sqrt(fanIn): a neuron with 7 inputs adds up 7 products. If
    // each weight were drawn from the same range regardless, neurons with many
    // inputs would produce much larger sums than neurons with few - and a
    // large sum puts tanh into SATURATION, where it returns almost exactly
    // +1 or -1 and stops responding to its input at all. A saturated neuron is
    // a dead neuron: change its input and nothing happens. Dividing by the
    // square root of the input count keeps the typical sum about the same size
    // no matter how wide the layer is.
    //
    // Try initGain: 8 and watch the fish go rigid. The test suite measures it.
    initGain: 1.0,
  },

  // --------------------------------------------------------------------------
  // EVOLUTION (Stage 4). How dying fish turn into better fish.
  // --------------------------------------------------------------------------
  evolution: {
    enabled: true,

    // How many of the very best brains are carried into the next generation
    // UNCHANGED. Without this, the best brain the population has ever found
    // can be destroyed by one unlucky mutation, and the fitness curve wanders
    // down as often as up. Elitism makes the best-so-far a ratchet.
    // Scale each fish's survival by how much of its life was actually spent
    // under threat. Without this, in-page evolution selects for luck and
    // actively destroys trained brains - see Evolution.fitness().
    // MEASURED, 45 fish over 60s. Spread of scores among IDENTICAL brains is
    // pure luck (no skill differences exist); spread among different brains is
    // luck plus skill:
    //
    //   fitness              identical   different   luck share
    //   raw survival time        7.37s       3.24s        227%
    //   exposure-weighted        3.70s       5.10s         73%
    //
    // Read the first row again: with raw survival the LUCK spread was larger
    // than the whole spread among genuinely different brains. Selection was
    // not merely noisy, it was anti-informative, which is why twelve
    // generations in the page cut a champion from 48.3s to 17.3s.
    //
    // Weighting by exposure puts real signal above the noise for the first
    // time in the browser. It is still weaker than the trainer, which scores
    // each brain alone where survival can only come from escaping.
    exposureWeighting: true,
    exposureFloor: 0.25,

    elites: 4,

    // TOURNAMENT SELECTION: pick this many fish at random, breed the best one.
    // The classic alternative, roulette (probability proportional to fitness),
    // fails in two directions: when every fish scores about the same there is
    // no selection pressure at all, and when one fish scores hugely more than
    // the rest it takes over the whole population in a single generation.
    // A tournament only ever compares RANK, so it is immune to both. Raise
    // this number for harsher selection, lower it (2) for gentler.
    tournamentSize: 3,

    // Fraction of a child's weights that get jittered at all.
    mutationRate: 0.15,

    // How many times each brain is evaluated before it is scored. Its fitness
    // is the MEAN across trials, each with fresh spawn positions.
    //
    // MEASURED: with 1 trial, 100% of the fitness spread was luck - sixty
    // copies of one brain scored as widely as sixty different brains. Noise
    // falls with sqrt(trials), so 4 trials halves it. Costs 4x the compute per
    // generation, which is what the speed control is for.
    trials: 4,

    // Size of the jitter, as the standard deviation of a bell curve. Gaussian
    // rather than uniform on purpose: most mutations should be small tweaks
    // that refine what already works, with the occasional big jump that
    // explores somewhere new. Uniform noise makes every size equally likely,
    // which is bad at both jobs.
    mutationStrength: 0.35,
  },

  // --------------------------------------------------------------------------
  // CROSSOVER (Stage 5). Children with two parents instead of one.
  // --------------------------------------------------------------------------
  crossover: {
    enabled: true,

    // Fraction of non-elite children made by mixing two parents. The rest are
    // ordinary mutated clones of a single parent. Keeping some of both hedges
    // against crossover turning out to be harmful, which is a real risk here -
    // see COMPETING CONVENTIONS in brain.js.
    rate: 0.75,

    // "uniform" - decide parent per individual WEIGHT.
    // "neuron"  - decide parent per whole NEURON (all of its incoming weights
    //             plus its bias travel together).
    //
    // Neuron-wise is the more careful of the two. A neuron IS a learned
    // feature - its incoming weights only mean anything as a set - so taking
    // half of one neuron from each parent shreds two working features to make
    // one broken one. Moving whole neurons at least keeps each feature intact.
    // Whether that is enough to help is measured, not assumed.
    scheme: "neuron",
  },

  // --------------------------------------------------------------------------
  // GROWING BRAINS (Stage 7) - NEAT-lite.
  // --------------------------------------------------------------------------
  genome: {
    // "genome"  - brains are graphs that GROW new neurons and connections.
    // "layered" - the fixed 7-6-2 network from Stage 3. Kept so you can
    //             compare a fixed shape against one that evolves its own.
    kind: "genome",

    // Structural mutation rates, per child, per generation. These are much
    // lower than the weight mutation rate on purpose: changing a weight tweaks
    // a brain, but adding a neuron changes what the brain IS. Structure should
    // change rarely enough that weights get time to adapt to it.
    addConnectionRate: 0.08,
    addNodeRate:       0.03,

    // Fraction of add-connection attempts that go looking for a RECURRENT
    // edge - one that reads its source's value from the PREVIOUS tick.
    //
    // This is the difference between a reflex and something with state. A
    // feed-forward network can only answer "given exactly what I see right
    // now, what do I do?" It cannot tell a shark closing from one leaving, it
    // cannot time a break, and it cannot remember a threat that has passed
    // into its blind spot. One self-loop gives a neuron a memory; several give
    // the fish a sense of time.
    //
    // Set to 0 for the old strictly feed-forward behaviour - that is the
    // control experiment, and it is worth running before believing any of this.
    recurrentRate:     0.35,

    // ------------------------------------------------------------------------
    // LIFETIME LEARNING (Hebbian plasticity)
    // ------------------------------------------------------------------------
    // Everything else here is learned BETWEEN generations: a fish is born with
    // fixed weights, lives, dies, and only its descendants benefit. Plasticity
    // lets a connection change strength DURING a single life.
    //
    // The rule is the oldest one in neuroscience - neurons that fire together
    // wire together. Each connection carries an evolved learning rate, and
    // while the fish is alive a running trace moves with the correlation
    // between the neuron it comes from and the neuron it feeds:
    //
    //     trace += rate * (pre * post)        then decays back toward zero
    //     effective weight = inherited weight + trace
    //
    // What evolution discovers is not the weight but WHERE PLASTICITY HELPS -
    // which synapses should be allowed to drift with experience and which must
    // stay exactly as inherited. A rate of zero means 'this one is fixed', and
    // that is a perfectly good thing for evolution to decide.
    //
    // decay is what stops a trace running away: without it, any consistently
    // co-active pair would grow without limit until tanh saturated and the
    // neuron went deaf - the saturation failure from Stage 3, arriving through
    // a different door.
    plasticity: {
      enabled: true,
      decay: 0.02,        // fraction of the trace shed each tick
      maxTrace: 1.5,      // hard clamp, belt and braces on top of the decay
      mutationRate: 0.1,  // how often a learning rate is jittered
      strength: 0.15,     // size of that jitter
    },
    toggleRate:        0.01,

    // --- speciation ---------------------------------------------------------
    // A fish that has just grown a new neuron is almost always WORSE than its
    // cousins: the new weight is random and nothing has tuned around it yet.
    // Judged against the whole population it dies immediately, and no
    // structural innovation ever survives long enough to prove itself.
    //
    // Species fix that. Genomes are grouped by how similar their wiring is, and
    // each fish competes mainly against its own species. A new idea gets a few
    // generations of shelter to become good before facing the world.
    // MEASURED: after 8 generations the pairwise distance between brains runs
    // from 0.005 to 0.582, median 0.248. A fixed threshold of 2.4 (my first
    // guess) put the entire population in ONE species, so speciation did
    // nothing at all and structure never grew. Always measure the scale of a
    // distance before picking a threshold for it.
    //
    // Rather than hard-code a number that goes stale as brains grow and drift
    // further apart, the threshold ADAPTS: it nudges up when there are too
    // many species and down when there are too few, holding the count near
    // targetSpecies. This is what real NEAT implementations do.
    // Speciation can be switched off entirely, which is worth doing: it is a
    // real experiment, not a formality. See the measured table below.
    useSpecies: true,

    compatibilityThreshold: 0.25,  // starting value; adapts from here
    targetSpecies: 4,
    thresholdStep: 0.015,

    excessCoefficient: 1.0,        // weight of structural differences
    weightCoefficient: 0.5,        // weight of numeric differences
    speciesElites: 1,              // best of each species carried over untouched

    // ------------------------------------------------------------------------
    // MEASURED: WHAT GROWING BRAINS ACTUALLY BOUGHT US. Read this before
    // assuming a bigger network is a better one.
    // ------------------------------------------------------------------------
    // 30 generations, 60 fish, seed 1234:
    //
    //   setup                        gain    final params   hidden
    //   fixed 7-6-2 network          +12%    62 (fixed)     6
    //   growing genome, 8 species    -16%    22.4           1.73
    //   growing genome, 4 species     -5%    21.4           1.30
    //   growing genome, no species   +20%    16.0           1.13
    //
    // Look at the last row. With speciation off, the parameter count never
    // leaves 16 - every structural innovation is killed in the generation it
    // appears, exactly as predicted, so the brain stays minimal and simply
    // tunes its 16 weights well. Speciation genuinely DOES enable growth
    // (params reach 22, hidden neurons appear). It just does not pay for
    // itself over 30 generations.
    //
    // Over 80 generations, with 9-generation smoothing:
    //
    //   no species   42.1s -> 50.3s  (+19%)
    //   with species 42.4s -> 47.8s  (+13%), peaking at 60.7s around gen 61
    //
    // So the speciated run reaches a HIGHER peak but is not reliably better on
    // average. The honest reading: at 60 fish and under 100 generations there
    // is not enough time or population for structural innovation to repay its
    // cost. Real NEAT papers use populations of 150+ and hundreds of
    // generations, and that is not an accident.
    //
    // Speciation is left ON by default because watching brains grow is the
    // point of this stage - but it is a real cost, honestly measured, and
    // useSpecies: false is the control experiment.
    // ------------------------------------------------------------------------
  },


  // --------------------------------------------------------------------------
  // CONTINUOUS LIFE - a population instead of a series of generations.
  // --------------------------------------------------------------------------
  // With this off, the tank resets on a timer: everyone dies at once, the best
  // are bred, and a new identical-aged cohort appears. Clean to measure, and
  // nothing like an ecology.
  //
  // With it on the clock never resets. Mature fish spend accumulated energy on
  // offspring, the young are born small, slow and clumsy, and they grow into
  // their parents' abilities over time. Nobody is culled on a schedule - a
  // lineage continues because its descendants survive, and if they all die the
  // population goes EXTINCT and that is the end of it.
  //
  // The interesting part is what this asks of the adults. A newborn cannot
  // outrun the shark; its only protection is the school around it. So keeping
  // the young alive stops being decoration and becomes the thing the pack has
  // to be good at, or there is no next generation at all.
  life: {
    continuous: false,     // off by default: generational mode is the measurable one

    matureSeconds: 18,     // how long from birth to full size and speed
    babySpeed: 0.45,       // fraction of adult speed at birth
    babyTurn: 0.6,         // fraction of adult turn rate at birth
    babySize: 0.4,         // fraction of adult radius at birth

    // A fish must be this mature before it can breed at all. After that, in an
    // EMPTY habitat an adult has one offspring every breedEnergy seconds on
    // average; the rate falls as the tank fills and is zero at maxPopulation
    // (see World.breedContinuously). Breeding is slow on purpose, or the tank
    // fills instantly and nothing is ever selected.
    breedMaturity: 0.85,
    breedEnergy: 14,       // mean seconds per offspring, empty habitat
    breedRange: 120,       // how far to look for a mate

    // Hard ceiling. Without it a good population grows until the frame rate
    // collapses, which is its own kind of extinction.
    maxPopulation: 70,

    // How long an eaten fish lies on the bottom before it is cleared away.
    // Generational mode clears the tank every round anyway; a continuous colony
    // never does, so corpses piled up without limit - 108 of them after five
    // minutes, every one walked by every loop over world.fish every tick.
    corpseSeconds: 8,

    // Sample the population into the chart this often, since there are no
    // generation boundaries to hang a data point on any more.
    sampleSeconds: 20,
  },
  sim: {
    dt: 1 / 60,      // the fixed physics timestep, in seconds. Never varies.

    // How long a generation runs before it is scored and bred.
    //
    // MEASURED, and this number matters far more than it looks. At 30s, 56% of
    // fish survived the whole generation and therefore scored EXACTLY the same,
    // so selection could not tell over half the population apart and was
    // effectively picking parents at random from that half. Mean fitness rose
    // 8% in 80 generations.
    //
    // At 90s only 10% tie at the cap, and the same run improves 34% in TWENTY
    // generations. Nothing about the learning algorithm changed - only how
    // well the score distinguishes one fish from another.
    //
    // Note also what did NOT work: making the shark faster. At 140px/s
    // improvement fell to 2%, at 180px/s to 1%. A task that is too hard
    // destroys the fitness signal just as thoroughly as one that is too easy,
    // because outcomes stop depending on skill and start depending on luck.
    // You want the difficulty where being better actually changes the result.
    // Now that each brain is scored over several trials, a generation costs
    // trials x this many seconds. 60 keeps the wall-clock sane while still
    // leaving ties at the cap rare.
    generationSeconds: 60,
  },
};
