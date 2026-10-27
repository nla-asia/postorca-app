CREATE TABLE credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(24,9) NOT NULL,
  description text NOT NULL,
  reference text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX credit_ledger_user_time ON credit_ledger(user_id,created_at);
CREATE TABLE billing_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  stripe_subscription_id text,
  subscription_status text NOT NULL DEFAULT 'none',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE api_requests
  ADD COLUMN credit_state text CHECK (credit_state IN ('reserved','pending','settled','released','blocked')),
  ADD COLUMN credit_usd_per_credit numeric(24,12),
  ADD COLUMN credit_reserved numeric(24,9) NOT NULL DEFAULT 0 CHECK (credit_reserved >= 0),
  ADD COLUMN credit_charged numeric(24,9) NOT NULL DEFAULT 0 CHECK (credit_charged >= 0),
  ADD COLUMN credit_version integer NOT NULL DEFAULT 0,
  ADD COLUMN credit_reservation_snapshot jsonb,
  ADD COLUMN reported_cost numeric(24,12) CHECK (reported_cost >= 0),
  ADD COLUMN reported_currency text,
  ADD COLUMN reported_cost_source text;
CREATE INDEX api_requests_credit_owner ON api_requests(user_id,credit_state);
-- Historical requests intentionally retain NULL credit_state: never backcharge them.
