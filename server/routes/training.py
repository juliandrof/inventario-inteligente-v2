"""Training routes - YOLO model training, image annotation, and model management."""

import base64
import datetime
import json
import logging
import os
import tempfile
import time
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from server.database import execute_query, execute_update, get_connection, get_workspace_client

logger = logging.getLogger(__name__)
router = APIRouter()

CATALOG = "jsf_demo_catalog"
SCHEMA = "scenic_crawler"
TRAINING_IMAGES_VOLUME = f"/Volumes/{CATALOG}/{SCHEMA}/training_images"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class AnnotationItem(BaseModel):
    fixture_type: str
    x: float
    y: float
    w: float
    h: float


class AnnotationPayload(BaseModel):
    annotations: list[AnnotationItem]


class StartJobPayload(BaseModel):
    model_size: str = "n"
    epochs: int = 50
    batch_size: int = 16
    cluster_spec: Optional[dict] = None
    context_id: Optional[int] = None


class DetectionModePayload(BaseModel):
    mode: str  # LLM, YOLO, HYBRID


# ---------------------------------------------------------------------------
# Table creation
# ---------------------------------------------------------------------------

def create_training_tables(conn):
    """Create training-related tables if they don't exist."""
    cur = conn.cursor()

    statements = [
        ("training_images", """
            CREATE TABLE IF NOT EXISTS training_images (
                image_id BIGINT PRIMARY KEY,
                filename VARCHAR(500) NOT NULL,
                volume_path VARCHAR(1000) NOT NULL,
                width INT,
                height INT,
                annotation_count INT DEFAULT 0,
                source_group VARCHAR(500),
                uploaded_at TIMESTAMP DEFAULT NOW()
            )
        """),
        ("training_annotations", """
            CREATE TABLE IF NOT EXISTS training_annotations (
                annotation_id BIGINT PRIMARY KEY,
                image_id BIGINT NOT NULL REFERENCES training_images(image_id) ON DELETE CASCADE,
                fixture_type VARCHAR(100) NOT NULL,
                x_center DOUBLE PRECISION NOT NULL,
                y_center DOUBLE PRECISION NOT NULL,
                width DOUBLE PRECISION NOT NULL,
                height DOUBLE PRECISION NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """),
        ("training_jobs", """
            CREATE TABLE IF NOT EXISTS training_jobs (
                job_id BIGINT PRIMARY KEY,
                databricks_run_id BIGINT,
                model_size VARCHAR(10),
                epochs INT,
                batch_size INT,
                status VARCHAR(20) DEFAULT 'PENDING',
                started_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP,
                metrics_json TEXT,
                error_message TEXT
            )
        """),
        ("trained_models", """
            CREATE TABLE IF NOT EXISTS trained_models (
                model_id BIGINT PRIMARY KEY,
                job_id BIGINT REFERENCES training_jobs(job_id),
                model_name VARCHAR(200),
                model_path VARCHAR(1000),
                serving_endpoint VARCHAR(200),
                map50 DOUBLE PRECISION,
                map50_95 DOUBLE PRECISION,
                precision_val DOUBLE PRECISION,
                recall_val DOUBLE PRECISION,
                confusion_matrix_json TEXT,
                is_active BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """),
    ]

    for label, sql in statements:
        try:
            cur.execute(sql)
        except Exception as e:
            logger.warning(f"Create training table [{label}]: {e}")

    # Ensure columns exist (for tables created before these columns were added)
    for alter_sql in [
        "ALTER TABLE training_images ADD COLUMN IF NOT EXISTS source_group VARCHAR(500)",
        "ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS results_path VARCHAR(1000)",
    ]:
        try:
            cur.execute(alter_sql)
        except Exception as e:
            logger.warning(f"ALTER: {e}")

    # Indexes
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_training_ann_image ON training_annotations(image_id)",
        "CREATE INDEX IF NOT EXISTS idx_training_ann_type ON training_annotations(fixture_type)",
        "CREATE INDEX IF NOT EXISTS idx_training_jobs_status ON training_jobs(status)",
        "CREATE INDEX IF NOT EXISTS idx_trained_models_active ON trained_models(is_active)",
    ]
    for idx_sql in indexes:
        try:
            cur.execute(idx_sql)
        except Exception as e:
            logger.warning(f"Index: {e}")

    # Ensure detection_mode config exists
    try:
        cur.execute("SELECT 1 FROM configurations WHERE config_key = 'detection_mode'")
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO configurations (config_id, config_key, config_value, description, updated_at)
                VALUES (%(id)s, 'detection_mode', 'LLM', 'Modo de deteccao: LLM, YOLO ou HYBRID', NOW())
            """, {"id": int(time.time() * 1000) + 10})
    except Exception as e:
        logger.warning(f"Seed detection_mode: {e}")

    cur.close()
    logger.info("Training tables verified/created")


def _ensure_tables():
    """Lazy table creation on first use."""
    try:
        conn = get_connection()
        create_training_tables(conn)
    except Exception as e:
        logger.warning(f"Could not ensure training tables: {e}")


# Run on module import so tables exist when routes are hit
_ensure_tables()


# ===========================================================================
# Training Images
# ===========================================================================

@router.get("/debug")
async def training_debug():
    """Debug endpoint - check training subsystem health."""
    import subprocess, sys
    info = {"python": sys.version, "executable": sys.executable}
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM training_images")
        info["training_images_count"] = cur.fetchone()[0]
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'training_images' ORDER BY ordinal_position")
        info["training_images_columns"] = [r[0] for r in cur.fetchall()]
        cur.close()
        info["db"] = "ok"
    except Exception as e:
        info["db_error"] = f"{type(e).__name__}: {e}"
    try:
        w = get_workspace_client()
        info["workspace_client"] = "ok"
    except Exception as e:
        info["workspace_error"] = f"{type(e).__name__}: {e}"
    try:
        import cv2
        info["cv2"] = cv2.__version__
    except Exception as e:
        info["cv2_error"] = str(e)
    # Check pip packages
    try:
        result = subprocess.run([sys.executable, "-m", "pip", "list", "--format=json"], capture_output=True, text=True, timeout=15)
        pkgs = {p["name"]: p["version"] for p in __import__("json").loads(result.stdout)}
        info["opencv_packages"] = {k: v for k, v in pkgs.items() if "opencv" in k.lower()}
        info["pip_total_packages"] = len(pkgs)
    except Exception as e:
        info["pip_error"] = str(e)
    # Check ffmpeg
    try:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
        info["ffmpeg"] = result.stdout.split("\n")[0] if result.returncode == 0 else "not found"
    except Exception:
        info["ffmpeg"] = "not available"
    # Check ffprobe
    try:
        result = subprocess.run(["ffprobe", "-version"], capture_output=True, text=True, timeout=5)
        info["ffprobe"] = "available" if result.returncode == 0 else "not found"
    except Exception:
        info["ffprobe"] = "not available"
    return info


@router.post("/images/upload")
async def upload_training_image(file: UploadFile = File(...), context_id: int = Query(None)):
    """Upload a training image (or video, extracting 1 frame/sec) to Volume."""
    import io
    import traceback
    from PIL import Image as PILImage

    try:
        return await _do_upload(file, io, PILImage, context_id=context_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload failed: {e}", exc_info=True)
        raise HTTPException(500, f"Upload failed: {type(e).__name__}: {e}")


async def _do_upload(file, io, PILImage, context_id=None):
    filename = file.filename or f"image_{int(time.time() * 1000)}.jpg"

    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")

    ext = os.path.splitext(filename)[1].lstrip(".").lower()
    video_exts = {"mp4", "avi", "mov", "mkv", "webm", "m4v", "mpg", "mpeg", "wmv", "flv", "3gp", "ts"}

    if ext in video_exts:
        # --- Video: extract frames using PyAV (bundled ffmpeg, no system deps) ---
        import av

        tmp_video_path = tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False).name
        try:
            with open(tmp_video_path, "wb") as f:
                f.write(content)

            container = av.open(tmp_video_path)
            stream = container.streams.video[0]
            fps = float(stream.average_rate or 30)
            frame_interval = max(1, int(round(fps * 2)))  # 1 frame every 2 seconds

            w_client = get_workspace_client()
            name_base = os.path.splitext(filename)[0]

            # Save original video for playback
            original_path = f"{TRAINING_IMAGES_VOLUME}/{name_base}_original.{ext}"
            w_client.files.upload(original_path, io.BytesIO(content), overwrite=True)
            orig_id = int(time.time() * 1000) - 1
            execute_update("""
                INSERT INTO training_images (image_id, filename, volume_path, width, height, annotation_count, source_group, uploaded_at, context_id)
                VALUES (%(iid)s, %(fn)s, %(vp)s, 0, 0, -1, %(sg)s, NOW(), %(ctx)s)
            """, {"iid": orig_id, "fn": f"{name_base}_original.{ext}", "vp": original_path, "sg": filename, "ctx": context_id})

            created_records = []
            seconds = 0
            for frame_idx, frame in enumerate(container.decode(video=0)):
                if frame_idx % frame_interval == 0:
                    img = frame.to_image()  # PIL Image
                    w_frame, h_frame = img.size

                    buf = io.BytesIO()
                    img.save(buf, "JPEG", quality=75)
                    jpeg_bytes = buf.getvalue()

                    frame_filename = f"{name_base}_frame_{seconds * 2}s.jpg"
                    frame_volume_path = f"{TRAINING_IMAGES_VOLUME}/{frame_filename}"

                    w_client.files.upload(frame_volume_path, io.BytesIO(jpeg_bytes), overwrite=True)

                    image_id = int(time.time() * 1000) + seconds
                    execute_update("""
                        INSERT INTO training_images (image_id, filename, volume_path, width, height, annotation_count, source_group, uploaded_at, context_id)
                        VALUES (%(iid)s, %(fn)s, %(vp)s, %(w)s, %(h)s, 0, %(sg)s, NOW(), %(ctx)s)
                    """, {"iid": image_id, "fn": frame_filename, "vp": frame_volume_path, "w": w_frame, "h": h_frame, "sg": filename, "ctx": context_id})

                    created_records.append({
                        "image_id": image_id,
                        "filename": frame_filename,
                        "volume_path": frame_volume_path,
                        "width": w_frame,
                        "height": h_frame,
                    })
                    seconds += 1

            container.close()

            if not created_records:
                raise HTTPException(400, "No frames could be extracted from video")

            return {"images": created_records, "frames_extracted": len(created_records)}
        finally:
            if os.path.exists(tmp_video_path):
                os.unlink(tmp_video_path)

    # --- Regular image upload ---
    width, height = 0, 0
    tmp = tempfile.NamedTemporaryFile(suffix=os.path.splitext(filename)[1], delete=False)
    try:
        tmp.write(content)
        tmp.close()
        try:
            img = PILImage.open(tmp.name)
            width, height = img.width, img.height
        except Exception as e:
            logger.warning(f"Could not read image dimensions: {e}")
    finally:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)

    # Upload to Volume
    volume_path = f"{TRAINING_IMAGES_VOLUME}/{filename}"
    try:
        w_client = get_workspace_client()
        w_client.files.upload(volume_path, io.BytesIO(content), overwrite=True)
    except Exception as e:
        raise HTTPException(500, f"Failed to upload to Volume: {e}")

    image_id = int(time.time() * 1000)
    execute_update("""
        INSERT INTO training_images (image_id, filename, volume_path, width, height, annotation_count, source_group, uploaded_at, context_id)
        VALUES (%(iid)s, %(fn)s, %(vp)s, %(w)s, %(h)s, 0, %(sg)s, NOW(), %(ctx)s)
    """, {"iid": image_id, "fn": filename, "vp": volume_path, "w": width, "h": height, "sg": filename, "ctx": context_id})

    return {
        "image_id": image_id,
        "filename": filename,
        "volume_path": volume_path,
        "width": width,
        "height": height,
    }


@router.get("/groups")
async def list_training_groups(context_id: int = Query(None)):
    """List training sources grouped (1 entry per video/image upload)."""
    ctx_cond = ""
    params = {}
    if context_id:
        ctx_cond = " WHERE context_id = %(ctx)s"
        params["ctx"] = context_id
    groups = execute_query(f"""
        SELECT COALESCE(source_group, filename) as source_name,
            COUNT(*) FILTER (WHERE annotation_count >= 0) as frame_count,
            SUM(COALESCE(annotation_count, 0)) FILTER (WHERE annotation_count >= 0) as total_annotations,
            MIN(image_id) FILTER (WHERE annotation_count >= 0) as first_image_id,
            MIN(uploaded_at) as uploaded_at,
            BOOL_OR(filename LIKE '%%_original.%%') as has_video
        FROM training_images{ctx_cond}
        GROUP BY COALESCE(source_group, filename)
        ORDER BY MIN(uploaded_at) DESC
    """, params)
    for g in groups:
        g["thumbnail_url"] = f"/api/training/images/{g['first_image_id']}/stream"
        if g.get("has_video"):
            g["video_url"] = f"/api/training/groups/{g['source_name']}/video"
    return groups


@router.get("/groups/{source_name}/frames")
async def list_group_frames(source_name: str):
    """List all frames for a source group, ordered by video sequence."""
    images = execute_query("""
        SELECT ti.*,
            (SELECT COUNT(*) FROM training_annotations ta WHERE ta.image_id = ti.image_id) as actual_annotation_count
        FROM training_images ti
        WHERE COALESCE(ti.source_group, ti.filename) = %(sg)s AND ti.annotation_count >= 0
        ORDER BY ti.image_id
    """, {"sg": source_name})
    for img in images:
        img["image_url"] = f"/api/training/images/{img['image_id']}/stream"
        img["thumbnail_url"] = img["image_url"]
    return images


@router.get("/groups/{source_name}/video")
async def stream_group_video(source_name: str, request: Request):
    """Stream the original video file for a source group."""
    rows = execute_query("""
        SELECT volume_path FROM training_images
        WHERE COALESCE(source_group, filename) = %(sg)s AND volume_path LIKE '%%_original%%'
        LIMIT 1
    """, {"sg": source_name})
    if not rows:
        raise HTTPException(404, "Video original nao encontrado")
    try:
        w = get_workspace_client()
        resp = w.files.download(rows[0]["volume_path"])
        content = resp.contents.read()
        total = len(content)
        # Support Range for seeking
        range_header = request.headers.get("range")
        if range_header:
            parts = range_header.replace("bytes=", "").split("-")
            start = int(parts[0]) if parts[0] else 0
            end = int(parts[1]) if parts[1] else total - 1
            end = min(end, total - 1)
            chunk = content[start:end + 1]
            return Response(content=chunk, status_code=206, media_type="video/mp4",
                headers={"Content-Range": f"bytes {start}-{end}/{total}", "Accept-Ranges": "bytes", "Content-Length": str(len(chunk))})
        return Response(content=content, media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Content-Length": str(total)})
    except Exception as e:
        raise HTTPException(500, f"Erro: {e}")


@router.get("/groups/{source_name}/all-annotations")
async def get_group_annotations(source_name: str):
    """Get all annotations for all frames in a group, keyed by second."""
    rows = execute_query("""
        SELECT ti.image_id, ti.filename,
            ta.fixture_type, ta.x_center as x, ta.y_center as y, ta.width as w, ta.height as h
        FROM training_images ti
        JOIN training_annotations ta ON ti.image_id = ta.image_id
        WHERE COALESCE(ti.source_group, ti.filename) = %(sg)s
        ORDER BY ti.image_id, ta.annotation_id
    """, {"sg": source_name})

    # Group by second (extract from filename pattern _frame_{N}s.jpg)
    import re
    by_second = {}
    for r in rows:
        match = re.search(r'_frame_(\d+)s', r["filename"])
        sec = int(match.group(1)) if match else 0
        if sec not in by_second:
            by_second[sec] = []
        by_second[sec].append({
            "fixture_type": r["fixture_type"], "x": r["x"], "y": r["y"], "w": r["w"], "h": r["h"],
        })
    return by_second


import threading

_auto_annotate_jobs = {}  # source_name -> {status, progress, total, done, errors}


@router.post("/groups/{source_name}/auto-annotate-all")
async def auto_annotate_group(source_name: str):
    """Start auto-annotation for all frames in background."""
    images = execute_query("""
        SELECT image_id FROM training_images
        WHERE COALESCE(source_group, filename) = %(sg)s
        ORDER BY filename
    """, {"sg": source_name})
    if not images:
        raise HTTPException(404, "Group not found")

    if source_name in _auto_annotate_jobs and _auto_annotate_jobs[source_name]["status"] == "RUNNING":
        return _auto_annotate_jobs[source_name]

    job = {"status": "RUNNING", "total": len(images), "done": 0, "errors": 0, "source_name": source_name}
    _auto_annotate_jobs[source_name] = job

    def run():
        import asyncio
        loop = asyncio.new_event_loop()
        for img in images:
            try:
                loop.run_until_complete(auto_annotate_image(img["image_id"]))
            except Exception:
                job["errors"] += 1
            job["done"] += 1
        loop.close()
        job["status"] = "COMPLETED"

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return job


@router.get("/groups/{source_name}/auto-annotate-status")
async def auto_annotate_status(source_name: str):
    """Poll auto-annotation progress."""
    job = _auto_annotate_jobs.get(source_name)
    if not job:
        return {"status": "NOT_STARTED"}
    return job


@router.get("/images")
async def list_training_images(limit: int = Query(100), offset: int = Query(0)):
    """List training images with annotation counts."""
    images = execute_query("""
        SELECT ti.*,
            (SELECT COUNT(*) FROM training_annotations ta WHERE ta.image_id = ti.image_id) as actual_annotation_count
        FROM training_images ti
        ORDER BY ti.uploaded_at DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, {"limit": limit, "offset": offset})

    # Add image_url for frontend display
    for img in images:
        img["image_url"] = f"/api/training/images/{img['image_id']}/stream"
        img["thumbnail_url"] = img["image_url"]

    total = execute_query("SELECT COUNT(*) as cnt FROM training_images")
    return {"images": images, "total": total[0]["cnt"] if total else 0}


