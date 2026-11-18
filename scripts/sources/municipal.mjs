// 市区の公式ページに載っている公衆喫煙所（名称と住所の事実だけを scripts/data/municipal-spots.json に記録したもの）を
// 緯度経度にして public/data/places/cities.json に書き出す。
// オープンデータ（CC BY）として出している自治体は fetch-opendata.mjs（gov.json）で扱い、こちらは一覧ページだけの自治体。
//   node scripts/sources/municipal.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { geocode, saveGeocodeCache } from '../lib/geocode.mjs';
import { cleanAddress } from '../lib/places.mjs';

const SLUG = {
  川崎市: 'kawasaki', 神戸市: 'kobe', 広島市: 'hiroshima', 浜松市: 'hamamatsu', 千葉市: 'chiba', 熊本市: 'kumamoto',
  尼崎市: 'amagasaki', 明石市: 'akashi', 長崎市: 'nagasaki',
};
const rows = JSON.parse(readFileSync(new URL('../data/municipal-spots.json', import.meta.url), 'utf8'));
const byCity = new Map();
const spots = [];
let skipped = 0;
for (const r of rows) {
  const slug = SLUG[r.city] || r.slug;
  if (!slug) { console.warn(`市の ID がありません: ${r.city}（SLUG に足す）`); skipped++; continue; }
  let lat = Number(r.lat), lng = Number(r.lng), approx = false;
  if (!r.lat || !r.lng || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    const g = r.address && ((await geocode(cleanAddress(r.address))) || (await geocode(r.address)));
    if (!g) { console.warn(`位置不明: ${r.city} ${r.name}（${r.address}）`); skipped++; continue; }
    // 住所の番地・街区まで一致しなければ、喫煙所の位置としては粗すぎるので注記する
    ({ lat, lng } = g);
    approx = g.level === 'town' || r.address_level === 'town';
  }
  const c = byCity.get(r.city) || { id: `city-${slug}`, type: 'gov', group: 'area', city: r.city, publisher: r.city, license: '市の公開ページ', page: r.page, count: 0 };
  c.count++;
  byCity.set(r.city, c);
  spots.push([+lat.toFixed(6), +lng.toFixed(6), `city-${slug}-${c.count}`, Object.fromEntries(Object.entries({
    name: r.name, address: r.address, hours: r.hours,
    note: [r.memo, approx ? '※地図の位置は住所の町名までの目安' : ''].filter(Boolean).join('\n'),
    url: r.page,
  }).filter(([, v]) => v))]);
}
saveGeocodeCache();
writeFileSync(new URL('../../public/data/places/cities.json', import.meta.url), JSON.stringify({ updated: new Date().toISOString(), sources: [...byCity.values()], spots }, null, 1));
console.log([...byCity.values()].map((c) => `${c.city} ${c.count}`).join(' / '), `（位置不明・除外 ${skipped}）`);
