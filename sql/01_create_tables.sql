-- Scenic Crawler AI - Lojas Americanas - Lakebase Schema
-- Retail fixture inventory from video analysis

CREATE TABLE IF NOT EXISTS stores (
    store_id VARCHAR(20) PRIMARY KEY,
    uf VARCHAR(2) NOT NULL,
    name VARCHAR(200),
    address TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
    video_id BIGINT PRIMARY KEY,
    filename VARCHAR(500) NOT NULL,
    volume_path VARCHAR(1000) NOT NULL,
    uf VARCHAR(2) NOT NULL,
    store_id VARCHAR(20) NOT NULL REFERENCES stores(store_id),
    video_date DATE NOT NULL,
    file_size_bytes BIGINT,
    duration_seconds DOUBLE PRECISION,
    fps DOUBLE PRECISION,
    resolution VARCHAR(50),
    total_frames INTEGER,
    frames_analyzed INTEGER DEFAULT 0,
    upload_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    progress_pct DOUBLE PRECISION DEFAULT 0,
    uploaded_by VARCHAR(200),
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS fixture_types (
    type_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(200) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(20) DEFAULT '#2563EB'
);

CREATE TABLE IF NOT EXISTS detections (
    detection_id BIGINT PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(video_id),
    frame_index INTEGER NOT NULL,
    timestamp_sec DOUBLE PRECISION NOT NULL,
    fixture_type VARCHAR(100) NOT NULL,
    confidence DOUBLE PRECISION,
    bbox_x DOUBLE PRECISION,
    bbox_y DOUBLE PRECISION,
    bbox_w DOUBLE PRECISION,
    bbox_h DOUBLE PRECISION,
    tracking_id INTEGER,
    thumbnail_path VARCHAR(500),
    ai_description TEXT,
    occupancy_level VARCHAR(20),
    occupancy_pct DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS fixtures (
    fixture_id BIGINT PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(video_id),
    store_id VARCHAR(20) NOT NULL,
    uf VARCHAR(2) NOT NULL,
    video_date DATE NOT NULL,
    fixture_type VARCHAR(100) NOT NULL,
    tracking_id INTEGER,
    first_seen_sec DOUBLE PRECISION,
    last_seen_sec DOUBLE PRECISION,
    frame_count INTEGER DEFAULT 1,
    avg_confidence DOUBLE PRECISION,
    best_thumbnail_path VARCHAR(500),
    occupancy_level VARCHAR(20),
    occupancy_pct DOUBLE PRECISION,
    ai_description TEXT,
    position_zone VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS fixture_summary (
    summary_id BIGINT PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(video_id),
    store_id VARCHAR(20) NOT NULL,
    uf VARCHAR(2) NOT NULL,
    video_date DATE NOT NULL,
    fixture_type VARCHAR(100) NOT NULL,
    total_count INTEGER NOT NULL,
    avg_occupancy_pct DOUBLE PRECISION,
    empty_count INTEGER DEFAULT 0,
    partial_count INTEGER DEFAULT 0,
    full_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anomalies (
    anomaly_id BIGINT PRIMARY KEY,
    store_id VARCHAR(20) NOT NULL,
    uf VARCHAR(2) NOT NULL,
    video_id BIGINT REFERENCES videos(video_id),
    anomaly_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS processing_log (
    log_id BIGINT PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(video_id),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    status VARCHAR(20) NOT NULL,
    processing_time_sec DOUBLE PRECISION,
    frames_total INTEGER,
    frames_analyzed INTEGER,
    fixtures_detected INTEGER,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS configurations (
    config_id BIGINT PRIMARY KEY,
    config_key VARCHAR(200) NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branding (
    setting_id BIGINT PRIMARY KEY,
    setting_key VARCHAR(200) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_uf ON videos(uf);
CREATE INDEX IF NOT EXISTS idx_videos_store ON videos(store_id);
CREATE INDEX IF NOT EXISTS idx_videos_date ON videos(video_date);
CREATE INDEX IF NOT EXISTS idx_detections_video ON detections(video_id);
CREATE INDEX IF NOT EXISTS idx_detections_type ON detections(fixture_type);
CREATE INDEX IF NOT EXISTS idx_fixtures_video ON fixtures(video_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_store ON fixtures(store_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_uf ON fixtures(uf);
CREATE INDEX IF NOT EXISTS idx_fixtures_type ON fixtures(fixture_type);
CREATE INDEX IF NOT EXISTS idx_summary_store ON fixture_summary(store_id);
CREATE INDEX IF NOT EXISTS idx_summary_uf ON fixture_summary(uf);
CREATE INDEX IF NOT EXISTS idx_anomalies_store ON anomalies(store_id);
CREATE INDEX IF NOT EXISTS idx_stores_uf ON stores(uf);
