import { withSecretCheck, json, parseBbox, inJapan, clientHash, cleanText } from '../_lib/util.js';

// 直近90日に、別々の3人（IP単位）から閉鎖・誤りの報告があった投稿は表示しない
export const HIDE_AFTER_REPORTERS = 3;
export const REPORT_WINDOW = '-90 days';
const DAILY_POST_LIMIT = 10;

// GET /api/spots?bbox=south,west,north,east
// ユーザー投稿と、範囲内の報告件数（OSM の地点を含む）を返す
export async function onRequestGet({ request, env }) {
  const bbox = parseBbox(new URL(request.url).searchParams.get('bbox'));
  if (!bbox) return json({ error: 'bbox は south,west,north,east（各辺0.5度以内）で指定してください' }, 400);
  const args = [bbox.south, bbox.north, bbox.west, bbox.east];
  const [spots, reports] = await env.DB.batch([
    env.DB.prepare(
      `SELECT s.id, s.lat, s.lng, s.name, s.kind, s.heated_only, s.note, s.created_at
         FROM spots s
        WHERE s.hidden = 0 AND s.lat BETWEEN ?1 AND ?2 AND s.lng BETWEEN ?3 AND ?4
          AND (SELECT COUNT(DISTINCT r.client_hash) FROM reports r
                WHERE r.ref = 'user:' || s.id AND r.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '${REPORT_WINDOW}')) < ${HIDE_AFTER_REPORTERS}
        LIMIT 500`
    ).bind(...args),
    env.DB.prepare(
      `SELECT ref, reason, COUNT(*) AS n, MAX(created_at) AS last, MIN(lat) AS lat, MIN(lng) AS lng
         FROM reports WHERE lat BETWEEN ?1 AND ?2 AND lng BETWEEN ?3 AND ?4
        GROUP BY ref, reason LIMIT 1000`
    ).bind(...args),
  ]);
  return json({
    spots: spots.results.map((s) => ({ ...s, heated_only: !!s.heated_only })),
    // 地点ごと・理由ごとの報告件数（端末側で地図の範囲ごとに保存できるよう座標を付ける）
    reports: reports.results,
  });
}

// POST /api/spots  {lat, lng, name, kind, heated_only, note}
export const onRequestPost = (ctx) => withSecretCheck(() => post(ctx));

async function post({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON を送ってください' }, 400);
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inJapan(lat, lng)) {
    return json({ error: '日本国内の地点を指定してください' }, 400);
  }
  if (!['outdoor', 'indoor', 'shop'].includes(body.kind)) {
    return json({ error: '種類を選んでください' }, 400);
  }
  const hash = await clientHash(request, env.HASH_SECRET);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM spots WHERE client_hash = ? ').bind(hash).first();
  if (n >= DAILY_POST_LIMIT) return json({ error: '今日の投稿上限に達しました。明日また投稿してください' }, 429);

  const row = await env.DB.prepare(
    `INSERT INTO spots (lat, lng, name, kind, heated_only, note, client_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, lat, lng, name, kind, heated_only, note, created_at`
  )
    .bind(
      Math.round(lat * 1e6) / 1e6,
      Math.round(lng * 1e6) / 1e6,
      cleanText(body.name, 60),
      body.kind,
      body.heated_only ? 1 : 0,
      cleanText(body.note, 200),
      hash
    )
    .first();
  return json({ spot: { ...row, heated_only: !!row.heated_only } }, 201);
}
