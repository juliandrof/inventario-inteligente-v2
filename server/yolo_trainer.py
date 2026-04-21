"""YOLO model training utilities for retail fixture detection."""

import json
import logging
import os
import random
import time
from typing import Optional

from server.database import execute_query, execute_update, get_workspace_client

logger = logging.getLogger(__name__)

CATALOG = "jsf_demo_catalog"
SCHEMA = "scenic_crawler"
TRAINING_VOLUME = f"/Volumes/{CATALOG}/{SCHEMA}/training_images"
DATASET_VOLUME = f"/Volumes/{CATALOG}/{SCHEMA}/yolo_datasets"
MODELS_VOLUME = f"/Volumes/{CATALOG}/{SCHEMA}/yolo_models"


def export_yolo_dataset(output_volume_path: Optional[str] = None) -> str:
    """Export training images + annotations as a ZIP file to a Volume.

    The ZIP contains the full YOLO dataset structure:
      images/train/  images/val/
      labels/train/  labels/val/
      data.yaml

    Returns the Volume path to the ZIP file.
    """
    import io
    import zipfile
    import tempfile

    if not output_volume_path:
        run_id = int(time.time() * 1000)
        output_volume_path = f"{DATASET_VOLUME}/dataset_{run_id}"

    w = get_workspace_client()

    fixture_rows = execute_query("SELECT name FROM fixture_types ORDER BY name")
    class_names = [r["name"] for r in fixture_rows]
    class_map = {name: idx for idx, name in enumerate(class_names)}

    images = execute_query("""
        SELECT ti.image_id, ti.filename, ti.volume_path, ti.width, ti.height
        FROM training_images ti
        WHERE ti.annotation_count > 0
        ORDER BY ti.image_id
    """)

    if not images:
        raise ValueError("No annotated images found for export")

    random.shuffle(images)
    split_idx = max(1, int(len(images) * 0.8))
    train_images = images[:split_idx]
    val_images = images[split_idx:] if split_idx < len(images) else images[-1:]

    # Build ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for subset, img_list in [("train", train_images), ("val", val_images)]:
            for img in img_list:
                fname = img["filename"]
                # Download image from Volume and add to ZIP
                try:
                    resp = w.files.download(img["volume_path"])
                    image_bytes = resp.contents.read()
                    zf.writestr(f"images/{subset}/{fname}", image_bytes)
                except Exception as e:
                    logger.warning(f"Failed to download {fname}: {e}")
                    continue

                # Build YOLO label
                annotations = execute_query("""
                    SELECT fixture_type, x_center, y_center, width, height
                    FROM training_annotations WHERE image_id = %(iid)s
                """, {"iid": img["image_id"]})

                label_lines = []
                for ann in annotations:
                    cls_id = class_map.get(ann["fixture_type"])
                    if cls_id is None:
                        logger.warning(f"Unknown fixture_type '{ann['fixture_type']}' in annotations, skipping")
                        continue
                    x_c = float(ann["x_center"]) / 100.0
                    y_c = float(ann["y_center"]) / 100.0
                    w_n = float(ann["width"]) / 100.0
                    h_n = float(ann["height"]) / 100.0

                    # Validate YOLO coordinates are in valid range (0-1)
                    if not (0 < x_c <= 1 and 0 < y_c <= 1 and 0 < w_n <= 1 and 0 < h_n <= 1):
                        logger.warning(f"Skipping invalid annotation: x={x_c}, y={y_c}, w={w_n}, h={h_n}")
                        continue

                    # Clamp bbox to image boundaries
                    x_min = max(0, x_c - w_n / 2)
                    x_max = min(1, x_c + w_n / 2)
                    y_min = max(0, y_c - h_n / 2)
                    y_max = min(1, y_c + h_n / 2)
                    w_n = x_max - x_min
                    h_n = y_max - y_min
                    x_c = x_min + w_n / 2
                    y_c = y_min + h_n / 2

                    label_lines.append(f"{cls_id} {x_c:.6f} {y_c:.6f} {w_n:.6f} {h_n:.6f}")

                label_fname = os.path.splitext(fname)[0] + ".txt"
                zf.writestr(f"labels/{subset}/{label_fname}", "\n".join(label_lines))

        # data.yaml with placeholder path (will be rewritten by training script)
        data_yaml = (
            f"path: /tmp/yolo_dataset\n"
            f"train: images/train\n"
            f"val: images/val\n"
            f"\nnc: {len(class_names)}\n"
            f"names: {json.dumps(class_names)}\n"
        )
        zf.writestr("data.yaml", data_yaml)

    # Log dataset quality stats
    ann_stats = execute_query("""
        SELECT fixture_type, COUNT(*) as cnt,
               ROUND(AVG(width)::numeric, 1) as avg_w,
               ROUND(AVG(height)::numeric, 1) as avg_h
        FROM training_annotations GROUP BY fixture_type ORDER BY cnt DESC
    """)
    total_anns = sum(r["cnt"] for r in ann_stats) if ann_stats else 0
    logger.info(f"Dataset quality - {total_anns} annotations across {len(images)} images:")
    for row in (ann_stats or []):
        logger.info(f"  {row['fixture_type']}: {row['cnt']} anns, avg box {row['avg_w']}x{row['avg_h']}%")

    # Check for suspicious uniform boxes (all same size = bad LLM annotations)
    uniform_check = execute_query("""
        SELECT COUNT(DISTINCT width || '_' || height) as distinct_sizes
        FROM training_annotations
    """)
    if uniform_check and uniform_check[0]["distinct_sizes"] <= 1 and total_anns > 10:
        logger.warning(
            "WARNING: All annotations have identical bounding box sizes! "
            "This indicates LLM auto-annotations did not include proper bbox dimensions. "
            "Consider re-running auto-annotate to get varied, accurate box sizes."
        )

    logger.info(f"Exporting YOLO dataset: {len(train_images)} train, {len(val_images)} val")

    # Upload ZIP to Volume
    zip_path = f"{output_volume_path}.zip"
    zip_buffer.seek(0)
    w.files.upload(zip_path, zip_buffer, overwrite=True)
    zip_size_mb = zip_buffer.tell() / 1024 / 1024
    logger.info(f"YOLO dataset ZIP uploaded: {zip_path} ({zip_size_mb:.1f} MB)")

    return zip_path


