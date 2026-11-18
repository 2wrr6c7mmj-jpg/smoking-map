import { withSecretCheck, json, inJapan, clientHash } from '../_lib/util.js';

const DAILY_REPORT_LIMIT = 30;
const NEAR_DEG = 0.002; // 投稿の地点と報告の座標のずれの許容（約200m）

// POST /api/reports  {ref: 'osm:node/123' | 'user:45' | 'gov:taito-3', lat, lng, reason: 'closed' | 'wrong'}
// 同じ人（IP の塩付きハッシュ）から同じ地点への報告は1件として数える（理由を変えたら上書き）
export const onRequestPost = (ctx) => withSecretCheck(() => post(ctx));

async function post({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON を送ってください' }, 400);
  }
  const ref = String(body.ref || '');
  if (!/^(osm:(node|way|relation)\/\d{1,12}|user:\d{1,10}|gov:[a-z]{2,20}(-[a-z]{2,20})?-\d{1,6})$/.test(ref)) {
    return json({ error: '報告する地点が不正です' }, 400);
  }
  if (!['closed', 'wrong'].includes(body.reason)) return json({ error: '理由を選んでください' }, 400);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inJapan(lat, lng)) {
    return json({ error: '日本国内の地点を指定してください' }, 400);
  }
  // 投稿への報告は、実在する投稿で、座標がその近くのものだけ受け付ける
  if (ref.startsWith('user:')) {
    const spot = await env.DB.prepare('SELECT lat, lng FROM spots WHERE id = ? AND hidden = 0').bind(Number(ref.slice(5))).first();
    if (!spot) return json({ error: '報告する地点が見つかりません' }, 404);
    if (Math.abs(spot.lat - lat) > NEAR_DEG || Math.abs(spot.lng - lng) > NEAR_DEG) {
      return json({ error: '報告する地点の位置が合いません' }, 400);
    }
  }
  // 日をまたいでも同じ人（IP）は1人と数える
  const hash = await clientHash(request, env.HASH_SECRET, { daily: false });
  const { n } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reports WHERE client_hash = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')"
  ).bind(hash).first();
  if (n >= DAILY_REPORT_LIMIT) return json({ error: '今日の報告上限に達しました。明日また送ってください' }, 429);
  await env.DB.prepare(
    `INSERT INTO reports (ref, lat, lng, reason, client_hash) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (ref, client_hash) DO UPDATE SET reason = excluded.reason, created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
  )
    .bind(ref, lat, lng, body.reason, hash)
    .run();
  // 判定に使う期間（90日）を過ぎた報告は消す（仮名化した値も長く持たない）
  await env.DB.prepare("DELETE FROM reports WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 days')").run();
  return json({ ok: true }, 201);
}
