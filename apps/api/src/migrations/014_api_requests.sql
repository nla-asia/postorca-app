-- One row per outbound HTTP attempt, including SDK retries. No prompts or media.
CREATE TABLE api_requests (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  turn_id uuid REFERENCES turns(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'succeeded', 'failed', 'interrupted')),
  http_status integer,
  provider_request_id text,
  provider_response_id text,
  error_code text,
  settings jsonb NOT NULL DEFAULT '{}',
  usage_data jsonb NOT NULL DEFAULT '{}',
  pricing_snapshot jsonb,
  estimated_cost numeric(24,12) CHECK (estimated_cost >= 0),
  estimated_currency text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  duration_ms bigint
);
CREATE INDEX api_requests_user_time ON api_requests(user_id, started_at);
CREATE INDEX api_requests_task_time ON api_requests(task_id, started_at);
CREATE INDEX api_requests_provider_time ON api_requests(provider, model, started_at);
