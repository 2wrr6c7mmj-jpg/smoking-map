"""日本の地方別 OSM ファイル（.osm.pbf）から喫煙所を抜き出し、public/data/jp/ に区画ごとの JSON を書き出す。

Overpass API が混んでいて全国を問い合わせられないときの取り方。
地方ファイルを1つずつダウンロード → 抜き出し → 削除するので、ディスクは最大の1ファイル分（約600MB）あればよい。

    pip install osmium
    python3 scripts/extract-pbf.py                  # ダウンロードから
    python3 scripts/extract-pbf.py a.osm.pbf ...    # 手元のファイルから

出力形式は scripts/fetch-japan.mjs と同じ。
"""
import json
import os
import re
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import osmium

BASE = 'https://download.openstreetmap.fr/extracts/asia/japan/'
REGIONS = ['hokkaido', 'tohoku', 'kanto', 'chubu', 'kansai', 'chugoku', 'shikoku', 'kyushu']
OUT = Path(__file__).resolve().parent.parent / 'public' / 'data' / 'jp'
SMOKING_OK = {'yes', 'separated', 'isolated', 'dedicated', 'outside'}
KEEP = {'name', 'name:ja', 'smoking', 'amenity', 'shop', 'tourism', 'leisure', 'waste', 'covered', 'shelter', 'indoor', 'location', 'smoking_area',
        'opening_hours', 'fee', 'operator', 'level', 'description', 'note'}


def wanted(tags):
    """喫煙所・吸い殻入れ、または喫煙できる場所（店・ホテル・遊技場など。種類のタグは問わない）"""
    if tags.get('amenity') == 'smoking_area' or 'cigarettes' in tags.get('waste', ''):
        return True
    return any(v.strip() in SMOKING_OK for v in tags.get('smoking', '').split(';'))


def compact(kind, oid, lat, lng, tags):
    t = {k: v for k, v in tags if k in KEEP or 'heated' in k}
    return [round(lat, 6), round(lng, 6), f'{kind}{oid}', t]


def extract(path):
    """喫煙所の node と way（way は構成点の平均を位置にする）を返す"""
    found = []
    fp = (osmium.FileProcessor(str(path), osmium.osm.NODE | osmium.osm.WAY)
          .with_locations()
          .with_filter(osmium.filter.KeyFilter('amenity', 'smoking', 'waste')))
    for o in fp:
        if not wanted(o.tags):
            continue
        if o.is_node():
            if o.location.valid():
                found.append(compact('n', o.id, o.location.lat, o.location.lon, o.tags))
        elif o.is_way():
            pts = [(n.location.lat, n.location.lon) for n in o.nodes if n.location.valid()]
            if pts:
                lat = sum(p[0] for p in pts) / len(pts)
                lng = sum(p[1] for p in pts) / len(pts)
                found.append(compact('w', o.id, lat, lng, o.tags))
    return found


def download(name, dest):
    url = f'{BASE}{name}-latest.osm.pbf'
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'kemuri-map-data/1.0'})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, 'wb') as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            return
        except Exception as e:  # 通信が切れたら少し待ってやり直す
            print(f'  {name} のダウンロード失敗: {e}', flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f'{name} をダウンロードできませんでした')


def main():
    files = sys.argv[1:]
    items, seen = [], set()

    def add(found, label):
        n = 0
        for c in found:
            if c[2] in seen:  # 地方の境目で重複するものは1つに
                continue
            seen.add(c[2])
            items.append(c)
            n += 1
        print(f'{label}: {n}件（累計 {len(items)}）', flush=True)

    if files:
        for f in files:
            add(extract(f), f)
    else:
        tmp = Path(os.environ.get('PBF_TMP') or tempfile.gettempdir())
        for name in REGIONS:
            dest = tmp / f'{name}.osm.pbf'
            print(f'{name} をダウンロード中', flush=True)
            download(name, dest)
            try:
                add(extract(dest), name)
            finally:
                dest.unlink(missing_ok=True)

    if len(items) < 100:
        raise SystemExit(f'件数が少なすぎます（{len(items)}件）。書き出しません')

    cells = {}
    for c in items:
        cells.setdefault(f'{int(c[0] // 1)}_{int(c[1] // 1)}', []).append(c)
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob('*.json'):
        f.unlink()
    for k, lst in cells.items():
        lst.sort(key=lambda c: c[2])  # 再取得時の差分を小さくする
        (OUT / f'{k}.json').write_text(json.dumps(lst, ensure_ascii=False, separators=(',', ':')))
    index = {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'total': len(items),
        'source': 'OpenStreetMap contributors (ODbL)',
        'missing': [],
        'cells': {k: len(v) for k, v in sorted(cells.items())},
    }
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1))
    print(f'書き出し: {len(items)}件 / {len(cells)}区画', flush=True)


if __name__ == '__main__':
    main()
