#!/usr/bin/env bash
# Provisions the render box (Ubuntu 24.04 arm64): Docker, render container, cloudflared, auto-update timer. Idempotent.
# Usage: sudo BOX_TOKEN=... TUNNEL_TOKEN=... [PROXY_URLS=...] bash setup.sh
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/reelset/reelset-render:latest}"
ENV_FILE=/etc/reelset/box.env
NETWORK=reelset
UPDATE_BIN=/usr/local/bin/reelset-update
RUN_BIN=/usr/local/bin/reelset-run-render

log() { printf '[box-setup] %s\n' "$*"; }
die() { printf '[box-setup] error: %s\n' "$*" >&2; exit 1; }

require_root() { [ "$(id -u)" -eq 0 ] || die "run as root (sudo)"; }

install_docker() {
  if command -v docker >/dev/null 2>&1; then log "docker present"; return; fi
  log "installing docker from the official apt repo"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

# Writes KEY=value to the env file unless already present, so re-runs never clobber secrets.
set_env_default() {
  local key="$1" value="${2:-}"
  [ -n "$value" ] || return 0
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null && [ "${FORCE_ENV:-0}" != 1 ]; then return; fi
  sed -i "/^${key}=/d" "$ENV_FILE"
  printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
}

write_env_file() {
  install -d -m 0700 /etc/reelset
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  set_env_default BOX_TOKEN "${BOX_TOKEN:-}"
  set_env_default PROXY_URLS "${PROXY_URLS:-}"
  set_env_default TUNNEL_TOKEN "${TUNNEL_TOKEN:-}"
  set_env_default MAX_RENDERS "${MAX_RENDERS:-1}"
  set_env_default REEL_CONCURRENCY "${REEL_CONCURRENCY:-2}"
  for key in BOX_TOKEN TUNNEL_TOKEN; do
    grep -q "^${key}=." "$ENV_FILE" || die "${key} is required (pass it as an env var)"
  done
}

env_value() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }

ensure_network() { docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null; }

install_run_script() {
  cat >"$RUN_BIN" <<RUNNER
#!/usr/bin/env bash
# (Re)creates the render container from the current image; the single source of its docker flags.
set -euo pipefail
docker rm -f render >/dev/null 2>&1 || true
docker run -d --name render --restart unless-stopped --network "$NETWORK" \\
  --env-file <(grep -v '^TUNNEL_TOKEN=' "$ENV_FILE") \\
  -p 127.0.0.1:8080:8080 \\
  --memory 9g --memory-swap 9g --cpus 2 --shm-size 1g --pids-limit 2048 \\
  --log-driver json-file --log-opt max-size=20m --log-opt max-file=3 \\
  "$IMAGE" >/dev/null
RUNNER
  chmod 755 "$RUN_BIN"
}

run_tunnel() {
  docker rm -f cloudflared >/dev/null 2>&1 || true
  docker run -d --name cloudflared --restart unless-stopped --network "$NETWORK" \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://render:8080 \
    run --token "$(env_value TUNNEL_TOKEN)" >/dev/null
}

install_updater() {
  cat >"$UPDATE_BIN" <<UPDATER
#!/usr/bin/env bash
# Pulls the render image and recreates the container only when the digest changed and no render is running.
set -euo pipefail
IMAGE="$IMAGE"
ENV_FILE="$ENV_FILE"
RUN_BIN="$RUN_BIN"
docker pull -q "\$IMAGE" >/dev/null
after=\$(docker image inspect -f '{{.Id}}' "\$IMAGE")
current=\$(docker inspect -f '{{.Image}}' render 2>/dev/null || true)
[ "\$current" != "\$after" ] || exit 0
running=\$(curl -fsS --max-time 5 http://127.0.0.1:8080/health | sed -n 's/.*"running": *\([0-9]*\).*/\1/p' || true)
if [ "\${running:-1}" != "0" ]; then echo "new image pulled, render busy (running=\${running:-unknown}); will retry"; exit 0; fi
"$RUN_BIN"
docker image prune -f >/dev/null
echo "render updated to \$after"
UPDATER
  chmod 755 "$UPDATE_BIN"
  cat >/etc/systemd/system/reelset-update.service <<UNIT
[Unit]
Description=Update the reelset render container
After=docker.service
[Service]
Type=oneshot
ExecStart=$UPDATE_BIN
UNIT
  cat >/etc/systemd/system/reelset-update.timer <<'UNIT'
[Unit]
Description=Check for a new reelset render image every 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now reelset-update.timer >/dev/null
}

wait_healthy() {
  for _ in $(seq 1 30); do
    curl -fsS --max-time 3 http://127.0.0.1:8080/health >/dev/null 2>&1 && { log "render is healthy"; return; }
    sleep 2
  done
  docker logs --tail 40 render >&2
  die "render did not become healthy"
}

main() {
  require_root
  install_docker
  write_env_file
  ensure_network
  log "pulling $IMAGE"
  docker pull -q "$IMAGE" >/dev/null || die "cannot pull $IMAGE (make the GHCR package public, or docker login ghcr.io)"
  install_run_script
  "$RUN_BIN"
  run_tunnel
  install_updater
  wait_healthy
  log "done. verify: curl https://box.reelset.app/health"
}

main "$@"
