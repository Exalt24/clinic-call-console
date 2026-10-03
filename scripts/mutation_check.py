"""Mutation check: break one guard at a time and prove the test suite notices.

A test that stays green when its guard is deleted proves nothing. For each mutation below this script
  1. first runs the tests UNMUTATED and requires them to pass (so a red result later means something),
  2. rewrites one source file, runs only the tests that should catch it, and requires a genuine TEST failure
     (a compile error or a crashed runner does not count as "caught"),
  3. always restores the file.
A mutation that survives (tests still pass) fails the whole run.

    python scripts/mutation_check.py            # all mutations
    python scripts/mutation_check.py api        # only the Java API
    python scripts/mutation_check.py web        # only the Angular app
"""
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api"
WEB = ROOT / "web"
JAVA = "api/src/main/java/dev/dacruz/clinic/"
APP = "web/src/app/"

# (area, label, file, old text, new text, test selector). old and new may be lists when one mutation needs several edits.
MUTATIONS = [
    ("api", "reveal is no longer admin-only", JAVA + "calls/CallController.java",
     "    @PreAuthorize(\"hasRole('ADMIN')\")\n    public ResponseEntity<RevealResponse> reveal", "    public ResponseEntity<RevealResponse> reveal", "ApiSecurityTest"),
    ("api", "the audit trail is no longer admin-only", JAVA + "audit/AuditController.java",
     "    @PreAuthorize(\"hasRole('ADMIN')\")\n    public PageDto", "    public PageDto", "ApiSecurityTest"),
    ("api", "a reveal is no longer audited", JAVA + "calls/CallService.java",
     "        audit.record(actor, role, AuditEvent.Action.REVEAL, id, \"reason: \" + reason.trim());\n", "", "ApiSecurityTest"),
    ("api", "the reveal reason may be empty", JAVA + "calls/CallDtos.java",
     "            @NotBlank(message = \"A reason is required to reveal protected health information\")\n", "", "ApiSecurityTest"),
    ("api", "the reveal reason may be 1 character", JAVA + "calls/CallDtos.java", "min = 10, max = 300", "min = 0, max = 300", "ApiSecurityTest"),
    ("api", "the webhook signature is not checked", JAVA + "ingest/IngestController.java",
     "if (!WebhookSignature.valid(", "if (false && !WebhookSignature.valid(", "IngestApiTest"),
    ("api", "a stale webhook timestamp is accepted", JAVA + "ingest/WebhookSignature.java",
     "if (Math.abs(now.getEpochSecond() - t) > toleranceSeconds) {", "if (false) {", "WebhookSignatureTest"),
    ("api", "the webhook MAC does not bind the timestamp", JAVA + "ingest/WebhookSignature.java",
     "(timestamp + \".\" + body)", "(body)", "WebhookSignatureTest"),
    ("api", "ingest stores the unredacted transcript for display", JAVA + "calls/CallService.java",
     "                red.text(), red.summary()));", "                raw.toString(), red.summary()));", "IngestApiTest"),
    ("api", "PHI responses are cacheable", JAVA + "calls/CallController.java",
     "ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body)", "ResponseEntity.ok().body(body)", "ApiSecurityTest"),
    ("api", "the login lockout is gone", JAVA + "auth/AuthController.java", "if (throttle.isLocked(username)) {", "if (false) {", "ApiSecurityTest"),
    ("api", "the encryption IV is not random", JAVA + "crypto/FieldCipher.java", "            RANDOM.nextBytes(iv);\n", "", "FieldCipherTest"),
    ("api", "everything is publicly readable", JAVA + "security/SecurityConfig.java", ".anyRequest().authenticated())", ".anyRequest().permitAll())", "ApiSecurityTest"),
    ("api", "social security numbers are not masked", JAVA + "redaction/PhiRedactor.java",
     "        out = replace(out, SSN, \"[SSN]\", Kind.SSN, counts);\n", "", "PhiRedactorTest"),
    ("api", "a wrong-password answer names the account", JAVA + "auth/AuthController.java",
     "throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, \"Wrong email or password\");",
     "throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, \"Wrong email or password for \" + username);", "ApiSecurityTest"),
    ("api", "the page size is not capped", JAVA + "calls/CallService.java",
     "int safeSize = Math.max(1, Math.min(size, 50));", "int safeSize = Math.max(1, size);", "ApiSecurityTest"),

    ("web", "the bearer token is sent to any origin", APP + "core/auth.interceptor.ts",
     "if (token && req.url.startsWith(apiBaseUrl() + '/')) {", "if (token) {", "src/app/core/auth.interceptor.spec.ts"),
    ("web", "a 401 on the login call ends the session", APP + "core/auth.interceptor.ts",
     "if (err.status === 401 && !isLogin) {", "if (err.status === 401) {", "src/app/core/auth.interceptor.spec.ts"),
    ("web", "a reviewer can open the admin pages", APP + "core/auth.guard.ts",
     "return auth.isAdmin() ? true : inject(Router).createUrlTree(['/calls']);", "return true;", "src/app/core/auth.guard.spec.ts"),
    ("web", "the reveal form submits natively (page reload)", APP + "features/calls/reveal-dialog.ts",
     "[formGroup]=\"form\" (ngSubmit)=\"submit()\"", "(ngSubmit)=\"submit()\"", "src/app/features/calls/reveal-dialog.spec.ts"),
    ("web", "a whitespace-only reason is accepted", APP + "features/calls/reveal-dialog.ts",
     "const n = (c.value ?? '').trim().length;", "const n = (c.value ?? '').length;", "src/app/features/calls/reveal-dialog.spec.ts"),
    ("web", "the revealed-text timer leaks after the page is destroyed", APP + "features/calls/call-detail.page.ts",
     "this.destroyRef.onDestroy(() => this.clearTimer());", "", "src/app/features/calls/call-detail.page.spec.ts"),
    ("web", "revealed text never hides itself again", APP + "features/calls/call-detail.page.ts",
     "this.hideTimer = setTimeout(() => this.hide(true), REVEAL_VISIBLE_MS);", "", "src/app/features/calls/call-detail.page.spec.ts"),
    ("web", "login follows an off-site next parameter", APP + "features/login/login.page.ts",
     "&& !next.startsWith('//') && !next.includes('\\\\')", "", "src/app/features/login/login.page.spec.ts"),
    ("web", "the redaction tag adds a stray space after text", APP + "shared/redacted-text.ts",
     "<ng-container>{{ s.value }}</ng-container>", "<ng-container>{{ s.value }} </ng-container>", "src/app/shared/redacted-text.spec.ts"),
    ("web", "the call queue stops debouncing", APP + "features/calls/queue.page.ts", "debounceTime(250), ", "", "src/app/features/calls/queue.page.spec.ts"),
    ("web", "an expired token is still sent", APP + "core/auth.service.ts",
     "if (Date.parse(s.expiresAt) <= Date.now()) {", "if (false) {", "src/app/core/auth.service.spec.ts"),
    ("web", "a hanging health check is cancelled by the next retry tick", APP + "core/server-status.service.ts",
     ["exhaustMap, ", "exhaustMap(() =>"], ["switchMap, ", "switchMap(() =>"], "src/app/core/server-status.service.spec.ts"),
]


