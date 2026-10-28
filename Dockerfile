# Harmoni production image: Next.js standalone server on Node, built with Bun.

FROM node:22-bookworm-slim AS base
COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# prisma.config.ts reads this; generating the client and building need no real database.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=$DATABASE_URL

FROM base AS deps
COPY package.json bun.lock prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs `prisma generate`.
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

# One-shot job that applies database migrations before the app starts.
FROM deps AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 CACHE_DIR=/data/cache
RUN groupadd --system harmoni && useradd --system --gid harmoni harmoni \
  && mkdir -p /data/cache && chown -R harmoni:harmoni /data
COPY --from=build --chown=harmoni:harmoni /app/.next/standalone ./
COPY --from=build --chown=harmoni:harmoni /app/.next/static ./.next/static
COPY --from=build --chown=harmoni:harmoni /app/public ./public
USER harmoni
EXPOSE 3000
CMD ["node", "server.js"]