@router.get("/images/{image_id}")
async def get_training_image(image_id: int):
    """Get a training image with its annotations."""
    rows = execute_query(
        "SELECT * FROM training_images WHERE image_id = %(iid)s",
        {"iid": image_id},
    )
    if not rows:
        raise HTTPException(404, "Image not found")

    annotations = execute_query("""
        SELECT annotation_id, fixture_type, x_center, y_center, width, height, created_at
        FROM training_annotations
        WHERE image_id = %(iid)s
        ORDER BY annotation_id
    """, {"iid": image_id})

    # Map DB field names to frontend-expected names
    mapped_annotations = []
    for ann in annotations:
        mapped = dict(ann)
        mapped["x"] = mapped.pop("x_center")
        mapped["y"] = mapped.pop("y_center")
        mapped["w"] = mapped.pop("width")
        mapped["h"] = mapped.pop("height")
        mapped_annotations.append(mapped)

    result = dict(rows[0])
    result["image_url"] = f"/api/training/images/{image_id}/stream"
    result["thumbnail_url"] = result["image_url"]
    result["annotations"] = mapped_annotations
    return result


@router.delete("/images/{image_id}")
async def delete_training_image(image_id: int):
    """Delete a training image and its annotations."""
    rows = execute_query(
        "SELECT volume_path FROM training_images WHERE image_id = %(iid)s",
        {"iid": image_id},
    )
    if not rows:
        raise HTTPException(404, "Image not found")

    # Delete from Volume
    try:
        w = get_workspace_client()
        w.files.delete(rows[0]["volume_path"])
    except Exception as e:
        logger.warning(f"Could not delete Volume file: {e}")

    # Delete annotations then image
    execute_update("DELETE FROM training_annotations WHERE image_id = %(iid)s", {"iid": image_id})
    execute_update("DELETE FROM training_images WHERE image_id = %(iid)s", {"iid": image_id})

    return {"deleted": True, "image_id": image_id}


