// pm2 process file for a single server (see docs/AWS.md). Start with:
//   pm2 start ecosystem.config.cjs
// The API reads its settings from .env.production in this folder (copy deploy/env.pm2.example).
// Run exactly ONE instance: the daily reminder scheduler lives inside the API process.
module.exports = {
  apps: [
    {
      name: "leadbook-api",
      cwd: __dirname,
      script: "apps/api/dist/index.js",
      node_args: "--env-file=.env.production",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 3000,
      max_memory_restart: "450M",
      time: true,
      env: { NODE_ENV: "production" },
    },
  ],
};
