# Install dependencies in a disposable stage, then remove development tools
# before copying the production dependencies into the runtime image.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm prune --omit=dev

# Keep a development target for docker-compose local development.
FROM node:20-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
USER node
ENV NODE_ENV=development
EXPOSE 3001
CMD ["npm", "run", "dev"]

# Production runtime contains only the app and production dependencies.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node . .
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget -qO- http://localhost:3001/health || exit 1
EXPOSE 3001
CMD ["node", "server.js"]
