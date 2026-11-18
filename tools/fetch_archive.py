#!/usr/bin/env python3
"""Старые фото мест города из открытых источников — для «Окна в прошлое» (было/стало).

Источники:
- Викисклад (commons.wikimedia.org): свободные лицензии и общественное достояние, автор и лицензия
  в метаданных. Ищем по категории города (вглубь), поиском по названиям и по геометке у каждого места;
  оставляем снимки до 1960 года (по дате съёмки, категориям или названию).
- PastVu (pastvu.com): архив старых фото с привязкой к карте — ближайшие к каждому месту снимки
  1840–1960 годов. Лицензию у каждого снимка нужно смотреть на его странице.

Пишет archive-candidates/<город>/: превью, candidates.json и контактные листы (sheet-*.jpg)
для просмотра глазами. В сайт ничего не попадает: выбранные снимки редактор переносит
в public/photos/<город>/ и в поле then_now объекта.

    pip install pillow
    python3 tools/fetch_archive.py troitsk

Запускается в GitHub Actions (.github/workflows/archive.yml).
"""
import html
import json
import math
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]
COMMONS = "https://commons.wikimedia.org/w/api.php"
PASTVU = "https://pastvu.com/api2"
USER_AGENT = "CultureGuide-build/1.0 (+https://github.com/qwest65/culture-guide-web)"
WIDTH = 1280
MAX_YEAR = 1960
GEO_RADIUS_M = 400
PASTVU_RADIUS_M = 500


def get(url, data=None, attempts=4):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if attempt == attempts - 1:
                raise
            print(f"  повтор {url[:90]}: {e}")
            time.sleep(2 ** attempt)


def commons(**params):
    params.update(format="json", formatversion="2")
    return json.loads(get(f"{COMMONS}?{urllib.parse.urlencode(params)}"))


def plain(text):
    return html.unescape(re.sub(r"<[^>]+>", "", text or "")).strip()


def year_of(*texts):
    """Самый ранний правдоподобный год в текстах (1840–2030) или None."""
    years = [int(y) for t in texts for y in re.findall(r"(?<!\d)(1[89]\d\d|20[0-3]\d)(?!\d)", t or "")]
    years = [y for y in years if 1840 <= y <= 2030]
    return min(years) if years else None


# --- Викисклад ------------------------------------------------------------------------------

def category_files(root, depth=3):
    seen_cats, files, queue = set(), set(), [(root, 0)]
    while queue:
        cat, d = queue.pop()
        if cat in seen_cats:
            continue
        seen_cats.add(cat)
        cont = {}
        while True:
            r = commons(action="query", list="categorymembers", cmtitle=cat, cmlimit=500, cmtype="file|subcat", **cont)
            for m in r.get("query", {}).get("categorymembers", []):
                if m["ns"] == 6:
                    files.add(m["title"])
                elif m["ns"] == 14 and d < depth:
                    queue.append((m["title"], d + 1))
            if "continue" not in r:
                break
            cont = r["continue"]
    print(f"категорий: {len(seen_cats)}, файлов: {len(files)}")
    return files


def search_files(query, limit=50):
    r = commons(action="query", list="search", srnamespace=6, srlimit=limit, srsearch=query)
    return {s["title"] for s in r.get("query", {}).get("search", [])}


def geo_files(lat, lon):
    r = commons(action="query", list="geosearch", gscoord=f"{lat}|{lon}", gsradius=GEO_RADIUS_M, gsnamespace=6, gslimit=100)
    return {g["title"] for g in r.get("query", {}).get("geosearch", [])}


def commons_info(titles):
    out = []
    titles = sorted(titles)
    for i in range(0, len(titles), 40):
        r = commons(action="query", titles="|".join(titles[i:i + 40]), prop="imageinfo|categories|coordinates",
                    iiprop="url|extmetadata|size|mime", iiurlwidth=WIDTH, cllimit=500)
        for page in r.get("query", {}).get("pages", []):
            info = (page.get("imageinfo") or [{}])[0]
            if info.get("mime") not in ("image/jpeg", "image/png", "image/tiff"):
                continue
            meta = info.get("extmetadata", {})
            cats = [c["title"].replace("Category:", "") for c in page.get("categories", [])]
            date = plain(meta.get("DateTimeOriginal", {}).get("value"))
            desc = plain(meta.get("ImageDescription", {}).get("value"))
            year = year_of(date) or year_of(page["title"], " ".join(cats), desc)
            coord = (page.get("coordinates") or [{}])[0]
            out.append({
                "source": "commons",
                "title": page["title"],
                "page": info.get("descriptionurl"),
                "thumb": info.get("thumburl"),
                "author": plain(meta.get("Artist", {}).get("value"))[:200] or "автор не указан",
                "license": plain(meta.get("LicenseShortName", {}).get("value")) or "?",
                "year": year,
                "date": date[:40],
                "description": desc[:300],
                "categories": cats[:20],
                "lat": coord.get("lat"),
                "lon": coord.get("lon"),
                "size": [info.get("width"), info.get("height")],
            })
    return out


# --- PastVu ---------------------------------------------------------------------------------

