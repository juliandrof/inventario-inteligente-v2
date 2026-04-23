"""Database connection module - Lakebase (PostgreSQL) for Scenic Crawler AI."""

import os
import json
import logging
import ssl
import time
import urllib.request
import urllib.error
from typing import Optional, Any

try:
    ssl._create_default_https_context = ssl._create_unverified_context
except Exception:
    pass

import psycopg2
import psycopg2.extras
from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)

IS_DATABRICKS_APP = bool(os.environ.get("DATABRICKS_APP_NAME"))

DB_HOST = os.environ.get("DBXSC_AI_DB_HOST", "")
DB_PORT = int(os.environ.get("DBXSC_AI_DB_PORT", "5432"))
DB_NAME = os.environ.get("DBXSC_AI_DB_NAME", "scenic_crawler")
DB_SCHEMA = os.environ.get("DBXSC_AI_DB_SCHEMA", "public")
LAKEBASE_PROJECT = os.environ.get("DBXSC_AI_LAKEBASE_PROJECT", "scenic-crawler")
LAKEBASE_BRANCH = os.environ.get("DBXSC_AI_LAKEBASE_BRANCH", "production")
LAKEBASE_ENDPOINT = os.environ.get("DBXSC_AI_LAKEBASE_ENDPOINT", "primary")

_connection = None


def _get_workspace_client() -> WorkspaceClient:
    if IS_DATABRICKS_APP:
        return WorkspaceClient()
    profile = os.environ.get("DATABRICKS_PROFILE")
    return WorkspaceClient(profile=profile) if profile else WorkspaceClient()


def _get_lakebase_credentials() -> tuple[str, str, str]:
    w = _get_workspace_client()
    host = DB_HOST
    endpoint_name = f"projects/{LAKEBASE_PROJECT}/branches/{LAKEBASE_BRANCH}/endpoints/{LAKEBASE_ENDPOINT}"

    if not host:
        try:
            branch_path = f"projects/{LAKEBASE_PROJECT}/branches/{LAKEBASE_BRANCH}"
            endpoints = list(w.postgres.list_endpoints(parent=branch_path))
            if endpoints:
                host = endpoints[0].status.hosts.host
                logger.info(f"Discovered Lakebase host: {host}")
        except Exception as e:
            logger.warning(f"Could not discover Lakebase host via SDK: {e}")
            try:
                ws_host = w.config.host.rstrip("/")
                headers = w.config.authenticate()
                ws_token = headers.get("Authorization", "").replace("Bearer ", "") if headers else ""
                url = f"{ws_host}/api/2.0/postgres/projects/{LAKEBASE_PROJECT}/branches/{LAKEBASE_BRANCH}/endpoints"
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {ws_token}"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read())
                    eps = data.get("endpoints", [])
                    if eps:
                        host = eps[0]["status"]["hosts"]["host"]
            except Exception as e2:
                logger.warning(f"REST fallback also failed: {e2}")

    if not host:
        raise ValueError("DBXSC_AI_DB_HOST not set and could not discover")

    user = os.environ.get("DBXSC_AI_DB_USER", "")
    password = os.environ.get("DBXSC_AI_DB_PASSWORD", "")

    if user and password:
        return host, user, password

    db_token = ""
    try:
        credential = w.postgres.generate_database_credential(endpoint=endpoint_name)
        db_token = credential.token
    except Exception as e:
        logger.info(f"SDK credential gen unavailable: {e}")

    if not db_token:
        try:
            auth_headers = w.config.authenticate()
            ws_token = auth_headers.get("Authorization", "").replace("Bearer ", "") if auth_headers else ""
            if not ws_token and w.config.token:
                ws_token = w.config.token
            ws_host = w.config.host.rstrip("/")
            url = f"{ws_host}/api/2.0/postgres/credentials"
            payload = json.dumps({"endpoint": endpoint_name}).encode("utf-8")
            req = urllib.request.Request(url, data=payload,
                headers={"Authorization": f"Bearer {ws_token}", "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                db_token = data.get("token", "")
        except Exception as e:
            logger.error(f"REST credential failed: {e}")

    if not db_token:
        try:
            auth_headers = w.config.authenticate()
            db_token = auth_headers.get("Authorization", "").replace("Bearer ", "") if auth_headers else ""
        except Exception as e:
            logger.error(f"Token fallback failed: {e}")

    if not user:
        try:
            me = w.current_user.me()
            user = me.user_name
        except Exception:
            user = "postgres"

    return host, user, db_token


def get_connection():
    global _connection
    try:
        if _connection is not None:
            try:
                cur = _connection.cursor()
                cur.execute("SELECT 1")
                cur.close()
                return _connection
            except Exception:
                try:
                    _connection.close()
                except Exception:
                    pass
                _connection = None

        host, user, password = _get_lakebase_credentials()
        logger.info(f"Connecting to Lakebase: host={host}, db={DB_NAME}, user={user}")

        try:
            tmp_conn = psycopg2.connect(
                host=host, port=DB_PORT, database="postgres",
                user=user, password=password, sslmode="require",
            )
            tmp_conn.autocommit = True
            tmp_cur = tmp_conn.cursor()
            tmp_cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DB_NAME,))
            if not tmp_cur.fetchone():
                tmp_cur.execute(f'CREATE DATABASE "{DB_NAME}"')
                logger.info(f"Created database: {DB_NAME}")
            tmp_cur.close()
            tmp_conn.close()
        except Exception as e:
            logger.warning(f"Could not check/create database: {e}")

        _connection = psycopg2.connect(
            host=host, port=DB_PORT, database=DB_NAME,
            user=user, password=password, sslmode="require",
            options=f"-c search_path={DB_SCHEMA}",
        )
        _connection.autocommit = True
        return _connection
    except Exception as e:
        logger.error(f"Failed to connect to Lakebase: {e}")
        raise


