# Körkortsfrågor — ikorkort.nu question bank

Complete dump of the free practice-test question bank behind
<https://www.ikorkort.nu/prov.php> (Swedish driving-licence theory test).

Downloaded 2026-09-15. **1435 questions**, IDs 1–1435 with no gaps.

## Files

| File | Description |
|---|---|
| `questions.json` | All 1435 questions, pretty-printed array. Primary file. |
| `questions.jsonl` | Same data, one JSON object per line (for streaming / `jq`). |
| `questions.csv` | Flattened spreadsheet view. Options in separate columns, plain-text explanation. |
| `images/` | 1173 images (`.jpg` / `.png`), named by the `image` field. 118 MB. |
| `videos/` | 55 clips (`.mp4`, medium resolution), named by the `video` field. 561 MB. |

## Record shape

```json
{
  "id": 1,
  "question": "Vilket av följande påståenden om sparsam körning är korrekt?",
  "options": ["...", "...", "...", "..."],
  "correct_answer": "I uppförsbackar ska jag försöka hålla ett så jämnt gaspådrag som möjligt",
  "correct_index": 0,
  "category": "Miljö",
  "category_id": 7,
  "tags": ["sparsam-korning"],
  "is_picture_question": false,
  "is_video_question": false,
  "image": "bil36_b",
  "image_urls": ["https://www.ikorkort.nu/images/quiz_images/bil36_b@2x.jpg?v2", "..."],
  "video": null,
  "video_urls": null,
  "explanation_text": "...",
  "explanation_html": "<div class=\"explanation\">...</div>"
}
```

> **Options are stored in their original order, which means `options[0]` is always
> the correct answer.** The site shuffles them client-side at display time
> (`quiz_core.js` reads `option0` as `correctAnswer`). Shuffle them yourself
> before showing them to anyone, or the answer is the first one every time.

Local media for a question is at `images/<image>.jpg` or `images/<image>.png`
(road-sign keys starting with an uppercase letter are PNG), and
`videos/<video>.mp4`.

## Categories

| ID | Category | Questions |
|---:|---|---:|
| 1 | Bilen | 259 |
| 2 | Stadskörning | 285 |
| 3 | Landsvägskörning | 279 |
| 4 | Olyckor | 77 |
| 5 | Mörker & Halka | 106 |
| 6 | Människan | 143 |
| 7 | Miljö | 74 |
| 8 | Vägmärken | 212 |

200 are picture questions (`is_picture_question`), 57 are video questions.
Every question has a non-empty explanation. 50 question texts are shared by
more than one question — those are distinguished by image and answer, not
duplicates.

## How it was collected

`prov.php` loads questions over AJAX. Two endpoints matter:

- `POST /php/free_quiz/create_new_free_quiz.php` — returns a random quiz,
  capped at 25 questions regardless of the `length` parameter.
- `POST /php/free_quiz/create_new_free_question_ids_quiz.php` — returns
  questions for an explicit `questionIDs` JSON array, **uncapped**.

The second was walked over ID ranges in batches of 100 to enumerate the bank.
IDs 1–1435 all resolve; 1436 and above return `null`, as do probes at 2000,
3000 and 9000. Both endpoints need a browser `User-Agent` (the server answers
`406` otherwise). All 1173 image and 55 video downloads succeeded with no
failures.

## Caveats

- This is the **free** question pool. Paid membership may expose more.
- Swedish only (`language=sv`); the site also serves `language=en`.
- Content is ikorkort.nu's copyrighted material — fine for personal study,
  not for redistribution.
