"""Video processing pipeline for retail fixture detection and counting."""

import os
import io
import base64
import hashlib
import logging
import time
import json
import tempfile
import re
from datetime import datetime

import av
from PIL import Image as PILImage

from server.database import execute_query, execute_update, get_workspace_client, get_config
from server.fmapi import analyze_frame_fixtures
from server.fixture_tracker import FixtureTracker

logger = logging.getLogger(__name__)

THUMBNAIL_VOLUME = os.environ.get("THUMBNAIL_VOLUME", "/Volumes/scenic_crawler/default/thumbnails")
VIDEO_VOLUME = os.environ.get("VIDEO_VOLUME", "/Volumes/scenic_crawler/default/uploaded_videos")


def _get_detection_function(context_id: int = None):
    """Return the appropriate detection function based on the configured detection_mode.

    Reads the 'detection_mode' config key and returns a callable that accepts frame_b64.
    When context_id is provided, wraps LLM detection to pass it through.
    """
    from server.yolo_detector import detect_fixtures_yolo, detect_fixtures_hybrid
    mode = get_config("detection_mode", "LLM").upper().strip()
    if mode == "YOLO":
        logger.info("Detection mode: YOLO")
        if context_id:
            def _yolo_with_context(frame_b64):
                return detect_fixtures_yolo(frame_b64, context_id=context_id)
            return _yolo_with_context
        return detect_fixtures_yolo
    elif mode == "HYBRID":
        logger.info("Detection mode: HYBRID (YOLO + LLM)")
        if context_id:
            def _hybrid_with_context(frame_b64):
                return detect_fixtures_hybrid(frame_b64, context_id=context_id)
            return _hybrid_with_context
        return detect_fixtures_hybrid
    else:
        logger.info("Detection mode: LLM")
        if context_id:
            def _llm_with_context(frame_b64):
                return analyze_frame_fixtures(frame_b64, context_id=context_id)
            return _llm_with_context
        return analyze_frame_fixtures


def parse_video_filename(filename: str) -> dict:
    """Parse filename in format UF_IDLOJA_yyyymmdd.mp4

    Returns dict with uf, store_id, video_date or raises ValueError.
    """
    name = filename.rsplit(".", 1)[0] if "." in filename else filename
    parts = name.split("_")
    if len(parts) < 3:
        raise ValueError(f"Formato invalido: esperado UF_IDLOJA_yyyymmdd, recebido: {filename}")

    uf = parts[0].upper()
    store_id = parts[1]
    date_str = parts[2]

    if len(uf) != 2:
        raise ValueError(f"UF invalida: {uf}")

    valid_ufs = [
        "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
        "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
        "SP", "SE", "TO",
    ]
    if uf not in valid_ufs:
        raise ValueError(f"UF invalida: {uf}")

    try:
        video_date = datetime.strptime(date_str, "%Y%m%d").date()
    except ValueError:
        raise ValueError(f"Data invalida: {date_str}, esperado formato yyyymmdd")

    return {"uf": uf, "store_id": store_id, "video_date": video_date}


IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff', '.tif'}
VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v', '.mpg', '.mpeg', '.wmv', '.flv', '.3gp', '.ts', '.mts', '.m2ts', '.vob', '.ogv'}


def is_image_file(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in IMAGE_EXTENSIONS


def get_video_metadata(video_path: str) -> dict:
    try:
        container = av.open(video_path)
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 30)
        total = stream.frames or 0
        w = stream.codec_context.width
        h = stream.codec_context.height
        duration = float(stream.duration * stream.time_base) if stream.duration else 0
        container.close()
        return {
            "fps": fps,
            "total_frames": total,
            "duration_seconds": duration,
            "resolution": f"{w}x{h}",
        }
    except Exception:
        return {}


def save_thumbnail(video_id: int, frame_bytes: bytes, timestamp_sec: float) -> str:
    filename = f"v{video_id}_t{timestamp_sec:.1f}.jpg"
    local_dir = tempfile.mkdtemp()
    local_path = os.path.join(local_dir, filename)

    with open(local_path, "wb") as f:
        f.write(frame_bytes)

    volume_path = f"{THUMBNAIL_VOLUME}/{filename}"
    try:
        w = get_workspace_client()
        with open(local_path, "rb") as fh:
            w.files.upload(volume_path, fh, overwrite=True)
    except Exception as e:
        logger.error(f"Failed to upload thumbnail: {e}")

    os.unlink(local_path)
    os.rmdir(local_dir)
    return filename


