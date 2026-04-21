"""YOLO-based fixture detection for retail store inventory.

Supports three detection modes:
- YOLO: Fast inference using trained YOLOv8 model (no LLM)
- HYBRID: YOLO for bounding boxes + LLM (FMAPI) for occupancy/description
- LLM: Handled by fmapi.py (not in this module)
"""

import base64
import logging
import os
import threading
from typing import Optional

import cv2
import numpy as np

from server.database import execute_query, get_workspace_client

logger = logging.getLogger(__name__)

# Singleton state for cached model
_model = None
_model_lock = threading.Lock()
_model_path_cached: Optional[str] = None

LOCAL_MODEL_PATH = "/tmp/yolo_model.pt"


def _get_active_model_info() -> Optional[dict]:
    """Get the active trained model record from the database."""
    try:
        rows = execute_query(
            "SELECT model_id, model_path, model_name FROM trained_models WHERE is_active = TRUE LIMIT 1"
        )
        if rows:
            return rows[0]
    except Exception as e:
        logger.error(f"Failed to query active model: {e}")
    return None


def _get_class_names() -> list[str]:
    """Get fixture type names sorted by name (same order as YOLO training export)."""
    try:
        rows = execute_query("SELECT name FROM fixture_types ORDER BY name")
        if rows:
            return [r["name"] for r in rows]
    except Exception as e:
        logger.warning(f"Failed to load fixture_types from DB: {e}")

    # Fallback - must match fixture_types table ORDER BY name
    # IMPORTANT: This must stay in sync with the DB. If you add types to
    # fixture_types, add them here too in alphabetical order.
    return [
        "ARARA", "BALCAO", "CABIDEIRO_PAREDE", "CESTAO",
        "DISPLAY", "GONDOLA", "PRATELEIRA",
    ]


def _download_model(volume_path: str) -> str:
    """Download model file from UC Volume to local filesystem.

    Returns the local file path.
    """
    logger.info(f"Downloading YOLO model from {volume_path} to {LOCAL_MODEL_PATH}")
    w = get_workspace_client()
    resp = w.files.download(volume_path)
    with open(LOCAL_MODEL_PATH, "wb") as f:
        f.write(resp.contents.read())
    size_mb = os.path.getsize(LOCAL_MODEL_PATH) / (1024 * 1024)
    logger.info(f"YOLO model downloaded: {size_mb:.1f} MB")
    return LOCAL_MODEL_PATH


def get_yolo_model():
    """Load or return cached YOLO model (singleton pattern).

    Downloads the active model from UC Volume on first call, then caches it
    in memory. Thread-safe.

    Returns:
        A YOLO model instance, or None if no active model is available.
    """
    global _model, _model_path_cached

    with _model_lock:
        model_info = _get_active_model_info()
        if not model_info:
            logger.warning("No active YOLO model found in trained_models table")
            return None

        volume_path = model_info["model_path"]

        # Re-download if the active model changed
        if _model is not None and _model_path_cached == volume_path:
            return _model

        try:
            local_path = _download_model(volume_path)
        except Exception as e:
            logger.error(f"Failed to download YOLO model from {volume_path}: {e}")
            return None

        try:
            from ultralytics import YOLO
            _model = YOLO(local_path)
            _model_path_cached = volume_path
            logger.info(f"YOLO model loaded successfully: {model_info.get('model_name', volume_path)}")
            return _model
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
            return None


def _decode_frame(frame_b64: str) -> np.ndarray:
    """Decode a base64-encoded JPEG frame to a numpy array (BGR)."""
    jpeg_bytes = base64.b64decode(frame_b64)
    arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return frame


def _compute_zone(x_pct: float, y_pct: float) -> str:
    """Determine fixture zone from position percentages.

    Zones: ESQUERDA, DIREITA, FRENTE (top), FUNDO (bottom), MEIO (center).
    """
    if x_pct < 25:
        return "ESQUERDA"
    elif x_pct > 75:
        return "DIREITA"
    elif y_pct < 33:
        return "FRENTE"
    elif y_pct > 66:
        return "FUNDO"
    else:
        return "MEIO"


