"""
Content analysis: title, keywords, subject and topics.

Kept free of web-framework code so it can be unit-tested on its own.
"""
import math
import os
import re
from collections import Counter

from .extractors import extract, resource_type_for
from .taxonomy import CODE_TO_TITLE, MIN_CONFIDENCE, SUBJECTS, TITLE_TO_CODE, UNCATEGORIZED

STOPWORDS = set("""
a about above after again all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers him his how i if
in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should
so some such than that the their theirs them then there these they this those through to too under until up very was we
were what when where which while who whom why will with would you your yours page slide figure table chapter section
et al eg ie etc however therefore thus using use used also may might must shall one two three new
another several every many much well like make made makes take takes taken often usually called known example
examples within without among across since whether rather either neither per via uses part parts case way ways
set sets given whose lets let get gets got something anything everything itself keeps keep need needs needed
different same another first second next last able own often always never
""".split())

TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z\-\+#]{1,}")


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in TOKEN_RE.findall(text)]


# ---------- title ----------
def _clean_filename(filename: str) -> str:
    base = os.path.splitext(os.path.basename(filename))[0]
    base = re.sub(r"[_\-\.]+", " ", base)
    return re.sub(r"\s+", " ", base).strip().title()


def _looks_like_title(line: str) -> bool:
    line = line.strip()
    if not (4 <= len(line) <= 120):
        return False
    if re.fullmatch(r"[\d\W]+", line):          # only digits/punctuation
        return False
    if line.lower().startswith(("page ", "slide ", "http", "www.")):
        return False
    return len(line.split()) >= 2


def extract_title(text: str, meta_title: str | None, filename: str) -> str:
    """Order of trust: embedded metadata -> first sensible line -> filename."""
    if meta_title and _looks_like_title(meta_title) and not meta_title.lower().endswith((".doc", ".docx", ".pdf")):
        return meta_title.strip()
    for line in text.splitlines()[:25]:
        if _looks_like_title(line):
            return re.sub(r"\s+", " ", line.strip())
    return _clean_filename(filename)


# ---------- keywords ----------
def _stem(w: str) -> str:
    """Very light plural folding so 'record' and 'records' count as one keyword."""
    return w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w


def extract_keywords(text: str, top_n: int = 8) -> list[str]:
    """
    Frequency-based keyword extraction with bigram support.
    Bigrams (two adjacent non-stopwords repeated at least twice) are preferred
    because 'query planner' is more informative than 'query' and 'planner' alone.
    Plurals are folded together and shown in their most common spelling.
    """
    words = _tokens(text)
    if not words:
        return []
    surface: dict[str, Counter] = {}
    scored: Counter = Counter()

    for w in words:
        if w in STOPWORDS or len(w) <= 2:
            continue
        k = _stem(w)
        scored[k] += 1
        surface.setdefault(k, Counter())[w] += 1

    bigrams: Counter = Counter()
    for a, b in zip(words, words[1:]):
        if a not in STOPWORDS and b not in STOPWORDS and len(a) > 2 and len(b) > 2:
            k = f"{_stem(a)} {_stem(b)}"
            bigrams[k] += 1
            surface.setdefault(k, Counter())[f"{a} {b}"] += 1
    for k, c in bigrams.items():
        if c >= 2:
            scored[k] = c * 2.0          # reward repeated phrases

    ranked = sorted(scored.items(), key=lambda kv: (-kv[1], kv[0]))
    chosen: list[str] = []
    for key, _ in ranked:
        # skip a single word already covered by a chosen phrase
        if " " not in key and any(key in c.split() for c in chosen):
            continue
        chosen.append(key)
        if len(chosen) == top_n:
            break
    return [surface[k].most_common(1)[0][0] for k in chosen]


# ---------- summary ----------
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def _reflow(text: str) -> str:
    """
    PDFs hard-wrap lines in the middle of sentences. Join a line to the next one when it is long
    and does not end a sentence; short lines (slide bullets, headings) stay separate.
    """
    out, buf = [], ""
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            if buf:
                out.append(buf)
                buf = ""
            continue
        if buf and len(buf) >= 50 and not buf.endswith((".", "!", "?", ":", ";")):
            buf += " " + line
        else:
            if buf:
                out.append(buf)
            buf = line
    if buf:
        out.append(buf)
    return "\n".join(out)


