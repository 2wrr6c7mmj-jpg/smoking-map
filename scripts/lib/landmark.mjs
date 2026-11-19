// 目印（駅名・公園名など）→ 緯度経度。OpenStreetMap の地名検索（Nominatim）を使う。
// 利用方針に従い 1秒に1回まで・身元を名乗る・結果は scripts/cache/landmark.json に保存して再利用。
//
// 誤った場所に置かないための決まり（2026-11 に藤沢駅を茨城県に、浦和駅を武蔵浦和の近くに置く不具合があった）：
//  - 都道府県が分かっているときは、結果の所在地にその都道府県が含まれるものだけを採用する
//  - 名前が検索語と完全に一致するものを優先し、駅名で探すときは鉄道の駅を最優先にする
//  - 名前の一部が含まれるだけの結果は採用しない
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CACHE = new URL('../cache/landmark.json', import.meta.url);
const UA = 'kemuri-map-data/1.0 (+https://github.com/2wrr6c7mmj-jpg/smoking-map)';
const VER = 'v4'; // 照合の決まりを変えたら上げる（古い保存分を使わない）
const all = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const cache = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(`${VER}|`)));
let dirty = Object.keys(cache).length !== Object.keys(all).length;
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 所在地の都道府県の照合。地名検索は東京都を「東京」と書くので、末尾の都府県を外した形も一致とみなす。
// 「京都」が「東京都」に含まれる、といった取り違えを避けるため、カンマ区切りの要素ごとに完全一致で比べる
const prefOk = (displayName, pref) => {
  if (!pref) return true;
  const short = pref.replace(/[都府県]$/, '');
  return displayName.split(',').some((p) => { const t = p.trim(); return t === pref || t === short; });
};
const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[（(].*?[）)]/g, '').replace(/ヶ/g, 'ケ');

async function search(q) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&countrycodes=jp&accept-language=ja&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  return res.ok ? res.json() : [];
}

// ---- 駅の位置：国土数値情報の駅データ（scripts/data/stations-all.json、CC BY 4.0）から引く ----
// 地名検索は「藤沢駅」で駅そのものを返さない（同名の公園や「○○駅前通り」が返る）ので、駅には使わない。
const STATIONS = new URL('../data/stations-all.json', import.meta.url);
let byName = null;
function stationIndex() {
  if (!byName) {
    byName = new Map();
    for (const [n, lat, lng] of existsSync(STATIONS) ? JSON.parse(readFileSync(STATIONS, 'utf8')) : []) {
      const k = norm(n);
      (byName.get(k) || byName.set(k, []).get(k)).push({ lat, lng });
    }
  }
  return byName;
}
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));
const PREFIX = /^(JR|ＪＲ|近鉄|西鉄|名鉄|京成|京急|京王|阪急|阪神|南海|東武|西武|小田急|相鉄|東急|京阪|新京成|地下鉄|モノレール)/;

// 市区の中心（同名の駅や施設を区別するための基準点）
export async function cityCenter(city, pref = '') {
  const key = `${VER}|center|${pref}|${city}`;
  if (key in cache) return cache[key];
  const parts = city.match(/^(.+?市)(.+区)$/)?.slice(1) || [city];
  let hit = null;
  for (const q of [`${parts.join(' ')} ${pref}`.trim(), `${parts[0]} ${pref}`.trim()]) {
    let list = [];
    try { list = await search(q); } catch { continue; }
    const ok = list.find((x) => prefOk(x.display_name, pref) && (x.category === 'boundary' || x.category === 'place') && norm(x.name) === norm(parts[parts.length - 1]))
      || list.find((x) => prefOk(x.display_name, pref) && (x.category === 'boundary' || x.category === 'place') && norm(x.name) === norm(parts[0]));
    if (ok) { hit = { lat: Number(ok.lat), lng: Number(ok.lon) }; break; }
  }
  cache[key] = hit;
  dirty = true;
  return hit;
}

// 駅名 → 位置。同名の駅が複数あれば市区の中心にいちばん近い駅。市区の中心から MAX_KM より遠い駅は採用しない
const MAX_KM = 30;
export async function stationLatLng(name, city, pref = '') {
  const bare = name.replace(/駅$/, '').replace(/[（(].*?[）)]/g, '');
  const inner = name.match(/[（(](.+?)[）)]/)?.[1];
  const names = [...new Set([bare, bare.replace(PREFIX, ''), inner].filter(Boolean).map(norm))];
  const cands = names.flatMap((n) => stationIndex().get(n) || []);
  if (!cands.length) return null;
  const c = await cityCenter(city, pref);
  if (!c) return null;
  const best = cands.map((s) => ({ s, d: km(s, c) })).sort((a, b) => a.d - b.d)[0];
  return best.d <= MAX_KM ? { lat: best.s.lat, lng: best.s.lng, title: `${bare}駅`, kind: 'station' } : null;
}

// city は「町田市」「港区」「大阪市天王寺区」など。pref は「東京都」など（分かるときは必ず渡す）
export async function landmark(name, city, pref = '') {
  const key = `${VER}|${pref}|${city}|${name}`;
  if (key in cache) return cache[key];
  if (/駅$/.test(name)) {
    const st = await stationLatLng(name, city, pref);
    if (st) { cache[key] = st; dirty = true; return st; }
  }
  // 「大阪市天王寺区」は、所在地では「天王寺区, 大阪市」と別々に出るので分けて照合する
  const parts = city.match(/^(.+?市)(.+区)$/)?.slice(1) || (city ? [city] : []);
  const isStation = /駅$/.test(name);
  const want = norm(name);
  const wantBare = norm(name.replace(/駅$/, ''));
  let hit = null;
  for (const q of [...new Set([`${name} ${parts.join(' ')}`.trim(), `${name} ${parts[0] || ''}`.trim(), `${name} ${pref}`.trim()])]) {
    let list = [];
    try { list = await search(q); } catch { continue; }
    const scored = list
      .filter((x) => prefOk(x.display_name, pref))
      .map((x) => {
        const n = norm(x.name);
        const exact = n === want || (isStation && n === wantBare);
        if (!exact) return null; // 名前の一部が合うだけのものは使わない
        const rail = x.category === 'railway' || x.type === 'station';
        const inCity = parts.length ? parts.every((p) => x.display_name.includes(p)) : true;
        const inMainCity = parts.length ? x.display_name.includes(parts[0]) : true;
        // 駅は市の境にあることがあるので、市が合わなくても都道府県が合う「駅」は採用する（順位は下げる）
        if (!inMainCity && !(isStation && rail && pref)) return null;
        return { x, score: (isStation && rail ? 4 : 0) + (inCity ? 2 : 0) + (inMainCity ? 1 : 0) };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    if (scored.length) {
      const { x } = scored[0];
      const p = { lat: Number(x.lat), lng: Number(x.lon) };
      const c = city ? await cityCenter(city, pref) : null;
      if (c && km(p, c) > MAX_KM) continue; // 市区から離れすぎた結果は別の場所とみなす
      hit = { ...p, title: x.display_name.split(',').slice(0, 4).join(','), kind: `${x.category}/${x.type}` };
      break;
    }
  }
  cache[key] = hit;
  dirty = true;
  return hit;
}

export function saveLandmarkCache() {
  if (dirty) writeFileSync(CACHE, JSON.stringify(cache));
  dirty = false;
}
