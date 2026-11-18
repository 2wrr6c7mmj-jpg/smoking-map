// けむりマップ：OpenStreetMap の喫煙所と、ユーザー投稿を地図と一覧で表示する
import { cellsFor, cellOf, cellBounds, unionBounds, CELL } from './cells.js';
import * as store from './store.js';

const L = window.L;
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OSM_TTL = 3 * 24 * 3600e3;      // OSM のデータは3日保存して使い回す
const USER_TTL = 10 * 60e3;           // 投稿は10分
const MIN_ZOOM = 14;                  // これより引いた縮尺では取得しない（Overpass の負荷を抑える）
const MAX_CELLS = 24;
const LIST_LIMIT = 30;
const DEFAULT_VIEW = { lat: 35.6812, lng: 139.7671, zoom: 16 }; // 東京駅

const $ = (id) => document.getElementById(id);
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const state = {
  osm: new Map(),       // key -> spot
  places: [],           // 自治体・施設・チェーンの公開情報（public/data/places/*.json）
  placeSources: [],
  user: new Map(),
  reports: new Map(),   // ref -> {closed:{n,last}, wrong:{n,last}}
  me: null,             // {lat,lng,acc}
  apiAvailable: true,
  mode: 'list',         // list | detail | add
  selected: null,       // 詳細を開いている地点の key
  listOpen: false,
  loadedAt: null,
  spots: [],            // 直近の描画で表示した地点（近い順）
};

// ---------- 地図 ----------
const saved = store.getPref('view');
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView(
  saved ? [saved.lat, saved.lng] : [DEFAULT_VIEW.lat, DEFAULT_VIEW.lng],
  saved ? saved.zoom : DEFAULT_VIEW.zoom
);
map.attributionControl.setPrefix(false);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
}).addTo(map);
const layer = L.layerGroup().addTo(map);
let meMarker = null;
let meCircle = null;

// ---------- データの種類 ----------
const SMOKING_OK = new Set(['yes', 'separated', 'isolated', 'dedicated', 'outside', 'area', 'only', 'designated', '分煙']);
const SMOKING_NAME = /喫煙(所|室|コーナー|スペース|ルーム|ブース|エリア|場所)|灰皿|スモーキング(エリア|ルーム)/;
const SMOKING_LABEL = {
  yes: '店内で喫煙可', separated: '分煙・喫煙席あり', isolated: '喫煙室あり',
  dedicated: '喫煙目的の店', outside: '屋外席で喫煙可', only: '喫煙目的の店', 分煙: '分煙・喫煙席あり', designated: '喫煙場所あり', area: '喫煙場所あり',
};
const KIND_LABEL = { area: '喫煙所', outdoor: '屋外の喫煙所', indoor: '屋内の喫煙室', shop: '喫煙できる店', tobacco: 'たばこ店' };
const SHOP_TYPE = { cafe: 'カフェ・喫茶', restaurant: '飲食店', bar: 'バー', pub: '居酒屋・パブ', fast_food: 'ファストフード', karaoke_box: 'カラオケ', nightclub: 'クラブ' };
const OTHER_TYPE = { convenience: 'コンビニ', hotel: 'ホテル', adult_gaming_centre: 'パチンコ・遊技場', fuel: 'ガソリンスタンド' };
const placeType = (t) => SHOP_TYPE[t.amenity] || OTHER_TYPE[t.shop] || OTHER_TYPE[t.tourism] || OTHER_TYPE[t.leisure] || OTHER_TYPE[t.amenity];

function heatedOnlyFromTags(t) {
  return Object.entries(t).some(([k, v]) => /heated/.test(k) && v === 'only') || t.smoking === 'heated_tobacco';
}

