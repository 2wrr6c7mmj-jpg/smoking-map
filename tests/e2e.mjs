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
    { type: 'node', id: 204, lat: 35.6818, lon: 139.7682, tags: { shop: 'tobacco', name: 'たばこ店テスト' } },
    { type: 'node', id: 205, lat: 35.6800, lon: 139.7662, tags: { name: '駅前喫煙所テスト' } },
    { type: 'node', id: 203, lat: 35.6825, lon: 139.7690, tags: { shop: 'convenience', smoking: 'outside', name: 'コンビニテスト' } },
  ],
};

// 自治体データ：OSM の node 102（名前なし）と同じ場所に台東区の喫煙所を置き、重複が1つにまとまるか確かめる
const gov = {
  updated: '2026-11-18T00:00:00Z',
  sources: [{ id: 'taito', type: 'gov', group: 'area', publisher: '台東区', city: '台東区', license: 'CC BY 4.0', page: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131067d0000000110', count: 1 }],
  spots: [[35.67952, 139.76902, 'taito-1', { name: '区設置 公衆喫煙所テスト', hours: '24時間', address: '台東区テスト1-1' }]],
};

// 施設の公開情報：東京駅から少し離れた所に商業施設の喫煙室を1件置く
const mitsui = {
  updated: '2026-11-18T00:00:00Z',
  sources: [{ id: 'mitsui', type: 'facility', group: 'area', label: '商業施設の喫煙室', publisher: '三井不動産商業マネジメント', page: 'https://mitsui-shopping-park.com/' }],
  spots: [[35.6830, 139.7700, 'mitsui-lalaport-test', { name: 'ららぽーとテスト 喫煙室', note: '1F：Cエレベーター奥', url: 'https://mitsui-shopping-park.com/lalaport/test/service/smoking.html' }]],
};

const browser = await chromium.launch();
const errors = [];

async function session(colorScheme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: { ...ME, accuracy: 15 }, permissions: ['geolocation'], locale: 'ja-JP', colorScheme });
  ctx.calls = 0;
  await ctx.route(/overpass/, (r) => { ctx.calls++; return r.fulfill({ json: overpass }); });
  await ctx.route(/\/data\/places\/index\.json/, (r) => r.fulfill({ json: { files: ['gov.json', 'mitsui.json'] } }));
  await ctx.route(/\/data\/places\/gov\.json/, (r) => r.fulfill({ json: gov }));
  await ctx.route(/\/data\/places\/mitsui\.json/, (r) => r.fulfill({ json: mitsui }));
  // 全国データは固定データから作る（STATIC=0 のときは全国データなしの動作を確かめる）
  await ctx.route(/\/data\/jp\//, (r) => {
    if (process.env.STATIC === '0') return r.fulfill({ status: 404, body: 'not found' });
    if (r.request().url().endsWith('index.json')) return r.fulfill({ json: { updated: '2026-11-18T00:00:00Z', total: overpass.elements.length, cells: { '35_139': overpass.elements.length } } });
    return r.fulfill({ json: overpass.elements.map((e) => [e.lat ?? e.center.lat, e.lon ?? e.center.lon, `${e.type[0]}${e.id}`, e.tags]) });
  });
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
assert.equal(await count('#c-tobacco'), 1, 'たばこ店は別に数える');
assert.equal(await count('#c-area'), 6, 'OSM と自治体の重複は1つに数え、施設の喫煙室を足す');
assert.equal(await count('#c-shop'), 2, '禁煙の店は数えない');
await page.click('#more');
let names = await listNames();
assert.equal(names.length, 5, '初期表示は喫煙所のみ');
assert.ok(names.includes('駅前喫煙所テスト'), '名前が喫煙所を指す地点を拾う');
assert.ok(!names.includes('たばこ店テスト'), 'たばこ店は初期表示しない');
assert.ok(names.includes('ららぽーとテスト 喫煙室'), '施設の喫煙室を表示する');
assert.ok(names.includes('区設置 公衆喫煙所テスト'), '自治体データを表示する');
assert.ok(!names.includes('南東の喫煙所'), '自治体と重なる OSM の地点は隠す');
assert.ok(!names.includes('喫茶テスト'));
if (process.env.REAL_TILES) await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/list-dark.png` });

await page.click('label:has(#f-shop)');
await page.waitForFunction(() => document.querySelectorAll('#list li').length === 7);
assert.ok((await listNames()).includes('喫茶テスト'), '喫煙可の店を表示できる');
assert.match(await page.textContent('#list'), /店の外で喫煙可（灰皿） · コンビニ/, 'コンビニの店外灰皿');
await page.click('label:has(#f-heated)');
await page.waitForFunction(() => document.querySelectorAll('#list li').length === 6);
assert.ok(!(await listNames()).includes('加熱式専用ブース'), '加熱式専用を隠せる');
await page.click('label:has(#f-heated)');
await page.click('label:has(#f-shop)');

// たばこ店は別の絞り込みで出し、灰皿が確実ではないことを表示する
await page.click('label:has(#f-tobacco)');
await page.waitForFunction(() => document.querySelector('#list').textContent.includes('たばこ店テスト'));
assert.match(await page.textContent('#list'), /店頭に灰皿がある場合があります/);
await page.click('label:has(#f-tobacco)');

// 詳細と徒歩ルート
await page.click('#hero [data-open]');
await page.waitForSelector('#view-detail:not([hidden])');
assert.match(await page.getAttribute('#detail a.btn-ember', 'href'), /google\.com\/maps\/dir\/.*travelmode=walking/);
assert.match(await page.textContent('#detail .tags'), /屋根あり/);
assert.match(await page.textContent('#detail .tags'), /24時間/);
await page.screenshot({ path: `${SHOTS}/detail-dark.png` });

// 施設の喫煙室の詳細には場所と出典を出す
await page.click('#detail-back');
await page.click('#list .item:has-text("ららぽーとテスト 喫煙室")');
assert.match(await page.textContent('#detail'), /三井不動産商業マネジメントの公開情報/);
assert.match(await page.textContent('#detail .note'), /Cエレベーター奥/);
await page.click('#detail-back');
await page.click('#hero [data-open]');

// 自治体データの詳細には出典を出す
await page.click('#detail-back');
await page.click('#list .item:has-text("区設置 公衆喫煙所テスト")');
assert.match(await page.textContent('#detail'), /台東区のオープンデータ（CC BY 4\.0）/);
assert.match(await page.textContent('#detail .tags'), /24時間/);
await page.click('#detail-back');
await page.click('#hero [data-open]');

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

// 現在地でそのまま投稿（位置の誤差が小さいときだけ使える）
await page.click('#detail-back');
await page.click('#btn-add');
await page.waitForSelector('#add-quick:not([disabled])');
assert.match(await page.textContent('#here-note'), /誤差は約\d+m/);
const before2 = await page.evaluate(() => window.__kemuri.state.user.size);
await page.click('#add-quick');
await page.waitForFunction((n) => window.__kemuri.state.user.size > n, before2, { timeout: 15000 })
  .catch(async (e) => { throw new Error(`現在地投稿が終わらない: ${await page.textContent('#add-error')} / size ${await page.evaluate(() => window.__kemuri.state.user.size)} (前 ${before2})`); });
const quick = await page.evaluate(() => { const s = [...window.__kemuri.state.user.values()].pop(); return [s.lat, s.lng]; });
assert.ok(Math.abs(quick[0] - 35.6812) < 1e-4 && Math.abs(quick[1] - 139.7671) < 1e-4, '現在地の座標で登録される');

// オフラインで再読み込みしても保存済みのデータで表示できる
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => page.reload());
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
await page.click('#detail-back');
await page.click('#btn-locate');
await page.waitForFunction(() => !document.querySelector('#hero').hidden, null, { timeout: 15000 });
await page.waitForTimeout(600); // 地図の位置が保存されるのを待つ
const before = ctx.calls;
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => !document.querySelector('#hero').hidden, null, { timeout: 15000 })
  .catch(async () => { throw new Error('オフラインで表示されない: ' + JSON.stringify(await page.evaluate(() => ({ hint: document.querySelector('#hint').textContent, zoom: window.__kemuri.map.getZoom(), osm: window.__kemuri.state.osm.size, places: window.__kemuri.state.places.length, mode: window.__kemuri.state.mode, c: window.__kemuri.map.getCenter() })))); });
assert.equal(await page.isVisible('#net'), true, 'オフライン表示');
assert.equal(ctx.calls, before, 'オフライン時は Overpass に問い合わせない');
if (process.env.STATIC !== '0') assert.equal(ctx.calls, 0, '全国データがあれば Overpass を使わない');
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
