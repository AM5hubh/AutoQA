FROM node:24-bookworm AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/demo-site/package.json apps/demo-site/package.json
COPY workers/browser-worker/package.json workers/browser-worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run db:generate
RUN mkdir -p /app/artifacts && chown -R node:node /app/artifacts /app/apps/web
USER node
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]

FROM base AS web
ENV API_URL=http://api:4000
RUN npm run build
CMD ["npm", "run", "start", "--workspace", "@autoqa/web"]