def detect_fixtures_yolo(frame_b64: str) -> list[dict]:
    """Run YOLO inference on a base64-encoded frame.

    Returns detections in the same format as analyze_frame_fixtures:
    [{"type", "position": {"x", "y"}, "zone", "occupancy", "occupancy_pct",
      "confidence", "description"}]

    For YOLO-only mode, occupancy defaults to PARCIAL/50% since YOLO
    only provides bounding boxes, not semantic understanding.

    Falls back to LLM detection if YOLO model is unavailable.
    """
    model = get_yolo_model()
    if model is None:
        logger.warning("YOLO model unavailable, falling back to LLM detection")
        from server.fmapi import analyze_frame_fixtures
        return analyze_frame_fixtures(frame_b64)

    try:
        frame = _decode_frame(frame_b64)
        if frame is None:
            logger.error("Failed to decode frame for YOLO inference")
            return []

        img_h, img_w = frame.shape[:2]
        class_names = _get_class_names()

        # Run inference - lower threshold for custom-trained models on limited data
        results = model(frame, conf=0.15, iou=0.45, verbose=False)

        detections = []
        for result in results:
            if result.boxes is None or len(result.boxes) == 0:
                continue

            for box in result.boxes:
                # box.xywh is [x_center, y_center, width, height] in pixels
                xywh = box.xywh[0].cpu().numpy()
                x_center_px, y_center_px = float(xywh[0]), float(xywh[1])
                conf = float(box.conf[0].cpu().numpy())
                cls_id = int(box.cls[0].cpu().numpy())

                # Map class_id to fixture type name
                if cls_id < len(class_names):
                    fixture_type = class_names[cls_id]
                else:
                    logger.warning(f"YOLO class_id {cls_id} out of range (max {len(class_names) - 1})")
                    continue

                # Convert pixel coordinates to percentages (0-100)
                x_pct = max(0, min(100, (x_center_px / img_w) * 100))
                y_pct = max(0, min(100, (y_center_px / img_h) * 100))

                zone = _compute_zone(x_pct, y_pct)

                detections.append({
                    "type": fixture_type,
                    "position": {"x": round(x_pct, 1), "y": round(y_pct, 1)},
                    "zone": zone,
                    "occupancy": "PARCIAL",
                    "occupancy_pct": 50,
                    "confidence": round(conf, 3),
                    "description": "",
                })

        logger.info(f"YOLO detected {len(detections)} fixtures")
        return detections

    except Exception as e:
        logger.error(f"YOLO inference failed: {e}", exc_info=True)
        # Fallback to LLM
        logger.info("Falling back to LLM detection after YOLO failure")
        from server.fmapi import analyze_frame_fixtures
        return analyze_frame_fixtures(frame_b64)


