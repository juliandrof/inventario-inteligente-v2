"""Report routes - summary, CSV export, JSON export."""

import io
import csv
import json
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from server.database import execute_query

router = APIRouter()


@router.get("/summary")
async def report_summary():
    return execute_query("""
        SELECT fs.video_date, fs.fixture_type, fs.total_count, fs.avg_occupancy_pct
        FROM fixture_summary fs
        ORDER BY fs.video_date DESC, fs.fixture_type
    """)


@router.get("/export/csv")
async def export_csv():
    rows = execute_query("""
        SELECT v.filename, v.video_date,
            f.fixture_type, f.avg_confidence, f.ai_description
        FROM fixtures f
        LEFT JOIN videos v ON f.video_id = v.video_id
        ORDER BY v.video_date DESC, f.fixture_type
    """)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Arquivo", "Data", "Tipo", "Confianca", "Descricao"])
    for r in rows:
        writer.writerow([
            r.get("filename", ""), str(r.get("video_date", "")),
            r.get("fixture_type", ""), r.get("avg_confidence", ""),
            r.get("ai_description", ""),
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="deteccoes.csv"'},
    )


@router.get("/export/json")
async def export_json():
    rows = execute_query("""
        SELECT fs.video_date, fs.fixture_type, fs.total_count, fs.avg_occupancy_pct
        FROM fixture_summary fs
        ORDER BY fs.video_date DESC, fs.fixture_type
    """)
    for r in rows:
        if r.get("video_date"):
            r["video_date"] = str(r["video_date"])

    content = json.dumps(rows, ensure_ascii=False, indent=2, default=str)
    return StreamingResponse(
        iter([content]),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="deteccoes.json"'},
    )
