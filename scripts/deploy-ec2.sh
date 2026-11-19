#!/usr/bin/env bash
# Update (or first-time build) of the pm2 deployment on the server. Run from anywhere:
#   scripts/deploy-ec2.sh
# Steps: pull, install, build API and web, migrate the database, publish the web files, (re)start pm2.
# Take a backup first if the release contains database migrations (docs/AWS.md).
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env.production ] || { echo "Missing .env.production (copy deploy/env.pm2.example)" >&2; exit 1; }

echo "==> Pulling the latest code"
git pull --ff-only

echo "==> Installing dependencies"
pnpm install --frozen-lockfile --filter @leadbook/api... --filter @leadbook/web...

echo "==> Building"
pnpm --filter @leadbook/api build
pnpm --filter @leadbook/web build

echo "==> Applying database migrations"
node --env-file=.env.production apps/api/dist/db/migrate.js

echo "==> Publishing the web app"
sudo mkdir -p /var/www/leadbook
sudo rsync -a --delete apps/web/dist/ /var/www/leadbook/

echo "==> (Re)starting the API"
if pm2 describe leadbook-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo "==> Checking health"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "API is healthy"
    exit 0
  fi
  sleep 2
done
echo "API did not become healthy. See: pm2 logs leadbook-api" >&2
exit 1
