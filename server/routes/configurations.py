"""Configuration management routes."""

import time
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from server.database import execute_query, execute_update, get_workspace_client

logger = logging.getLogger(__name__)
router = APIRouter()


class ConfigUpdate(BaseModel):
    value: str
    description: Optional[str] = None


@router.get("")
async def list_configs():
    return execute_query("SELECT config_key, config_value, description, updated_at FROM configurations ORDER BY config_key")


@router.put("/{config_key}")
async def update_config(config_key: str, req: ConfigUpdate):
    existing = execute_query("SELECT config_key FROM configurations WHERE config_key = %(key)s", {"key": config_key})
    if existing:
        execute_update(
            "UPDATE configurations SET config_value = %(val)s, description = COALESCE(%(desc)s, description), updated_at = NOW() WHERE config_key = %(key)s",
            {"key": config_key, "val": req.value, "desc": req.description})
    else:
        execute_update(
            "INSERT INTO configurations (config_id, config_key, config_value, description, updated_at) VALUES (%(id)s, %(key)s, %(val)s, %(desc)s, NOW())",
            {"id": int(time.time() * 1000), "key": config_key, "val": req.value, "desc": req.description})
    return {"config_key": config_key, "updated": True}


@router.get("/serving-endpoints")
async def list_serving_endpoints():
    """List serving endpoints that support vision (multimodal image input)."""
    VISION_KEYWORDS = ["multimodal", "image input", "image and text", "vision", "analyze images"]

    try:
        w = get_workspace_client()
        endpoints = []
        for ep in w.serving_endpoints.list():
            # Skip non-chat endpoints (embeddings, completions, etc.)
            task = getattr(ep, "task", "") or ""
            if task and "chat" not in task:
                continue

            # Check if foundation model description mentions vision/multimodal
            is_vision = False
            display_name = ep.name
            description = ""
            if ep.config and ep.config.served_entities:
                for se in ep.config.served_entities:
                    fm = getattr(se, "foundation_model", None)
                    if fm:
                        display_name = getattr(fm, "display_name", ep.name) or ep.name
                        description = getattr(fm, "description", "") or ""
                        desc_lower = description.lower()
                        if any(kw in desc_lower for kw in VISION_KEYWORDS):
                            is_vision = True

            # Also include custom (non-foundation-model) endpoints - user may have trained a vision model
            is_custom = not (ep.config and ep.config.served_entities and
                            any(getattr(se, "foundation_model", None) for se in ep.config.served_entities))

            if is_vision or is_custom:
                endpoints.append({
                    "name": ep.name,
                    "display_name": display_name,
                    "state": ep.state.ready if ep.state else "UNKNOWN",
                    "is_custom": is_custom,
                    "description": description[:150] if description else "",
                })
        return endpoints
    except Exception as e:
        logger.warning(f"Could not list serving endpoints: {e}")
        return []


class FixtureTypeCreate(BaseModel):
    name: str
    display_name: str
    description: Optional[str] = ""
    color: Optional[str] = "#666666"


@router.get("/fixture-types")
async def list_fixture_types():
    return execute_query("SELECT * FROM fixture_types ORDER BY name")


@router.post("/fixture-types")
async def create_fixture_type(req: FixtureTypeCreate):
    name = req.name.upper().strip().replace(" ", "_")
    existing = execute_query("SELECT name FROM fixture_types WHERE name = %(n)s", {"n": name})
    if existing:
        raise HTTPException(400, f"Tipo '{name}' ja existe")
    execute_update(
        "INSERT INTO fixture_types (name, display_name, description, color) VALUES (%(n)s, %(dn)s, %(d)s, %(c)s)",
        {"n": name, "dn": req.display_name, "d": req.description, "c": req.color})
    return {"name": name, "created": True}


@router.put("/fixture-types/{name}")
async def update_fixture_type(name: str, req: FixtureTypeCreate):
    execute_update(
        "UPDATE fixture_types SET display_name=%(dn)s, description=%(d)s, color=%(c)s WHERE name=%(n)s",
        {"n": name.upper(), "dn": req.display_name, "d": req.description, "c": req.color})
    return {"name": name, "updated": True}


@router.delete("/fixture-types/{name}")
async def delete_fixture_type(name: str):
    execute_update("DELETE FROM fixture_types WHERE name = %(n)s", {"n": name.upper()})
    return {"name": name, "deleted": True}


@router.post("/clear-all")
async def clear_all_data():
    """Delete all analysis data (videos, fixtures, detections, anomalies, stores)."""
    tables = [
        "training_annotations", "training_images", "trained_models", "training_jobs",
        "detections", "fixtures", "fixture_summary", "anomalies", "processing_log", "videos", "stores",
    ]
    deleted = {}
    for t in tables:
        rows = execute_update(f"DELETE FROM {t}")
        deleted[t] = rows
    return {"cleared": True, "deleted": deleted}
