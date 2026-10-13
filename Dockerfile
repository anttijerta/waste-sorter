# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app

# --ignore-scripts: native deps (better-sqlite3) ship prebuilt binaries, and install scripts are a supply-chain risk.

# Install all dependencies and build the app
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN node ace build

# Production dependencies only, installed against the build output
FROM base AS deps
COPY --from=build /app/build/package.json /app/build/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3333 \
    LOG_LEVEL=info \
    APP_URL=http://localhost:3333 \
    SESSION_DRIVER=cookie \
    TZ=UTC
# APP_KEY must be supplied at runtime; it is never baked into the image.

COPY --from=build --chown=node:node /app/build ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
RUN mkdir -p tmp && chown node:node tmp

USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "bin/server.js"]