@router.get("/images/{image_id}/stream")
async def stream_training_image(image_id: int):
    """Serve the image file for browser display."""
    rows = execute_query(
        "SELECT volume_path, filename FROM training_images WHERE image_id = %(iid)s",
        {"iid": image_id},
    )
    if not rows:
        raise HTTPException(404, "Image not found")

    filename = rows[0]["filename"]
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    mime_map = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png", "webp": "image/webp",
        "gif": "image/gif", "bmp": "image/bmp",
        "mp4": "video/mp4", "avi": "video/x-msvideo", "mov": "video/quicktime",
        "mkv": "video/x-matroska", "webm": "video/webm", "m4v": "video/mp4",
    }
    mime = mime_map.get(ext, "application/octet-stream")
    is_video = mime.startswith("video/")

    try:
        w = get_workspace_client()
        resp = w.files.download(rows[0]["volume_path"])
        content = resp.contents.read()

        # For videos, extract first frame as JPEG thumbnail using PyAV
        if is_video:
            try:
                import av
                tmp_path = f"/tmp/train_thumb_{image_id}.{ext}"
                with open(tmp_path, "wb") as f:
                    f.write(content)
                container = av.open(tmp_path)
                for frame in container.decode(video=0):
                    img = frame.to_image()
                    buf = io.BytesIO()
                    img.save(buf, "JPEG", quality=85)
                    content = buf.getvalue()
                    mime = "image/jpeg"
                    break
                container.close()
                os.remove(tmp_path)
            except Exception as thumb_err:
                logger.warning(f"Could not extract video thumbnail: {thumb_err}")

        return Response(
            content=content,
            media_type=mime,
            headers={
                "Content-Length": str(len(content)),
                "Cache-Control": "public, max-age=3600",
            },
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to stream image: {e}")


@router.post("/images/{image_id}/auto-annotate")
async def auto_annotate_image(image_id: int):
    """Use the current FMAPI model to auto-generate annotations for an image.

    Downloads the image, sends it through analyze_frame_fixtures, converts
    the detection results to annotation format, and saves them to DB.
    """
    rows = execute_query(
        "SELECT volume_path, width, height FROM training_images WHERE image_id = %(iid)s",
        {"iid": image_id},
    )
    if not rows:
        raise HTTPException(404, "Image not found")

    # Download file from Volume
    try:
        w = get_workspace_client()
        resp = w.files.download(rows[0]["volume_path"])
        file_bytes = resp.contents.read()
    except Exception as e:
        raise HTTPException(500, f"Failed to download image: {e}")

    # Handle video files - extract first frame
    import io
    from PIL import Image as PILImage
    volume_path = rows[0]["volume_path"]
    ext = volume_path.rsplit(".", 1)[-1].lower() if "." in volume_path else ""
    video_exts = {"mp4", "avi", "mov", "mkv", "webm", "m4v", "mpg", "mpeg", "wmv", "flv", "3gp", "ts"}

    if ext in video_exts:
        import av
        tmp_path = f"/tmp/auto_ann_{image_id}.{ext}"
        with open(tmp_path, "wb") as f:
            f.write(file_bytes)
        container = av.open(tmp_path)
        extracted = False
        for frame in container.decode(video=0):
            img = frame.to_image()
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=85)
            file_bytes = buf.getvalue()
            extracted = True
            break
        container.close()
        os.remove(tmp_path)
        if not extracted:
            raise HTTPException(500, "Could not extract frame from video")

    # Resize if too large (max 1024px wide) and convert to JPEG
    try:
        img = PILImage.open(io.BytesIO(file_bytes)).convert("RGB")
        orig_w, orig_h = img.size
        if orig_w > 1024:
            ratio = 1024 / orig_w
            img = img.resize((1024, int(orig_h * ratio)))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=80)
        file_bytes = buf.getvalue()
    except Exception as e:
        logger.warning(f"Could not resize image: {e}")

    frame_b64 = base64.b64encode(file_bytes).decode("utf-8")

    # Call FMAPI
    from server.fmapi import analyze_frame_fixtures
    try:
        detections = analyze_frame_fixtures(frame_b64)
    except Exception as e:
        raise HTTPException(500, f"FMAPI analysis failed: {e}")

    if not detections:
        return {"image_id": image_id, "annotations_created": 0, "message": "No fixtures detected"}

    # Clear existing annotations for this image
    execute_update("DELETE FROM training_annotations WHERE image_id = %(iid)s", {"iid": image_id})

    # Convert FMAPI detections to annotation format and save
    # FMAPI returns: {"type": "GONDOLA", "position": {"x": 30, "y": 50}, "bbox_w": 25, "bbox_h": 40, ...}
    # position.x and position.y are percentages (0-100) representing the CENTER
    # bbox_w and bbox_h are percentages (0-100) representing bounding box size
    # We store as x_center, y_center (0-100) and width, height (0-100)

    # Type-specific fallback sizes (% of image) when LLM doesn't return bbox
    _FALLBACK_SIZES = {
        "GONDOLA":          (30, 50),
        "ARARA":            (25, 45),
        "PRATELEIRA":       (35, 30),
        "BALCAO":           (30, 25),
        "DISPLAY":          (15, 30),
        "CESTAO":           (15, 20),
        "CABIDEIRO_PAREDE": (20, 40),
        "CHECKOUT":         (25, 25),
        "MANEQUIM":         (10, 35),
        "MESA":             (25, 20),
    }

    annotations_created = 0
    for det in detections:
        pos = det.get("position", {})
        x_center = float(pos.get("x", 50))
        y_center = float(pos.get("y", 50))
        fixture_type = det.get("type", "UNKNOWN")

        # Use bbox dimensions from FMAPI if available, otherwise use type-specific fallback
        est_w = float(det.get("bbox_w", 0) or 0)
        est_h = float(det.get("bbox_h", 0) or 0)
        if est_w < 3 or est_h < 3:
            fallback_w, fallback_h = _FALLBACK_SIZES.get(fixture_type, (20, 25))
            est_w = est_w if est_w >= 3 else fallback_w
            est_h = est_h if est_h >= 3 else fallback_h

        # Clamp bbox so it doesn't exceed image boundaries
        est_w = min(est_w, x_center * 2, (100 - x_center) * 2)
        est_h = min(est_h, y_center * 2, (100 - y_center) * 2)

        ann_id = int(time.time() * 1000) + annotations_created
        execute_update("""
            INSERT INTO training_annotations
            (annotation_id, image_id, fixture_type, x_center, y_center, width, height, created_at)
            VALUES (%(aid)s, %(iid)s, %(ft)s, %(xc)s, %(yc)s, %(w)s, %(h)s, NOW())
        """, {
            "aid": ann_id, "iid": image_id, "ft": fixture_type,
            "xc": x_center, "yc": y_center, "w": est_w, "h": est_h,
        })
        annotations_created += 1

    # Update annotation count
    execute_update(
        "UPDATE training_images SET annotation_count = %(cnt)s WHERE image_id = %(iid)s",
        {"cnt": annotations_created, "iid": image_id},
    )

    return {
        "image_id": image_id,
        "annotations_created": annotations_created,
        "detections": detections,
    }


