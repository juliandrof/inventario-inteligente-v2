"""Inventario Inteligente de Expositores - Powered by Databricks Lakebase."""

import os
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from server.database import init_db_pool, close_db_pool
from server.routes import videos, dashboard, analysis, review, reports, thumbnails, configurations, branding, training, contexts

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Inventario Inteligente application...")
    try:
        await init_db_pool()
        logger.info("Database pool initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database pool: {e}", exc_info=True)
    yield
    logger.info("Shutting down Inventario Inteligente application...")
    await close_db_pool()


app = FastAPI(
    title="Inventario Inteligente",
    description="Inventario Inteligente de Expositores - Powered by Databricks Lakebase",
    version="2.0.0",
    lifespan=lifespan,
)

@app.get("/api/health")
async def health():
    """Health check endpoint for debugging."""
    import sys
    info = {"status": "ok", "python": sys.version}
    try:
        import cv2
        info["cv2"] = cv2.__version__
    except Exception as e:
        info["cv2_error"] = str(e)
    try:
        from server.database import get_connection
        conn = get_connection()
        info["db"] = "connected"
    except Exception as e:
        info["db_error"] = str(e)
    return info


@app.post("/api/migrate")
async def run_migration():
    """One-time migration to add context_id to videos table."""
    from server.database import get_connection, execute_query, execute_update
    results = []
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("SELECT current_user")
        current_user = cur.fetchone()[0]
        results.append(f"current_user: {current_user}")

        cur.execute("SELECT tableowner FROM pg_tables WHERE tablename = 'videos'")
        owner = cur.fetchone()
        results.append(f"videos owner: {owner}")

        # Check columns
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'videos' ORDER BY ordinal_position")
        cols = [r[0] for r in cur.fetchall()]
        results.append(f"videos columns: {cols}")

        if "context_id" not in cols:
            try:
                cur.execute("ALTER TABLE videos ADD COLUMN context_id BIGINT")
                results.append("SUCCESS: added context_id")
            except Exception as e:
                results.append(f"ALTER failed: {e}")
                # Try GRANT approach
                try:
                    cur.execute(f"GRANT ALL ON TABLE videos TO \"{current_user}\"")
                    cur.execute("ALTER TABLE videos ADD COLUMN context_id BIGINT")
                    results.append("SUCCESS via GRANT: added context_id")
                except Exception as e2:
                    results.append(f"GRANT+ALTER failed: {e2}")
        else:
            results.append("context_id already exists")

        cur.close()
    except Exception as e:
        results.append(f"ERROR: {e}")
    return {"results": results}


app.include_router(videos.router, prefix="/api/videos", tags=["Videos"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["Analysis"])
app.include_router(review.router, prefix="/api/review", tags=["Review"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
app.include_router(thumbnails.router, prefix="/api/thumbnails", tags=["Thumbnails"])
app.include_router(configurations.router, prefix="/api/config", tags=["Configurations"])
app.include_router(branding.router, prefix="/api/branding", tags=["Branding"])
app.include_router(training.router, prefix="/api/training", tags=["Training"])
app.include_router(contexts.router, prefix="/api/contexts", tags=["Contexts"])

frontend_dist = Path(__file__).parent / "frontend" / "dist"

if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/favicon.ico")
    async def favicon():
        fav = frontend_dist / "favicon.ico"
        if fav.exists():
            return FileResponse(str(fav))
        return FileResponse(str(frontend_dist / "index.html"))

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            return {"error": "Not found"}, 404
        file_path = frontend_dist / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(frontend_dist / "index.html"))
else:
    @app.get("/")
    async def root():
        return {"message": "Inventario Inteligente API - Frontend not built yet"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
