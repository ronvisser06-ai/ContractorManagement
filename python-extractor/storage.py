"""Minimal Supabase Storage REST client. Used to write embedded assets
(images, embedded video) straight to the same private `pipeline-artifacts`
bucket the Next.js app uses, so the ExtractedDeck JSON never carries binary
payloads inline (orientation_pipeline_contracts_v0.1.md conventions)."""

import os

import httpx

ARTIFACTS_BUCKET = "pipeline-artifacts"


def _config() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured")
    return url, key


def upload_object(path: str, data: bytes, content_type: str, bucket: str = ARTIFACTS_BUCKET) -> None:
    supabase_url, service_role_key = _config()
    response = httpx.post(
        f"{supabase_url}/storage/v1/object/{bucket}/{path}",
        content=data,
        headers={
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        timeout=60.0,
    )
    if response.status_code >= 300:
        raise RuntimeError(f"storage upload failed ({response.status_code}): {response.text}")