# ===========================================================================
# Annotations
# ===========================================================================

@router.post("/images/{image_id}/annotations")
async def save_annotations(image_id: int, payload: AnnotationPayload):
    """Save/replace all annotations for an image.

    Receives array of {fixture_type, x, y, w, h} where x,y is center
    and w,h are all percentages 0-100.
    """
    rows = execute_query(
        "SELECT image_id FROM training_images WHERE image_id = %(iid)s",
        {"iid": image_id},
    )
    if not rows:
        raise HTTPException(404, "Image not found")

    # Delete existing annotations
    execute_update("DELETE FROM training_annotations WHERE image_id = %(iid)s", {"iid": image_id})

    # Insert new annotations
    count = 0
    for ann in payload.annotations:
        ann_id = int(time.time() * 1000) + count
        execute_update("""
            INSERT INTO training_annotations
            (annotation_id, image_id, fixture_type, x_center, y_center, width, height, created_at)
            VALUES (%(aid)s, %(iid)s, %(ft)s, %(xc)s, %(yc)s, %(w)s, %(h)s, NOW())
        """, {
            "aid": ann_id, "iid": image_id, "ft": ann.fixture_type,
            "xc": ann.x, "yc": ann.y, "w": ann.w, "h": ann.h,
        })
        count += 1

    # Update annotation count on the image
    execute_update(
        "UPDATE training_images SET annotation_count = %(cnt)s WHERE image_id = %(iid)s",
        {"cnt": count, "iid": image_id},
    )

    return {"image_id": image_id, "annotation_count": count}


