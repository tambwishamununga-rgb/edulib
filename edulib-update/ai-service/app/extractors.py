"""
Turns an uploaded file into plain text plus a little structural metadata.
One function per format; extract() dispatches on the file extension.
"""
import io
import os

MAX_CHARS = 200_000   # cap so a huge book can't exhaust memory
MAX_PDF_PAGES = 60

PDF = {".pdf"}
SLIDES = {".pptx"}
NOTES = {".txt", ".md", ".docx"}
VIDEO = {".mp4", ".webm", ".mov", ".mkv"}


_JUNK_AUTHORS = {"admin", "administrator", "user", "unknown", "author", "owner", "windows user",
                 "microsoft office user", "pc", "student", "anonymous"}


def _author(value) -> str | None:
    """Embedded author metadata is often junk ('admin', 'Microsoft Office User'); drop that."""
    if not value:
        return None
    v = str(value).strip()
    if len(v) < 3 or v.lower() in _JUNK_AUTHORS or v.lower().startswith(("microsoft", "adobe")):
        return None
    return v[:120]


def resource_type_for(ext: str) -> str:
    """Resource type is decided by file format (the 'type' half of categorization)."""
    if ext in PDF:
        return "pdf"
    if ext in SLIDES:
        return "slides"
    if ext in NOTES:
        return "notes"
    if ext in VIDEO:
        return "video"
    return "other"


def _pdf(data: bytes) -> dict:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    pages = len(reader.pages)
    chunks = []
    for page in reader.pages[:MAX_PDF_PAGES]:
        chunks.append(page.extract_text() or "")
    meta_title = None
    if reader.metadata and reader.metadata.title:
        meta_title = str(reader.metadata.title).strip()
    author = _author(reader.metadata.author) if reader.metadata else None
    return {"text": "\n".join(chunks), "meta_title": meta_title, "page_count": pages, "author": author}


def _pptx(data: bytes) -> dict:
    from pptx import Presentation
    prs = Presentation(io.BytesIO(data))
    chunks, first_title = [], None
    for i, slide in enumerate(prs.slides):
        if i == 0 and slide.shapes.title is not None:
            first_title = slide.shapes.title.text_frame.text.strip() or None
        for shape in slide.shapes:
            if shape.has_text_frame:
                chunks.append(shape.text_frame.text)
    return {"text": "\n".join(chunks), "meta_title": first_title, "page_count": len(prs.slides),
            "author": _author(prs.core_properties.author)}


def _docx(data: bytes) -> dict:
    from docx import Document
    doc = Document(io.BytesIO(data))
    text = "\n".join(p.text for p in doc.paragraphs)
    title = (doc.core_properties.title or "").strip() or None
    return {"text": text, "meta_title": title, "page_count": None, "author": _author(doc.core_properties.author)}


def _plain(data: bytes) -> dict:
    return {"text": data.decode("utf-8", errors="ignore"), "meta_title": None, "page_count": None, "author": None}


def extract(filename: str, data: bytes) -> dict:
    ext = os.path.splitext(filename)[1].lower()
    if ext in VIDEO:
        # No transcript extraction in scope: videos are categorized from filename only.
        return {"text": "", "meta_title": None, "page_count": None, "author": None}
    handlers = {".pdf": _pdf, ".pptx": _pptx, ".docx": _docx, ".txt": _plain, ".md": _plain}
    handler = handlers.get(ext)
    if handler is None:
        raise ValueError(f"Unsupported file type: {ext or 'none'}")
    result = handler(data)
    result["text"] = result["text"][:MAX_CHARS]
    return result
