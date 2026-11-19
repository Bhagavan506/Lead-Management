# Deploying on one EC2 server (pm2 + Caddy + Neon)

A personal-use setup: one small Ubuntu server runs the API under **pm2**, **Caddy** serves the web app and gets the HTTPS certificate, and the database lives on **Neon**. No Docker.

```
browser --HTTPS--> Caddy (443) --+--> /var/www/leadbook      (the built web app)
                                 +--> 127.0.0.1:3000          (API under pm2) --> Neon PostgreSQL
```

Run **one** API process only: the daily reminder job runs inside it. Use the direct (not `-pooler`) Neon connection string.

## 1. Create the server (AWS console)

1. **EC2, Launch instance**, region **Asia Pacific (Mumbai) `ap-south-1`**.
2. **Image:** Ubuntu Server 24.04 LTS. **Type:** `t3.small` (2 GB). `t3.micro` also works if you add swap (step 3) but builds are slower. **Storage:** 20 GB gp3.
3. **Key pair:** create one (RSA, `.pem`) and keep the file safe.
4. **Security group:** SSH (22) from **My IP** only; HTTP (80) and HTTPS (443) from anywhere. Do **not** open 3000.
5. After launch, **Elastic IPs, Allocate, Associate** with the instance, so the address survives restarts.
6. **Address for HTTPS** (required: secure cookies and push notifications need it):
   - a domain or subdomain: add an **A record** to the Elastic IP; or
   - free, no domain: use `<ip with dashes>.sslip.io`, e.g. `13-232-10-5.sslip.io` for `13.232.10.5`.

Connect (from your PC): `ssh -i your-key.pem ubuntu@<elastic-ip>`

## 2. Install the software (on the server)

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl rsync build-essential debian-keyring debian-archive-keyring apt-transport-https gpg

# Node 22, pnpm (through corepack), pm2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
sudo corepack enable
sudo npm install -g pm2
node -v && pnpm -v          # v22.x and 10.x

# Caddy (official package)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
```

## 3. Optional: swap (recommended on 1 GB, harmless on 2 GB)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. Get the code and configure it

```bash
cd ~
git clone https://github.com/Bhagavan506/Lead-Management.git
cd Lead-Management
```

(If the repository is private, use a GitHub personal access token as the password, or add a deploy key.)

```bash
cp deploy/env.pm2.example .env.production
chmod 600 .env.production
nano .env.production
```

Fill in:

- `DATABASE_URL`: the Neon **direct** connection string.
- `JWT_SECRET`: `openssl rand -base64 48`
- `CORS_ORIGIN`: `https://<your address>`, no trailing slash.
- The push keys: install first (step 5), then `pnpm --filter @leadbook/api push:keys`, and paste the three lines it prints. Set `VAPID_SUBJECT` to a real contact (`mailto:...`).

## 5. First build and start

```bash
pnpm install --frozen-lockfile --filter @leadbook/api... --filter @leadbook/web...
pnpm --filter @leadbook/api push:keys      # copy the output into .env.production, then:
chmod +x scripts/deploy-ec2.sh
scripts/deploy-ec2.sh
```

The script pulls, builds the API and web app, applies migrations to Neon, copies the web files to `/var/www/leadbook`, starts the API under pm2 and checks `/health`. Re-running it is safe.

Make pm2 start after a reboot:

```bash
pm2 startup systemd         # run the sudo command it prints
pm2 save
```

## 6. HTTPS with Caddy

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile      # replace leadbook.example.com with your address
sudo systemctl reload caddy
```

Caddy requests the certificate by itself (the address must already point at the server, and ports 80/443 be open). Then open `https://<your address>/health`: it should show `{"status":"ok"}`.

## 7. First sign-in

Open `https://<your address>`, sign in as the admin you created, and set a new password when asked. Add employees on the **Team** tab, upload leads on **Upload**. To create an admin on a fresh database instead:

```bash
ADMIN_NAME="Your Name" ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at-least-12-characters' \
  node --env-file=.env.production apps/api/dist/db/create-admin.js
```

**Do not run the demo seed** against a real database.

## Everyday commands

| Task | Command |
| --- | --- |
| Update to the latest code | `scripts/deploy-ec2.sh` |
| Status / logs | `pm2 status` / `pm2 logs leadbook-api` |
| Restart | `pm2 restart leadbook-api` |
| Caddy logs | `sudo journalctl -u caddy -n 50` |
| Reload Caddy after editing | `sudo systemctl reload caddy` |

## Backups

Neon keeps point-in-time history (the window depends on your plan: check it in the Neon console under Backup & Restore). For your own copy, from the server:

```bash
sudo apt -y install postgresql-client
mkdir -p ~/backups
DATABASE_URL="$(grep ^DATABASE_URL= .env.production | cut -d= -f2-)" BACKUP_DIR=$HOME/backups scripts/backup.sh
```

Copy the files off the server now and then (`scp`). `scripts/restore.sh` and `docs/BACKUP.md` describe restoring.

## Housekeeping

- **Security updates:** `sudo apt -y install unattended-upgrades`.
- **Rotate secrets** if they were ever shared: the Neon password (Neon console, Roles), then update `DATABASE_URL` and run `pm2 restart leadbook-api --update-env`. Changing `JWT_SECRET` signs everyone out; changing the push keys makes everyone turn notifications on again.
- **Cost:** `t3.small` is roughly 15 USD a month plus the Elastic IP (free while attached to a running instance). Stop paying by terminating the instance and releasing the IP.
- **Not reachable from outside:** port 3000 (API) and the database, which is only reached outbound to Neon.

## Troubleshooting

- `pm2 logs leadbook-api` shows start-up errors; the API refuses to start on a bad setting and names it (for example "Invalid environment: JWT_SECRET ...").
- Certificate not issued: check the address resolves to the Elastic IP (`dig +short your.address`) and ports 80/443 are open in the security group.
- Out of memory during the build: add swap (step 3) or use a larger instance for the build.
- Login works but the page says you are signed out: the address in `CORS_ORIGIN` must match exactly what you type, including `https://`.
