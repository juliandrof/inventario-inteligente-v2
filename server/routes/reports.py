"""Reports and export routes."""

import io
import csv
import json
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from typing import Optional
from server.database import execute_query

router = APIRouter()


@router.get("/summary")
async def report_summary(uf: Optional[str] = None, store_id: Optional[str] = None):
    conds, params = [], {}
    if uf:
        conds.append("fs.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("fs.store_id = %(sid)s")
        params["sid"] = store_id
    w = (" AND " + " AND ".join(conds)) if conds else ""

    return execute_query(f"""
        SELECT fs.store_id, fs.uf, s.name as store_name, fs.video_date,
            fs.fixture_type, fs.total_count, fs.avg_occupancy_pct,
            fs.empty_count, fs.partial_count, fs.full_count
        FROM fixture_summary fs
        LEFT JOIN stores s ON fs.store_id = s.store_id
        WHERE 1=1 {w}
        ORDER BY fs.uf, fs.store_id, fs.video_date DESC, fs.fixture_type
    """, params)


@router.get("/export/csv")
async def export_csv(uf: Optional[str] = None, store_id: Optional[str] = None):
    conds, params = [], {}
    if uf:
        conds.append("f.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("f.store_id = %(sid)s")
        params["sid"] = store_id
    w = (" AND " + " AND ".join(conds)) if conds else ""

    rows = execute_query(f"""
        SELECT f.store_id, f.uf, s.name as store_name, f.video_date,
            f.fixture_type, ft.display_name, f.occupancy_level, f.occupancy_pct,
            f.avg_confidence, f.position_zone, f.ai_description
        FROM fixtures f
        LEFT JOIN stores s ON f.store_id = s.store_id
        LEFT JOIN fixture_types ft ON f.fixture_type = ft.name
        WHERE 1=1 {w}
        ORDER BY f.uf, f.store_id, f.fixture_type
    """, params)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "UF", "Loja ID", "Nome Loja", "Data Video", "Tipo Expositor",
        "Nome Expositor", "Ocupacao", "Ocupacao %", "Confianca",
        "Zona", "Descricao AI"
    ])
    for r in rows:
        writer.writerow([
            r["uf"], r["store_id"], r.get("store_name", ""),
            str(r["video_date"]), r["fixture_type"],
            r.get("display_name", ""), r.get("occupancy_level", ""),
            r.get("occupancy_pct", ""), r.get("avg_confidence", ""),
            r.get("position_zone", ""), r.get("ai_description", ""),
        ])

    output.seek(0)
    filename = f"inventario_expositores{'_' + uf if uf else ''}{'_loja' + store_id if store_id else ''}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/json")
async def export_json(uf: Optional[str] = None, store_id: Optional[str] = None):
    conds, params = [], {}
    if uf:
        conds.append("fs.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("fs.store_id = %(sid)s")
        params["sid"] = store_id
    w = (" AND " + " AND ".join(conds)) if conds else ""

    rows = execute_query(f"""
        SELECT fs.store_id, fs.uf, s.name as store_name, fs.video_date,
            fs.fixture_type, fs.total_count, fs.avg_occupancy_pct,
            fs.empty_count, fs.partial_count, fs.full_count
        FROM fixture_summary fs
        LEFT JOIN stores s ON fs.store_id = s.store_id
        WHERE 1=1 {w}
        ORDER BY fs.uf, fs.store_id, fs.fixture_type
    """, params)

    # Serialize dates
    for r in rows:
        if r.get("video_date"):
            r["video_date"] = str(r["video_date"])

    content = json.dumps(rows, ensure_ascii=False, indent=2, default=str)
    filename = f"inventario_expositores{'_' + uf if uf else ''}.json"
    return StreamingResponse(
        iter([content]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/comparison")
async def store_comparison(uf: Optional[str] = None):
    """Compare fixture counts across stores, optionally filtered by UF."""
    conds, params = [], {}
    if uf:
        conds.append("fs.uf = %(uf)s")
        params["uf"] = uf.upper()
    w = (" AND " + " AND ".join(conds)) if conds else ""

    return execute_query(f"""
        SELECT fs.store_id, fs.uf, s.name as store_name,
            SUM(fs.total_count) as total_fixtures,
            ROUND(AVG(fs.avg_occupancy_pct)::numeric, 1) as avg_occupancy,
            jsonb_object_agg(fs.fixture_type, fs.total_count) as by_type
        FROM fixture_summary fs
        LEFT JOIN stores s ON fs.store_id = s.store_id
        WHERE 1=1 {w}
        GROUP BY fs.store_id, fs.uf, s.name
        ORDER BY total_fixtures DESC
    """, params)
