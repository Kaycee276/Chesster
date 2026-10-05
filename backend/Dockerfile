# Install dependencies in a disposable stage, then copy production dependencies into the runtime image.
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile --prod

# Keep a development target for docker-compose local development.
FROM node:22-alpine AS dev
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
USER node
ENV NODE_ENV=development
EXPOSE 3001
CMD ["pnpm", "run", "dev"]

# Production runtime contains only the app and production dependencies.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json pnpm-lock.yaml ./
COPY --chown=node:node . .
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget -qO- http://localhost:3001/health || exit 1
EXPOSE 3001
CMD ["node", "server.js"]
