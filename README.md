# けむりマップ

現在地の近くの喫煙所を地図と一覧で探すスマホ向け Web アプリ（PWA）。

## できること

- 現在地から近い順に一覧表示（距離・徒歩分数）。地図の印や一覧から Google マップの徒歩ルートを開ける
- 種類で絞り込み：**喫煙所**（初期表示はこれだけ）／**喫煙可の店**／**加熱式専用も表示**。選んだ状態は端末に保存
- ユーザー投稿：地図中央の印で位置を合わせて喫煙所を追加。既存の地点に「閉鎖を報告」「情報が違う」を送れる。投稿は直近90日に別々の3人から報告があると非表示（1人1日30件まで）
- オフライン：アプリ本体・見た範囲の地図タイル（最大800枚）・取得した喫煙所データを端末に保存し、電波がなくても前回の範囲を表示

## データ

- 喫煙所：[OpenStreetMap](https://www.openstreetmap.org/copyright)（ODbL）
  - 喫煙所 = `amenity=smoking_area`
  - 喫煙可の店 = `smoking` が `yes` / `separated` / `isolated` / `dedicated` / `outside` で `amenity` 付きのもの
  - 加熱式専用 = キー名に `heated` を含み値が `only`、または `smoking=heated_tobacco`（日本での付け方が揃っていないため暫定）
- **全国データ**：`public/data/jp/` に 1度四方の区画ごとの JSON（`[緯度, 経度, OSM ID, タグ]` の配列）と `index.json`（更新日時・件数・区画一覧）を置く。アプリは地図の範囲の区画だけを読み込み、Service Worker が端末に保存する（保存分をすぐ表示し、裏で新しい版を取得）
  - 作り方は2通り。どちらも同じ形式で書き出す
    - `python3 scripts/extract-pbf.py`：openstreetmap.fr の地方別ファイル（8地方・計約2.7GB）を1つずつダウンロードして抜き出す。Overpass が混んでいても確実に取れる。`pip install osmium` が必要
    - `node scripts/fetch-japan.mjs`：Overpass API に区画ごとに問い合わせる。軽いが、混雑時は失敗しやすい
  - 全国データがない配置では、従来どおり端末から Overpass API に直接問い合わせる（格子ごとに IndexedDB に3日保存）
- **自治体のオープンデータ**：`public/data/gov.json`。`node scripts/fetch-opendata.mjs` で作る。2026-11 時点で喫煙所の位置を公開しているのを確認できたのは江東区（6件）と台東区（27件）で、いずれも CC BY 4.0（e-Gov データポータル・東京都オープンデータカタログ・BODIK を検索）。OSM の喫煙所と 25m 以内で重なるものは自治体データを優先して1つにする。新しい自治体を見つけたらスクリプトの `SOURCES` に足す
- 使わないもの：モットスイタイなどの喫煙所マップサイトは、利用規約上データを取り込めないため使わない。ホットペッパーグルメ API はキーを取得できなかったため外した（2026-11。中継の実装は履歴のコミット 498c929 にある）
- 投稿・報告：Cloudflare Pages Functions + D1（`functions/`、`schema.sql`）。IP は日ごとの塩付きハッシュでのみ保存し、1端末1日10件まで

API がない配置（静的ホスティングだけ）でも動き、その場合は投稿ボタンが消える。

## 開発

```sh
npm install
npm run vendor     # Leaflet を public/vendor に配置
npm run db:init    # ローカル D1 にテーブル作成
npm run dev        # http://localhost:8788
npm test           # 別ターミナルで。ローカル D1 を空にしてから画面の動作を確認（全国データ・Overpass は固定データに差し替え）
STATIC=0 npm test  # 全国データがない配置の動作を確認
```

## 公開（Cloudflare Pages）

```sh
npx wrangler d1 create kemuri-map          # 出力された database_id を wrangler.toml に書く
npx wrangler d1 execute kemuri-map --remote --file=schema.sql
npx wrangler pages deploy
```

Pages の環境変数 `HASH_SECRET` に任意の文字列を設定する（IP ハッシュの塩）。

## 未対応・注意

- 全国データは `.github/workflows/data.yml` が毎週月曜に取り直し、変化があればコミットする（1回約20分。非公開リポジトリでは Actions の枠を月約80分使う）。手動でも Actions 画面から実行できる
- 中央区など、区のサイトに一覧ページはあるがオープンデータとして利用条件が示されていない自治体は取り込んでいない
- 投稿のモデレーション画面はない。不適切な投稿は D1 の `spots.hidden` を 1 にして隠す
- 投稿内容は OpenStreetMap には反映されない
