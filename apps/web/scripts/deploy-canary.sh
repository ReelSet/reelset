#!/usr/bin/env bash
# Uploads a new reelset-web version at 0% traffic, smoke-tests it on the live domain through the
# version-override header, then promotes it. On any failure the current version keeps 100%.
# Workers with Durable Objects get no per-version preview URLs, hence the header.
set -euo pipefail

WORKER=reelset-web
BASE=${SMOKE_BASE_URL:-https://reelset.app}
ADMIN_BASE=${SMOKE_ADMIN_URL:-https://admin.reelset.app}
cd "$(dirname "$0")/.."

log() { echo "[deploy-canary] $*"; }

current=$(npx wrangler deployments status --json | jq -r '.versions | max_by(.percentage) | .version_id')
log "current version $current"

upload_log=$(mktemp)
npm run upload:cf 2>&1 | tee "$upload_log"
new=$(grep -o 'Worker Version ID: [0-9a-f-]*' "$upload_log" | tail -1 | awk '{print $4}')
rm -f "$upload_log"
[ -n "$new" ] || { log "could not read the uploaded version id"; exit 1; }
log "uploaded version $new"

npx wrangler versions deploy "$current@100%" "$new@0%" -y --message "canary $new at 0%"

override="Cloudflare-Workers-Version-Overrides: $WORKER=\"$new\""
failed=0
check() {
  local expect=$1 url=$2 code
  shift 2
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "$override" "$@" "$url" || echo 000)
  if [ "$code" = "$expect" ]; then
    log "ok   $code $url"
  else
    log "FAIL $code (want $expect) $url"
    failed=1
  fi
}

reel=$(curl -s -H "$override" "$BASE/sitemap.xml" | grep -o "$BASE/r/[^<]*" | head -1 || true)
for path in / /t /login /pricing /sitemap.xml /robots.txt /api/feed /opengraph-image /t/by/github; do
  check 200 "$BASE$path"
  check 200 "$BASE$path" -H 'Cookie: a=b; sb-x-auth-token=junk'
done
if [ -n "$reel" ]; then
  check 200 "$reel"
  check 200 "$reel/opengraph-image"
  check 200 "$BASE/r/made-up-slug-${reel##*-}"
else
  log "FAIL no reel URL in the sitemap"
  failed=1
fi
check 404 "$BASE/r/not-a-reel"
check 404 "$BASE/t/by/zz"
check 307 "$ADMIN_BASE/"

if [ "$failed" != 0 ]; then
  log "smoke test failed; keeping $current at 100%"
  npx wrangler versions deploy "$current@100%" -y --message "canary $new rejected"
  exit 1
fi

npx wrangler versions deploy "$new@100%" -y --message "promote $new"
log "promoted $new"