@router.get("/images/{image_id}/annotations")
async def get_annotations(image_id: int):
    """Get annotations for an image."""
    rows = execute_query(
        "SELECT image_id FROM training_images WHERE image_id = %(iid)s",
        {"iid": image_id},
    )
    if not rows:
        raise HTTPException(404, "Image not found")

    annotations = execute_query("""
        SELECT annotation_id, fixture_type, x_center, y_center, width, height, created_at
        FROM training_annotations
        WHERE image_id = %(iid)s
        ORDER BY annotation_id
    """, {"iid": image_id})

    # Map DB field names to frontend-expected names
    mapped_annotations = []
    for ann in annotations:
        mapped = dict(ann)
        mapped["x"] = mapped.pop("x_center")
        mapped["y"] = mapped.pop("y_center")
        mapped["w"] = mapped.pop("width")
        mapped["h"] = mapped.pop("height")
        mapped_annotations.append(mapped)

    return {"image_id": image_id, "annotations": mapped_annotations}


# ===========================================================================
# Training Jobs
# ===========================================================================

@router.post("/jobs/start")
async def start_training_job(payload: StartJobPayload):
    """Start a YOLO training job.

    1. Export annotations in YOLO format to a Volume
    2. Create a training script
    3. Submit as a Databricks Job
    4. Save job info to DB
    """
    from server.yolo_trainer import export_yolo_dataset, generate_training_script, submit_training_job

    valid_sizes = ("n", "s", "m", "l", "x")
    if payload.model_size not in valid_sizes:
        raise HTTPException(400, f"Invalid model_size. Must be one of: {valid_sizes}")
    if payload.epochs < 30 or payload.epochs > 500:
        raise HTTPException(400, "Epochs must be between 30 and 500 (minimum 30 for meaningful training)")
    if payload.batch_size < 1 or payload.batch_size > 128:
        raise HTTPException(400, "Batch size must be between 1 and 128")

    job_id = int(time.time() * 1000)

    # Save initial job record
    execute_update("""
        INSERT INTO training_jobs
        (job_id, model_size, epochs, batch_size, status, started_at, context_id)
        VALUES (%(jid)s, %(ms)s, %(ep)s, %(bs)s, 'PENDING', NOW(), %(ctx)s)
    """, {"jid": job_id, "ms": payload.model_size, "ep": payload.epochs, "bs": payload.batch_size, "ctx": payload.context_id})

    try:
        # Step 1: Export dataset
        dataset_path = export_yolo_dataset(context_id=payload.context_id)

        # Step 2: Generate training script
        script, results_path = generate_training_script(
            dataset_path=dataset_path,
            model_size=payload.model_size,
            epochs=payload.epochs,
            batch_size=payload.batch_size,
        )

        # Step 3: Submit Databricks job
        w = get_workspace_client()
        run_id = submit_training_job(w, script, payload.cluster_spec)

        # Step 4: Update job with run ID
        execute_update("""
            UPDATE training_jobs
            SET databricks_run_id = %(rid)s, status = 'RUNNING', results_path = %(rp)s
            WHERE job_id = %(jid)s
        """, {"rid": run_id, "jid": job_id, "rp": results_path})

        return {
            "job_id": job_id,
            "databricks_run_id": run_id,
            "dataset_path": dataset_path,
            "results_path": results_path,
            "status": "RUNNING",
        }

    except Exception as e:
        execute_update("""
            UPDATE training_jobs SET status = 'FAILED', error_message = %(err)s
            WHERE job_id = %(jid)s
        """, {"err": str(e)[:2000], "jid": job_id})
        raise HTTPException(500, f"Failed to start training job: {e}")


