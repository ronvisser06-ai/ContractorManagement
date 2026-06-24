"""Standalone deck-extraction service (Feature 2, Step 3). Deployed as its
own Vercel project, separate from the Next.js app — see
Feature2-Pipeline-Skeleton-Brief.md Step 3 for why. Run locally with:
  uvicorn app:app --port 8000 --reload
"""

import os

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from extract_pdf import extract_pdf
from extract_pptx import extract_pptx

app = FastAPI()


class ExtractRequest(BaseModel):
    signed_url: str
    source_type: str  # "pptx" | "pdf"
    job_id: str
    site_id: str


def _check_auth(authorization: str | None) -> None:
    secret = os.environ.get("EXTRACTOR_SHARED_SECRET")
    if not secret:
        raise HTTPException(500, "EXTRACTOR_SHARED_SECRET not configured")
    if authorization != f"Bearer {secret}":
        raise HTTPException(401, "unauthorized")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract")
def extract(req: ExtractRequest, authorization: str | None = Header(default=None)) -> dict:
    _check_auth(authorization)

    response = httpx.get(req.signed_url, timeout=60.0, follow_redirects=True)
    if response.status_code != 200:
        raise HTTPException(502, f"failed to download source asset: {response.status_code}")
    data = response.content

    if req.source_type == "pptx":
        return extract_pptx(data, job_id=req.job_id, site_id=req.site_id)
    if req.source_type == "pdf":
        return extract_pdf(data, job_id=req.job_id, site_id=req.site_id)
    raise HTTPException(400, f"unsupported source_type: {req.source_type}")