def get_workspace_client() -> WorkspaceClient:
    return _get_workspace_client()


def _create_training_tables(conn):
    """Create training-related tables for YOLO model training."""
    cur = conn.cursor()

    tables = [
        ("training_images", """
            CREATE TABLE IF NOT EXISTS training_images (
                image_id BIGINT PRIMARY KEY, filename VARCHAR(500) NOT NULL,
                volume_path VARCHAR(1000) NOT NULL, width INTEGER, height INTEGER,
                annotation_count INTEGER DEFAULT 0,
                uploaded_at TIMESTAMP DEFAULT NOW())
        """),
        ("training_annotations", """
            CREATE TABLE IF NOT EXISTS training_annotations (
                annotation_id BIGINT PRIMARY KEY,
                image_id BIGINT NOT NULL REFERENCES training_images(image_id) ON DELETE CASCADE,
                fixture_type VARCHAR(100) NOT NULL,
                x_center DOUBLE PRECISION NOT NULL, y_center DOUBLE PRECISION NOT NULL,
                width DOUBLE PRECISION NOT NULL, height DOUBLE PRECISION NOT NULL,
                created_at TIMESTAMP DEFAULT NOW())
        """),
        ("training_jobs", """
            CREATE TABLE IF NOT EXISTS training_jobs (
                job_id BIGINT PRIMARY KEY, databricks_run_id BIGINT,
                model_size VARCHAR(10), epochs INTEGER, batch_size INTEGER,
                status VARCHAR(20) DEFAULT 'PENDING',
                started_at TIMESTAMP DEFAULT NOW(), completed_at TIMESTAMP,
                metrics_json TEXT, error_message TEXT)
        """),
        ("trained_models", """
            CREATE TABLE IF NOT EXISTS trained_models (
                model_id BIGINT PRIMARY KEY, job_id BIGINT,
                model_name VARCHAR(200), model_path VARCHAR(1000),
                serving_endpoint VARCHAR(200),
                map50 DOUBLE PRECISION, map50_95 DOUBLE PRECISION,
                precision_val DOUBLE PRECISION, recall_val DOUBLE PRECISION,
                confusion_matrix_json TEXT,
                is_active BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW())
        """),
    ]

    for label, sql in tables:
        try:
            cur.execute(sql)
        except Exception as e:
            logger.warning(f"Training table [{label}]: {e}")

    # Ensure source_group column exists
    try:
        cur.execute("ALTER TABLE training_images ADD COLUMN IF NOT EXISTS source_group VARCHAR(500)")
    except Exception as e:
        logger.warning(f"ALTER source_group: {e}")

    # Ensure results_path column exists on training_jobs
    try:
        cur.execute("ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS results_path VARCHAR(1000)")
    except Exception as e:
        logger.warning(f"ALTER results_path: {e}")

    # Ensure detection_mode config
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


