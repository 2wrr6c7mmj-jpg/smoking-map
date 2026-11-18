// C-United（カフェ・ベローチェ、珈琲館、カフェ・ド・クリエ ほか）：公式の店舗検索が返す店舗一覧（1回の取得）から、
// 全席禁煙以外（喫煙ブース・加熱式専用室・喫煙可など）の店
//   node scripts/sources/cunited.mjs → public/data/places/cunited.json
import { get } from '../lib/fetch.mjs';
import { writePlaces } from '../lib/places.mjs';

const SEARCH = 'https://c-united.co.jp/search/';
const stores = JSON.parse(await get('https://c-united.co.jp/store/request_search/?bounds=20,46,122,154', { accept: 'application/json' }));
const FLAGS = [
  ['smoking_room', '喫煙ブース（専用室）あり'],
  ['smoking_room_kanetsushiki', '加熱式たばこ専用喫煙室あり'],
  ['smoking_electric_exclusive', '加熱式たばこ専用'],
  ['smoking_possible', '喫煙可'],
  ['smoking_bunen', '分煙'],
  ['smoking_purpose', '喫煙目的店'],
  ['smoking_exist_purpose', '喫煙目的店'],
];
const today = new Date();
const closed = (s) => s.open_end_year && new Date(s.open_end_year, (s.open_end_month || 12) - 1, s.open_end_day || 28) < today;
const spots = [];
for (const s of stores) {
  const labels = [...new Set(FLAGS.filter(([k]) => s[k] === 1).map(([, v]) => v))];
  if (!labels.length || closed(s)) continue;
  const heatedOnly = labels.every((l) => l.startsWith('加熱式'));
  spots.push([Number(s.latitude), Number(s.longitude), `cunited-${s.code}`, {
    name: `${s.brand_str} ${s.name}`,
    note: labels.join('・'),
    address: `${s.pref}${s.address} ${s.address2 || ''}`.trim(),
    hours: s.business_hours || undefined,
    heated: heatedOnly ? 'only' : undefined,
    url: SEARCH,
  }]);
}
console.log(`全 ${stores.length}店、喫煙できる店 ${spots.length}`);
writePlaces('cunited', { id: 'cunited', type: 'chain', group: 'shop', label: '喫茶店（喫煙ブース等あり）', name: 'C-United 店舗検索（ベローチェ・珈琲館・カフェ・ド・クリエ等）', publisher: 'C-United', page: SEARCH }, spots);
