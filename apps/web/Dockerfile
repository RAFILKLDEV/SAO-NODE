# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/json/package.json packages/json/package.json
RUN --mount=type=cache,id=sao-npm,target=/root/.npm npm ci --prefer-offline
COPY apps/web apps/web
COPY packages/shared packages/shared
COPY packages/domain packages/domain
COPY packages/json packages/json
RUN npm run build -w @sao/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
