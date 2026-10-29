# Multimodal credit reservations

A response request carries images as URLs or base64 data. The spending-envelope
estimator previously treated every serialized transport byte as ordinary text.
That makes a larger PNG more expensive to reserve even when it represents the
same image input. It can stop a funded account before the provider sees a request.

The Meta B3 pilot demonstrated this: four successful images resulted in about
14.7 MB of image transport. The next model step requested a USD 19.092055 hold,
about 477.3 credits, while the account still had 202 available credits. The
ledger records `dispatch: blocked`, zero charge and no outstanding hold for that
request. Narration and all 20 tool calls had succeeded, but no video was exported.
The original failed attempt and infrastructure triage remain retained.

The corrected response envelope separates typed `input_image` parts from text:

- Image URLs/data are excluded from the text byte estimate. Each image adds a
  temporary allowance of 16,384 input tokens, independent of file encoding size.
- Other request content keeps the existing conservative one-byte/one-token
  allowance. The existing output-token allowance and model rates are unchanged.
- Original request bodies reach the provider unchanged. The estimator does not
  remove images from the actual request or change agent prompts.
- This is a temporary reservation, not a usage meter or a hard spending cap.
  Provider-reported usage, actual-cost settlement, unknown-cost holds and blocking
  genuinely insufficient accounts retain their existing behavior.

Reservation snapshots use version `2026-10-29-multimodal`. Replaying the exact
failed request offline produces a USD 0.792965 reservation, about 19.8 credits,
without a network request or credit adjustment. That is a reservation correction,
not a passing video result or a refund of earlier legitimate usage.

Regression coverage checks transport-size invariance for both supported response
providers, increasing allowances for additional images and ordinary text, and
unchanged request bodies. A funded Meta request with four large image inputs
dispatches and settles its real usage; a zero-credit account still cannot dispatch.
