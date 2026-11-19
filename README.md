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
  - 市区の公開ページ：`scripts/sources/municipal.mjs` → `cities.json`。約300市区を調べ、喫煙所の案内があった140市区（大阪市516・港区116・横浜市96 ほか）の名称・住所・目印・利用時間だけを `scripts/data/municipal-spots.json` に記録。位置は ①ページや公開の Google マイマップにある座標 ②住所（国土地理院の住所検索）③目印 の順で出し、②③で粗いものは詳細に「目安」と表示する。目印が駅のときは国土数値情報の駅データ（`scripts/data/stations-all.json`）から引き、同名の駅は市区の中心にいちばん近いものを選ぶ。駅以外の目印は OpenStreetMap の地名検索で、名前が完全に一致し都道府県が合うものだけを採用する（`scripts/lib/landmark.mjs`）。どの方法でも、市区の中心から30km以上離れた位置は採用しない。休止・閉鎖中は除く。市が案内する店内の喫煙所（利用者向け）は「喫煙可の店」に入れる。区域図の画像から読み取った市（大分・和歌山・四日市など）は位置が概略
  - 駅構内：`scripts/sources/stations.mjs` → `stations.json`。JR 各社の公式案内（新幹線駅の喫煙ルームなど）から駅名と構内の場所を `scripts/data/station-spots.json` に記録。位置は駅そのもので、改札内・改札外と構内の場所は文章で示す。JR東日本は公式サイトが自動アクセスを拒否するため、関連会社の記事で確認できた駅だけ
  - 商業施設：`scripts/sources/mitsui.mjs` → `mitsui.json`。ららぽーと・三井アウトレットパーク等の「喫煙室」案内から階と場所
  - チェーン店：`scripts/sources/cunited.mjs`（ベローチェ・珈琲館・カフェ・ド・クリエ等）、`kaikatsu.mjs`（快活CLUB の加熱式たばこ専用エリア）、`hoshino.mjs`（星乃珈琲店）、`ueshima.mjs`（上島珈琲店）、`manekineko.mjs`（カラオケまねきねこの喫煙ブース。ブラウザで「もっとみる」を押して一覧を読む）
  - 取得は `scripts/lib/fetch.mjs` 経由：身元を名乗る User-Agent、1ホスト1秒以上の間隔、robots.txt の Disallow を守る。アクセスを拒否（403 等）されたサイトは回避せず使わない
  - 住所しかない店舗は `scripts/lib/geocode.mjs`（国土地理院の住所検索、結果は `scripts/cache/geocode.json` に保存）で緯度経度にする。番地・街区まで一致しなかったものは詳細に「町名までの目安」と表示
  - 規約で転載・再利用を禁止している運営者は使わない（ドトール・エクセルシオール・タリーズ・コメダ・カラオケ館・鳥貴族・ダイナム・ルノアール・プロント、NEXCO 各社、空港各社など。2026-11 調査）
- 使わないもの：モットスイタイなどの喫煙所マップサイトは、利用規約上データを取り込めないため使わない。ホットペッパーグルメ API はキーを取得できなかったため外した（2026-11。中継の実装は履歴のコミット 498c929 にある）
- 投稿・報告：Cloudflare Pages Functions + D1（`functions/`、`schema.sql`）。IP は日ごとの塩付きハッシュでのみ保存し、1端末1日10件まで

API がない配置（静的ホスティングだけ）でも動き、その場合は投稿ボタンが消える。

## データのライセンスと出典

このリポジトリは公開で、データも含めて誰でも取得できる。データごとの条件は次のとおり。