function fromOverpass(el) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  const t = el.tags || {};
  // 喫煙所と吸い殻入れは「喫煙所」、それ以外の喫煙できる場所（店・ホテルなど）は「喫煙可の店」
  const isTobacco = t.shop === 'tobacco' || t.shop === 'e-cigarette';
  let smoking = (t.smoking || '').split(';').map((v) => v.trim()).find((v) => SMOKING_OK.has(v));
  if (!smoking && ['yes', 'separated', 'designated'].includes(t['smoking:outside'])) smoking = 'outside';
  // 喫煙所：専用のタグ、灰皿・吸い殻入れ、店などの種類を持たず名前が喫煙所を指すもの
  const plain = !t.shop && !t.tourism && !t.leisure && (!t.amenity || /smoking_area|ashtray|waste_basket|shelter/.test(t.amenity));
  const isArea = /smoking_area/.test(t.amenity || '') || t.amenity === 'ashtray' || /cigarettes/.test(t.waste || '')
    || (plain && (['area', 'designated'].includes(smoking) || SMOKING_NAME.test(`${t.name || ''} ${t.description || ''}`)));
  if (!isArea && !smoking && !isTobacco) return null;
  return {
    key: `osm:${el.type}/${el.id}`,
    source: 'osm',
    group: isArea ? 'area' : smoking ? 'shop' : 'tobacco',
    kind: isArea ? 'area' : smoking ? 'shop' : 'tobacco',
    lat, lng,
    name: t.name || t['name:ja'] || (/cigarettes/.test(t.waste || '') || t.amenity === 'ashtray' ? '灰皿・吸い殻入れ' : ''),
    heatedOnly: heatedOnlyFromTags(t),
    tags: t,
  };
}

function fromUser(s) {
  return {
    key: `user:${s.id}`,
    source: 'user',
    group: s.kind === 'shop' ? 'shop' : 'area',
    kind: s.kind,
    lat: s.lat, lng: s.lng,
    name: s.name,
    heatedOnly: !!s.heated_only,
    note: s.note,
    createdAt: s.created_at,
  };
}

// 公開情報の1地点。src.type は gov（自治体）/ facility（商業施設など）/ chain（チェーン店）
function fromPlace([lat, lng, id, t], src = {}) {
  const gov = src.type === 'gov';
  const group = t.group || src.group || 'area';
  return {
    key: `${gov ? 'gov' : 'place'}:${id}`,
    source: gov ? 'gov' : 'place',
    group,
    kind: group === 'shop' ? 'shop' : 'area',
    lat, lng,
    name: t.name || '',
    heatedOnly: t.heated === 'only',
    heatedPartial: t.heated === 'partial',
    note: [t.note, t.address].filter(Boolean).join('\n'),
    hours: t.hours,
    io: t.io,
    url: t.url,
    src,
  };
}

// 自治体の喫煙所と同じ場所（25m以内）にある OSM の喫煙所は重複として隠す
const DUP_M = 25;
function isDuplicate(s) {
  return s.source === 'osm' && s.group === 'area' && state.places.some((g) => g.source === 'gov' && Math.abs(g.lat - s.lat) < 0.0005 && distance(g, s) < DUP_M);
}

// 地点の特徴を短い札にする
function tagsOf(s) {
  const out = [];
  const t = s.tags || {};
  if (s.source === 'osm') {
    if (s.kind === 'tobacco') out.push(t.shop === 'e-cigarette' ? '加熱式・電子たばこの店' : 'たばこ店', '店頭に灰皿がある場合があります');
    if (s.kind === 'shop') {
      const sm = (t.smoking || '').split(';').map((v) => v.trim()).find((v) => SMOKING_LABEL[v]);
      out.push(t.shop === 'convenience' && (sm === 'outside' || !sm) ? '店の外で喫煙可（灰皿）' : SMOKING_LABEL[sm] || '屋外席で喫煙可');
      out.push(placeType(t));
    }
    if (t.indoor === 'yes' || t.location === 'indoor' || t.smoking_area === 'room') out.push('屋内');
    else if (t.covered === 'yes' || t.shelter === 'yes') out.push('屋根あり');
    else if (s.kind === 'area') out.push('屋外');
    if (t.fee === 'yes') out.push('有料');
    if (t.level) out.push(`${t.level}階`);
    if (t.opening_hours) out.push(t.opening_hours === '24/7' ? '24時間' : `時間 ${t.opening_hours}`);
    if (t.operator) out.push(t.operator);
  } else if (s.source === 'gov') {
    out.push(`${s.src.city}の公衆喫煙所`);
    if (s.io) out.push(s.io === 'indoor' ? '屋内' : '屋外');
    if (s.hours) out.push(s.hours);
  } else if (s.source === 'place') {
    out.push(s.src.label);
    if (s.heatedPartial) out.push('加熱式専用の場所あり');
    if (s.hours) out.push(s.hours);
  } else {
    out.push(KIND_LABEL[s.kind]);
  }
  return out.filter(Boolean);
}
const noteOf = (s) => (s.source === 'osm' ? s.tags.description || s.tags.note || '' : s.note || '');
const SOURCE_LABEL = { osm: 'OpenStreetMap', user: 'みんなの投稿', gov: '自治体データ', place: '施設の公開情報' };

