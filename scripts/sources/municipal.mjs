// 市区の公式ページに載っている公衆喫煙所（名称と住所の事実だけを scripts/data/municipal-spots.json に記録したもの）を
// 緯度経度にして public/data/places/cities.json に書き出す。
// オープンデータ（CC BY）として出している自治体は fetch-opendata.mjs（gov.json）で扱い、こちらは一覧ページだけの自治体。
//   node scripts/sources/municipal.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { geocode, saveGeocodeCache } from '../lib/geocode.mjs';
import { cleanAddress } from '../lib/places.mjs';
import { landmark, cityCenter, saveLandmarkCache } from '../lib/landmark.mjs';
import { get } from '../lib/fetch.mjs';

const SLUG = {
  川崎市: 'kawasaki', 神戸市: 'kobe', 広島市: 'hiroshima', 浜松市: 'hamamatsu', 千葉市: 'chiba', 熊本市: 'kumamoto',
  尼崎市: 'amagasaki', 明石市: 'akashi', 長崎市: 'nagasaki',
  港区: 'minato', 中央区: 'chuo', 千代田区: 'chiyoda', 渋谷区: 'shibuya', 世田谷区: 'setagaya', 目黒区: 'meguro', 足立区: 'adachi',
  品川区: 'shinagawa', 墨田区: 'sumida', 大田区: 'ota', 荒川区: 'arakawa', 豊島区: 'toshima', 新宿区: 'shinjuku', 中野区: 'nakano',
  文京区: 'bunkyo', 板橋区: 'itabashi', 武蔵野市: 'musashino', 府中市: 'fuchu', 三鷹市: 'mitaka', 船橋市: 'funabashi',
};
// SLUG にない市区には、scripts/data/city-ids.json で英字の ID を割り当てる（一度決めた ID は変えない）
const IDS_FILE = new URL('../data/city-ids.json', import.meta.url);
const ids = existsSync(IDS_FILE) ? JSON.parse(readFileSync(IDS_FILE, 'utf8')) : {};
function slugOf(city) {
  if (SLUG[city]) return SLUG[city];
  if (!ids[city]) {
    let n = Object.keys(ids).length, out = '';
    do { out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
    ids[city] = `x${out}`;
  }
  return ids[city];
}

const rows = JSON.parse(readFileSync(new URL('../data/municipal-spots.json', import.meta.url), 'utf8'));

// Google マイマップが情報源の市区：公開の KML 書き出しから点（Point）だけを読む
const expanded = [];
const listed = new Set(rows.filter((r) => !r.mymap_mid).map((r) => r.city));
for (const r of rows) {
  if (!r.mymap_mid) { expanded.push(r); continue; }
  // 一覧ページからも拾えている市区（目黒・世田谷など）は、利用時間などが分かる一覧側だけを使う。横浜は一覧が新設分だけなので両方使う
  if (listed.has(r.city) && r.city !== '横浜市') { console.log(`マイマップ ${r.city}: 一覧側を使うため読まない`); continue; }
  let kml = null;
  try { kml = await get(`https://www.google.com/maps/d/kml?forcekml=1&mid=${encodeURIComponent(r.mymap_mid)}`, { accept: 'application/xml' }); } catch (e) { console.warn(`マイマップ取得失敗: ${r.city} ${e.message}`); }
  let n = 0;
  for (const pm of (kml || '').split('<Placemark>').slice(1)) {
    const c = pm.match(/<Point>[\s\S]*?<coordinates>\s*([-0-9.]+),([-0-9.]+)/);
    if (!c) continue;
    const name = (pm.match(/<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>/) || [])[1]?.trim() || '';
    if (/禁止|パトロール|看板/.test(name)) continue;
    // 「【鶴見区】店名」の形は、市が案内している協力店（店内の喫煙所。その店の利用者向け）
    const partner = /^【.+?】/.test(name);
    expanded.push({ city: r.city, pref: r.pref, name: name.replace(/^【.+?】/, '') || `${r.city}の喫煙所`, lat: Number(c[2]), lng: Number(c[1]), page: r.page, kind: partner ? 'indoor' : '', customers_only: partner });
    n++;
  }
  console.log(`マイマップ ${r.city}: ${n}点`);
}

const byCity = new Map();
const spots = [];
let skipped = 0;
for (const r of expanded) {
  const slug = slugOf(r.city);
  let lat = Number(r.lat), lng = Number(r.lng), approxNote = '';
  let hasCoord = !!r.lat && !!r.lng && Number.isFinite(lat) && Number.isFinite(lng);
  if (hasCoord) {
    // ページから読んだ座標でも、その市区から大きく外れていたら読み取りの誤りとみなして使わない
    const c = await cityCenter(r.city, r.pref || '');
    if (c && Math.hypot((lat - c.lat) * 111, (lng - c.lng) * 91) > 30) { console.warn(`座標が市区の外: ${r.city} ${r.name}（${lat}, ${lng}）`); hasCoord = false; }
  }
  if (!hasCoord) {
    const addr = r.address && r.address.replace(/^(?!.*[都道府県])/, r.pref || '');
    // 都道府県・市区だけの住所（番地も町名もない）は位置の手がかりにならないので目印に回す
    const usable = addr && addr.replace(/^.*?[都道府県]/, '').replace(r.city, '').trim().length >= 2;
    let g = usable && ((await geocode(cleanAddress(addr))) || (await geocode(addr)));
    // 住所検索が返した住所が、その市区のものでなければ使わない（同じ町名が別の市にある場合）
    const cityParts = r.city.match(/^(.+?市)(.+区)$/)?.slice(1) || [r.city];
    if (g && !cityParts.every((p) => g.title.includes(p))) { console.warn(`住所検索の結果が別の市区: ${r.city} ${r.name} → ${g.title}`); g = null; }
    if (g) {
      ({ lat, lng } = g);
      // 住所の番地・街区まで一致しなければ、喫煙所の位置としては粗いので注記する
      if (g.level === 'town' || r.address_level === 'town' || !/\d/.test(addr)) approxNote = '※地図の位置は住所の町名までの目安';
    } else {
      let lmName = r.landmark;
      let lm = lmName && (await landmark(lmName, r.city, r.pref || ''));
      if (!lm) {
        // 目印が施設名などで見つからないときは、名称・目印・メモに含まれる駅名で探す
        const st = `${r.name} ${r.landmark || ''} ${r.memo || ''}`.match(/([^\s　・、（(「」]+?駅)/)?.[1];
        if (st) { lm = await landmark(st, r.city, r.pref || ''); lmName = st; }
      }
      if (!lm) { console.warn(`位置不明: ${r.city} ${r.name}（${r.address || r.landmark || '手がかりなし'}）`); skipped++; continue; }
      ({ lat, lng } = lm);
      approxNote = `※地図の位置は「${lmName}」の目安`;
    }
  }
  const c = byCity.get(r.city) || { id: `city-${slug}`, type: 'gov', group: 'area', city: r.city, publisher: r.city, license: '市の公開ページ', page: r.page, count: 0 };
  c.count++;
  byCity.set(r.city, c);
  spots.push([+lat.toFixed(6), +lng.toFixed(6), `city-${slug}-${c.count}`, Object.fromEntries(Object.entries({
    name: r.name, address: r.address, hours: r.hours, io: r.kind, heated: r.heated,
    group: r.customers_only ? 'shop' : undefined, // 市が案内している店舗内の喫煙所（その店の利用者向け）
    note: [r.memo, approxNote].filter(Boolean).join('\n'),
    url: r.page,
  }).filter(([, v]) => v))]);
}
saveGeocodeCache();
saveLandmarkCache();
writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1));
writeFileSync(new URL('../../public/data/places/cities.json', import.meta.url), JSON.stringify({ updated: new Date().toISOString(), sources: [...byCity.values()], spots }, null, 1));
console.log([...byCity.values()].map((c) => `${c.city} ${c.count}`).join(' / '), `（位置不明・除外 ${skipped}）`);
