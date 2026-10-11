from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path
from typing import Annotated, Any, AsyncIterator

import httpx
from docx import Document
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
ACCESS_TOKEN = os.getenv("OLLAMA_WEB_TOKEN", "")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "25")) * 1024 * 1024
MAX_DOCUMENT_CHARS = int(os.getenv("MAX_DOCUMENT_CHARS", "200000"))

app = FastAPI(title="NSCC Ollama Desk", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(system|user|assistant)$")
    content: str
    images: list[str] | None = None


class ChatRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    messages: list[ChatMessage] = Field(min_length=1, max_length=200)
    options: dict[str, Any] = Field(default_factory=dict)


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    if not ACCESS_TOKEN:
        return
    if authorization != f"Bearer {ACCESS_TOKEN}":
        raise HTTPException(status_code=401, detail="Missing or invalid access token")


async def read_upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the upload limit")
    return data


def extract_document_text(filename: str, content_type: str, data: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    try:
        if suffix == ".pdf" or content_type == "application/pdf":
            text = "\n\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)
        elif suffix == ".docx" or content_type.endswith("wordprocessingml.document"):
            text = "\n".join(paragraph.text for paragraph in Document(io.BytesIO(data)).paragraphs)
        elif suffix in {".txt", ".md", ".csv", ".json", ".log", ".py", ".js", ".ts", ".html", ".css"} or content_type.startswith("text/"):
            text = data.decode("utf-8", errors="replace")
        else:
            raise HTTPException(status_code=415, detail="Supported documents: PDF, DOCX, and UTF-8 text files")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read document: {exc}") from exc

    text = text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="No readable text was found in the document")
    return text[:MAX_DOCUMENT_CHARS]


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/api/config")
async def config() -> dict[str, Any]:
    return {
        "auth_required": bool(ACCESS_TOKEN),
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
    }


@app.get("/api/health")
async def health(_: None = Depends(require_token)) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            response.raise_for_status()
        return {"status": "ok", "ollama": "connected"}
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Ollama is unavailable at {OLLAMA_BASE_URL}") from exc


@app.get("/api/models")
async def models(_: None = Depends(require_token)) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Could not reach Ollama at {OLLAMA_BASE_URL}") from exc

    models = [
        {
            "name": item.get("name", ""),
            "size": item.get("size", 0),
            "modified_at": item.get("modified_at"),
            "details": item.get("details", {}),
        }
        for item in payload.get("models", [])
        if item.get("name")
    ]
    return {"models": models}


@app.post("/api/files/document")
async def upload_document(
    file: Annotated[UploadFile, File()],
    _: None = Depends(require_token),
) -> dict[str, Any]:
    data = await read_upload(file)
    text = extract_document_text(file.filename or "document", file.content_type or "", data)
    return {"name": file.filename, "text": text, "characters": len(text)}


@app.post("/api/files/image")
async def upload_image(
    file: Annotated[UploadFile, File()],
    _: None = Depends(require_token),
) -> dict[str, Any]:
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="The uploaded file is not an image")
    data = await read_upload(file)
    return {
        "name": file.filename,
        "mime_type": file.content_type,
        "data": base64.b64encode(data).decode("ascii"),
    }


@app.post("/api/chat")
async def chat(request: ChatRequest, _: None = Depends(require_token)) -> StreamingResponse:
    payload = request.model_dump(exclude_none=True)
    payload["stream"] = True

    async def stream() -> AsyncIterator[bytes]:
        try:
            timeout = httpx.Timeout(connect=10, read=None, write=30, pool=10)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", f"{OLLAMA_BASE_URL}/api/chat", json=payload) as response:
                    if response.status_code >= 400:
                        body = await response.aread()
                        message = body.decode("utf-8", errors="replace")[:1000]
                        yield (json.dumps({"error": message or f"Ollama returned {response.status_code}"}) + "\n").encode()
                        return
                    async for line in response.aiter_lines():
                        if line:
                            yield (line + "\n").encode()
        except httpx.HTTPError as exc:
            yield (json.dumps({"error": f"Connection to Ollama failed: {exc}"}) + "\n").encode()

    return StreamingResponse(stream(), media_type="application/x-ndjson")

