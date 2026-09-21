// =============================================================================
// parallel.js - use every CPU core for training.
// =============================================================================
// JavaScript runs on one core. This machine has several, and training spent
// all but one of them idle: 48 brains scored one after another, each taking a
// couple of seconds of physics, while seven cores watched.
//
// Evaluations are independent - scoring brain 12 needs nothing from brain 11 -
// so they spread perfectly. Each worker thread loads its own complete copy of
// the simulation (the same js/*.js files the page loads) and scores whatever
// job it is handed. The main thread keeps everything that must happen in ONE
// place: breeding, innovation numbers, species, saving. Only scoring moves.
//
//   const pool = new Pool(8);
//   const scores = await pool.map(jobs);      // same order as jobs
//   pool.close();
//
// `new Pool(0)` runs the jobs in this thread instead, through the very same
// evaluator. That is what the tests compare against, and it is handy for
// debugging (a stack trace from a worker is a stack trace from far away).
// =============================================================================

const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const { createSimulation } = require('./simulation');
const { makeEvaluator, applyConfig } = require('./evaluation');

// One simulation per thread, initialised exactly as the trainers initialise
// theirs (invariants #6 and #7).
function bootSimulation() {
  const S = createSimulation();
  S.World.keepInnovation = true;
  S.Innovation.reset();
  S.CONFIG.evolution.enabled = false;
  return { S, evaluate: makeEvaluator(S) };
}

function runJob(sim, job) {
  // Every job carries the full CONFIG it must run under, so a worker never
  // depends on settings left behind by an earlier job.
  if (job.config) applyConfig(sim.S.CONFIG, job.config);
  const fn = sim.evaluate[job.kind];
  if (!fn) throw new Error('unknown job kind: ' + job.kind);
  return fn(job);
}

class Pool {
  constructor(size) {
    this.size = size === undefined ? Pool.defaultSize() : Math.max(0, size | 0);
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 0;
    this.local = null;
    for (let i = 0; i < this.size; i++) this.spawnWorker();
  }

  // All cores. The main thread does almost nothing while a generation is being
  // scored, so it does not need one of its own.
  static defaultSize() { return Math.max(1, os.cpus().length); }

  spawnWorker() {
    const w = new Worker(__filename);
    w.on('message', msg => {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      this.idle.push(w);
      this.drain();
      if (!p) return;
      if (msg.error) p.reject(new Error('worker: ' + msg.error));
      else p.resolve(msg.result);
    });
    w.on('error', err => {
      // A crashed worker fails every job it held rather than hanging forever.
      for (const [id, p] of this.pending) if (p.worker === w) { this.pending.delete(id); p.reject(err); }
    });
    this.workers.push(w);
    this.idle.push(w);
  }

  run(job) {
    if (this.size === 0) {
      if (!this.local) this.local = bootSimulation();
      try { return Promise.resolve(runJob(this.local, job)); }
      catch (err) { return Promise.reject(err); }
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const task = this.queue.shift();
      const id = this.nextId++;
      this.pending.set(id, { resolve: task.resolve, reject: task.reject, worker: w });
      w.postMessage({ id, job: task.job });
    }
  }

  // Results come back in the order the jobs were given, whatever order the
  // workers finished them in.
  map(jobs) { return Promise.all(jobs.map(j => this.run(j))); }

  close() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}

// ---- inside a worker thread -----------------------------------------------
if (!isMainThread) {
  const sim = bootSimulation();
  parentPort.on('message', ({ id, job }) => {
    try { parentPort.postMessage({ id, result: runJob(sim, job) }); }
    catch (err) { parentPort.postMessage({ id, error: err && err.stack || String(err) }); }
  });
}

module.exports = { Pool };
