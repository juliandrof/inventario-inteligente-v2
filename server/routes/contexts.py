"""Context management routes."""
import time
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from server.database import execute_query, execute_update

logger = logging.getLogger(__name__)
router = APIRouter()


class ContextCreate(BaseModel):
    name: str
    display_name: str
    description: Optional[str] = ""
    icon: Optional[str] = "📦"
    color: Optional[str] = "#2563EB"


class ObjectTypeCreate(BaseModel):
    name: str
    display_name: str
    description: Optional[str] = ""
    icon: Optional[str] = ""
    color: Optional[str] = "#2563EB"


@router.get("")
async def list_contexts():
    contexts = execute_query("""
        SELECT c.*,
            (SELECT COUNT(*) FROM context_object_types WHERE context_id = c.context_id) as type_count,
            (SELECT COUNT(*) FROM videos WHERE context_id = c.context_id) as video_count
        FROM contexts c ORDER BY c.is_default DESC, c.display_name
    """)
    return contexts


@router.get("/{context_id}")
async def get_context(context_id: int):
    rows = execute_query("SELECT * FROM contexts WHERE context_id = %(cid)s", {"cid": context_id})
    if not rows:
        raise HTTPException(404, "Context not found")
    ctx = rows[0]
    ctx["object_types"] = execute_query(
        "SELECT * FROM context_object_types WHERE context_id = %(cid)s ORDER BY name",
        {"cid": context_id}
    )
    return ctx


@router.post("")
async def create_context(req: ContextCreate):
    name = req.name.lower().strip().replace(" ", "_")
    existing = execute_query("SELECT context_id FROM contexts WHERE name = %(n)s", {"n": name})
    if existing:
        raise HTTPException(400, f"Context '{name}' already exists")
    context_id = int(time.time() * 1000)
    execute_update("""
        INSERT INTO contexts (context_id, name, display_name, description, icon, color)
        VALUES (%(id)s, %(n)s, %(dn)s, %(d)s, %(i)s, %(c)s)
    """, {"id": context_id, "n": name, "dn": req.display_name, "d": req.description, "i": req.icon, "c": req.color})
    return {"context_id": context_id, "name": name}


@router.put("/{context_id}")
async def update_context(context_id: int, req: ContextCreate):
    execute_update("""
        UPDATE contexts SET display_name = %(dn)s, description = %(d)s, icon = %(i)s, color = %(c)s, updated_at = NOW()
        WHERE context_id = %(cid)s
    """, {"cid": context_id, "dn": req.display_name, "d": req.description, "i": req.icon, "c": req.color})
    return {"context_id": context_id, "updated": True}


@router.delete("/{context_id}")
async def delete_context(context_id: int):
    # Check if it's the default
    rows = execute_query("SELECT is_default FROM contexts WHERE context_id = %(cid)s", {"cid": context_id})
    if rows and rows[0]["is_default"]:
        raise HTTPException(400, "Cannot delete the default context")
    # Check for linked videos
    vids = execute_query("SELECT COUNT(*) as cnt FROM videos WHERE context_id = %(cid)s", {"cid": context_id})
    if vids and vids[0]["cnt"] > 0:
        raise HTTPException(400, f"Context has {vids[0]['cnt']} videos. Delete them first.")
    execute_update("DELETE FROM context_object_types WHERE context_id = %(cid)s", {"cid": context_id})
    execute_update("DELETE FROM contexts WHERE context_id = %(cid)s", {"cid": context_id})
    return {"deleted": True}


# Object types within a context
@router.get("/{context_id}/object-types")
async def list_object_types(context_id: int):
    return execute_query(
        "SELECT * FROM context_object_types WHERE context_id = %(cid)s ORDER BY name",
        {"cid": context_id}
    )


@router.post("/{context_id}/object-types")
async def create_object_type(context_id: int, req: ObjectTypeCreate):
    name = req.name.upper().strip().replace(" ", "_")
    execute_update("""
        INSERT INTO context_object_types (context_id, name, display_name, description, icon, color)
        VALUES (%(cid)s, %(n)s, %(dn)s, %(d)s, %(i)s, %(c)s)
    """, {"cid": context_id, "n": name, "dn": req.display_name, "d": req.description, "i": req.icon, "c": req.color})
    return {"name": name, "created": True}


@router.put("/{context_id}/object-types/{name}")
async def update_object_type(context_id: int, name: str, req: ObjectTypeCreate):
    execute_update("""
        UPDATE context_object_types SET display_name = %(dn)s, description = %(d)s, icon = %(i)s, color = %(c)s
        WHERE context_id = %(cid)s AND name = %(n)s
    """, {"cid": context_id, "n": name.upper(), "dn": req.display_name, "d": req.description, "i": req.icon, "c": req.color})
    return {"updated": True}


@router.delete("/{context_id}/object-types/{name}")
async def delete_object_type(context_id: int, name: str):
    execute_update(
        "DELETE FROM context_object_types WHERE context_id = %(cid)s AND name = %(n)s",
        {"cid": context_id, "n": name.upper()}
    )
    return {"deleted": True}
