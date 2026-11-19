// 主要駅のうち、近くに喫煙所のデータが1件もない駅を洗い出す（調査の取りこぼし確認用）。
//   node scripts/station-gaps.mjs [国土数値情報 S12 の geojson]   … 駅一覧（scripts/data/stations.json）を作り直す場合だけ引数を渡す
//   出力：scripts/data/station-gaps.json（乗降客数の多い順）
// 駅データ：国土交通省 国土数値情報「駅別乗降客数データ」（CC BY 4.0）を加工して作成
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const DATA = new URL('./data/', import.meta.url);
const PUB = new URL('../public/data/', import.meta.url);
const NEAR_M = 300;       // 駅からこの距離以内を「駅・駅前」とみなす
const MIN_RIDERS = Number(process.env.MIN_RIDERS || 20000); // 1日の乗降客数（全路線の合計）

if (process.argv[2]) {
  const fc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const groups = new Map(); // 同じ駅（乗換駅のまとまり）ごとに合計
  for (const f of fc.features) {
    const p = f.properties;
    const pts = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat();
    const lng = pts.reduce((a, c) => a + c[0], 0) / pts.length;
    const lat = pts.reduce((a, c) => a + c[1], 0) / pts.length;
    const g = groups.get(p.S12_001g) || { name: p.S12_001, lat: 0, lng: 0, n: 0, riders: 0, ops: new Set() };
    g.lat += lat; g.lng += lng; g.n++;
    g.riders += Number(p.S12_053) || Number(p.S12_049) || 0; // 最新年、なければ前年
    g.ops.add(p.S12_002);
    groups.set(p.S12_001g, g);
  }
  const stations = [...groups.values()].filter((g) => g.riders >= 3000)
    .map((g) => ({ name: g.name, lat: +(g.lat / g.n).toFixed(5), lng: +(g.lng / g.n).toFixed(5), riders: g.riders, ops: [...g.ops] }))
    .sort((a, b) => b.riders - a.riders);
  writeFileSync(new URL('stations.json', DATA), JSON.stringify(stations));
  // 目印の位置出し用：乗降客数を問わない全駅（駅名・位置だけ）
  const allStations = [...groups.values()].map((g) => [g.name, +(g.lat / g.n).toFixed(5), +(g.lng / g.n).toFixed(5)]);
  writeFileSync(new URL('stations-all.json', DATA), JSON.stringify(allStations));
  console.log(`駅 ${stations.length}（1日3,000人以上）／全駅 ${allStations.length}`);
}

const stations = JSON.parse(readFileSync(new URL('stations.json', DATA), 'utf8'));
// 全データの地点（喫煙所か、店か）
const spots = [];
const jp = new URL('jp/', PUB);
for (const f of readdirSync(jp)) {
  if (!/^\d+_\d+\.json$/.test(f)) continue;
  for (const [lat, lng, , t] of JSON.parse(readFileSync(new URL(f, jp), 'utf8'))) {
    spots.push({ lat, lng, area: t.amenity === 'smoking_area' || /cigarettes/.test(t.waste || '') });
  }
}
const places = new URL('places/', PUB);
for (const f of readdirSync(places)) {
  if (f === 'index.json') continue;
  const j = JSON.parse(readFileSync(new URL(f, places), 'utf8'));
  const group = Object.fromEntries(j.sources.map((s) => [s.id, s.group]));
  for (const [lat, lng, id] of j.spots) {
    const src = Object.keys(group).sort((a, b) => b.length - a.length).find((k) => id.startsWith(`${k}-`));
    spots.push({ lat, lng, area: (group[src] || 'area') === 'area' });
  }
}
// 0.01度の格子に入れて近傍だけ調べる
const grid = new Map();
for (const s of spots) {
  const k = `${Math.floor(s.lat * 100)}:${Math.floor(s.lng * 100)}`;
  (grid.get(k) || grid.set(k, []).get(k)).push(s);
}
const dist = (a, b) => {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371e3;
};
// 1駅ずつ調べた結果（scripts/import-station-checks.py で作る）。駅名と位置（約300m以内）で対応させる
const checkedFile = new URL('station-checked.json', DATA);
// station-checked-auto.json：駅ごとには調べず、所在市区の調査結果から決めたもの（scripts/station-cities.mjs の結果を使う）
const autoFile = new URL('station-checked-auto.json', DATA);
const checked = [
  ...(existsSync(checkedFile) ? JSON.parse(readFileSync(checkedFile, 'utf8')) : []),
  ...(existsSync(autoFile) ? JSON.parse(readFileSync(autoFile, 'utf8')) : []),
];
const checkOf = (st) => checked.find((c) => c.name === st.name && Math.abs(c.lat - st.lat) < 0.004 && Math.abs(c.lng - st.lng) < 0.004);
const major = stations.filter((s) => s.riders >= MIN_RIDERS);
const gaps = [];
let withArea = 0, withAny = 0;
for (const st of major) {
  let area = 0, shop = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    for (const s of grid.get(`${Math.floor(st.lat * 100) + i}:${Math.floor(st.lng * 100) + j}`) || []) {
      if (dist(st, s) <= NEAR_M) s.area ? area++ : shop++;
    }
  }
  if (area) withArea++;
  if (area || shop) withAny++;
  if (!area) {
    const c = checkOf(st);
    gaps.push({ ...st, shops_nearby: shop, checked: c ? c.status : '', evidence: c ? c.evidence : '', city: c?.city || '', note: c?.note || '' });
  }
}
// 喫煙所データのない駅を、調査の状況で分ける
const NONE = ['city_none', 'none_in_list', 'none'];
const confirmed = gaps.filter((g) => NONE.includes(g.checked) && g.evidence === 'strong');
const weak = gaps.filter((g) => NONE.includes(g.checked) && g.evidence === 'weak');
const byList = gaps.filter((g) => NONE.includes(g.checked) && g.evidence === 'list');
const nearby = gaps.filter((g) => g.checked === 'nearby');
const blocked = gaps.filter((g) => g.checked === 'blocked');
const unchecked = gaps.filter((g) => !NONE.includes(g.checked) && g.checked !== 'nearby' && g.checked !== 'blocked');
writeFileSync(new URL('station-gaps.json', DATA), JSON.stringify(gaps, null, 0).replace(/\},\{/g, '},\n{'));
console.log(`1日${MIN_RIDERS.toLocaleString()}人以上の駅 ${major.length}：${NEAR_M}m以内に喫煙所あり ${withArea}（${Math.round(withArea / major.length * 100)}%）、店も含めると ${withAny}、喫煙所なし ${gaps.length}`);
console.log(`  喫煙所なしの内訳：調べて「なし」と確認 ${confirmed.length} / 市区の一覧に載っていない（駅ごとの確認なし） ${byList.length} / 「なし」だが根拠が弱く要再確認 ${weak.length} / 300〜500mに喫煙所あり ${nearby.length} / 公式サイトに拒否され未確認 ${blocked.length} / 未調査 ${unchecked.length}`);
console.log('未調査の駅（乗降客数の多い順）:', unchecked.slice(0, 40).map((g) => `${g.name}(${Math.round(g.riders / 10000)}万)`).join(' '));
