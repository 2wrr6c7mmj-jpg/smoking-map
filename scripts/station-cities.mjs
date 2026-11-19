// 喫煙所データがなく未調査の駅（scripts/data/station-gaps.json）の所在市区を調べ、市区ごとにまとめる。
// 位置 → 市区は OpenStreetMap の地名検索（逆引き）。1秒に1回まで、結果は scripts/cache/station-city.json に保存。
//   node scripts/station-cities.mjs  → scripts/data/unchecked-cities.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const UA = 'kemuri-map-data/1.0 (+https://github.com/2wrr6c7mmj-jpg/smoking-map)';
const CACHE = new URL('./cache/station-city.json', import.meta.url);
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const gaps = JSON.parse(readFileSync(new URL('./data/station-gaps.json', import.meta.url), 'utf8')).filter((g) => !g.checked);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
for (const g of gaps) {
  const key = `${g.lat},${g.lng}`;
  if (!(key in cache)) {
    await sleep(1100);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&accept-language=ja&lat=${g.lat}&lon=${g.lng}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
      const a = (await res.json()).address || {};
      // 東京23区は区、政令指定都市は市、それ以外は市町村
      const pref = a.province || a.state || (a['ISO3166-2-lvl4'] === 'JP-13' ? '東京都' : '');
      const city = a.city || a.town || a.village || a.municipality || a.county || '';
      const ward = a.city_district || a.suburb || '';
      cache[key] = { pref: pref === '東京' ? '東京都' : pref, city: city === '東京' || !city ? ward : city };
    } catch { cache[key] = null; }
    if (++n % 50 === 0) { writeFileSync(CACHE, JSON.stringify(cache)); console.log(`  ${n}駅`); }
  }
  g.pref = cache[key]?.pref || '';
  g.city = cache[key]?.city || '';
}
writeFileSync(CACHE, JSON.stringify(cache));
const byCity = new Map();
for (const g of gaps) {
  const k = `${g.pref}|${g.city}`;
  const c = byCity.get(k) || { pref: g.pref, city: g.city, riders: 0, stations: [] };
  c.riders += g.riders; c.stations.push(g.name);
  byCity.set(k, c);
}
const out = [...byCity.values()].sort((a, b) => b.riders - a.riders);
writeFileSync(new URL('./data/unchecked-cities.json', import.meta.url), JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{'));
console.log(`未調査の駅 ${gaps.length} → ${out.length}市区（所在不明 ${gaps.filter((g) => !g.city).length}駅）`);
