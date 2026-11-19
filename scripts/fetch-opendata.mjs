// 自治体のオープンデータ（公衆喫煙所の一覧）を集め、public/data/gov.json に書き出す。
//   node scripts/fetch-opendata.mjs
// 2026-11 時点で、喫煙所の位置を公開しているのを確認できたのは江東区と台東区（いずれも CC BY 4.0）。
// e-Gov データポータル・東京都オープンデータカタログ・BODIK を「喫煙所」「喫煙場所」で検索した結果。
// 見つけたら SOURCES に足す。
import { writeFileSync } from 'node:fs';

const TOKYO_API = 'https://service.api.metro.tokyo.lg.jp/api/';

const SOURCES = [
  {
    id: 'koto-station', city: '江東区', license: 'CC BY 4.0',
    page: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000061',
    csv: 'https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_station.csv',
    map: (r) => ({ lat: +r['緯度'], lng: +r['経度'], name: r['喫煙所名'], note: r['場所'] }),
  },
  {
    id: 'koto-park', city: '江東区', license: 'CC BY 4.0',
    page: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000061',
    csv: 'https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_park.csv',
    map: (r) => ({ lat: +r['緯度'], lng: +r['経度'], name: r['喫煙所名'] }),
  },
  {
    id: 'taito', city: '台東区', license: 'CC BY 4.0',
    page: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131067d0000000110',
    // 区のサイトの CSV は海外から読めないことがあるため、同じ内容を東京都の API から取る
    api: 't131067d0000000110-97e13e95bcdea28e8d6292fe00608536-0',
    map: (r) => ({
      lat: +r['緯度'], lng: +r['経度'], name: r['名称'],
      address: r['設置位置'],
      note: [r['方書'], r['特記事項']].filter(Boolean).join(' '),
      hours: r['利用開始時間'] === '終日利用可能' ? '24時間' : [r['利用開始時間'], r['利用終了時間']].filter(Boolean).join('〜'),
    }),
  },
];

// ダブルクォート対応の最小限の CSV 読み取り
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((v) => v.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

async function decode(res) {
  const buf = new Uint8Array(await res.arrayBuffer());
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('shift_jis').decode(buf); }
}

async function rows(src) {
  if (src.csv) {
    const res = await fetch(src.csv, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${res.status}`);
    return parseCsv(await decode(res));
  }
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${TOKYO_API}${src.api}/json?limit=100&offset=${offset}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const j = await res.json();
    out.push(...j.hits);
    if (out.length >= j.total || !j.hits.length) return out;
  }
}

const spots = [];
const sources = [];
for (const src of SOURCES) {
  try {
    const list = (await rows(src)).map(src.map).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat > 20 && s.lng > 120);
    list.forEach((s, i) => spots.push([+s.lat.toFixed(6), +s.lng.toFixed(6), `${src.id}-${i + 1}`, {
      name: s.name, ...(s.address && { address: s.address }), ...(s.note && { note: s.note }), ...(s.hours && { hours: s.hours }),
    }]));
    sources.push({ id: src.id, type: 'gov', group: 'area', city: src.city, publisher: src.city, license: src.license, page: src.page, count: list.length });
    console.log(`${src.city}（${src.id}）: ${list.length}件`);
  } catch (e) {
    throw new Error(`${src.city}（${src.id}）を取得できませんでした: ${e.message}`);
  }
}
writeFileSync(new URL('../public/data/places/gov.json', import.meta.url), JSON.stringify({ updated: new Date().toISOString(), sources, spots }, null, 1));
console.log(`書き出し: ${spots.length}件`);