@router.get("/jobs")
async def list_training_jobs(limit: int = Query(20), offset: int = Query(0)):
    """List training jobs with status.

    Automatically syncs status of RUNNING/PENDING jobs with Databricks.
    """
    jobs = execute_query("""
        SELECT * FROM training_jobs
        ORDER BY started_at DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, {"limit": limit, "offset": offset})

    # Auto-sync RUNNING/PENDING jobs with Databricks (max 1 per request to avoid slowness)
    synced = False
    for job in jobs:
        if job.get("status") in ("RUNNING", "PENDING") and job.get("databricks_run_id"):
            try:
                new_status = _sync_job_status(job["job_id"], job["databricks_run_id"])
                job["status"] = new_status  # update in-memory
                synced = True
            except Exception as e:
                logger.warning(f"Auto-sync failed for job {job['job_id']}: {e}")
            break  # only sync one per request

    if synced:
        jobs = execute_query("""
            SELECT * FROM training_jobs
            ORDER BY started_at DESC
            LIMIT %(limit)s OFFSET %(offset)s
        """, {"limit": limit, "offset": offset})

    # Compute duration_seconds for each job
    for job in jobs:
        if job.get("started_at"):
            end = job.get("completed_at") or datetime.datetime.now()
            try:
                delta = end - job["started_at"]
                job["duration_seconds"] = delta.total_seconds()
            except Exception:
                job["duration_seconds"] = None
        else:
            job["duration_seconds"] = None

    total = execute_query("SELECT COUNT(*) as cnt FROM training_jobs")
    return {"jobs": jobs, "total": total[0]["cnt"] if total else 0}


@router.get("/jobs/{job_id}")
async def get_training_job(job_id: int):
    """Get job detail with metrics."""
    rows = execute_query(
        "SELECT * FROM training_jobs WHERE job_id = %(jid)s",
        {"jid": job_id},
    )
    if not rows:
        raise HTTPException(404, "Training job not found")

    # Auto-sync if still running
    job_row = rows[0]
    if job_row.get("status") in ("RUNNING", "PENDING") and job_row.get("databricks_run_id"):
        try:
            _sync_job_status(job_row["job_id"], job_row["databricks_run_id"])
            rows = execute_query(
                "SELECT * FROM training_jobs WHERE job_id = %(jid)s",
                {"jid": job_id},
            )
        except Exception as e:
            logger.warning(f"Auto-sync failed for job {job_id}: {e}")

    job = dict(rows[0])

    # Parse metrics JSON if available
    if job.get("metrics_json"):
        try:
            job["metrics"] = json.loads(job["metrics_json"])
        except Exception:
            job["metrics"] = {}
    else:
        job["metrics"] = {}

    # Include associated model if any
    models = execute_query(
        "SELECT * FROM trained_models WHERE job_id = %(jid)s",
        {"jid": job_id},
    )
    job["models"] = models

    return job


def _sync_job_status(job_id: int, databricks_run_id: int) -> str:
    """Sync a single job's status with Databricks via REST API.

    Returns the new status string.
    """
    from server.yolo_trainer import get_run_status, parse_training_results, MODELS_VOLUME

    w = get_workspace_client()
    run_info = get_run_status(w, databricks_run_id)

    life_cycle = run_info.get("life_cycle_state", "UNKNOWN")
    result_state = run_info.get("result_state")
    state_message = run_info.get("state_message", "")
    termination_message = run_info.get("termination_message", "")

    # Pick the most informative error message
    error_detail = termination_message or state_message or ""

    # Fetch job info for model naming
    job_rows = execute_query(
        "SELECT model_size, epochs, batch_size, results_path FROM training_jobs WHERE job_id = %(jid)s",
        {"jid": job_id},
    )
    job_info = job_rows[0] if job_rows else {}

    new_status = None

    if life_cycle == "TERMINATED":
        if result_state == "SUCCESS":
            new_status = "COMPLETED"
            # Try to parse training metrics
            try:
                rpath = job_info.get("results_path") or f"{MODELS_VOLUME}/results_{databricks_run_id}"
                metrics = parse_training_results(rpath)
                metrics_json = json.dumps(metrics)
                execute_update("""
                    UPDATE training_jobs
                    SET status = 'COMPLETED', completed_at = NOW(), metrics_json = %(mj)s
                    WHERE job_id = %(jid)s
                """, {"mj": metrics_json, "jid": job_id})

                # Create trained model record
                if metrics.get("best_model_path"):
                    model_id = int(time.time() * 1000)
                    execute_update("""
                        INSERT INTO trained_models
                        (model_id, job_id, model_name, model_path, map50, map50_95,
                         precision_val, recall_val, is_active, created_at)
                        VALUES (%(mid)s, %(jid)s, %(mn)s, %(mp)s, %(m50)s, %(m5095)s,
                                %(prec)s, %(rec)s, FALSE, NOW())
                    """, {
                        "mid": model_id,
                        "jid": job_id,
                        "mn": f"yolov8{job_info.get('model_size', '?')}_e{job_info.get('epochs', '?')}",
                        "mp": metrics.get("best_model_path", ""),
                        "m50": metrics.get("map50", 0),
                        "m5095": metrics.get("map50_95", 0),
                        "prec": metrics.get("precision", 0),
                        "rec": metrics.get("recall", 0),
                    })
            except Exception as e:
                logger.warning(f"Could not parse metrics for job {job_id}: {e}")
                execute_update("""
                    UPDATE training_jobs SET status = 'COMPLETED', completed_at = NOW()
                    WHERE job_id = %(jid)s
                """, {"jid": job_id})
        else:
            new_status = "FAILED"
            error_msg = error_detail or result_state or "Job terminated with unknown error"
            execute_update("""
                UPDATE training_jobs
                SET status = 'FAILED', completed_at = NOW(), error_message = %(err)s
                WHERE job_id = %(jid)s
            """, {"err": error_msg[:2000], "jid": job_id})

    elif life_cycle in ("INTERNAL_ERROR", "SKIPPED"):
        new_status = "FAILED"
        error_msg = error_detail or f"Databricks {life_cycle}"
        execute_update("""
            UPDATE training_jobs
            SET status = 'FAILED', completed_at = NOW(), error_message = %(err)s
            WHERE job_id = %(jid)s
        """, {"err": error_msg[:2000], "jid": job_id})

    elif life_cycle in ("PENDING", "RUNNING", "BLOCKED", "QUEUED"):
        new_status = "RUNNING"

    else:
        new_status = "RUNNING"  # Unknown state, keep as running

    logger.info(f"Job {job_id} (run {databricks_run_id}): lifecycle={life_cycle}, result={result_state}, new_status={new_status}")
    return new_status


@router.get("/jobs/{job_id}/status")
async def poll_job_status(job_id: int):
    """Poll Databricks job status and update DB.

    Uses REST API (not SDK) to query Databricks run status.
    """
    rows = execute_query(
        "SELECT * FROM training_jobs WHERE job_id = %(jid)s",
        {"jid": job_id},
    )
    if not rows:
        raise HTTPException(404, "Training job not found")

    job = rows[0]
    dbx_run_id = job.get("databricks_run_id")

    if not dbx_run_id:
        return {"job_id": job_id, "status": job["status"], "message": "No Databricks run ID"}

    # Already in terminal state
    if job["status"] in ("COMPLETED", "FAILED", "CANCELLED"):
        return {"job_id": job_id, "status": job["status"]}

    try:
        new_status = _sync_job_status(job_id, dbx_run_id)

        # Re-fetch updated job
        updated = execute_query(
            "SELECT * FROM training_jobs WHERE job_id = %(jid)s",
            {"jid": job_id},
        )
        updated_job = updated[0] if updated else job

        return {
            "job_id": job_id,
            "databricks_run_id": dbx_run_id,
            "status": new_status,
            "error_message": updated_job.get("error_message"),
        }

    except Exception as e:
        logger.error(f"Failed to poll job status for {job_id}: {e}")
        return {
            "job_id": job_id,
            "status": job["status"],
            "error": str(e),
        }


# ===========================================================================
# Trained Models
# ===========================================================================

@router.get("/models")
async def list_trained_models(limit: int = Query(20), offset: int = Query(0)):
    """List trained models with metrics."""
    models = execute_query("""
        SELECT tm.*, tj.model_size, tj.epochs, tj.batch_size
        FROM trained_models tm
        LEFT JOIN training_jobs tj ON tm.job_id = tj.job_id
        ORDER BY tm.created_at DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, {"limit": limit, "offset": offset})

    total = execute_query("SELECT COUNT(*) as cnt FROM trained_models")
    return {"models": models, "total": total[0]["cnt"] if total else 0}


