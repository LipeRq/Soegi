"""日本地図（都道府県）のSVGをつくる。元データ：Natural Earth（パブリックドメイン）の行政区画 ne_10m_admin_1。
使い方：python3 src/make-japan.py <ne_10m_admin_1_states_provinces.geojson>
出力：assets/japan.json（各県の path と、山形からの距離 0〜1）
- 小さな島は省き、線は Douglas-Peucker で単純化する。沖縄県は左上の囲みに移して描く。
"""
import json, math, sys

src = json.load(open(sys.argv[1]))
feats = [f for f in src['features'] if f['properties'].get('adm0_a3') == 'JPN']
LAT0 = 36.5
K = math.cos(math.radians(LAT0))
TOL = 0.035  # 単純化の許容（度）

def proj(lon, lat):
    return (lon * K, -lat)

def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy) or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        x0, y0 = pts[i]
        d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / n
        if d > dmax: dmax, idx = d, i
    if dmax > eps:
        return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]

def area(r):
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]))) / 2

prefs = []
for f in feats:
    name = f['properties']['name']
    g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    rings = []
    for poly in polys:
        ring = poly[0]
        lon = sum(p[0] for p in ring) / len(ring); lat = sum(p[1] for p in ring) / len(ring)
        if lat < 30 and name != 'Okinawa': continue          # 小笠原などの遠い島
        if lon > 146.5: continue
        r = [proj(x, y) for x, y in ring]
        if name == 'Okinawa':
            if lat < 25.9 or lat > 27.2 or lon < 127.5 or lon > 128.4: continue  # 沖縄本島のあたりだけ
            r = [(x + (130.2 - 127.9) * K, y - (43.3 - 26.5)) for x, y in r]    # 左上の囲みへ移す
        if area(r) < 0.012: continue
        # 閉じた輪郭は、始点から一番遠い点で2つに分けてから単純化する（そのままだと始点と終点が同じで潰れる）
        far = max(range(len(r)), key=lambda i: (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2)
        r = rdp(r[:far + 1], TOL * K)[:-1] + rdp(r[far:] + [r[0]], TOL * K)[:-1]
        if len(r) >= 4: rings.append(r)
    if rings: prefs.append({'name': name, 'rings': rings})

allpts = [p for pr in prefs for r in pr['rings'] for p in r]
minx = min(p[0] for p in allpts); maxx = max(p[0] for p in allpts)
miny = min(p[1] for p in allpts); maxy = max(p[1] for p in allpts)
W = 1000; s = W / (maxx - minx); H = (maxy - miny) * s
def tp(p): return ((p[0] - minx) * s, (p[1] - miny) * s)

def centroid(rings):
    big = max(rings, key=area)
    xs = [p[0] for p in big]; ys = [p[1] for p in big]
    return (sum(xs) / len(xs), sum(ys) / len(ys))

yc = tp(centroid(next(p for p in prefs if p['name'] == 'Yamagata')['rings']))
out = []
for pr in prefs:
    d = ' '.join('M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in map(tp, r)) + 'Z' for r in pr['rings'])
    c = tp(centroid(pr['rings']))
    out.append({'name': pr['name'], 'd': d, 'dist': math.hypot(c[0] - yc[0], c[1] - yc[1])})
mx = max(o['dist'] for o in out)
for o in out: o['dist'] = round(o['dist'] / mx, 3)
oki = [tp(p) for pr in prefs if pr['name'] == 'Okinawa' for r in pr['rings'] for p in r]
box = [min(p[0] for p in oki) - 40, min(p[1] for p in oki) - 40, max(p[0] for p in oki) + 40, max(p[1] for p in oki) + 40] if oki else None
json.dump({'viewBox': f'0 0 {W} {H:.0f}', 'yamagata': [round(yc[0], 1), round(yc[1], 1)], 'okinawaBox': [round(v, 1) for v in box] if box else None,
           'prefs': out, 'source': 'Natural Earth ne_10m_admin_1（パブリックドメイン）'}, open('assets/japan.json', 'w'), ensure_ascii=False)
print(len(out), 'prefs', f'viewBox 0 0 {W} {H:.0f}', 'size', sum(len(o['d']) for o in out), 'okinawa box', box)
