# clinic-call-console

[![CI](https://github.com/Exalt24/clinic-call-console/actions/workflows/ci.yml/badge.svg)](https://github.com/Exalt24/clinic-call-console/actions/workflows/ci.yml)

Voice-agent call review console: personal details masked by default, revealed only with a reason, every access audited.

**Proof:** from a fresh clone on 2026-10-17, 72 Java tests and 126 Angular tests pass, and `scripts/mutation_check.py` broke 28 guards one at a time and every one was caught by a real test failure (the reveal no longer admin-only, the audit row not written, the signature not checked, and 25 more). CI runs the two test suites; the mutation check is not part of it.

![The console through a masked call, a reveal that needs a reason, and the audit trail it leaves](docs/demo.gif)

*A reviewer sees masked calls and cannot reveal anything. An administrator must give a reason to reveal, and every sign-in, view and reveal lands in the audit trail. Full-quality clip: [`docs/demo.mp4`](docs/demo.mp4).*

A review console for the calls a **voice assistant** takes. The calls are the interesting part: they are full of personal details,
and the people reviewing them should see as little of it as their job allows.

- **Masked by default.** Names, phone numbers, birth dates, emails, record and insurance numbers and addresses are masked when a call is
  received, and every screen shows only the masked copy.
- **Reveal on purpose.** Only an administrator can reveal a call, must give a reason, and the reveal and the reason are written to the audit
  trail in the same database transaction. The revealed text hides itself again after 60 seconds.
- **Everything is on the record.** Sign-ins (failed ones too, until an account locks; attempts during a lockout are refused before they are recorded), opened calls, status changes, reveals and incoming calls are listed in
  an admin-only audit trail.

> **This is a demonstration on synthetic data.** No real callers, no certification. It shows sensitive-data handling: least privilege,
> auditability, minimum necessary access, no personal details in logs. Limits are listed [below](#limits) and in
> [`docs/DECISIONS.md`](docs/DECISIONS.md).

**Live demo:** [clinic-call-console.vercel.app](https://clinic-call-console.vercel.app) (API: [clinic-call-console-api.onrender.com](https://clinic-call-console-api.onrender.com/actuator/health)). **The hosted API is currently suspended** (the free host paused it on 2026-10-09 for billing), so the live link shows the sign-in page and nothing past it. The recording above is the real run, and [Run it](#run-it) starts the whole stack locally.
Demo accounts (public on purpose, the data is invented): `reviewer@demo.test` / `reviewer-demo-pass` and `admin@demo.test` / `admin-demo-pass`.

## How it fits together

```mermaid
flowchart LR
  voice["Voice platform<br/>(webhook)"] -- "POST /api/ingest/calls<br/>X-Signature: t=...,v1=HMAC" --> ingest
  subgraph api["Spring Boot 4 API (Java 21)"]
    ingest["verify signature<br/>then validate"] --> redact["redactor<br/>mask identifiers"]
    redact --> enc["FieldCipher<br/>AES-256-GCM"]
    enc --> db[("calls<br/>(masked copy + encrypted original)")]
    rest["REST + JWT<br/>roles: REVIEWER, ADMIN"] --> db
    rest --> audit[("audit_event<br/>insert-only by convention")]
  end
  ng["Angular 22 app<br/>signals, lazy routes, CDK dialog"] -- "Bearer token" --> rest
```

## What is built

The sensitive columns are encrypted with AES-256-GCM, the audit row is written in the same transaction as the reveal, the ingest webhook is HMAC-signed with a replay window and idempotency, and the Angular app is keyboard operable with live regions for status changes and 44 px touch targets. The design decisions and what each one costs are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## How it is tested

| Layer | What | Count |
|---|---|---|
| Java unit and integration | redaction rules, encryption, webhook signature, lockout, and the whole API called with real tokens (wrong role, no token, forged token, expired token, missing reason, bad signature, replay) | 71 |
| Angular unit | guards, interceptors, services, every page, the reveal dialog, the route resolver | 126 |
| Browser end to end | a real Chromium walks login, filtering, masked reading, the reveal dialog, the audit trail and the phone layout at 390 px | 39 checks (not re-run on 2026-10-17) |
| **Mutation check** | `scripts/mutation_check.py` breaks one guard at a time (reveal no longer admin-only, audit not written, signature not checked, token sent to any origin, ...) and requires a genuine test failure each time | 28 of 28 caught |

The mutation check found two weak tests while this was being built (a cache-header assertion that Spring Security's default satisfied on its
own, and a mutant that did not change behaviour), and an end-to-end run found a form that submitted natively and reloaded the page. Each is now
pinned by a test.

```
cd api && ./mvnw test                      # 72 tests, no Docker needed
cd web && npx ng test --watch=false        # 126 tests (Vitest)
python scripts/mutation_check.py           # breaks 28 guards one at a time; edits source files in place, so run it in a copy
node web/tests/e2e.cjs <shots-dir>         # needs the API on :8080 and the web app on :4200
```

## Run it

```
cd api && ./mvnw spring-boot:run           # http://localhost:8080 (H2 in memory, 36 synthetic calls seeded)
cd web && npm ci && npx ng serve           # http://localhost:4200
python scripts/send_webhook.py             # sends one correctly signed call, then a forged one and an unsigned one
```

The default profile uses demo secrets so it runs after a fresh clone. The `prod` profile (`SPRING_PROFILES_ACTIVE=prod`) has **no defaults** for
`JWT_SECRET`, `FIELD_KEY`, `WEBHOOK_SECRET`, `CORS_ORIGINS` and the demo passwords, so a missing variable stops the boot.

## Limits

- **Not production.** In-memory H2 in PostgreSQL mode, reseeded at start; passwords for two demo accounts; no SSO.
- **The redactor is rule-based.** It does not catch a name the caller never introduces, and it leaves appointment dates visible on purpose.
  A real system would use a dedicated de-identification service.
- **The login lockout is in memory and per instance**; a multi-instance deployment needs Redis or a gateway.
- **The token is in `sessionStorage`**; a production build would use an httpOnly cookie from a backend-for-frontend (trade-off in `docs/DECISIONS.md`).
- **No real-time push.** The queue loads on demand.

## Layout

```
api/                       Spring Boot 4 (Java 21): calls, audit, auth, ingest, redaction, crypto, security, seed
  src/test/                72 tests; ApiSecurityTest and IngestApiTest call the real API as the wrong role
web/                       Angular 22: core (auth, interceptors, guards, services), shell, features (login, calls, audit), shared
  tests/e2e.cjs            Playwright walkthrough (39 checks)
scripts/                   mutation_check.py, send_webhook.py
demo/record.mjs            records the walkthrough that became docs/demo.gif
docs/DECISIONS.md          what was chosen, why, and what it costs
```