class PublishPayload(BaseModel):
    uc_model_name: Optional[str] = None


@router.post("/jobs/{job_id}/publish")
async def publish_job_model(job_id: int, payload: PublishPayload = None):
    """Create a trained_model from a completed job, activate it, and register in UC."""
    if payload is None:
        payload = PublishPayload()

    job = execute_query(
        "SELECT * FROM training_jobs WHERE job_id = %(jid)s", {"jid": job_id})
    if not job:
        raise HTTPException(404, "Job not found")
    job = job[0]
    if job["status"] != "COMPLETED":
        raise HTTPException(400, "Job not completed")

    # Check if model already exists for this job
    existing = execute_query(
        "SELECT model_id FROM trained_models WHERE job_id = %(jid)s", {"jid": job_id})
    if existing:
        model_id = existing[0]["model_id"]
    else:
        # Parse metrics
        metrics = {}
        if job.get("metrics_json"):
            try:
                metrics = json.loads(job["metrics_json"])
            except Exception:
                pass
        if not metrics and job.get("results_path"):
            try:
                from server.yolo_trainer import parse_training_results
                metrics = parse_training_results(job["results_path"])
                if metrics:
                    execute_update(
                        "UPDATE training_jobs SET metrics_json = %(mj)s WHERE job_id = %(jid)s",
                        {"mj": json.dumps(metrics), "jid": job_id})
            except Exception:
                pass

        model_id = int(time.time() * 1000)
        model_path = metrics.get("best_model_path", f"{job.get('results_path', '')}/train/weights/best.pt")
        context_id = job.get("context_id")
        model_display = f"yolov8{job.get('model_size', '?')}_e{job.get('epochs', '?')}"
        execute_update("""
            INSERT INTO trained_models
            (model_id, job_id, model_name, model_path, map50, map50_95,
             precision_val, recall_val, is_active, context_id, created_at)
            VALUES (%(mid)s, %(jid)s, %(mn)s, %(mp)s, %(m50)s, %(m5095)s,
                    %(prec)s, %(rec)s, FALSE, %(ctx)s, NOW())
        """, {
            "mid": model_id, "jid": job_id, "mn": model_display, "mp": model_path,
            "m50": metrics.get("map50", 0), "m5095": metrics.get("map50_95", 0),
            "prec": metrics.get("precision", 0), "rec": metrics.get("recall", 0),
            "ctx": context_id,
        })

    # Activate
    execute_update("UPDATE trained_models SET is_active = FALSE")
    execute_update("UPDATE trained_models SET is_active = TRUE WHERE model_id = %(mid)s", {"mid": model_id})

    # Register in Unity Catalog
    uc_full_name = None
    uc_version = None
    uc_error = None
    try:
        model_row = execute_query(
            "SELECT model_name, model_path, map50, map50_95, precision_val, recall_val FROM trained_models WHERE model_id = %(mid)s",
            {"mid": model_id})
        if not model_row:
            raise ValueError("Model record not found after insert")

        mr = model_row[0]
        model_path_vol = mr.get("model_path", "")

        # UC model name: user-provided or default
        uc_short_name = payload.uc_model_name or "yolo_detector"
        uc_short_name = uc_short_name.lower().strip().replace(" ", "_").replace("-", "_")
        uc_full_name = f"jsf_demo_catalog.scenic_crawler.{uc_short_name}"

        w = get_workspace_client()
        import tempfile, shutil

        # Step 1: Download model weights from Volume
        weight_paths = []
        if job.get("results_path"):
            rp = job["results_path"]
            weight_paths += [f"{rp}/train/weights/best.pt", f"{rp}/train/weights/last.pt"]
        if model_path_vol:
            weight_paths.append(model_path_vol)
            if model_path_vol.endswith("best.pt"):
                weight_paths.append(model_path_vol.replace("best.pt", "last.pt"))

        model_bytes = None
        for wp in weight_paths:
            try:
                resp_dl = w.files.download(wp)
                model_bytes = resp_dl.contents.read()
                if model_bytes and len(model_bytes) > 100:
                    logger.info(f"Downloaded weights: {wp} ({len(model_bytes)} bytes)")
                    break
                model_bytes = None
            except Exception:
                continue
        if not model_bytes:
            raise ValueError("Model weights not found in Volume")

        # Step 2: Save locally and register via MLflow with proper artifact format
        tmp_dir = tempfile.mkdtemp()
        local_model = os.path.join(tmp_dir, "model.pt")
        with open(local_model, "wb") as f:
            f.write(model_bytes)

        import mlflow
        import mlflow.pyfunc
        from mlflow.models.signature import ModelSignature
        from mlflow.types.schema import Schema, ColSpec
        mlflow.set_tracking_uri("databricks")
        mlflow.set_registry_uri("databricks-uc")
        mlflow.set_experiment("/Shared/inventario-inteligente/yolo-training")

        with mlflow.start_run(run_name=f"publish_{uc_short_name}") as run:
            for key, val in [("map50", mr.get("map50")), ("map50_95", mr.get("map50_95")),
                             ("precision", mr.get("precision_val")), ("recall", mr.get("recall_val"))]:
                if val:
                    mlflow.log_metric(key, float(val))
            mlflow.log_params({"model_size": job.get("model_size", "?"), "epochs": job.get("epochs", "?")})

            class _YOLOWrapper(mlflow.pyfunc.PythonModel):
                def predict(self, context, model_input):
                    return []

            signature = ModelSignature(
                inputs=Schema([ColSpec("binary", "image")]),
                outputs=Schema([ColSpec("string", "detections")]),
            )

            mlflow.pyfunc.log_model(
                artifact_path="model",
                python_model=_YOLOWrapper(),
                artifacts={"weights": local_model},
                signature=signature,
            )

            model_uri = f"runs:/{run.info.run_id}/model"
            registered = mlflow.register_model(model_uri, uc_full_name)
            uc_version = registered.version
            logger.info(f"Registered UC model: {uc_full_name} v{uc_version}")

        shutil.rmtree(tmp_dir, ignore_errors=True)

    except Exception as e:
        uc_error = str(e)
        logger.error(f"UC registration failed: {e}", exc_info=True)

    result = {"model_id": model_id, "activated": True}
    if uc_full_name:
        result["uc_model"] = uc_full_name
    if uc_version:
        result["uc_version"] = str(uc_version)
    if uc_error:
        result["uc_error"] = uc_error
    return result


