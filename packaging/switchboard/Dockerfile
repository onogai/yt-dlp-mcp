# Build the forked stdio MCP once and expose it using the pinned HTTP adapter.
# Source remains the same version as this repository; do not fetch npm @latest.
FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/ytdlp \
    && /opt/ytdlp/bin/pip install --no-cache-dir yt-dlp==2026.10.26

ENV PATH="/opt/ytdlp/bin:${PATH}"
RUN npm install --global --no-audit --no-fund supergateway@4.2.2

WORKDIR /opt/yt-dlp-mcp
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run prepare

EXPOSE 8770
ENTRYPOINT ["supergateway"]
