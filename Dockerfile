FROM oven/bun:1 AS web
WORKDIR /src/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bunx --bun tsc -b && bunx --bun vite build

FROM oven/bun:1-slim
WORKDIR /app
COPY server/ ./server/
COPY --from=web /src/web/dist ./web/dist
ENV DATA_DIR=/data PORT=8080 NODE_ENV=production
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=60s --timeout=5s \
  CMD bun -e "fetch('http://localhost:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["bun", "server/index.ts"]
