"""Create (or update) the demo API on Render from the public GitHub repo, with freshly generated secrets.

    python scripts/deploy_render.py <web_origin>        e.g. https://clinic-call-console.vercel.app

Reads the Render API token from RENDER_TOKEN_FILE (default: the workspace's Operations/.secrets/render_token.txt), generates a
signing secret, a field-encryption key and a webhook secret, stores them in SECRETS_OUT (never in the repo), and creates a
Docker web service on the free plan rooted at api/. The two demo passwords are the same public values the login page offers,
because the data is invented and the demo is meant to be tried.
"""
import base64
import json
import os
import secrets
import sys
import urllib.error
import urllib.request

TOKEN_FILE = os.environ.get("RENDER_TOKEN_FILE", r"C:\Projects\Professional\Operations\.secrets\render_token.txt")
SECRETS_OUT = os.environ.get("SECRETS_OUT", r"C:\Projects\Professional\Operations\.secrets\clinic_call_console.txt")
OWNER = os.environ.get("RENDER_OWNER", "tea-cspptat6l47c738glfn0")
NAME = "clinic-call-console-api"
REPO = "https://github.com/Exalt24/clinic-call-console"


def call(method, path, body=None):
    token = open(TOKEN_FILE, encoding="utf-8").read().strip()
    req = urllib.request.Request("https://api.render.com/v1" + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    origin = sys.argv[1].rstrip("/")
    env = {
        "JWT_SECRET": secrets.token_hex(32),
        "FIELD_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
        "WEBHOOK_SECRET": secrets.token_hex(24),
        "CORS_ORIGINS": origin,
        "REVIEWER_PASSWORD": "reviewer-demo-pass",
        "ADMIN_PASSWORD": "admin-demo-pass",
    }
    existing = open(SECRETS_OUT, encoding="utf-8").read() if os.path.exists(SECRETS_OUT) else ""
    if existing:
        print("secrets file already exists; keeping its values so the running service is not invalidated")
        for line in existing.splitlines():
            if "=" in line and line.split("=", 1)[0] in env and line.split("=", 1)[0] not in ("CORS_ORIGINS",):
                env[line.split("=", 1)[0]] = line.split("=", 1)[1]
    with open(SECRETS_OUT, "w", encoding="utf-8") as f:
        f.write("# clinic-call-console demo secrets (Render env). Never commit.\n")
        for k, v in env.items():
            f.write(f"{k}={v}\n")

    body = {
        "type": "web_service", "name": NAME, "ownerId": OWNER, "repo": REPO, "branch": "master", "autoDeploy": "yes", "rootDir": "api",
        "envVars": [{"key": k, "value": v} for k, v in env.items()],
        "serviceDetails": {
            "runtime": "docker", "plan": "free", "region": "oregon", "healthCheckPath": "/actuator/health",
            "envSpecificDetails": {"dockerfilePath": "./Dockerfile", "dockerContext": "."},
        },
    }
    status, out = call("POST", "/services", body)
    print("create:", status, (json.dumps(out)[:700] if not isinstance(out, str) else out[:700]))
    return 0 if status in (200, 201) else 1


if __name__ == "__main__":
    sys.exit(main())
