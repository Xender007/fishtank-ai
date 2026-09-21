// Emits assets/demo.svg from the samples recorded by make-demo.js.
const fs = require('fs');
const path = require('path');
const rec = require('./make-demo.js');

const { track, sharkTrack, FRAMES, SECONDS, usingChampion, CONFIG } = rec;
const W = CONFIG.tank.w, H = CONFIG.tank.h;
const DUR = SECONDS + 's';

// SMIL wants a value per keyframe, and the last must equal the first for a
// seamless loop - otherwise every repeat snaps back visibly.
const loop = arr => arr.concat([arr[0]]).join(';');
const keyTimes = (() => {
  const n = FRAMES + 1;
  return Array.from({ length: n }, (_, i) => (i / (n - 1)).toFixed(4)).join(';');
})();

// An attribute that never changes does not need a keyframe track. In
// generational mode every fish is an adult, so the scale channel is a
// constant 1 for all 108 frames - a fifth of the file for nothing.
const varies = arr => arr.some(v => v !== arr[0]);

const body = [];

// --- background -------------------------------------------------------------
body.push(`<defs>
  <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0d324a"/>
    <stop offset="0.55" stop-color="#082438"/>
    <stop offset="1" stop-color="#03101a"/>
  </linearGradient>
  <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">
    <stop offset="0.35" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.45"/>
  </radialGradient>
  <linearGradient id="fishSkin" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2f9d84"/>
    <stop offset="0.5" stop-color="#9bf5df"/>
    <stop offset="1" stop-color="#2f9d84"/>
  </linearGradient>
  <linearGradient id="sharkSkin" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8e2f45"/>
    <stop offset="0.5" stop-color="#f2879a"/>
    <stop offset="1" stop-color="#8e2f45"/>
  </linearGradient>
</defs>`);
body.push(`<rect width="${W}" height="${H}" fill="url(#sea)"/>`);

// --- fish -------------------------------------------------------------------
// Shapes are drawn nose-first along +x so a single rotate matches the heading.
const FISH = 'M11,0 C3.4,-5.3 -6.8,-5.3 -7,0 C-6.8,5.3 3.4,5.3 11,0 Z';
const TAIL = 'M-7,0 L-13,-6 L-10,0 L-13,6 Z';

track.forEach((t, i) => {
  const translate = t.x.map((x, k) => `${x},${t.y[k]}`);
  const rotate = t.a.map(a => `${a}`);
  const scale = t.s.map(s => `${s}`);

  body.push(`<g opacity="0.95">
  <animateTransform attributeName="transform" type="translate" additive="replace"
    dur="${DUR}" repeatCount="indefinite" calcMode="linear"
    keyTimes="${keyTimes}" values="${loop(translate)}"/>
  <g>
    <animateTransform attributeName="transform" type="rotate" additive="replace"
      dur="${DUR}" repeatCount="indefinite" calcMode="linear"
      keyTimes="${keyTimes}" values="${loop(rotate)}"/>
    <g>${varies(scale) ? `
      <animateTransform attributeName="transform" type="scale" additive="replace"
        dur="${DUR}" repeatCount="indefinite" calcMode="linear"
        keyTimes="${keyTimes}" values="${loop(scale)}"/>` : ''}
      <path d="${TAIL}" fill="#6fe3c6" opacity="0.8"/>
      <path d="${FISH}" fill="url(#fishSkin)"/>
      <circle cx="6" cy="-1.6" r="1.1" fill="#04121c"/>
    </g>
  </g>
</g>`);
});

// --- shark ------------------------------------------------------------------
const SHARK = 'M31,0 C14,-15 -8,-12 -23,0 C-8,12 14,15 31,0 Z';
const SHARK_TAIL = 'M-23,0 L-38,-26 L-30,-2 L-36,17 Z';
const SHARK_FIN = 'M5,7 L-9,31 L-10,6 Z';

body.push(`<g>
  <animateTransform attributeName="transform" type="translate" additive="replace"
    dur="${DUR}" repeatCount="indefinite" calcMode="linear"
    keyTimes="${keyTimes}" values="${loop(sharkTrack.x.map((x, k) => `${x},${sharkTrack.y[k]}`))}"/>
  <g>
    <animateTransform attributeName="transform" type="rotate" additive="replace"
      dur="${DUR}" repeatCount="indefinite" calcMode="linear"
      keyTimes="${keyTimes}" values="${loop(sharkTrack.a.map(a => `${a}`))}"/>
    <path d="${SHARK_TAIL}" fill="#9e364c"/>
    <path d="${SHARK_FIN}" fill="#b03e56"/>
    <path d="${SHARK_FIN}" fill="#b03e56" transform="scale(1,-1)"/>
    <path d="${SHARK}" fill="url(#sharkSkin)"/>
    <circle cx="19" cy="-6" r="1.8" fill="#1a0308"/>
    <circle cx="19" cy="6" r="1.8" fill="#1a0308"/>
  </g>
</g>`);

body.push(`<rect width="${W}" height="${H}" fill="url(#vig)"/>`);
body.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none"
  stroke="#60badd" stroke-opacity="0.5" stroke-width="2" rx="4"/>`);

const label = usingChampion
  ? 'trained champion \u00b7 real simulation, recorded frame by frame'
  : 'untrained brains \u00b7 real simulation, recorded frame by frame';
body.push(`<text x="18" y="${H - 18}" font-family="ui-monospace,Consolas,monospace"
  font-size="15" fill="#9fc4d6" fill-opacity="0.75">${label}</text>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
  width="${W}" height="${H}" role="img"
  aria-label="A school of fish evading a shark in a closed tank">
${body.join('\n')}
</svg>`;

fs.mkdirSync(path.join(__dirname, '..', 'assets'), { recursive: true });
const out = path.join(__dirname, '..', 'assets', 'demo.svg');
fs.writeFileSync(out, svg);
console.log('  wrote ' + out + '  (' + (svg.length / 1024).toFixed(0) + ' KB, ' +
            track.length + ' fish, ' + FRAMES + ' frames, ' + SECONDS + 's loop)');
console.log('  champion: ' + (usingChampion ? 'yes' : 'no'));
