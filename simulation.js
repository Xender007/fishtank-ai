// Node-only loader for our own classic scripts. A function scope keeps the
// simulation isolated without the expensive global lookups of a VM sandbox.
// The browser still loads exactly these files, with no build step or library.
const fs = require('fs');
const path = require('path');
const FILES = ['config','rng','vec','senses','brain','genome','evolution',
  'fish','schooling','shark','world','persist'];
function createSimulation() {
  const src = FILES.map(name => fs.readFileSync(path.join(__dirname, 'js', name + '.js'), 'utf8')).join('\n');
  return new Function(src + '\nreturn { CONFIG, World, Genome, Evolution, Innovation, Rng, Senses, Persist };')();
}
module.exports = { createSimulation, FILES };
