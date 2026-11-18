// 地図の範囲を 0.02度（約2km）四方の格子に分け、格子ごとに取得・保存する
export const CELL = 0.02;
const idx = (v) => Math.floor(v / CELL);

export const cellOf = (lat, lng) => `${idx(lat)}:${idx(lng)}`;

export function cellBounds(id) {
  const [i, j] = id.split(':').map(Number);
  return { south: +(i * CELL).toFixed(6), west: +(j * CELL).toFixed(6), north: +((i + 1) * CELL).toFixed(6), east: +((j + 1) * CELL).toFixed(6) };
}

export function unionBounds(list) {
  return {
    south: Math.min(...list.map((b) => b.south)),
    west: Math.min(...list.map((b) => b.west)),
    north: Math.max(...list.map((b) => b.north)),
    east: Math.max(...list.map((b) => b.east)),
  };
}

// 範囲にかかる格子（中心に近い順、最大 max 個）
export function cellsFor(bounds, max) {
  const s = bounds.getSouth(), n = bounds.getNorth(), w = bounds.getWest(), e = bounds.getEast();
  const ci = (s + n) / 2 / CELL, cj = (w + e) / 2 / CELL;
  const out = [];
  for (let i = idx(s); i <= idx(n); i++) for (let j = idx(w); j <= idx(e); j++) out.push([i, j]);
  out.sort((a, b) => Math.hypot(a[0] + 0.5 - ci, a[1] + 0.5 - cj) - Math.hypot(b[0] + 0.5 - ci, b[1] + 0.5 - cj));
  return out.slice(0, max).map(([i, j]) => `${i}:${j}`);
}
