"""Thumbnail serving routes."""

import os
import tempfile
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from server.database import get_workspace_client

logger = logging.getLogger(__name__)
router = APIRouter()

THUMBNAIL_VOLUME = os.environ.get("THUMBNAIL_VOLUME", "/Volumes/scenic_crawler/default/thumbnails")

_thumb_cache = {}


@router.get("/{filename}")
async def get_thumbnail(filename: str):
    if filename in _thumb_cache and os.path.exists(_thumb_cache[filename]):
        return FileResponse(_thumb_cache[filename], media_type="image/jpeg")

    volume_path = f"{THUMBNAIL_VOLUME}/{filename}"
    try:
        w = get_workspace_client()
        resp = w.files.download(volume_path)
        data = resp.contents.read()
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        tmp.write(data)
        tmp.close()
        _thumb_cache[filename] = tmp.name
        return FileResponse(tmp.name, media_type="image/jpeg")
    except Exception:
        raise HTTPException(404, f"Thumbnail nao encontrado: {filename}")
