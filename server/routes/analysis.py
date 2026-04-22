"""Fixture analysis and store routes."""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from server.database import execute_query

router = APIRouter()


@router.get("/fixtures")
async def list_fixtures(
    uf: Optional[str] = None, store_id: Optional[str] = None,
    fixture_type: Optional[str] = None, video_id: Optional[int] = None,
    context_id: Optional[int] = None,
    limit: int = Query(100), offset: int = Query(0),
):
    conds, params = [], {"limit": limit, "offset": offset}
    if uf:
        conds.append("f.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("f.store_id = %(sid)s")
        params["sid"] = store_id
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
        SELECT f.*, ft.display_name, ft.color as type_color, s.name as store_name
        FROM fixtures f
        LEFT JOIN fixture_types ft ON f.fixture_type = ft.name
        LEFT JOIN stores s ON f.store_id = s.store_id
        {w}
        ORDER BY f.fixture_type, f.store_id
        LIMIT %(limit)s OFFSET %(offset)s
    """, params)

    total = execute_query(f"SELECT COUNT(*) as cnt FROM fixtures f {w}", params)
    return {"fixtures": fixtures, "total": total[0]["cnt"] if total else 0}


@router.get("/stores")
async def list_stores(uf: Optional[str] = None):
    conds, params = [], {}
    if uf:
        conds.append("s.uf = %(uf)s")
        params["uf"] = uf.upper()
    w = ("WHERE " + " AND ".join(conds)) if conds else ""

    return execute_query(f"""
        SELECT s.*,
            (SELECT COUNT(*) FROM videos v WHERE v.store_id = s.store_id) as video_count,
            (SELECT COUNT(*) FROM fixtures f WHERE f.store_id = s.store_id) as fixture_count,
            (SELECT MAX(v.video_date) FROM videos v WHERE v.store_id = s.store_id AND v.status='COMPLETED') as last_video_date
        FROM stores s {w}
        ORDER BY s.uf, s.store_id
    """, params)


@router.get("/stores/{store_id}")
async def get_store_detail(store_id: str):
    store = execute_query("""
        SELECT s.*, (SELECT COUNT(*) FROM videos v WHERE v.store_id = s.store_id) as video_count
        FROM stores s WHERE s.store_id = %(sid)s
    """, {"sid": store_id})
    if not store:
        raise HTTPException(404, "Loja nao encontrada")

    fixtures = execute_query("""
        SELECT fixture_type, COUNT(*) as total,
            ROUND(AVG(occupancy_pct)::numeric, 1) as avg_occupancy
        FROM fixtures WHERE store_id = %(sid)s
        GROUP BY fixture_type ORDER BY total DESC
    """, {"sid": store_id})

    videos = execute_query("""
        SELECT v.video_id, v.filename, v.video_date, v.status,
            (SELECT COUNT(*) FROM fixtures f WHERE f.video_id = v.video_id) as fixture_count
        FROM videos v WHERE v.store_id = %(sid)s
        ORDER BY v.video_date DESC
    """, {"sid": store_id})

    anomalies = execute_query("""
        SELECT * FROM anomalies WHERE store_id = %(sid)s AND resolved = FALSE
        ORDER BY created_at DESC
    """, {"sid": store_id})

    return {
        "store": store[0], "fixtures_by_type": fixtures,
        "videos": videos, "anomalies": anomalies,
    }


@router.get("/fixture-types")
async def list_fixture_types():
    return execute_query("SELECT * FROM fixture_types ORDER BY name")