def pastvu_nearest(lat, lon):
    params = json.dumps({"geo": [lat, lon], "limit": 30, "distance": PASTVU_RADIUS_M, "year": 1840, "year2": MAX_YEAR})
    try:
        r = json.loads(get(f"{PASTVU}?{urllib.parse.urlencode({'method': 'photo.giveNearestPhotos', 'params': params})}"))
    except Exception as e:  # noqa: BLE001
        print(f"  PastVu недоступен: {e}")
        return []
    out = []
    for p in (r.get("result") or {}).get("photos", []):
        geo = p.get("geo") or [None, None]
        out.append({
            "source": "pastvu",
            "title": p.get("title", ""),
            "page": f"https://pastvu.com/p/{p['cid']}",
            "thumb": f"https://pastvu.com/_p/a/{p['file']}",
            "author": "см. страницу снимка",
            "license": "проверить на странице снимка",
            "year": p.get("year"),
            "date": f"{p.get('year')}–{p.get('year2')}" if p.get("year2") != p.get("year") else str(p.get("year")),
            "description": "",
            "lat": geo[0],
            "lon": geo[1],
            "cid": p["cid"],
        })
    return out


# --- Общее ----------------------------------------------------------------------------------

def dist_m(a_lat, a_lon, b_lat, b_lon):
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(min(1.0, h)))


def sheet(items, out, label):
    from PIL import Image, ImageDraw

    if not items:
        return
    W, H, cols = 320, 260, 4
    rows = (len(items) + cols - 1) // cols
    img = Image.new("RGB", (W * cols, H * rows), "white")
    d = ImageDraw.Draw(img)
    for i, c in enumerate(items):
        x, y = (i % cols) * W, (i // cols) * H
        try:
            t = Image.open(out.parent / c["file"]).convert("RGB")
            t.thumbnail((W - 8, H - 44))
            img.paste(t, (x + 4, y + 4))
        except Exception:  # noqa: BLE001
            pass
        d.text((x + 4, y + H - 38), f"{c['id']}  {c.get('year') or '?'}  {c['source']}", fill="black")
        d.text((x + 4, y + H - 22), (c["title"] or "")[5 if c["source"] == "commons" else 0:][:48], fill="black")
    img.save(out, quality=82)
    print(f"{label}: {out.name} ({len(items)})")


def main(city_id):
    folder = REPO / "content/cities" / city_id
    city = json.loads((folder / "city.json").read_text(encoding="utf-8"))
    places = [p for p in json.loads((folder / "places.json").read_text(encoding="utf-8"))["places"] if p["status"] != "draft"]
    out_dir = REPO / "archive-candidates" / city_id
    (out_dir / "img").mkdir(parents=True, exist_ok=True)
    name = city["name"]

    # Викисклад: всё старое по городу
    titles = set()
    for cat in (f"Category:{name}, Chelyabinsk Oblast", "Category:Troitsk, Chelyabinsk Oblast",
                "Category:History of Troitsk, Chelyabinsk Oblast"):
        try:
            titles |= category_files(cat)
        except Exception as e:  # noqa: BLE001
            print(f"  {cat}: {e}")
    for q in (f"{name} Оренбургской губернии", f"{name} открытка", f"{name} старый", "Troitsk Orenburg Governorate",
              "Troitsk postcard", f"{name} 1910", f"{name} Прокудин-Горский", "Troitsk Prokudin-Gorsky"):
        titles |= search_files(q)
    for p in places:
        at = p["location"]
        titles |= geo_files(at["lat"], at["lon"])
        titles |= search_files(f'{p["name"]} {name}', limit=20)
    print(f"Викисклад: всего файлов-кандидатов {len(titles)}")
    found = [c for c in commons_info(titles) if c["year"] and c["year"] <= MAX_YEAR]
    print(f"Викисклад: старых (до {MAX_YEAR}) — {len(found)}")

    # PastVu: ближайшие к каждому месту
    seen = set()
    for p in places:
        for c in pastvu_nearest(p["location"]["lat"], p["location"]["lon"]):
            if c["cid"] not in seen:
                seen.add(c["cid"])
                found.append(c)
    print(f"Всего с PastVu: {len(found)}")

    # Превью, ближайшее место
    result = []
    for n, c in enumerate(found, start=1):
        c["id"] = f"{c['source'][0]}{n:03d}"
        c["file"] = f"img/{c['id']}.jpg"
        try:
            (out_dir / c["file"]).write_bytes(get(c["thumb"]))
        except Exception as e:  # noqa: BLE001
            print(f"  не скачалось {c['id']}: {e}")
            continue
        if c.get("lat") is not None:
            near = min(places, key=lambda p: dist_m(c["lat"], c["lon"], p["location"]["lat"], p["location"]["lon"]))
            c["near_place"] = near["id"]
            c["near_m"] = round(dist_m(c["lat"], c["lon"], near["location"]["lat"], near["location"]["lon"]))
        result.append(c)

    (out_dir / "candidates.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for i in range(0, len(result), 24):
        sheet(result[i:i + 24], out_dir / f"sheet-{i // 24 + 1:02d}.jpg", "лист")
    print(f"Готово: {len(result)} снимков в {out_dir.relative_to(REPO)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Укажите город: python3 tools/fetch_archive.py troitsk")
    main(sys.argv[1])
