import { json, inJapan, clientHash } from '../_lib/util.js';

// POST /api/reports  {ref: 'osm:node/123' | 'user:45', lat, lng, reason: 'closed' | 'wrong'}
// 同じ端末（日ごとのハッシュ）から同じ地点への報告は1件として数える
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON を送ってください' }, 400);
  }
  const ref = String(body.ref || '');
  if (!/^(osm:(node|way|relation)\/\d{1,12}|user:\d{1,10})$/.test(ref)) {
    return json({ error: '報告する地点が不正です' }, 400);
  }
  if (!['closed', 'wrong'].includes(body.reason)) return json({ error: '理由を選んでください' }, 400);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inJapan(lat, lng)) {
    return json({ error: '日本国内の地点を指定してください' }, 400);
  }
  const hash = await clientHash(request, env.HASH_SECRET);
  await env.DB.prepare(
    `INSERT INTO reports (ref, lat, lng, reason, client_hash) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (ref, client_hash) DO UPDATE SET reason = excluded.reason, created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
  )
    .bind(ref, lat, lng, body.reason, hash)
    .run();
  return json({ ok: true }, 201);
}
