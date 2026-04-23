"""Dashboard analytics routes."""

from fastapi import APIRouter, Query
from typing import Optional
from server.database import execute_query

router = APIRouter()


@router.get("/summary")
async def summary(context_id: Optional[int] = None):
    params = {}
    ctx_v = ""
    ctx_f = ""
    if context_id:
        ctx_v = " AND v.context_id = %(ctx)s"
        ctx_f = " AND f.context_id = %(ctx)s"
        params["ctx"] = context_id

    videos = execute_query(f"SELECT COUNT(*) as cnt FROM videos v WHERE 1=1{ctx_v}", params)
    completed = execute_query(f"SELECT COUNT(*) as cnt FROM videos v WHERE v.status='COMPLETED'{ctx_v}", params)
    processing = execute_query(f"SELECT COUNT(*) as cnt FROM videos v WHERE v.status='PROCESSING'{ctx_v}", params)
    total_fixtures = execute_query(f"SELECT COUNT(*) as cnt FROM fixtures f WHERE 1=1{ctx_f}", params)

    return {
        "total_videos": videos[0]["cnt"],
        "completed_videos": completed[0]["cnt"],
        "processing_videos": processing[0]["cnt"],
        "total_fixtures": total_fixtures[0]["cnt"],
    }


@router.get("/by-type")
async def fixtures_by_type(context_id: Optional[int] = None):
    params = {}
    w = ""
    if context_id:
        w = " WHERE f.context_id = %(ctx)s"
        params["ctx"] = context_id

    return execute_query(f"""
        SELECT f.fixture_type, COUNT(*) as total
        FROM fixtures f{w}
        GROUP BY f.fixture_type ORDER BY total DESC
    """, params)


@router.get("/recent")
async def recent_videos(context_id: Optional[int] = None):
    params = {}
    w = ""
    if context_id:
        w = " AND v.context_id = %(ctx)s"
        params["ctx"] = context_id

    return execute_query(f"""
        SELECT v.video_id, v.filename, v.video_date,
            v.status, v.progress_pct, v.upload_timestamp, v.duration_seconds,
            (SELECT COUNT(*) FROM fixtures f WHERE f.video_id = v.video_id) as fixture_count
        FROM videos v
        WHERE 1=1{w}
        ORDER BY v.upload_timestamp DESC LIMIT 20
    """, params)


@router.get("/filters")
async def get_filters(context_id: Optional[int] = None):
    """Get available fixture types for filtering."""
    fixture_types = execute_query("SELECT name, display_name, color FROM fixture_types ORDER BY name")
    return {"fixture_types": fixture_types}
