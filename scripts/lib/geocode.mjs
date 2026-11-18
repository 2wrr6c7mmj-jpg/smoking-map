// 住所 → 緯度経度（国土地理院の住所検索 API）。結果は scripts/cache/geocode.json に保存して使い回す。
// 番地まで一致しないもの（町名止まりなど）は精度が低いので、呼び出し側で扱いを決められるよう level を返す。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CACHE = new URL('../cache/geocode.json', import.meta.url);
const API = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=';
let cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let dirty = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 全角数字・ハイフンのゆれをそろえる
export function normalizeAddress(s) {
  return String(s)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－―‐−ー‑](?=\d)/g, '-')
    .replace(/\s+/g, '')
    .replace(/(\d)番地?(\d)/g, '$1-$2')
    .replace(/(\d)号/g, '$1')
    .replace(/[（(].*?[）)]/g, '');
}

// 漢数字（〜九十九）を算用数字に
function kanjiNum(s) {
  const d = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  return s.replace(/([一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])(?=丁目|番|号|条|線)/g, (m) => {
    if (!m.includes('十')) return String(d[m]);
    const [a, b] = m.split('十');
    return String((a ? d[a] : 1) * 10 + (b ? d[b] : 0));
  });
}
const digits = (s) => normalizeAddress(kanjiNum(s)).match(/\d+/g) || [];

export async function geocode(address) {
  const q = normalizeAddress(address);
  if (q in cache) return cache[q];
  let hit = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API + encodeURIComponent(q), { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(String(res.status));
      const list = await res.json();
      if (list.length) {
        const [lng, lat] = list[0].geometry.coordinates;
        const title = list[0].properties.title;
        // 返ってきた住所が、問い合わせの番地の数字まで含んでいれば「番地」精度
        const want = digits(q);
        const got = digits(title);
        const level = want.length && want.every((n, i) => got[i] === n) ? 'banchi' : 'town';
        hit = { lat, lng, title, level };
      }
      break;
    } catch {
      await sleep(2000 * (attempt + 1));
    }
  }
  cache[q] = hit;
  dirty = true;
  await sleep(300); // 公共サービスなので間隔をあける
  return hit;
}

export function saveGeocodeCache() {
  if (dirty) writeFileSync(CACHE, JSON.stringify(cache, null, 0));
  dirty = false;
}
