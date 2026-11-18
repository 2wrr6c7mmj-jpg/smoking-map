// Pages Functions 共通処理
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// 日本周辺のみ受け付ける（沖ノ鳥島〜択捉島、与那国島〜南鳥島を含む矩形）
export const inJapan = (lat, lng) => lat >= 20 && lat <= 46 && lng >= 122 && lng <= 154;

export function parseBbox(s) {
  const p = (s || '').split(',').map(Number);
  if (p.length !== 4 || p.some((v) => !Number.isFinite(v))) return null;
  const [south, west, north, east] = p;
  if (south >= north || west >= east) return null;
  if (north - south > 0.5 || east - west > 0.5) return null; // 広すぎる範囲は拒否
  return { south, west, north, east };
}

// IP をそのまま保存しないため、塩付きでハッシュ化する。
// daily=true は日付も混ぜる（投稿の1日上限用）。報告は日をまたいでも同じ人を1人と数えるため daily=false
export async function clientHash(request, secret = '', { daily = true } = {}) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const day = daily ? new Date().toISOString().slice(0, 10) : 'all';
  const data = new TextEncoder().encode(`${secret}|${day}|${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const cleanText = (v, max) =>
  String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
