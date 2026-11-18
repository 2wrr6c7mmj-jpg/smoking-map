// カラオケまねきねこ：公式の店舗検索で「喫煙ブースあり」に絞った結果。
// 一覧は「もっとみる」で5件ずつ増える作りなので、ブラウザで開いてボタンを1秒間隔で押して読む。
// 位置は各店舗ページに載っている緯度経度（1秒間隔で取得、結果は scripts/cache/manekineko.json に保存して再利用）。
//   node scripts/sources/manekineko.mjs → public/data/places/manekineko.json
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { get } from '../lib/fetch.mjs';
import { writePlaces } from '../lib/places.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIST = 'https://www.karaokemanekineko.jp/locations/?service_tag[]=smoking_booth';
const UA = 'kemuri-map-data/1.0 (+https://github.com/2wrr6c7mmj-jpg/smoking-map)';
const CACHE = new URL('../cache/manekineko.json', import.meta.url);
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

const browser = await chromium.launch();
const page = await (await browser.newContext({ userAgent: UA, locale: 'ja-JP' })).newPage();
await page.goto(LIST, { waitUntil: 'domcontentloaded', timeout: 60000 });
const total = Number((await page.textContent('#heading')).match(/(\d+)件/)?.[1] || 0);
for (let i = 0; i < 200; i++) {
  const n = await page.locator('.js-store').count();
  const more = page.locator('#js-show-more');
  if (n >= total || !(await more.isVisible().catch(() => false))) break;
  await more.click();
  await page.waitForFunction((prev) => document.querySelectorAll('.js-store').length > prev, n, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  if (i % 10 === 9) console.log(`  ${await page.locator('.js-store').count()} / ${total}`);
}
const stores = await page.$$eval('.js-store', (els) => els.map((el) => ({
  brand: el.querySelector('.content__unit-ttl__store')?.textContent.trim() || '',
  branch: el.querySelector('.content__unit-ttl__branch')?.textContent.trim() || '',
  address: el.querySelector('.content__unit-address')?.textContent.replace(/\s+/g, '').trim() || '',
  hours: el.querySelector('.content__unit-openTime')?.textContent.trim() || '',
  url: el.querySelector('.content__unit-detailBtn')?.href || '',
  booth: !!el.querySelector('.smoking_booth'),
})));
await browser.close();
console.log(`一覧 ${stores.length}件（検索結果の表示 ${total}件）`);

const spots = [];
for (const s of stores) {
  if (!s.booth || !s.url) continue;
  if (!cache[s.url]) {
    const h = await get(s.url).catch(() => null);
    const lat = Number(h?.match(/"latitude"\s*:\s*"?([0-9.]+)/)?.[1]);
    const lng = Number(h?.match(/"longitude"\s*:\s*"?([0-9.]+)/)?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) { cache[s.url] = { lat, lng }; writeFileSync(CACHE, JSON.stringify(cache)); }
  }
  const p = cache[s.url];
  if (!p) { console.warn(`位置不明: ${s.branch}`); continue; }
  const slug = s.url.replace(/\/$/, '').split('/').slice(-3).join('-');
  spots.push([p.lat, p.lng, `manekineko-${slug}`, {
    name: `${s.brand} ${s.branch}`.trim(),
    note: '喫煙ブースあり（店内・利用者向け）',
    address: s.address,
    hours: s.hours === '24時間営業' ? '24時間' : undefined,
    url: s.url,
  }]);
}
writePlaces('manekineko', { id: 'manekineko', type: 'chain', group: 'shop', label: 'カラオケ（喫煙ブースあり）', name: 'カラオケまねきねこ 店舗検索', publisher: 'コシダカ', page: 'https://www.karaokemanekineko.jp/locations/' }, spots);
