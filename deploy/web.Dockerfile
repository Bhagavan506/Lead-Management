# Leadbook web: the built single-page app behind nginx, which also forwards /api, /health and
# /webhooks to the API so the browser sees ONE origin (required by the SameSite=Strict session cookie).
#   docker build -f deploy/web.Dockerfile -t leadbook-web .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @leadbook/web...
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN pnpm --filter @leadbook/web build

FROM nginx:1.27-alpine
# The official image renders /etc/nginx/templates/*.template with environment variables at start.
ENV API_UPSTREAM=http://api:3000
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