// ---------- 計算 ----------
function distance(a, b) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
const dirName = (deg) => DIRS[Math.round(deg / 45) % 8];
// 距離を数字と単位に分ける（数字を大きく、単位を小さく見せるため）
const distParts = (m) => (m < 1000 ? [String(Math.round(m / 10) * 10), 'm'] : [(m / 1000).toFixed(1), 'km']);
const walkMin = (m) => Math.max(1, Math.round(m / 80)); // 不動産表示と同じ 80m/分
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const routeUrl = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=walking`;

function flagOf(s) {
  const r = state.reports.get(s.key);
  const closed = r?.closed?.n || 0;
  const wrong = r?.wrong?.n || 0;
  if (closed) return `閉鎖の報告 ${closed}件`;
  if (wrong) return `情報違いの報告 ${wrong}件`;
  return null;
}
const displayName = (s) => s.name || (s.kind === 'area' ? `${dirName(s.b ?? 0)}の喫煙所` : KIND_LABEL[s.kind]);

function filters() {
  return { area: $('f-area').checked, shop: $('f-shop').checked, tobacco: $('f-tobacco').checked, heated: $('f-heated').checked };
}

// ---------- 描画 ----------
function picto(s, cls = 'picto') {
  const c = [cls, s.group === 'shop' ? 'shop' : s.group === 'tobacco' ? 'shop tobacco' : '', s.source === 'user' ? 'user' : '', flagOf(s) ? 'flagged' : ''].join(' ');
  return `<span class="${c}">${icon(s.group === 'shop' ? 'cup' : s.group === 'tobacco' ? 'store' : 'cig')}</span>`;
}
const bearingBadge = (s) =>
  `<span class="bearing" title="${dirName(s.b)}"><svg aria-hidden="true" style="transform:rotate(${Math.round(s.b)}deg)"><use href="#i-arrow"/></svg></span>`;
const distHtml = (s) => { const [n, u] = distParts(s.d); return `${n}<small>${u}</small>`; };

function render() {
  const f = filters();
  const b = map.getBounds().pad(0.1);
  const origin = state.me || map.getCenter();
  const inView = [...state.places, ...state.osm.values(), ...state.user.values()]
    .filter((s) => b.contains([s.lat, s.lng]) && (f.heated || !s.heatedOnly) && !isDuplicate(s));
  $('c-area').textContent = inView.filter((s) => s.group === 'area').length;
  $('c-shop').textContent = inView.filter((s) => s.group === 'shop').length;
  $('c-tobacco').textContent = inView.filter((s) => s.group === 'tobacco').length;

  const spots = inView.filter((s) => f[s.group]);
  for (const s of spots) {
    s.d = distance(origin, s);
    s.b = bearing(origin, s);
  }
  // 閉鎖の報告がある地点は後ろへ
  spots.sort((a, c) => (!!flagOf(a) - !!flagOf(c)) || a.d - c.d);
  state.spots = spots;
  const nearest = spots[0];

  layer.clearLayers();
  for (const s of spots) {
    const cls = ['pin', s.group === 'shop' ? 'shop' : s.group === 'tobacco' ? 'shop tobacco' : '', s.source === 'user' ? 'user' : '', flagOf(s) ? 'flagged' : '', s === nearest ? 'nearest' : '', s.key === state.selected ? 'selected' : ''].join(' ');
    const smoke = s === nearest ? '<span class="smoke"><i></i><i></i><i></i></span>' : '';
    const m = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', html: `<div class="${cls}">${icon(s.group === 'shop' ? 'cup' : s.group === 'tobacco' ? 'store' : 'cig')}${smoke}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      title: displayName(s),
      keyboard: true,
      zIndexOffset: s === nearest || s.key === state.selected ? 500 : 0,
    });
    m.on('click', () => openDetail(s.key));
    layer.addLayer(m);
  }

  if (state.mode === 'list') renderList(spots);
  if (state.mode === 'detail') renderDetail();
  renderStatus();
}

