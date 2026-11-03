#!/usr/bin/env python3
"""Кандидаты в фото достопримечательностей с Викисклада (Wikimedia Commons).

Своих фото у проекта нет, поэтому берём снимки со свободной лицензией (CC0, общественное
достояние, CC BY, CC BY-SA) — с автором и лицензией, как требует формат пакета города.

Для каждого объекта города ищем файлы с геометкой в радиусе RADIUS_M от него (geosearch)
и файлы, найденные по названию объекта и города. Скачиваем превью шириной WIDTH пикселей
в photos-candidates/<город>/<объект>/ и пишем candidates.json с автором, лицензией и
ссылкой на страницу файла. Папка candidates в сайт не попадает: редактор просматривает
снимки и переносит выбранные в public/photos/<город>/ и в поле photos объекта.

    python3 tools/fetch_photos.py troitsk

Запускается в GitHub Actions (.github/workflows/photos.yml).
"""
import html
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]
API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "CultureGuide-build/1.0 (+https://github.com/qwest65/culture-guide-web)"
RADIUS_M = 120
PER_PLACE = 8
WIDTH = 1280
FREE = re.compile(r"^(CC0|Public domain|PD|CC BY(-SA)? [0-9.]+|CC BY(-SA)?)", re.IGNORECASE)


def api(**params):
    params.update(format="json", formatversion="2")
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  повтор: {e}")
            time.sleep(2 ** attempt)


def download(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as r:
        path.write_bytes(r.read())


def plain(text):
    """Автор в метаданных — HTML; оставляем текст."""
    return html.unescape(re.sub(r"<[^>]+>", "", text or "")).strip()


def file_info(titles):
    if not titles:
        return []
    data = api(action="query", titles="|".join(titles), prop="imageinfo|coordinates",
               iiprop="url|extmetadata|size|mime", iiurlwidth=WIDTH)
    out = []
    for page in data.get("query", {}).get("pages", []):
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        license_ = plain(meta.get("LicenseShortName", {}).get("value"))
        if info.get("mime") not in ("image/jpeg", "image/png") or not FREE.match(license_ or ""):
            continue
        if info.get("width", 0) < 800:
            continue
        out.append({
            "title": page["title"],
            "page": info.get("descriptionurl"),
            "thumb": info.get("thumburl"),
            "author": plain(meta.get("Artist", {}).get("value")) or "автор не указан",
            "license": license_,
            "license_url": meta.get("LicenseUrl", {}).get("value"),
            "date": plain(meta.get("DateTimeOriginal", {}).get("value"))[:10],
            "description": plain(meta.get("ImageDescription", {}).get("value"))[:300],
            "size": [info.get("width"), info.get("height")],
        })
    return out


def candidates(place, city):
    at = place.get("listen_at") or place["location"]
    geo = api(action="query", list="geosearch", gscoord=f"{at['lat']}|{at['lon']}",
              gsradius=RADIUS_M, gsnamespace=6, gslimit=40)
    titles = [g["title"] for g in geo.get("query", {}).get("geosearch", [])]
    found = api(action="query", list="search", srnamespace=6, srlimit=15,
                srsearch=f"{place['name']} {city['name']}")
    titles += [s["title"] for s in found.get("query", {}).get("search", []) if s["title"] not in titles]
    out = []
    for i in range(0, len(titles), 40):
        out += file_info(titles[i:i + 40])
    return out[: PER_PLACE * 2]


def main(city_id):
    folder = REPO / "content/cities" / city_id
    city = json.loads((folder / "city.json").read_text(encoding="utf-8"))
    places = json.loads((folder / "places.json").read_text(encoding="utf-8"))["places"]
    out_dir = REPO / "photos-candidates" / city_id
    report = {}
    for p in places:
        found = candidates(p, city)[:PER_PLACE]
        target = out_dir / p["id"]
        target.mkdir(parents=True, exist_ok=True)
        for n, c in enumerate(found, start=1):
            c["file"] = f"{p['id']}/{n}.jpg"
            download(c["thumb"], out_dir / c["file"])
        report[p["id"]] = {"name": p["name"], "candidates": found}
        print(f"{p['name']}: {len(found)}")
    (out_dir / "candidates.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Укажите город: python3 tools/fetch_photos.py troitsk")
    main(sys.argv[1])
