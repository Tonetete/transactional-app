# Build context: the repository root (docker build -f apps/api/Dockerfile .)
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @acex/api...
RUN pnpm --filter @acex/api bundle

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
# The relay service overrides the command with: node dist/relay-main.mjs
CMD ["node", "dist/main.mjs"]
