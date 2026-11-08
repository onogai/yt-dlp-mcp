FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm ci --no-audit --no-fund && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/ytdlp \
    && /opt/ytdlp/bin/pip install --no-cache-dir 'yt-dlp[default]==2026.10.26'
COPY packaging/homelab/yt-dlp /usr/local/bin/yt-dlp
RUN chmod 755 /usr/local/bin/yt-dlp
WORKDIR /app
COPY --from=build /app/lib ./lib
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production YTDLP_IGNORE_CONFIG=1 YTDLP_ALLOW_PRIVATE_URLS=false \
    YTDLP_DOWNLOADS_DIR=/tmp/ytdlp-downloads PORT=8770 HOME=/tmp
USER node
EXPOSE 8770
CMD ["sh", "-c", "mkdir -p /tmp/ytdlp-downloads && exec node lib/http.mjs"]