def run_tests(area: str, selector: str) -> tuple[bool, str]:
    """(passed, output). Output is decoded as UTF-8 with replacement: the runners print symbols cp1252 cannot decode."""
    if area == "api":
        cmd = [str(API / ("mvnw.cmd" if sys.platform == "win32" else "mvnw")), "-B", "-q", "test", f"-Dtest={selector}"]
        p = subprocess.run(cmd, cwd=API, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900,
                           shell=sys.platform == "win32")
    else:
        cmd = f'npx ng test --watch=false --include "{selector}"'
        p = subprocess.run(cmd, cwd=WEB, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900, shell=True)
    return p.returncode == 0, (p.stdout or "") + (p.stderr or "")


def genuine_failure(area: str, out: str) -> str | None:
    """The name of a failing test, or None when the run failed for another reason (compile error, crashed runner)."""
    out = re.sub(r"\x1b\[[0-9;]*m", "", out)
    if area == "api":
        if "COMPILATION ERROR" in out:
            return None
        m = re.search(r"\[ERROR\]\s+(\w+Test\.\w+)", out) or re.search(r"(\w+Test)\.(\w+) -- Time elapsed.*FAILURE", out)
        return (m.group(1) if m else None) if ("FAILURE" in out or "Failures:" in out) else None
    if "bundle generation failed" in out.lower() or "[ERROR]" in out:
        return None
    m = re.search(r"FAIL\s+web\s+(\S+)\s*>\s*(.+)", out)
    return (m.group(2).strip()[:90] if m else None)


def main() -> int:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    todo = [m for m in MUTATIONS if not only or m[0] == only]

    print("baseline (unmutated tests must pass):")
    for area, selector in dict.fromkeys((m[0], m[5]) for m in todo):
        ok, out = run_tests(area, selector)
        print(f"  {'pass' if ok else 'FAIL'}  [{area}] {selector}", flush=True)
        if not ok:
            print(out[-1500:])
            print("\nBASELINE IS RED: fix the tests before trusting any mutation result.")
            return 2

    survived, caught = [], 0
    print("\nmutations:")
    for area, label, rel, old, new, selector in todo:
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        olds = old if isinstance(old, (list, tuple)) else [old]
        news = new if isinstance(new, (list, tuple)) else [new]
        if any(o not in original for o in olds):
            print(f"  MISSING   [{area}] {label}: the text to mutate is not in {rel}")
            survived.append(label + " (text not found)")
            continue
        mutated = original
        for o, n in zip(olds, news):
            mutated = mutated.replace(o, n, 1)
        start = time.time()
        try:
            path.write_text(mutated, encoding="utf-8", newline="\n")
            passed, out = run_tests(area, selector)
        finally:
            path.write_text(original, encoding="utf-8", newline="\n")
        failing = None if passed else genuine_failure(area, out)
        if passed:
            verdict, note = "SURVIVED", ""
        elif failing is None:
            verdict, note = "INVALID ", "  (failed, but not as a test failure: compile error or crashed runner)"
        else:
            verdict, note = "caught  ", f"  <- {failing}"
        print(f"  {verdict}  [{area}] {label}  ({time.time() - start:.0f}s){note}", flush=True)
        if verdict == "caught  ":
            caught += 1
        else:
            survived.append(label)

    ok, _ = [run_tests(a, s) for a, s in dict.fromkeys((m[0], m[5]) for m in todo)][-1]
    print(f"\n{caught} caught, {len(survived)} survived or invalid; the tree is back to green: {ok}")
    if survived:
        print("PROBLEMS:", "; ".join(survived))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
