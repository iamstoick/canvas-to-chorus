# ---- deps: install workspace dependencies (also used by docker-compose.dev.yml) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# ---- build ----
FROM deps AS build
RUN npm run build -w @artlyrics/shared && npm run build -w @artlyrics/api \
 && npm prune --omit=dev \
 && rm -rf apps/api/src apps/api/test packages/shared/src

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache wget
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 3000
# Migrations run at container start so a fresh volume comes up ready.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
