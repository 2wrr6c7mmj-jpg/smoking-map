// 目印（駅名・公園名など）→ 緯度経度。OpenStreetMap の地名検索（Nominatim）を使う。
// 利用方針に従い 1秒に1回まで・身元を名乗る・結果は scripts/cache/landmark.json に保存して再利用。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CACHE = new URL('../cache/landmark.json', import.meta.url);
const UA = 'kemuri-map-data/1.0 (+https://github.com/2wrr6c7mmj-jpg/smoking-map)';
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let dirty = false;
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// city（「町田市」「港区」）の中にある結果だけを採用する。同名の駅や公園が他県にあるため
export async function landmark(name, city, pref = '') {
  const key = `${pref}|${city}|${name}`;
  if (key in cache) return cache[key];
  let hit = null;
  // 「大阪市天王寺区」のような市＋区は、検索結果の所在地では「天王寺区, 大阪市」と別々に出るので分けて照合する
  const parts = city.match(/^(.+?市)(.+区)$/)?.slice(1) || [city];
  const inCity = (x) => parts.every((p) => x.display_name.includes(p));
  for (const q of [...new Set([`${name} ${parts.join(' ')}`, `${name} ${parts[0]}`, `${name} ${pref}`.trim()])]) {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=jp&accept-language=ja&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const list = await res.json();
      const base = parts[0].replace(/(市|区|町|村)$/, '');
      const ok = list.find(inCity) || list.find((x) => x.display_name.includes(parts[0]))
        || list.find((x) => (x.name || '').includes(name.replace(/駅$/, '')) && x.display_name.includes(base));
      if (ok) { hit = { lat: Number(ok.lat), lng: Number(ok.lon), title: ok.display_name.split(',').slice(0, 3).join(',') }; break; }
    } catch { /* 次の問い合わせへ */ }
  }
  cache[key] = hit;
  dirty = true;
  return hit;
}

export function saveLandmarkCache() {
  if (dirty) writeFileSync(CACHE, JSON.stringify(cache));
  dirty = false;
}
