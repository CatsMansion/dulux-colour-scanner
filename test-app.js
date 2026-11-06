/* Headless runtime harness: executes the real inline scripts from dist/index.html
 * against a strict DOM stub, then drives calibrate + scan end-to-end.
 * Run: node test-app.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'dist', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const problems = [];

const VW = 640, VH = 480;
const FRAME_RGB = [136, 153, 170]; // synthetic flat "camera frame"

function ctx2d() {
  return {
    drawImage() {},
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = FRAME_RGB[0]; data[i * 4 + 1] = FRAME_RGB[1];
        data[i * 4 + 2] = FRAME_RGB[2]; data[i * 4 + 3] = 255;
      }
      return { width: w, height: h, data };
    }
  };
}

const listeners = {};
function makeEl(id) {
  const el = {
    id,
    _text: '', _html: '',
    style: { setProperty() {}, left: '', top: '', width: '', height: '', background: '' },
    dataset: {}, value: '', disabled: false, checked: false,
    clientWidth: 400, clientHeight: 300,
    videoWidth: VW, videoHeight: VH,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); }
    },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    get className() { return [...this.classList._s].join(' '); },
    set className(v) { this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
    addEventListener(ev, fn) { (listeners[id] ||= {})[ev] = fn; },
    querySelectorAll() { return []; },
    getContext() { return ctx2d(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; },
    click() {}, play() { return Promise.resolve(); },
    appendChild() {}, focus() {}
  };
  return el;
}

const cache = Object.create(null);
const document = {
  getElementById(id) {
    if (!ids.has(id)) { problems.push('getElementById on non-existent id: #' + id); throw new Error('missing #' + id); }
    return cache[id] || (cache[id] = makeEl(id));
  },
  createElement(tag) {
    const el = makeEl('created-' + tag);
    el.width = 0; el.height = 0;
    return el;
  },
  addEventListener(ev, fn) { (listeners['__document'] ||= {})[ev] = fn; },
  documentElement: { style: { setProperty() {} } }
};

const store = {};
const localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};
const fakeTrack = {
  stop() {}, getCapabilities() { return { torch: true, exposureMode: ['manual', 'continuous'] }; },
  getConstraints() { return {}; },
  applyConstraints(c) { sandbox.__lastConstraints = c; return Promise.resolve(); }
};
const navigator = {
  mediaDevices: {
    getUserMedia() {
      return Promise.resolve({ getVideoTracks() { return [fakeTrack]; }, getTracks() { return [fakeTrack]; } });
    }
  }
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Uint8ClampedArray, Array, Object, String, Number, Error,
  RegExp, isFinite, parseInt, parseFloat, encodeURIComponent,
  Blob: class { constructor(p) { this.parts = p; } },
  URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
  FileReader: class { readAsText() { this.result = sandbox.__fakeCSV; if (this.onload) this.onload(); } },
  localStorage, navigator, document
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let scriptError = null;
try {
  scripts.forEach((s, i) => vm.runInContext(s, sandbox, { filename: 'inline-' + i + '.js' }));
} catch (e) { scriptError = e; }

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    cond ? pass++ : fail++;
  };
  const $ = id => cache[id];

  ok(!scriptError, 'all three inline scripts execute without throwing', scriptError ? String(scriptError.stack).split('\n')[0] : '');
  if (scriptError) { console.log(scriptError.stack); process.exit(1); }
  ok(typeof sandbox.ColorEngine === 'object', 'ColorEngine attached to window');
  ok(Array.isArray(sandbox.DULUX_DB.colours) && sandbox.DULUX_DB.colours.length === 1101, '1101 official colours embedded');

  // Fire DOMContentLoaded -> init() -> startCamera()
  const domReady = listeners['__document'] && listeners['__document'].DOMContentLoaded;
  ok(typeof domReady === 'function', 'DOMContentLoaded handler registered');
  domReady();
  await wait(60);

  ok($('dbBadge').textContent.includes('1101'), 'badge shows official colour count', $('dbBadge').textContent);
  ok(/1101/.test($('dbCount').textContent), 'settings show 1101 colours');
  ok($('btnScan').disabled === false, 'camera ready enables scan button');
  ok($('calibText').textContent === '未校准', 'starts uncalibrated');

  // Calibrate against the synthetic frame using the standard white-card mode.
  ok(typeof listeners['btnCalib'].click === 'function', 'calibrate button wired');
  listeners['btnCalib'].click();                       // opens sheet
  ok($('calibSheet').classList.contains('open'), 'calibration sheet opens');
  await wait(20);
  listeners['btnCalibRun'].click();                   // run calibration
  await wait(900);
  ok(!!store['dulux_scan_v1'], 'calibration persisted to localStorage');
  const saved = JSON.parse(store['dulux_scan_v1'] || '{}');
  ok(Array.isArray(saved.gains) && saved.gains.every(g => isFinite(g) && g > 0), 'three finite channel gains computed',
    saved.gains ? saved.gains.map(g => g.toFixed(3)).join(' / ') : '');
  ok($('calibPill').classList.contains('on'), 'calibration pill switches on');
  ok(!$('calibSheet').classList.contains('open'), 'calibration sheet closes after success');

  // Scan the synthetic frame end-to-end.
  listeners['btnScan'].click();
  await wait(1000);
  ok($('resultCard').classList.contains('show'), 'result card becomes visible');
  ok($('winName').textContent && $('winName').textContent !== '—', 'winner name rendered', $('winName').textContent);
  ok(/^[A-Z0-9]{4,7}$/.test($('winCode').textContent), 'winner Atlas code rendered', $('winCode').textContent);
  ok(/^\d+\.\d\d$/.test($('winDE').textContent), 'deltaE rendered', $('winDE').textContent);
  ok($('hexSeen').textContent.startsWith('#'), 'sampled hex rendered', $('hexSeen').textContent);
  ok($('altList').innerHTML.includes('class="alt"') && ($('altList').innerHTML.match(/class="alt"/g) || []).length === 4,
    'four alternate candidates rendered');
  ok($('confBox').innerHTML.includes('ΔE'), 'confidence explanation rendered');

  // Engine-level consistency of the rendered winner.
  const E = sandbox.ColorEngine;
  const seenHex = $('hexSeen').textContent.slice(0, 7).toLowerCase();
  const dShown = parseFloat($('winDE').textContent);
  const dCalc = E.ciede2000(E.hexToLab(seenHex), E.hexToLab($('hexMatch').textContent.slice(0, 7).toLowerCase()));
  ok(Math.abs(dShown - dCalc) < 0.03, 'displayed deltaE matches recomputed value',
    `shown=${dShown} recomputed=${dCalc.toFixed(3)}`);

  // --- torch + light-drift guard: the whole point of locking the light source ---
  ok($('btnTorch').disabled === false, 'torch capability detected, button enabled');
  ok(/补光关闭/.test($('torchText').textContent), 'torch pill starts off', $('torchText').textContent);
  listeners['btnTorch'].click();
  await wait(60);
  ok(sandbox.__lastConstraints.advanced[0].torch === true, 'torch:true sent via applyConstraints');
  ok($('torchPill').classList.contains('torch'), 'torch pill switches on');
  ok($('btnTorch').classList.contains('torch-on'), 'torch button shows active state');
  ok(!$('calibPill').classList.contains('on'), 'switching torch INVALIDATES the calibration');
  ok($('calibPill').classList.contains('warn'), 'calibration pill shows invalid warning');
  ok(JSON.parse(store['dulux_scan_v1']).gains === null, 'invalidated gains cleared from storage');

  // Recalibrate under the torch, then verify with the same (unchanged) synthetic frame.
  listeners['btnCalib'].click();
  ok(/补光灯当前开着/.test($('calibTorchNote').innerHTML), 'calibration sheet warns torch is on');
  listeners['btnCalibRun'].click();
  await wait(900);
  const underTorch = JSON.parse(store['dulux_scan_v1']);
  ok(underTorch.calibContext && underTorch.calibContext.torch === true,
    'calibration records the torch state it was made under');
  listeners['btnVerify'].click();
  await wait(900);
  ok($('calibPill').classList.contains('on'), 'white-card verification keeps a still-valid calibration');
  listeners['btnScan'].click();
  await wait(1000);
  ok(!$('contextWarn').classList.contains('show'),
    'no light warning when calibration is fresh and torch state matches');

  listeners['btnTorch'].click();
  await wait(60);
  ok(sandbox.__lastConstraints.advanced[0].torch === false, 'torch:false sent via applyConstraints');
  ok(!$('calibPill').classList.contains('on'), 'turning torch off invalidates calibration again');
  listeners['btnScan'].click();
  await wait(1000);
  ok($('contextWarn').classList.contains('show'), 'uncalibrated scan shows an explicit light warning');
  ok(/尚未校准/.test($('contextWarn').innerHTML), 'warning text tells the user what to do');

  // CSV import + restore path, driven through the real file-input handler.
  sandbox.__fakeCSV = 'code,name,hex,family\nTEST1,Test Beige,#c8bfa8,custom\nTEST2,Test Slate,#4a5560,custom\n';
  ok(typeof listeners['fileInput'].change === 'function', 'file input change handler wired');
  listeners['fileInput'].change({ target: { files: [{ name: 'x.csv' }], value: '' } });
  ok(/2 色/.test($('dbBadge').textContent), 'CSV import switches to custom badge', $('dbBadge').textContent);
  ok($('dbBadge').classList.contains('custom'), 'custom badge styling applied');
  const afterImport = JSON.parse(store['dulux_scan_v1'] || '{}');
  ok(afterImport.customDb && afterImport.customDb.length === 2, 'two custom colours persisted');
  listeners['btnRestore'].click();
  ok(/1101/.test($('dbBadge').textContent), 'restore returns to the 1101-colour official library');
  ok(typeof listeners['btnTemplate'].click === 'function', 'CSV template download handler wired');
  let templateOk = true;
  try { listeners['btnTemplate'].click(); } catch (e) { templateOk = false; }
  ok(templateOk, 'CSV template download does not throw');

  ok(problems.length === 0, 'no references to non-existent DOM ids', problems.join(', '));
  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
})();
