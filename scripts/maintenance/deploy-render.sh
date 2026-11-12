#!/bin/zsh
# Deploys the render worker (no Docker: renders run on the box) with the Instagram secrets and RENDER_BOX_TOKEN from .env.local (never printed, temp file removed).
set -euo pipefail
cd "$(dirname "$0")/../.."
unset CLOUDFLARE_API_TOKEN
secrets=$(mktemp)
trap 'rm -f "$secrets"' EXIT
python3 - "$secrets" <<'PY'
import json, os, sys
env = {}
for line in open('.env.local'):
    if '=' in line and not line.startswith('#'):
        key, _, value = line.rstrip('\n').partition('=')
        env[key.strip()] = value.strip().strip('\'"')
names = ('IG_ADMIN_TOKEN', 'IG_SESSION_KEY', 'IG_USERNAME', 'IG_PASSWORD', 'IG_TOTP_SECRET', 'RENDER_BOX_TOKEN')
payload = {k: env[k] for k in names if env.get(k)}
missing = [k for k in names[:4] if k not in payload]
if missing:
    sys.exit(f'missing in .env.local: {missing}')
open(sys.argv[1], 'w').write(json.dumps(payload))
os.chmod(sys.argv[1], 0o600)
PY
cd workers/render
npx wrangler deploy --secrets-file "$secrets"
