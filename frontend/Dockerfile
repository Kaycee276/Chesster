# Multi-stage Dockerfile for Chesster Frontend (React / Vite / Nginx)

# -------------------------------------------------------------
# Stage 1: Dependencies & Production Build
# -------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# -------------------------------------------------------------
# Stage 2: Development server (Vite with hot-module reload)
# -------------------------------------------------------------
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3090
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3090"]

# -------------------------------------------------------------
# Stage 3: Production web server (Nginx Alpine)
# -------------------------------------------------------------
FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
