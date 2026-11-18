// 施設サイトの取得：身元を名乗る UA、1ホスト1秒以上の間隔、robots.txt の Disallow を守る
const UA = 'kemuri-map-data/1.0 (+https://github.com/2wrr6c7mmj-jpg/smoking-map)';
const last = new Map();
const robots = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function disallowed(url) {
  const u = new URL(url);
  if (!robots.has(u.host)) {
    let rules = [];
    try {
      const res = await fetch(`${u.protocol}//${u.host}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        let applies = false;
        for (const line of (await res.text()).split(/\r?\n/)) {
          const [k, ...rest] = line.split(':');
          const v = rest.join(':').trim();
          if (/^user-agent$/i.test(k.trim())) applies = v === '*' || /kemuri/i.test(v);
          else if (applies && /^disallow$/i.test(k.trim()) && v) rules.push(v);
        }
      }
    } catch { /* robots.txt がなければ制限なし */ }
    robots.set(u.host, rules);
  }
  return robots.get(u.host).some((p) => u.pathname.startsWith(p));
}

export async function get(url, { accept = 'text/html' } = {}) {
  if (await disallowed(url)) throw new Error(`robots.txt で禁止: ${url}`);
  const host = new URL(url).host;
  const wait = (last.get(host) || 0) + 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  last.set(host, Date.now());
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept, 'accept-language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt === 2) throw new Error(`${url}: ${e.message}`);
      await sleep(3000 * (attempt + 1));
    }
  }
}

// HTML を行ごとの文字列に（スクリプト・スタイルを除く）
export function textLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|dd|dt|tr|td|th|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
