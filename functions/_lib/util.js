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

// IP をそのまま保存しないため、HASH_SECRET を鍵にした HMAC-SHA256 で仮名化する。
// 鍵がないと IPv4 の総当たりで元の IP を割り出せるので、本番では鍵なしで動かさない（ローカル開発だけ固定の鍵を使う）。
// daily=true は日付も混ぜる（投稿の1日上限用）。報告は日をまたいでも同じ人を1人と数えるため daily=false
export class MissingSecretError extends Error {}
const keys = new Map();
async function hmacKey(secret) {
  if (!keys.has(secret)) {
    keys.set(secret, crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  }
  return keys.get(secret);
}
export async function clientHash(request, secret = '', { daily = true } = {}) {
  const host = new URL(request.url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!secret || secret.length < 16) {
    if (!local) throw new MissingSecretError('HASH_SECRET（16文字以上）が設定されていません');
    secret = 'local-development-only-secret';
  }
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const day = daily ? new Date().toISOString().slice(0, 10) : 'all';
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(`${day}|${ip}`));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 設定漏れは利用者のせいではないので 503 で返す
export async function withSecretCheck(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MissingSecretError) return json({ error: 'サーバーの設定が終わっていないため、今は送信できません' }, 503);
    throw e;
  }
}

export const cleanText = (v, max) =>
  String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