def summarize(text: str, title: str = "", max_sentences: int = 2, max_chars: int = 420) -> str | None:
    """
    Extractive summary: pick the sentences whose words are most frequent in the
    document, then show them in their original order. No generative model, so it
    can only repeat what the document actually says.
    """
    sentences = [s.strip() for s in SENT_SPLIT.split(_reflow(text)) if 40 <= len(s.strip()) <= 300]
    sentences = [s for s in dict.fromkeys(sentences) if s != title]
    if not sentences:
        return None
    freq = Counter(w for w in _tokens(text) if w not in STOPWORDS and len(w) > 2)
    if not freq:
        return None

    def score(sentence: str) -> float:
        toks = [w for w in _tokens(sentence) if w not in STOPWORDS and len(w) > 2]
        return sum(freq[w] for w in toks) / (len(toks) ** 0.7) if toks else 0.0

    best = sorted(sorted(range(len(sentences)), key=lambda i: -score(sentences[i]))[:max_sentences])
    out = " ".join(sentences[i] for i in best)
    return out if len(out) <= max_chars else out[:max_chars].rsplit(" ", 1)[0] + "..."


# ---------- subject ----------
COURSE_CODE_RE = re.compile(r"\bCSC[\s\-_]?(\d{4})\b", re.IGNORECASE)


def find_course_code(*texts: str) -> str | None:
    """
    UNZA lecture material usually carries its course code (e.g. 'CSC 2702') in the
    header or filename. A known code is the strongest signal we have, so it wins.
    Returns the most frequent known code across the given texts.
    """
    found = Counter()
    for t in texts:
        for m in COURSE_CODE_RE.findall(t or ""):
            code = f"CSC{m}"
            if code in CODE_TO_TITLE:
                found[code] += 1
    return found.most_common(1)[0][0] if found else None


def classify_subject(text: str, title: str, filename: str = "") -> dict:
    """
    1) explicit course code -> that course (confidence 1.0)
    2) otherwise weighted seed-term matches (title counts 3x), normalised by
       document length so long files aren't favoured.
    """
    code = find_course_code(filename, title, text[:3000])
    if code:
        return {"subject": CODE_TO_TITLE[code], "course_code": code, "confidence": 1.0,
                "topics": [CODE_TO_TITLE[code]], "method": "course_code"}

    body = " " + " ".join(_tokens(text)) + " "
    head = " " + " ".join(_tokens(title)) + " "
    length_norm = math.log(len(body.split()) + 10)

    scores = {}
    for subject, terms in SUBJECTS.items():
        s = 0.0
        for term in terms:
            needle = f" {term} "
            s += body.count(needle) + 3 * head.count(needle)
        scores[subject] = s / length_norm

    total = sum(scores.values())
    if total == 0:
        return {"subject": UNCATEGORIZED, "course_code": None, "confidence": 0.0,
                "topics": [], "method": "none"}

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top_subject, top_score = ranked[0]
    confidence = round(top_score / total, 3)
    topics = [s for s, v in ranked[:3] if v > 0]
    if confidence < MIN_CONFIDENCE:
        return {"subject": UNCATEGORIZED, "course_code": None, "confidence": confidence,
                "topics": topics, "method": "none"}
    return {"subject": top_subject, "course_code": TITLE_TO_CODE[top_subject],
            "confidence": confidence, "topics": topics, "method": "keywords"}


# ---------- orchestration ----------
def analyze(filename: str, data: bytes) -> dict:
    ext = os.path.splitext(filename)[1].lower()
    rtype = resource_type_for(ext)
    extracted = extract(filename, data)
    text = extracted["text"]

    title = extract_title(text, extracted["meta_title"], filename)
    # For videos (no text) fall back to the filename words so there is something to match.
    basis = text if text.strip() else _clean_filename(filename)

    cls = classify_subject(basis, title, filename)
    status = "complete" if text.strip() else ("metadata_only" if rtype == "video" else "no_text")
    return {
        "title": title,
        "resource_type": rtype,
        "subject": cls["subject"],
        "course_code": cls["course_code"],
        "classified_by": cls["method"],
        "subject_confidence": cls["confidence"],
        "topics": cls["topics"],
        "keywords": extract_keywords(basis),
        "page_count": extracted["page_count"],
        "author": extracted.get("author"),
        "summary": summarize(text, title) if text.strip() else None,
        "extraction_status": status,
    }
