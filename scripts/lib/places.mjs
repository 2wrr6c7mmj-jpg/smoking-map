// public/data/places/{id}.json を書き出す共通処理
import { writeFileSync } from 'node:fs';

export function writePlaces(file, source, spots) {
  const ok = spots.filter((s) => Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[0] > 20 && s[0] < 46 && s[1] > 122 && s[1] < 154);
  writeFileSync(new URL(`../../public/data/places/${file}.json`, import.meta.url), JSON.stringify({
    updated: new Date().toISOString(),
    sources: [{ ...source, count: ok.length }],
    spots: ok.map(([lat, lng, id, t]) => [+lat.toFixed(6), +lng.toFixed(6), id, Object.fromEntries(Object.entries(t).filter(([, v]) => v != null && v !== ''))]),
  }, null, 1));
  console.log(`${file}: ${ok.length}件を書き出し（位置不明 ${spots.length - ok.length}）`);
}

// 店舗の住所から緯度経度。番地まで一致しなかったものも町名の位置で使う（詳細に注記）
// 住所の後ろのビル名・階を落とす（「西新宿1-16-4 井門ビルB1F」→「西新宿1-16-4」）
export function cleanAddress(a) {
  let s = String(a).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[－‐−―ー](?=\d)/g, '-');
  s = s.replace(/(\d+)丁目(\d)/g, '$1-$2').replace(/(\d+)番地?(\d)/g, '$1-$2').replace(/(\d)号/g, '$1');
  const m = s.match(/^(.*?[^\d-]\d+(?:-\d+){0,3})(?![\d-]|条|丁目|線)/);
  return m ? m[1] : s.split(/\s/)[0];
}

export async function locate(geocode, address) {
  const g = (await geocode(cleanAddress(address))) || (await geocode(address));
  return g ? { lat: g.lat, lng: g.lng, approx: g.level === 'town' } : null;
}