async def init_db_pool():
    try:
        conn = get_connection()
        logger.info("Successfully connected to Lakebase PostgreSQL")
        _auto_create_tables(conn)
        _create_training_tables(conn)
    except Exception as e:
        logger.warning(f"Could not connect on startup: {e}")


def _auto_create_tables(conn):
    cur = conn.cursor()

    schema_statements = [
        ("CREATE TABLE stores", """
            CREATE TABLE IF NOT EXISTS stores (
                store_id VARCHAR(20) PRIMARY KEY, uf VARCHAR(2) NOT NULL,
                name VARCHAR(200), address TEXT,
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())
        """),
        ("CREATE TABLE videos", """
            CREATE TABLE IF NOT EXISTS videos (
                video_id BIGINT PRIMARY KEY, filename VARCHAR(500) NOT NULL,
                volume_path VARCHAR(1000) NOT NULL, uf VARCHAR(2) NOT NULL,
                store_id VARCHAR(20) NOT NULL REFERENCES stores(store_id),
                video_date DATE NOT NULL, file_size_bytes BIGINT,
                duration_seconds DOUBLE PRECISION, fps DOUBLE PRECISION,
                resolution VARCHAR(50), total_frames INTEGER,
                frames_analyzed INTEGER DEFAULT 0,
                upload_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
                status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                progress_pct DOUBLE PRECISION DEFAULT 0,
                uploaded_by VARCHAR(200), error_message TEXT)
        """),
        ("CREATE TABLE fixture_types", """
            CREATE TABLE IF NOT EXISTS fixture_types (
                type_id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE,
                display_name VARCHAR(200) NOT NULL, description TEXT,
                icon VARCHAR(50), color VARCHAR(20) DEFAULT '#2563EB')
        """),
        ("CREATE TABLE detections", """
            CREATE TABLE IF NOT EXISTS detections (
                detection_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
                frame_index INTEGER NOT NULL, timestamp_sec DOUBLE PRECISION NOT NULL,
                fixture_type VARCHAR(100) NOT NULL, confidence DOUBLE PRECISION,
                bbox_x DOUBLE PRECISION, bbox_y DOUBLE PRECISION,
                bbox_w DOUBLE PRECISION, bbox_h DOUBLE PRECISION,
                tracking_id INTEGER, thumbnail_path VARCHAR(500),
                ai_description TEXT, occupancy_level VARCHAR(20),
                occupancy_pct DOUBLE PRECISION)
        """),
        ("CREATE TABLE fixtures", """
            CREATE TABLE IF NOT EXISTS fixtures (
                fixture_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
                store_id VARCHAR(20) NOT NULL, uf VARCHAR(2) NOT NULL,
                video_date DATE NOT NULL, fixture_type VARCHAR(100) NOT NULL,
                tracking_id INTEGER, first_seen_sec DOUBLE PRECISION,
                last_seen_sec DOUBLE PRECISION, frame_count INTEGER DEFAULT 1,
                avg_confidence DOUBLE PRECISION, best_thumbnail_path VARCHAR(500),
                occupancy_level VARCHAR(20), occupancy_pct DOUBLE PRECISION,
                ai_description TEXT, position_zone VARCHAR(50))
        """),
        ("CREATE TABLE fixture_summary", """
            CREATE TABLE IF NOT EXISTS fixture_summary (
                summary_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
                store_id VARCHAR(20) NOT NULL, uf VARCHAR(2) NOT NULL,
                video_date DATE NOT NULL, fixture_type VARCHAR(100) NOT NULL,
                total_count INTEGER NOT NULL, avg_occupancy_pct DOUBLE PRECISION,
                empty_count INTEGER DEFAULT 0, partial_count INTEGER DEFAULT 0,
                full_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())
        """),
        ("CREATE TABLE anomalies", """
            CREATE TABLE IF NOT EXISTS anomalies (
                anomaly_id BIGINT PRIMARY KEY, store_id VARCHAR(20) NOT NULL,
                uf VARCHAR(2) NOT NULL, video_id BIGINT,
                anomaly_type VARCHAR(50) NOT NULL, severity VARCHAR(20) NOT NULL,
                message TEXT NOT NULL, details TEXT,
                created_at TIMESTAMP DEFAULT NOW(), resolved BOOLEAN DEFAULT FALSE)
        """),
        ("CREATE TABLE processing_log", """
            CREATE TABLE IF NOT EXISTS processing_log (
                log_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
                started_at TIMESTAMP NOT NULL DEFAULT NOW(), completed_at TIMESTAMP,
                status VARCHAR(20) NOT NULL, processing_time_sec DOUBLE PRECISION,
                frames_total INTEGER, frames_analyzed INTEGER,
                fixtures_detected INTEGER, error_message TEXT)
        """),
        ("CREATE TABLE configurations", """
            CREATE TABLE IF NOT EXISTS configurations (
                config_id BIGINT PRIMARY KEY, config_key VARCHAR(200) NOT NULL UNIQUE,
                config_value TEXT NOT NULL, description TEXT,
                updated_at TIMESTAMP DEFAULT NOW())
        """),
        ("CREATE TABLE branding", """
            CREATE TABLE IF NOT EXISTS branding (
                setting_id BIGINT PRIMARY KEY, setting_key VARCHAR(200) NOT NULL UNIQUE,
                setting_value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW())
        """),
    ]

    for label, sql in schema_statements:
        try:
            cur.execute(sql)
        except Exception as e:
            logger.warning(f"Auto-setup [{label}]: {e}")

    # Ensure media_type column exists
    try:
        cur.execute("ALTER TABLE videos ADD COLUMN IF NOT EXISTS media_type VARCHAR(10) DEFAULT 'VIDEO'")
    except Exception as e:
        logger.warning(f"ALTER media_type: {e}")

    # --- Context system tables ---
    context_tables = [
        ("CREATE TABLE contexts", """
            CREATE TABLE IF NOT EXISTS contexts (
                context_id BIGINT PRIMARY KEY,
                name VARCHAR(200) NOT NULL UNIQUE,
                display_name VARCHAR(300) NOT NULL,
                description TEXT,
                icon VARCHAR(50) DEFAULT '📦',
                color VARCHAR(20) DEFAULT '#2563EB',
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """),
        ("CREATE TABLE context_object_types", """
            CREATE TABLE IF NOT EXISTS context_object_types (
                type_id SERIAL PRIMARY KEY,
                context_id BIGINT NOT NULL REFERENCES contexts(context_id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                display_name VARCHAR(200) NOT NULL,
                description TEXT,
                icon VARCHAR(50),
                color VARCHAR(20) DEFAULT '#2563EB',
                UNIQUE(context_id, name)
            )
        """),
    ]
    for label, sql in context_tables:
        try:
            cur.execute(sql)
        except Exception as e:
            logger.warning(f"Auto-setup [{label}]: {e}")

    # Add context_id column to existing tables
    context_id_tables = ['videos', 'fixtures', 'fixture_summary', 'anomalies',
                         'training_images', 'training_jobs', 'trained_models']
    for tbl in context_id_tables:
        try:
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = %s AND table_name = %s AND column_name = 'context_id'",
                (DB_SCHEMA, tbl),
            )
            if not cur.fetchone():
                cur.execute(f'ALTER TABLE "{tbl}" ADD COLUMN context_id BIGINT')
                logger.info(f"Added context_id column to {tbl}")
            else:
                logger.info(f"context_id already exists on {tbl}")
        except Exception as e:
            logger.error(f"Failed to add context_id to {tbl}: {e}", exc_info=True)

    # Indexes
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status)",
        "CREATE INDEX IF NOT EXISTS idx_videos_uf ON videos(uf)",
        "CREATE INDEX IF NOT EXISTS idx_videos_store ON videos(store_id)",
        "CREATE INDEX IF NOT EXISTS idx_fixtures_store ON fixtures(store_id)",
        "CREATE INDEX IF NOT EXISTS idx_fixtures_uf ON fixtures(uf)",
        "CREATE INDEX IF NOT EXISTS idx_fixtures_type ON fixtures(fixture_type)",
        "CREATE INDEX IF NOT EXISTS idx_summary_store ON fixture_summary(store_id)",
        "CREATE INDEX IF NOT EXISTS idx_summary_uf ON fixture_summary(uf)",
        "CREATE INDEX IF NOT EXISTS idx_stores_uf ON stores(uf)",
        # Context indexes
        "CREATE INDEX IF NOT EXISTS idx_videos_context ON videos(context_id)",
        "CREATE INDEX IF NOT EXISTS idx_fixtures_context ON fixtures(context_id)",
        "CREATE INDEX IF NOT EXISTS idx_summary_context ON fixture_summary(context_id)",
        "CREATE INDEX IF NOT EXISTS idx_anomalies_context ON anomalies(context_id)",
        "CREATE INDEX IF NOT EXISTS idx_training_images_context ON training_images(context_id)",
        "CREATE INDEX IF NOT EXISTS idx_training_jobs_context ON training_jobs(context_id)",
        "CREATE INDEX IF NOT EXISTS idx_trained_models_context ON trained_models(context_id)",
    ]
    for idx_sql in indexes:
        try:
            cur.execute(idx_sql)
        except Exception as e:
            logger.warning(f"Index: {e}")

    logger.info("Tables verified/created")

    # Seed fixture types
    try:
        cur.execute("SELECT COUNT(*) FROM fixture_types")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                INSERT INTO fixture_types (name, display_name, description, icon, color) VALUES
                ('ARARA', 'Arara', 'Arara de roupas', 'hanger', '#E11D48'),
                ('GONDOLA', 'Gondola', 'Gondola expositora', 'shelf', '#2563EB'),
                ('CESTAO', 'Cestao', 'Cestao promocional', 'basket', '#F59E0B'),
                ('PRATELEIRA', 'Prateleira', 'Prateleira de parede', 'wall-shelf', '#10B981'),
                ('BALCAO', 'Balcao', 'Balcao de atendimento', 'counter', '#8B5CF6'),
                ('DISPLAY', 'Display Promocional', 'Display de ponta de gondola', 'display', '#EC4899'),
                ('CHECKOUT', 'Checkout', 'Caixa registradora', 'register', '#6366F1'),
                ('MANEQUIM', 'Manequim', 'Manequim de vitrine', 'mannequin', '#14B8A6'),
                ('MESA', 'Mesa Expositora', 'Mesa para exposicao', 'table', '#F97316'),
                ('CABIDEIRO_PAREDE', 'Cabideiro de Parede', 'Cabideiro fixo na parede', 'wall-hanger', '#84CC16')
            """)
            logger.info("Fixture types seeded")
    except Exception as e:
        logger.warning(f"Seed fixture_types: {e}")

    # Seed configurations
    try:
        cur.execute("SELECT COUNT(*) FROM configurations")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                INSERT INTO configurations (config_id, config_key, config_value, description, updated_at) VALUES
                (1, 'scan_fps', '0.5', 'Frames por segundo para analise', NOW()),
                (2, 'confidence_threshold', '0.6', 'Confianca minima para deteccao', NOW()),
                (3, 'dedup_position_threshold', '15', 'Distancia maxima para dedup (%)', NOW()),
                (4, 'anomaly_std_threshold', '1.5', 'Desvios padrao para anomalia', NOW()),
                (5, 'timezone', 'America/Sao_Paulo', 'Timezone', NOW())
            """)
            logger.info("Default configurations seeded")
    except Exception as e:
        logger.warning(f"Seed configurations: {e}")

    # Seed branding
    try:
        cur.execute("SELECT COUNT(*) FROM branding")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                INSERT INTO branding (setting_id, setting_key, setting_value, updated_at) VALUES
                (1, 'primary_color', '#E11D48', NOW()),
                (2, 'secondary_color', '#1E293B', NOW()),
                (3, 'accent_color', '#F43F5E', NOW()),
                (4, 'sidebar_color', '#0F172A', NOW())
            """)
            logger.info("Default branding seeded")
    except Exception as e:
        logger.warning(f"Seed branding: {e}")

    # Ensure fmapi_model config exists
    try:
        cur.execute("SELECT 1 FROM configurations WHERE config_key = 'fmapi_model'")
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO configurations (config_id, config_key, config_value, description, updated_at)
                VALUES (%(id)s, 'fmapi_model', 'databricks-llama-4-maverick', 'Serving endpoint do modelo de visao (pode ser custom)', NOW())
            """, {"id": int(time.time() * 1000) + 6})
    except Exception as e:
        logger.warning(f"Seed fmapi_model: {e}")

    # Ensure header_bg_color exists
    try:
        cur.execute("SELECT 1 FROM branding WHERE setting_key = 'header_bg_color'")
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO branding (setting_id, setting_key, setting_value, updated_at)
                VALUES (%(id)s, 'header_bg_color', '#E11D48', NOW())
            """, {"id": int(time.time() * 1000)})
    except Exception as e:
        logger.warning(f"Seed header_bg_color: {e}")

    # Seed default context and migrate fixture_types
    try:
        cur.execute("SELECT COUNT(*) FROM contexts")
        if cur.fetchone()[0] == 0:
            ctx_id = int(time.time() * 1000)
            cur.execute("""
                INSERT INTO contexts (context_id, name, display_name, description, icon, is_default)
                VALUES (%s, 'expositores_loja', 'Expositores de Loja',
                        'Mobiliario e expositores de lojas de varejo: gondolas, araras, balcoes, prateleiras, displays',
                        '🏪', TRUE)
            """, (ctx_id,))
            # Migrate fixture_types to context_object_types
            cur.execute("SELECT name, display_name, description, icon, color FROM fixture_types")
            for row in cur.fetchall():
                try:
                    cur.execute("""
                        INSERT INTO context_object_types (context_id, name, display_name, description, icon, color)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (ctx_id, row[0], row[1], row[2], row[3], row[4]))
                except Exception:
                    pass
            # Backfill context_id on existing data
            for table in ['videos', 'fixtures', 'fixture_summary', 'anomalies', 'training_images', 'training_jobs', 'trained_models']:
                try:
                    cur.execute(f"UPDATE {table} SET context_id = %s WHERE context_id IS NULL", (ctx_id,))
                except Exception:
                    pass
            logger.info("Default context seeded and fixture_types migrated")
    except Exception as e:
        logger.warning(f"Context migration: {e}")

    cur.close()


async def close_db_pool():
    global _connection
    if _connection:
        try:
            _connection.close()
        except Exception:
            pass
        _connection = None


def execute_query(sql: str, params: Optional[dict] = None) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(sql, params)
        if cur.description:
            return [dict(row) for row in cur.fetchall()]
        return []
    finally:
        cur.close()


def execute_update(sql: str, params: Optional[dict] = None) -> int:
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        return cur.rowcount if cur.rowcount else 0
    finally:
        cur.close()


def get_config(key: str, default: str = "") -> str:
    try:
        rows = execute_query("SELECT config_value FROM configurations WHERE config_key = %(k)s", {"k": key})
        if rows:
            return rows[0]["config_value"]
    except Exception:
        pass
    return default
