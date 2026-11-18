# けむりマップ

現在地の近くの喫煙所を地図と一覧で探すスマホ向け Web アプリ（PWA）。

## できること

- 現在地から近い順に一覧表示（距離・徒歩分数）。地図の印や一覧から Google マップの徒歩ルートを開ける
- 種類で絞り込み：**喫煙所**（初期表示はこれだけ）／**喫煙可の店**／**加熱式専用も表示**。選んだ状態は端末に保存
- ユーザー投稿：地図中央の印で位置を合わせて喫煙所を追加。既存の地点に「閉鎖を報告」「情報が違う」を送れる。投稿は報告が3件たまると非表示
- オフライン：アプリ本体・見た範囲の地図タイル（最大800枚）・取得した喫煙所データを端末に保存し、電波がなくても前回の範囲を表示

## データ

- 喫煙所：[OpenStreetMap](https://www.openstreetmap.org/copyright)（ODbL）を Overpass API から端末が直接取得
  - 喫煙所 = `amenity=smoking_area`
  - 喫煙可の店 = `smoking` が `yes` / `separated` / `isolated` / `dedicated` / `outside` で `amenity` 付きのもの
  - 加熱式専用 = キー名に `heated` を含み値が `only`、または `smoking=heated_tobacco`（日本での付け方が揃っていないため暫定）
- 地図の範囲を 0.02度（約2km）四方の格子に分け、格子ごとに IndexedDB に保存。OSM は3日、投稿は10分で取り直す。縮尺 14 未満では取得しない
- 投稿・報告：Cloudflare Pages Functions + D1（`functions/`、`schema.sql`）。IP は日ごとの塩付きハッシュでのみ保存し、1端末1日10件まで

API がない配置（静的ホスティングだけ）でも動き、その場合は投稿ボタンが消える。

## 開発

```sh
npm install
npm run vendor     # Leaflet を public/vendor に配置
npm run db:init    # ローカル D1 にテーブル作成
npm run dev        # http://localhost:8788
npm test           # 別ターミナルで。ローカル D1 を空にしてから画面の動作を確認（Overpass は固定データに差し替え）
```

## 公開（Cloudflare Pages）

```sh
npx wrangler d1 create kemuri-map          # 出力された database_id を wrangler.toml に書く
npx wrangler d1 execute kemuri-map --remote --file=schema.sql
npx wrangler pages deploy
```

Pages の環境変数 `HASH_SECRET` に任意の文字列を設定する（IP ハッシュの塩）。

## 未対応・注意

- Overpass API は公共の無料サービスで、混雑時は取得に失敗することがある。利用者が増えたら自前のデータ配信（定期的に日本全体を抽出して静的ファイル化）に切り替える
- 投稿のモデレーション画面はない。不適切な投稿は D1 の `spots.hidden` を 1 にして隠す
- 投稿内容は OpenStreetMap には反映されない
