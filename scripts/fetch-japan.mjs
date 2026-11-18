// 日本全国の喫煙所を OpenStreetMap（Overpass API）から取得し、1度四方の区画ごとの JSON にする。
//   node scripts/fetch-japan.mjs            → public/data/jp/ に書き出す
// 区画ごとに問い合わせるのは、全国を一度に問い合わせると Overpass が時間切れになるため。
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';

const ENDPOINTS = (process.env.OVERPASS || 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',');
const OUT = new URL('../public/data/jp/', import.meta.url);
const STEP = 2; // 問い合わせの区画（度）
// 日本の陸地を含む範囲（南西諸島〜北海道、小笠原）
const RANGES = [
  { s: 24, n: 28, w: 122, e: 132 },   // 先島・沖縄・奄美
  { s: 26, n: 28, w: 140, e: 144 },   // 小笠原
  { s: 30, n: 46, w: 128, e: 146 },   // 九州〜北海道
  { s: 24, n: 26, w: 140, e: 142 },   // 硫黄島など
];

const SMOKING_OK = 'yes|separated|isolated|dedicated|outside';
const KEEP = ['name', 'name:ja', 'smoking', 'amenity', 'shop', 'tourism', 'leisure', 'waste', 'covered', 'shelter', 'indoor', 'location', 'smoking_area', 'opening_hours', 'fee', 'operator', 'level', 'description', 'note'];

// 問い合わせ範囲に入る近隣国（韓国・北朝鮮・ロシア）を座標で除く。日本の島はこの線の内側に入らない
function inJapan(lat, lng) {
  if (lat > 45.6) return false;                    // サハリン
  if (lat > 43.45 && lng > 145.35) return false;   // 千島（国後島など）
  if (lat > 42 && lng < 139) return false;         // 沿海州・北朝鮮北部
  if (lat > 34.75 && lng < 131.5) return false;    // 朝鮮半島東岸・鬱陵島
  if (lat > 33.75 && lng < 129.15) return false;   // 朝鮮半島南岸（対馬の西）
  if (lat > 32.9 && lng < 128.5) return false;     // 済州島など
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(b) {
  const bbox = `${b.s},${b.w},${b.n},${b.e}`;
  // 国境での絞り込み（area）は重く時間切れになりやすいので、範囲だけで問い合わせて inJapan() で除く
  const q = `[out:json][timeout:170];(nwr["amenity"="smoking_area"](${bbox});nwr["waste"~"cigarettes"](${bbox});nwr["smoking"~"(^|;)(${SMOKING_OK})(;|$)"]["amenity"!="smoking_area"](${bbox}););out center tags;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: q }),
        headers: { 'user-agent': 'kemuri-map-data/1.0' },
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
      if (j.remark && /runtime error/i.test(j.remark)) throw new Error(j.remark);
      return j.elements;
    } catch (e) {
      console.warn(`  ${bbox} ${new URL(url).host} 失敗: ${e.message}`);
      await sleep(5000 * (attempt + 1));
    }
  }
  return null;
}

// 端末で使う形：[緯度, 経度, 種類ID, タグ]（座標は約10cm単位に丸める）
function compact(el) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null) return null;
  const tags = {};
  for (const [k, v] of Object.entries(el.tags || {})) {
    if (KEEP.includes(k) || /heated/.test(k)) tags[k] = v;
  }
  return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, `${el.type[0]}${el.id}`, tags];
}

const cells = {};
const missing = [];
const seen = new Set();
let total = 0;
for (const r of RANGES) {
  for (let s = r.s; s < r.n; s += STEP) {
    for (let w = r.w; w < r.e; w += STEP) {
      const els = await query({ s, w, n: Math.min(s + STEP, r.n), e: Math.min(w + STEP, r.e) });
      if (!els) { missing.push(`${s},${w}`); console.warn(`${s},${w} を取得できませんでした`); continue; }
      for (const el of els) {
        const id = `${el.type}/${el.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const c = compact(el);
        if (!c || !inJapan(c[0], c[1])) continue;
        const key = `${Math.floor(c[0])}_${Math.floor(c[1])}`;
        (cells[key] ??= []).push(c);
        total++;
      }
      console.log(`${s},${w} → ${els.length}件（累計 ${total}）`);
      await sleep(1500);
    }
  }
}

if (missing.length && !process.env.ALLOW_MISSING) throw new Error(`取得できなかった区画があります: ${missing.join(' ')}（ALLOW_MISSING=1 で一部欠けたまま書き出せます）`);
if (total < 100) throw new Error(`件数が少なすぎます（${total}件）。取得に失敗した可能性があるため書き出しません`);
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(new URL(f, OUT));
const index = { updated: new Date().toISOString(), total, source: 'OpenStreetMap contributors (ODbL)', missing, cells: {} };
for (const [k, list] of Object.entries(cells)) {
  writeFileSync(new URL(`${k}.json`, OUT), JSON.stringify(list));
  index.cells[k] = list.length;
}
writeFileSync(new URL('index.json', OUT), JSON.stringify(index, null, 1));
console.log(`書き出し: ${total}件 / ${Object.keys(cells).length}区画`);
