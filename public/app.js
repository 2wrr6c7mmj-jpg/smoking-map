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
const state = {
  osm: new Map(),       // key -> spot
  user: new Map(),
  reports: new Map(),   // ref -> {closed:{n,last}, wrong:{n,last}}
  me: null,             // {lat,lng,acc}
  apiAvailable: true,
  adding: false,
  loadedAt: null,
};

// ---------- 地図 ----------
const saved = store.getPref('view');
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView(
  saved ? [saved.lat, saved.lng] : [DEFAULT_VIEW.lat, DEFAULT_VIEW.lng],
  saved ? saved.zoom : DEFAULT_VIEW.zoom
);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
}).addTo(map);
const layer = L.layerGroup().addTo(map);
let meMarker = null;
let meCircle = null;

const CIG = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="6" width="8" height="2.4" rx="0.6" fill="#fff"/><rect x="9.6" y="6" width="1.4" height="2.4" fill="#fff"/><path d="M9 4.6c0-1 1-1 1-2s-1-1-1-2" stroke="#fff" stroke-width="0.9" fill="none" stroke-linecap="round"/></svg>';
const SHOP = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 5h7v3.2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM9 5.6h1a1.2 1.2 0 0 1 0 2.4H9" stroke="#fff" stroke-width="1.1" fill="none"/></svg>';

// ---------- データの種類 ----------
const SMOKING_OK = new Set(['yes', 'separated', 'isolated', 'dedicated', 'outside']);
const SMOKING_LABEL = {
  yes: '店内で喫煙可', separated: '分煙（喫煙席あり）', isolated: '喫煙室あり',
  dedicated: '喫煙目的の店', outside: '屋外席で喫煙可',
};
const KIND_LABEL = { area: '喫煙所', outdoor: '屋外の喫煙所', indoor: '屋内の喫煙室', shop: '喫煙できる店' };

function heatedOnlyFromTags(t) {
  return Object.entries(t).some(([k, v]) => /heated/.test(k) && v === 'only') || t.smoking === 'heated_tobacco';
}

function fromOverpass(el) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  const t = el.tags || {};
  const isArea = t.amenity === 'smoking_area';
  if (!isArea && !SMOKING_OK.has(t.smoking)) return null;
  return {
    key: `osm:${el.type}/${el.id}`,
    source: 'osm',
    group: isArea ? 'area' : 'shop',
    kind: isArea ? 'area' : 'shop',
    lat, lng,
    name: t.name || t['name:ja'] || (isArea ? '' : ''),
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

function details(s) {
  const out = [];
  const t = s.tags || {};
  if (s.source === 'osm') {
    if (s.kind === 'shop') {
      out.push(SMOKING_LABEL[t.smoking]);
      const what = { cafe: 'カフェ・喫茶', restaurant: '飲食店', bar: 'バー', pub: '居酒屋・パブ', fast_food: 'ファストフード', karaoke_box: 'カラオケ' }[t.amenity];
      if (what) out.push(what);
    }
    if (t.indoor === 'yes' || t.location === 'indoor' || t.smoking_area === 'room') out.push('屋内');
    else if (t.covered === 'yes' || t.shelter === 'yes') out.push('屋根あり');
    if (t.opening_hours) out.push(`営業・利用時間 ${t.opening_hours}`);
    if (t.fee === 'yes') out.push('有料');
    if (t.operator) out.push(`管理 ${t.operator}`);
    if (t.level) out.push(`${t.level}階`);
    if (t.description || t.note) out.push(t.description || t.note);
  } else if (s.note) {
    out.push(s.note);
  }
  if (s.heatedOnly) out.push('加熱式たばこ専用');
  return out.filter(Boolean);
}

// ---------- 表示 ----------
function filters() {
  return { area: $('f-area').checked, shop: $('f-shop').checked, heated: $('f-heated').checked };
}

function visibleSpots() {
  const f = filters();
  const b = map.getBounds().pad(0.15);
  const all = [...state.osm.values(), ...state.user.values()];
  return all.filter((s) => f[s.group] && (f.heated || !s.heatedOnly) && b.contains([s.lat, s.lng]));
}

function distance(a, b) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);
const walkMin = (m) => Math.max(1, Math.round(m / 80)); // 不動産表示と同じ 80m/分
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function flagOf(s) {
  const r = state.reports.get(s.key);
  if (!r) return null;
  const closed = r.closed?.n || 0;
  const wrong = r.wrong?.n || 0;
  if (!closed && !wrong) return null;
  return closed ? `閉鎖の報告 ${closed}件` : `情報違いの報告 ${wrong}件`;
}

