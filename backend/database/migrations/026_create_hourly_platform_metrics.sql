-- Create hourly platform metrics rollup table
-- This table aggregates game participation, wager volume, and unique active players on an hourly basis
-- to enable efficient historical metrics queries and reduce load on the games table

CREATE TABLE IF NOT EXISTS hourly_platform_metrics (
    id SERIAL PRIMARY KEY,
    bucket_start TIMESTAMPTZ NOT NULL UNIQUE,
    total_matches INT NOT NULL DEFAULT 0,
    total_wager_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0,
    total_wager_usdc NUMERIC(20, 2) NOT NULL DEFAULT 0,
    unique_players INT NOT NULL DEFAULT 0,
    completed_matches INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_hourly_metrics_bucket_start ON hourly_platform_metrics (bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_metrics_created_at ON hourly_platform_metrics (created_at DESC);

-- Create trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_hourly_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hourly_metrics_updated_at_trigger ON hourly_platform_metrics;
CREATE TRIGGER hourly_metrics_updated_at_trigger
    BEFORE UPDATE ON hourly_platform_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_hourly_metrics_updated_at();

-- Enable RLS for consistency with other metrics tables
ALTER TABLE hourly_platform_metrics ENABLE ROW LEVEL SECURITY;

-- Create permissive policy for administrative access (metrics are aggregated, non-sensitive)
DROP POLICY IF EXISTS hourly_metrics_read_policy ON hourly_platform_metrics;
CREATE POLICY hourly_metrics_read_policy ON hourly_platform_metrics
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS hourly_metrics_write_policy ON hourly_platform_metrics;
CREATE POLICY hourly_metrics_write_policy ON hourly_platform_metrics
    FOR INSERT, UPDATE, DELETE
    USING (true);
