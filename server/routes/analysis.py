"""Fixture analysis routes."""

from fastapi import APIRouter, Query
from typing import Optional
from server.database import execute_query

router = APIRouter()


@router.get("/fixtures")
async def list_fixtures(
    fixture_type: Optional[str] = None, video_id: Optional[int] = None,
    context_id: Optional[int] = None,
    limit: int = Query(100), offset: int = Query(0),
):
    conds, params = [], {"limit": limit, "offset": offset}
    if fixture_type:
        conds.append("f.fixture_type = %(ft)s")
        params["ft"] = fixture_type.upper()
    if video_id:
        conds.append("f.video_id = %(vid)s")
        params["vid"] = video_id
    if context_id:
        conds.append("f.context_id = %(ctx)s")
        params["ctx"] = context_id

    w = ("WHERE " + " AND ".join(conds)) if conds else ""

    fixtures = execute_query(f"""
        SELECT f.*, ft.display_name, ft.color as type_color, v.filename
        FROM fixtures f
        LEFT JOIN fixture_types ft ON f.fixture_type = ft.name
        LEFT JOIN videos v ON f.video_id = v.video_id
        {w}
        ORDER BY f.fixture_type
        LIMIT %(limit)s OFFSET %(offset)s
    """, params)

    total = execute_query(f"SELECT COUNT(*) as cnt FROM fixtures f {w}", params)
    return {"fixtures": fixtures, "total": total[0]["cnt"] if total else 0}


@router.get("/fixture-types")
async def list_fixture_types():
    return execute_query("SELECT * FROM fixture_types ORDER BY name")
