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
- **公開情報（自治体・施設・チェーン店）**：`public/data/places/*.json`（`index.json` で列挙）。情報源ごとのスクリプトで作り、`node scripts/build-places-index.mjs` で一覧を更新する
  - 自治体：`scripts/fetch-opendata.mjs` → `gov.json`。江東区・台東区（CC BY 4.0）。OSM の喫煙所と 25m 以内で重なるものは自治体データを優先
  - 市区の公開ページ：`scripts/sources/municipal.mjs` → `cities.json`。東京16区（港・中央・千代田・渋谷・世田谷ほか）と9市（川崎・神戸・熊本ほか）の一覧ページから、名称・住所・利用時間だけを `scripts/data/municipal-spots.json` に記録し、住所を緯度経度に変換（2026-11 調査。約120市区を調べ、住所つきの一覧があったのはこの25市区と武蔵野・府中・三鷹・船橋）。休止・閉鎖中は除く。位置は住所の街区までなので、実際の場所と数十mずれることがある
  - 商業施設：`scripts/sources/mitsui.mjs` → `mitsui.json`。ららぽーと・三井アウトレットパーク等の「喫煙室」案内から階と場所
  - チェーン店：`scripts/sources/cunited.mjs`（ベローチェ・珈琲館・カフェ・ド・クリエ等）、`kaikatsu.mjs`（快活CLUB の加熱式たばこ専用エリア）、`hoshino.mjs`（星乃珈琲店）、`ueshima.mjs`（上島珈琲店）、`manekineko.mjs`（カラオケまねきねこの喫煙ブース。ブラウザで「もっとみる」を押して一覧を読む）
  - 取得は `scripts/lib/fetch.mjs` 経由：身元を名乗る User-Agent、1ホスト1秒以上の間隔、robots.txt の Disallow を守る。アクセスを拒否（403 等）されたサイトは回避せず使わない
  - 住所しかない店舗は `scripts/lib/geocode.mjs`（国土地理院の住所検索、結果は `scripts/cache/geocode.json` に保存）で緯度経度にする。番地・街区まで一致しなかったものは詳細に「町名までの目安」と表示
  - 規約で転載・再利用を禁止している運営者は使わない（ドトール・エクセルシオール・タリーズ・コメダ・カラオケ館・鳥貴族・ダイナム・ルノアール・プロント、NEXCO 各社、空港各社など。2026-11 調査）
- 使わないもの：モットスイタイなどの喫煙所マップサイトは、利用規約上データを取り込めないため使わない。ホットペッパーグルメ API はキーを取得できなかったため外した（2026-11。中継の実装は履歴のコミット 498c929 にある）
- 投稿・報告：Cloudflare Pages Functions + D1（`functions/`、`schema.sql`）。IP は日ごとの塩付きハッシュでのみ保存し、1端末1日10件まで

API がない配置（静的ホスティングだけ）でも動き、その場合は投稿ボタンが消える。

## 取りこぼしの確認（駅）

`node scripts/station-gaps.mjs` で、1日の乗降客数が2万人以上の駅のうち、300m以内に喫煙所のデータが1件もない駅を乗降客数の多い順に `scripts/data/station-gaps.json` へ書き出す。調査の優先順位と、どこまで拾えたかの物差しに使う（2026-11-19 時点：1,163駅中 327駅＝28% に喫煙所あり）。

駅の位置と乗降客数（`scripts/data/stations.json`）は、国土交通省 国土数値情報「駅別乗降客数データ」（CC BY 4.0）を加工して作成。

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

Pages の環境変数 `HASH_SECRET` に16文字以上のランダムな文字列を設定する（`npx wrangler pages secret put HASH_SECRET`。IP を HMAC で仮名化する鍵）。**未設定だと投稿と報告は 503 で受け付けない**（ローカル開発だけは固定の鍵で動く）。報告は90日で消える。

## 未対応・注意

- 全国データは `.github/workflows/data.yml` が毎週月曜に取り直し、変化があればコミットする（1回約20分。非公開リポジトリでは Actions の枠を月約80分使う）。手動でも Actions 画面から実行できる
- 中央区など、区のサイトに一覧ページはあるがオープンデータとして利用条件が示されていない自治体は取り込んでいない
- 投稿のモデレーション画面はない。不適切な投稿は D1 の `spots.hidden` を 1 にして隠す
- 投稿内容は OpenStreetMap には反映されない
