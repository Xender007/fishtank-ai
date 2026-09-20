// =============================================================================
// tests/run-all.js - run every suite. Usage:  node tests/run-all.js
// =============================================================================
// There is no test framework here on purpose: each suite is a plain Node script
// that loads js/*.js into a VM, asserts, and prints PASS/FAIL lines. This
// runner just executes them all and counts.
//
// The suites are not unit tests of implementation detail. They pin down the
// things that were actually got wrong at some point - wall collisions, sensing
// geometry, clone independence, cycle-freedom in grown genomes, and whether a
// saved brain still behaves identically after a round trip through JSON.
// =============================================================================

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SUITES = ['stage1_test', 'stage2_test', 'stage3_test', 'stage4_test',
                'stage5_test', 'stage67_test', 'stage8_test', 'memory_test', 'life_test', 'regress', 'schooling_test', 'planner_test',
                'runtime_test', 'storage_test', 'presentation_test'];

let pass = 0, fail = 0;
console.log('');

for (const name of SUITES) {
  const file = path.join(__dirname, name + '.js');
  if (!fs.existsSync(file)) { console.log('  MISSING  ' + name); fail++; continue; }

  let out = '';
  let crashed = false;
  try {
    out = execFileSync(process.execPath, [file, ROOT], { encoding: 'utf8' });
  } catch (err) {
    crashed = true;
    out = (err.stdout || '') + (err.stderr || '') || err.message;
  }

  const p = (out.match(/^ {2}PASS/gm) || []).length;
  const f = (out.match(/^ {2}FAIL/gm) || []).length;
  if ((crashed && !f) || (!p && !f)) {
    fail++;
    console.log('  FAIL  ' + name + ' did not complete successfully\n' + out);
  }
  pass += p; fail += f;

  console.log('  ' + name.padEnd(14) + String(p).padStart(3) + ' pass' +
              (f ? '   ' + f + ' FAIL' : ''));
  if (f) for (const line of out.split('\n')) if (line.startsWith('  FAIL')) console.log('    ' + line.trim());
}

console.log('  ' + '-'.repeat(34));
console.log('  ' + pass + ' passing, ' + fail + ' failing');
console.log('');
process.exitCode = fail ? 1 : 0;
