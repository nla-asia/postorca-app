-- Successful transcriptions never recorded their audio length, so their cost was
-- unknown and each kept its hold. The length is gone, and the cost is a fraction of a
-- cent, so the holds are released uncharged.
UPDATE api_requests
SET credit_reserved = 0, credit_state = 'released'
WHERE operation = 'transcription'
  AND status = 'succeeded'
  AND credit_state = 'pending'
  AND estimated_cost IS NULL
  AND reported_cost IS NULL;
