#!/usr/bin/env -S uv run --script
"""Hämta bilderna och videoklippen som frågorna hänvisar till.

Media ligger inte i git (drygt 750 MB och upphovsrättsskyddat material), så
det här skriptet fyller på site/media/ från källornas ursprungliga URL:er.
Redan hämtade filer hoppas över, så det går att köra om.

    ./fetch_media.py            # bilder och videoklipp
    ./fetch_media.py --bilder   # hoppa över de 561 MB videoklipp
"""
import json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.abspath(__file__))
IMAGES = os.path.join(ROOT, "site", "media", "images")
VIDEOS = os.path.join(ROOT, "site", "media", "videos")
UA = {"User-Agent": "Mozilla/5.0"}          # ikorkort.nu svarar 406 utan


def targets():
    """(filnamn utan ändelse, [url, reserv-url ...]) för allt media som används.

    ikorkort listar flera URL:er per bild — en @2x-jpg och en png — som är
    alternativ till varandra. Ändelsen på den URL som svarar avgör filnamnet.
    """
    jobs = {}
    for q in json.load(open(f"{ROOT}/sources/ikorkort/questions.json")):
        if q["image"]:
            jobs.setdefault(os.path.join(IMAGES, q["image"]), []).extend(q["image_urls"])
        if q["video"]:
            jobs.setdefault(os.path.join(VIDEOS, q["video"]), []) \
                .append(q["video_urls"]["medium"])
    for q in json.load(open(f"{ROOT}/sources/takorkort/questions.json")):
        if q.get("image"):
            name = q["image"].rsplit("/", 1)[-1].split("?")[0]
            stem, _ = os.path.splitext(name)
            jobs.setdefault(os.path.join(IMAGES, stem), []).append(q["image"])
    return jobs


def fetch(job):
    stem, urls = job
    if any(os.path.exists(stem + e) and os.path.getsize(stem + e)
           for e in (".jpg", ".png", ".mp4")):
        return "fanns"
    for url in urls:
        ext = os.path.splitext(url.split("?")[0])[1] or ".jpg"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                data = r.read()
            if data:
                open(stem + ext, "wb").write(data)
                return "hämtad"
        except Exception:
            continue
    print(f"MISSLYCKADES {os.path.basename(stem)}", file=sys.stderr)
    return "fel"


def main():
    only_images = "--bilder" in sys.argv
    os.makedirs(IMAGES, exist_ok=True)
    os.makedirs(VIDEOS, exist_ok=True)
    jobs = [j for j in targets().items()
            if not (only_images and j[0].startswith(VIDEOS))]
    print(f"{len(jobs)} filer att gå igenom")
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(fetch, jobs))
    for outcome in ("hämtad", "fanns", "fel"):
        print(f"  {outcome}: {results.count(outcome)}")


if __name__ == "__main__":
    main()
