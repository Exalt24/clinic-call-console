# LIFESPAN: permanent
"""Mutation check for the NestJS API: break one guard at a time and prove the test suite notices.

A test that stays green when its guard is deleted proves nothing. For each mutation below this script
  1. first runs the suite UNMUTATED and requires it to pass (so a red result later means something),
  2. rewrites one source file, runs the whole suite (unit, end to end against PostgreSQL, contract) with --bail,
     and requires a genuine TEST failure (a compile error or a crashed runner does not count as "caught"),
  3. always restores the file.
A mutation that survives (tests still pass) fails the whole run.

    python scripts/mutation_check.py                 # all mutations
    python scripts/mutation_check.py --part 1/2      # the first half (each half stays under ten minutes)
    python scripts/mutation_check.py --list

It edits source files in place and restores them, so run it from a clean working tree and with the PostgreSQL container up
(`npm run db:up`).
"""
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = "src/"

# (label, file, old text, new text). old must occur exactly once in the file.
MUTATIONS = [
    ("authentication guard is no longer global", SRC + "app.module.ts",
     "        { provide: APP_GUARD, useClass: JwtAuthGuard },\n", ""),
    ("role guard is no longer global", SRC + "app.module.ts",
     "        { provide: APP_GUARD, useClass: RolesGuard },\n", ""),
    ("reveal is no longer admin-only", SRC + "calls/calls.controller.ts",
     "  @Roles('ADMIN')\n  @HttpCode(200)", "  @HttpCode(200)"),
    ("the audit trail is no longer admin-only", SRC + "audit/audit.controller.ts",
     "  @Roles('ADMIN')\n", ""),
    ("the role guard lets every role through", SRC + "common/security.ts",
     "!wanted.includes(user.role)", "false"),
    ("a token with an unknown role is accepted", SRC + "common/security.ts",
     "      if (claims.role !== 'REVIEWER' && claims.role !== 'ADMIN') throw new Error('unknown role');\n", ""),
    ("an expired token is accepted", SRC + "common/security.ts",
     "{ algorithms: ['HS256'] }", "{ algorithms: ['HS256'], ignoreExpiration: true }"),
    ("login no longer opts out of the default deny", SRC + "auth/auth.controller.ts",
     "  @Public()\n  @Post('login')", "  @Post('login')"),
    ("the health check no longer opts out of the default deny", SRC + "health.controller.ts",
     "  @Public()\n  @Get('health')", "  @Get('health')"),
    ("a reveal is no longer audited", SRC + "calls/calls.service.ts",
     "      await this.audit.record(m, actor, role, 'REVEAL', id, `reason: ${reason.trim()}`);\n", ""),
    ("an audit failure no longer stops the reveal", SRC + "calls/calls.service.ts",
     "await this.audit.record(m, actor, role, 'REVEAL', id, `reason: ${reason.trim()}`);",
     "await this.audit.record(m, actor, role, 'REVEAL', id, `reason: ${reason.trim()}`).catch(() => undefined);"),
    ("the status change is outside the audit transaction", SRC + "calls/calls.service.ts",
     "await m.update(CallRecord, { id }, { status: next });",
     "await this.ds.getRepository(CallRecord).update({ id }, { status: next });"),
    ("a status change is no longer audited", SRC + "calls/calls.service.ts",
     "      await this.audit.record(m, actor, role, 'STATUS_CHANGE', id, `from ${before} to ${next}`);\n", ""),
    ("opening a call is no longer audited", SRC + "calls/calls.service.ts",
     "      await this.audit.record(m, actor, role, 'VIEW_REDACTED', id, 'opened redacted transcript');\n", ""),
    ("the reveal reason is no longer trimmed", SRC + "calls/calls.dto.ts",
     "  @Transform(trimmed)\n  @Length(10, 300", "  @Length(10, 300"),
    ("the reveal reason may be short", SRC + "calls/calls.dto.ts",
     "@Length(10, 300,", "@Length(0, 300,"),
    ("the reveal reason may be very long", SRC + "calls/calls.dto.ts",
     "@Length(10, 300,", "@Length(10, 30000,"),
    ("the status is not validated", SRC + "calls/calls.dto.ts",
     "export class StatusDto {\n  @IsIn(STATUSES, { message: `status must be one of ${STATUSES.join(', ')}` })\n", "export class StatusDto {\n"),
    ("the global validation pipe is not installed", SRC + "app.setup.ts",
     "  app.useGlobalPipes(", "  String("),
    # not listed: removing `transform: true` is an equivalent mutant, the validation step still converts the values and
    # JavaScript arithmetic coerces the numeric strings the controller would then see, so no response differs.
    ("the problem details filter is not installed", SRC + "app.setup.ts",
     "  app.useGlobalFilters(new ProblemDetailsFilter());\n", ""),
    ("CORS allows every origin", SRC + "app.setup.ts",
     "    origin: cfg.corsOrigins,", "    origin: true,"),
    ("a call id is not checked to be a UUID", SRC + "calls/calls.controller.ts",
     "  @Get(':id')\n  @Header('Cache-Control', 'no-store')\n  detail(@Param('id', ParseUUIDPipe) id: string",
     "  @Get(':id')\n  @Header('Cache-Control', 'no-store')\n  detail(@Param('id') id: string"),
    ("a reveal response is cacheable", SRC + "calls/calls.controller.ts",
     "  @HttpCode(200)\n  @Header('Cache-Control', 'no-store')\n  reveal(", "  @HttpCode(200)\n  reveal("),
    ("an opened call is cacheable", SRC + "calls/calls.controller.ts",
     "  @Get(':id')\n  @Header('Cache-Control', 'no-store')\n  detail(", "  @Get(':id')\n  detail("),
    ("the X-Frame-Options header is gone", SRC + "common/request-hygiene.middleware.ts",
     "  res.setHeader('X-Frame-Options', 'DENY');\n", ""),
    ("an unexpected error shows its message", SRC + "common/problem-details.filter.ts",
     "let detail = 'An unexpected error occurred';", "let detail = String((ex as Error)?.message ?? ex);"),
    ("opening a call shows the original transcript", SRC + "calls/calls.service.ts",
     "transcript: parseLines(c.redactedTranscript)", "transcript: parseLines(this.cipher.decrypt(c.rawTranscriptEnc))"),
    ("ingest stores the unredacted transcript for display", SRC + "calls/calls.service.ts",
     "          redactedTranscript: red.text,", "          redactedTranscript: raw,"),
    ("ingest stores the patient name unencrypted", SRC + "calls/calls.service.ts",
     "          patientNameEnc: this.cipher.encrypt(req.patientName),", "          patientNameEnc: req.patientName,"),
    ("phone numbers are not masked", SRC + "redaction/phi-redactor.ts",
     "  out = replace(out, PHONE, '[PHONE]', 'PHONE', counts);\n", ""),
    ("social security numbers are not masked", SRC + "redaction/phi-redactor.ts",
     "  out = replace(out, SSN, '[SSN]', 'SSN', counts);\n", ""),
    ("the login lockout is gone", SRC + "auth/auth.service.ts",
     "if (this.throttle.isLocked(username)) {", "if (false) {"),
    ("a wrong-password answer names the account", SRC + "auth/auth.service.ts",
     "throw new UnauthorizedException('Wrong email or password');", "throw new UnauthorizedException(`Wrong email or password for ${username}`);"),
    ("a failed sign-in is not audited", SRC + "auth/auth.service.ts",
     "      await this.audit.recordAlone(username, 'NONE', 'LOGIN_FAILED', null, 'bad credentials');\n", ""),
    ("the webhook signature is not checked", SRC + "ingest/ingest.controller.ts",
     "if (!valid(signature,", "if (false && !valid(signature,"),
    ("a signed payload is not validated", SRC + "ingest/ingest.controller.ts",
     "if (problems.length > 0) {", "if (false) {"),
    ("a stale webhook timestamp is accepted", SRC + "ingest/webhook-signature.ts",
     "if (Math.abs(Math.floor(nowMs / 1000) - t) > toleranceSeconds) return false;", ""),
    ("the webhook MAC does not bind the timestamp", SRC + "ingest/webhook-signature.ts",
     ".update(`${timestamp}.${body}`, 'utf8')", ".update(body, 'utf8')"),
    ("the encryption IV is not random", SRC + "crypto/field-cipher.ts",
     "const iv = randomBytes(IV_BYTES);", "const iv = Buffer.alloc(IV_BYTES);"),
    ("the call page size is not capped", SRC + "calls/calls.service.ts",
     "Math.min(size, 50)", "Math.min(size, 5000)"),
    ("the audit page size is not capped", SRC + "audit/audit.service.ts",
     "Math.min(size, 100)", "Math.min(size, 10000)"),
]


