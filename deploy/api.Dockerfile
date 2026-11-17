# Leadbook API. Build from the repository root:
#   docker build -f deploy/api.Dockerfile -t leadbook-api .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @leadbook/api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @leadbook/api build
# Self-contained copy with production dependencies only, plus the compiled code and SQL migrations.
RUN pnpm --filter @leadbook/api --prod deploy --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/drizzle /out/drizzle

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