function renderList(spots) {
  const zoomOk = map.getZoom() >= MIN_ZOOM;
  const hero = $('hero');
  const hint = $('hint');
  const nearest = spots[0];
  const from = state.me ? '現在地から' : '地図の中心から';

  if (!zoomOk) {
    hero.hidden = true;
    hint.hidden = false;
    hint.textContent = '地図を拡大すると、この辺りの喫煙所を表示します。';
  } else if (!nearest) {
    hero.hidden = true;
    hint.hidden = loading;
    hint.textContent = filters().shop
      ? 'この範囲には登録された喫煙所が見つかりません。地図を動かすか、＋から投稿してください。'
      : 'この範囲には喫煙所が見つかりません。「喫煙可の店」も表示するか、地図を動かしてください。';
  } else {
    hint.hidden = true;
    hero.hidden = false;
    const flag = flagOf(nearest);
    hero.innerHTML = `
      <span class="label">${from}いちばん近い${nearest.group === 'shop' ? '場所' : '喫煙所'}</span>
      <h2>${esc(displayName(nearest))}</h2>
      <div class="metric">
        <div class="big">${distHtml(nearest)}</div>
        <div class="walk">${icon('walk')}<b>${walkMin(nearest.d)}</b>分 ${bearingBadge(nearest)}</div>
      </div>
      <div class="sub">${esc([dirName(nearest.b) + '方向', ...tagsOf(nearest).slice(0, 2)].join(' · '))}${flag ? ` · <span class="flag">${esc(flag)}</span>` : ''}</div>
      <div class="acts">
        <a class="btn btn-ember" href="${routeUrl(nearest)}" target="_blank" rel="noopener">${icon('walk')}徒歩ルートを開く</a>
        <button class="btn" type="button" data-open="${esc(nearest.key)}">詳細</button>
      </div>`;
    hero.querySelector('[data-open]').addEventListener('click', () => openDetail(nearest.key));
  }

  const rest = zoomOk ? spots.slice(1, LIST_LIMIT) : [];
  $('more').hidden = rest.length === 0;
  $('more-label').textContent = `ほかの候補 ${rest.length}件`;
  $('more').setAttribute('aria-expanded', String(state.listOpen));
  const list = $('list');
  list.hidden = !state.listOpen || rest.length === 0;
  list.replaceChildren();
  for (const s of rest) {
    const li = document.createElement('li');
    const flag = flagOf(s);
    const sub = [s.source === 'user' ? 'みんなの投稿' : '', ...tagsOf(s).slice(0, 2)].filter(Boolean);
    li.innerHTML = `<button class="item" type="button">
        ${picto(s)}
        <span class="name">${esc(displayName(s))}<span class="sub">${esc(sub.join(' · '))}${flag ? ` · <span class="flag">${esc(flag)}</span>` : ''}</span></span>
        <span class="dist">${bearingBadge(s)}<span>${distHtml(s)}</span></span>
      </button>`;
    li.firstElementChild.addEventListener('click', () => openDetail(s.key));
    list.append(li);
  }
}

function renderStatus() {
  const parts = [];
  if (staticIndex) parts.push(`全国 ${(staticIndex.total + state.places.length).toLocaleString('ja-JP')}件 · ${staticIndex.updated.slice(0, 10)} 時点`);
  else if (state.loadedAt) parts.push(`${state.loadedAt} 更新`);
  parts.push('データ © OpenStreetMap');
  const gov = state.placeSources.filter((x) => x.type === 'gov');
  const ccby = [...new Set(gov.filter((x) => /CC BY/.test(x.license || '')).map((x) => x.city))];
  if (ccby.length) parts.push(`自治体データ © ${ccby.join('・')}（CC BY 4.0）`);
  if (gov.some((x) => !/CC BY/.test(x.license || '')) || state.placeSources.some((x) => x.type !== 'gov')) parts.push('ほか各市・各運営者の公開ページより');
  $('status').textContent = parts.join(' · ');
}

