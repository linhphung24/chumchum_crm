# syntax=docker/dockerfile:1
# ChumChum Web — build từ GỐC repo vì là monorepo npm workspaces:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .

# ---------- BUILD ----------
FROM node:20-alpine AS build
WORKDIR /app
# NEXT_PUBLIC_* bị bake vào bundle lúc build → phải truyền qua build-arg
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @chumchum/web --include-workspace-root
COPY apps/web ./apps/web
RUN npm run build -w apps/web

# ---------- RUNTIME (standalone, không cần node_modules đầy đủ) ----------
FROM node:20-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# Standalone giữ nguyên cấu trúc monorepo (app/apps/web/server.js) → chép về đúng /app
COPY --from=build /app/apps/web/.next/standalone /app
COPY --from=build /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build /app/apps/web/public /app/apps/web/public
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "server.js"]
