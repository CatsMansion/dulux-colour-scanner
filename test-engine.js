/* Verification harness for color-engine.js. Run: node test-engine.js */
const E = require('./color-engine.js');
const fs = require('fs');
let pass = 0, fail = 0;

function near(actual, expected, tol, label) {
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} got=${actual.toFixed(6)} expected=${expected}`);
  ok ? pass++ : fail++;
}

// Sharma, Wu & Dalal (2005) CIEDE2000 reference table
const ref = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
  [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0000],
  [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0000],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.4900, -0.0010], [50, -2.4900, 0.0009], 7.1792],
  [[50, 2.4900, -0.0010], [50, -2.4900, 0.0010], 7.1792],
  [[50, 2.4900, -0.0010], [50, -2.4900, 0.0011], 7.2195],
  [[50, 2.4900, -0.0010], [50, -2.4900, 0.0012], 7.2195],
  [[50, -0.0010, 2.4900], [50, 0, -2.4900], 4.8045],
  [[50, 2.5000, 0], [50, 0, -2.5000], 4.3065],
  [[2.0776, 0.0795, -1.1350], [0.9033, -0.0636, -0.5514], 0.9082]
];
console.log('--- CIEDE2000 standard reference (tol 0.0002) ---');
ref.forEach((r, i) => near(E.ciede2000(r[0], r[1]), r[2], 0.0002, `Sharma pair #${i + 1}`));
// Parametric k factors: verify the maths directly rather than quoting a half-remembered table row.
const lightA = [40, 10, 10], lightB = [60, 10, 10]; // dL != 0, dC = 0, dH = 0
const base = E.ciede2000(lightA, lightB);
near(E.ciede2000(lightA, lightB, 2, 1, 1), base / 2, 1e-9, 'kL=2 halves a pure-lightness difference');
near(E.ciede2000(lightA, lightB), E.ciede2000(lightB, lightA), 1e-10, 'symmetry');

console.log('\n--- colour space sanity ---');
// Tolerance is matrix-precision driven: the sRGB->XYZ coefficients are published
// to 7 decimals, so D65 white does not land on exactly L*=100, a*=b*=0.
near(E.rgbToLab([255, 255, 255])[0], 100, 0.001, 'white L*');
near(E.rgbToLab([255, 255, 255])[1], 0, 0.001, 'white a*');
near(E.rgbToLab([0, 0, 0])[0], 0, 1e-9, 'black L*');
near(E.ciede2000(E.hexToLab('#f7f8f4'), E.hexToLab('#f7f8f4')), 0, 1e-12, 'identical colour dE=0');

console.log('\n--- white-card calibration ---');
const castWhite = [198, 210, 242]; // bluish cast from warm indoor light / bad AWB
const gains = E.computeWhiteGains(castWhite);
const corrected = E.applyGains(castWhite, gains);
near(corrected[0], 246, 0.6, 'R channel reaches target');
near(corrected[1], 246, 0.6, 'G channel reaches target');
near(corrected[2], 246, 0.6, 'B channel reaches target');
const trueColour = [176, 158, 132];
const seenAs = E.applyGains(trueColour, [1 / gains[0], 1 / gains[1], 1 / gains[2]]);
const dRaw = E.ciede2000(E.rgbToLab(seenAs), E.rgbToLab(trueColour));
const dFixed = E.ciede2000(E.rgbToLab(seenAs.map((v, i) => E.linearToSrgb(E.srgbToLinear(v) * gains[i]))), E.rgbToLab(trueColour));
console.log(`INFO  colour cast: raw dE=${dRaw.toFixed(3)} -> calibrated dE=${dFixed.toFixed(3)}`);
const calibWorks = dFixed < 0.05 && dRaw > 2;
console.log(`${calibWorks ? 'PASS' : 'FAIL'}  calibration removes a synthetic colour cast`);
calibWorks ? pass++ : fail++;

console.log('\n--- robust region sampling ---');
const w = 20, h = 20, data = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < w * h; i++) { data[i * 4] = 120; data[i * 4 + 1] = 100; data[i * 4 + 2] = 80; data[i * 4 + 3] = 255; }
// inject a blown highlight (5%) and a dark speck (5%)
for (let i = 0; i < 10; i++) { data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; }
for (let i = 390; i < 400; i++) { data[i * 4] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = 0; }
const s = E.sampleRegion({ width: w, height: h, data }, 10, 10, 20, 0.10);
near(s.rgb[0], 120, 0.001, 'trimmed mean R rejects highlight/shadow');
near(s.rgb[1], 100, 0.001, 'trimmed mean G rejects highlight/shadow');
near(s.rgb[2], 80, 0.001, 'trimmed mean B rejects highlight/shadow');

console.log('\n--- Dulux AU colour database ---');
const raw = JSON.parse(fs.readFileSync('./dulux-db.json', 'utf8'));
const db = raw.colours.map(c => ({ code: c[0], name: c[1], hex: c[2], family: raw.families[c[3]], lab: E.hexToLab(c[2]) }));
const bad = db.filter(c => !c.lab || !isFinite(c.lab[0]) || c.lab[0] < 0 || c.lab[0] > 100);
console.log(`${bad.length === 0 ? 'PASS' : 'FAIL'}  all ${db.length} official colours parse to valid Lab`);
bad.length === 0 ? pass++ : fail++;
const probe = E.hexToLab('#f7f8f4');
const top = E.match(probe, db, 5);
console.log(`INFO  probe Vivid White #f7f8f4 -> ${top.map(t => `${t.code} ${t.name} (dE ${t.dE.toFixed(3)})`).join(' | ')}`);
const exactHit = top[0].code === 'SW1G1' && top[0].dE < 1e-9;
console.log(`${exactHit ? 'PASS' : 'FAIL'}  exact hex resolves to its own Dulux code at dE=0`);
exactHit ? pass++ : fail++;

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
