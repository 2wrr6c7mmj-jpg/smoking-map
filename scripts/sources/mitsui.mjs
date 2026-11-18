// 三井ショッピングパーク（ららぽーと・三井アウトレットパーク等）の喫煙所。
// 施設ごとの公開ページ「喫煙室」（/service/smoking.html）・「喫煙場所のご案内」（/info/others_info.html）から、
// 階と場所の短い記述だけを抜き出す。施設の位置はアクセスページの住所を国土地理院の住所検索で緯度経度にする。
//   node scripts/sources/mitsui.mjs   → public/data/places/mitsui.json
import { writeFileSync } from 'node:fs';
import { get, textLines } from '../lib/fetch.mjs';
import { geocode, saveGeocodeCache } from '../lib/geocode.mjs';

const BASE = 'https://mitsui-shopping-park.com';
const SITEMAPS = ['lsp', 'mop', 'rsc', 'urban', 'other'].map((k) => `${BASE}/sitemap/${k}-sitemap.xml`);
const locs = (xml) => [...(xml || '').matchAll(/<loc>([^<]+)/g)].map((m) => m[1].trim());

// サイトマップから施設のトップ（lalaport/◯◯・mop/◯◯・lalat-◯◯ など）を集め、喫煙所ページの決まった場所を確かめる
const SUBPAGES = new Set(['access', 'contact', 'coupon', 'event', 'floor', 'hour', 'info', 'newopen-renewal', 'openrenewal', 'service', 'shopguide', 'shopnews', 'sitemap', 'news', 'pickup']);
const NOT_FACILITY = new Set(['information', 'search', 'sitemap', 'special', 'event', 'msp-info']);
const roots = new Set();
for (const sm of SITEMAPS) {
  for (const child of locs(await get(sm, { accept: 'application/xml' }))) {
    for (const u of locs(await get(child, { accept: 'application/xml' }))) {
      const m = u.match(/^https:\/\/mitsui-shopping-park\.com\/([a-z0-9_-]+)\/([a-z0-9_-]+)\//);
      if (!m) continue;
      if ((m[1] === 'lalaport' || m[1] === 'mop') && !NOT_FACILITY.has(m[2])) roots.add(`${BASE}/${m[1]}/${m[2]}`);
      else if (SUBPAGES.has(m[2]) && m[1] !== 'urban') roots.add(`${BASE}/${m[1]}`);
    }
  }
}
const facilities = new Map();
for (const r of roots) {
  facilities.set(r, { smoking: [`${r}/service/smoking.html`, `${r}/info/others_info.html`], access: `${r}/access/` });
}
console.log(`施設 ${facilities.size}`);

// smoking.html：「喫煙室」見出しの後ろ「戻る」まで。
// others_info.html：冒頭に見出しの目次があり、本文は2回目の「喫煙場所のご案内」から次の見出しの手前まで
function smokingLines(lines, kind) {
  if (kind !== 'smoking') {
    const first = lines.indexOf('喫煙場所のご案内');
    const last = lines.lastIndexOf('喫煙場所のご案内');
    if (first < 0 || first === last) return [];
    const headings = new Set();
    for (let i = first; i < lines.length && i < first + 20 && lines[i].length <= 25 && !lines[i].includes('：'); i++) headings.add(lines[i]);
    const out = [];
    for (let i = last + 1; i < lines.length && !headings.has(lines[i]) && out.length < 15; i++) {
      if (!/^※|^場所：/.test(lines[i])) out.push(lines[i].replace(/に、?喫煙所がございます。?$/, ''));
    }
    return out;
  }
  const start = lines.findIndex((l, i) => i > 3 && /^喫煙(室|所|場所)/.test(l) && lines[i + 1] && !/^ホーム$/.test(lines[i + 1]));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length && out.length < 30; i++) {
    const l = lines[i];
    if (/^(戻る|ホーム|ページトップ|PAGE TOP)$/i.test(l)) break;
    if (/^喫煙(室|所|場所)$/.test(l) || /-->|<!--|^場所$|^全\d+箇所$/.test(l)) continue;
    out.push(l);
  }
  return out;
}

