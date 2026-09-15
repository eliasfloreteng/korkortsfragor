#!/usr/bin/env -S uv run --script
"""Merge the raw question dumps in sources/ into one unified dataset.

Reads:
  sources/ikorkort/questions.json   scrape of ikorkort.nu's free question bank
  sources/takorkort/questions.json  export of the Ta Körkort app exam database

Writes:
  site/data/questions.json          the unified bank the website loads

Unified record:
  {
    "id":          "ikorkort-1",          source-prefixed, stable
    "source":      "ikorkort",
    "category":    "Miljö",               one of CATEGORIES
    "tags":        ["sparsam-korning"],   topic slugs, ikorkort only
    "question":    "Vilket ...?",
    "options":     ["...", "...."],       shuffled, never answer-first
    "answer":      2,                     index into options
    "image":       "images/bil36_b.jpg",  relative to site/media/, or null
    "video":       null,                  "videos/<name>.mp4", or null
    "explanation": ["paragraph", ...]
  }
"""
import json, os, random, re, unicodedata

ROOT = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(ROOT, "site", "media")
OUT = os.path.join(ROOT, "site", "data", "questions.json")

# ikorkort:s åtta kategorier utgör indelningen. "Blandat" tar allt från Ta
# Körkort vars kapitel ("Quiz", "Trafikregler", ...) saknar motsvarighet.
CATEGORIES = ["Bilen", "Stadskörning", "Landsvägskörning", "Olyckor",
              "Mörker & Halka", "Människan", "Miljö", "Vägmärken", "Blandat"]
CHAPTER_MAP = {
    "Fordonskännedom": "Bilen",
    "Personliga förutsättningar": "Människan",
    "Miljö": "Miljö",
}


def norm(s):
    """Fingeravtryck för dubblettjakt: strunt i skiftläge, tecken och blanksteg."""
    s = unicodedata.normalize("NFC", s or "").lower()
    return re.sub(r"[^0-9a-zåäöéü]+", "", s)


def image_path(key):
    for ext in (".jpg", ".png"):
        if os.path.exists(os.path.join(MEDIA, "images", key + ext)):
            return "images/" + key + ext
    return None


def load_ikorkort():
    src = json.load(open(f"{ROOT}/sources/ikorkort/questions.json"))
    for q in src:
        # Skrapningen behåller sidans ordning, där options[0] alltid är det
        # rätta svaret; correct_index säger samma sak uttryckligen.
        yield {
            "id": f"ikorkort-{q['id']}",
            "source": "ikorkort",
            "category": q["category"],
            "tags": q["tags"],
            "question": q["question"].strip(),
            "options": list(q["options"]),
            "answer": q["correct_index"],
            "image": image_path(q["image"]) if q["image"] else None,
            "video": f"videos/{q['video']}.mp4" if q["video"] else None,
            "explanation": [p.strip() for p in q["explanation_text"].split("\n") if p.strip()],
        }


def load_takorkort():
    src = json.load(open(f"{ROOT}/sources/takorkort/questions.json"))
    for q in src:
        # Videofrågorna pekar på Vimeo-id:n som inte går att spela upp, vilket
        # gör frågan obesvarbar — de plockas bort.
        if q["type"] == "Video" or not q["correct"]:
            continue
        options = [a["text"] for a in q["answers"] if a["text"]]
        correct = [a["text"] for a in q["answers"] if a["correct"] and a["text"]]
        if len(options) < 2 or len(correct) != 1:
            continue
        image = None
        if q["image"]:
            name = q["image"].rsplit("/", 1)[-1].split("?")[0]
            if os.path.exists(os.path.join(MEDIA, "images", name)):
                image = "images/" + name
        yield {
            "id": f"takorkort-{q['id']}",
            "source": "takorkort",
            "category": CHAPTER_MAP.get(q["chapter"], "Blandat"),
            "tags": [],
            "question": q["question"].strip(),
            "options": options,
            "answer": options.index(correct[0]),
            "image": image,
            "video": None,
            "explanation": [p.strip() for p in q["explanation"] if p.strip()],
        }


def main():
    rng = random.Random(20260915)  # samma blandning varje bygge
    seen, out, dropped = {}, [], 0
    # ikorkort först: vid krock är det den posten som är värd att behålla
    # (fylligare förklaringar, egen media).
    for q in list(load_ikorkort()) + list(load_takorkort()):
        key = (norm(q["question"]),
               tuple(sorted(norm(o) for o in q["options"])),
               norm(q["options"][q["answer"]]),
               q["image"] or "", q["video"] or "")
        if key in seen:
            dropped += 1
            continue
        seen[key] = True
        order = list(range(len(q["options"])))
        rng.shuffle(order)
        q["options"] = [q["options"][i] for i in order]
        q["answer"] = order.index(q["answer"])
        out.append(q)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    by_cat = {c: sum(1 for q in out if q["category"] == c) for c in CATEGORIES}
    by_src = {s: sum(1 for q in out if q["source"] == s) for s in ("ikorkort", "takorkort")}
    print(f"{len(out)} frågor ({dropped} dubbletter bortplockade) -> {OUT}")
    print(f"  {os.path.getsize(OUT) / 1e6:.1f} MB")
    print(f"  källor:     {by_src}")
    print(f"  kategorier: {by_cat}")
    print(f"  media:      {sum(1 for q in out if q['image'])} med bild, "
          f"{sum(1 for q in out if q['video'])} med video")
    unknown = {q["category"] for q in out} - set(CATEGORIES)
    assert not unknown, f"omappade kategorier: {unknown}"
    assert all(q["explanation"] for q in out), "fråga utan förklaring"


if __name__ == "__main__":
    main()
