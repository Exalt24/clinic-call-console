"""Send one signed call to the ingest webhook, the way the voice platform would.

    python scripts/send_webhook.py                                  # local API, demo secret
    API_URL=https://... WEBHOOK_SECRET=... python scripts/send_webhook.py

The body is signed with HMAC-SHA256 over "<unix seconds>.<raw body>" and sent as `X-Signature: t=<unix>,v1=<hex>`, exactly as
documented in docs/DECISIONS.md. Sending the same EXTERNAL_ID twice returns 200 with duplicate=true and changes nothing.
"""
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

API_URL = os.environ.get("API_URL", "http://127.0.0.1:8080").rstrip("/")
SECRET = os.environ.get("WEBHOOK_SECRET", "demo-only-webhook-secret-change-me")
EXTERNAL_ID = os.environ.get("EXTERNAL_ID", "demo-" + uuid.uuid4().hex[:8])

call = {
    "externalId": EXTERNAL_ID,
    "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "durationSec": 96,
    "agent": "After-hours agent",
    "callerNumber": "(415) 555-0123",
    "reason": "APPOINTMENT",
    "outcome": "BOOKED",
    "patientName": "Casey Rowan",
    "transcript": [
        {"speaker": "AGENT", "text": "Thanks for calling Riverside Family Clinic. How can I help?"},
        {"speaker": "CALLER", "text": "Hi, my name is Casey Rowan, born on June 9, 1988. I need a visit."},
        {"speaker": "AGENT", "text": "I have Tuesday at 9:30. Shall I text a reminder?"},
        {"speaker": "CALLER", "text": "Yes, to (415) 555-0123 or casey.rowan@example.test."},
    ],
}


def post(body: str, signature: str | None) -> tuple[int, str]:
    headers = {"Content-Type": "application/json"}
    if signature:
        headers["X-Signature"] = signature
    req = urllib.request.Request(f"{API_URL}/api/ingest/calls", data=body.encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main() -> int:
    body = json.dumps(call, separators=(",", ":"))
    ts = int(time.time())
    mac = hmac.new(SECRET.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    status, text = post(body, f"t={ts},v1={mac}")
    print(f"signed delivery   -> {status} {text}")
    status_bad, _ = post(body, f"t={ts},v1={'0' * 64}")
    print(f"forged signature  -> {status_bad} (must be 401)")
    status_none, _ = post(body, None)
    print(f"no signature      -> {status_none} (must be 401)")
    return 0 if status in (200, 201) and status_bad == 401 and status_none == 401 else 1


if __name__ == "__main__":
    sys.exit(main())
