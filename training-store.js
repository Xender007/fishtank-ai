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