def generate_training_script(
    dataset_path: str,
    model_size: str = "n",
    epochs: int = 50,
    batch_size: int = 16,
) -> str:
    """Generate a Python training script string for YOLOv8.

    The script installs ultralytics, trains the model, saves metrics as JSON,
    and logs the model to MLflow.
    """
    results_ts = int(time.time() * 1000)
    results_path = f"{MODELS_VOLUME}/results_{results_ts}"

    # Use raw string to avoid f-string escaping nightmares
    # Inject values via str.replace after
    script_template = r'''#!/usr/bin/env python3
"""YOLO training script - auto-generated by Inventario Inteligente."""
import subprocess, sys, json, os, shutil, zipfile

subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "ultralytics", "mlflow"])

# Fix distributed training on Databricks GPU ML runtime
# The runtime pre-initializes torch distributed which breaks YOLO single-GPU training
os.environ["CUDA_VISIBLE_DEVICES"] = "0"
os.environ["WORLD_SIZE"] = "1"
os.environ["RANK"] = "0"
os.environ["LOCAL_RANK"] = "0"
os.environ["MASTER_ADDR"] = "localhost"
os.environ["MASTER_PORT"] = "29500"

import torch
import torch.distributed as dist

# Initialize then destroy - this satisfies any code that checks is_initialized()
# and then we operate in single-process mode
try:
    if not dist.is_initialized():
        dist.init_process_group(backend="nccl", world_size=1, rank=0)
    dist.destroy_process_group()
except Exception:
    pass

# Now clear all distributed env vars so YOLO doesn't try DDP
os.environ.pop("MASTER_ADDR", None)
os.environ.pop("MASTER_PORT", None)
os.environ.pop("WORLD_SIZE", None)
os.environ.pop("RANK", None)
os.environ.pop("LOCAL_RANK", None)

import mlflow

# Disable Ultralytics auto-MLflow logging (conflicts with Databricks MLflow)
os.environ["WANDB_DISABLED"] = "true"
os.environ["CLEARML_LOG_MODEL"] = "false"

from ultralytics import YOLO
from ultralytics import settings as ul_settings
ul_settings.update({"mlflow": False, "wandb": False, "clearml": False, "comet": False})

from databricks.sdk import WorkspaceClient

DATASET_ZIP = "__DATASET_PATH__"
MODEL_SIZE = "__MODEL_SIZE__"
EPOCHS = __EPOCHS__
BATCH_SIZE = __BATCH_SIZE__
VOLUME_RESULTS = "__RESULTS_PATH__"
LOCAL_DATASET = "/tmp/yolo_dataset"
LOCAL_RESULTS = "/tmp/yolo_results"

print(f"Config: yolov8{MODEL_SIZE}, epochs={EPOCHS}, batch={BATCH_SIZE}")

# --- Step 1: Download ZIP and extract ---
print("Step 1: Downloading dataset ZIP...")
if os.path.exists(LOCAL_DATASET):
    shutil.rmtree(LOCAL_DATASET)

w = WorkspaceClient()
resp = w.files.download(DATASET_ZIP)
with open("/tmp/dataset.zip", "wb") as f:
    f.write(resp.contents.read())
print(f"Downloaded: {os.path.getsize('/tmp/dataset.zip') / 1024 / 1024:.1f} MB")

with zipfile.ZipFile("/tmp/dataset.zip", "r") as zf:
    zf.extractall(LOCAL_DATASET)
os.remove("/tmp/dataset.zip")

for d in ["images/train", "images/val", "labels/train", "labels/val"]:
    p = os.path.join(LOCAL_DATASET, d)
    n = len(os.listdir(p)) if os.path.exists(p) else 0
    print(f"  {d}: {n} files")

DATA_YAML = os.path.join(LOCAL_DATASET, "data.yaml")

# --- Step 2: Train ---
print("Step 2: Training...")
mlflow.set_experiment("/Shared/inventario-inteligente/yolo-training")

with mlflow.start_run(run_name=f"yolov8{MODEL_SIZE}_e{EPOCHS}_b{BATCH_SIZE}") as run:
    mlflow.log_params({"model_size": MODEL_SIZE, "epochs": EPOCHS, "batch_size": BATCH_SIZE})

    model = YOLO(f"yolov8{MODEL_SIZE}.pt")

    # Ensure no DDP before training
    os.environ.pop("MASTER_ADDR", None)
    os.environ.pop("MASTER_PORT", None)
    os.environ.pop("WORLD_SIZE", None)
    os.environ.pop("RANK", None)
    os.environ.pop("LOCAL_RANK", None)
    try:
        if dist.is_initialized():
            dist.destroy_process_group()
    except Exception:
        pass

    results = model.train(
        data=DATA_YAML, epochs=EPOCHS, batch=BATCH_SIZE,
        imgsz=640, project=LOCAL_RESULTS, name="train",
        exist_ok=True, verbose=True,
        device="0", workers=0, single_cls=False,
        # Patience for early stopping (avoid overfitting to noisy annotations)
        patience=20,
        # Learning rate tuned for fine-tuning with noisy LLM-generated annotations
        lr0=0.001, lrf=0.01,
        # Strong augmentation helps when annotations are imprecise
        hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
        degrees=5.0, translate=0.1, scale=0.5,
        flipud=0.0, fliplr=0.5,
        mosaic=1.0, mixup=0.1,
        # Use a warmup to stabilize early training
        warmup_epochs=5, warmup_momentum=0.5,
    )

    metrics = {}
    try:
        rd = results.results_dict
        metrics["map50"] = float(rd.get("metrics/mAP50(B)", 0))
        metrics["map50_95"] = float(rd.get("metrics/mAP50-95(B)", 0))
        metrics["precision"] = float(rd.get("metrics/precision(B)", 0))
        metrics["recall"] = float(rd.get("metrics/recall(B)", 0))
    except Exception as e:
        print(f"Metric warning: {e}")

    try:
        if hasattr(results, "names") and hasattr(results, "maps"):
            metrics["per_class"] = {results.names[i]: float(results.maps[i]) for i in results.names if i < len(results.maps)}
    except Exception:
        pass

    for k, v in metrics.items():
        if isinstance(v, (int, float)):
            mlflow.log_metric(k, v)

    train_dir = os.path.join(LOCAL_RESULTS, "train")
    for artifact in ["weights/best.pt", "confusion_matrix.png", "results.png"]:
        p = os.path.join(train_dir, artifact)
        if os.path.exists(p):
            mlflow.log_artifact(p)

    # --- Step 3: Upload results to Volume ---
    print("Step 3: Uploading results...")
    metrics["mlflow_run_id"] = run.info.run_id
    metrics["best_model_path"] = f"{VOLUME_RESULTS}/train/weights/best.pt"

    mj = os.path.join(train_dir, "metrics.json")
    with open(mj, "w") as f:
        json.dump(metrics, f, indent=2)

    for fname in ["metrics.json", "weights/best.pt", "weights/last.pt", "confusion_matrix.png", "results.png"]:
        src = os.path.join(train_dir, fname)
        if os.path.exists(src):
            try:
                with open(src, "rb") as fh:
                    w.files.upload(f"{VOLUME_RESULTS}/train/{fname}", fh, overwrite=True)
                print(f"  {fname} OK")
            except Exception as e:
                print(f"  {fname} FAILED: {e}")

    print(f"Done! {json.dumps(metrics, indent=2)}")
'''
    # Inject actual values (no f-string escaping issues)
    script = script_template
    script = script.replace("__DATASET_PATH__", dataset_path)
    script = script.replace("__MODEL_SIZE__", model_size)
    script = script.replace("__EPOCHS__", str(epochs))
    script = script.replace("__BATCH_SIZE__", str(batch_size))
    script = script.replace("__RESULTS_PATH__", results_path)

    return script, results_path


