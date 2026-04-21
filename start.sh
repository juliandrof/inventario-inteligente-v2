#!/bin/bash
# Fix opencv: replace opencv-python with opencv-python-headless
# (Databricks Apps containers lack libGL.so.1 needed by opencv-python)
pip install --quiet --force-reinstall opencv-python-headless 2>/dev/null
pip uninstall -y opencv-python 2>/dev/null || true

exec uvicorn app:app --host 0.0.0.0 --port 8000