| データ | 場所 | 条件 |
| --- | --- | --- |
| OpenStreetMap | `public/data/jp/` | © OpenStreetMap contributors、[ODbL 1.0](https://opendatacommons.org/licenses/odbl/)。加工して再配布するときも同じ条件を引き継ぐ |
| 国土数値情報（駅別乗降客数） | `scripts/data/stations*.json` | 国土交通省、CC BY 4.0。加工して作成 |
| 台東区・江東区のオープンデータ | `public/data/places/gov.json` | CC BY 4.0 |
| 市区の公開ページ | `public/data/places/cities.json` | 各市区のページから名称・住所・利用時間などの事実だけを記録（文章は写していない）。多くの市区はサイトの転載に許可を求めているため、地点ごとに出典ページへのリンクを付けている |
| 鉄道会社・空港・商業施設・チェーン店 | `public/data/places/` のその他 | 各運営者の公開ページから、施設名・場所・喫煙設備の有無という事実だけを記録。地点ごとに出典ページへのリンクを付けている |

掲載内容の訂正・削除の依頼は、このリポジトリの Issue で受け付ける。プログラムのライセンスは未設定。

## 取りこぼしの確認（駅）

`node scripts/station-gaps.mjs` で、1日の乗降客数が2万人以上の駅のうち、300m以内に喫煙所のデータが1件もない駅を乗降客数の多い順に `scripts/data/station-gaps.json` へ書き出す。調査の優先順位と、どこまで拾えたかの物差しに使う（2026-11-19 時点：2万人以上の1,163駅中 587駅＝50%、10万人以上の224駅では 176駅＝79% に喫煙所あり。残りの駅はすべて状況を記録済みで、10万人以上の48駅は 41駅が「なし」と確認、7駅は 300〜500m に喫煙所あり）。

喫煙所データのない駅は、1駅ずつ調べた結果を `scripts/data/station-checked.json` に記録する（`python3 scripts/import-station-checks.py 調査フォルダ` で取り込み）。`station-gaps.mjs` は、喫煙所のない駅を「調べて『なし』と確認」「『なし』だが根拠が弱く要再確認（検索結果の要約だけで判断）」「未調査」に分けて出す。駅前を全面禁煙にして喫煙所を置かない市があるため、「データがない」と「喫煙所がない」を区別する。駅ごとに調べていない駅は、`node scripts/station-cities.mjs` で所在市区を出し（`scripts/data/unchecked-cities.json`）、その市区の調査結果から状況を決めて `scripts/data/station-checked-auto.json` に記録する（「市区の一覧に載っていない」は駅ごとの確認ではないので、区別して出す）。

駅の位置と乗降客数（`scripts/data/stations.json`、目印用の全駅 `stations-all.json`）は、国土交通省 国土数値情報「駅別乗降客数データ」（CC BY 4.0）を加工して作成。

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

main に入ると、GitHub Actions（`.github/workflows/ci.yml`）がテストのあと自動で公開する。週1回のデータ更新のあとも公開し直す。公開の処理は `scripts/deploy.mjs` で、次を行う（済んでいれば何もしない）。

1. Pages のプロジェクト `kemuri-map` がなければ作る
2. D1 に表を作る（`schema.sql`）。接続先のデータベースは `wrangler.toml` の `database_id`
3. IP を HMAC で仮名化する鍵 `HASH_SECRET` が未設定なら、ランダムな値を生成して設定する（値はどこにも表示・保存しない）
4. `public/` と `functions/` を公開する

必要なのは、リポジトリの Secrets（Settings → Secrets and variables → Actions）に次の2つを登録することだけ。

| Secret | 中身 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare の API トークン。権限は「Cloudflare Pages：編集」と「D1：編集」（どちらもアカウントの権限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID（ダッシュボードの URL の `dash.cloudflare.com/` の直後にある32文字） |

未登録のあいだは、テストだけ行って公開は飛ばす（実行結果に注意が出る）。PR では公開しない。

`HASH_SECRET` が未設定だと、投稿と報告は 503 で受け付けない（ローカル開発だけは固定の鍵で動く）。報告は90日で消える。

## 未対応・注意

- 全国データは `.github/workflows/data.yml` が毎週月曜に取り直し、変化があればコミットする（1回約20分。非公開リポジトリでは Actions の枠を月約80分使う）。手動でも Actions 画面から実行できる
- 中央区など、区のサイトに一覧ページはあるがオープンデータとして利用条件が示されていない自治体は取り込んでいない
- 投稿のモデレーション画面はない。不適切な投稿は D1 の `spots.hidden` を 1 にして隠す
- 投稿内容は OpenStreetMap には反映されない
