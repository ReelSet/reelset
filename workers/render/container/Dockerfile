ARG TARGETARCH
# Kokoro weights (Apache-2.0) from the kokoro-onnx model-files-v1.1 release, pinned by sha256 (the v1.0 release files lack the duration output). int8 muffles 6-11 kHz. amd64 keeps fp16; arm64 uses fp32 because onnxruntime 1.24.1+ returns NaN for fp16 on linux aarch64 (microsoft/onnxruntime#32600).
FROM scratch AS kokoro-model-amd64
ADD --chmod=0644 --checksum=sha256:f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96 https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.fp16.onnx /kokoro-v1.0.fp16.onnx
ADD --chmod=0644 --checksum=sha256:bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin /voices-v1.0.bin

FROM scratch AS kokoro-model-arm64
ADD --chmod=0644 --checksum=sha256:beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx /kokoro-v1.0.onnx
ADD --chmod=0644 --checksum=sha256:bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin /voices-v1.0.bin

FROM kokoro-model-${TARGETARCH} AS kokoro-model

FROM node:22-bookworm-slim AS skia-deps
WORKDIR /build
COPY skia/package.json skia/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS skia-build
WORKDIR /build
COPY skia/package.json skia/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY skia/tsconfig.json skia/build.mjs ./
COPY skia/src ./src
RUN node build.mjs

FROM node:22-bookworm-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 DEBIAN_FRONTEND=noninteractive

# fonts-noto-cjk (OFL) backs Chinese/Japanese/Korean text; only Regular and Bold are kept so the image grows by about 40 MB. python: tts (edge-tts, kokoro), transcripts, youtube search, orchestration. ffmpeg: remux + poster. ghostscript: EPS paper figures. The Skia renderer draws in-process (no browser) and falls back to the Noto CJK and DejaVu faces for text.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv ffmpeg ghostscript fonts-dejavu-core fonts-noto-cjk fontconfig ca-certificates \
    && find /usr/share/fonts/opentype/noto -type f ! -name 'NotoSansCJK-Regular.ttc' ! -name 'NotoSansCJK-Bold.ttc' -delete \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

RUN useradd --create-home --uid 10001 reel
WORKDIR /app

COPY requirements.txt .
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

COPY --from=kokoro-model / /opt/kokoro/
ENV KOKORO_MODEL_DIR=/opt/kokoro

COPY --from=skia-deps /build/node_modules /app/skia/node_modules
COPY --from=skia-build /build/dist /app/skia/dist
COPY skia/package.json /app/skia/package.json
COPY skia/assets /app/skia/assets
ENV SKIA_DIR=/app/skia

COPY app.py .
COPY reel ./reel
COPY audio ./audio

USER reel
ENV PORT=8080 TMPDIR=/tmp
EXPOSE 8080
CMD ["python", "app.py"]
