-- analytics-schema.sql — Enterprise Telemetry & Event Storage Schema

CREATE TABLE IF NOT EXISTS telemetry_events (
  id SERIAL PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  company_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  meeting_id VARCHAR(128),
  priority VARCHAR(16),
  trigger_text TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_company_type ON telemetry_events (company_id, event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_timestamp ON telemetry_events (timestamp);

CREATE TABLE IF NOT EXISTS call_summaries (
  id SERIAL PRIMARY KEY,
  meeting_id VARCHAR(128) UNIQUE NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  duration_seconds INT NOT NULL,
  rep_talk_time_pct INT NOT NULL,
  client_talk_time_pct INT NOT NULL,
  objections_detected JSONB,
  cue_cards_shown INT DEFAULT 0,
  cue_cards_accepted INT DEFAULT 0,
  key_topics JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