def run_suite() -> tuple[int, str]:
    ensure_database()  # a cleanup elsewhere on the machine can remove the container between two runs
    p = subprocess.run("npx jest --config jest.config.js --runInBand --bail", cwd=ROOT, shell=True,
                       capture_output=True, text=True, encoding="utf8", errors="replace", timeout=300)
    return p.returncode, p.stdout + p.stderr


def failed_tests(out: str) -> list[str]:
    return re.findall(r"^[ \t]*● ([^\n]{1,300})$", out, flags=re.M)


def genuine_failure(out: str) -> bool:
    m = re.search(r"Tests:\s+(?:\d+ skipped, )?(\d+) failed", out)
    return bool(m and int(m.group(1)) > 0)


def ensure_database() -> None:
    """Starts the PostgreSQL container when it is not up (a no-op when it already is)."""
    subprocess.run("docker compose up -d --wait", cwd=ROOT, shell=True, capture_output=True, timeout=240)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if "--list" in args:
        for i, (label, *_rest) in enumerate(MUTATIONS, 1):
            print(f"{i:2d}. {label}")
        return 0
    chosen = list(enumerate(MUTATIONS, 1))
    if "--part" in args:
        k, n = (int(x) for x in args[args.index("--part") + 1].split("/"))
        size = -(-len(chosen) // n)
        chosen = chosen[(k - 1) * size: k * size]

    ensure_database()
    print(f"baseline: running the unmutated suite ({len(MUTATIONS)} mutations in total, {len(chosen)} in this run)")
    code, out = run_suite()
    summary = re.search(r"Tests:.*", out)
    print("  " + (summary.group(0) if summary else "no summary"))
    if code != 0:
        print(out[-3000:])
        print("BASELINE FAILED: fix the suite before trusting a mutation result")
        return 2

    survived, weak = [], []
    started = time.time()
    for i, (label, rel, old, new) in chosen:
        path = ROOT / rel
        original = path.read_text(encoding="utf8")
        if original.count(old) != 1:
            print(f"{i:2d}. [BAD MUTATION] {label}: the text to replace occurs {original.count(old)} times in {rel}")
            weak.append(label)
            continue
        try:
            path.write_text(original.replace(old, new), encoding="utf8")
            code, out = run_suite()
        finally:
            path.write_text(original, encoding="utf8")
        if code != 0 and genuine_failure(out):
            names = failed_tests(out)
            print(f"{i:2d}. CAUGHT   {label}\n        first failing test: {names[0].replace(chr(0x203a), '>') if names else '(see run)'}")
        elif code != 0:
            print(f"{i:2d}. NOT A TEST FAILURE (compile error or crashed runner, does not count): {label}")
            weak.append(label)
        else:
            print(f"{i:2d}. SURVIVED {label}")
            survived.append(label)

    caught = len(chosen) - len(survived) - len(weak)
    print(f"\n{caught} of {len(chosen)} mutations caught by a real test failure in {time.time() - started:.0f}s")
    for label in survived:
        print(f"  SURVIVED: {label}")
    for label in weak:
        print(f"  NOT COUNTED: {label}")
    return 1 if survived or weak else 0


if __name__ == "__main__":
    sys.exit(main())
