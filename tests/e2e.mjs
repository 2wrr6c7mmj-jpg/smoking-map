// 画面の動作確認。`npm run dev` を起動した状態で `npm test` を実行する。
// Overpass は固定データに差し替える（外部サービスに負荷をかけず、結果を安定させるため）。
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:8788/';
const SHOTS = process.env.SHOTS || 'tests';
const ME = { latitude: 35.6812, longitude: 139.7671 }; // 東京駅

const overpass = {
  elements: [
    { type: 'node', id: 101, lat: 35.6816, lon: 139.7668, tags: { amenity: 'smoking_area', name: '丸の内北口 喫煙所', covered: 'yes', opening_hours: '24/7' } },
    { type: 'node', id: 102, lat: 35.6795, lon: 139.7690, tags: { amenity: 'smoking_area' } },
    { type: 'way', id: 103, center: { lat: 35.6830, lon: 139.7650 }, tags: { amenity: 'smoking_area', 'smoking:heated_tobacco': 'only', name: '加熱式専用ブース', indoor: 'yes' } },
    { type: 'node', id: 104, lat: 35.6790, lon: 139.7640, tags: { amenity: 'smoking_area', name: '八重洲地下 喫煙室', indoor: 'yes', operator: '八重洲地下街' } },
    { type: 'node', id: 201, lat: 35.6808, lon: 139.7680, tags: { amenity: 'cafe', smoking: 'isolated', name: '喫茶テスト' } },
    { type: 'node', id: 202, lat: 35.6809, lon: 139.7681, tags: { amenity: 'cafe', smoking: 'no', name: '禁煙カフェ' } },
  ],
};

const browser = await chromium.launch();
const errors = [];

async function session(colorScheme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: ME, permissions: ['geolocation'], locale: 'ja-JP', colorScheme });
  ctx.calls = 0;
  await ctx.route(/overpass/, (r) => { ctx.calls++; return r.fulfill({ json: overpass }); });
  if (!process.env.REAL_TILES) await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}

const { ctx, page } = await session('dark');
const heroName = () => page.textContent('#hero h2');
const listNames = () => page.$$eval('#list .name', (els) => els.map((e) => e.firstChild.textContent.trim()));
const count = (id) => page.textContent(id).then(Number);

await page.goto(BASE);
await page.waitForFunction(() => !document.querySelector('#hero').hidden && document.querySelector('#c-area').textContent !== '0', null, { timeout: 15000 });
assert.equal(await heroName(), '丸の内北口 喫煙所', '現在地から最も近い喫煙所が大きく出る');
assert.match(await page.textContent('#hero'), /いちばん近い/);
assert.equal(await count('#c-area'), 4);
assert.equal(await count('#c-shop'), 1, '禁煙の店は数えない');
await page.click('#more');
let names = await listNames();
assert.equal(names.length, 3, '初期表示は喫煙所のみ');
assert.ok(!names.includes('喫茶テスト'));
if (process.env.REAL_TILES) await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/list-dark.png` });

await page.click('label:has(#f-shop)');
await page.waitForFunction(() => document.querySelectorAll('#list li').length === 4);
assert.ok((await listNames()).includes('喫茶テスト'), '喫煙可の店を表示できる');
await page.click('label:has(#f-heated)');
await page.waitForFunction(() => document.querySelectorAll('#list li').length === 3);
assert.ok(!(await listNames()).includes('加熱式専用ブース'), '加熱式専用を隠せる');
await page.click('label:has(#f-heated)');
await page.click('label:has(#f-shop)');

// 詳細と徒歩ルート
await page.click('#hero [data-open]');
await page.waitForSelector('#view-detail:not([hidden])');
assert.match(await page.getAttribute('#detail a.btn-ember', 'href'), /google\.com\/maps\/dir\/.*travelmode=walking/);
assert.match(await page.textContent('#detail .tags'), /屋根あり/);
assert.match(await page.textContent('#detail .tags'), /24時間/);
await page.screenshot({ path: `${SHOTS}/detail-dark.png` });

// 閉鎖の報告：報告のある地点は後ろへ回る
await page.click('#detail [data-report="closed"]');
await page.waitForFunction(() => /閉鎖の報告 \d+件/.test(document.querySelector('#detail').textContent), null, { timeout: 15000 });
await page.click('#detail-back');
assert.notEqual(await heroName(), '丸の内北口 喫煙所', '閉鎖報告のある地点はいちばん近い扱いにしない');

// 投稿
await page.click('#btn-add');
await page.waitForSelector('#add-form:not([hidden])');
await page.fill('#add-name', 'E2E 投稿の喫煙所');
await page.fill('#add-note', '改札を出て右、屋根あり');
await page.screenshot({ path: `${SHOTS}/add-dark.png` });
await page.click('#add-form button[type=submit]');
await page.waitForFunction(() => /投稿しました/.test(document.querySelector('#toast').textContent));
await page.waitForFunction(() => document.querySelector('#detail').textContent.includes('E2E 投稿の喫煙所'));
assert.match(await page.textContent('#detail'), /みんなの投稿/);

// オフラインで再読み込みしても保存済みのデータで表示できる
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => page.reload());
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
const before = ctx.calls;
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => !document.querySelector('#hero').hidden, null, { timeout: 15000 });
assert.equal(await page.isVisible('#net'), true, 'オフライン表示');
assert.equal(ctx.calls, before, 'オフライン時は取得しない');
await ctx.setOffline(false);

// 明るい配色
const light = await session('light');
await light.page.goto(BASE);
await light.page.waitForFunction(() => !document.querySelector('#hero').hidden, null, { timeout: 15000 });
await light.page.click('#more');
if (process.env.REAL_TILES) await light.page.waitForTimeout(2500);
await light.page.screenshot({ path: `${SHOTS}/list-light.png` });

// 横長の画面
await light.page.setViewportSize({ width: 1280, height: 800 });
await light.page.waitForTimeout(process.env.REAL_TILES ? 2500 : 300);
await light.page.screenshot({ path: `${SHOTS}/wide-light.png` });

assert.deepEqual(errors, [], `ページのエラー: ${errors.join(', ')}`);
await browser.close();
console.log('すべて成功');
