# ─────────────────────────────────────────────────────────────────────────────
# VexCAD Web UI — Dockerfile
# Multi-stage Next.js 16 build with Prisma
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: Build the Next.js application ───────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client and Next.js build (needs placeholder envs at build time)
# Real URLs and secrets are injected at runtime via docker-compose / env.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV DIRECT_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV JWT_SECRET="build_time_jwt_secret_placeholder_replace_at_runtime"

RUN npx prisma generate
RUN npm run build

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 nextjs

# Copy only what Next.js needs at runtime
COPY --from=builder /app/public           ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static

# Copy Prisma schema + generated client so migrations/queries work
COPY --from=builder /app/prisma           ./prisma
COPY --from=builder /app/node_modules/.prisma   ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma   ./node_modules/@prisma

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
