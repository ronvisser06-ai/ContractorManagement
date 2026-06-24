"""Deterministic PDF -> ExtractedDeck parse (contracts §4.1). Pages normalize
into the same slides[] model as PPTX. PDFs have no speaker notes, tables, or
linked-media concept, so those fields are always empty/null for this source
type — the shape stays identical so downstream stages don't branch on it.
"""

import hashlib
import io
from typing import Any

from pypdf import PdfReader

from storage import upload_object


def extract_pdf(data: bytes, *, job_id: str, site_id: str) -> dict[str, Any]:
    reader = PdfReader(io.BytesIO(data))

    all_assets: list[dict[str, Any]] = []
    slides: list[dict[str, Any]] = []
    counter = 1

    for page_index, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        text_runs = [{"shape_index": 0, "level": 0, "bold": False, "text": text}] if text else []

        image_ids: list[str] = []
        for image in page.images:
            asset_id = f"ast_{page_index}_{counter}"
            counter += 1
            ext = (image.name.rsplit(".", 1)[-1] if "." in image.name else "png").lower()
            storage_key = f"sites/{site_id}/jobs/{job_id}/assets/{asset_id}.{ext}"
            mime = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"
            upload_object(storage_key, image.data, mime)
            width, height = (image.image.size if image.image else (None, None))
            all_assets.append(
                {
                    "id": asset_id,
                    "kind": "image",
                    "storage_key": storage_key,
                    "mime": mime,
                    "sha256": hashlib.sha256(image.data).hexdigest(),
                    "width": width,
                    "height": height,
                    "embed_state": "embedded",
                    "alt": image.name,
                }
            )
            image_ids.append(asset_id)

        slides.append(
            {
                "index": page_index,
                "id": f"slide_{page_index}",
                "title": None,
                "text_runs": text_runs,
                "tables": [],
                "image_asset_ids": image_ids,
                "media_asset_ids": [],
                "speaker_notes": "",
            }
        )

    return {
        "source": {
            "type": "pdf",
            "slide_count": len(reader.pages),
            "sha256": hashlib.sha256(data).hexdigest(),
        },
        "branding": {
            "colors": {"primary": None, "secondary": None, "accent": None},
            "fonts": {"heading": None, "body": None},
            "logo_asset_id": None,
        },
        "assets": all_assets,
        "slides": slides,
        "warnings": [],
    }
