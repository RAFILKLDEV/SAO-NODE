FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package.json ./
COPY package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/json/package.json packages/json/package.json
RUN --mount=type=cache,id=sao-npm,target=/root/.npm npm ci --prefer-offline
COPY apps/api apps/api
COPY packages packages
COPY examples examples
RUN npm run prisma:generate -w @sao/api
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@sao/api"]
