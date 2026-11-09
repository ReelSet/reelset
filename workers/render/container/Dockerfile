FROM node:22-bookworm-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 DEBIAN_FRONTEND=noninteractive

# python: tts, transcripts, youtube search, orchestration. ffmpeg: remux + poster. The rest: chrome-headless-shell.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv ffmpeg fonts-dejavu-core fontconfig ca-certificates \
        libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev \
        libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

RUN useradd --create-home --uid 10001 reel
WORKDIR /app

COPY requirements.txt .
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

COPY remotion/package.json remotion/package-lock.json ./remotion/
RUN cd remotion && npm ci --no-audit --no-fund

COPY remotion ./remotion
RUN cd remotion && node bundle.mjs && chown -R reel:reel /app/remotion/build /app/remotion/node_modules/.remotion

COPY app.py .
COPY reel ./reel

USER reel
ENV PORT=8080 TMPDIR=/tmp
EXPOSE 8080
CMD ["python", "app.py"]
