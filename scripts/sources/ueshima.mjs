// 上島珈琲店：公式の店舗検索が返す店舗一覧（1回の取得）の「席数」欄から、喫煙ブース・加熱式たばこ専用席・喫煙席のある店
//   node scripts/sources/ueshima.mjs → public/data/places/ueshima.json
import { get } from '../lib/fetch.mjs';
import { writePlaces } from '../lib/places.mjs';

const PAGE = 'https://shop.ufs.co.jp/ufs/spot/list?category=01';
const j = JSON.parse(await get('https://shop.ufs.co.jp/ufs/api/proxy2/shop/list?category=01&add=detail&limit=100', { accept: 'application/json' }));
if (j.count?.total > j.items.length) console.warn(`全 ${j.count.total}店のうち ${j.items.length}店だけ取得（ページ送りが必要）`);
const spots = [];
for (const it of j.items) {
  const seat = (it.details || []).flatMap((d) => d.texts || []).filter((x) => x.label === '席数').map((x) => x.value).join(' ');
  const labels = [];
  if (/喫煙ブース|喫煙室|喫煙ルーム/.test(seat)) labels.push('喫煙ブースあり');
  if (/加熱式/.test(seat)) labels.push('加熱式たばこ専用席あり');
  if (/喫煙(席)?[：:]\s*\d/.test(seat) && !/加熱式/.test(seat)) labels.push('喫煙席あり');
  if (!labels.length) continue;
  spots.push([it.coord.lat, it.coord.lon, `ueshima-${it.code}`, {
    name: it.name.replace(/\s+/g, ' '),
    note: labels.join('・'),
    address: it.address_name,
    heated: labels.length === 1 && labels[0].startsWith('加熱式') ? 'only' : undefined,
    url: `https://shop.ufs.co.jp/ufs/spot/detail?code=${it.code}`,
  }]);
}
console.log(`全 ${j.items.length}店、喫煙できる店 ${spots.length}`);
writePlaces('ueshima', { id: 'ueshima', type: 'chain', group: 'shop', label: '喫茶店（喫煙ブース等あり）', name: '上島珈琲店 店舗検索', publisher: 'ユーシーシーフードサービスシステムズ', page: PAGE }, spots);
