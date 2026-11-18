"""Builds the Gerrila quote app.
- dist/artifact.html : fragment for the claude.ai Artifact preview
- docs/index.html    : standalone PWA (GitHub Pages / any static host)
"""
import base64, io, json, pathlib
from PIL import Image
root = pathlib.Path(__file__).parent
app = (root/'src/app.html').read_text()
places = (root/'src/places.js').read_text()
im = Image.open(root/'assets/logo-full.png').convert('RGBA')
b = io.BytesIO(); im.resize((256,256), Image.LANCZOS).save(b, 'WEBP', quality=82)
logo = 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()
frag = app.replace('@@LOGO@@', logo).replace('/*@@PLACES@@*/', places)
(root/'dist').mkdir(exist_ok=True)
(root/'dist/artifact.html').write_text(frag)

docs = root/'docs'; docs.mkdir(exist_ok=True)
for s in (180, 192, 512):
    im.resize((s, s), Image.LANCZOS).save(docs/f'icon-{s}.png')
(docs/'manifest.webmanifest').write_text(json.dumps({
  "name": "גררילה · מחשבון גרירה", "short_name": "גררילה", "lang": "he", "dir": "rtl",
  "start_url": "./", "display": "standalone", "background_color": "#0E0E0D", "theme_color": "#0E0E0D",
  "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}]
}, ensure_ascii=False, indent=1))
(docs/'sw.js').write_text("""const C='grr-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html','./manifest.webmanifest','./icon-192.png'])));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp)).catch(()=>{});return r}).catch(()=>caches.match(e.request)))});
""")
head = """<!doctype html>
<html lang="he" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0E0E0D">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="גררילה">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" href="icon-192.png">
<style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>
</head><body>
"""
tail = "\n<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{})</script>\n</body></html>\n"
(docs/'index.html').write_text(head + frag + tail)
print('built', len(frag)//1024, 'KB')
