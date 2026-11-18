// 画面の動作確認。`npm run dev` を起動した状態で `npm test` を実行する。
// Overpass は固定データに差し替える（外部サービスに負荷をかけず、結果を安定させるため）。
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8788/';
const ME = { latitude: 35.6812, longitude: 139.7671 }; // 東京駅

const overpass = {
  elements: [
    { type: 'node', id: 101, lat: 35.6816, lon: 139.7668, tags: { amenity: 'smoking_area', name: '丸の内北口 喫煙所', covered: 'yes' } },
    { type: 'node', id: 102, lat: 35.6795, lon: 139.7690, tags: { amenity: 'smoking_area' } },
    { type: 'way', id: 103, center: { lat: 35.6830, lon: 139.7650 }, tags: { amenity: 'smoking_area', 'smoking:heated_tobacco': 'only', name: '加熱式専用ブース' } },
    { type: 'node', id: 201, lat: 35.6808, lon: 139.7680, tags: { amenity: 'cafe', smoking: 'isolated', name: '喫茶テスト' } },
    { type: 'node', id: 202, lat: 35.6809, lon: 139.7681, tags: { amenity: 'cafe', smoking: 'no', name: '禁煙カフェ' } },
  ],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: ME, permissions: ['geolocation'], locale: 'ja-JP' });
let overpassCalls = 0;
await ctx.route(/overpass/, (r) => { overpassCalls++; return r.fulfill({ json: overpass }); });
await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const names = () => page.$$eval('#list .name', (els) => els.map((e) => e.firstChild.textContent.trim()));
const waitList = (n) => page.waitForFunction((n) => document.querySelectorAll('#list li').length === n, n, { timeout: 15000 });

await page.goto(BASE);
await waitList(3);
let list = await names();
console.log('初期表示:', list);
assert.equal(list[0], '丸の内北口 喫煙所', '現在地から最も近い喫煙所が先頭');
assert.ok(!list.includes('喫茶テスト'), '初期表示は喫煙所のみ');
assert.ok(!list.includes('禁煙カフェ'));
assert.match(await page.textContent('#summary'), /現在地から近い順/);

await page.click('label:has(#f-shop)');
await waitList(4);
assert.ok((await names()).includes('喫茶テスト'), '喫煙可の店を表示できる');

await page.click('label:has(#f-heated)');
await waitList(3);
assert.ok(!(await names()).includes('加熱式専用ブース'), '加熱式専用を隠せる');
await page.click('label:has(#f-heated)');
await page.click('label:has(#f-shop)');
await waitList(3);

// ポップアップと徒歩ルート
await page.click('#list li:first-child .item');
await page.waitForSelector('.pop');
const href = await page.getAttribute('.pop a.go', 'href');
assert.match(href, /google\.com\/maps\/dir\/.*travelmode=walking/);
assert.match(await page.textContent('.pop'), /屋根あり/);

// 閉鎖の報告
await page.click('.pop [data-report="closed"]');
await page.waitForFunction(() => /報告を受け付けました/.test(document.querySelector('#toast').textContent));
await page.waitForFunction(() => /閉鎖の報告 \d+件/.test(document.querySelector('#list').textContent), null, { timeout: 15000 });

// 投稿
await page.click('#btn-add');
await page.waitForSelector('#add-form:not([hidden])');
await page.fill('#add-name', 'E2E 投稿の喫煙所');
await page.fill('#add-note', 'テスト');
await page.click('#add-form button[type=submit]');
await page.waitForFunction(() => /投稿しました/.test(document.querySelector('#toast').textContent));
await page.waitForFunction(() => document.querySelector('#list').textContent.includes('E2E 投稿の喫煙所'));
await page.screenshot({ path: process.env.SHOT || 'tests/screenshot.png' });

// オフラインで再読み込みしても保存済みのデータで表示できる
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => page.reload());
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
const before = overpassCalls;
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('#list li').length >= 3, null, { timeout: 15000 });
assert.equal(await page.isVisible('#net'), true, 'オフライン表示');
assert.equal(overpassCalls, before, 'オフライン時は取得しない');
console.log('オフライン表示:', await names());
await ctx.setOffline(false);

assert.deepEqual(errors, [], `ページのエラー: ${errors.join(', ')}`);
await browser.close();
console.log('すべて成功');
