FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/xml/package.json packages/xml/package.json
RUN npm install
COPY apps/api apps/api
COPY packages packages
COPY schemas schemas
COPY examples examples
RUN npm run prisma:generate -w @sao/api
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@sao/api"]
