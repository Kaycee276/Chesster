# Multi-stage Dockerfile for Chesster Backend (Node.js 20 on Alpine)

# -------------------------------------------------------------
# Stage 1: Base image
# -------------------------------------------------------------
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package*.json ./

# -------------------------------------------------------------
# Stage 2: Development environment (with hot-reloading)
# -------------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
RUN npm install
COPY . .
USER node
EXPOSE 3001
CMD ["npm", "run", "dev"]

# -------------------------------------------------------------
# Stage 3: Production runner (lean & secure)
# -------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
RUN npm ci --only=production
COPY --chown=node:node . .
USER node
EXPOSE 3001
CMD ["node", "server.js"]
