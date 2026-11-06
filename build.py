"""Build dist/: one self-contained index.html + offline PWA assets.
   Run: python build.py

   THIRD-PARTY DATA NOTICE
   -----------------------
   dulux-db.json holds 1,101 colour records (name / Atlas code / sRGB hex) scraped
   on 2026-11-06 from the public colour directory pages of dulux.com.au
   (9 colour families). These are web display values, NOT spectrophotometric data.
   Dulux, the colour names and the fan deck remain the property of their respective
   owners; the official site itself states on-screen colour values are a guide only
   and recommends checking a physical A4 swatch or sample pot. This project is a
   non-commercial technical demo. Replace dulux-db.json with your own licensed
   dataset (CSV columns: code,name,hex,family) for any commercial use.
"""
import json
import shutil
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)

template = (ROOT / "app-template.html").read_text(encoding="utf-8")
engine = (ROOT / "color-engine.js").read_text(encoding="utf-8")
db = json.loads((ROOT / "dulux-db.json").read_text(encoding="utf-8"))

assert "/*__ENGINE__*/" in template and "/*__DB__*/" in template, "placeholders missing"
assert "</script" not in engine.lower(), "engine contains a script-closing token"

db_js = "window.DULUX_DB=" + json.dumps(db, ensure_ascii=False, separators=(",", ":")) + ";"
SHARECODE = "PQPJUV7IVW"
# The published host gates EVERY subresource behind ?sharecode=. A plain relative
# URL from the page (manifest / icon / sw.js) gets a 403, which silently breaks
# "Add to Home Screen" and the offline cache. If a redeploy ever changes the
# sharecode, update this constant and rebuild.
QUERY = "?sharecode=" + SHARECODE

html = template.replace("/*__ENGINE__*/", engine).replace("/*__DB__*/", db_js).replace("__SHARECODE__", SHARECODE)
assert "__ENGINE__" not in html and "__DB__" not in html and "__SHARECODE__" not in html
(DIST / "index.html").write_text(html, encoding="utf-8")

shutil.copyfile(ROOT / "dulux-au-colours.csv", DIST / "dulux-au-colours.csv")

manifest = {
    "name": "Dulux 取色器 - 相机识别油漆颜色",
    "short_name": "取色器",
    "description": "用安卓相机对漆面取样，白卡校准后匹配最近的 Dulux 官方色号。全部本地处理。",
    "start_url": "./index.html" + QUERY,
    "scope": "./",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#f4f6f8",
    "theme_color": "#002C65",
    "lang": "zh-CN",
    "icons": [
        {"src": "icon-192.png" + QUERY, "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icon-512.png" + QUERY, "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icon-512.png" + QUERY, "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
(DIST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

sw = """/* network-first so fixes land immediately; falls back to cache offline */
const CACHE = 'dulux-scan-v3';
/* The share-gated host rejects subresource requests without the sharecode.
   This script is registered WITH the query, so self.location.search retains it. */
const Q = self.location.search || '';
const CORE = ['./' + Q, './index.html' + Q, './manifest.json' + Q,
              './icon-192.png' + Q, './icon-512.png' + Q];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
"""
(DIST / "sw.js").write_text(sw, encoding="utf-8")


def png_bytes(rgb_rows, width, height):
    buf = bytearray()
    for row in rgb_rows:
        buf.append(0)
        for r, g, b in row:
            buf += bytes((r, g, b))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(buf), 9))
            + chunk(b"IEND", b""))


def icon(size):
    blue, white, sand = (0, 44, 101), (255, 255, 255), (238, 236, 230)
    o, t = size * 0.19, size * 0.055          # frame origin / thickness
    c0, c1 = size * 0.37, size * 0.63          # centre swatch
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            col = blue
            inside = o <= x <= size - o and o <= y <= size - o
            on_frame = inside and (
                x < o + t or x > size - o - t or y < o + t or y > size - o - t
            )
            if on_frame:
                col = white
            elif c0 <= x <= c1 and c0 <= y <= c1:
                col = sand
            row.append(col)
        rows.append(row)
    return png_bytes(rows, size, size)


(DIST / "icon-192.png").write_bytes(icon(192))
(DIST / "icon-512.png").write_bytes(icon(512))

print("dist/index.html", (DIST / "index.html").stat().st_size, "bytes")
print("colours embedded", len(db["colours"]))
for p in sorted(DIST.iterdir()):
    print("  ", p.name, p.stat().st_size)
