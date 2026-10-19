from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import recommender
from .analyzer import analyze
from .taxonomy import ALL_SUBJECTS, UNCATEGORIZED

app = FastAPI(title="EduLib AI Service")

MAX_BYTES = 50 * 1024 * 1024


class Item(BaseModel):
    id: str
    title: str = ""
    keywords: list[str] = []
    subject: str = UNCATEGORIZED
    topics: list[str] = []
    weight: float = 1.0


class RecommendRequest(BaseModel):
    history: list[Item]
    candidates: list[Item]
    top_n: int = Field(8, ge=1, le=30)


class SimilarRequest(BaseModel):
    target: Item
    candidates: list[Item]
    top_n: int = Field(5, ge=1, le=20)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/subjects")
def subjects():
    """UNZA course list, so the UI's 'change subject' dropdown always matches the classifier."""
    items = [{"code": s["code"], "title": s["title"]} for s in ALL_SUBJECTS]
    items.append({"code": None, "title": UNCATEGORIZED})
    return items


@app.post("/analyze")
async def analyze_file(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large for analysis")
    try:
        return analyze(file.filename or "unnamed", data)
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e))
    except Exception as e:  # corrupt/encrypted file etc. - caller keeps the upload anyway
        raise HTTPException(status_code=422, detail=f"Could not read document: {e}")


@app.post("/recommend")
def recommend(req: RecommendRequest):
    return recommender.recommend([i.model_dump() for i in req.history],
                                 [i.model_dump() for i in req.candidates], req.top_n)


@app.post("/similar")
def similar(req: SimilarRequest):
    return recommender.similar(req.target.model_dump(),
                               [i.model_dump() for i in req.candidates], req.top_n)
