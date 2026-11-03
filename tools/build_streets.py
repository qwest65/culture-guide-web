#!/usr/bin/env python3
"""Граф улиц города для пешеходных путей — перенесено из «Маленького каравана» (tools/build_streets.py).

1. Скачивает из OpenStreetMap (Overpass API) дороги и дорожки района города
   (bbox из content/cities/<город>/city.json — тот же, что у своей карты, tools/build_map.py).
2. Оставляет только то, где удобно гулять: улицы, тротуары, переходы, пешеходные улицы
   и дорожки скверов и площадей. Внутриквартальные проезды, парковки, тропинки
   и дорожки во дворах выбрасываются — дворы бывают закрыты.
   Главные улицы, тротуары и скверы «дешевле» переулков, а грунтовки ещё дороже
   (walk_factor): путь выходит чуть длиннее, но идёт по знакомым улицам.
3. Добавляет поправки, сделанные после прохода на месте (content/cities/<город>/walking.json):
   скверы, которых нет в OSM (walk_areas), и дорожки, проложенные вручную (manual_paths).
4. Сохраняет граф в content/cities/<город>/streets.json. По нему сборка
   (tools/build-content.ts) прокладывает маршруты между остановками, а телефон —
   путь «от меня до точки» и перестраивает его, если свернули.
5. Рисует картинку-проверку tools/preview/<город>-streets.png: улицы по «цене»,
   выброшенные дворы бледным, объекты города.

    pip install matplotlib
    python3 tools/build_streets.py troitsk

Запускается в GitHub Actions (.github/workflows/streets.yml).
"""
import heapq
import json
import math
import os
import pathlib
import sys
import time
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]

