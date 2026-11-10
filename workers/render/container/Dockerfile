FROM node:22-bookworm-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 DEBIAN_FRONTEND=noninteractive

# python: tts (edge-tts, kokoro), transcripts, youtube search, orchestration. ffmpeg: remux + poster. ghostscript: EPS paper figures. The rest: chrome-headless-shell.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv ffmpeg ghostscript fonts-dejavu-core fontconfig ca-certificates \
        libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev \
        libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

RUN useradd --create-home --uid 10001 reel
WORKDIR /app

COPY requirements.txt .
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

# kokoro tts fallback: int8 model + voices from the model-files-v1.1 release, pinned by sha256 (weights Apache-2.0).
ARG KOKORO_RELEASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1
ADD --chmod=0644 --checksum=sha256:ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c ${KOKORO_RELEASE}/kokoro-v1.0.int8.onnx /opt/kokoro/kokoro-v1.0.int8.onnx
ADD --chmod=0644 --checksum=sha256:bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d ${KOKORO_RELEASE}/voices-v1.0.bin /opt/kokoro/voices-v1.0.bin
ENV KOKORO_MODEL_DIR=/opt/kokoro

COPY remotion/package.json remotion/package-lock.json ./remotion/
RUN cd remotion && npm ci --no-audit --no-fund

COPY remotion ./remotion
RUN cd remotion && node bundle.mjs && chown -R reel:reel /app/remotion/build /app/remotion/node_modules/.remotion

COPY app.py .
COPY reel ./reel
COPY audio ./audio

USER reel
ENV PORT=8080 TMPDIR=/tmp
EXPOSE 8080
CMD ["python", "app.py"]
