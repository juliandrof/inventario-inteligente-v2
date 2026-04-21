#!/bin/bash
# Fix: ultralytics installed opencv-python (needs libGL) in a previous deploy.
# The venv is cached so pip won't replace it. Force swap to headless.
pip uninstall -y opencv-python 2>/dev/null
pip install -q opencv-python-headless 2>/dev/null
exec uvicorn app:app --host 0.0.0.0 --port 8000
