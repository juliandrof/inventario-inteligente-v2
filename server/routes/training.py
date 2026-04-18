"""Training routes - YOLO model training, image annotation, and model management."""

import base64
import json
import logging
import os
import tempfile
import time
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
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

@router.post("/images/upload")
async def upload_training_image(file: UploadFile = File(...)):
    """Upload a training image to Volume."""
    filename = file.filename or f"image_{int(time.time() * 1000)}.jpg"

    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")

    # Determine image dimensions
    width, height = 0, 0
    tmp = tempfile.NamedTemporaryFile(suffix=os.path.splitext(filename)[1], delete=False)
    try:
        tmp.write(content)
        tmp.close()
        try:
            from PIL import Image as PILImage
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
        import io
        w = get_workspace_client()
        w.files.upload(volume_path, io.BytesIO(content), overwrite=True)
    except Exception as e:
        raise HTTPException(500, f"Failed to upload to Volume: {e}")

    image_id = int(time.time() * 1000)
    execute_update("""
        INSERT INTO training_images (image_id, filename, volume_path, width, height, annotation_count, uploaded_at)
        VALUES (%(iid)s, %(fn)s, %(vp)s, %(w)s, %(h)s, 0, NOW())
    """, {"iid": image_id, "fn": filename, "vp": volume_path, "w": width, "h": height})

    return {
        "image_id": image_id,
        "filename": filename,
        "volume_path": volume_path,
        "width": width,
        "height": height,
    }


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

    result = dict(rows[0])
    result["image_url"] = f"/api/training/images/{image_id}/stream"
    result["thumbnail_url"] = result["image_url"]
    result["annotations"] = annotations
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

        # For videos, extract first frame as JPEG thumbnail
        if is_video:
            try:
                import cv2
                import numpy as np
                nparr = np.frombuffer(content, np.uint8)
                tmp_path = f"/tmp/train_thumb_{image_id}.{ext}"
                with open(tmp_path, "wb") as f:
                    f.write(content)
                cap = cv2.VideoCapture(tmp_path)
                ret, frame = cap.read()
                cap.release()
                os.remove(tmp_path)
                if ret:
                    _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    content = jpeg.tobytes()
                    mime = "image/jpeg"
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
        import cv2
        tmp_path = f"/tmp/auto_ann_{image_id}.{ext}"
        with open(tmp_path, "wb") as f:
            f.write(file_bytes)
        cap = cv2.VideoCapture(tmp_path)
        ret, frame = cap.read()
        cap.release()
        os.remove(tmp_path)
        if not ret:
            raise HTTPException(500, "Could not extract frame from video")
        _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        file_bytes = jpeg.tobytes()

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
    # FMAPI returns: {"type": "GONDOLA", "position": {"x": 30, "y": 50}, ...}
    # position.x and position.y are percentages (0-100) representing the CENTER
    # We need to store as x_center, y_center (0-100) and estimate w, h
    annotations_created = 0
    for det in detections:
        pos = det.get("position", {})
        x_center = float(pos.get("x", 50))
        y_center = float(pos.get("y", 50))
        fixture_type = det.get("type", "UNKNOWN")

        # Estimate bounding box size (default ~20% width, ~25% height)
        # These are reasonable defaults for retail fixtures in store images
        est_w = 20.0
        est_h = 25.0

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

    return {"image_id": image_id, "annotations": annotations}


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
    if payload.epochs < 1 or payload.epochs > 500:
        raise HTTPException(400, "Epochs must be between 1 and 500")
    if payload.batch_size < 1 or payload.batch_size > 128:
        raise HTTPException(400, "Batch size must be between 1 and 128")

    job_id = int(time.time() * 1000)

    # Save initial job record
    execute_update("""
        INSERT INTO training_jobs
        (job_id, model_size, epochs, batch_size, status, started_at)
        VALUES (%(jid)s, %(ms)s, %(ep)s, %(bs)s, 'PENDING', NOW())
    """, {"jid": job_id, "ms": payload.model_size, "ep": payload.epochs, "bs": payload.batch_size})

    try:
        # Step 1: Export dataset
        dataset_path = export_yolo_dataset()

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
            SET databricks_run_id = %(rid)s, status = 'RUNNING'
            WHERE job_id = %(jid)s
        """, {"rid": run_id, "jid": job_id})

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
    """List training jobs with status."""
    jobs = execute_query("""
        SELECT * FROM training_jobs
        ORDER BY started_at DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, {"limit": limit, "offset": offset})

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


@router.get("/jobs/{job_id}/status")
async def poll_job_status(job_id: int):
    """Poll Databricks job status and update DB."""
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
        w = get_workspace_client()
        run = w.jobs.get_run(dbx_run_id)
        life_cycle = run.state.life_cycle_state.value if run.state and run.state.life_cycle_state else "UNKNOWN"
        result_state = run.state.result_state.value if run.state and run.state.result_state else None

        # Map Databricks states to our states
        if life_cycle in ("TERMINATED",):
            if result_state == "SUCCESS":
                new_status = "COMPLETED"

                # Try to parse metrics
                from server.yolo_trainer import parse_training_results, MODELS_VOLUME
                try:
                    # Reconstruct results path from job info
                    metrics = parse_training_results(f"{MODELS_VOLUME}/results_{dbx_run_id}")
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
                            "mn": f"yolov8{job['model_size']}_e{job['epochs']}",
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
                error_msg = result_state or "Unknown error"
                execute_update("""
                    UPDATE training_jobs
                    SET status = 'FAILED', completed_at = NOW(), error_message = %(err)s
                    WHERE job_id = %(jid)s
                """, {"err": error_msg, "jid": job_id})

        elif life_cycle in ("INTERNAL_ERROR", "SKIPPED"):
            new_status = "FAILED"
            execute_update("""
                UPDATE training_jobs
                SET status = 'FAILED', completed_at = NOW(), error_message = %(err)s
                WHERE job_id = %(jid)s
            """, {"err": life_cycle, "jid": job_id})

        elif life_cycle in ("PENDING", "RUNNING", "BLOCKED"):
            new_status = "RUNNING"
        else:
            new_status = job["status"]

        return {
            "job_id": job_id,
            "databricks_run_id": dbx_run_id,
            "status": new_status,
            "life_cycle_state": life_cycle,
            "result_state": result_state,
        }

    except Exception as e:
        logger.error(f"Failed to poll job status: {e}")
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
        "annotations_per_type": type_counts,
        "job_stats": {row["status"]: row["count"] for row in job_stats},
        "total_models": total_models[0]["cnt"] if total_models else 0,
        "active_model": active_model[0] if active_model else None,
        "detection_mode": detection_mode,
    }
