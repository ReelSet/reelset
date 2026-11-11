# Render box (Oracle Always Free)

One Ampere A1 VM runs the render container (Remotion, ffmpeg, TTS, instagrapi) and a Cloudflare Tunnel. The render Worker calls `https://box.reelset.app/<path>` with `Authorization: Bearer <BOX_TOKEN>`. No inbound ports are opened: the tunnel is outbound only.

```
render Worker -> https://box.reelset.app -> Cloudflare -> cloudflared (container) -> http://render:8080 (container)
```

## 1. Create the VM

Oracle Cloud console -> Compute -> Instances -> Create:

- Image: Canonical Ubuntu 24.04 (aarch64)
- Shape: `VM.Standard.A1.Flex`, 2 OCPU, 12 GB memory (Always Free allows up to 4 OCPU / 24 GB total)
- Boot volume: 50 GB or more
- Add your SSH public key; keep the default VCN. Do not add ingress rules beyond SSH (22).

If creation says "out of capacity", retry later or in another availability domain.

## 2. Create the tunnel

Done once from a laptop with `cloudflared` (a locally-managed tunnel; no Zero Trust onboarding):

```bash
cloudflared tunnel login                                   # authorize reelset.app in the browser
cloudflared tunnel create reelset-box
cloudflared tunnel route dns reelset-box box.reelset.app   # CNAME to the tunnel
cloudflared tunnel token reelset-box                       # -> TUNNEL_TOKEN for setup.sh
```

The tunnel has no remote ingress config: `setup.sh` runs cloudflared with `--url http://render:8080`
(cloudflared and the render container share the `reelset` docker network). The token is kept in
`reelset/.env.local` as `BOX_TUNNEL_TOKEN`.

## 3. Run setup

Generate a token (`openssl rand -hex 32`); the same value goes in the Worker as `BOX_TOKEN`.

```bash
ssh ubuntu@<vm-ip>
curl -fsSL https://raw.githubusercontent.com/ReelSet/reelset/main/scripts/box/setup.sh -o setup.sh
sudo BOX_TOKEN=... TUNNEL_TOKEN=... PROXY_URLS='http://user:pass@host:port,...' bash setup.sh
```

`PROXY_URLS` is optional (Instagram proxies). The script is idempotent: re-running keeps existing values in `/etc/reelset/box.env` (mode 600); pass `FORCE_ENV=1` to overwrite them, or edit the file and run `sudo reelset-run-render`.

Before the first run, the image must exist: push to `main` touching `workers/render/container/**`, or run the "Render image" workflow manually. Then make the GHCR package public (GitHub -> ReelSet -> Packages -> reelset-render -> Package settings -> Change visibility), otherwise the VM cannot pull without `docker login ghcr.io`.

## 4. Verify

```bash
curl https://box.reelset.app/health                      # {"ok": true, "running": 0}
curl -i https://box.reelset.app/render/x                 # 401 when BOX_TOKEN is set
curl -H "Authorization: Bearer $BOX_TOKEN" -X POST https://box.reelset.app/transcript -d '{}'   # 400 invalid_input
```

## Operations

| Item        | Detail                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Logs        | `docker logs -f render`, `docker logs -f cloudflared`                                             |
| Config      | `/etc/reelset/box.env` (`BOX_TOKEN`, `PROXY_URLS`, `TUNNEL_TOKEN`, `MAX_RENDERS`, `REEL_CONCURRENCY`) |
| Auto-update | systemd timer `reelset-update.timer` every 5 min pulls `:latest`; it recreates `render` only if the image changed and `/health` reports `running: 0`, otherwise retries next tick |
| Manual      | `sudo systemctl start reelset-update.service`, `systemctl list-timers reelset-update.timer`       |
| Limits      | render container: 2 CPUs, 9 GB RAM (no swap), 1 GB `/dev/shm`                                     |

Risks: a render that starts between the idle check and the container swap is lost (the Worker retries on 5xx or connection errors). Job output lives in the container's `/tmp`, so a restart drops finished-but-undownloaded jobs; the Worker re-renders.
