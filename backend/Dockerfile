# =============================================================================
# Vedhic Foods Backend - production image
#
# BUILD CONTEXT IS THE MONOREPO ROOT, not backend/:
#
#   docker build -f backend/Dockerfile -t vedhicfoods-backend:latest .
#
# This is required, not cosmetic. `backend` depends on the `vedhicfoods-database`
# workspace package (`import { db } from 'vedhicfoods-database'`), and npm links
# workspaces as a symlink into the root `node_modules`. Building from `backend/`
# cannot resolve that dependency, and the previous revision of this file also
# did `COPY prisma ./prisma/` even though no `backend/prisma` directory exists -
# the schema lives at `database/prisma/`. That build could never have succeeded.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: base - shared toolchain
# -----------------------------------------------------------------------------
FROM node:22-alpine AS base

# `wget` is not needed: the healthcheck uses Node itself (see runner stage).
# openssl is required by the Prisma query engine on musl.
RUN apk add --no-cache openssl \
  && corepack enable

WORKDIR /app


# -----------------------------------------------------------------------------
# Stage 2: deps - full dependency tree (needed to compile TypeScript)
# -----------------------------------------------------------------------------
FROM base AS deps

# Copy only manifests first so this layer is cached until dependencies change.
# The nested lockfiles in backend/ and database/ are deliberately NOT copied:
# npm workspaces resolves from the root lockfile, and shipping a second
# lockfile invites an install that disagrees with CI.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY database/package.json ./database/

# Prisma also needs the schema at install time to run its postinstall hooks.
COPY database/prisma ./database/prisma

# `--ignore-scripts` would skip Prisma's postinstall generate step, so scripts
# stay enabled here.
RUN npm ci


# -----------------------------------------------------------------------------
# Stage 3: build - compile the database package, then the backend
# -----------------------------------------------------------------------------
FROM deps AS build

COPY database ./database
COPY backend ./backend

# The database package owns the generated Prisma Client and the pool config.
RUN npm run build --workspace vedhicfoods-database \
  && npm run build --workspace vedhicfoods-backend


# -----------------------------------------------------------------------------
# Stage 4: prod-deps - production-only dependency tree
# -----------------------------------------------------------------------------
FROM base AS prod-deps

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY database/package.json ./database/
COPY database/prisma ./database/prisma

RUN npm ci --omit=dev \
  && npm cache clean --force


# -----------------------------------------------------------------------------
# Stage 5: runner - the shipped image
# -----------------------------------------------------------------------------
FROM base AS runner

# Source maps let CloudWatch stack traces point at real TS lines.
# `--unhandled-rejections=strict` turns a silently-swallowed rejection into a
# crash, so a task with broken async work is replaced by ECS instead of limping
# along and passing liveness checks while returning 500s.
ENV NODE_ENV=production \
    PORT=5000 \
    NODE_OPTIONS="--enable-source-maps --unhandled-rejections=strict"

# Dedicated unprivileged account. `node` (uid 1000) already exists in the base
# image and is not used by this app, so reusing it avoids adding a passwd entry.
# All ownership is set explicitly at the end so the runtime stages need no
# further privilege changes.
RUN apk add --no-cache tini

WORKDIR /app

# Production dependencies only.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=prod-deps --chown=node:node /app/database/node_modules ./database/node_modules

# The compiled `vedhicfoods-database` workspace package. Required because the
# root `node_modules/vedhicfoods-database` symlink points at this directory.
COPY --from=build --chown=node:node /app/database/package.json ./database/package.json
COPY --from=build --chown=node:node /app/database/dist ./database/dist

COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist

# Schema + migrations are carried in the image so `prisma migrate deploy` can be
# run as an ECS one-off task without shipping a separate artifact.
COPY --from=build --chown=node:node /app/database/prisma ./database/prisma

# `tini` reaps zombies and, more importantly here, forwards SIGTERM to Node as
# PID 1. Without a real init the graceful-shutdown handler in server.ts may never
# run on `docker stop` / ECS stop, which is exactly what drops in-flight
# checkouts during a rolling deploy.
ENTRYPOINT ["/sbin/tini", "--"]

USER node

EXPOSE 5000

# Liveness only - reports that the process is up. Deliberately NOT /health/ready:
# a database blip should not cause Docker to restart an otherwise healthy
# container, and the ALB target group health check uses /health/ready instead.
#
# Uses Node rather than curl/wget so no extra package is needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||5000,path:'/api/v1/health',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# `PORT` is honoured from the environment (task definition / ECS `portMappings`),
# so no value is baked in here.
#
# bootstrap.js, not server.js: it resolves secrets from AWS Secrets Manager
# BEFORE config/env.ts validates process.env. server.js is only loaded after.
CMD ["node", "backend/dist/bootstrap.js"]