FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY erp-utils ./erp-utils

RUN npm ci

WORKDIR /app/erp-utils
RUN npm install && npm run build

WORKDIR /app
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

CMD ["node", "dist/server.js"]
