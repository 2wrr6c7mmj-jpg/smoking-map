"""主要駅を1駅ずつ調べた結果（調査担当が出した *_status.json）を scripts/data/station-checked.json にまとめる。

    python3 scripts/import-station-checks.py 調査フォルダ

調査フォルダには、担当に渡した駅一覧 gaps_N.json と、結果の spots_X_status.json を置く（N と X の対応は PAIRS）。
status の意味：
  found         喫煙所が見つかった（地点は municipal-spots.json に入れる）
  city_none     市として喫煙所を置いていないと確認済み（根拠は市の調査結果）
  none_in_list  市区の一覧は取り込み済みで、この駅の近くには載っていない
  none          未調査だった市区を調べたが、喫煙所の案内がなかった
  blocked       公式サイトが自動アクセスを拒否した（未確認のまま）
evidence（根拠の強さ）：strong＝市の方針や公式ページで確認 / weak＝検索結果の要約だけで判断（公式ページは開いていない）
"""
import json
import sys
from pathlib import Path

PAIRS = {'gaps_1.json': 'spots_m_status.json', 'gaps_2.json': 'spots_n_status.json', 'gaps_3.json': 'spots_o_status.json'}
src = Path(sys.argv[1])
out = []
for gaps_file, status_file in PAIRS.items():
    if not (src / status_file).exists():
        continue
    gaps = {}
    for g in json.loads((src / gaps_file).read_text()):
        gaps.setdefault(g['name'], []).append(g)   # 同名の駅は渡した順に対応させる
    for s in json.loads((src / status_file).read_text()):
        name = s['station'].removesuffix('駅')
        g = gaps.get(name, [None]).pop(0) if gaps.get(name) else None
        if not g:
            print(f'駅一覧にない駅名: {s["station"]}', file=sys.stderr)
            continue
        strong = s['status'] in ('found', 'city_none') or bool(s.get('page'))
        out.append({
            'name': name, 'lat': g['lat'], 'lng': g['lng'], 'riders': g['riders'],
            'city': s.get('city', ''), 'status': s['status'], 'evidence': 'strong' if strong else 'weak',
            'page': s.get('page', ''), 'note': s.get('note', ''),
        })
out.sort(key=lambda x: -x['riders'])
dest = Path(__file__).resolve().parent / 'data' / 'station-checked.json'
dest.write_text('[\n' + ',\n'.join(json.dumps(x, ensure_ascii=False) for x in out) + '\n]\n')
print(f'{len(out)}駅を記録')