@router.post("/models/{model_id}/activate")
async def activate_model(model_id: int):
    """Set a model as the active detection model."""
    rows = execute_query(
        "SELECT model_id FROM trained_models WHERE model_id = %(mid)s",
        {"mid": model_id},
    )
    if not rows:
        raise HTTPException(404, "Model not found")

    # Deactivate all models
    execute_update("UPDATE trained_models SET is_active = FALSE")

    # Activate selected model
    execute_update(
        "UPDATE trained_models SET is_active = TRUE WHERE model_id = %(mid)s",
        {"mid": model_id},
    )

    return {"model_id": model_id, "is_active": True}


@router.delete("/models/{model_id}")
async def delete_model(model_id: int):
    """Delete a trained model."""
    rows = execute_query(
        "SELECT model_path FROM trained_models WHERE model_id = %(mid)s",
        {"mid": model_id},
    )
    if not rows:
        raise HTTPException(404, "Model not found")

    # Try to delete model file from Volume
    if rows[0].get("model_path"):
        try:
            w = get_workspace_client()
            w.files.delete(rows[0]["model_path"])
        except Exception as e:
            logger.warning(f"Could not delete model file: {e}")

    execute_update("DELETE FROM trained_models WHERE model_id = %(mid)s", {"mid": model_id})
    return {"deleted": True, "model_id": model_id}


# ===========================================================================
# Detection Mode
# ===========================================================================

@router.get("/detection-mode")
async def get_detection_mode():
    """Get current detection mode (LLM, YOLO, HYBRID)."""
    from server.database import get_config
    mode = get_config("detection_mode", "LLM")

    # Also get active model info if mode uses YOLO
    active_model = None
    if mode in ("YOLO", "HYBRID"):
        models = execute_query(
            "SELECT * FROM trained_models WHERE is_active = TRUE LIMIT 1"
        )
        if models:
            active_model = models[0]

    return {"mode": mode, "active_model": active_model}


@router.put("/detection-mode")
async def set_detection_mode(payload: DetectionModePayload):
    """Set detection mode."""
    valid_modes = ("LLM", "YOLO", "HYBRID")
    mode = payload.mode.upper()
    if mode not in valid_modes:
        raise HTTPException(400, f"Invalid mode. Must be one of: {valid_modes}")

    # If setting YOLO or HYBRID, ensure there's an active model
    if mode in ("YOLO", "HYBRID"):
        active = execute_query("SELECT model_id FROM trained_models WHERE is_active = TRUE LIMIT 1")
        if not active:
            raise HTTPException(400, "No active YOLO model. Train and activate a model first.")

    # Update configuration
    existing = execute_query(
        "SELECT config_id FROM configurations WHERE config_key = 'detection_mode'"
    )
    if existing:
        execute_update(
            "UPDATE configurations SET config_value = %(v)s, updated_at = NOW() WHERE config_key = 'detection_mode'",
            {"v": mode},
        )
    else:
        execute_update("""
            INSERT INTO configurations (config_id, config_key, config_value, description, updated_at)
            VALUES (%(id)s, 'detection_mode', %(v)s, 'Modo de deteccao: LLM, YOLO ou HYBRID', NOW())
        """, {"id": int(time.time() * 1000), "v": mode})

    return {"mode": mode}


# ===========================================================================
# Stats
# ===========================================================================

@router.get("/stats")
async def get_training_stats():
    """Dataset statistics: total images, annotations per type, etc."""
    total_images = execute_query("SELECT COUNT(*) as cnt FROM training_images")
    annotated_images = execute_query(
        "SELECT COUNT(*) as cnt FROM training_images WHERE annotation_count > 0"
    )
    total_annotations = execute_query("SELECT COUNT(*) as cnt FROM training_annotations")

    # Annotations per fixture type
    type_counts = execute_query("""
        SELECT fixture_type, COUNT(*) as count
        FROM training_annotations
        GROUP BY fixture_type
        ORDER BY count DESC
    """)

    # Training jobs summary
    job_stats = execute_query("""
        SELECT status, COUNT(*) as count
        FROM training_jobs
        GROUP BY status
    """)

    # Trained models count
    total_models = execute_query("SELECT COUNT(*) as cnt FROM trained_models")
    active_model = execute_query(
        "SELECT model_id, model_name, map50, map50_95 FROM trained_models WHERE is_active = TRUE LIMIT 1"
    )

    # Detection mode
    from server.database import get_config
    detection_mode = get_config("detection_mode", "LLM")

    return {
        "total_images": total_images[0]["cnt"] if total_images else 0,
        "annotated_images": annotated_images[0]["cnt"] if annotated_images else 0,
        "total_annotations": total_annotations[0]["cnt"] if total_annotations else 0,
        "annotations_by_type": {row["fixture_type"]: row["count"] for row in type_counts},
        "job_stats": {row["status"]: row["count"] for row in job_stats},
        "total_models": total_models[0]["cnt"] if total_models else 0,
        "active_model": active_model[0] if active_model else None,
        "detection_mode": detection_mode,
    }
