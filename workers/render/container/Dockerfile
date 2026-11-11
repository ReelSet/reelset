ARG TARGETARCH
# Kokoro weights (Apache-2.0) from the kokoro-onnx model-files-v1.1 release, pinned by sha256 (the v1.0 release files lack the duration output). int8 muffles 6-11 kHz. amd64 keeps fp16; arm64 uses fp32 because onnxruntime 1.24.1+ returns NaN for fp16 on linux aarch64 (microsoft/onnxruntime#32600).
FROM scratch AS kokoro-model-amd64
ADD --checksum=sha256:f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96 https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.fp16.onnx /kokoro-v1.0.fp16.onnx
ADD --checksum=sha256:bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin /voices-v1.0.bin

FROM scratch AS kokoro-model-arm64
ADD --checksum=sha256:beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx /kokoro-v1.0.onnx
ADD --checksum=sha256:bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin /voices-v1.0.bin

FROM kokoro-model-${TARGETARCH} AS kokoro-model

FROM node:22-bookworm-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 DEBIAN_FRONTEND=noninteractive

# fonts-noto-cjk (OFL) backs Chinese/Japanese/Korean text; only Regular and Bold are kept so the image grows by about 40 MB. python: tts (edge-tts, kokoro), transcripts, youtube search, orchestration. ffmpeg: remux + poster. ghostscript: EPS paper figures. The rest: chrome-headless-shell.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv ffmpeg ghostscript fonts-dejavu-core fonts-noto-cjk fontconfig ca-certificates \
        libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev \
        libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    && find /usr/share/fonts/opentype/noto -type f ! -name 'NotoSansCJK-Regular.ttc' ! -name 'NotoSansCJK-Bold.ttc' -delete \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

RUN useradd --create-home --uid 10001 reel
WORKDIR /app

COPY requirements.txt .
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

COPY --from=kokoro-model --chmod=0644 / /opt/kokoro/
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
