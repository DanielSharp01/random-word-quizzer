# syntax=docker/dockerfile:1
# One image: the API, which also serves the built frontend from the same origin.
# The @danielsharp packages come from a private registry; build with an npmrc holding its token:
#   docker build --secret id=npmrc,src=$HOME/.npmrc .
FROM node:26-slim AS build
RUN npm install -g pnpm@11.22.0
WORKDIR /app
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=true pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter quizzer-frontend build && pnpm --filter backend build

FROM node:26-slim
RUN npm install -g pnpm@11.22.0
WORKDIR /app
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=true pnpm install --prod --frozen-lockfile --filter backend && pnpm store prune
COPY --from=build /app/backend/dist backend/dist
COPY backend/drizzle backend/drizzle
COPY --from=build /app/frontend/dist frontend/dist

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    FRONTEND_DIR=/app/frontend/dist \
    MIGRATIONS_DIR=/app/backend/drizzle \
    MIGRATE_ON_START=true
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "backend/dist/index.mjs"]