OVERPASS = [
    os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
USER_AGENT = "CultureGuide-build/1.0 (+https://github.com/qwest65/culture-guide-web)"
# Узлы на изгибах улиц, отстоящие от прямой меньше чем на столько метров, выбрасываются: файл меньше.
SIMPLIFY_M = 2.0

# «Цена» улицы — во сколько раз путь по ней дороже его длины. Главные улицы — ×1;
# жилые улицы и переулки дороже: путь по ним выбирается, только если в обход заметно длиннее.
MAIN_ROADS = {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"}
MINOR_ROADS = {"residential": 1.6, "unclassified": 1.8, "living_street": 1.8, "road": 1.8}
# С тротуаром вдоль (sidewalk=both/left/right) жилая улица почти как главная.
SIDEWALK_ROAD = 1.2
# Грунт, гравий, щебёнка и т. п. — ещё дороже, во столько раз.
UNPAVED = {"unpaved", "ground", "dirt", "earth", "mud", "sand", "grass", "gravel", "fine_gravel",
           "compacted", "pebblestone", "rock", "grass_paver", "woodchips"}
UNPAVED_FACTOR = 1.5
OPEN_SPACE = {("leisure", "park"), ("leisure", "garden"), ("place", "square"), ("landuse", "recreation_ground")}

EARTH = 6_371_008.8

# Конец ручной дорожки ближе MANUAL_MERGE_M к узлу сети совпадает с этим узлом (без «хвостиков»
# на перекрёстке), ближе MANUAL_LINK_M — соединяется с ним коротким отрезком.
MANUAL_MERGE_M = 15.0
MANUAL_LINK_M = 40.0

# --- Геометрия ---------------------------------------------------------------------------


def dist(a, b):
    """Расстояние между (lat, lon), м."""
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH * math.asin(math.sqrt(min(1.0, h)))


def project(p, a, b):
    """Ближайшая к p точка отрезка ab: (t в 0..1, расстояние, м)."""
    kx = 111_320.0 * math.cos(math.radians(a[0]))
    ky = 111_320.0
    bx, by = (b[1] - a[1]) * kx, (b[0] - a[0]) * ky
    px, py = (p[1] - a[1]) * kx, (p[0] - a[0]) * ky
    l2 = bx * bx + by * by
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, (px * bx + py * by) / l2))
    return t, math.hypot(px - t * bx, py - t * by)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def inside(p, ring):
    """Точка (lat, lon) внутри многоугольника [(lat, lon), ...]."""
    y, x = p
    hit = False
    for i in range(len(ring)):
        y1, x1 = ring[i - 1]
        y2, x2 = ring[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


# --- OpenStreetMap -----------------------------------------------------------------------


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in OVERPASS:
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(request, timeout=300) as response:
                    return json.load(response)
            except (OSError, ValueError) as error:
                last = error
                print(f"  {url}: {error}, повтор")
                time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Overpass недоступен: {last}")


def walk_factor(tags, in_open_space):
    """Во сколько раз путь по дороге «дороже» его длины; None — по ней не ходим."""
    hw = tags.get("highway")
    foot = tags.get("foot")
    if foot == "no" or tags.get("area") == "yes" and hw != "pedestrian":
        return None
    if tags.get("access") in ("private", "no") and foot not in ("yes", "designated", "permissive"):
        return None
    factor = base_factor(tags, hw, foot, in_open_space)
    if factor is not None and tags.get("surface") in UNPAVED:
        factor *= UNPAVED_FACTOR
    return factor


def base_factor(tags, hw, foot, in_open_space):
    if hw in MAIN_ROADS or hw == "pedestrian":
        return 1.0
    if hw in MINOR_ROADS:
        sidewalk = tags.get("sidewalk") in ("both", "left", "right", "yes", "separate") or any(
            tags.get(f"sidewalk:{side}") in ("yes", "separate") for side in ("both", "left", "right"))
        return min(SIDEWALK_ROAD, MINOR_ROADS[hw]) if sidewalk else MINOR_ROADS[hw]
    if hw == "footway":
        if tags.get("footway") in ("sidewalk", "crossing") or tags.get("name"):
            return 1.0
        # Безымянная дорожка — это либо сквер, либо двор. В скверах ходим, во дворы — нет.
        return 1.1 if in_open_space else None
    if hw == "steps":
        return 1.5 if in_open_space or tags.get("name") else None
    if hw in ("path", "cycleway") and in_open_space and foot in (None, "yes", "designated"):
        return 1.2
    # service (проезды во дворы, парковки), track, path вне скверов и прочее — не для прогулки.
    return None


def load_streets(south, west, north, east, walk_areas):
    bbox = f"{south},{west},{north},{east}"
    ways = overpass(f'[out:json][timeout:240][maxsize:536870912];way["highway"]({bbox});(._;>;);out body;')
    areas = overpass(
        f"[out:json][timeout:240];("
        f'way["leisure"~"^(park|garden)$"]({bbox});way["place"="square"]({bbox});'
        f'way["landuse"="recreation_ground"]({bbox});way["highway"="pedestrian"]["area"="yes"]({bbox});'
        f'relation["leisure"~"^(park|garden)$"]({bbox});relation["place"="square"]({bbox});'
        f");out geom;"
    )
    rings = []
    for el in areas["elements"]:
        if el["type"] == "way" and el.get("geometry"):
            rings.append([(g["lat"], g["lon"]) for g in el["geometry"]])
        elif el["type"] == "relation":
            outer = [(g["lat"], g["lon"]) for m in el.get("members", []) if m.get("role") == "outer"
                     for g in m.get("geometry", [])]
            if len(outer) >= 3:
                rings.append(outer)
    rings += walk_areas
    print(f"скверов и площадей: {len(rings)} (из них вручную: {len(walk_areas)})")

    nodes = {el["id"]: (el["lat"], el["lon"]) for el in ways["elements"] if el["type"] == "node"}
    kept, dropped = [], []
    for el in ways["elements"]:
        if el["type"] != "way":
            continue
        pts = [nodes[n] for n in el["nodes"] if n in nodes]
        if len(pts) < 2:
            continue
        mid = pts[len(pts) // 2]
        factor = walk_factor(el.get("tags", {}), any(inside(mid, r) for r in rings))
        (kept if factor else dropped).append((el["nodes"], factor, pts))
    print(f"дорог и дорожек: {len(kept)} берём, {len(dropped)} отброшено")
    return nodes, kept, dropped


# --- Граф и поиск пути -------------------------------------------------------------------


class Graph:
    def __init__(self, coords, edges):
        self.coords = coords  # [(lat, lon)]
        self.edges = edges  # [(a, b, factor)]
        self.adj = [[] for _ in coords]
        for i, (a, b, f) in enumerate(edges):
            length = dist(coords[a], coords[b])
            self.adj[a].append((b, length * f))
            self.adj[b].append((a, length * f))

    @staticmethod
    def build(nodes, kept, manual=()):
        index, coords, edges = {}, [], []

        def node(osm_id):
            if osm_id not in index:
                index[osm_id] = len(coords)
                coords.append(nodes[osm_id])
            return index[osm_id]

        seen = set()
        for osm_nodes, factor, _ in kept:
            ids = [n for n in osm_nodes if n in nodes]
            for u, v in zip(ids, ids[1:]):
                if u == v:
                    continue
                a, b = node(u), node(v)
                key = (min(a, b), max(a, b))
                if key in seen:
                    continue
                seen.add(key)
                edges.append((a, b, factor))
        osm_count = len(coords)
        # Ручные дорожки: свои узлы, концы и совпадающие точки соединяются.
        manual_nodes = {}
        for line in manual:
            ids = []
            for k, pt in enumerate(line):
                key = (round(pt[0], 6), round(pt[1], 6))
                if key not in manual_nodes:
                    near = min(range(osm_count), key=lambda n: dist(coords[n], pt)) if osm_count else None
                    if k in (0, len(line) - 1) and near is not None and dist(coords[near], pt) <= MANUAL_MERGE_M:
                        manual_nodes[key] = near
                    else:
                        manual_nodes[key] = len(coords)
                        coords.append(pt)
                ids.append(manual_nodes[key])
            for a, b in zip(ids, ids[1:]):
                if a != b:
                    edges.append((a, b, 1.0))
            for end in (ids[0], ids[-1]):
                if end < osm_count:
                    continue
                near = min(range(osm_count), key=lambda n: dist(coords[n], coords[end]))
                if dist(coords[near], coords[end]) <= MANUAL_LINK_M:
                    edges.append((end, near, 1.0))
        graph = Graph(coords, edges)
        return graph.largest_component()

    def largest_component(self):
        """Только самая большая связная часть: из неё до любой точки можно дойти."""
        comp = [-1] * len(self.coords)
        sizes = []
        for start in range(len(self.coords)):
            if comp[start] != -1:
                continue
            c, stack, size = len(sizes), [start], 0
            comp[start] = c
            while stack:
                u = stack.pop()
                size += 1
                for v, _ in self.adj[u]:
                    if comp[v] == -1:
                        comp[v] = c
                        stack.append(v)
            sizes.append(size)
        best = max(range(len(sizes)), key=sizes.__getitem__)
        remap, coords = {}, []
        for i, c in enumerate(comp):
            if c == best:
                remap[i] = len(coords)
                coords.append(self.coords[i])
        edges = [(remap[a], remap[b], f) for a, b, f in self.edges if comp[a] == best]
        print(f"граф: {len(coords)} узлов, {len(edges)} отрезков (отброшено {len(self.coords) - len(coords)} несвязанных узлов)")
        return Graph(coords, edges)

    def simplified(self, tolerance):
        """Тот же граф без лишних узлов на изгибах: перекрёстки и смена «цены» сохраняются,
        промежуточные точки улицы — только там, где без них линия ушла бы больше tolerance метров."""
        edge_of = {}
        for a, b, f in self.edges:
            edge_of[(a, b)] = edge_of[(b, a)] = f
        nbrs = [[] for _ in self.coords]
        for a, b, _ in self.edges:
            nbrs[a].append(b)
            nbrs[b].append(a)

        def joint(n):
            return len(nbrs[n]) != 2 or edge_of[(n, nbrs[n][0])] != edge_of[(n, nbrs[n][1])]

        done, out = set(), []

        def walk(start, nxt):
            chain = [start, nxt]
            done.add((min(start, nxt), max(start, nxt)))
            while not joint(chain[-1]) and chain[-1] != start:
                u, v = chain[-2], chain[-1]
                w = nbrs[v][0] if nbrs[v][0] != u else nbrs[v][1]
                done.add((min(v, w), max(v, w)))
                chain.append(w)
            keep = rdp(chain, self.coords, tolerance)
            f = edge_of[(chain[0], chain[1])]
            out.extend((a, b, f) for a, b in zip(keep, keep[1:]) if a != b)

        for n in range(len(self.coords)):
            if joint(n):
                for m in nbrs[n]:
                    if (min(n, m), max(n, m)) not in done:
                        walk(n, m)
        for a, b, _ in self.edges:  # кольца без перекрёстков
            if (min(a, b), max(a, b)) not in done:
                walk(a, b)
        used = sorted({n for a, b, _ in out for n in (a, b)})
        remap = {n: i for i, n in enumerate(used)}
        return Graph([self.coords[n] for n in used], [(remap[a], remap[b], f) for a, b, f in out])

    def snap(self, p):
        """Ближайшая точка сети дорожек: (ребро, t, точка, расстояние)."""
        best = None
        for i, (a, b, _) in enumerate(self.edges):
            t, d = project(p, self.coords[a], self.coords[b])
            if best is None or d < best[3]:
                best = (i, t, lerp(self.coords[a], self.coords[b], t), d)
        return best

    def route(self, p, q):
        """Путь по сети от p до q: список (lat, lon), начинается в p и кончается в q."""
        es, ts, sp, _ = self.snap(p)
        et, tt, tp, _ = self.snap(q)
        a, b, f = self.edges[es]
        c, d, g = self.edges[et]
        if es == et:
            line = [sp, tp]
        else:
            la = dist(self.coords[a], self.coords[b]) * f
            lc = dist(self.coords[c], self.coords[d]) * g
            costs = {c: tt * lc, d: (1 - tt) * lc}
            best = [math.inf] * len(self.coords)
            prev = [-1] * len(self.coords)
            heap = []
            for n, cost in ((a, ts * la), (b, (1 - ts) * la)):
                if cost < best[n]:
                    best[n] = cost
                    heapq.heappush(heap, (cost, n))
            while heap:
                cost, u = heapq.heappop(heap)
                if cost > best[u]:
                    continue
                for v, w in self.adj[u]:
                    if cost + w < best[v]:
                        best[v] = cost + w
                        prev[v] = u
                        heapq.heappush(heap, (cost + w, v))
            end = min(costs, key=lambda n: best[n] + costs[n])
            chain = []
            n = end
            while n != -1:
                chain.append(self.coords[n])
                n = prev[n]
            line = [sp] + chain[::-1] + [tp]
        out = [p]
        for pt in line + [q]:
            if dist(out[-1], pt) > 0.5:
                out.append(pt)
        return despike(out)


def rdp(chain, coords, tolerance):
    """Рамер — Дуглас — Пекер: узлы цепочки, без которых линия отходит больше чем на tolerance м."""
    if len(chain) < 3:
        return list(chain)
    a, b = coords[chain[0]], coords[chain[-1]]
    worst, at = 0.0, 0
    for k in range(1, len(chain) - 1):
        d = project(coords[chain[k]], a, b)[1]
        if d > worst:
            worst, at = d, k
    if worst <= tolerance:
        return [chain[0], chain[-1]]
    return rdp(chain[:at + 1], coords, tolerance)[:-1] + rdp(chain[at:], coords, tolerance)


def despike(points):
    """Убирает «хвостики»: короткий заход в сторону и возврат по той же линии."""
    pts = list(points)
    changed = True
    while changed and len(pts) > 2:
        changed = False
        for i in range(1, len(pts) - 1):
            a, b, c = pts[i - 1], pts[i], pts[i + 1]
            there, back = dist(a, b), dist(b, c)
            if min(there, back) < 25 and dist(a, c) < 0.3 * (there + back):
                del pts[i]
                changed = True
                break
    return pts


def length(points):
    return sum(dist(points[i - 1], points[i]) for i in range(1, len(points)))


def render(city_name, kept, dropped, places, walk_areas, manual_paths, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    pts = [(p["location"]["lat"], p["location"]["lon"]) for p in places]
    lat0 = sum(p[0] for p in pts) / len(pts)
    kx = math.cos(math.radians(lat0))
    s_, n_ = min(p[0] for p in pts) - 0.004, max(p[0] for p in pts) + 0.004
    w_, e_ = min(p[1] for p in pts) - 0.007, max(p[1] for p in pts) + 0.007
    near = lambda line: any(s_ <= p[0] <= n_ and w_ <= p[1] <= e_ for p in line)  # noqa: E731
    fig, ax = plt.subplots(figsize=(14, 18), dpi=120)
    ax.set_facecolor("#f6f1e7")
    for _, _, line in dropped:
        if near(line):
            ax.plot([p[1] * kx for p in line], [p[0] for p in line], color="#e8a0a0", lw=0.8, ls=(0, (2, 2)), zorder=1)
    for ring in walk_areas:
        ax.fill([p[1] * kx for p in ring], [p[0] for p in ring], color="#7cc84a", alpha=0.25, zorder=0)
    for _, factor, line in kept:
        if not near(line):
            continue
        color, lw = ("#5f5f5f", 1.9) if factor <= 1.05 else ("#9a9a9a", 1.4) if factor <= 1.25 else ("#cdbfae", 1.1)
        ax.plot([p[1] * kx for p in line], [p[0] for p in line], color=color, lw=lw, zorder=2)
    for line in manual_paths:
        ax.plot([p[1] * kx for p in line], [p[0] for p in line], color="#2e9e4f", lw=2.2, zorder=2)
    for p in places:
        lat, lon = p["location"]["lat"], p["location"]["lon"]
        ax.plot(lon * kx, lat, "o", ms=10, color="#2f6fb5", mec="white", mew=2, zorder=7)
        ax.text(lon * kx + 0.00012, lat + 0.00008, p["name"], fontsize=8, zorder=8,
                bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="none", alpha=0.85))
    ax.set_xlim(w_ * kx, e_ * kx)
    ax.set_ylim(s_, n_)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title(f"{city_name}: тёмное — главные улицы и тротуары, серое — жилые с тротуаром, бежевое — переулки и грунтовки;\n"
                 "розовый пунктир — отброшенные дворы и тропинки; зелёное — скверы и дорожки, проложенные вручную", fontsize=12)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(out)
    print(f"картинка: {out.relative_to(REPO)}")


def main(city_id):
    folder = REPO / "content/cities" / city_id
    city = json.loads((folder / "city.json").read_text(encoding="utf-8"))
    places = [p for p in json.loads((folder / "places.json").read_text(encoding="utf-8"))["places"] if p["status"] != "draft"]
    walking_path = folder / "walking.json"
    walking = json.loads(walking_path.read_text(encoding="utf-8")) if walking_path.exists() else {}
    walk_areas = [[tuple(p) for p in ring] for ring in walking.get("walk_areas", {}).values()]
    manual_paths = [[tuple(p) for p in line] for line in walking.get("manual_paths", {}).values()]

    b = city["bbox"]
    nodes, kept, dropped = load_streets(b["south"], b["west"], b["north"], b["east"], walk_areas)
    graph = Graph.build(nodes, kept, manual_paths)

    far = []
    for p in places:
        at = p.get("listen_at") or p["location"]
        _, _, point, d = graph.snap((at["lat"], at["lon"]))
        print(f"«{p['name']}»: до улицы {d:.0f} м")
        if d > 150:
            far.append(p["name"])
    if far:
        print("::warning::Дальше 150 м от улиц (к ним путь не построится): " + ", ".join(far))

    small = graph.simplified(SIMPLIFY_M)
    print(f"для телефона: {len(small.coords)} узлов, {len(small.edges)} отрезков")
    out = folder / "streets.json"
    out.write_text(json.dumps({
        "source": "© участники OpenStreetMap (ODbL)",
        # Узлы подряд: широта, долгота; отрезки подряд: узел, узел, «цена» ×100.
        "nodes": [round(v, 5) for c in small.coords for v in c],
        "edges": [v for a, b_, f in small.edges for v in (a, b_, round(f * 100))],
    }, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"записано: {out.relative_to(REPO)} ({out.stat().st_size // 1024} КБ)")
    render(city["name"], kept, dropped, places, walk_areas, manual_paths, REPO / f"tools/preview/{city_id}-streets.png")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Укажите город: python3 tools/build_streets.py troitsk")
    main(sys.argv[1])
