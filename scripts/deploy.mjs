// Cloudflare Pages に公開する。GitHub Actions（.github/workflows/ci.yml）から main のときだけ実行する。
//   必要な環境変数：CLOUDFLARE_API_TOKEN（Pages と D1 の編集権限）、CLOUDFLARE_ACCOUNT_ID
// 何度実行しても同じ結果になるようにしてある（プロジェクト作成・表の作成・鍵の設定は、済んでいれば何もしない）。
//   1. Pages のプロジェクトがなければ作る
//   2. D1 に表を作る（schema.sql は CREATE TABLE IF NOT EXISTS）
//   3. IP を仮名化する鍵 HASH_SECRET が未設定なら、ランダムな値を生成して設定する（値はどこにも表示・保存しない）
//   4. public/ と functions/ を公開する（D1 の接続先は wrangler.toml）
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROJECT = 'kemuri-map';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const token = process.env.CLOUDFLARE_API_TOKEN || '';
const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';

const summary = (text) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`); };

if (!token || !account) {
  // 認証情報を登録する前でも main のテストが赤くならないよう、公開だけを飛ばす。飛ばしたことは必ず目に入る形で残す
  const missing = [!token && 'CLOUDFLARE_API_TOKEN', !account && 'CLOUDFLARE_ACCOUNT_ID'].filter(Boolean).join(' と ');
  console.log(`::warning title=公開していません::リポジトリの Secrets に ${missing} が登録されていないため、Cloudflare への公開を飛ばしました。`);
  summary(`### 公開していません\nリポジトリの Secrets に ${missing} が登録されていません（Settings → Secrets and variables → Actions）。`);
  process.exit(0);
}

// 出力に認証情報が混ざっても表示しないよう、念のため伏せる
const hide = (s) => String(s || '').split(token).join('***');
function wrangler(args, { input, quiet } = {}) {
  try {
    const out = execFileSync(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT, input, encoding: 'utf8', timeout: 300_000, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    });
    if (!quiet) console.log(hide(out).trim());
    return out;
  } catch (e) {
    console.error(hide(e.stdout), hide(e.stderr));
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} が失敗しました`);
  }
}

// 1. プロジェクト
const projects = JSON.parse(wrangler(['pages', 'project', 'list', '--json'], { quiet: true }) || '[]');
const exists = projects.some((p) => Object.values(p).includes(PROJECT));
if (exists) console.log(`Pages のプロジェクト ${PROJECT} は作成済み`);
else wrangler(['pages', 'project', 'create', PROJECT, '--production-branch', 'main']);

// 2. 表（binding 名 DB で指定するので、Cloudflare 側のデータベース名には依存しない）
wrangler(['d1', 'execute', 'DB', '--remote', '--file', 'schema.sql', '--yes'], { quiet: true });
console.log('D1 の表を確認しました（なければ作成）');

// 3. 鍵
const secrets = wrangler(['pages', 'secret', 'list', '--project-name', PROJECT], { quiet: true });
if (/\bHASH_SECRET\b/.test(secrets)) console.log('HASH_SECRET は設定済み');
else {
  wrangler(['pages', 'secret', 'put', 'HASH_SECRET', '--project-name', PROJECT], { input: randomBytes(32).toString('hex'), quiet: true });
  console.log('HASH_SECRET を新しく生成して設定しました');
}

// 4. 公開
const out = wrangler(['pages', 'deploy', '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true']);
const preview = out.match(/https:\/\/[a-z0-9-]+\.pages\.dev/g)?.pop();
const after = JSON.parse(wrangler(['pages', 'project', 'list', '--json'], { quiet: true }) || '[]').find((p) => Object.values(p).includes(PROJECT));
const domain = after && JSON.stringify(after).match(/[a-z0-9-]+\.pages\.dev/)?.[0];
const url = domain ? `https://${domain}` : preview || '（URL を取得できませんでした）';
console.log(`公開しました: ${url}`);
summary(`### 公開しました\n${url}`);
