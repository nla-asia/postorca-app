-- Usage is charged in whole credits once per group: every request of one Orca turn,
-- or a single request made outside a turn. Requests settled before this keep their
-- per-request ledger entries and no group.
ALTER TABLE api_requests ADD COLUMN credit_group text;
CREATE INDEX api_requests_credit_group ON api_requests(user_id, credit_group)
  WHERE credit_group IS NOT NULL;
-- Which plan (builder, influencer) the current subscription is on.
ALTER TABLE billing_accounts ADD COLUMN subscription_plan text;