// 「1F」「2F」などの階の見出しと場所の行を「1F：Cエレベーター奥 / 無印良品横」の形にまとめる
const NOISE = /お買上げ|円（税込）|駐車|詳しくは|こちらをご覧|フロア(ガイド|マップ)|-->|<!--|館内は終日禁煙|指定の場所でご喫煙|所定の喫煙(所|室)をご利用|^【お願い】$|^◆|施設敷地内は/;
function summarize(lines) {
  lines = lines.filter((l) => !NOISE.test(l));
  const parts = [];
  let cur = null;
  for (const l of lines) {
    if (/^(B?\d+F|[A-Za-z]+\s?\d+F|屋上|屋外|[^\s]{1,10}(棟|館|プラザ|モール))$/.test(l)) { cur = { floor: l, places: [] }; parts.push(cur); }
    else if (l.length <= 60) { if (!cur) { cur = { floor: '', places: [] }; parts.push(cur); } cur.places.push(l); }
  }
  return parts.filter((p) => p.places.length).map((p) => (p.floor ? `${p.floor}：` : '') + p.places.join(' / ')).join('\n');
}

function addressOf(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/〒?\s?\d{3}-\d{4}\s*(.+[都道府県].+)/) || (/^〒?\s?\d{3}-\d{4}$/.test(lines[i]) && lines[i + 1] && [null, lines[i + 1]]);
    if (m) return m[1].replace(/\s.*$/, '').replace(/Google.*$/, '');
  }
  const l = lines.find((x) => /^(東京都|北海道|(?:京都|大阪)府|.{2,3}県).{2,}\d/.test(x) && x.length < 60);
  return l ? l.replace(/Google.*$/, '') : null;
}

const spots = [];
let n = 0;
for (const [root, f] of facilities) {
  if (!f.smoking.length) continue;
  let lines = [];
  let page = null;
  let title = '';
  for (const u of f.smoking) {
    let h;
    try { h = await get(u); } catch (e) { console.warn(`取得失敗: ${e.message}`); continue; }
    if (!h || /404/.test(h.slice(0, 300))) continue;
    const L = textLines(h);
    const s = smokingLines(L, u.endsWith('smoking.html') ? 'smoking' : 'other');
    if (s.length) { lines = s; page = u; title = L[0] || ''; break; }
  }
  if (!lines.length) continue;
  const safe = async (u) => { try { return textLines((await get(u)) || ''); } catch { return []; } };
  // 喫煙所ページの題名「喫煙室 | ららぽーと海老名」の後ろが施設名
  const parts = title.split('|').map((x) => x.trim());
  const name = parts.find((x) => /ららぽーと|アウトレット|ラゾーナ|ダイバーシティ|ららテラス|ららガーデン|ラ・?ラ/.test(x)) || parts.filter((x) => x && !/喫煙|三井ショッピングパーク|サービス/.test(x)).pop() || root.split('/').pop();
  const accessLines = await safe(f.access);
  const addr = addressOf(accessLines) || addressOf(await safe(`${root}/`));
  const g = addr && (await geocode(addr));
  if (!g) { console.warn(`位置不明: ${name}（${addr}）`); continue; }
  const note = summarize(lines);
  spots.push([+g.lat.toFixed(6), +g.lng.toFixed(6), `mitsui-${root.split('/').slice(-2).join('-')}`, {
    name: `${name} 喫煙室`, note, address: addr, url: page, facility: true, heated: /加熱式|電子タバコ/.test(note) && !/紙巻/.test(note) ? 'partial' : undefined,
  }]);
  n++;
  console.log(`${name}: ${note.split('\n').length}階分`);
}
saveGeocodeCache();
writeFileSync(new URL('../../public/data/places/mitsui.json', import.meta.url), JSON.stringify({
  updated: new Date().toISOString(),
  sources: [{ id: 'mitsui', type: 'facility', group: 'area', label: '商業施設の喫煙室', name: '三井ショッピングパーク 各施設の喫煙室案内', publisher: '三井不動産商業マネジメント', page: BASE, terms: '施設の公開ページから場所の事実のみを抜き出し（文章は転載せず要約）', count: n }],
  spots,
}, null, 1));
console.log(`書き出し: ${n}施設`);
