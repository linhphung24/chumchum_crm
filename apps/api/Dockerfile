# syntax=docker/dockerfile:1
# ChumChum API — build từ GỐC repo vì là monorepo npm workspaces:
#   docker build -f apps/api/Dockerfile .   (context = gốc repo)

# ---------- BUILD ----------
FROM node:20-alpine AS build
WORKDIR /app
# Copy manifest trước để tận dụng cache layer
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @chumchum/api --include-workspace-root
COPY apps/api ./apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w apps/api

# ---------- RUNTIME ----------
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
# prisma + ts-node nằm trong dependencies nên có sẵn cho migrate/seed
RUN npm ci --workspace @chumchum/api --include-workspace-root --omit=dev \
 && npx prisma generate --schema apps/api/prisma/schema.prisma
WORKDIR /app/apps/api
EXPOSE 4000
# Tự áp dụng migration (idempotent) trước khi khởi động server
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/main.js"]
