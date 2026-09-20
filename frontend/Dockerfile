# Build stage: Node.js 20 (required runtime for the build toolchain).
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# Serve stage: static files + reverse proxy /api -> backend container.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
