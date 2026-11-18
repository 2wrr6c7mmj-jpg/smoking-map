// node_modules の Leaflet を public/vendor に写す（Service Worker が同じオリジンから配信できるように）
import { cpSync, mkdirSync } from 'node:fs';
const out = new URL('../public/vendor/leaflet/', import.meta.url);
mkdirSync(out, { recursive: true });
const src = new URL('../node_modules/leaflet/dist/', import.meta.url);
for (const f of ['leaflet.js', 'leaflet.css']) cpSync(new URL(f, src), new URL(f, out));
console.log('leaflet を public/vendor/leaflet に配置しました');
