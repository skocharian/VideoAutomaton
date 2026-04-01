FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY config/render-config.json /app/config/render-config.json
COPY scripts/background-analysis-lib.mjs /app/scripts/background-analysis-lib.mjs
COPY container/server.mjs /app/container/server.mjs

ENV PORT=8080

EXPOSE 8080

CMD ["node", "/app/container/server.mjs"]