def detect_fixtures_hybrid(frame_b64: str) -> list[dict]:
    """YOLO detection + LLM for occupancy and description.

    Uses YOLO for fast bounding box detection, then crops each detected
    region and sends it to FMAPI for occupancy assessment and description.

    Falls back to LLM-only detection if YOLO model is unavailable.
    """
    model = get_yolo_model()
    if model is None:
        logger.warning("YOLO model unavailable, falling back to LLM detection")
        from server.fmapi import analyze_frame_fixtures
        return analyze_frame_fixtures(frame_b64)

    try:
        frame = _decode_frame(frame_b64)
        if frame is None:
            logger.error("Failed to decode frame for hybrid inference")
            return []

        img_h, img_w = frame.shape[:2]
        class_names = _get_class_names()

        # Run YOLO inference - lower threshold for custom-trained models
        results = model(frame, conf=0.15, iou=0.45, verbose=False)

        yolo_detections = []
        for result in results:
            if result.boxes is None or len(result.boxes) == 0:
                continue

            for box in result.boxes:
                xywh = box.xywh[0].cpu().numpy()
                xyxy = box.xyxy[0].cpu().numpy()
                x_center_px, y_center_px = float(xywh[0]), float(xywh[1])
                conf = float(box.conf[0].cpu().numpy())
                cls_id = int(box.cls[0].cpu().numpy())

                if cls_id < len(class_names):
                    fixture_type = class_names[cls_id]
                else:
                    continue

                x_pct = max(0, min(100, (x_center_px / img_w) * 100))
                y_pct = max(0, min(100, (y_center_px / img_h) * 100))
                zone = _compute_zone(x_pct, y_pct)

                # Bounding box in pixel coordinates for cropping
                x1 = max(0, int(xyxy[0]))
                y1 = max(0, int(xyxy[1]))
                x2 = min(img_w, int(xyxy[2]))
                y2 = min(img_h, int(xyxy[3]))

                yolo_detections.append({
                    "type": fixture_type,
                    "position": {"x": round(x_pct, 1), "y": round(y_pct, 1)},
                    "zone": zone,
                    "confidence": round(conf, 3),
                    "crop_box": (x1, y1, x2, y2),
                })

        logger.info(f"YOLO (hybrid) detected {len(yolo_detections)} fixtures, enriching with LLM...")

        # Enrich each detection with LLM occupancy/description
        from server.fmapi import _call_serving, _get_model, _normalize_occupancy
        import json
        import re

        enriched = []
        for det in yolo_detections:
            x1, y1, x2, y2 = det["crop_box"]
            crop = frame[y1:y2, x1:x2]

            # Ensure crop is valid
            if crop.size == 0 or crop.shape[0] < 10 or crop.shape[1] < 10:
                enriched.append({
                    "type": det["type"],
                    "position": det["position"],
                    "zone": det["zone"],
                    "occupancy": "PARCIAL",
                    "occupancy_pct": 50,
                    "confidence": det["confidence"],
                    "description": "",
                })
                continue

            # Encode crop as base64 JPEG
            _, crop_jpeg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
            crop_b64 = base64.b64encode(crop_jpeg.tobytes()).decode()

            try:
                occupancy, occupancy_pct, description = _analyze_crop_occupancy(
                    crop_b64, det["type"]
                )
            except Exception as e:
                logger.warning(f"LLM enrichment failed for {det['type']}: {e}")
                occupancy, occupancy_pct, description = "PARCIAL", 50, ""

            enriched.append({
                "type": det["type"],
                "position": det["position"],
                "zone": det["zone"],
                "occupancy": occupancy,
                "occupancy_pct": occupancy_pct,
                "confidence": det["confidence"],
                "description": description,
            })

        logger.info(f"Hybrid detection complete: {len(enriched)} fixtures enriched")
        return enriched

    except Exception as e:
        logger.error(f"Hybrid inference failed: {e}", exc_info=True)
        logger.info("Falling back to LLM detection after hybrid failure")
        from server.fmapi import analyze_frame_fixtures
        return analyze_frame_fixtures(frame_b64)


def _analyze_crop_occupancy(crop_b64: str, fixture_type: str) -> tuple[str, float, str]:
    """Use FMAPI to analyze occupancy and description of a cropped fixture region.

    Returns (occupancy, occupancy_pct, description).
    """
    import json
    import re
    from server.fmapi import _call_serving, _normalize_occupancy

    payload = {
        "messages": [
            {
                "role": "system",
                "content": (
                    "Voce analisa imagens de expositores de loja. "
                    "Retorne APENAS um JSON com: occupancy (VAZIO/PARCIAL/CHEIO), "
                    "occupancy_pct (0-100), description (breve, portugues). "
                    "Sem markdown, sem code fences."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{crop_b64}"}},
                    {
                        "type": "text",
                        "text": (
                            f"Este e um expositor do tipo {fixture_type}. "
                            f"Analise o nivel de ocupacao e descreva brevemente o conteudo. "
                            f'Retorne JSON: {{"occupancy": "VAZIO|PARCIAL|CHEIO", '
                            f'"occupancy_pct": 75, "description": "descricao breve"}}'
                        ),
                    },
                ],
            },
        ],
        "max_tokens": 300,
    }

    try:
        payload["temperature"] = 0.1
        response = _call_serving(payload)
    except RuntimeError as e:
        if "temperature" in str(e).lower():
            del payload["temperature"]
            response = _call_serving(payload)
        else:
            raise

    raw = response["choices"][0]["message"]["content"].strip()
    logger.debug(f"Hybrid LLM crop response: {raw[:200]}")

    # Parse JSON from response
    json_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if json_match:
        data = json.loads(json_match.group())
    else:
        data = json.loads(raw)

    occupancy = _normalize_occupancy(data.get("occupancy", "PARCIAL"))
    occupancy_pct = max(0, min(100, float(data.get("occupancy_pct", 50))))
    description = str(data.get("description", ""))

    return occupancy, occupancy_pct, description