function findSpot(key) {
  return state.osm.get(key) || state.user.get(key) || state.places.find((g) => g.key === key);
}

function openDetail(key) {
  state.selected = key;
  setMode('detail');
  const s = findSpot(key);
  render();
  if (s) viewVisible(L.latLng(s.lat, s.lng), map.getZoom());
}

function renderDetail() {
  const s = findSpot(state.selected);
  const el = $('detail');
  if (!s) { setMode('list'); renderList(state.spots); return; }
  const origin = state.me || map.getCenter();
  s.d = distance(origin, s);
  s.b = bearing(origin, s);
  const flag = flagOf(s);
  const r = state.reports.get(s.key);
  const last = r && (r.closed?.last || r.wrong?.last);
  const tags = tagsOf(s);
  const note = noteOf(s);
  const src = s.source === 'user'
    ? `みんなの投稿${s.createdAt ? ` · ${s.createdAt.slice(0, 10)}` : ''}`
    : s.source === 'gov' ? (/CC BY/.test(s.src.license || '') ? `${s.src.city}のオープンデータ（${s.src.license}）` : `${s.src.city}の公開ページより`)
    : s.source === 'place' ? `${s.src.publisher}の公開情報（${s.src.updated?.slice(0, 10) || ''} 時点）` : 'OpenStreetMap';
  el.innerHTML = `
    <div class="detail-head">
      ${picto(s)}
      <div><h2>${esc(displayName(s))}</h2><div class="src">${esc(src)}</div></div>
      <div class="metric" style="text-align:right"><div class="big" style="font-size:40px">${distHtml(s)}</div>
        <div class="walk">${icon('walk')}<b>${walkMin(s.d)}</b>分 ${bearingBadge(s)}</div></div>
    </div>
    ${flag ? `<p class="flag" style="margin:0;font-size:13px;font-weight:700">${esc(flag)}${last ? `（最終 ${esc(last.slice(0, 10))}）` : ''}</p>` : ''}
    <ul class="tags">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}${s.heatedOnly ? '<li class="heat">加熱式たばこ専用</li>' : ''}</ul>
    ${note ? `<p class="note">${esc(note)}</p>` : ''}
    <div class="acts">
      <a class="btn btn-ember" href="${routeUrl(s)}" target="_blank" rel="noopener">${icon('walk')}徒歩ルートを開く</a>
    </div>
    <div class="report">
      ${state.apiAvailable ? 'この情報について<button type="button" data-report="closed">閉鎖を報告</button><button type="button" data-report="wrong">情報が違う</button>' : ''}
      ${s.source === 'osm' ? `<a href="https://www.openstreetmap.org/${s.key.slice(4)}" target="_blank" rel="noopener">OSMで見る</a>` : ''}
      ${(s.url || s.src?.page) ? `<a href="${esc(s.url || s.src.page)}" target="_blank" rel="noopener">出典を見る</a>` : ''}
    </div>`;
  el.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => report(s, b)));
}

