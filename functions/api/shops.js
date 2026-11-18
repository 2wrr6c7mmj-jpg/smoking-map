import { json, inJapan } from '../_lib/util.js';

// GET /api/shops?lat=..&lng=..
// ホットペッパーグルメ サーチAPI で半径1km の店を探し、全面禁煙・未確認以外（喫煙可・分煙など）を返す。
// API キーは Pages の環境変数 HOTPEPPER_KEY（端末には渡さない）。未設定なら 503 を返し、画面はこの機能を隠す。
// 規約に従い、画面に「Powered by ホットペッパーグルメ Webサービス」を表示する。結果は10分だけ一時保存する。
const API = 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/';
const CACHE_SEC = 600;

export function smokingAllowed(v) {
  const s = String(v || '');
  return s !== '' && !s.includes('全面禁煙') && !s.includes('未確認');
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.HOTPEPPER_KEY) return json({ error: 'ホットペッパーの検索は設定されていません' }, 503);
  const url = new URL(request.url);
  // 約100m 単位に丸めて、近い場所からの問い合わせを同じ一時保存で返す
  const lat = Math.round(Number(url.searchParams.get('lat')) * 1000) / 1000;
  const lng = Math.round(Number(url.searchParams.get('lng')) * 1000) / 1000;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inJapan(lat, lng)) {
    return json({ error: '日本国内の地点を指定してください' }, 400);
  }

  const cacheKey = new Request(`https://cache.local/shops/${lat},${lng}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache && (await cache.match(cacheKey));
  if (hit) return hit;

  const shops = [];
  for (let start = 1; start <= 201; start += 100) {
    const q = new URLSearchParams({ key: env.HOTPEPPER_KEY, lat, lng, range: '3', count: '100', start: String(start), format: 'json' });
    const res = await fetch(`${API}?${q}`);
    if (!res.ok) return json({ error: `ホットペッパーの検索に失敗しました（${res.status}）` }, 502);
    const r = (await res.json()).results || {};
    if (r.error) return json({ error: 'ホットペッパーの検索に失敗しました' }, 502);
    for (const s of r.shop || []) {
      if (!smokingAllowed(s.non_smoking)) continue;
      shops.push({
        id: s.id, name: s.name, lat: Number(s.lat), lng: Number(s.lng),
        smoking: s.non_smoking, genre: s.genre?.name || '', address: s.address || '',
        open: s.open || '', url: s.urls?.pc || '',
      });
    }
    if (Number(r.results_returned || 0) < 100) break;
  }
  const out = new Response(JSON.stringify({ shops, credit: 'Powered by ホットペッパーグルメ Webサービス' }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${CACHE_SEC}` },
  });
  if (cache) waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
