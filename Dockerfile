# syntax=docker/dockerfile:1
#
# Build from this repository root (standalone erp-execution-service):
#   docker build -t erp-execution-service:latest .
#
# Node-only runtime image. Outbound ERP calls use FrappeClient against ERP_BASE_URL with ERP_SITE_HOST (Host header) when configured.

FROM node:20-bookworm AS builder
WORKDIR /build

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src

RUN npm ci && npm run build && npm prune --omit=dev

FROM node:20-bookworm

WORKDIR /opt/erp-execution-service

COPY --from=builder /build/package.json /build/package-lock.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist

USER node

EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8790)+'/internal/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "/opt/erp-execution-service/dist/server.js"]
