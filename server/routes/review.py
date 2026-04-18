"""Review routes - deduplicated fixture review with frame drill-down."""

from fastapi import APIRouter, Query
from typing import Optional
from server.database import execute_query

router = APIRouter()


@router.get("/videos")
async def review_videos(
    uf: Optional[str] = None, store_id: Optional[str] = None,
    video_date: Optional[str] = None,
):
    conds, params = ["v.status = 'COMPLETED'"], {}
    if uf:
        conds.append("v.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("v.store_id = %(sid)s")
        params["sid"] = store_id
    if video_date:
        conds.append("v.video_date = %(vd)s::date")
        params["vd"] = video_date

    return execute_query(f"""
        SELECT v.video_id, v.filename, v.uf, v.store_id, v.video_date,
            v.duration_seconds, v.frames_analyzed, s.name as store_name,
            (SELECT COUNT(*) FROM fixtures f WHERE f.video_id = v.video_id) as fixture_count,
            (SELECT COUNT(DISTINCT d.frame_index) FROM detections d WHERE d.video_id = v.video_id) as frames_with_detections,
            (SELECT COUNT(*) FROM detections d WHERE d.video_id = v.video_id) as total_detections
        FROM videos v LEFT JOIN stores s ON v.store_id = s.store_id
        WHERE {' AND '.join(conds)}
        ORDER BY v.upload_timestamp DESC
    """, params)


@router.get("/fixtures/{video_id}")
async def review_fixtures(video_id: int):
    """Get deduplicated fixtures for a video, each with best thumbnail and summary."""
    video = execute_query("""
        SELECT v.*, s.name as store_name
        FROM videos v LEFT JOIN stores s ON v.store_id = s.store_id
        WHERE v.video_id = %(vid)s
    """, {"vid": video_id})
    if not video:
        return {"error": "Video nao encontrado"}

    # Deduplicated fixtures with type info
    fixtures = execute_query("""
        SELECT f.*, ft.display_name, ft.color as type_color
        FROM fixtures f
        LEFT JOIN fixture_types ft ON f.fixture_type = ft.name
        WHERE f.video_id = %(vid)s
        ORDER BY f.fixture_type, f.tracking_id
    """, {"vid": video_id})

    # Count raw detections per tracking_id (how many frames each fixture appeared in)
    det_counts = execute_query("""
        SELECT tracking_id, COUNT(*) as frame_count
        FROM detections WHERE video_id = %(vid)s AND tracking_id IS NOT NULL
        GROUP BY tracking_id
    """, {"vid": video_id})
    count_map = {r["tracking_id"]: r["frame_count"] for r in det_counts}

    # Count by type for summary tags
    type_counts = {}
    for f in fixtures:
        ft = f["fixture_type"]
        type_counts[ft] = type_counts.get(ft, 0) + 1
        f["raw_frame_count"] = count_map.get(f["tracking_id"], f.get("frame_count", 1))

    summary = execute_query("""
        SELECT fixture_type, total_count, avg_occupancy_pct
        FROM fixture_summary WHERE video_id = %(vid)s ORDER BY fixture_type
    """, {"vid": video_id})

    return {
        "video": video[0],
        "fixtures": fixtures,
        "type_counts": type_counts,
        "fixture_summary": summary,
        "total_fixtures": len(fixtures),
    }


@router.get("/fixture-frames/{video_id}/{tracking_id}")
async def fixture_frames(video_id: int, tracking_id: int):
    """Get all raw detection frames for a specific deduplicated fixture."""
    detections = execute_query("""
        SELECT d.*, ft.display_name, ft.color as type_color
        FROM detections d
        LEFT JOIN fixture_types ft ON d.fixture_type = ft.name
        WHERE d.video_id = %(vid)s AND d.tracking_id = %(tid)s
        ORDER BY d.frame_index
    """, {"vid": video_id, "tid": tracking_id})

    frames = []
    for det in detections:
        frames.append({
            "frame_index": det["frame_index"],
            "timestamp_sec": det["timestamp_sec"],
            "thumbnail_path": det.get("thumbnail_path", ""),
            "fixture_type": det["fixture_type"],
            "display_name": det.get("display_name", det["fixture_type"]),
            "type_color": det.get("type_color", "#666"),
            "confidence": det["confidence"],
            "occupancy_level": det.get("occupancy_level", ""),
            "occupancy_pct": det.get("occupancy_pct", 0),
            "ai_description": det.get("ai_description", ""),
            "position": {"x": det.get("bbox_x", 50), "y": det.get("bbox_y", 50)},
        })

    return {"tracking_id": tracking_id, "frames": frames, "total": len(frames)}
