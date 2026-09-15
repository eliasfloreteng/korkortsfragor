import sqlite3, json, re, html, os

ROT = os.path.dirname(os.path.abspath(__file__))

db = sqlite3.connect(os.path.join(ROT, 'ExamDatabase.db'))
db.row_factory = sqlite3.Row

def clean(t):
    if not t: return t
    t = re.sub(r'<[^>]+>', '', t)
    return html.unescape(t).strip()

def parse_answers(raw):
    out = []
    if not raw: return out
    for part in raw.split('::'):
        f = part.split(';;')
        if len(f) >= 2:
            out.append({'text': clean(f[0]), 'id': int(f[1]), 'audio': f[2] if len(f) > 2 else None})
    return out

def parse_expl(raw):
    """Explanations are one or more ';;'-separated JSON blocks; text blocks
    carry their paragraphs in 'data', image blocks carry only an id."""
    if not raw: return []
    out = []
    for block in raw.split(';;'):
        try:
            d = json.loads(block)
        except Exception:
            out.append(clean(block))
            continue
        if d.get('type') == 'text':
            out += [clean(x) for x in d.get('data', []) if isinstance(x, str)]
    return [x for x in out if x]

qs = []
for r in db.execute("SELECT * FROM ExamQuestion ORDER BY id"):
    answers = parse_answers(r['answers'])
    correct_ids = set()
    if r['correctAnswer'] is not None:
        correct_ids.add(r['correctAnswer'])
    if r['correctAnswers']:
        for m in re.findall(r'\d+', r['correctAnswers']):
            correct_ids.add(int(m))
    for a in answers:
        a['correct'] = a['id'] in correct_ids
    qs.append({
        'id': r['id'],
        'type': r['questionType'],
        'chapter': r['chapterName'],
        'question': clean(r['questionText']),
        'answers': answers,
        'correct': [a['text'] for a in answers if a['correct']],
        'explanation': parse_expl(r['explanation']),
        'image': r['image_url'],
        'video_id': r['video_id'],
    })

json.dump(qs, open(os.path.join(ROT, 'questions.json'), 'w'), ensure_ascii=False, indent=2)

nc = sum(1 for q in qs if not q['correct'])
print(f"exported {len(qs)} questions; {nc} without a marked correct answer")
print(f"answer counts: {sorted(set(len(q['answers']) for q in qs))}")