function displayName(s) {
  return s.name || KIND_LABEL[s.kind];
}

function render() {
  layer.clearLayers();
  const spots = visibleSpots();
  const origin = state.me || map.getCenter();
  for (const s of spots) s.d = distance(origin, s);
  spots.sort((a, b) => a.d - b.d);

  for (const s of spots) {
    const flag = flagOf(s);
    const cls = ['pin', s.group === 'shop' ? 'shop' : '', s.source === 'user' ? 'user' : '', flag ? 'flagged' : ''].join(' ');
    const icon = L.divIcon({ className: '', html: `<div class="${cls}">${s.group === 'shop' ? SHOP : CIG}</div>`, iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] });
    const m = L.marker([s.lat, s.lng], { icon, title: displayName(s), keyboard: true });
    m.bindPopup(() => popupHtml(s), { maxWidth: 280, autoPanPaddingTopLeft: [10, 120] });
    m.on('popupopen', (e) => wirePopup(e.popup.getElement(), s));
    s.marker = m;
    layer.addLayer(m);
  }

  const list = $('list');
  list.replaceChildren();
  for (const s of spots.slice(0, LIST_LIMIT)) {
    const li = document.createElement('li');
    const flag = flagOf(s);
    const sub = [s.source === 'user' ? 'みんなの投稿' : s.name ? KIND_LABEL[s.kind] : '', ...details(s).slice(0, 1)].filter(Boolean);
    li.innerHTML = `<button class="item" type="button">
        <span class="dot ${s.group === 'shop' ? 'shop' : ''} ${s.source === 'user' ? 'user' : ''}"></span>
        <span class="name">${esc(displayName(s))}<span class="sub">${esc(sub.join(' · '))}${flag ? ` · <span class="flag">${esc(flag)}</span>` : ''}</span></span>
        <span class="dist">${fmtDist(s.d)}</span>
      </button>`;
    li.firstElementChild.addEventListener('click', () => {
      map.setView([s.lat, s.lng], Math.max(map.getZoom(), 17));
      s.marker.openPopup();
      if (matchMedia('(max-width: 759px)').matches) setCollapsed(true);
    });
    list.append(li);
  }

  const zoomOk = map.getZoom() >= MIN_ZOOM;
  const from = state.me ? '現在地から' : '地図の中心から';
  $('summary').textContent = zoomOk
    ? `${from}近い順 · この範囲に${spots.length}件${state.loadedAt ? ` · ${state.loadedAt}更新` : ''}`
    : '地図を拡大すると喫煙所を表示します';
  const hint = $('hint');
  if (zoomOk && spots.length === 0 && !loading) {
    hint.hidden = false;
    hint.textContent = filters().shop
      ? 'この範囲には登録された喫煙所が見つかりません。地図を動かすか、＋から投稿できます。'
      : 'この範囲には喫煙所が見つかりません。「喫煙可の店」も表示するか、地図を動かしてください。';
  } else {
    hint.hidden = true;
  }
}

