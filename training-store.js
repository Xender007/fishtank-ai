// Durable, dependency-free training storage. Score decisions live in train.js;
// this module keeps JSON/script writes atomic and improvement archives immutable.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
class TrainingStore {
  constructor(directory) { this.directory = directory; }
  file(name) { return path.join(this.directory, name); }
  read(name) {
    const file = this.file(name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }
  write(name, text) {
    const file = this.file(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.' + process.pid + '.tmp';
    const fd = fs.openSync(temporary, 'w');
    try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  }
  json(name, data) { this.write(name, JSON.stringify(data, null, 2)); }
  archive(label, data) {
    const text = JSON.stringify(data, null, 2);
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
    const name = 'archive/' + label + '-' + hash + '.json';
    if (!fs.existsSync(this.file(name))) this.write(name, text);
    return name;
  }
  display() {
    const saved = this.read('display-best.json');
    if (saved) return saved;
    const file = this.file('best.js');
    if (!fs.existsSync(file)) return null;
    const match = fs.readFileSync(file, 'utf8').match(/window\.CHAMPION\s*=\s*([\s\S]+);\s*$/);
    if (!match) throw Error('best.js does not contain a champion assignment');
    return JSON.parse(match[1]);
  }
  publish(data) {
    const previous = this.display();
    if (previous) this.archive('display-previous', previous);
    this.json('display-best.json', data);
    this.write('best.js', '// Best validated display brain. Written by train.js.\nwindow.CHAMPION = ' +
      JSON.stringify(data, null, 2) + ';\n');
  }
  // ---------------------------------------------------------------------------
  // FISH HISTORY - one champion per trained generation, for the page's
  // "fish brain generation" dropdown. Also written as a script, because a
  // file:// page can load a script but cannot fetch() a JSON file.
  // Kept selectable: every entry while short, then the first, every k-th and
  // the newest 20 (the same thinning as the shark's list).
  // ---------------------------------------------------------------------------
  fishHistory(entries) {
    const byGen = new Map();
    for (const e of (this.read('fish-history.json') || { generations: [] }).generations) byGen.set(e.generation, e);
    for (const e of entries) byGen.set(e.generation, e);
    let all = [...byGen.values()].sort((a, b) => a.generation - b.generation);
    const max = 80;
    if (all.length > max) {
      const recent = all.slice(-20), older = all.slice(0, -20);
      const k = Math.ceil(older.length / (max - 20));
      all = older.filter((e, i) => i % k === 0).concat(recent);
    }
    const data = { version: 1, saved: new Date().toISOString(), generations: all };
    this.write('fish-history.json', JSON.stringify(data));
    this.write('fish-history.js', '// Fish brains, one champion per trained generation. Written by train.js.\n' +
      'window.FISH_HISTORY = ' + JSON.stringify(data) + ';\n');
    return all.length;
  }
  progress(row) {
    // Do not silently discard unreadable history: retaining learned data is
    // more important than pretending a corrupted file was an empty history.
    const rows = this.read('history.json') || [];
    const index = rows.findIndex(r => r.runId === row.runId);
    if (index < 0) rows.push(row); else rows[index] = row;
    this.json('history.json', rows);
    this.json('training-progress.json', row);
    return rows.length;
  }
}
module.exports = { TrainingStore };
