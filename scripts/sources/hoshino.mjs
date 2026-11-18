// 星乃珈琲店：店舗一覧（1ページの表）の「喫煙」列が禁煙以外、または「喫煙ブースあり」の店
//   node scripts/sources/hoshino.mjs → public/data/places/hoshino.json
import { get } from '../lib/fetch.mjs';
import { geocode, saveGeocodeCache } from '../lib/geocode.mjs';
import { writePlaces, locate } from '../lib/places.mjs';

const URL_LIST = 'https://www.hoshinocoffee.com/shop.html';
const h = await get(URL_LIST);
const strip = (s) => s.replace(/<span[\s\S]*?<\/span>/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
const spots = [];
let n = 0;
for (const row of h.split(/<tr/i).slice(1)) {
  const name = (row.match(/class="shop_name">([\s\S]*?)<\/div>/) || [])[1];
  const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
  if (!name || tds.length < 4) continue;
  const smoking = tds[3].split('\n')[0].trim();
  if (!/喫煙|加熱式|電子タバコ|分煙/.test(smoking) || /^禁煙$/.test(smoking)) continue;
  n++;
  const address = tds[0].split('\n')[0].trim();
  const building = tds[0].split('\n').slice(1).join(' ').trim();
  const p = await locate(geocode, address);
  const shop = strip(name).replace(/\n/g, ' ');
  if (!p) { console.warn(`位置不明: ${shop}（${address}）`); continue; }
  const heatedOnly = /加熱式たばこのみ|電子タバコのみ/.test(smoking);
  spots.push([p.lat, p.lng, `hoshino-${spots.length + 1}`, {
    name: `星乃珈琲店 ${shop.replace(/^星乃(サロン|珈琲店)\s*/, '')}`,
    note: [smoking, building, p.approx ? '※地図の位置は住所の町名までの目安' : ''].filter(Boolean).join('\n'),
    address: `${address} ${building}`.trim(),
    url: URL_LIST,
    heated: heatedOnly ? 'only' : undefined,
  }]);
}
saveGeocodeCache();
console.log(`喫煙できる店 ${n}`);
writePlaces('hoshino', { id: 'hoshino', type: 'chain', group: 'shop', label: '喫茶店（喫煙ブース等あり）', name: '星乃珈琲店 店舗一覧', publisher: '星乃珈琲店（ドトール・日レスホールディングス）', page: URL_LIST }, spots);