function popupHtml(s) {
  const ds = details(s);
  const flag = flagOf(s);
  const r = state.reports.get(s.key);
  const lastReport = r && (r.closed?.last || r.wrong?.last);
  const route = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=walking`;
  const meta = [
    s.source === 'user' ? `みんなの投稿${s.createdAt ? `（${s.createdAt.slice(0, 10)}）` : ''}` : 'OpenStreetMap',
    s.d != null ? `${fmtDist(s.d)}・徒歩約${walkMin(s.d)}分` : '',
  ].filter(Boolean).join(' · ');
  const osmLink = s.source === 'osm' ? `<a href="https://www.openstreetmap.org/${s.key.slice(4)}" target="_blank" rel="noopener">OSMで見る</a>` : '';
  return `<div class="pop">
      <h3>${esc(displayName(s))}</h3>
      <p class="meta">${esc(meta)}</p>
      ${flag ? `<p class="warn">${esc(flag)}${lastReport ? `（最終 ${esc(lastReport.slice(0, 10))}）` : ''}</p>` : ''}
      ${ds.length ? `<ul>${ds.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      <div class="acts">
        <a class="go" href="${route}" target="_blank" rel="noopener">徒歩ルート</a>
        ${osmLink}
        ${state.apiAvailable ? '<button type="button" data-report="closed">閉鎖を報告</button><button type="button" data-report="wrong">情報が違う</button>' : ''}
      </div>
    </div>`;
}

function wirePopup(el, s) {
  el.querySelectorAll('[data-report]').forEach((b) =>
    b.addEventListener('click', async () => {
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
        map.closePopup();
        refresh();
      } catch (e) {
        toast(navigator.onLine ? e.message : 'オフラインのため送信できません');
        b.disabled = false;
      }
    })
  );
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ---------- 取得（地図の範囲を格子に分け、端末に保存する） ----------
async function fetchOverpass(b) {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:25];(nwr["amenity"="smoking_area"](${bbox});nwr["smoking"~"^(yes|separated|isolated|dedicated|outside)$"]["amenity"!="smoking_area"](${bbox}););out center tags;`;
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

// cells のうち未取得・期限切れのものを、まとめて1回で取得して格子ごとに保存する
async function loadLayer(name, cells, ttl, fetcher) {
  const cached = await store.getCells(name, cells);
  const now = Date.now();
  const stale = cells.filter((c) => !cached[c] || now - cached[c].t > ttl);
  let items = cells.flatMap((c) => cached[c]?.items || []);
  let error = null;
  if (stale.length && navigator.onLine) {
    try {
      const fetched = await fetcher(unionBounds(stale.map(cellBounds)));
      const byCell = Object.fromEntries(stale.map((c) => [c, []]));
      for (const it of fetched) byCell[cellOf(it.lat, it.lng)]?.push(it);
      await store.putCells(name, byCell, now);
      items = [...cells.filter((c) => !stale.includes(c)).flatMap((c) => cached[c]?.items || []), ...Object.values(byCell).flat()];
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
  try {
    const cells = cellsFor(map.getBounds(), MAX_CELLS);
    const [osm, user] = await Promise.all([
      loadLayer('osm', cells, OSM_TTL, fetchOverpass),
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
for (const id of ['f-area', 'f-shop', 'f-heated']) {
  const saved = store.getPref(id);
  if (typeof saved === 'boolean') $(id).checked = saved;
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
        meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
        meCircle = L.circle(ll, { radius: state.me.acc, weight: 0, fillOpacity: 0.08, interactive: false }).addTo(map);
      } else {
        meMarker.setLatLng(ll);
        meCircle.setLatLng(ll).setRadius(state.me.acc);
      }
      if (fly) map.setView(ll, Math.max(map.getZoom(), 16));
      render();
    },
    (err) => {
      if (fly) toast(err.code === 1 ? '位置情報の利用が許可されていません。設定から許可してください' : '現在地を取得できませんでした');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}
$('btn-locate').addEventListener('click', () => locate(true));

// ---------- 一覧の開閉 ----------
function setCollapsed(c) {
  $('sheet').classList.toggle('collapsed', c);
  $('sheet-handle').setAttribute('aria-expanded', String(!c));
  syncSheetHeight();
}
function syncSheetHeight() {
  document.documentElement.style.setProperty('--sheet-h', `${$('sheet').offsetHeight}px`);
}
$('sheet-handle').addEventListener('click', () => setCollapsed(!$('sheet').classList.contains('collapsed')));
new ResizeObserver(syncSheetHeight).observe($('sheet'));

// ---------- 投稿 ----------
function setAdding(on) {
  state.adding = on;
  $('add-form').hidden = !on;
  $('list').hidden = on;
  $('crosshair').hidden = !on;
  $('sheet').classList.toggle('adding', on);
  $('btn-add').setAttribute('aria-pressed', String(on));
  $('add-error').hidden = true;
  if (on) {
    setCollapsed(false);
    map.closePopup();
    if (map.getZoom() < 17) map.setZoom(18);
    $('summary').textContent = '投稿する位置を選んでいます';
  } else {
    render();
  }
}
$('btn-add').addEventListener('click', () => setAdding(!state.adding));
$('add-cancel').addEventListener('click', () => setAdding(false));
$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = map.getCenter();
  const fd = new FormData(e.target);
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
    e.target.reset();
    setAdding(false);
    toast('投稿しました');
    if ((s.group === 'shop' && !$('f-shop').checked) || (s.group === 'area' && !$('f-area').checked)) {
      toast('投稿しました（今の絞り込みでは表示されない種類です）');
    }
  } catch (ex) {
    err.textContent = navigator.onLine ? ex.message : 'オフラインのため投稿できません。電波のある場所でもう一度送ってください';
    err.hidden = false;
  }
});

// ---------- オフライン表示と Service Worker ----------
function syncNet() { $('net').hidden = navigator.onLine; }
addEventListener('online', () => { syncNet(); refresh(); });
addEventListener('offline', syncNet);
syncNet();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// 起動
syncSheetHeight();
refresh();
if (!saved) locate(true);
else locate(false);

// テストから状態を確認できるようにする
window.__kemuri = { state, map, refresh, CELL };