def ensure_store_exists(store_id: str, uf: str):
    """Create store record if it doesn't exist."""
    rows = execute_query("SELECT store_id FROM stores WHERE store_id = %(sid)s", {"sid": store_id})
    if not rows:
        execute_update(
            "INSERT INTO stores (store_id, uf) VALUES (%(sid)s, %(uf)s)",
            {"sid": store_id, "uf": uf},
        )


def process_video(video_id: int, local_path: str, progress_callback=None):
    """Main video processing pipeline for fixture detection."""
    start_time = time.time()

    scan_fps = float(get_config("scan_fps", "0.5"))
    confidence_threshold = float(get_config("confidence_threshold", "0.6"))
    dedup_threshold = float(get_config("dedup_position_threshold", "15"))

    # Read video's context_id for context-aware detection
    video_ctx = execute_query("SELECT context_id FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
    context_id = video_ctx[0]["context_id"] if video_ctx and video_ctx[0].get("context_id") else None

    detect_fn = _get_detection_function(context_id)

    logger.info(f"[V{video_id}] Starting fixture detection: {local_path}")
    logger.info(f"[V{video_id}] Config: scan_fps={scan_fps}, confidence={confidence_threshold}, dedup={dedup_threshold}")

    execute_update(
        "UPDATE videos SET status = 'PROCESSING', progress_pct = 0 WHERE video_id = %(vid)s",
        {"vid": video_id},
    )

    # Log start
    log_id = int(time.time() * 1000)
    execute_update(
        "INSERT INTO processing_log (log_id, video_id, started_at, status) VALUES (%(lid)s, %(vid)s, NOW(), 'RUNNING')",
        {"lid": log_id, "vid": video_id},
    )

    try:
        container = av.open(local_path)
    except Exception:
        _fail_video(video_id, log_id, "Nao foi possivel abrir o video")
        return

    stream = container.streams.video[0]
    video_fps = float(stream.average_rate or 30)
    total_frames = stream.frames or 0
    duration = float(stream.duration * stream.time_base) if stream.duration else 0
    frame_interval = max(1, int(video_fps / scan_fps)) if scan_fps < video_fps else 1
    frames_to_analyze = max(1, total_frames // frame_interval) if total_frames > 0 else 100

    logger.info(f"[V{video_id}] Video: {duration:.1f}s, {video_fps:.1f}fps, analyzing ~{frames_to_analyze} frames")

    tracker = FixtureTracker(position_threshold=dedup_threshold)
    all_detections = []
    frame_idx = 0
    analyzed_count = 0
    thumbnail_map = {}  # tracking_id -> (best_confidence, thumbnail_path)

    for frame in container.decode(video=0):
        if frame_idx % frame_interval == 0:
            timestamp = frame_idx / video_fps

            # Convert to PIL and resize for efficiency
            img = frame.to_image()
            w, h = img.size
            if w > 640:
                scale = 640 / w
                img = img.resize((640, int(h * scale)))

            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=80)
            jpeg_bytes = buf.getvalue()
            frame_b64 = base64.b64encode(jpeg_bytes).decode()

            logger.info(f"[V{video_id}] Analyzing frame {analyzed_count+1}/{frames_to_analyze} at t={timestamp:.1f}s")

            try:
                detections = detect_fn(frame_b64)
                logger.info(f"[V{video_id}] Found {len(detections)} fixtures in frame")
            except Exception as e:
                logger.error(f"[V{video_id}] Frame analysis error: {e}")
                detections = []

            # Filter by confidence
            detections = [d for d in detections if d.get("confidence", 0) >= confidence_threshold]

            # Feed to tracker and get tracking_id mapping
            det_to_track = tracker.process_frame(detections, frame_idx, timestamp)

            # Save frame thumbnail (every analyzed frame gets one for review)
            frame_thumb = save_thumbnail(video_id, jpeg_bytes, timestamp)

            # Save raw detections with frame thumbnail and tracking_id
            for di, det in enumerate(detections):
                det_id = int(time.time() * 1000000) + len(all_detections)
                pos = det.get("position", {})
                all_detections.append({
                    "detection_id": det_id,
                    "video_id": video_id,
                    "frame_index": frame_idx,
                    "timestamp_sec": timestamp,
                    "fixture_type": det["type"],
                    "confidence": det["confidence"],
                    "bbox_x": pos.get("x", 50),
                    "bbox_y": pos.get("y", 50),
                    "occupancy_level": det.get("occupancy", "PARCIAL"),
                    "occupancy_pct": det.get("occupancy_pct", 50),
                    "ai_description": det.get("description", ""),
                    "thumbnail_path": frame_thumb,
                    "tracking_id": det_to_track.get(di),
                })

            # Also track best thumbnail per unique fixture
            for tf in tracker.tracked_fixtures:
                if tf.best_frame_index == frame_idx:
                    thumbnail_map[tf.tracking_id] = frame_thumb

            analyzed_count += 1
            pct = (analyzed_count / max(1, frames_to_analyze)) * 95
            execute_update(
                "UPDATE videos SET progress_pct = %(pct)s, frames_analyzed = %(fa)s WHERE video_id = %(vid)s",
                {"vid": video_id, "pct": pct, "fa": analyzed_count},
            )
            if progress_callback:
                progress_callback(video_id, pct)

        frame_idx += 1

    container.close()

    # Get unique fixtures from tracker
    unique_fixtures = tracker.get_unique_fixtures(min_frames=1)
    logger.info(f"[V{video_id}] Analysis complete. {len(all_detections)} raw detections -> {len(unique_fixtures)} unique fixtures")

    # Get video info for store/UF
    video_info = execute_query("SELECT store_id, uf, video_date FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
    if not video_info:
        _fail_video(video_id, log_id, "Video nao encontrado no banco")
        return

    store_id = video_info[0]["store_id"]
    uf = video_info[0]["uf"]
    video_date = video_info[0]["video_date"]

    # Persist raw detections (for review)
    _save_detections(all_detections)

    # Persist fixtures
    _save_fixtures(video_id, unique_fixtures, thumbnail_map, store_id, uf, video_date, context_id)

    # Generate summary
    _generate_summary(video_id, unique_fixtures, store_id, uf, video_date, context_id)

    # Detect anomalies
    _detect_anomalies(video_id, unique_fixtures, store_id, uf, context_id)

    # Update processing log
    processing_time = time.time() - start_time
    execute_update("""
        UPDATE processing_log SET completed_at = NOW(), status = 'SUCCESS',
            processing_time_sec = %(t)s, frames_total = %(ft)s,
            frames_analyzed = %(fa)s, fixtures_detected = %(fd)s
        WHERE log_id = %(lid)s
    """, {"t": processing_time, "ft": total_frames, "fa": analyzed_count,
          "fd": len(unique_fixtures), "lid": log_id})

    # Mark video complete
    execute_update(
        "UPDATE videos SET status = 'COMPLETED', progress_pct = 100, frames_analyzed = %(fa)s WHERE video_id = %(vid)s",
        {"vid": video_id, "fa": analyzed_count},
    )
    if progress_callback:
        progress_callback(video_id, 100)

    logger.info(f"[V{video_id}] Done! {len(unique_fixtures)} unique fixtures in {processing_time:.1f}s")


def _save_detections(all_detections):
    """Persist raw per-frame detections to the database for review."""
    for det in all_detections:
        execute_update("""
            INSERT INTO detections
            (detection_id, video_id, frame_index, timestamp_sec, fixture_type,
             confidence, bbox_x, bbox_y, thumbnail_path, ai_description,
             occupancy_level, occupancy_pct, tracking_id)
            VALUES (%(did)s, %(vid)s, %(fi)s, %(ts)s, %(ft)s,
                    %(conf)s, %(bx)s, %(by)s, %(thumb)s, %(desc)s,
                    %(occ)s, %(occ_pct)s, %(tid)s)
        """, {
            "did": det["detection_id"], "vid": det["video_id"],
            "fi": det["frame_index"], "ts": det["timestamp_sec"],
            "ft": det["fixture_type"], "conf": det["confidence"],
            "bx": det["bbox_x"], "by": det["bbox_y"],
            "thumb": det.get("thumbnail_path", ""),
            "desc": det.get("ai_description", ""),
            "occ": det.get("occupancy_level", "PARCIAL"),
            "occ_pct": det.get("occupancy_pct", 50),
            "tid": det.get("tracking_id"),
        })


def _save_fixtures(video_id, unique_fixtures, thumbnail_map, store_id, uf, video_date, context_id=None):
    for tf in unique_fixtures:
        fixture_id = int(time.time() * 1000000) + tf.tracking_id
        thumb = thumbnail_map.get(tf.tracking_id, "")
        execute_update("""
            INSERT INTO fixtures
            (fixture_id, video_id, store_id, uf, video_date, fixture_type, tracking_id,
             first_seen_sec, last_seen_sec, frame_count, avg_confidence,
             best_thumbnail_path, occupancy_level, occupancy_pct, ai_description, position_zone, context_id)
            VALUES (%(fid)s, %(vid)s, %(sid)s, %(uf)s, %(vd)s, %(ft)s, %(tid)s,
                    %(first)s, %(last)s, %(fc)s, %(conf)s,
                    %(thumb)s, %(occ)s, %(occ_pct)s, %(desc)s, %(zone)s, %(ctx)s)
        """, {
            "fid": fixture_id, "vid": video_id, "sid": store_id, "uf": uf,
            "vd": video_date, "ft": tf.fixture_type, "tid": tf.tracking_id,
            "first": tf.first_seen_sec, "last": tf.last_seen_sec,
            "fc": tf.frame_count, "conf": tf.avg_confidence,
            "thumb": thumb, "occ": tf.dominant_occupancy,
            "occ_pct": tf.avg_occupancy_pct, "desc": tf.best_description,
            "zone": tf.zone, "ctx": context_id,
        })


def _generate_summary(video_id, unique_fixtures, store_id, uf, video_date, context_id=None):
    """Generate fixture_summary aggregation by type."""
    # Delete old summary for this video
    execute_update("DELETE FROM fixture_summary WHERE video_id = %(vid)s", {"vid": video_id})

    # Aggregate by type
    by_type = {}
    for tf in unique_fixtures:
        if tf.fixture_type not in by_type:
            by_type[tf.fixture_type] = {"fixtures": [], "occupancy_pcts": []}
        by_type[tf.fixture_type]["fixtures"].append(tf)
        by_type[tf.fixture_type]["occupancy_pcts"].append(tf.avg_occupancy_pct)

    for ftype, data in by_type.items():
        fixtures = data["fixtures"]
        occ_pcts = data["occupancy_pcts"]
        avg_occ = sum(occ_pcts) / len(occ_pcts) if occ_pcts else 0
        empty = sum(1 for tf in fixtures if tf.dominant_occupancy == "VAZIO")
        partial = sum(1 for tf in fixtures if tf.dominant_occupancy == "PARCIAL")
        full = sum(1 for tf in fixtures if tf.dominant_occupancy == "CHEIO")

        summary_id = int(time.time() * 1000000) + hash(ftype) % 10000
        execute_update("""
            INSERT INTO fixture_summary
            (summary_id, video_id, store_id, uf, video_date, fixture_type,
             total_count, avg_occupancy_pct, empty_count, partial_count, full_count, context_id)
            VALUES (%(sid)s, %(vid)s, %(store)s, %(uf)s, %(vd)s, %(ft)s,
                    %(count)s, %(avg_occ)s, %(empty)s, %(partial)s, %(full)s, %(ctx)s)
        """, {
            "sid": summary_id, "vid": video_id, "store": store_id, "uf": uf,
            "vd": video_date, "ft": ftype, "count": len(fixtures),
            "avg_occ": avg_occ, "empty": empty, "partial": partial, "full": full,
            "ctx": context_id,
        })


def _detect_anomalies(video_id, unique_fixtures, store_id, uf, context_id=None):
    """Detect anomalies by comparing store fixture counts to UF averages."""
    try:
        anomaly_threshold = float(get_config("anomaly_std_threshold", "1.5"))
    except Exception:
        anomaly_threshold = 1.5

    # Count fixtures by type for this video
    current_counts = {}
    for tf in unique_fixtures:
        current_counts[tf.fixture_type] = current_counts.get(tf.fixture_type, 0) + 1

    total_current = sum(current_counts.values())

    # Get UF average (from fixture_summary of other stores in same UF)
    try:
        rows = execute_query("""
            SELECT fixture_type, AVG(total_count) as avg_count, STDDEV(total_count) as std_count
            FROM fixture_summary
            WHERE uf = %(uf)s AND store_id != %(sid)s
            GROUP BY fixture_type
        """, {"uf": uf, "sid": store_id})

        uf_stats = {r["fixture_type"]: r for r in rows}

        for ftype, count in current_counts.items():
            if ftype in uf_stats:
                avg = float(uf_stats[ftype]["avg_count"] or 0)
                std = float(uf_stats[ftype]["std_count"] or 0)
                if std > 0 and abs(count - avg) > anomaly_threshold * std:
                    direction = "abaixo" if count < avg else "acima"
                    severity = "HIGH" if abs(count - avg) > 2 * std else "MEDIUM"
                    anomaly_id = int(time.time() * 1000000) + hash(ftype) % 10000
                    execute_update("""
                        INSERT INTO anomalies (anomaly_id, store_id, uf, video_id, anomaly_type, severity, message, details, context_id)
                        VALUES (%(aid)s, %(sid)s, %(uf)s, %(vid)s, 'FIXTURE_COUNT', %(sev)s, %(msg)s, %(det)s, %(ctx)s)
                    """, {
                        "aid": anomaly_id, "sid": store_id, "uf": uf, "vid": video_id,
                        "sev": severity,
                        "msg": f"Loja {store_id} tem {count} {ftype}(s), significativamente {direction} da media da UF ({avg:.1f})",
                        "det": json.dumps({"fixture_type": ftype, "count": count, "uf_avg": avg, "uf_std": std}),
                        "ctx": context_id,
                    })

        # Check low occupancy anomaly
        total_occupancy = sum(tf.avg_occupancy_pct for tf in unique_fixtures) / max(1, len(unique_fixtures))
        if total_occupancy < 30 and len(unique_fixtures) > 0:
            anomaly_id = int(time.time() * 1000000) + 99999
            execute_update("""
                INSERT INTO anomalies (anomaly_id, store_id, uf, video_id, anomaly_type, severity, message, details, context_id)
                VALUES (%(aid)s, %(sid)s, %(uf)s, %(vid)s, 'LOW_OCCUPANCY', 'HIGH', %(msg)s, %(det)s, %(ctx)s)
            """, {
                "aid": anomaly_id, "sid": store_id, "uf": uf, "vid": video_id,
                "msg": f"Loja {store_id} com ocupacao media de {total_occupancy:.0f}% - possivel necessidade de reabastecimento",
                "det": json.dumps({"avg_occupancy_pct": total_occupancy}),
                "ctx": context_id,
            })

    except Exception as e:
        logger.warning(f"Anomaly detection error: {e}")


def process_photo(video_id: int, local_path: str, progress_callback=None):
    """Process a single photo for fixture detection. Treated as a 1-frame video."""
    from PIL import Image as PILImage
    start_time = time.time()

    confidence_threshold = float(get_config("confidence_threshold", "0.6"))

    # Read video's context_id for context-aware detection
    video_ctx = execute_query("SELECT context_id FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
    context_id = video_ctx[0]["context_id"] if video_ctx and video_ctx[0].get("context_id") else None

    detect_fn = _get_detection_function(context_id)

    logger.info(f"[P{video_id}] Starting photo analysis: {local_path}")

    execute_update("UPDATE videos SET status = 'PROCESSING', progress_pct = 0 WHERE video_id = %(vid)s", {"vid": video_id})

    log_id = int(time.time() * 1000)
    execute_update(
        "INSERT INTO processing_log (log_id, video_id, started_at, status) VALUES (%(lid)s, %(vid)s, NOW(), 'RUNNING')",
        {"lid": log_id, "vid": video_id},
    )

    try:
        img = PILImage.open(local_path).convert("RGB")
    except Exception:
        _fail_video(video_id, log_id, "Nao foi possivel abrir a imagem")
        return

    # Resize for FMAPI
    w, h = img.size
    if w > 640:
        ratio = 640 / w
        img = img.resize((640, int(h * ratio)))

    import io
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    jpeg_bytes = buf.getvalue()
    frame_b64 = base64.b64encode(jpeg_bytes).decode()

    # Save thumbnail
    thumb = save_thumbnail(video_id, jpeg_bytes, 0.0)

    execute_update("UPDATE videos SET progress_pct = 20 WHERE video_id = %(vid)s", {"vid": video_id})
    if progress_callback:
        progress_callback(video_id, 20)

    # Analyze
    try:
        detections = detect_fn(frame_b64)
        logger.info(f"[P{video_id}] Found {len(detections)} fixtures")
    except Exception as e:
        logger.error(f"[P{video_id}] Analysis error: {e}")
        detections = []

    detections = [d for d in detections if d.get("confidence", 0) >= confidence_threshold]

    execute_update("UPDATE videos SET progress_pct = 70 WHERE video_id = %(vid)s", {"vid": video_id})

    # Save detections (each detection = a unique fixture for photos)
    all_detections = []
    for i, det in enumerate(detections):
        det_id = int(time.time() * 1000000) + i
        pos = det.get("position", {})
        all_detections.append({
            "detection_id": det_id, "video_id": video_id,
            "frame_index": 0, "timestamp_sec": 0.0,
            "fixture_type": det["type"], "confidence": det["confidence"],
            "bbox_x": pos.get("x", 50), "bbox_y": pos.get("y", 50),
            "occupancy_level": det.get("occupancy", "PARCIAL"),
            "occupancy_pct": det.get("occupancy_pct", 50),
            "ai_description": det.get("description", ""),
            "thumbnail_path": thumb, "tracking_id": i + 1,
        })

    _save_detections(all_detections)

    # For photos, each detection is already unique (1 frame = no dedup needed)
    video_info = execute_query("SELECT store_id, uf, video_date FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
    if not video_info:
        _fail_video(video_id, log_id, "Registro nao encontrado")
        return

    store_id = video_info[0]["store_id"]
    uf = video_info[0]["uf"]
    video_date = video_info[0]["video_date"]

    # Save each detection as a unique fixture
    for i, det in enumerate(all_detections):
        fixture_id = int(time.time() * 1000000) + i + 1000
        execute_update("""
            INSERT INTO fixtures
            (fixture_id, video_id, store_id, uf, video_date, fixture_type, tracking_id,
             first_seen_sec, last_seen_sec, frame_count, avg_confidence,
             best_thumbnail_path, occupancy_level, occupancy_pct, ai_description, position_zone, context_id)
            VALUES (%(fid)s, %(vid)s, %(sid)s, %(uf)s, %(vd)s, %(ft)s, %(tid)s,
                    0, 0, 1, %(conf)s, %(thumb)s, %(occ)s, %(occ_pct)s, %(desc)s, %(zone)s, %(ctx)s)
        """, {
            "fid": fixture_id, "vid": video_id, "sid": store_id, "uf": uf,
            "vd": video_date, "ft": det["fixture_type"], "tid": det["tracking_id"],
            "conf": det["confidence"], "thumb": thumb,
            "occ": det["occupancy_level"], "occ_pct": det["occupancy_pct"],
            "desc": det["ai_description"], "zone": "", "ctx": context_id,
        })

    # Build tracker-compatible list for summary/anomaly
    class _FakeTrack:
        def __init__(self, d):
            self.fixture_type = d["fixture_type"]
            self.avg_occupancy_pct = d["occupancy_pct"]
            self.dominant_occupancy = d["occupancy_level"]

    fake_tracks = [_FakeTrack(d) for d in all_detections]
    _generate_summary(video_id, fake_tracks, store_id, uf, video_date, context_id)
    _detect_anomalies(video_id, fake_tracks, store_id, uf, context_id)

    processing_time = time.time() - start_time
    execute_update("""
        UPDATE processing_log SET completed_at = NOW(), status = 'SUCCESS',
            processing_time_sec = %(t)s, frames_total = 1, frames_analyzed = 1,
            fixtures_detected = %(fd)s WHERE log_id = %(lid)s
    """, {"t": processing_time, "fd": len(all_detections), "lid": log_id})

    execute_update(
        "UPDATE videos SET status = 'COMPLETED', progress_pct = 100, frames_analyzed = 1 WHERE video_id = %(vid)s",
        {"vid": video_id},
    )
    if progress_callback:
        progress_callback(video_id, 100)

    logger.info(f"[P{video_id}] Done! {len(all_detections)} fixtures in {processing_time:.1f}s")


def _fail_video(video_id, log_id, message):
    execute_update(
        "UPDATE videos SET status = 'FAILED', error_message = %(msg)s WHERE video_id = %(vid)s",
        {"vid": video_id, "msg": message},
    )
    execute_update(
        "UPDATE processing_log SET completed_at = NOW(), status = 'FAILED', error_message = %(msg)s WHERE log_id = %(lid)s",
        {"lid": log_id, "msg": message},
    )
