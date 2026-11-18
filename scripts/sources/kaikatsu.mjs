// 快活CLUB：店舗検索のデータファイル（/shop/data/shop.js）で設備に「加熱式たばこ専用エリア」がある店
//   node scripts/sources/kaikatsu.mjs → public/data/places/kaikatsu.json
import { get } from '../lib/fetch.mjs';
import { geocode, saveGeocodeCache } from '../lib/geocode.mjs';
import { writePlaces, locate } from '../lib/places.mjs';

const t = await get('https://www.kaikatsu.jp/shop/data/shop.js', { accept: '*/*' });
// 「var stores = {...};」の部分だけを JSON として読む（プログラムとして実行はしない）
const body = t.slice(t.indexOf('{', t.indexOf('var stores')));
const json = body.slice(0, body.lastIndexOf('}') + 1).replace(/,\s*([}\]])/g, '$1');
const stores = Object.values(JSON.parse(json)).flat();
const now = new Date();
const target = stores.filter((s) => (s.service || []).includes('加熱式たばこ専用エリア') && (!s.publish_end || new Date(s.publish_end.replace(/\//g, '-')) > now));
console.log(`全 ${stores.length}店、加熱式たばこ専用エリアあり ${target.length}店`);
const spots = [];
for (const s of target) {
  const p = await locate(geocode, s.address);
  if (!p) { console.warn(`位置不明: ${s.store_name}（${s.address}）`); continue; }
  spots.push([p.lat, p.lng, `kaikatsu-${s.store_code}`, {
    name: `快活CLUB ${s.store_name}`,
    note: ['加熱式たばこ専用エリアあり（店内・利用者向け）', p.approx ? '※地図の位置は住所の町名までの目安' : ''].filter(Boolean).join('\n'),
    address: s.address,
    url: `https://www.kaikatsu.jp/shop/detail/${s.store_code}.html`,
    heated: 'only',
  }]);
}
saveGeocodeCache();
writePlaces('kaikatsu', { id: 'kaikatsu', type: 'chain', group: 'shop', label: 'ネットカフェ（加熱式たばこ専用エリア）', name: '快活CLUB 店舗検索', publisher: '快活フロンティア', page: 'https://www.kaikatsu.jp/shop/' }, spots);
