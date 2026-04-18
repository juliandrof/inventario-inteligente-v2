"""Background worker for async video processing."""

import os
import time
import threading
import logging
import tempfile
from typing import Optional

from server.database import execute_query, execute_update, get_workspace_client
from server.video_processor import process_video, process_photo, get_video_metadata, ensure_store_exists, parse_video_filename, is_image_file

logger = logging.getLogger(__name__)

VIDEO_VOLUME = os.environ.get("VIDEO_VOLUME", "/Volumes/scenic_crawler/default/uploaded_videos")


class ProcessingWorker:
    """Singleton worker for async video processing."""
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._jobs = {}
                    cls._instance._counter = 0
        return cls._instance

    def start_processing(self, video_id: int) -> dict:
        self._counter += 1
        job_id = self._counter

        thread = threading.Thread(
            target=self._run, args=(job_id, video_id), daemon=True
        )
        thread.start()
        return {"job_id": job_id, "video_id": video_id, "status": "STARTED"}

    def start_batch(self, volume_path: str, user: str = "") -> dict:
        self._counter += 1
        batch_id = self._counter

        batch_info = {
            "batch_id": batch_id, "volume_path": volume_path,
            "status": "STARTING", "total": 0, "completed": 0,
            "failed": 0, "skipped": 0, "pct": 0,
            "current_video": "", "videos": [],
            "cancel_requested": False,
        }
        self._jobs[batch_id] = batch_info

        thread = threading.Thread(
            target=self._run_batch, args=(batch_id, volume_path, user), daemon=True
        )
        thread.start()
        return batch_info

    def get_batch(self, batch_id: int) -> Optional[dict]:
        return self._jobs.get(batch_id)

    def cancel_batch(self, batch_id: int):
        if batch_id in self._jobs:
            self._jobs[batch_id]["cancel_requested"] = True

    def list_batches(self) -> list[dict]:
        return list(self._jobs.values())

    def _run(self, job_id: int, video_id: int):
        import traceback
        try:
            video = execute_query("SELECT * FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
            if not video:
                return

            w = get_workspace_client()
            volume_path = video[0]["volume_path"]
            local_path = self._download_video(w, volume_path)

            try:
                filename = video[0].get("filename", "")
                if is_image_file(filename):
                    process_photo(video_id, local_path)
                else:
                    process_video(video_id, local_path)
            finally:
                if os.path.exists(local_path):
                    os.unlink(local_path)

        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"Processing job {job_id} failed: {e}\n{tb}")
            try:
                execute_update(
                    "UPDATE videos SET status = 'FAILED', error_message = %(msg)s WHERE video_id = %(vid)s",
                    {"vid": video_id, "msg": str(e)[:500]},
                )
            except Exception:
                pass

    def _run_batch(self, batch_id: int, volume_path: str, user: str):
        batch = self._jobs[batch_id]
        try:
            w = get_workspace_client()
            video_files = []
            try:
                entries = w.files.list_directory_contents(volume_path)
                for entry in entries:
                    name = entry.path.split("/")[-1] if hasattr(entry, 'path') else str(entry)
                    if name.lower().endswith(('.mp4', '.avi', '.mov', '.mkv', '.webm')):
                        full_path = entry.path if hasattr(entry, 'path') else f"{volume_path}/{name}"
                        video_files.append({"name": name, "path": full_path})
            except Exception as e:
                batch["status"] = "FAILED"
                batch["error"] = str(e)
                return

            # Skip already processed
            already_processed = set()
            try:
                rows = execute_query("SELECT volume_path FROM videos WHERE status = 'COMPLETED'")
                already_processed = {r["volume_path"] for r in rows}
            except Exception:
                pass

            to_process = [vf for vf in video_files if vf["path"] not in already_processed]
            batch["skipped"] = len(video_files) - len(to_process)
            batch["total"] = len(to_process)
            batch["status"] = "RUNNING"

            if not to_process:
                batch["status"] = "COMPLETED"
                batch["pct"] = 100
                return

            for idx, vf in enumerate(to_process):
                if batch.get("cancel_requested"):
                    batch["status"] = "CANCELLED"
                    return

                batch["current_video"] = vf["name"]

                try:
                    parsed = parse_video_filename(vf["name"])
                    ensure_store_exists(parsed["store_id"], parsed["uf"])

                    local_path = self._download_video(w, vf["path"])
                    meta = get_video_metadata(local_path)

                    video_id = int(time.time() * 1000) + idx
                    execute_update("""
                        INSERT INTO videos
                        (video_id, filename, volume_path, uf, store_id, video_date,
                         file_size_bytes, duration_seconds, fps, resolution, total_frames,
                         upload_timestamp, status, uploaded_by)
                        VALUES (%(vid)s, %(name)s, %(path)s, %(uf)s, %(sid)s, %(vd)s,
                                %(size)s, %(dur)s, %(fps)s, %(res)s, %(tf)s,
                                NOW(), 'PENDING', %(user)s)
                    """, {
                        "vid": video_id, "name": vf["name"], "path": vf["path"],
                        "uf": parsed["uf"], "sid": parsed["store_id"], "vd": parsed["video_date"],
                        "size": os.path.getsize(local_path),
                        "dur": meta.get("duration_seconds", 0), "fps": meta.get("fps", 0),
                        "res": meta.get("resolution", ""), "tf": meta.get("total_frames", 0),
                        "user": user,
                    })

                    batch["videos"].append({"name": vf["name"], "video_id": video_id, "status": "PROCESSING"})

                    def progress_cb(vid, pct):
                        batch["pct"] = min(99, ((idx + pct / 100) / len(to_process)) * 100)

                    process_video(video_id, local_path, progress_callback=progress_cb)
                    batch["completed"] += 1
                    batch["videos"][-1]["status"] = "COMPLETED"
                    os.unlink(local_path)

                except Exception as e:
                    logger.error(f"Batch failed for {vf['name']}: {e}")
                    batch["failed"] += 1
                    batch["videos"].append({"name": vf["name"], "status": "FAILED", "error": str(e)[:200]})

            batch["status"] = "COMPLETED"
            batch["pct"] = 100

        except Exception as e:
            batch["status"] = "FAILED"
            batch["error"] = str(e)

    def _download_video(self, w, volume_path: str) -> str:
        suffix = "." + volume_path.split(".")[-1] if "." in volume_path else ".mp4"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        try:
            resp = w.files.download(volume_path)
            for chunk in iter(lambda: resp.contents.read(8192), b""):
                tmp.write(chunk)
            tmp.close()
            return tmp.name
        except Exception:
            tmp.close()
            os.unlink(tmp.name)
            raise
