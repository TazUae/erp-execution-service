FROM node:20-slim AS base

WORKDIR /app

COPY package.json package-lock.json ./
COPY erp-utils ./erp-utils
RUN npm ci

WORKDIR /app/erp-utils
RUN npm ci && npm run build
WORKDIR /app

COPY src ./src
COPY tsconfig.json ./
RUN npm run build

CMD ["node", "dist/server.js"]
