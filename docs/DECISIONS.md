# Decisions

Each entry says what was chosen, why, and what it costs. The honest limits are the point: a proof project should show where
its edges are.

## 1. Mask by default, reveal on purpose

A call is masked when it is ingested, not when it is displayed. The redacted transcript is stored beside the original, and
every read path returns the redacted one. The only code that can return readable text is `CallService.reveal`, behind an
admin-only endpoint, a required reason, and an audit row written in the same transaction.

*Why:* if masking happened at display time, any new endpoint or export would be unmasked by default. Storing the masked copy
makes the safe path the default path.
*Cost:* a bug in the redactor is stored. Mitigated by tests for every category and by flagging calls with many identifiers.

## 2. Rule-based redaction, with its limits written down

`PhiRedactor` is a list of named patterns (phone, SSN, email, birth date, record number, insurance ID, address, introduced
or titled names, and the patient's own name wherever it appears). Every mask can be explained: this pattern matched this
text.

*Why:* explainable beats clever in a compliance setting, and it needs no external service for a demo.
*Limits:* it does not catch a name the caller never introduces, and it leaves appointment dates visible so a reviewer can
judge the call. A production system would use a certified de-identification service and the full HIPAA Safe Harbor list.

## 3. Encrypt the sensitive columns in the application

The patient name and the raw transcript are stored as AES-256-GCM ciphertext with a random IV per value (`FieldCipher`).
A test reads the database columns and proves no readable name appears in them.

*Why:* a database dump or a backup does not leak transcripts.
*Cost:* encrypted columns cannot be searched, so search runs over the redacted text, which is also the safer behaviour.
*Next:* the key would come from a KMS with rotation, not an environment variable.

## 4. The audit row and the action share one transaction

`AuditService.record` joins the caller's transaction. If the reveal fails, no audit row says it happened; if the audit insert
fails, the reveal fails. Access to protected information cannot occur without its record.
The table is append-only in code (no setter, no update, no delete). *Next:* enforce it in the database with a restricted role
and a trigger, since application code is not a security boundary against a database administrator.

## 5. Stateless JWT, short-lived, role in the token

Login returns an HS256 token that expires in 30 minutes. Roles come from the validated token, never from anything the client
sends. Login failures return the same message for an unknown user and a wrong password, and an account locks for ten minutes
after five failures (`LoginThrottle`).
*Limits:* the throttle is in memory and per instance. A multi-instance deployment needs it in Redis or at the gateway.
*Next:* delegate to the practice's SSO (OIDC) and keep no passwords here at all.

## 6. Where the token lives in the browser

The token is in `sessionStorage`: it dies with the tab and is never in `localStorage`. The interceptor attaches it only to
requests for our own API origin (a test proves a look-alike host does not receive it), and an expired token is never sent.
*Trade-off:* script running on the page could read it. That is why the app loads no third-party scripts and ships a strict
Content-Security-Policy. A production deployment would use an httpOnly cookie issued by a backend-for-frontend.

## 7. The voice platform delivers calls by signed webhook

`POST /api/ingest/calls` is authenticated by `X-Signature: t=<unix>,v1=<HMAC-SHA256(secret, "t.body")>`, checked against the
raw body before it is parsed. The timestamp is inside the MAC and must be within five minutes (stops replay), the comparison is
constant-time, and the same `externalId` always maps to the same call (a redelivery changes nothing). One error message covers
every failure so a caller cannot tell which check failed.

## 8. Angular choices

Standalone components, signals for state, and RxJS where streams matter (debounced search with `switchMap`). Every component is
`OnPush` and the app is zoneless (the Angular 22 default). Pages are lazy loaded; the call page resolves its data before it
renders; `@defer` loads a rarely used panel on interaction. Runtime configuration comes from `/config.json`, so one build points
at any API with no rebuild.

## 9. What is deliberately not built

- **No real-time push.** The queue loads on demand; a live feed would be a server-sent-events stream authenticated with a
  short-lived ticket, because the browser's `EventSource` cannot send an Authorization header.
- **No database beyond in-memory H2.** The schema is real Flyway SQL in PostgreSQL mode and the data is synthetic and reseeded
  at startup. Moving to PostgreSQL is a connection string, not a rewrite.
- **No real patients, no BAA, no certification.** This is a demonstration of HIPAA-minded engineering (least privilege,
  auditability, minimum necessary access, no PHI in logs), not a HIPAA-compliant system.
