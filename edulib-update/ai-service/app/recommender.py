"""
Content-based recommendation and similarity.

Each resource becomes a sparse vector built from its keywords, its UNZA course and its topics.
  - similar():   "more like this one"  (shown while reading a resource)
  - recommend(): builds a taste profile from what the student viewed, downloaded
                 or uploaded (recent and downloaded items count more), ranks
                 everything else by cosine similarity, and explains each pick.

A small diversity penalty stops one course from filling the whole shelf, which is
the 'diversity-aware' behaviour promised in the proposal.
Pure functions with no web or database code, so they are unit-tested directly.
"""
import math
from collections import Counter

from .taxonomy import UNCATEGORIZED

MIN_SCORE = 0.05
DIVERSITY_DECAY = 0.85   # each extra pick from the same course is worth 15% less


def _vector(item: dict) -> Counter:
    v: Counter = Counter()
    for k in item.get("keywords") or []:
        k = k.lower().strip()
        if not k:
            continue
        v[k] += 1.0
        if " " in k:                       # let "query planner" also relate to "query"
            for w in k.split():
                v[w] += 0.5
    subject = item.get("subject")
    if subject and subject != UNCATEGORIZED:
        v["subject:" + subject] += 2.0     # same course is a strong signal
    for t in item.get("topics") or []:
        v["topic:" + t] += 0.5
    return v


def _cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a[k] * b[k] for k in a.keys() & b.keys())
    na = math.sqrt(sum(x * x for x in a.values()))
    nb = math.sqrt(sum(x * x for x in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def _why_similar(a: dict, b: dict) -> str:
    ka = {k.lower() for k in a.get("keywords") or []}
    shared = [k for k in (b.get("keywords") or []) if k.lower() in ka][:2]
    if shared:
        return "Shares: " + ", ".join(shared)
    if a.get("subject") and a.get("subject") == b.get("subject") and a["subject"] != UNCATEGORIZED:
        return f"Same course: {a['subject']}"
    return "Related topics"


def similar(target: dict, candidates: list[dict], top_n: int = 5) -> list[dict]:
    tv = _vector(target)
    out = []
    for c in candidates:
        if c["id"] == target["id"]:
            continue
        s = _cosine(tv, _vector(c))
        if s >= MIN_SCORE:
            out.append({"id": c["id"], "score": round(s, 3), "reason": _why_similar(target, c)})
    return sorted(out, key=lambda x: -x["score"])[:top_n]


def recommend(history: list[dict], candidates: list[dict], top_n: int = 8) -> list[dict]:
    """history items carry a 'weight' (views=1, uploads=1.5, downloads=2, summed per resource)."""
    if not history:
        return []                          # cold start: caller shows 'new in the library' instead
    seen = {h["id"] for h in history}
    hist_vecs = [(h, _vector(h)) for h in history]

    profile: Counter = Counter()
    for h, v in hist_vecs:
        w = float(h.get("weight", 1.0))
        for k, x in v.items():
            profile[k] += w * x

    pool = []
    for c in candidates:
        if c["id"] in seen:
            continue
        cv = _vector(c)
        s = _cosine(profile, cv)
        if s < MIN_SCORE:
            continue
        best = max(hist_vecs, key=lambda hv: _cosine(hv[1], cv) * float(hv[0].get("weight", 1.0)))[0]
        pool.append((s, c, best))

    picked, per_course = [], Counter()
    while pool and len(picked) < top_n:
        pool.sort(key=lambda t: t[0] * (DIVERSITY_DECAY ** per_course[t[1].get("subject")]), reverse=True)
        s, c, best = pool.pop(0)
        per_course[c.get("subject")] += 1
        title = best.get("title") or "a similar resource"
        picked.append({"id": c["id"], "score": round(s, 3), "reason": f"Because you read “{title}”"})
    return picked