async function report(s, b) {
  b.disabled = true;
  try {
    const res = await fetch('api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: s.key, lat: s.lat, lng: s.lng, reason: b.dataset.report }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `送信できませんでした（${res.status}）`);
    toast('報告を受け付けました。ありがとうございます');
    // 自分の報告をすぐ反映するため、この地点の範囲の投稿データを取り直す
    await store.dropCells('user', [cellOf(s.lat, s.lng)]);
    refresh();
  } catch (e) {
    toast(navigator.onLine ? e.message : 'オフラインのため送信できません');
    b.disabled = false;
  }
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.hidden = true;
  void t.offsetWidth; // アニメーションをやり直す
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ---------- 画面の切り替え ----------
function setMode(mode) {
  state.mode = mode;
  $('view-list').hidden = mode !== 'list';
  $('view-detail').hidden = mode !== 'detail';
  $('add-form').hidden = mode !== 'add';
  $('crosshair').hidden = mode !== 'add';
  $('btn-add').setAttribute('aria-pressed', String(mode === 'add'));
  if (mode !== 'detail') state.selected = null;
}
$('detail-back').addEventListener('click', () => { setMode('list'); render(); });
$('more').addEventListener('click', () => { state.listOpen = !state.listOpen; render(); });

// ---------- 取得（地図の範囲を格子に分け、端末に保存する） ----------
async function fetchOverpass(b) {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:25];(nwr["amenity"="smoking_area"](${bbox});nwr["smoking"~"^(yes|separated|isolated|dedicated|outside)$"]["amenity"]["amenity"!="smoking_area"](${bbox}););out center tags;`;
  let last;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }) });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const j = await res.json();
      return j.elements.map(fromOverpass).filter(Boolean);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function fetchUser(b) {
  const res = await fetch(`api/spots?bbox=${b.south},${b.west},${b.north},${b.east}`);
  const type = res.headers.get('content-type') || '';
  if (res.status === 404 || !type.includes('json')) {
    // 投稿機能のサーバーがない配置（静的ホスティングだけ）では投稿を使わない
    state.apiAvailable = false;
    $('btn-add').hidden = true;
    return [];
  }
  if (!res.ok) throw new Error(`投稿の取得 ${res.status}`);
  const j = await res.json();
  return [
    ...j.spots.map(fromUser),
    ...j.reports.map((r) => ({ key: `report:${r.ref}:${r.reason}`, report: true, ref: r.ref, reason: r.reason, n: r.n, last: r.last, lat: r.lat, lng: r.lng })),
  ];
}

// ---------- 公開情報（自治体・施設・チェーン）。public/data/places/index.json に並んだファイルを読む ----------
async function loadPlaces() {
  const getJson = async (u) => {
    const res = await fetch(u);
    return res.ok && (res.headers.get('content-type') || '').includes('json') ? res.json() : null;
  };
  try {
    const idx = await getJson('data/places/index.json');
    const files = idx?.files || ['gov.json'];
    const all = await Promise.all(files.map((f) => getJson(`data/places/${f}`).catch(() => null)));
    const places = [];
    const sources = [];
    for (const j of all.filter(Boolean)) {
      const srcs = j.sources.map((x) => ({ ...x, updated: x.updated || j.updated }));
      sources.push(...srcs);
      // 地点の ID は「情報源の ID-…」。いちばん長く一致する情報源を使う
      const byLen = [...srcs].sort((a, b) => b.id.length - a.id.length);
      for (const row of j.spots) places.push(fromPlace(row, byLen.find((x) => row[2].startsWith(`${x.id}-`)) || srcs[0]));
    }
    state.places = places;
    state.placeSources = sources;
    render();
  } catch { /* なくても動く */ }
}

// ---------- 全国データ（scripts/fetch-japan.mjs で作る 1度四方の区画ファイル） ----------
let staticIndex;          // undefined: 未確認 / null: 全国データなし / object: index.json
const staticCells = new Map(); // 区画 -> Promise<spot[]>
const TYPE = { n: 'node', w: 'way', r: 'relation' };

async function getStaticIndex() {
  if (staticIndex !== undefined) return staticIndex;
  try {
    const res = await fetch('data/jp/index.json');
    staticIndex = res.ok && (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  } catch {
    staticIndex = null;
  }
  return staticIndex;
}

function loadStaticCell(k) {
  if (!staticCells.has(k)) {
    const p = fetch(`data/jp/${k}.json`)
      .then((r) => { if (!r.ok) throw new Error(`全国データ ${r.status}`); return r.json(); })
      .then((list) => list.map(([lat, lon, id, tags]) => fromOverpass({ type: TYPE[id[0]], id: id.slice(1), lat, lon, tags })).filter(Boolean));
    p.catch(() => staticCells.delete(k)); // 失敗した区画は次の移動で取り直す
    staticCells.set(k, p);
  }
  return staticCells.get(k);
}

async function loadStatic(bounds) {
  const keys = [];
  for (let i = Math.floor(bounds.getSouth()); i <= Math.floor(bounds.getNorth()); i++) {
    for (let j = Math.floor(bounds.getWest()); j <= Math.floor(bounds.getEast()); j++) {
      if (staticIndex.cells[`${i}_${j}`]) keys.push(`${i}_${j}`);
    }
  }
  try {
    return { items: (await Promise.all(keys.slice(0, 6).map(loadStaticCell))).flat() };
  } catch (error) {
    return { items: [], error };
  }
}

// cells のうち未取得・期限切れのものを、まとめて1回で取得して格子ごとに保存する
async function loadLayer(name, cells, ttl, fetcher) {
  const cached = await store.getCells(name, cells);
  const now = Date.now();
  const stale = cells.filter((c) => !cached[c] || now - cached[c].t > ttl);
  const fresh = cells.filter((c) => !stale.includes(c));
  let items = cells.flatMap((c) => cached[c]?.items || []);
  let error = null;
  if (stale.length && navigator.onLine) {
    try {
      const fetched = await fetcher(unionBounds(stale.map(cellBounds)));
      const byCell = Object.fromEntries(stale.map((c) => [c, []]));
      for (const it of fetched) byCell[cellOf(it.lat, it.lng)]?.push(it);
      await store.putCells(name, byCell, now);
      items = [...fresh.flatMap((c) => cached[c]?.items || []), ...Object.values(byCell).flat()];
    } catch (e) {
      error = e;
    }
  }
  return { items, error, usedCache: stale.length > 0 && (error || !navigator.onLine) };
}

let loading = false;
let pending = false;
async function refresh() {
  render();
  if (map.getZoom() < MIN_ZOOM) return;
  if (loading) { pending = true; return; }
  loading = true;
  $('progress').hidden = false;
  try {
    const cells = cellsFor(map.getBounds(), MAX_CELLS);
    // 全国データがあればそれを使い、なければ Overpass に直接問い合わせる
    const idx = await getStaticIndex();
    const [osm, user] = await Promise.all([
      idx ? loadStatic(map.getBounds()) : loadLayer('osm', cells, OSM_TTL, fetchOverpass),
      state.apiAvailable ? loadLayer('user', cells, USER_TTL, fetchUser) : { items: [] },
    ]);
    for (const s of osm.items) state.osm.set(s.key, s);
    for (const it of user.items) {
      if (it.report) {
        const r = state.reports.get(it.ref) || {};
        r[it.reason] = { n: it.n, last: it.last };
        state.reports.set(it.ref, r);
      } else {
        state.user.set(it.key, it);
      }
    }
    if (osm.error && !osm.items.length) toast('喫煙所データを取得できませんでした。時間をおいて地図を動かしてください');
    else if (osm.usedCache) toast('保存済みのデータを表示しています');
    if (!osm.error) state.loadedAt = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } finally {
    loading = false;
    $('progress').hidden = true;
    render();
    if (pending) { pending = false; refresh(); }
  }
}

let moveTimer;
map.on('moveend', () => {
  const c = map.getCenter();
  store.setPref('view', { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  clearTimeout(moveTimer);
  moveTimer = setTimeout(refresh, 350);
});
for (const id of ['f-area', 'f-shop', 'f-tobacco', 'f-heated']) {
  const v = store.getPref(id);
  if (typeof v === 'boolean') $(id).checked = v;
  $(id).addEventListener('change', () => { store.setPref(id, $(id).checked); render(); });
}

// ---------- 現在地 ----------
function locate(fly) {
  if (!navigator.geolocation) return toast('この端末では現在地を使えません');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      state.me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      const ll = [state.me.lat, state.me.lng];
      if (!meMarker) {
        meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
        meCircle = L.circle(ll, { radius: state.me.acc, weight: 0, color: '#3b8cff', fillOpacity: 0.08, interactive: false }).addTo(map);
      } else {
        meMarker.setLatLng(ll);
        meCircle.setLatLng(ll).setRadius(state.me.acc);
      }
      $('btn-locate').classList.add('active');
      if (state.mode === 'add') syncHere();
      if (fly) viewVisible(L.latLng(ll), Math.max(map.getZoom(), 16));
      render();
    },
    (err) => {
      if (fly) toast(err.code === 1 ? '位置情報の利用が許可されていません。設定から許可してください' : '現在地を取得できませんでした');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}
$('btn-locate').addEventListener('click', () => locate(true));

// シートの高さに合わせて丸ボタンと出典表示を持ち上げる
function visibleCenter() {
  const r = $('sheet').getBoundingClientRect();
  const top = document.querySelector('.top').getBoundingClientRect().bottom;
  const wide = r.top > 0 && r.right < innerWidth * 0.6 && r.height < innerHeight * 0.95 && innerWidth >= 760;
  return wide ? L.point((r.right + innerWidth) / 2, innerHeight / 2) : L.point(innerWidth / 2, (top + r.top) / 2 + 24);
}
// ll がシートに隠れていない部分の中央に来るように地図を動かす
function viewVisible(ll, zoom, opts) {
  const shift = map.getSize().divideBy(2).subtract(visibleCenter());
  map.setView(map.unproject(map.project(ll, zoom).add(shift), zoom), zoom, opts);
}

function syncSheetHeight() {
  const root = document.documentElement.style;
  root.setProperty('--sheet-h', `${$('sheet').offsetHeight}px`);
  const c = visibleCenter();
  root.setProperty('--pin-x', `${c.x}px`);
  root.setProperty('--pin-y', `${c.y}px`);
}
new ResizeObserver(syncSheetHeight).observe($('sheet'));

// ---------- 投稿 ----------
$('btn-add').addEventListener('click', () => {
  if (state.mode === 'add') { setMode('list'); render(); return; }
  // 今見ている中心がピンの位置に来るように地図をずらす
  const before = map.getCenter();
  setMode('add');
  $('add-error').hidden = true;
  syncHere();
  syncSheetHeight();
  viewVisible(before, Math.max(map.getZoom(), 18), { animate: false });
});
$('add-cancel').addEventListener('click', () => { setMode('list'); render(); });
// 現在地からの投稿：位置の誤差が大きいとき（屋内・ビル街）は、ずれた場所に登録されるので使わせない
const QUICK_MAX_ACC = 50;
function syncHere() {
  const ok = !!state.me;
  $('here').hidden = !ok;
  if (!ok) return;
  const acc = Math.round(state.me.acc);
  const precise = acc <= QUICK_MAX_ACC;
  $('add-quick').disabled = !precise;
  $('here-note').textContent = precise
    ? `現在地の誤差は約${acc}m。「そのまま投稿」は種類とメモの入力内容を付けて、いまいる場所に登録します。`
    : `現在地の誤差が約${acc}mと大きいため、そのまま投稿は使えません。ピンを動かして位置を合わせてください。`;
}
$('add-here').addEventListener('click', () => { if (state.me) viewVisible(L.latLng(state.me.lat, state.me.lng), Math.max(map.getZoom(), 18)); });
$('add-quick').addEventListener('click', () => { if (state.me) submitSpot(state.me); });
$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitSpot(map.containerPointToLatLng(visibleCenter()));
});

async function submitSpot(c) {
  const form = $('add-form');
  const fd = new FormData(form);
  const err = $('add-error');
  err.hidden = true;
  try {
    const res = await fetch('api/spots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lat: c.lat, lng: c.lng,
        name: fd.get('name'), kind: fd.get('kind'),
        heated_only: fd.get('heated_only') === 'on', note: fd.get('note'),
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `投稿できませんでした（${res.status}）`);
    const s = fromUser(j.spot);
    state.user.set(s.key, s);
    await store.dropCells('user', [cellOf(s.lat, s.lng)]);
    form.reset();
    const hiddenByFilter = !filters()[s.group];
    toast(hiddenByFilter ? '投稿しました（今の絞り込みでは表示されない種類です）' : '投稿しました');
    openDetail(s.key);
  } catch (ex) {
    err.textContent = navigator.onLine ? ex.message : 'オフラインのため投稿できません。電波のある場所でもう一度送ってください';
    err.hidden = false;
  }
}

// ---------- オフライン表示と Service Worker ----------
function syncNet() { $('net').hidden = navigator.onLine; }
addEventListener('online', () => { syncNet(); refresh(); });
addEventListener('offline', syncNet);
syncNet();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// 起動
setMode('list');
syncSheetHeight();
loadPlaces();
refresh();
locate(!saved);

// テストから状態を確認できるようにする
window.__kemuri = { state, map, refresh, CELL };
