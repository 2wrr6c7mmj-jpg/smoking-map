// 駅構内・駅ビルの喫煙所（鉄道会社の公式案内から、駅名と構内の場所だけを scripts/data/station-spots.json に記録したもの）を
// public/data/places/stations.json に書き出す。位置は駅そのもの（OpenStreetMap の地名検索）で、構内の場所は文章で示す。
//   node scripts/sources/stations.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { landmark, saveLandmarkCache } from '../lib/landmark.mjs';

const OPS = {
  JR東海: 'jrc', JR西日本: 'jrw', JR東日本: 'jre', JR九州: 'jrk', JR北海道: 'jrh', JR四国: 'jrs',
  近鉄: 'kintetsu', 名鉄: 'meitetsu', 南海: 'nankai', 京阪: 'keihan', 阪急: 'hankyu', 阪神: 'hanshin', 西鉄: 'nishitetsu',
  東武: 'tobu', 西武: 'seibu', 小田急: 'odakyu', 京王: 'keio', 東急: 'tokyu', 京急: 'keikyu', 京成: 'keisei', 相鉄: 'sotetsu',
  東京メトロ: 'metro', 都営地下鉄: 'toei', OsakaMetro: 'osakametro',
};
const slugOf = (op) => OPS[op.replace(/\s/g, '')] || OPS[Object.keys(OPS).find((k) => op.includes(k))] || 'other';
const rows = JSON.parse(readFileSync(new URL('../data/station-spots.json', import.meta.url), 'utf8'));
const sources = new Map();
const perStation = new Map();
const spots = [];
let skipped = 0;
for (const r of rows) {
  // バスターミナルなど駅でない施設には「駅」を付けない
  const facility = /(ターミナル|バスセンター|空港)$/.test(r.station.replace(/駅$/, ''));
  const station = facility ? r.station.replace(/駅$/, '') : r.station.endsWith('駅') ? r.station : `${r.station}駅`;
  // 駅名の表記ゆれ：「西鉄福岡（天神）駅」→「西鉄福岡駅」「天神駅」、「近鉄丹波橋駅」→「丹波橋駅」の順に試す
  const inner = station.match(/[（(](.+?)[）)]/)?.[1];
  const names = [...new Set([station, station.replace(/[（(].+?[）)]/, ''), inner && `${inner}駅`, station.replace(/^(近鉄|西鉄|名鉄|京成|京急|京王|阪急|阪神|南海|東武|西武)/, '')].filter(Boolean))];
  let p = null;
  for (const n of names) { p = await landmark(n, r.city || '', r.pref || ''); if (p) break; }
  if (!p) { console.warn(`位置不明: ${r.operator} ${station}（${r.city}）`); skipped++; continue; }
  const slug = slugOf(r.operator);
  const src = sources.get(slug) || { id: `station-${slug}`, type: 'facility', group: 'area', label: '駅構内の喫煙所', name: `${r.operator} 駅の喫煙所`, publisher: r.operator, page: r.page, count: 0 };
  src.count++;
  sources.set(slug, src);
  // 同じ駅に複数あるとき、印が重ならないよう駅の周りに約20m ずつずらして置く
  const key = `${station}|${r.city}`;
  const k = perStation.get(key) || 0;
  perStation.set(key, k + 1);
  const ang = k * 2.4, rad = k ? 0.00018 * Math.sqrt(k) : 0;
  const gate = r.inside_gate === true ? '改札内' : r.inside_gate === false ? '改札外' : '';
  spots.push([+(p.lat + rad * Math.cos(ang)).toFixed(6), +(p.lng + rad * Math.sin(ang) * 1.2).toFixed(6), `station-${slug}-${src.count}`, Object.fromEntries(Object.entries({
    name: r.name || `${station} 喫煙所`,
    note: [[gate, r.where].filter(Boolean).join('・'), r.memo, '※地図の位置は駅の目安。構内の場所は上の説明を見てください'].filter(Boolean).join('\n'),
    hours: r.hours, heated: r.heated, io: 'indoor', gate: r.inside_gate === true ? 'in' : r.inside_gate === false ? 'out' : undefined, url: r.page,
  }).filter(([, v]) => v))]);
}
saveLandmarkCache();
writeFileSync(new URL('../../public/data/places/stations.json', import.meta.url), JSON.stringify({ updated: new Date().toISOString(), sources: [...sources.values()], spots }, null, 1));
console.log([...sources.values()].map((s) => `${s.publisher} ${s.count}`).join(' / '), `（位置不明 ${skipped}）`);
