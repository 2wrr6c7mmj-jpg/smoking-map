// 端末内の保存：格子ごとのデータは IndexedDB、設定は localStorage（使えなくても動く）
const DB_NAME = 'kemuri-map';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('cells');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function tx(mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve) => {
        if (!d) return resolve(null);
        try {
          const t = d.transaction('cells', mode);
          const out = fn(t.objectStore('cells'));
          t.oncomplete = () => resolve(out);
          t.onerror = t.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

export async function getCells(layer, ids) {
  const out = {};
  await tx('readonly', (s) => {
    for (const id of ids) {
      const r = s.get(`${layer}|${id}`);
      r.onsuccess = () => { if (r.result) out[id] = r.result; };
    }
  });
  return out;
}

export async function putCells(layer, byCell, t) {
  await tx('readwrite', (s) => {
    for (const [id, items] of Object.entries(byCell)) s.put({ t, items }, `${layer}|${id}`);
  });
}

export async function dropCells(layer, ids) {
  await tx('readwrite', (s) => { for (const id of ids) s.delete(`${layer}|${id}`); });
}

export function getPref(k) {
  try { return JSON.parse(localStorage.getItem(`kemuri:${k}`)); } catch { return null; }
}
export function setPref(k, v) {
  try { localStorage.setItem(`kemuri:${k}`, JSON.stringify(v)); } catch { /* 保存できなくても動作は続ける */ }
}
