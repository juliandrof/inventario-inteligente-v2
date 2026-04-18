"""Branding settings routes."""

import os
import time
import tempfile
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from server.database import execute_query, execute_update, get_workspace_client

logger = logging.getLogger(__name__)
router = APIRouter()

THUMBNAIL_VOLUME = os.environ.get("THUMBNAIL_VOLUME", "/Volumes/scenic_crawler/default/thumbnails")


class BrandingUpdate(BaseModel):
    value: str


@router.get("")
async def get_branding():
    rows = execute_query("SELECT setting_key, setting_value FROM branding")
    return {r["setting_key"]: r["setting_value"] for r in rows}


@router.put("/{setting_key}")
async def update_branding(setting_key: str, req: BrandingUpdate):
    existing = execute_query("SELECT setting_key FROM branding WHERE setting_key = %(key)s", {"key": setting_key})
    if existing:
        execute_update("UPDATE branding SET setting_value = %(val)s, updated_at = NOW() WHERE setting_key = %(key)s",
            {"key": setting_key, "val": req.value})
    else:
        execute_update("INSERT INTO branding (setting_id, setting_key, setting_value, updated_at) VALUES (%(id)s, %(key)s, %(val)s, NOW())",
            {"id": int(time.time() * 1000), "key": setting_key, "val": req.value})
    return {"setting_key": setting_key, "updated": True}


@router.post("/logo")
async def upload_logo(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No file provided")
    content = await file.read()
    ext = os.path.splitext(file.filename)[1].lower()
    logo_name = f"custom_logo{ext}"
    volume_path = f"{THUMBNAIL_VOLUME}/{logo_name}"
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        tmp.write(content)
        tmp.close()
        w = get_workspace_client()
        with open(tmp.name, "rb") as f:
            w.files.upload(volume_path, f, overwrite=True)
        os.unlink(tmp.name)
    except Exception as e:
        raise HTTPException(500, f"Erro ao fazer upload do logo: {e}")

    existing = execute_query("SELECT setting_key FROM branding WHERE setting_key = 'logo_path'")
    if existing:
        execute_update("UPDATE branding SET setting_value = %(val)s, updated_at = NOW() WHERE setting_key = 'logo_path'", {"val": logo_name})
    else:
        execute_update("INSERT INTO branding (setting_id, setting_key, setting_value, updated_at) VALUES (%(id)s, 'logo_path', %(val)s, NOW())",
            {"id": int(time.time() * 1000), "val": logo_name})
    return {"logo_path": logo_name, "uploaded": True}


@router.get("/logo")
async def get_logo():
    rows = execute_query("SELECT setting_value FROM branding WHERE setting_key = 'logo_path'")
    if not rows or not rows[0]["setting_value"]:
        raise HTTPException(404, "Nenhum logo customizado")
    logo_name = rows[0]["setting_value"]
    try:
        w = get_workspace_client()
        resp = w.files.download(f"{THUMBNAIL_VOLUME}/{logo_name}")
        data = resp.contents.read()
        ext = logo_name.split(".")[-1].lower()
        mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "svg": "image/svg+xml"}.get(ext, "image/png")
        return Response(content=data, media_type=mime)
    except Exception:
        raise HTTPException(404, "Logo nao encontrado")
