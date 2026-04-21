#!/bin/bash
# Fix: swap opencv-python (needs libGL) for headless if present in cached venv
pip uninstall -y opencv-python 2>/dev/null; true
pip install -q opencv-python-headless 2>/dev/null; true
exec uvicorn app:app --host 0.0.0.0 --port 8000
