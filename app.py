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
    """Drop all tables and recreate from scratch."""
    from server.database import get_connection
    results = []
    try:
        conn = get_connection()
        cur = conn.cursor()

        # Get all tables in public schema owned by anyone
        cur.execute("""
            SELECT tablename FROM pg_tables WHERE schemaname = 'public'
            ORDER BY tablename
        """)
        tables = [r[0] for r in cur.fetchall()]
        results.append(f"existing tables: {tables}")

        # Drop ALL tables with CASCADE (order doesn't matter with CASCADE)
        for t in tables:
            try:
                cur.execute(f'DROP TABLE IF EXISTS "{t}" CASCADE')
                results.append(f"dropped: {t}")
            except Exception as e:
                results.append(f"drop {t} failed: {e}")

        cur.close()
        results.append("all tables dropped")

        # Now reinit - this will recreate everything with correct schema + ownership
        from server.database import _auto_create_tables, _create_training_tables
        conn2 = get_connection()
        _auto_create_tables(conn2)
        results.append("core tables recreated")
        _create_training_tables(conn2)
        results.append("training tables recreated")

        # Verify context_id
        cur2 = conn2.cursor()
        cur2.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'videos' ORDER BY ordinal_position")
        cols = [r[0] for r in cur2.fetchall()]
        results.append(f"videos columns: {cols}")
        cur2.close()

    except Exception as e:
        import traceback
        results.append(f"ERROR: {e}\n{traceback.format_exc()}")
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
