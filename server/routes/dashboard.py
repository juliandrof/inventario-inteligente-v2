"""Dashboard analytics routes."""

from fastapi import APIRouter, Query
from typing import Optional
from server.database import execute_query

router = APIRouter()


@router.get("/summary")
async def summary(uf: Optional[str] = None, store_id: Optional[str] = None, context_id: Optional[int] = None):
    conds_v, conds_f, params = [], [], {}
    if uf:
        conds_v.append("v.uf = %(uf)s")
        conds_f.append("f.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds_v.append("v.store_id = %(sid)s")
        conds_f.append("f.store_id = %(sid)s")
        params["sid"] = store_id
    if context_id:
        conds_v.append("v.context_id = %(ctx)s")
        conds_f.append("f.context_id = %(ctx)s")
        params["ctx"] = context_id

    wv = (" AND " + " AND ".join(conds_v)) if conds_v else ""
    wf = (" AND " + " AND ".join(conds_f)) if conds_f else ""

    videos = execute_query(f"SELECT COUNT(*) as cnt FROM videos v WHERE 1=1 {wv}", params)
    completed = execute_query(f"SELECT COUNT(*) as cnt FROM videos v WHERE v.status='COMPLETED' {wv}", params)
    processing = execute_query(f"SELECT COUNT(*) as cnt FROM videos v WHERE v.status='PROCESSING' {wv}", params)
    total_fixtures = execute_query(f"SELECT COUNT(*) as cnt FROM fixtures f WHERE 1=1 {wf}", params)
    stores = execute_query(f"SELECT COUNT(DISTINCT f.store_id) as cnt FROM fixtures f WHERE 1=1 {wf}", params)
    ufs = execute_query(f"SELECT COUNT(DISTINCT f.uf) as cnt FROM fixtures f WHERE 1=1 {wf}", params)
    avg_occ = execute_query(f"SELECT COALESCE(AVG(f.occupancy_pct),0) as avg FROM fixtures f WHERE 1=1 {wf}", params)
    anomalies = execute_query(f"""
        SELECT COUNT(*) as cnt FROM anomalies a WHERE a.resolved = FALSE
        {(' AND a.uf = %(uf)s' if uf else '') + (' AND a.store_id = %(sid)s' if store_id else '') + (' AND a.context_id = %(ctx)s' if context_id else '')}
    """, params)

    return {
        "total_videos": videos[0]["cnt"],
        "completed_videos": completed[0]["cnt"],
        "processing_videos": processing[0]["cnt"],
        "total_fixtures": total_fixtures[0]["cnt"],
        "total_stores": stores[0]["cnt"],
        "total_ufs": ufs[0]["cnt"],
        "avg_occupancy": round(float(avg_occ[0]["avg"]), 1),
        "active_anomalies": anomalies[0]["cnt"],
    }


@router.get("/by-type")
async def fixtures_by_type(uf: Optional[str] = None, store_id: Optional[str] = None, context_id: Optional[int] = None):
    conds, params = [], {}
    if uf:
        conds.append("f.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("f.store_id = %(sid)s")
        params["sid"] = store_id
    if context_id:
        conds.append("f.context_id = %(ctx)s")
        params["ctx"] = context_id
    w = (" AND " + " AND ".join(conds)) if conds else ""

    return execute_query(f"""
        SELECT f.fixture_type, COUNT(*) as total,
            ROUND(AVG(f.occupancy_pct)::numeric, 1) as avg_occupancy
        FROM fixtures f WHERE 1=1 {w}
        GROUP BY f.fixture_type ORDER BY total DESC
    """, params)


@router.get("/by-uf")
async def fixtures_by_uf(context_id: Optional[int] = None):
    conds, params = [], {}
    if context_id:
        conds.append("f.context_id = %(ctx)s")
        params["ctx"] = context_id
    w = (" WHERE " + " AND ".join(conds)) if conds else ""
    return execute_query(f"""
        SELECT f.uf, COUNT(*) as total, COUNT(DISTINCT f.store_id) as store_count,
            ROUND(AVG(f.occupancy_pct)::numeric, 1) as avg_occupancy
        FROM fixtures f{w} GROUP BY f.uf ORDER BY total DESC
    """, params)


@router.get("/by-store")
async def fixtures_by_store(uf: Optional[str] = None, context_id: Optional[int] = None, limit: int = Query(20)):
    conds, params = [], {"limit": limit}
    if uf:
        conds.append("f.uf = %(uf)s")
        params["uf"] = uf.upper()
    if context_id:
        conds.append("f.context_id = %(ctx)s")
        params["ctx"] = context_id
    w = (" AND " + " AND ".join(conds)) if conds else ""

    return execute_query(f"""
        SELECT f.store_id, f.uf, s.name as store_name,
            COUNT(*) as total_fixtures,
            ROUND(AVG(f.occupancy_pct)::numeric, 1) as avg_occupancy
        FROM fixtures f LEFT JOIN stores s ON f.store_id = s.store_id
        WHERE 1=1 {w}
        GROUP BY f.store_id, f.uf, s.name
        ORDER BY total_fixtures DESC LIMIT %(limit)s
    """, params)


@router.get("/occupancy")
async def occupancy_overview(uf: Optional[str] = None, store_id: Optional[str] = None, context_id: Optional[int] = None):
    conds, params = [], {}
    if uf:
        conds.append("f.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("f.store_id = %(sid)s")
        params["sid"] = store_id
    if context_id:
        conds.append("f.context_id = %(ctx)s")
        params["ctx"] = context_id
    w = (" AND " + " AND ".join(conds)) if conds else ""

    return execute_query(f"""
        SELECT f.fixture_type, f.occupancy_level, COUNT(*) as cnt
        FROM fixtures f WHERE 1=1 {w}
        GROUP BY f.fixture_type, f.occupancy_level
        ORDER BY f.fixture_type, f.occupancy_level
    """, params)


@router.get("/anomalies")
async def list_anomalies(uf: Optional[str] = None, store_id: Optional[str] = None, context_id: Optional[int] = None, resolved: bool = False):
    conds, params = ["a.resolved = %(resolved)s"], {"resolved": resolved}
    if uf:
        conds.append("a.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("a.store_id = %(sid)s")
        params["sid"] = store_id
    if context_id:
        conds.append("a.context_id = %(ctx)s")
        params["ctx"] = context_id

    return execute_query(f"""
        SELECT a.*, s.name as store_name
        FROM anomalies a LEFT JOIN stores s ON a.store_id = s.store_id
        WHERE {' AND '.join(conds)}
        ORDER BY a.created_at DESC LIMIT 50
    """, params)


@router.get("/temporal")
async def temporal_comparison(store_id: str, context_id: Optional[int] = None):
    """Compare fixture counts across different video dates for a store."""
    conds, params = ["fs.store_id = %(sid)s"], {"sid": store_id}
    if context_id:
        conds.append("fs.context_id = %(ctx)s")
        params["ctx"] = context_id
    return execute_query(f"""
        SELECT fs.video_date, fs.fixture_type, fs.total_count, fs.avg_occupancy_pct
        FROM fixture_summary fs
        WHERE {' AND '.join(conds)}
        ORDER BY fs.video_date, fs.fixture_type
    """, params)


@router.get("/recent")
async def recent_videos(uf: Optional[str] = None, store_id: Optional[str] = None, context_id: Optional[int] = None):
    conds, params = [], {}
    if uf:
        conds.append("v.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("v.store_id = %(sid)s")
        params["sid"] = store_id
    if context_id:
        conds.append("v.context_id = %(ctx)s")
        params["ctx"] = context_id
    w = (" AND " + " AND ".join(conds)) if conds else ""

    return execute_query(f"""
        SELECT v.video_id, v.filename, v.uf, v.store_id, v.video_date,
            v.status, v.progress_pct, v.upload_timestamp, v.duration_seconds,
            (SELECT COUNT(*) FROM fixtures f WHERE f.video_id = v.video_id) as fixture_count,
            s.name as store_name
        FROM videos v LEFT JOIN stores s ON v.store_id = s.store_id
        WHERE 1=1 {w}
        ORDER BY v.upload_timestamp DESC LIMIT 20
    """, params)


@router.get("/filters")
async def get_filters(context_id: Optional[int] = None):
    """Get available UFs and stores for filter dropdowns."""
    ctx_cond = ""
    params = {}
    if context_id:
        ctx_cond = " WHERE v.context_id = %(ctx)s"
        params["ctx"] = context_id
    ufs = execute_query(f"SELECT DISTINCT uf FROM videos v{ctx_cond} ORDER BY uf", params)
    stores = execute_query(f"""
        SELECT DISTINCT v.store_id, v.uf, s.name
        FROM videos v LEFT JOIN stores s ON v.store_id = s.store_id
        {ctx_cond}
        ORDER BY v.uf, v.store_id
    """, params)
    fixture_types = execute_query("SELECT name, display_name, color FROM fixture_types ORDER BY name")
    return {"ufs": [r["uf"] for r in ufs], "stores": stores, "fixture_types": fixture_types}