def parse_training_results(results_path: str) -> dict:
    """Parse YOLO training output and return dict with metrics."""
    w = get_workspace_client()
    metrics_file = f"{results_path}/train/metrics.json"

    try:
        resp = w.files.download(metrics_file)
        content = resp.contents.read().decode("utf-8")
        metrics = json.loads(content)
        return metrics
    except Exception as e:
        logger.warning(f"Could not parse training results from {metrics_file}: {e}")
        return {}


def _get_auth_headers(w) -> tuple[str, str]:
    """Get host and Bearer token from workspace client for REST API calls."""
    host = w.config.host.rstrip("/")
    headers = w.config.authenticate()
    token = headers.get("Authorization", "").replace("Bearer ", "") if headers else ""
    return host, token


def _databricks_rest_get(w, path: str) -> dict:
    """Make an authenticated GET request to Databricks REST API."""
    import json as _json
    import urllib.request
    import ssl
    try:
        ssl._create_default_https_context = ssl._create_unverified_context
    except Exception:
        pass

    host, token = _get_auth_headers(w)
    req = urllib.request.Request(
        f"{host}{path}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return _json.loads(resp.read())


def _databricks_rest_post(w, path: str, payload: dict) -> dict:
    """Make an authenticated POST request to Databricks REST API."""
    import json as _json
    import urllib.request
    import ssl
    try:
        ssl._create_default_https_context = ssl._create_unverified_context
    except Exception:
        pass

    host, token = _get_auth_headers(w)
    data = _json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{host}{path}",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return _json.loads(resp.read())


def get_run_status(w, run_id: int) -> dict:
    """Get the status of a Databricks job run via REST API.

    Returns dict with keys: life_cycle_state, result_state, state_message.
    """
    result = _databricks_rest_get(w, f"/api/2.1/jobs/runs/get?run_id={run_id}")
    state = result.get("state", {})
    status = result.get("status", {})
    return {
        "life_cycle_state": state.get("life_cycle_state", "UNKNOWN"),
        "result_state": state.get("result_state"),
        "state_message": state.get("state_message", ""),
        "termination_code": status.get("termination_details", {}).get("code", ""),
        "termination_message": status.get("termination_details", {}).get("message", ""),
    }


def submit_training_job(
    w,
    script: str,
    cluster_spec: Optional[dict] = None,
) -> int:
    """Submit a Databricks Job using workspace client.

    Uploads the training script to /Workspace/Shared/ (more reliable than
    Volumes for spark_python_task) and submits a one-time run via REST API.

    Returns the Databricks run_id.
    """
    # Default cluster spec with GPU for YOLO training
    if cluster_spec is None:
        cluster_spec = {
            "spark_version": "15.4.x-gpu-ml-scala2.12",
            "num_workers": 0,
            "node_type_id": "g5.xlarge",
            "driver_node_type_id": "g5.xlarge",
            "spark_conf": {
                "spark.master": "local[*]",
                "spark.databricks.cluster.profile": "singleNode",
            },
            "custom_tags": {
                "ResourceClass": "SingleNode",
            },
        }

    # Upload script to DBFS (the only reliable path for spark_python_task)
    import io
    import base64
    import json as _json
    import urllib.request
    import ssl
    try:
        ssl._create_default_https_context = ssl._create_unverified_context
    except Exception:
        pass

    script_ts = int(time.time() * 1000)
    dbfs_path = f"dbfs:/inventario-inteligente/training_scripts/train_{script_ts}.py"
    script_path = dbfs_path  # for spark_python_task

    host, token = _get_auth_headers(w)

    # Upload to DBFS via REST API (handles files up to 1MB inline)
    script_b64 = base64.b64encode(script.encode("utf-8")).decode("utf-8")
    put_payload = _json.dumps({
        "path": dbfs_path.replace("dbfs:", ""),
        "contents": script_b64,
        "overwrite": True,
    }).encode("utf-8")
    put_req = urllib.request.Request(
        f"{host}/api/2.0/dbfs/put",
        data=put_payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(put_req, timeout=30) as resp:
        resp.read()

    logger.info(f"Uploaded training script to {script_path}")

    # Submit as a one-time run via REST API
    result = _databricks_rest_post(w, "/api/2.1/jobs/runs/submit", {
        "run_name": f"YOLO Training {int(time.time())}",
        "tasks": [{
            "task_key": "yolo_train",
            "new_cluster": cluster_spec,
            "spark_python_task": {
                "python_file": script_path,
            },
        }],
    })
    run_id = result.get("run_id")

    logger.info(f"Submitted Databricks training job, run_id={run_id}")
    return run_id
