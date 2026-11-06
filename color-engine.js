/* Dulux Colour Scanner - colour engine
 * sRGB -> linear RGB -> XYZ(D65) -> CIE Lab, CIEDE2000, white-card calibration.
 * No dependencies. Works in browser (window.ColorEngine) and Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ColorEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  var WHITE_D65 = [0.95047, 1.00000, 1.08883];
  var EPS = 216 / 24389;      // (6/29)^3
  var KAPPA = 24389 / 27;     // 29^3/3^3

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function srgbToLinear(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    c = clamp(c, 0, 1);
    var v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return clamp(Math.round(v * 255), 0, 255);
  }

  function hexToRgb(hex) {
    var h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) {
      return ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2);
    }).join('');
  }

  function rgbToXyz(rgb) {
    var r = srgbToLinear(rgb[0]), g = srgbToLinear(rgb[1]), b = srgbToLinear(rgb[2]);
    return [
      0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
      0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
      0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    ];
  }

  function labF(t) { return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116; }

  function xyzToLab(xyz) {
    var fx = labF(xyz[0] / WHITE_D65[0]);
    var fy = labF(xyz[1] / WHITE_D65[1]);
    var fz = labF(xyz[2] / WHITE_D65[2]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function rgbToLab(rgb) { return xyzToLab(rgbToXyz(rgb)); }
  function hexToLab(hex) { var c = hexToRgb(hex); return c ? rgbToLab(c) : null; }

  /* CIEDE2000, Sharma, Wu & Dalal (2005). Returns deltaE00. */
  function ciede2000(lab1, lab2, kL, kC, kH) {
    kL = kL || 1; kC = kC || 1; kH = kH || 1;
    var L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
    var L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];

    var C1 = Math.sqrt(a1 * a1 + b1 * b1);
    var C2 = Math.sqrt(a2 * a2 + b2 * b2);
    var Cbar = (C1 + C2) / 2;
    var Cbar7 = Math.pow(Cbar, 7);
    var G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1);
    var C2p = Math.sqrt(a2p * a2p + b2 * b2);

    function hp(bb, ap) {
      if (ap === 0 && bb === 0) return 0;
      var h = Math.atan2(bb, ap) / DEG;
      return h >= 0 ? h : h + 360;
    }
    var h1p = hp(b1, a1p), h2p = hp(b2, a2p);

    var dLp = L2 - L1;
    var dCp = C2p - C1p;
    var dhp;
    if (C1p * C2p === 0) dhp = 0;
    else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
    else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
    else dhp = h2p - h1p + 360;
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * DEG / 2);

    var Lbarp = (L1 + L2) / 2;
    var Cbarp = (C1p + C2p) / 2;
    var hbarp;
    if (C1p * C2p === 0) hbarp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;

    var T = 1
      - 0.17 * Math.cos((hbarp - 30) * DEG)
      + 0.24 * Math.cos((2 * hbarp) * DEG)
      + 0.32 * Math.cos((3 * hbarp + 6) * DEG)
      - 0.20 * Math.cos((4 * hbarp - 63) * DEG);
    var dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    var Cbarp7 = Math.pow(Cbarp, 7);
    var Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
    var Lm50sq = Math.pow(Lbarp - 50, 2);
    var SL = 1 + (0.015 * Lm50sq) / Math.sqrt(20 + Lm50sq);
    var SC = 1 + 0.045 * Cbarp;
    var SH = 1 + 0.015 * Cbarp * T;
    var Rt = -Math.sin(2 * dTheta * DEG) * Rc;

    var tL = dLp / (kL * SL);
    var tC = dCp / (kC * SC);
    var tH = dHp / (kH * SH);
    return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
  }

  /* White-card calibration. Gains are computed and applied in LINEAR light,
   * which is the physically correct place for a von Kries style correction.
   * target defaults to a slightly off-paper white to avoid clipping. */
  function computeWhiteGains(sampledWhite, target) {
    target = target || [246, 246, 246];
    var s = [], t = [];
    for (var i = 0; i < 3; i++) {
      s.push(srgbToLinear(clamp(sampledWhite[i], 1, 255)));
      t.push(srgbToLinear(target[i]));
    }
    return [t[0] / s[0], t[1] / s[1], t[2] / s[2]];
  }

  function applyGains(rgb, gains) {
    if (!gains) return rgb.slice();
    return [0, 1, 2].map(function (i) {
      return linearToSrgb(srgbToLinear(clamp(rgb[i], 0, 255)) * gains[i]);
    });
  }

  /* Robust region average: sort by luma, drop the brightest and darkest tails,
   * then average. Kills specular highlights and small shadows. */
  function sampleRegion(imageData, cx, cy, size, trimPct) {
    trimPct = trimPct == null ? 0.10 : trimPct;
    var w = imageData.width, h = imageData.height, d = imageData.data;
    var half = Math.max(2, Math.floor(size / 2));
    var x0 = clamp(Math.round(cx - half), 0, w - 1);
    var x1 = clamp(Math.round(cx + half), 0, w - 1);
    var y0 = clamp(Math.round(cy - half), 0, h - 1);
    var y1 = clamp(Math.round(cy + half), 0, h - 1);
    var px = [];
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var p = (y * w + x) * 4;
        var r = d[p], g = d[p + 1], b = d[p + 2];
        px.push([0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b]);
      }
    }
    if (!px.length) return null;
    px.sort(function (a, b) { return a[0] - b[0]; });
    var cut = Math.floor(px.length * trimPct);
    var lo = cut, hi = px.length - cut;
    if (hi <= lo) { lo = 0; hi = px.length; }
    var sum = [0, 0, 0];
    for (var k = lo; k < hi; k++) {
      sum[0] += px[k][1]; sum[1] += px[k][2]; sum[2] += px[k][3];
    }
    var n = hi - lo;
    return {
      rgb: [sum[0] / n, sum[1] / n, sum[2] / n],
      pixels: n,
      total: px.length
    };
  }

  /* db: array of {code,name,hex,lab}. Returns top-N nearest with deltaE. */
  function match(lab, db, topN) {
    topN = topN || 5;
    var out = new Array(db.length);
    for (var i = 0; i < db.length; i++) {
      out[i] = { index: i, dE: ciede2000(lab, db[i].lab) };
    }
    out.sort(function (a, b) { return a.dE - b.dE; });
    return out.slice(0, topN).map(function (o) {
      var c = db[o.index];
      return { code: c.code, name: c.name, hex: c.hex, family: c.family, dE: o.dE };
    });
  }

  function confidence(dE) {
    if (dE < 1.0) return { label: '几乎不可分辨', level: 'great', text: 'ΔE<1，人眼基本分不出差别' };
    if (dE < 2.3) return { label: '高度接近', level: 'good', text: 'ΔE 1–2.3，很接近，仍建议核对实物色卡' };
    if (dE < 5.0) return { label: '可参考', level: 'fair', text: 'ΔE 2.3–5，只能缩小范围，别当结论' };
    return { label: '差距明显', level: 'poor', text: 'ΔE>5，光照或取样可能有问题，重新校准' };
  }

  return {
    srgbToLinear: srgbToLinear, linearToSrgb: linearToSrgb,
    hexToRgb: hexToRgb, rgbToHex: rgbToHex,
    rgbToXyz: rgbToXyz, xyzToLab: xyzToLab,
    rgbToLab: rgbToLab, hexToLab: hexToLab,
    ciede2000: ciede2000,
    computeWhiteGains: computeWhiteGains, applyGains: applyGains,
    sampleRegion: sampleRegion, match: match, confidence: confidence
  };
});
